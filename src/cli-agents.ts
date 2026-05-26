import type { Engine } from './engine.js'
import { createEngine } from './engine.js'
import { listLocalAgents, readLocalAgent } from './agents.js'
import {
  RESET, CYAN, GREEN, YELLOW, RED, GRAY, BOLD,
} from './constants.js'

export function handleListAgents(engine: Engine): void {
  const local = listLocalAgents()

  console.log(`\n${BOLD}Agent actif :${RESET}`)
  console.log(`  ${GREEN}◀${RESET} ${engine.agent.displayName} ${GRAY}(${engine.agent.id})${RESET}`)

  if (local.length === 0) {
    console.log(`\n${YELLOW}Aucun agent local trouvé. Utilisez /create pour en créer un.${RESET}\n`)
    return
  }

  console.log(`\n${BOLD}Agents locaux (.agents/) :${RESET}`)
  for (const a of local) {
    const active = a.id === engine.agent.id ? ` ${GREEN}◀ actif${RESET}` : ''
    console.log(`  ${CYAN}${a.id}${RESET}  ${a.name}${active}`)
    console.log(`  ${GRAY}   └─ ${a.file}${RESET}`)
  }
  console.log(`\n${YELLOW}Utilisez /use <id> pour charger un agent.${RESET}\n`)
}

export function handleUseAgent(args: string[], _currentEngine: Engine): Engine | null {
  const name = args[0]
  if (!name) {
    console.log(`${YELLOW}Usage: /use <agent-id>${RESET}`)
    return null
  }
  const local = listLocalAgents()
  const match = local.find(a => a.id === name || a.file === name || a.id.startsWith(name))
  if (!match) {
    console.log(`${RED}Agent "${name}" introuvable. Utilisez /agents pour lister les agents disponibles.${RESET}`)
    return null
  }
  const agent = readLocalAgent(match.file)
  if (!agent) {
    console.log(`${RED}Impossible de charger "${match.file}".${RESET}`)
    return null
  }
  const newEngine = createEngine({ agent })
  newEngine.createSession()
  console.log(`${GREEN}Agent chargé : ${agent.displayName} ${GRAY}(${agent.id})${RESET}`)
  return newEngine
}
