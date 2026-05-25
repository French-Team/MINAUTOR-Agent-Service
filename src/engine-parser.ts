import type { ToolCall } from './types/agent-definition.js'

export function parseToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = []

  // Pattern 1: !command (Legacy manual format)
  const manualLines = text.split('\n')
  for (const line of manualLines) {
    if (line.trim().startsWith('!')) {
      calls.push({
        toolName: 'run_terminal_command',
        input: { command: line.trim().slice(1).trim() }
      })
    }
  }

  // Pattern 2: JSON-like tool calls (if any)
  // Looking for blocks like: ```json { "tool": "...", "input": { ... } } ```
  const jsonBlocks = text.match(/```json\s*(\{[\s\S]*?\})\s*```/g)
  if (jsonBlocks) {
    for (const block of jsonBlocks) {
      try {
        const jsonStr = block.match(/```json\s*(\{[\s\S]*?\})\s*```/)?.[1]
        if (jsonStr) {
          const data = JSON.parse(jsonStr)
          if (data.tool && data.input) {
            calls.push({ toolName: data.tool, input: data.input })
          }
        }
      } catch { /* ignore invalid JSON */ }
    }
  }

  return calls
}
