import { execSync, ExecSyncOptions } from 'child_process'
import { randomUUID } from 'crypto'
import type { AgentDefinition, Message, ToolCall } from './types/agent-definition.js'

interface EngineConfig {
  agent: AgentDefinition
  cwd?: string
}

interface Session {
  id: string
  messages: Message[]
  createdAt: Date
  output: Record<string, unknown> | undefined
}

export interface LLMProvider {
  provider: string
  apiKey: string
  baseUrl: string
  model: string
}

const sessions = new Map<string, Session>()
let currentSessionId: string | undefined

export function createEngine(config: EngineConfig) {
  const cwd = config.cwd || process.cwd()
  const agent = config.agent

  function runTerminalCommand(command: string, processType: 'SYNC' | 'BACKGROUND' = 'SYNC', timeoutSeconds = 30): string {
    try {
      const options: ExecSyncOptions = {
        cwd,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
        timeout: processType === 'SYNC' ? timeoutSeconds * 1000 : undefined,
        windowsHide: true,
      }
      const output = execSync(command, options)
      return output?.toString()?.trim() || ''
    } catch (err: unknown) {
      const error = err as { stdout?: Buffer; stderr?: Buffer; message?: string }
      if (error.stdout) return error.stdout.toString().trim()
      if (error.stderr) return error.stderr.toString().trim()
      return `Error: ${error.message || 'Command failed'}`
    }
  }

  function addMessage(role: 'user' | 'assistant', content: string) {
    const session = getCurrentSession()
    if (session) {
      session.messages.push({ role, content: [{ type: 'text', text: content }] })
    }
  }

  function setOutput(output: Record<string, unknown>) {
    const session = getCurrentSession()
    if (session) {
      session.output = output
    }
  }

  function createSession(): Session {
    const session: Session = {
      id: randomUUID(),
      messages: [],
      createdAt: new Date(),
      output: undefined,
    }
    sessions.set(session.id, session)
    currentSessionId = session.id
    return session
  }

  function getCurrentSession(): Session | undefined {
    if (currentSessionId) return sessions.get(currentSessionId)
    return undefined
  }

  function getSession(id: string): Session | undefined {
    return sessions.get(id)
  }

  function listSessions(): Session[] {
    return Array.from(sessions.values())
  }

  function runPrompt(prompt: string): { toolCalls: ToolCall[]; response: string } {
    addMessage('user', prompt)

    const toolCalls: ToolCall[] = []
    const textParts: string[] = []

    const lines = prompt.split('\n')
    for (const line of lines) {
      if (line.startsWith('!')) {
        const command = line.slice(1).trim()
        const output = runTerminalCommand(command)
        toolCalls.push({ toolName: 'run_terminal_command', input: { command } })
        textParts.push(`$ ${command}\n${output}`)
      } else if (line.startsWith('@')) {
        const message = line.slice(1).trim()
        addMessage('assistant', message)
        toolCalls.push({ toolName: 'add_message', input: { role: 'assistant', content: message } })
      }
    }

    if (textParts.length === 0) {
      textParts.push(prompt)
    }

    return { toolCalls, response: textParts.join('\n') }
  }

  async function callLLM(
    userMessage: string,
    llm: LLMProvider,
    systemPrompt: string,
  ): Promise<string> {
    const base = llm.baseUrl.replace(/\/+$/, '')
    const timeout = 60000

    async function post(url: string, body: unknown, headers?: Record<string, string>): Promise<Response> {
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

    const msgs = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ]

    if (llm.provider === 'google') {
      const modelName = llm.model.replace(/^models\//, '')
      const url = `${base}/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(llm.apiKey)}`
      const res = await post(url, {
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
      })
      const json = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text: string }> } }> }
      return json.candidates?.[0]?.content?.parts?.[0]?.text || '(réponse vide)'
    }

    if (llm.provider === 'ollama') {
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

  return {
    runTerminalCommand,
    addMessage,
    setOutput,
    createSession,
    getCurrentSession,
    getSession,
    listSessions,
    runPrompt,
    callLLM,
    agent,
    cwd,
  }
}

export type Engine = ReturnType<typeof createEngine>
