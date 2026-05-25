import type { ToolCall, ToolConfig } from './types/agent-definition.js'
import { loadSkill } from './skills.js'

export function createToolExecutor(
  runTerminalCommand: (command: string, processType?: 'SYNC' | 'BACKGROUND', timeoutSeconds?: number) => Promise<string>,
  addMessage: (role: 'user' | 'assistant', content: string) => void,
  setOutput: (output: Record<string, unknown>) => void,
  toolConfig?: ToolConfig,
) {
  async function executeTool(call: ToolCall): Promise<string> {
    const timeoutMs = toolConfig?.toolTimeoutMs || 60000

    let timer: NodeJS.Timeout | undefined
    const timeoutPromise = new Promise<string>((resolve) => {
      timer = setTimeout(() => {
        resolve(`Error: Tool ${call.toolName} timed out after ${timeoutMs}ms`)
      }, timeoutMs)
    })

    const executionPromise = (async () => {
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
        } else if (call.toolName === 'skill') {
          const skillName = call.input.name as string
          const skill = loadSkill(skillName)
          if (skill) {
            const body = skill.content.replace(/---[\s\S]*?---\n/, '').trim()
            result = `Skill "${skillName}" chargée :\n\n${body}`
          } else {
            result = `Error: Skill "${skillName}" introuvable`
          }
        } else {
          result = `Error: Tool ${call.toolName} not supported in engine`
        }
        return result
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`
      }
    })()

    try {
      const result = await Promise.race([executionPromise, timeoutPromise])
      if (timer) clearTimeout(timer)
      return result
    } catch (err) {
      if (timer) clearTimeout(timer)
      return `Error: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  async function processTools(toolCalls: ToolCall[]): Promise<string[]> {
    if (!toolConfig?.parallelTools || toolCalls.length <= 1) {
      const results = []
      for (const call of toolCalls) {
        results.push(await executeTool(call))
      }
      return results
    }

    const maxParallel = toolConfig.maxParallel || 5
    const results: string[] = []
    for (let i = 0; i < toolCalls.length; i += maxParallel) {
      const chunk = toolCalls.slice(i, i + maxParallel)
      const chunkResults = await Promise.all(chunk.map(call => executeTool(call)))
      results.push(...chunkResults)
    }
    return results
  }

  return { executeTool, processTools }
}
