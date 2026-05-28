/**
 * Spawn runner — exécute un agent en sous-processus.
 * Appelé par le CLI via child_process.fork().
 *
 * Usage : node dist/spawn-agent.js <agent-id> <instruction>
 */

import { existsSync, appendFileSync, mkdirSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { exec } from 'child_process'
import { safeExit } from './constants.js'
import { createEngine } from './engine.js'
import { readLocalAgent } from './agents.js'
import { resolveProviderForModel } from './providers.js'
import { pushNotification } from './notify.js'
import { parseToolCalls, fallbackParseToolCalls } from './engine-parser.js'
import { createToolExecutor } from './engine-executor.js'

const [, , agentId, ...rest] = process.argv
const instruction = rest.join(' ')

if (!agentId || !instruction) {
  console.error('Usage: spawn-agent <agent-id> "<instruction>"')
  process.exit(1)
}

const agentsDir = join(process.cwd(), '.agents')
const logbookPath = join(process.cwd(), 'telecom', 'agent-logbook.md')

// ── État partagé pour les handlers de signaux ──
// Permet d'écrire un fichier d'erreur même en cas de kill externe (SIGTERM/SIGINT).
// Sur Windows, le kill est intercepté par le daemon qui écrit l'erreur avant child.kill().
let _killState: {
  agentId: string
  instruction: string
  agentDisplayName?: string
  provider?: string
  model?: string
  workspaceDir: string
} | null = null

let _killed = false

function handleKillSignal(signal: string): void {
  if (_killed) return // déjà traité (évite double-écriture SIGTERM + SIGINT)
  _killed = true

  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ')

  if (_killState) {
    const errorEntry = [
      `\n## ${_killState.agentDisplayName || _killState.agentId} (${_killState.agentId})\n`,
      `**Interrompu :** Signal ${signal} reçu — processus tué`,
    ].join('\n')
    appendFileSync(logbookPath, errorEntry, 'utf-8')

    const safeTimestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const erreurPath = join(_killState.workspaceDir, `erreur-${safeTimestamp}.md`)
    try {
      writeFileSync(erreurPath, [
        `# Erreur — ${_killState.agentDisplayName || _killState.agentId} (${_killState.agentId})`,
        `**Date :** ${ts}`,
        `**Provider :** ${_killState.provider || 'N/A'} / ${_killState.model || 'N/A'}`,
        '',
        `**Erreur :** Processus interrompu par signal ${signal}`,
        signal === 'SIGTERM'
          ? '**Cause probable :** Timeout du daemon (5 min) ou arrêt du CLI parent'
          : '**Cause probable :** Interruption utilisateur (Ctrl+C)',
        `**Instruction :** ${_killState.instruction}`,
      ].join('\n'), 'utf-8')
    } catch { /* dossier peut ne pas exister si kill pendant init */ }

    // Notification qui survit au processus tué (écrite dans notifications.json)
    pushNotification(
      _killState.agentDisplayName || _killState.agentId,
      `❌ Processus interrompu par ${signal}`,
      'avertissement',
    )
  }

  // Appel synchrone obligatoire : un handler SIGTERM remplace le comportement
  // par défaut (exit). Sans safeExit(), le processus CONTINUE après le handler,
  // le LLM call termine, et le livrable final écrase le fichier d'erreur.
  safeExit(1)
}

process.on('SIGTERM', () => handleKillSignal('SIGTERM'))
process.on('SIGINT', () => handleKillSignal('SIGINT'))

/** Exécute une commande shell et retourne stdout+stderr */
function runTerminalCommand(command: string, _processType?: 'SYNC' | 'BACKGROUND', timeoutSeconds?: number): Promise<string> {
  return new Promise((resolve) => {
    const child = exec(command, {
      cwd: process.cwd(),
      timeout: (timeoutSeconds || 30) * 1000,
      maxBuffer: 10 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        resolve(stderr || stdout || `Erreur: ${error.message}`)
      } else {
        resolve(stdout || '(sortie vide)')
      }
    })
  })
}

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

  // Partager l'état pour les handlers de signaux
  _killState = {
    agentId,
    instruction,
    agentDisplayName: agentDef.displayName,
    workspaceDir,
  }
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

  // Enrichir l'état avec les infos provider
  if (_killState) {
    _killState.provider = resolved.provider
    _killState.model = resolved.model
  }

  const systemPrompt = agentDef.instructionsPrompt || 'You are a helpful assistant.'

  // ── Tool executor pour le tool loop ──
  const toolExecutor = createToolExecutor(
    runTerminalCommand,
    (role: 'user' | 'assistant', content: string) => { engine.addMessage(role, content) },
    (_output: Record<string, unknown>) => { /* set_output: silencieux en spawn */ },
    agentDef.toolConfig,
  )

  try {
    let finalResponse = await engine.callLLM(enrichedInstruction, resolved, systemPrompt)
    engine.addMessage('assistant', finalResponse)

    // ── Tool Loop : exécuter les outils, boucler jusqu'à max 10 tours ──
    let toolCalls = parseToolCalls(finalResponse)

    // ── Fallback : si aucun outil détecté, analyse du texte narratif ──
    // Utile pour les petits modèles locaux (LM Studio, Ollama) qui répondent
    // en texte narratif au lieu de produire des appels d'outils structurés.
    // On saute la relance LLM (elle produit des copies d'exemples) et on va
    // directement à l'analyse par mots-clés du texte original.
    let fallbackUsed = false
    if (toolCalls.length === 0) {
      console.log('[Fallback] Aucun outil détecté au format structuré — analyse du texte narratif')
      toolCalls = fallbackParseToolCalls(finalResponse)
      if (toolCalls.length > 0) {
        fallbackUsed = true
        console.log(`[Fallback] ✓ ${toolCalls.length} outil(s) extraits par analyse de texte`)
        pushNotification(agentDef.displayName || agentDef.id, `🔄 [Fallback texte] ${toolCalls.length} outil(s) détectés`, 'info')
      } else {
        console.log('[Fallback] Aucun outil détecté dans le texte — traitement terminé')
      }
    }
    let loopCount = 0
    const maxLoops = 10

    while (toolCalls.length > 0 && loopCount < maxLoops) {
      loopCount++

      const toolNames = toolCalls.map(t => `${t.toolName}(${JSON.stringify(t.input).slice(0, 60)})`).join('\n')
      console.log(`[Tool Loop ${loopCount}/${maxLoops}] ${toolCalls.length} outil(s):`)
      toolCalls.forEach((t, i) => console.log(`  ${i+1}. ${t.toolName}: ${JSON.stringify(t.input).slice(0, 80)}`))
      pushNotification(
        agentDef.displayName || agentDef.id,
        `🔄 [${loopCount}/${maxLoops}] ${toolCalls.length} outil(s): ${toolCalls.map(t => t.toolName === 'run_terminal_command' ? t.input.command?.toString().slice(0,40) : t.toolName).join(', ')}`,
        'info',
      )

      // Notifier outil par outil avant exécution
      for (const tc of toolCalls) {
        const cmdLabel = tc.toolName === 'run_terminal_command'
          ? (tc.input.command?.toString().slice(0, 60) ?? '')
          : tc.toolName
        pushNotification(agentDef.displayName || agentDef.id, `  ▶ ${cmdLabel}`, 'info')
      }

      const results = await toolExecutor.processTools(toolCalls)

      // Construire le suivi avec les résultats
      const toolResultsText = results.map((r, i) =>
        `- Outil: ${toolCalls[i].toolName}\n  Entrée: ${JSON.stringify(toolCalls[i].input).slice(0, 200)}\n  Résultat: ${r.slice(0, 3000)}`
      ).join('\n\n')

      // Personnaliser le followUp selon si le fallback a été utilisé
      const followUpHeader = fallbackUsed
        ? `Tu as d\'abord répondu en texte. J\'ai converti les actions décrites en appels d\'outils et voici les résultats. Continue ton travail en utilisant les outils si nécessaire.`
        : `Continue sur la base des résultats ci-dessus.`

      const followUp = `${followUpHeader}\n\n### RÉSULTATS DES OUTILS :\n${toolResultsText}`

      finalResponse = await engine.callLLM(followUp, resolved, systemPrompt)
      engine.addMessage('assistant', finalResponse)
      toolCalls = parseToolCalls(finalResponse)
    }

    if (loopCount >= maxLoops && toolCalls.length > 0) {
      console.warn(`[Tool Loop] Limite atteinte (${maxLoops} boucles) — dernier tour ignoré`)
      pushNotification(agentDef.displayName || agentDef.id, `⚠ Limite tool loop atteinte (${maxLoops})`, 'avertissement')
    }

    // ── Finalisation ──
    const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ')
    const entry = [
      `\n## ${(agentDef.displayName || agentDef.id)} (${agentDef.id})\n`,
      `**Date :** ${timestamp}`,
      `**Instruction :** ${instruction}`,
      `**Provider :** ${resolved.provider} / ${resolved.model}`,
      `**Tool loops :** ${loopCount}`,
      `**Réponse :**\n${finalResponse}\n`,
    ].join('\n')

    appendFileSync(logbookPath, entry, 'utf-8')
    console.log(`\n${'='.repeat(50)}`)
    console.log(finalResponse)
    console.log(`${'='.repeat(50)}`)

    // Notification de conclusion
    const statusLine = finalResponse.split('\n').find(l => l.trim().length > 0) || finalResponse.slice(0, 120)
    pushNotification(agentDef.displayName || agentDef.id, `✅ ${statusLine.slice(0, 200)}`, 'conclusion')

    // Sauvegarder le livrable
    const safeTimestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const livrablePath = join(workspaceDir, `livrable-${safeTimestamp}.md`)
    writeFileSync(livrablePath, [
      `# Livrable — ${(agentDef.displayName || agentDef.id)} (${agentDef.id})`,
      `**Date :** ${timestamp}`,
      `**Provider :** ${resolved.provider} / ${resolved.model}`,
      `**Tool loops :** ${loopCount}`,
      '',
      finalResponse,
    ].join('\n'), 'utf-8')
  } catch (err) {
    const msg = (err as Error).message
    const errorEntry = `\n## ${(agentDef.displayName || agentDef.id)} (${agentDef.id})\n\n**Erreur :** ${msg.slice(0, 200)}\n\n`
    appendFileSync(logbookPath, errorEntry, 'utf-8')

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
