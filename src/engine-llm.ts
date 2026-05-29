import type { LLMProvider } from './engine-types.js'
import type { Message, TextPart, ToolCallPart, ToolCall } from './types/agent-definition.js'
import { processContext, optimizeSystemPrompt, type ProcessContextOptions } from './telecom/service/context/index.js'

export interface StreamingConfig {
  enabled: boolean
  chunkSize?: number
  showThinking?: boolean
}

/**
 * Convertit un message interne (format Codebuff) en message API OpenAI/Ollama.
 * Les tool-calls et tool-results sont aplatis en texte pour les providers
 * qui ne supportent pas le format multi-parts (cas le plus courant en local).
 */
function toApiMessage(msg: Message): { role: string; content: string } {
  // Les serveurs locaux OpenAI-compatibles (LM Studio, llama.cpp) rejettent
  // souvent le rôle 'tool' sans tool_call_id apparié. On aplatit donc les
  // résultats d'outils en message 'user' préfixé, ce qui préserve l'info
  // sans casser les providers stricts.
  if (msg.role === 'tool') {
    const text = msg.content.map(p => p.content).join('\n')
    return { role: 'user', content: `[résultat outil] ${text}` }
  }

  const text = msg.content
    .map(p => {
      const part = p as TextPart | ToolCallPart
      if (part.type === 'text') return part.text
      if (part.type === 'tool-call') {
        return `[outil: ${part.toolName}(${JSON.stringify(part.input)})]`
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')

  return { role: msg.role, content: text }
}

/**
 * Convertit un message interne en format Google Gemini (parts + role mapping).
 */
function toGoogleContent(msg: Message): { role: string; parts: Array<{ text: string }> } | null {
  if (msg.role === 'system') return null // Gemini gère systemInstruction séparément
  if (msg.role === 'tool') {
    const text = msg.content.map(p => p.content).join('\n')
    return { role: 'user', parts: [{ text: `[résultat outil] ${text}` }] }
  }

  const text = msg.content
    .map(p => {
      const part = p as TextPart | ToolCallPart
      if (part.type === 'text') return part.text
      if (part.type === 'tool-call') return `[outil: ${part.toolName}]`
      return ''
    })
    .filter(Boolean)
    .join('\n')

  return {
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text }],
  }
}

async function post(url: string, body: unknown, headers?: Record<string, string>, timeout = 60000): Promise<Response> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status} — ${text.slice(0, 200)}`)
  }
  return res
}

/**
 * Génère les définitions d'outils au format OpenAI pour les toolNames donnés.
 */
export function buildToolDefs(toolNames: string[]): Array<Record<string, unknown>> {
  const TOOL_SCHEMAS: Record<string, Record<string, unknown>> = {
    run_terminal_command: {
      type: 'function',
      function: {
        name: 'run_terminal_command',
        description: 'Exécute une commande terminal et retourne le résultat',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'La commande à exécuter' },
          },
          required: ['command'],
        },
      },
    },
    add_message: {
      type: 'function',
      function: {
        name: 'add_message',
        description: 'Ajoute un message assistant à la conversation',
        parameters: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'Le contenu du message' },
            role: { type: 'string', description: 'Le rôle (assistant par défaut)', enum: ['assistant', 'user'] },
          },
          required: ['content'],
        },
      },
    },
    set_output: {
      type: 'function',
      function: {
        name: 'set_output',
        description: 'Définit la sortie structurée de l\'agent',
        parameters: {
          type: 'object',
          properties: {
            data: { type: 'object', description: 'Les données de sortie' },
          },
          required: ['data'],
        },
      },
    },
    skill: {
      type: 'function',
      function: {
        name: 'skill',
        description: 'Charge une compétence (skill) par son nom',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Le nom de la compétence' },
          },
          required: ['name'],
        },
      },
    },
  }

  return toolNames
    .filter(name => TOOL_SCHEMAS[name])
    .map(name => TOOL_SCHEMAS[name])
}

/**
 * Parse les tool_calls depuis une réponse OpenAI (format natif).
 * Retourne les ToolCall avec toolCallId renseigné.
 */
function parseRawToolCalls(data: unknown): ToolCall[] | undefined {
  const choices = (data as any)?.choices
  if (!Array.isArray(choices) || choices.length === 0) return undefined

  const msg = choices[0]?.message
  if (!msg?.tool_calls || !Array.isArray(msg.tool_calls)) return undefined

  const calls: ToolCall[] = []
  for (const tc of msg.tool_calls) {
    if (tc.type !== 'function') continue
    const name = tc.function?.name
    const argsRaw = tc.function?.arguments
    const id = tc.id
    if (!name || !argsRaw) continue
    try {
      const args = JSON.parse(argsRaw)
      calls.push({ toolName: name, input: args, toolCallId: id })
    } catch {
      // arguments stringifiés invalides — ignorer ce tool_call
    }
  }
  return calls.length > 0 ? calls : undefined
}

export async function internalCallLLM(
  userMessage: string,
  llm: LLMProvider,
  systemPrompt: string,
  streamingConfig?: StreamingConfig,
  history: Message[] = [],
  contextOptions: ProcessContextOptions = {},
  tools?: Array<Record<string, unknown>>,
): Promise<{ content: string; rawToolCalls?: ToolCall[] }> {
  const base = llm.baseUrl.replace(/\/+$/, '')

  // Pipeline de compression (étapes 0-0.5) : le system prompt est passé
  // au conservateur (tri des patterns) puis au composeur (assemblage compact).
  // Le résultat garde l'essentiel (mission, règles, compétences) et supprime
  // le bruit décoratif (séparateurs, fluff). Invisible pour l'appelant.
  const optimizedPrompt = optimizeSystemPrompt(systemPrompt)

  // Pipeline de compression (étapes 1-3) : optimiser → nettoyer → resumer.
  // L'historique compressé est inséré entre le system prompt et le nouveau
  // message utilisateur, ce qui donne au LLM la mémoire de la conversation
  // tout en gardant la fenêtre de contexte sous contrôle.
  const compressedHistory = history.length > 0 ? processContext(history, contextOptions) : []

  // Construire les messages pour l'API
  // Pour les providers compatibles OpenAI, on utilise le format natif
  // avec assistant + tool messages pour les continuations d'outils.
  const msgs: Array<Record<string, unknown>> = [
    { role: 'system', content: optimizedPrompt },
    ...compressedHistory.map(toApiMessage),
  ]

  msgs.push({ role: 'user', content: userMessage })

  if (llm.provider === 'google') {
    const modelName = llm.model.replace(/^models\//, '')
    const url = `${base}/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(llm.apiKey)}`
    const contents = compressedHistory
      .map(toGoogleContent)
      .filter((c): c is NonNullable<typeof c> => c !== null)
    contents.push({ role: 'user', parts: [{ text: userMessage }] })
    const res = await post(url, {
      contents,
      systemInstruction: { parts: [{ text: optimizedPrompt }] },
    })
    const json = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text: string }> } }> }
    return { content: json.candidates?.[0]?.content?.parts?.[0]?.text || '(réponse vide)' }
  }

  if (llm.provider === 'ollama' || llm.provider === 'ollama-local' || llm.provider === 'ollama-cloud') {
    const url = `${base}/api/chat`
    const res = await post(url, { model: llm.model, messages: msgs, stream: false })
    const json = await res.json() as { message?: { content?: string } }
    return { content: json.message?.content || '(réponse vide)' }
  }

  // OpenAI-compatible (kilo, openrouter, opencode-zen, lm-studio, custom)
  const chatPath = llm.provider === 'kilo' ? '/api/gateway/chat/completions' : '/chat/completions'
  const url = `${base}${chatPath}`
  const headers: Record<string, string> = {}
  if (llm.apiKey) headers['Authorization'] = `Bearer ${llm.apiKey}`

  // Injecter les définitions d'outils dans le body si fournies
  const body: Record<string, unknown> = { model: llm.model, messages: msgs }
  if (tools && tools.length > 0) {
    body.tools = tools
  }

  if (streamingConfig?.enabled) {
    const res = await post(url, { ...body, stream: true }, headers)
    const reader = res.body?.getReader()
    if (!reader) throw new Error('Streaming not supported by response body')

    let fullContent = ''
    let currentChunk = ''
    const chunkSize = streamingConfig.chunkSize || 50
    const decoder = new TextDecoder()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value)
      const lines = chunk.split('\n').filter(line => line.trim() !== '')
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed === 'data: [DONE]') break
        if (trimmed.startsWith('data: ')) {
          try {
            const data = JSON.parse(trimmed.slice(6))
            const delta = data.choices?.[0]?.delta?.content || ''
            fullContent += delta
            currentChunk += delta

            if (streamingConfig?.showThinking && delta) {
              if (currentChunk.length >= chunkSize * 4 || delta.includes('\n') || delta.includes('.') || delta.includes('?')) {
                process.stdout.write(currentChunk)
                currentChunk = ''
              }
            }
          } catch {
            // Skip partial or malformed JSON
          }
        }
      }
    }
    if (streamingConfig?.showThinking) {
      if (currentChunk) process.stdout.write(currentChunk)
      process.stdout.write('\n')
    }
    return { content: fullContent || '(streaming empty)' }
  }

  const res = await post(url, body, headers)
  const raw = await res.text()
  let content = ''
  let rawToolCalls: ToolCall[] | undefined
  try {
    const json = JSON.parse(raw) as Record<string, unknown>
    const err = (json as any)?.error
    if (err) throw new Error(typeof err === 'string' ? err : err.message)
    content = ((json as any)?.choices?.[0]?.message?.content) || ''
    rawToolCalls = parseRawToolCalls(json)
  } catch {
    // if JSON parsing or extraction fails, show raw response snippet
    content = raw.slice(0, 500)
  }
  return {
    content: content || `(raw) ${raw.slice(0, 200)}`,
    rawToolCalls,
  }
}
