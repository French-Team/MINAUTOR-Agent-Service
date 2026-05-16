import { exec, execSync, ExecSyncOptions } from 'child_process'
import { promisify } from 'util'
const execAsync = promisify(exec)
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
  const lastRequestTimes: number[] = []

  async function checkRateLimit() {
    if (!agent.rateLimit?.enabled) return

    const now = Date.now()
    const oneMinuteAgo = now - 60000
    
    // Filter out old requests
    while (lastRequestTimes.length > 0 && lastRequestTimes[0] < oneMinuteAgo) {
      lastRequestTimes.shift()
    }

    const limit = agent.rateLimit.requestsPerMinute
    const burst = agent.rateLimit.burst || 0

    if (lastRequestTimes.length >= limit + burst) {
      const waitTime = Math.max(0, 60000 - (now - lastRequestTimes[0]))
      if (waitTime > 0) {
        console.log(`Rate limit reached (${limit} req/min + ${burst} burst). Waiting ${Math.round(waitTime / 1000)}s...`)
        await new Promise(resolve => setTimeout(resolve, waitTime))
      }
      return checkRateLimit() // Re-check after waiting
    }

    lastRequestTimes.push(now)
  }

  async function runTerminalCommand(command: string, processType: 'SYNC' | 'BACKGROUND' = 'SYNC', timeoutSeconds = 30): Promise<string> {
    // Guardian check
    if (agent.guardian?.enabled) {
      const harmfulPatterns = [
        /\brm\s+-[rf]+\b/i, /\brmdir\b/i, /\bdel\s+\/s\b/i, /\bunlink\b/i, /\bformat\b/i,
        /\bdrop\s+table\b/i, /\bdrop\s+database\b/i,
        /\bdelete\s+from\s+\w+(?!\s+where)\b/i,
        /\/etc\/(passwd|shadow|group)\b/i, 
        /C:\\Windows\\System32\b/i,
        /\bcurl\s+.*\s*\|\s*(bash|sh|python|node)\b/i,
        /\bwget\s+.*\s*\|\s*(bash|sh|python|node)\b/i,
        /\bnc\s+-e\b/i, /\bnetcat\s+-e\b/i
      ]
      
      const customPatterns = (agent.guardian.blockedPatterns || []).map(p => new RegExp(p, 'i'))
      const allPatterns = [...harmfulPatterns, ...customPatterns]

      if (agent.guardian.blockHarmful && allPatterns.some(p => p.test(command))) {
        const msg = `Guardian: Blocked potentially harmful command: ${command}`
        if (agent.guardian.auditTrail) console.warn(`[Guardian Audit] ${msg}`)
        return msg
      }
      
      if (agent.guardian.requireConfirmation) {
        const msg = `Guardian: Command requires confirmation: ${command}`
        if (agent.guardian.auditTrail) console.warn(`[Guardian Audit] ${msg}`)
        return msg
      }
      
      if (agent.guardian.auditTrail) {
        console.log(`[Guardian Audit] Executing command: ${command}`)
      }
    }

    try {
      if (processType === 'BACKGROUND') {
        // Simple background execution without waiting
        exec(command, { cwd, windowsHide: true })
        return `Command started in background: ${command}`
      }

      const { stdout, stderr } = await execAsync(command, {
        cwd,
        maxBuffer: 10 * 1024 * 1024,
        timeout: timeoutSeconds * 1000,
        windowsHide: true,
      })
      return stdout?.trim() || stderr?.trim() || ''
    } catch (err: unknown) {
      const error = err as { stdout?: string; stderr?: string; message?: string }
      if (error.stdout) return error.stdout.trim()
      if (error.stderr) return error.stderr.trim()
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

  let healthCheckInterval: NodeJS.Timeout | undefined
  let consecutiveFailures = 0
  let restartCount = 0
  let lastRestartTime = 0

  function startHealthCheck() {
    if (!agent.healthCheck?.enabled || healthCheckInterval) return

    healthCheckInterval = setInterval(async () => {
      try {
        // Simple health check simulation: we could try a very simple LLM call or just check process
        consecutiveFailures = 0
        if (agent.guardian?.auditTrail) console.log(`[HealthCheck] Agent ${agent.id} is healthy.`)
      } catch (err) {
        consecutiveFailures++
        console.error(`[HealthCheck] Agent ${agent.id} failure (${consecutiveFailures}/${agent.healthCheck!.maxConsecutiveFailures})`)
        
        if (consecutiveFailures >= agent.healthCheck!.maxConsecutiveFailures) {
          const now = Date.now()
          // Reset restart count if last restart was more than 1 hour ago
          if (now - lastRestartTime > 3600000) {
            restartCount = 0
          }

          if (agent.healthCheck!.autoRestart && restartCount < (agent.healthCheck!.maxRestarts || 5)) {
            restartCount++
            lastRestartTime = now
            console.warn(`[HealthCheck] Max failures reached. Auto-restarting agent ${agent.id} (restart ${restartCount}/${agent.healthCheck!.maxRestarts})...`)
            // In a real scenario, this would re-initialize the agent session or similar
            consecutiveFailures = 0 
          } else {
            console.error(`[HealthCheck] Max failures/restarts reached for agent ${agent.id}. Stopping health check.`)
            stopHealthCheck()
          }
        }
      }
    }, agent.healthCheck.checkIntervalMs || 30000)
  }

  function stopHealthCheck() {
    if (healthCheckInterval) {
      clearInterval(healthCheckInterval)
      healthCheckInterval = undefined
    }
  }

  async function executeTool(call: ToolCall): Promise<string> {
    const timeoutMs = agent.toolConfig?.toolTimeoutMs || 30000
    
    return new Promise(async (resolve) => {
      const timer = setTimeout(() => {
        resolve(`Error: Tool ${call.toolName} timed out after ${timeoutMs}ms`)
      }, timeoutMs)

      try {
        let result = ''
        if (call.toolName === 'run_terminal_command') {
          result = await runTerminalCommand(call.input.command as string)
        } else if (call.toolName === 'add_message') {
          addMessage('assistant', call.input.content as string)
          result = 'Message added'
        } else if (call.toolName === 'set_output') {
          setOutput(call.input as Record<string, unknown>)
          result = 'Output set'
        } else {
          result = `Error: Tool ${call.toolName} not supported in engine`
        }
        clearTimeout(timer)
        resolve(result)
      } catch (err) {
        clearTimeout(timer)
        resolve(`Error: ${err instanceof Error ? err.message : String(err)}`)
      }
    })
  }

  async function processTools(toolCalls: ToolCall[]): Promise<string[]> {
    if (!agent.toolConfig?.parallelTools || toolCalls.length <= 1) {
      const results = []
      for (const call of toolCalls) {
        results.push(await executeTool(call))
      }
      return results
    }

    const maxParallel = agent.toolConfig.maxParallel || 5
    const results: string[] = []
    for (let i = 0; i < toolCalls.length; i += maxParallel) {
      const chunk = toolCalls.slice(i, i + maxParallel)
      const chunkResults = await Promise.all(chunk.map(call => executeTool(call)))
      results.push(...chunkResults)
    }
    return results
  }

  async function runPrompt(prompt: string): Promise<{ toolCalls: ToolCall[]; response: string }> {
    addMessage('user', prompt)

    const toolCalls: ToolCall[] = []
    const textParts: string[] = []

    const lines = prompt.split('\n')
    for (const line of lines) {
      if (line.startsWith('!')) {
        const command = line.slice(1).trim()
        const output = await runTerminalCommand(command)
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
    await checkRateLimit()

    let retries = 0
    const maxRetries = agent.selfCorrection?.enabled ? agent.selfCorrection.maxRetries : 0
    const retryOnFailure = agent.selfCorrection?.retryOnFailure || false
    
    let response = ''
    let lastError: Error | undefined

    // Loop for retryOnFailure
    while (retries <= maxRetries) {
      try {
        response = await internalCallLLM(userMessage, llm, systemPrompt)
        lastError = undefined
        break
      } catch (err) {
        lastError = err as Error
        if (!retryOnFailure || retries >= maxRetries) break
        retries++
        const backoff = (agent.rateLimit?.backoffMultiplier || 1) * 1000 * retries
        console.warn(`LLM call failed (attempt ${retries}/${maxRetries}): ${lastError.message}. Retrying in ${backoff}ms...`)
        await new Promise(resolve => setTimeout(resolve, backoff))
      }
    }

    if (lastError) throw lastError

    // Loop for validateOutput
    if (agent.selfCorrection?.enabled && agent.selfCorrection.validateOutput) {
      let validationRetries = 0
      while (validationRetries < maxRetries) {
        const validationPrompt = `Tu es un validateur de réponse pour un agent IA nommé ${agent.displayName}. 
La demande de l'utilisateur était : "${userMessage}"
La réponse de l'agent est : "${response}"
Vérifie si la réponse est cohérente, complète et respecte les instructions de l'agent.
Si la réponse est valide, réponds uniquement "VALID".
Si elle est invalide, explique pourquoi brièvement et donne des conseils pour l'amélioration.`

        try {
          const validation = await internalCallLLM(validationPrompt, llm, "Tu es un expert en validation d'IA.")
          
          if (validation.trim().toUpperCase().includes('VALID') && validation.trim().length < 10) {
            break
          } else {
            validationRetries++
            console.log(`Self-Correction: Validation failed (attempt ${validationRetries}/${maxRetries}): ${validation}`)
            const retryPrompt = `${userMessage}\n\nTa réponse précédente a été jugée améliorable pour la raison suivante : ${validation}\nMerci de fournir une meilleure réponse en tenant compte de ces remarques.`
            response = await internalCallLLM(retryPrompt, llm, systemPrompt)
          }
        } catch (err) {
          console.error(`Validation attempt failed: ${(err as Error).message}`)
          break // Stop validation if it fails technically
        }
      }
    }
    
    return response
  }

  async function internalCallLLM(
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

    // Handle Streaming if enabled
    const isStreamingEnabled = agent.streaming?.enabled

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

    if (isStreamingEnabled) {
      const res = await post(url, { model: llm.model, messages: msgs, stream: true }, headers)
      const reader = res.body?.getReader()
      if (!reader) throw new Error('Streaming not supported by response body')

      let fullContent = ''
      let currentChunk = ''
      const chunkSize = agent.streaming?.chunkSize || 50
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
              
              if (agent.streaming?.showThinking && delta) {
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
      if (agent.streaming?.showThinking) {
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
    processTools,
    executeTool,
    startHealthCheck,
    stopHealthCheck,
    agent,
    cwd,
  }
}

export type Engine = ReturnType<typeof createEngine>
