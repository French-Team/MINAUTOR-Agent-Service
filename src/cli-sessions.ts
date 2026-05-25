import { createInterface } from 'readline/promises'
import { createEngine, type Engine } from './engine.js'
import { listLocalAgents, readLocalAgent } from './agents.js'

import { RESET, CYAN, GREEN, YELLOW, RED, GRAY, BOLD } from './constants.js'

// ── Session helpers ───────────────────────────────────────

export function showSessions(engine: Engine): void {
  const all = engine.listSessions()
  if (all.length === 0) {
    console.log(`${YELLOW}No sessions${RESET}`)
    return
  }
  const current = engine.getCurrentSession()
  console.log(`\n${BOLD}Sessions (${all.length}):${RESET}`)
  for (const s of all) {
    const marker = s.id === current?.id ? ` ${GREEN}◀ active${RESET}` : ''
    const msgCount = s.messages.length
    const shortId = s.id.slice(0, 8)
    console.log(`  ${shortId}  ${s.createdAt.toISOString().slice(0, 19)}  ${msgCount} messages${marker}`)
  }
  console.log()
}

export function showInfo(engine: Engine): void {
  const session = engine.getCurrentSession()
  if (!session) {
    console.log(`${YELLOW}No active session. Type /new to create one.${RESET}`)
    return
  }
  console.log(`${BOLD}Session: ${session.id}${RESET}`)
  console.log(`  ${GRAY}Created: ${session.createdAt.toISOString()}${RESET}`)
  console.log(`  ${GRAY}Messages: ${session.messages.length}${RESET}`)
  console.log(`  ${GRAY}Output: ${session.output ? JSON.stringify(session.output) : '(none)'}${RESET}`)
  console.log(`  ${GRAY}Agent: ${engine.agent.displayName} (${engine.agent.id})${RESET}`)
  if (session.messages.length > 0) {
    console.log(`\n${BOLD}Last messages:${RESET}`)
    const last = session.messages.slice(-5)
    for (const msg of last) {
      const text = msg.content.map(p => (p as { text?: string }).text || '').join('').slice(0, 120)
      const roleLabel = msg.role === 'user' ? `${GREEN}user${RESET}` : msg.role === 'assistant' ? `${CYAN}assistant${RESET}` : `${GRAY}${msg.role}${RESET}`
      console.log(`  ${roleLabel}: ${text}${text.length >= 120 ? '…' : ''}`)
    }
  }
}

export async function handleStartSession(
  rl: ReturnType<typeof createInterface>,
  engine: Engine
): Promise<Engine | null> {
  console.log(`\n${BOLD}${CYAN}┌─ Démarrer une session ───────────────────┐${RESET}`)
  console.log(`${BOLD}${CYAN}│  Ctrl+C pour annuler                         │${RESET}`)
  console.log(`${BOLD}${CYAN}└────────────────────────────────────────────┘${RESET}`)

  const local = listLocalAgents()
  if (local.length === 0) {
    console.log(`\n${YELLOW}Aucun agent local trouvé.${RESET}`)
    console.log(`${YELLOW}Utilisez 1 (Créer un agent) pour en créer un d'abord.${RESET}\n`)
    return null
  }

  console.log(`\n${BOLD}Agents disponibles :${RESET}`)
  for (let i = 0; i < local.length; i++) {
    const a = local[i]
    const active = a.id === engine.agent.id ? ` ${GREEN}◀ actif${RESET}` : ''
    console.log(`  ${CYAN}${i + 1}${RESET}. ${a.name}${active}`)
    console.log(`  ${GRAY}     ID: ${a.id}  |  Fichier: ${a.file}${RESET}`)
  }

  const choice = (await rl.question(`\n${CYAN}Choix${RESET} (numéro ou ID) ${GRAY}>${RESET} `)).trim()
  if (!choice) { console.log(`${YELLOW}Annulé.${RESET}\n`); return null }

  // try by number
  const num = parseInt(choice, 10)
  let match: { id: string; name: string; file: string } | undefined
  if (!isNaN(num) && num >= 1 && num <= local.length) {
    match = local[num - 1]
  } else {
    // match by ID prefix
    match = local.find(a => a.id === choice || a.id.startsWith(choice))
  }

  if (!match) {
    console.log(`${RED}Agent "${choice}" introuvable.${RESET}\n`)
    return null
  }

  const agent = readLocalAgent(match.file)
  if (!agent) {
    console.log(`${RED}Impossible de charger "${match.file}".${RESET}\n`)
    return null
  }

  const newEngine = createEngine({ agent })
  newEngine.createSession()
  console.log(`\n${GREEN}✓ Session démarrée${RESET}`)
  console.log(`  ${BOLD}Agent${RESET}   : ${agent.displayName} ${GRAY}(${agent.id})${RESET}`)
  console.log(`  ${BOLD}Session${RESET} : ${newEngine.getCurrentSession()?.id}${RESET}`)
  console.log(`  ${BOLD}Modèle${RESET}  : ${agent.model}${RESET}`)
  const toolList = agent.toolNames.join(', ')
  console.log(`  ${BOLD}Outils${RESET}  : ${toolList}${RESET}`)
  console.log(`\n${YELLOW}Vous pouvez maintenant envoyer des prompts !${RESET}`)
  console.log(`  Tapez !cmd pour exécuter une commande, @msg pour un message, /help pour l'aide.\n`)

  return newEngine
}
