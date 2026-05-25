import { readFileSync, existsSync } from 'fs'
import { exit } from 'process'
import { join } from 'path'
import { RESET, RED } from './constants.js'
import type { AgentDefinition } from './types/agent-definition.js'

export const DEFAULT_AGENT: AgentDefinition = {
  id: 'alice',
  displayName: 'Alice',
  model: 'kilo-auto/free',
  instructionsPrompt: `Tu es Alice, l'assistante personnelle de l'utilisateur.\nAccueille-le chaleureusement et propose-lui de l'aider.\nTu peux exécuter des commandes shell avec !cmd, gérer des sessions, des agents et des providers.\nGuide-le vers le menu principal ou réponds à ses questions simplement.`,
  toolNames: ['run_terminal_command', 'add_message', 'set_output', 'skill'],
}

export function loadAgentFromFile(filePath: string): AgentDefinition {
  const resolved = join(process.cwd(), filePath)
  if (!existsSync(resolved)) {
    console.error(`${RED}File not found: ${resolved}${RESET}`)
    exit(1)
  }
  const content = readFileSync(resolved, 'utf-8')
  try {
    return JSON.parse(content) as AgentDefinition
  } catch {
    console.error(`${RED}Invalid agent file — expected JSON${RESET}`)
    exit(1)
  }
}

export function getAgent(args: string[]): AgentDefinition {
  const loadIndex = args.indexOf('--agent')
  if (loadIndex !== -1 && args[loadIndex + 1]) {
    return loadAgentFromFile(args[loadIndex + 1])
  }
  const loadShortIndex = args.indexOf('-a')
  if (loadShortIndex !== -1 && args[loadShortIndex + 1]) {
    return loadAgentFromFile(args[loadShortIndex + 1])
  }
  return DEFAULT_AGENT
}
