import type { LLMProvider } from './engine-types.js'
import type { Message, TextPart, ToolCallPart } from './types/agent-definition.js'
import { processContext, type ProcessContextOptions } from './telecom/service/context/index.js'

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

export async function internalCallLLM(
  userMessage: string,
  llm: LLMProvider,
  systemPrompt: string,
  streamingConfig?: StreamingConfig,
  history: Message[] = [],
  contextOptions: ProcessContextOptions = {},
): Promise<string> {
  const base = llm.baseUrl.replace(/\/+$/, '')

  // Pipeline de compression : optimiser → nettoyer → resumer.
  // L'historique compressé est inséré entre le system prompt et le nouveau
  // message utilisateur, ce qui donne au LLM la mémoire de la conversation
  // tout en gardant la fenêtre de contexte sous contrôle.
  const compressedHistory = history.length > 0 ? processContext(history, contextOptions) : []

  const msgs: Array<{ role: string; content: string }> = [
    { role: 'system', content: systemPrompt },
    ...compressedHistory.map(toApiMessage),
    { role: 'user', content: userMessage },
  ]

  if (llm.provider === 'google') {
    const modelName = llm.model.replace(/^models\//, '')
    const url = `${base}/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(llm.apiKey)}`
    const contents = compressedHistory
      .map(toGoogleContent)
      .filter((c): c is NonNullable<typeof c> => c !== null)
    contents.push({ role: 'user', parts: [{ text: userMessage }] })
    const res = await post(url, {
      contents,
      systemInstruction: { parts: [{ text: systemPrompt }] },
    })
    const json = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text: string }> } }> }
    return json.candidates?.[0]?.content?.parts?.[0]?.text || '(réponse vide)'
  }

  if (llm.provider === 'ollama' || llm.provider === 'ollama-local' || llm.provider === 'ollama-cloud') {
    const url = `${base}/api/chat`
    const res = await post(url, { model: llm.model, messages: msgs, stream: false })
    const json = await res.json() as { message?: { content?: string } }
    return json.message?.content || '(réponse vide)'
  }

  // OpenAI-compatible (kilo, openrouter, opencode-zen, lm-studio, custom)
  const chatPath = llm.provider === 'kilo' ? '/api/gateway/chat/completions' : '/chat/completions'
  const url = `${base}${chatPath}`
  const headers: Record<string, string> = {}
  if (llm.apiKey) headers['Authorization'] = `Bearer ${llm.apiKey}`

  if (streamingConfig?.enabled) {
    const res = await post(url, { model: llm.model, messages: msgs, stream: true }, headers)
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
              // If we reach chunkSize (roughly estimating by words/chars as we don't have a tokenizer)
              // or if it's a newline/end of sentence
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
    return fullContent || '(streaming empty)'
  }

  const res = await post(url, { model: llm.model, messages: msgs }, headers)
  const raw = await res.text()
  let content = ''
  try {
    const json = JSON.parse(raw) as { choices?: Array<{ message?: { content?: string } }>; error?: { message: string } }
    if (json.error) throw new Error(json.error.message)
    content = json.choices?.[0]?.message?.content || ''
  } catch {
    // if JSON parsing or extraction fails, show raw response snippet
    content = raw.slice(0, 500)
  }
  return content || `(raw) ${raw.slice(0, 200)}`
}
