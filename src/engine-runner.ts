import type { ToolCall } from './types/agent-definition.js'
import type { LLMProvider } from './engine-types.js'
import { internalCallLLM, type StreamingConfig } from './engine-llm.js'
import { parseToolCalls } from './engine-parser.js'

interface RunnerDependencies {
  addMessage: (role: 'user' | 'assistant', content: string) => void
  runTerminalCommand: (command: string, processType?: 'SYNC' | 'BACKGROUND', timeoutSeconds?: number) => Promise<string>
  checkRateLimit: () => Promise<void>
  processTools: (toolCalls: ToolCall[]) => Promise<string[]>
  agent: {
    selfCorrection?: { enabled?: boolean; maxRetries?: number; retryOnFailure?: boolean }
    streaming?: StreamingConfig
    rateLimit?: { backoffMultiplier?: number }
  }
}

export function createRunner(deps: RunnerDependencies) {

  async function runPrompt(prompt: string): Promise<{ toolCalls: ToolCall[]; response: string }> {
    deps.addMessage('user', prompt)

    const toolCalls: ToolCall[] = []
    const textParts: string[] = []

    const lines = prompt.split('\n')
    for (const line of lines) {
      if (line.startsWith('!')) {
        const command = line.slice(1).trim()
        const output = await deps.runTerminalCommand(command)
        toolCalls.push({ toolName: 'run_terminal_command', input: { command } })
        textParts.push(`$ ${command}\n${output}`)
      } else if (line.startsWith('@')) {
        const message = line.slice(1).trim()
        deps.addMessage('assistant', message)
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
    await deps.checkRateLimit()

    let retries = 0
    const maxRetries = deps.agent.selfCorrection?.enabled ? (deps.agent.selfCorrection.maxRetries ?? 0) : 0
    const retryOnFailure = deps.agent.selfCorrection?.retryOnFailure || false

    let currentMessage = userMessage

    while (retries <= maxRetries) {
      try {
        let response = await internalCallLLM(
          currentMessage,
          llm,
          systemPrompt,
          deps.agent.streaming,
        )

        // Tool Loop
        let toolCalls = parseToolCalls(response)
        let loopCount = 0
        const maxLoops = 10

        while (toolCalls.length > 0 && loopCount < maxLoops) {
          loopCount++
          console.log(`[Tool Loop] Executing ${toolCalls.length} tool(s)...`)

          const results = await deps.processTools(toolCalls)

          // Construct the next prompt with tool results
          let toolResultsText = '\n\n### RÉSULTATS DES OUTILS :\n'
          for (let i = 0; i < toolCalls.length; i++) {
            toolResultsText += `- Outil: ${toolCalls[i].toolName}\n- Résultat: ${results[i]}\n\n`
          }

          // Add to history and call LLM again
          currentMessage += `\n${response}${toolResultsText}`
          response = await internalCallLLM(
            'Continue sur la base des résultats ci-dessus.',
            llm,
            systemPrompt,
            deps.agent.streaming,
          )
          toolCalls = parseToolCalls(response)
        }

        return response
      } catch (err) {
        if (!retryOnFailure || retries >= maxRetries) throw err
        retries++
        const backoff = (deps.agent.rateLimit?.backoffMultiplier || 1) * 1000 * retries
        console.warn(`LLM call failed (attempt ${retries}/${maxRetries}): ${(err as Error).message}. Retrying in ${backoff}ms...`)
        await new Promise(resolve => setTimeout(resolve, backoff))
      }
    }

    throw new Error('Maximum retries reached')
  }

  return { runPrompt, callLLM }
}
