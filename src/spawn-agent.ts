/**
 * Spawn runner — exécute un agent en sous-processus.
 * Appelé par le CLI via child_process.fork().
 *
 * Usage : node dist/spawn-agent.js <agent-id> <instruction>
 */

import { existsSync, appendFileSync, mkdirSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { safeExit } from './constants.js'
import { createEngine } from './engine.js'
import { readLocalAgent } from './agents.js'
import { resolveProviderForModel } from './providers.js'
import { pushNotification } from './notify.js'

const [, , agentId, ...rest] = process.argv
const instruction = rest.join(' ')

if (!agentId || !instruction) {
  console.error('Usage: spawn-agent <agent-id> "<instruction>"')
  process.exit(1)
}

const agentsDir = join(process.cwd(), '.agents')
const logbookPath = join(process.cwd(), 'telecom', 'agent-logbook.md')

// ensure logbook exists
if (!existsSync(logbookPath)) {
  appendFileSync(logbookPath, '# Agent Logbook\n\n', 'utf-8')
}

async function main() {
  // find agent file
  const files = [ `${agentId}.ts`, `${agentId}.json` ]
  let agentFile: string | undefined
  for (const f of files) {
    if (existsSync(join(agentsDir, f))) { agentFile = f; break }
  }
  if (!agentFile) {
    // try listing agents
    const { listLocalAgents } = await import('./agents.js')
    const agents = listLocalAgents()
    const match = agents.find(a => a.id === agentId || a.id.startsWith(agentId))
    if (!match) {
      console.error(`Agent "${agentId}" introuvable.`)
      safeExit(1); return
    }
    agentFile = match.file
  }

  const agentDef = readLocalAgent(agentFile)
  if (!agentDef) {
    console.error(`Impossible de charger "${agentFile}".`)
    safeExit(1); return
  }

  // ── Initialisation du workspace ────────────────────────
  const workspaceDir = join(process.cwd(), 'telecom', 'agents', agentId)
  const papiersDir = join(process.cwd(), 'telecom', 'papiers', agentId)
  const memoireDir = join(process.cwd(), 'telecom', 'memoire-vive', agentId)

  for (const dir of [workspaceDir, papiersDir, memoireDir]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }

  // Lister les fichiers existants
  const existingFiles = readdirSync(workspaceDir).filter(f => f !== '.gitkeep' && f !== '.gitignore')
  const papiersFiles = readdirSync(papiersDir).filter(f => f !== '.gitkeep' && f !== '.gitignore')
  const memoireFiles = readdirSync(memoireDir).filter(f => f !== '.gitkeep' && f !== '.gitignore')

  // Enrichir l'instruction avec le contexte du workspace
  const parts = [
    '',
    '## Ton environnement de travail',
    `- Dossier personnel : telecom/agents/${agentId}/ (scripts, logs, livrables)`,
    `- Dossier papiers : telecom/papiers/${agentId}/ (données persistantes, archives)`,
    `- Mémoire vive : telecom/memoire-vive/${agentId}/ (fichiers temporaires, nettoyés après 1h)`,
  ]

  if (existingFiles.length > 0) {
    parts.push(`- Fichiers dans ton dossier de travail : ${existingFiles.join(', ')}`)
  }
  if (papiersFiles.length > 0) {
    parts.push(`- Archives persistantes disponibles : ${papiersFiles.join(', ')}`)
  }
  if (memoireFiles.length > 0) {
    parts.push(`- Fichiers temporaires en mémoire vive : ${memoireFiles.join(', ')}`)
  }

  parts.push('')
  parts.push('Tu peux y lire et écrire des fichiers avec run_terminal_command. Consulte d\'abord les fichiers existants avant de créer quoi que ce soit.')

  const workspaceContext = '\n' + parts.join('\n')

  const enrichedInstruction = instruction + workspaceContext

  const engine = createEngine({ agent: agentDef })
  engine.createSession()
  engine.addMessage('user', enrichedInstruction)

  const resolved = resolveProviderForModel(agentDef.model, agentDef.provider)
  if (!resolved) {
    appendFileSync(logbookPath, `\n## ${(agentDef.displayName || agentDef.id)} (${agentDef.id})\n\n**Erreur :** Aucun provider configuré pour le modèle ${agentDef.model}\n\n`, 'utf-8')
    safeExit(0); return
  }

  const systemPrompt = agentDef.instructionsPrompt || 'You are a helpful assistant.'
  try {
    const response = await engine.callLLM(enrichedInstruction, resolved, systemPrompt)
    engine.addMessage('assistant', response)

    const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ')
    const entry = [
      `\n## ${(agentDef.displayName || agentDef.id)} (${agentDef.id})\n`,
      `**Date :** ${timestamp}`,
      `**Instruction :** ${instruction}`,
      `**Provider :** ${resolved.provider} / ${resolved.model}`,
      `**Réponse :**\n${response}\n`,
    ].join('\n')

    appendFileSync(logbookPath, entry, 'utf-8')
    console.log(response)

    // Notification de conclusion avec un bref résumé du résultat
    // Le niveau 'conclusion' (📊) signale visuellement que l'agent a terminé son travail
    const statusLine = response.split('\n').find(l => l.trim().length > 0) || response.slice(0, 120)
    pushNotification(agentDef.displayName || agentDef.id, `✅ ${statusLine.slice(0, 200)}`, 'conclusion')

    // Sauvegarder le livrable dans le workspace de l'agent
    const safeTimestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const livrablePath = join(workspaceDir, `livrable-${safeTimestamp}.md`)
    writeFileSync(livrablePath, [
      `# Livrable — ${(agentDef.displayName || agentDef.id)} (${agentDef.id})`,
      `**Date :** ${timestamp}`,
      `**Provider :** ${resolved.provider} / ${resolved.model}`,
      '',
      response,
    ].join('\n'), 'utf-8')
  } catch (err) {
    const msg = (err as Error).message
    const errorEntry = `\n## ${(agentDef.displayName || agentDef.id)} (${agentDef.id})\n\n**Erreur :** ${msg.slice(0, 200)}\n\n`
    appendFileSync(logbookPath, errorEntry, 'utf-8')

    // Sauvegarder l'erreur dans le workspace de l'agent
    const safeTimestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const errorDate = new Date().toISOString().slice(0, 19).replace('T', ' ')
    const erreurPath = join(workspaceDir, `erreur-${safeTimestamp}.md`)
    writeFileSync(erreurPath, [
      `# Erreur — ${(agentDef.displayName || agentDef.id)} (${agentDef.id})`,
      `**Date :** ${errorDate}`,
      `**Provider :** ${resolved.provider} / ${resolved.model}`,
      '',
      `**Erreur :** ${msg}`,
      `**Instruction :** ${instruction}`,
    ].join('\n'), 'utf-8')

    console.error(`Erreur: ${msg}`)
    pushNotification(agentDef.displayName || agentDef.id, `❌ ${msg.slice(0, 200)}`, 'avertissement')
  }

  safeExit(0)
}

main().catch(err => {
  console.error(err.message)
  safeExit(1)
})
