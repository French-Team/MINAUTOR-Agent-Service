import { createInterface } from 'readline/promises'
import { stdin, stdout, exit } from 'process'
import { readFileSync, existsSync, unlinkSync, readdirSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fork, execSync, ChildProcess } from 'child_process'

const backgroundAgents = new Map<string, ChildProcess>()
import { loadSkill } from './skills.js'
import { popAllNotifications, setNotificationFilter, getNotificationFilter, levelIcon, listLevels, countPendingNotifications, loadNotificationHistory, cleanNotificationArchive, removeNotification, type NotificationLevel, type Notification } from './notify.js'
import { showSuggestionMenu, getSuggestionPrefs, clearSuggestions, hasSuggestions } from './cli-suggestions.js'
import { emitKeypressEvents } from 'readline'
import { createEngine, type Engine } from './engine.js'
import { listLocalAgents, readLocalAgent, scaffoldAgent } from './agents.js'
import { resolveProviderForModel } from './providers.js'

let cancelled = false

// ESC key → cancel current operation
if (stdin.isTTY) {
  emitKeypressEvents(stdin)
  stdin.setRawMode(true)
  stdin.on('keypress', (_str: string, key: { name: string }) => {
    if (key && key.name === 'escape') {
      cancelled = true
      stdout.write('\n')
    }
  })
}

import {
  RESET, CYAN, GREEN, YELLOW, RED, GRAY, BOLD,
} from './constants.js'

import { showSessions, showInfo, handleStartSession } from './cli-sessions.js'
import { handleManageProvidersMenu } from './cli-providers.js'
import { handleCreate } from './cli-create.js'
import { handleEditAgent } from './cli-edit.js'
import { handleProviders } from './cli-providers-advanced.js'
import { handleListAgents, handleUseAgent } from './cli-agents.js'
import { handleSkillsMenu, showSkillsList } from './cli-skills.js'
import { showMenu, showHelp, handleTestSubmenu, handleSuggestionsMenu } from './cli-menu.js'
import { showBanner } from './cli-banner.js'
import { loadUserProfile, getDisplayName, editUserProfile } from './cli-user.js'
import { logSkillLoaded, logDaemonStarted, logWelcomeMessage } from './cli-startup.js'
import { validateRulesAtStartup } from './validate-rules.js'
import { DEFAULT_AGENT, getAgent, loadAgentFromFile } from './cli-utils.js'
import { handleCommandPicker } from './cli-selector.js'
import { handleShellLine } from './cli-runner.js'
import { tryRouteIntercom, getCurrentProject } from './cli-intercom-router.js'
import { matchAndExecute } from './script-runner.js'

import { getFeuRougeClient, resetFeuRougeClient } from './feurouge/feurouge-client.js'
import { handlePermissionsCommand } from './feurouge/permissions-cli.js'
import { getPermissionsConfig, listRegistrations } from './feurouge/permissions.js'
import { dispatchProjectCommand, handleProjectMenu } from './project/workspace-cli.js'
import { ensureSandbox } from './project/sandbox.js'
import { triggerParades, writeLastContext, readLastContext, clearLastContext } from './parades.js'

let currentEngine: Engine | null = null
let telecomDaemon: ChildProcess | null = null

function startTelecomDaemon(): void {
  const daemonPath = join(import.meta.dirname, 'telecom', 'service', 'telecom-daemon.js')
  if (existsSync(daemonPath)) {
    telecomDaemon = fork(daemonPath, [], { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] })
    backgroundAgents.set('telecom-daemon', telecomDaemon)

    // Affichage temps réel des notifications via IPC (process.stdout.write évite
    // le conflit avec readline). La notification est supprimée du fichier pour
    // éviter le double affichage par popAllNotifications() au prochain tour.
    // Debounce pour showSuggestionMenuRaw : éviter la cascade de popups
    // quand le daemon envoie plusieurs notifications à la suite.
    // On ne montre le menu que pour les notifications 'conclusion' (action terminée),
    // et au maximum une fois toutes les 5 secondes.
    let lastSuggestionMenuTime = 0
    const SUGGESTION_DEBOUNCE_MS = 5000

    telecomDaemon.on('message', (data: Notification) => {
      if (data && data.id && data.message && data.level && data.from) {
        const icon = levelIcon(data.level)
        process.stdout.write(`\n${icon} ${BOLD}${data.from}${RESET}\n`)
        const lines = data.message.split('\n')
        process.stdout.write(`  ${lines[0]}\n`)
        for (let i = 1; i < Math.min(lines.length, 5); i++) {
          process.stdout.write(`  ${lines[i]}\n`)
        }
        if (lines.length > 5) process.stdout.write(`  ${GRAY}...${RESET}\n`)
        process.stdout.write('\n')
        removeNotification(data.id)

        // Afficher le menu interactif UNIQUEMENT pour les notifications
        // de type 'conclusion' (action terminée), et pas plus d'une fois
        // toutes les 5 secondes. Les notifications 'info' (routage,
        // progression) ne déclenchent PAS le menu pour éviter la cascade.
        const now = Date.now()
        if (data.level === 'conclusion' && now - lastSuggestionMenuTime > SUGGESTION_DEBOUNCE_MS) {
          lastSuggestionMenuTime = now

          // Lire le contexte sauvegardé par l'action qui a déclenché le daemon
          // (writeLastContext a été appelé au moment du routage ou de la réponse LLM).
          // Ce contexte contient l'action, la demande, et éventuellement la réponse LLM.
          const lastContext = readLastContext()
          if (lastContext) {
            triggerParades(lastContext, handleSuggestionCommand)
            clearLastContext()
          } else {
            // Fallback si aucun contexte n'est disponible
            triggerParades({ action: 'route' }, handleSuggestionCommand)
          }

          // Le menu interactif est géré par le polling dans triggerParades.
          // Il apparaîtra automatiquement quand les parades seront générées.
        }
      }
    })

    telecomDaemon.on('exit', (_code) => {
      backgroundAgents.delete('telecom-daemon')
      telecomDaemon = null
    })
    logDaemonStarted()
  } else {
    console.log(`${YELLOW}⚠ Daemon telecom introuvable (compile d'abord)${RESET}`)
  }
}

/**
 * Affiche les messages intercom avec filtrage par subject.
 * Section dédiée [402] — permet de parcourir les messages sans polluer
 * le flux temps réel.
 *
 * @param filterSubject - Filtre optionnel par subject (ex: 'project-request')
 */
function showIntercomMessages(filterSubject?: string): void {
  const intercomDir = join(process.cwd(), 'telecom', 'intercom')

  if (!existsSync(intercomDir)) {
    console.log(`\n${YELLOW}Aucun dossier intercom.${RESET}\n`)
    return
  }

  const files = readdirSync(intercomDir).filter(f => f.endsWith('.json')).sort()
  if (files.length === 0) {
    console.log(`\n${GRAY}Aucun message intercom.${RESET}\n`)
    return
  }

  // Parser tous les messages
  const messages: Array<{
    file: string
    status: string
    from: string
    to: string
    subject: string
    type: string
    demande: string
    timestamp: string
  }> = []

  for (const f of files) {
    try {
      const content = readFileSync(join(intercomDir, f), 'utf-8')
      const msg = JSON.parse(content) as {
        status: string
        from: string
        to: string
        subject: string
        type: string
        payload?: Record<string, string>
        timestamp: string
      }
      messages.push({
        file: f,
        status: msg.status ?? 'unknown',
        from: msg.from,
        to: msg.to,
        subject: msg.subject,
        type: msg.type ?? 'request',
        demande: msg.payload?.demande ?? '',
        timestamp: msg.timestamp,
      })
    } catch { /* skip malformed */ }
  }

  if (messages.length === 0) {
    console.log(`\n${GRAY}Aucun message valide.${RESET}\n`)
    return
  }

  // Statistiques (calculées avant filtrage pour avoir la vue d'ensemble)
  const subjects = new Map<string, number>()
  let pending = 0
  let read = 0
  let processed = 0
  for (const m of messages) {
    subjects.set(m.subject, (subjects.get(m.subject) ?? 0) + 1)
    if (m.status === 'pending') pending++
    else if (m.status === 'read') read++
    else if (m.status === 'processed') processed++
  }
  const sortedSubjects = [...subjects.entries()].sort((a, b) => b[1] - a[1])

  // Cas spécial : lister les subjects disponibles
  if (filterSubject === '__subjects__') {
    console.log(`\n${BOLD}${CYAN}Subjects disponibles :${RESET}`)
    for (const [subj, count] of sortedSubjects) {
      console.log(`  ${CYAN}${subj}${RESET}  ${GRAY}(${count} message(s))${RESET}`)
    }
    console.log()
    return
  }

  // Appliquer le filtre par subject si spécifié
  const filtered = filterSubject
    ? messages.filter(m => m.subject === filterSubject)
    : messages

  if (filtered.length === 0) {
    console.log(`\n${YELLOW}Aucun message pour le subject "${filterSubject}".${RESET}\n`)
    return
  }

  const filtreLabel = filterSubject
    ? `${YELLOW} (filtre: ${filterSubject})${RESET}`
    : ''

  console.log(`\n${BOLD}${CYAN}┌─ Messages intercom${filtreLabel}${RESET}`)
  console.log(`${BOLD}${CYAN}║${RESET}`)
  console.log(`${BOLD}${CYAN}║  ${RESET}Total: ${GREEN}${messages.length}${RESET}  En attente: ${pending > 0 ? `${YELLOW}${pending}${RESET}` : `${GRAY}0${RESET}`}  Lus: ${read}  Traités: ${processed}`)

  // Répartition par subject
  console.log(`${BOLD}${CYAN}║  ${GRAY}Répartition par subject :${RESET}`)
  for (const [subj, count] of sortedSubjects) {
    const highlight = filterSubject && subj === filterSubject ? `${GREEN}◉${RESET}` : `${GRAY}·${RESET}`
    console.log(`${BOLD}${CYAN}║  ${RESET}  ${highlight} ${subj.padEnd(25)} ${count}`)
  }
  console.log(`${BOLD}${CYAN}║${RESET}`)

  if (filtered.length > 20) {
    console.log(`${BOLD}${CYAN}║${RESET}  ${GRAY}Affichage des 20 plus récents (${filtered.length} total)${RESET}`)
  }

  // Afficher les messages (max 20)
  const display = filtered.slice(-20).reverse()
  for (const m of display) {
    const statusIcon = m.status === 'pending' ? '⏳' : m.status === 'read' ? '📖' : '✅'
    const time = m.timestamp.slice(11, 19)
    const preview = m.demande.slice(0, 80)
    const label = preview ? ` «${preview}»` : ''
    console.log(`${BOLD}${CYAN}║  ${RESET}${statusIcon} ${GRAY}${time}${RESET} ${m.from}→${m.to} ${CYAN}[${m.subject}]${RESET}${label}`)
  }

  console.log(`${BOLD}${CYAN}║${RESET}`)
  console.log(`${BOLD}${CYAN}║  ${GRAY}Filtrage : ${RESET}`)
  console.log(`${BOLD}${CYAN}║  ${RESET}  ${CYAN}402 <subject>${RESET} — Filtrer par subject (ex: 402 project-request)`)
  console.log(`${BOLD}${CYAN}║  ${RESET}  ${CYAN}402 /subjects${RESET} — Liste des subjects disponibles`)
  console.log(`${BOLD}${CYAN}╚${RESET}\n`)
}

/**
 * Exécute le script d'analyse des patterns avec les arguments donnés.
 * Affiche la sortie du script directement dans le CLI.
 */
function runAnalyzePatterns(args: string[] = []): void {
  const scriptPath = join(process.cwd(), 'scripts', 'telecom', 'analyze-patterns.js')
  if (!existsSync(scriptPath)) {
    console.log(`\n${YELLOW}Script d'analyse introuvable : ${scriptPath}${RESET}\n`)
    return
  }

  try {
    const output = execSync(`node "${scriptPath}" ${args.join(' ')}`, {
      cwd: process.cwd(),
      encoding: 'utf-8',
      timeout: 15000,
      env: { ...process.env },
    })
    process.stdout.write(output)
  } catch (err) {
    const msg = (err as Error).message
    console.log(`${RED}Erreur analyse : ${msg.slice(0, 200)}${RESET}\n`)
  }
}

/**
 * Exécute un script de parade (explore, deploy, doc, git, profiles).
 * Les scripts acceptent des paramètres passés via SCRIPT_PARAM_* dans l'environnement.
 */
function runParadesScript(scriptName: string, args: string[]): void {
  const scriptPath = join(process.cwd(), 'scripts', 'parades', `${scriptName}.js`)
  if (!existsSync(scriptPath)) {
    process.stdout.write(`\n${YELLOW}Script ${scriptName} introuvable — vérifie scripts/parades/${scriptName}.js${RESET}\n\n`)
    return
  }
  try {
    const output = execSync(`node "${scriptPath}" ${args.join(' ')}`, {
      cwd: process.cwd(),
      encoding: 'utf-8',
      timeout: 15000,
      env: { ...process.env },
    })
    process.stdout.write(output)
  } catch (err) {
    const msg = (err as Error).message
    process.stdout.write(`\n${RED}Erreur ${scriptName} : ${msg.slice(0, 300)}${RESET}\n\n`)
  }
}

/**
 * Dispatch la commande choisie par l'utilisateur depuis le menu interactif
 * des suggestions (showSuggestionMenuRaw). Appelé par le callback onCommand
 * de triggerParades() quand le polling détecte les parades générées.
 */
function handleSuggestionCommand(cmd: string): void {
  if (cmd === null) return
  try {
    if (cmd.startsWith('!explore')) {
      const rest = cmd.slice(9).trim()
      if (rest) {
        runParadesScript('explore', [rest])
      } else {
        process.stdout.write(`\n${YELLOW}Usage: !explore <projet> [--path <dossier>]${RESET}\n\n`)
      }
    } else if (cmd.startsWith('!deploy')) {
      const rest = cmd.slice(8).trim()
      if (rest) {
        runParadesScript('deploy', rest.split(/\s+/))
      } else {
        process.stdout.write(`\n${YELLOW}Usage: !deploy <projet> [--dry-run]${RESET}\n\n`)
      }
    } else if (cmd.startsWith('!git')) {
      const rest = cmd.slice(5).trim()
      if (rest) {
        runParadesScript('git', rest.split(/\s+/))
      } else {
        process.stdout.write(`\n${YELLOW}Usage: !git <action> <projet>${RESET}\n\n`)
      }
    } else if (cmd.startsWith('!profiles')) {
      const rest = cmd.slice(10).trim()
      if (rest) {
        runParadesScript('profiles', rest.split(/\s+/))
      } else {
        runParadesScript('profiles', ['list'])
      }
    } else if (cmd.startsWith('!doc')) {
      const rest = cmd.slice(5).trim()
      if (rest) {
        runParadesScript('doc', rest.split(/\s+/))
      } else {
        process.stdout.write(`\n${YELLOW}Usage: !doc <action> <type> [projet]${RESET}\n\n`)
      }
    } else if (cmd.startsWith('!project')) {
      dispatchProjectCommand(cmd.slice(9).trim())
    } else if (cmd.startsWith('!tasks')) {
      dispatchProjectCommand(`tasks ${cmd.slice(7).trim()}`)
    } else if (cmd.startsWith('!agents') || cmd.startsWith('!agentes')) {
      handleListAgents(currentEngine!)
    } else if (cmd.startsWith('/help') || cmd.startsWith('aide')) {
      showHelp(currentEngine!)
    } else if (cmd.startsWith('/menu')) {
      showMenu(currentEngine!)
    } else if (cmd.startsWith('/skills')) {
      showSkillsList()
    } else if (cmd.startsWith('/status') || cmd.startsWith('/state')) {
      showIntercomStatus()
    } else if (cmd.startsWith('/notifications')) {
      const pending = popAllNotifications()
      for (const n of pending) {
        if (n.level === 'conclusion' || n.level === 'urgent' || n.level === 'avertissement') {
          const icon = levelIcon(n.level)
          process.stdout.write(`\n${icon} ${n.from}\n`)
          process.stdout.write(`  ${n.message.split('\n')[0]}\n\n`)
        }
      }
      if (pending.length === 0) {
        process.stdout.write(`\n${GRAY}Aucune notification en attente.${RESET}\n\n`)
      }
    } else if (cmd.startsWith('!') || cmd.startsWith('/')) {
      // Autres commandes CLI non gérées — informer l'utilisateur
      process.stdout.write(`\n${YELLOW}→ Tape "${cmd}" au prompt pour exécuter cette commande.${RESET}\n\n`)
    } else {
      // Commandes shell (cat, node, ls, etc.) — exécuter en direct
      execSync(cmd, {
        cwd: process.cwd(),
        timeout: 15000,
        stdio: 'inherit',
      })
    }
  } catch {
    process.stdout.write(`\n${YELLOW}⚠ Commande non exécutable depuis ce contexte — tape-la au prompt.${RESET}\n\n`)
  }
}

/**
 * Affiche les suggestions de patterns sauvegardées (pattern-suggestions.json).
 * Générées par analyze-patterns.js --suggest.
 */
function showPatternSuggestions(): void {
  const suggestionsFile = join(process.cwd(), 'telecom', 'pattern-suggestions.json')

  if (!existsSync(suggestionsFile)) {
    console.log(`\n${GRAY}Aucune suggestion de pattern enregistrée.${RESET}`)
    console.log(`  ${GRAY}Utilise ${RESET}402 /suggest <demande>${GRAY} pour en générer.${RESET}\n`)
    return
  }

  try {
    const raw = readFileSync(suggestionsFile, 'utf-8').trim()
    if (!raw) {
      console.log(`\n${GRAY}Aucune suggestion de pattern enregistrée.${RESET}\n`)
      return
    }

    const suggestions = JSON.parse(raw) as Array<{
      demande: string
      suggestedPattern: string
      subject: string
      script: string
      rationale: string
      count: number
      timestamp: string
    }>

    if (!Array.isArray(suggestions) || suggestions.length === 0) {
      console.log(`\n${GRAY}Aucune suggestion de pattern enregistrée.${RESET}\n`)
      return
    }

    console.log(`\n${BOLD}${CYAN}┌─ Suggestions de patterns (${suggestions.length}) ─────────────┐${RESET}`)
    console.log(`${BOLD}${CYAN}║${RESET}`)

    for (const s of suggestions) {
      const date = s.timestamp.slice(0, 10)
      const repeats = s.count > 1 ? ` ${YELLOW}(×${s.count})${RESET}` : ''
      console.log(`${BOLD}${CYAN}║  ${RESET}${GRAY}[${date}]${RESET} "${s.demande.slice(0, 50)}"${repeats}`)
      console.log(`${BOLD}${CYAN}║  ${RESET}  ${GRAY}Pattern:${RESET} "${s.suggestedPattern}"`)
      console.log(`${BOLD}${CYAN}║  ${RESET}  ${GRAY}Subject:${RESET} ${s.subject}  ${GRAY}Script:${RESET} ${s.script.split('/').pop()}`)
      console.log(`${BOLD}${CYAN}║${RESET}`)
    }

    console.log(`${BOLD}${CYAN}║  ${GRAY}Pour ajouter une suggestion : ${RESET}402 /suggest "<demande>"`)
    console.log(`${BOLD}${CYAN}╚${RESET}\n`)
  } catch {
    console.log(`\n${RED}Fichier de suggestions corrompu.${RESET}\n`)
  }
}

function showIntercomStatus(): void {
  const intercomDir = join(process.cwd(), 'telecom', 'intercom')
  const routedDir = join(process.cwd(), 'telecom', 'routed')

  console.log(`\n${BOLD}${CYAN}┌─ Status du systeme ─────────────────────┐${RESET}`)

  // ── Daemon feurouge ──
  const frClient = getFeuRougeClient()
  const frAlive = frClient.isAlive()
  console.log(`\n${BOLD}FeuRouge (sécurité) :${RESET}`)
  console.log(`  ${frAlive ? `${GREEN}▶ Actif${RESET}` : `${GRAY}■ Inactif${RESET}`}`)
  if (frAlive) {
    const config = getPermissionsConfig()
    const registrations = listRegistrations()
    if (config) console.log(`  ${GRAY}${config.agents.length} règles de permissions${RESET}`)
    if (registrations.length > 0) console.log(`  ${GRAY}${registrations.length} agent(s) enregistré(s)${RESET}`)
  }

  // ── Daemon telecom ──
  const daemonAlive = telecomDaemon !== null && telecomDaemon.exitCode === null
  console.log(`\n${BOLD}Daemon telecom :${RESET}`)
  console.log(`  ${daemonAlive ? `${GREEN}▶ Actif${RESET}` : `${RED}■ Inactif${RESET}`}`)

  // ── Agents d'arrière-plan ──
  if (backgroundAgents.size > 0) {
    console.log(`\n${BOLD}Agents d'arrière-plan :${RESET}`)
    for (const [name, proc] of backgroundAgents) {
      const alive = proc.exitCode === null
      const status = alive ? `${GREEN}▶ PID ${proc.pid}${RESET}` : `${RED}■ Terminé${RESET}`
      console.log(`  ${CYAN}${name}${RESET}  ${status}`)
    }
  }

  // ── Intercom ──
  console.log(`\n${BOLD}Intercom :${RESET}`)
  if (!existsSync(intercomDir)) {
    console.log(`  ${GRAY}Aucun dossier intercom${RESET}`)
  } else {
    const files = readdirSync(intercomDir).filter(f => f.endsWith('.json'))
    let pending = 0
    let read = 0
    for (const f of files) {
      try {
        const content = readFileSync(join(intercomDir, f), 'utf-8')
        const msg = JSON.parse(content) as { status: string; from: string; to: string; subject: string; id: string }
        if (msg.status === 'pending') pending++
        else if (msg.status === 'read') read++
      } catch { /* skip malformed */ }
    }
    const routedCount = existsSync(routedDir) ? readdirSync(routedDir).filter(f => f.endsWith('.json')).length : 0

    console.log(`  En attente : ${pending > 0 ? `${YELLOW}${pending}${RESET}` : `${GRAY}0${RESET}`}`)
    console.log(`  Lus         : ${read}`)
    console.log(`  Routés      : ${routedCount}`)
    console.log(`  Total       : ${files.length}`)

    if (pending > 0) {
      console.log(`\n  ${YELLOW}Messages en attente :${RESET}`)
      for (const f of files) {
        try {
          const content = readFileSync(join(intercomDir, f), 'utf-8')
          const msg = JSON.parse(content) as { status: string; from: string; to: string; subject: string; id: string }
          if (msg.status === 'pending') {
            console.log(`    ⏳ ${msg.from} → ${msg.to}  [${msg.subject}]`)
          }
        } catch { /* skip */ }
      }
    }
  }

  // ── Logbook ──
  const lbPath = join(process.cwd(), 'telecom', 'agent-logbook.md')
  if (existsSync(lbPath)) {
    const content = readFileSync(lbPath, 'utf-8').trim()
    const entries = content.split('\n## ').filter(Boolean)
    if (entries.length > 0) {
      console.log(`\n${BOLD}Dernieres entrées du logbook :${RESET}`)
      const recent = entries.slice(-3)
      for (const e of recent) {
        const title = e.split('\n')[0]
        console.log(`  ${CYAN}▶${RESET} ${title}`)
      }
    }
  }

  console.log(`\n${BOLD}${CYAN}└────────────────────────────────────────────┘${RESET}\n`)
}

function startFeuRougeDaemon(): void {
  const client = getFeuRougeClient()
  const started = client.start()
  if (started) {
    console.log(`${GREEN}✓ FeuRouge — démon de sécurité actif${RESET}`)
  } else {
    console.log(`${YELLOW}⚠ FeuRouge — non disponible (compile d'abord)${RESET}`)
  }
}

function stopFeuRougeDaemon(): void {
  const client = getFeuRougeClient()
  client.stop()
  resetFeuRougeClient()
}

function stopTelecomDaemon(): void {
  if (telecomDaemon) {
    telecomDaemon.kill('SIGTERM')
    telecomDaemon = null
    backgroundAgents.delete('telecom-daemon')
  }
  // Nettoyer le fichier PID
  const pidFile = join(process.cwd(), 'telecom', 'daemon.pid')
  if (existsSync(pidFile)) unlinkSync(pidFile)
}

export async function main() {
  // ensure default agent Alice exists in .agents/
  const existing = listLocalAgents()
  if (!existing.find(a => a.id === 'alice')) {
    try {
      scaffoldAgent('alice', 'Alice', DEFAULT_AGENT.model, DEFAULT_AGENT.toolNames, DEFAULT_AGENT.instructionsPrompt, true, 'standard', undefined, 1, DEFAULT_AGENT.provider || 'kilo-auto/free')
    } catch { /* already exists */ }
  }

  // charger l'agent depuis le fichier .agents/ pour garder la persistance
  let agent = getAgent(process.argv.slice(2))
  const localAlice = readLocalAgent('alice.ts')
  if (agent.id === 'alice' && localAlice) {
    agent = localAlice
  }
  currentEngine = createEngine({ agent })
  currentEngine.createSession()

  const COMMANDS = [
    'help', 'menu', 'start', 'create', 'edit', 'agents',
    'use', 'load', 'providers', 'providers add', 'providers list',
    'providers local', 'providers scan', 'providers keys',
    'providers addkey', 'providers enable', 'providers disable',
    'providers key', 'providers model', 'providers remove',
    'sessions', 'session', 'new', 'info', 'status',
    'notifications', 'notifications filter', 'notifications history',
    'permissions', 'permissions show', 'permissions edit', 'permissions reload',
    'exit', 'quit', 'test',
  ]

  const completer = (line: string): [string[], string] => {
    const hits = COMMANDS.filter(c => c.startsWith(line.toLowerCase().replace(/^\//, ''))).map(c => '/' + c)
    return [hits.length ? hits : COMMANDS.map(c => '/' + c), line]
  }

  const rl = createInterface({ input: stdin, output: stdout, completer })

  // wrap question to handle ESC cancel
  const origQuestion = rl.question.bind(rl)
  rl.question = async (prompt: string) => {
    const answer = await origQuestion(prompt)
    if (cancelled) {
      cancelled = false
      throw new Error('CANCELLED')
    }
    return answer
  }

  rl.on('SIGINT', () => {
    cancelled = true
  })

  // ── Logo / bannière (FIGlet art seulement) ──
  showBanner(currentEngine!)

  // ── Isolation sandbox : créer workspaces/.sandbox/ pour les agents sans projet
  ensureSandbox()

  // ── Nettoyage synchrone des notifications résiduelles ──
  // Le daemon nettoie aussi (cleanupOldState) mais il tourne en arrière-plan.
  // Ce nettoyage synchrone garanti que la boucle principale ne trouvera pas
  // de vieilles notifications de la session précédente au premier popAllNotifications().
  const notifyFile = join(process.cwd(), 'telecom', 'notifications.json')
  if (existsSync(notifyFile)) {
    try {
      writeFileSync(notifyFile, '[]', 'utf-8')
      console.log(`${GRAY}✓ Notifications résiduelles effacées${RESET}`)
    } catch { /* ignoré */ }
  }

  // ── Validation des fichiers de règles ──
  validateRulesAtStartup()

  // ── Messages de démarrage ──
  logSkillLoaded()
  startTelecomDaemon()
  startFeuRougeDaemon()
  // Nettoyer les archives de notifications plus vieilles que 30 jours
  cleanNotificationArchive()
  logWelcomeMessage()

  // ── Menu principal (liste numérotée) ──
  showMenu(currentEngine!)
  clearSuggestions()

  while (true) {
    try {
    // Afficher les notifications en attente (non encore vues via IPC)
    const pendingNotifs = popAllNotifications()
    for (const n of pendingNotifs) {
      if (n.level === 'conclusion' || n.level === 'urgent' || n.level === 'avertissement') {
        const icon = levelIcon(n.level)
        const lines = n.message.split('\n')
        console.log(`\n${icon} ${BOLD}${n.from}${RESET}`)
        console.log(`  ${lines[0]}`)
        for (let i = 1; i < Math.min(lines.length, 8); i++) {
          console.log(`  ${lines[i]}`)
        }
        if (lines.length > 8) console.log(`  ${GRAY}...${RESET}`)
        console.log()
      }
    }

    // ── Menu interactif des suggestions ──────────────────
    // Après l'exécution d'un script, le daemon écrit les suggestions
    // dans telecom/suggestions.json. On affiche le menu interactif
    // si des suggestions sont disponibles.
    // L'affichage automatique respecte la préférence utilisateur (autoShow).
    const currentProject = getCurrentProject()
    const prefs = getSuggestionPrefs()
    let line: string | null = null
    // Ne montrer le menu des suggestions QUE si des suggestions existent.
    // Évite la boucle infinie : showSuggestionMenu retourne null à la fois
    // quand il n'y a PAS de suggestions ET quand l'utilisateur tape "0".
    if (prefs.autoShow && hasSuggestions()) {
      const suggestionCmd = await showSuggestionMenu(rl, currentProject)
      if (suggestionCmd !== null) {
        // L'utilisateur a choisi une suggestion → injecter dans le flux
        // CLI direct (!project, /help, etc.). Ne pas router via Intercom
        // (qui ne reconnaît que des mots-clés comme "projet" ou "liste").
        line = suggestionCmd
        // Normaliser les commandes shell brutes (cat, node, ls) sans préfixe
        // pour qu'elles passent par handleShellLine au lieu d'aller au LLM
        if (!line.startsWith('/') && !line.startsWith('!')) {
          line = '!' + line
        }
        console.log(`\n${GREEN}→ ${line}${RESET}\n`)
      } else {
        // L'utilisateur a ignoré les suggestions (tape "0") :
        // 1. Les suggestions sont déjà supprimées par showSuggestionMenu
        // 2. Réafficher le menu pour que l'utilisateur voie les options
        // 3. Retourner au début de la boucle (les suggestions ne réapparaîtront
        //    pas car clearSuggestions a été appelé dans showSuggestionMenu)
        showMenu(currentEngine!)
        continue
      }
    }

    // Prompt normal (si aucune suggestion sélectionnée)
    if (line === null) {
      const displayName = getDisplayName(loadUserProfile())
      const projectBadge = currentProject ? ` ${CYAN}◈${currentProject}${RESET}` : ''
      const prefix = GRAY + displayName + projectBadge + RESET
      const pending = countPendingNotifications()
      const badge = pending > 0 ? ` ${YELLOW}[${pending}]${RESET} ` : ''
      line = (await rl.question(`${prefix}${badge}> `)).trim()
    }

    if (!line) { showMenu(currentEngine!); continue }

        // / tout seul → affiche le sélecteur de commandes
    if (line === '/' || line === '/?') {
      const pick = await handleCommandPicker(rl)
      if (pick) {
        line = pick
      } else {
        continue
      }
    }

    // ── Configuration (100) ──
    if (line === '101') {
      await handleManageProvidersMenu(rl)
      showMenu(currentEngine!)
      continue
    }
    if (line === '102') { await editUserProfile(rl); continue }

    // ── Agents (200) ──
    if (line === '201') { await handleCreate(rl); continue }
    if (line === '202') { handleListAgents(currentEngine!); continue }
    if (line === '203') { const newEngine = await handleEditAgent(rl, currentEngine!); if (newEngine) currentEngine = newEngine; showMenu(currentEngine!); continue }

    // ── Skills & prompts (204) ──
    if (line === '204') {
      await handleSkillsMenu(rl)
      showMenu(currentEngine!)
      continue
    }

    // ── Sessions (300) ──
    if (line === '301') { const newEngine = await handleStartSession(rl, currentEngine!); if (newEngine) currentEngine = newEngine; continue }
    if (line === '302') {
      showSessions(currentEngine!)
      // Afficher aussi les infos de la session active
      console.log()
      showInfo(currentEngine!)
      console.log()
      continue
    }

    // ── Monitoring (400) ──
    if (line === '401') {
      showIntercomStatus()
      continue
    }

    if (line === '402' || line.startsWith('402 ')) {
      const rest = line === '402' ? '' : line.slice(4).trim()

      // 402 /analyse → rapport complet d'analyse des patterns
      if (rest === '/analyse') {
        runAnalyzePatterns()
        continue
      }

      // 402 /rejected → analyse des échecs de matching
      if (rest === '/rejected' || rest === '/echecs' || rest === '/échecs') {
        runAnalyzePatterns(['--rejected'])
        continue
      }

      // 402 /coverage → couverture des patterns
      if (rest === '/coverage' || rest === '/couverture') {
        runAnalyzePatterns(['--coverage'])
        continue
      }

      // 402 /suggest <demande> → suggère un pattern pour une demande
      if (rest.startsWith('/suggest ') || rest.startsWith('/suggere ')) {
        const suggestDemande = rest.replace(/^\/sugg(?:est|ere) /, '').trim()
        if (suggestDemande) {
          runAnalyzePatterns(['--suggest', `"${suggestDemande.replace(/"/g, '\\"')}"`])
        } else {
          console.log(`${YELLOW}Usage: 402 /suggest "<demande>"${RESET}\n`)
        }
        continue
      }

      // 402 /suggestions → afficher les suggestions sauvegardées
      if (rest === '/suggestions') {
        showPatternSuggestions()
        continue
      }

      // 402 /rebuild → reconstruire le cache des embeddings
      if (rest === '/rebuild') {
        console.log(`${YELLOW}Reconstruction du cache des embeddings...${RESET}`)
        try {
          const { rebuildCache } = await import('./fuzzy-matcher.js')
          const ok = await rebuildCache()
          if (ok) {
            console.log(`${GREEN}✓ Cache reconstruit avec succès.${RESET}\n`)
          } else {
            console.log(`${RED}✗ Échec de la reconstruction (LM Studio indisponible ?).${RESET}\n`)
          }
        } catch (err) {
          console.log(`${RED}Erreur : ${(err as Error).message}${RESET}\n`)
        }
        continue
      }

      // 402 /help → aide des commandes 402
      if (rest === '/help' || rest === 'help') {
        console.log(`\n${BOLD}${CYAN}┌─ Commandes 402 — Messages intercom ───────────┐${RESET}`)
        console.log(`${BOLD}${CYAN}║${RESET}`)
        console.log(`${BOLD}${CYAN}║  ${RESET}${CYAN}402${RESET}                      Tous les messages`)
        console.log(`${BOLD}${CYAN}║  ${RESET}${CYAN}402 <subject>${RESET}           Filtrer par subject`)
        console.log(`${BOLD}${CYAN}║  ${RESET}${CYAN}402 /subjects${RESET}           Liste des subjects`)
        console.log(`${BOLD}${CYAN}║${RESET}`)
        console.log(`${BOLD}${CYAN}║  ${GRAY}── Analyse des patterns ──${RESET}`)
        console.log(`${BOLD}${CYAN}║  ${RESET}${CYAN}402 /analyse${RESET}            Rapport complet`)
        console.log(`${BOLD}${CYAN}║  ${RESET}${CYAN}402 /rejected${RESET}           Échecs de matching`)
        console.log(`${BOLD}${CYAN}║  ${RESET}${CYAN}402 /coverage${RESET}           Couverture des patterns`)
        console.log(`${BOLD}${CYAN}║  ${RESET}${CYAN}402 /suggest <demande>${RESET}  Suggérer un pattern`)
        console.log(`${BOLD}${CYAN}║  ${RESET}${CYAN}402 /suggestions${RESET}        Suggestions sauvegardées`)
        console.log(`${BOLD}${CYAN}║  ${RESET}${CYAN}402 /rebuild${RESET}            Reconstruire le cache`)
        console.log(`${BOLD}${CYAN}║${RESET}`)
        console.log(`${BOLD}${CYAN}╚${RESET}\n`)
        continue
      }

      // Sinon, traiter comme un filtre par subject
      if (rest) {
        const filter = rest === '/subjects' ? '__subjects__' : rest
        showIntercomMessages(filter)
      } else {
        showIntercomMessages()
      }
      continue
    }

    // ── Analyse des patterns (403) ──
    if (line === '403') {
      runAnalyzePatterns()
      continue
    }
    if (line.startsWith('403 ')) {
      const rest = line.slice(4).trim()

      if (rest === '/rejected' || rest === '/echecs') {
        runAnalyzePatterns(['--rejected'])
      } else if (rest === '/coverage' || rest === '/couverture') {
        runAnalyzePatterns(['--coverage'])
      } else if (rest.startsWith('/suggest ') || rest.startsWith('/suggere ')) {
        const suggestDemande = rest.replace(/^\/sugg(?:est|ere) /, '').trim()
        if (suggestDemande) {
          runAnalyzePatterns(['--suggest', `"${suggestDemande.replace(/"/g, '\\"')}"`])
        }
      } else if (rest === '/suggestions') {
        showPatternSuggestions()
      } else if (rest === '/rebuild') {
        console.log(`${YELLOW}Reconstruction du cache des embeddings...${RESET}`)
        try {
          const { rebuildCache } = await import('./fuzzy-matcher.js')
          const ok = await rebuildCache()
          if (ok) {
            console.log(`${GREEN}✓ Cache reconstruit avec succès.${RESET}\n`)
          } else {
            console.log(`${RED}✗ Échec de la reconstruction.${RESET}\n`)
          }
        } catch (err) {
          console.log(`${RED}Erreur : ${(err as Error).message}${RESET}\n`)
        }
      } else if (rest === '/help') {
        console.log(`\n${BOLD}${CYAN}┌─ Commandes 403 — Analyse des patterns ────────┐${RESET}`)
        console.log(`${BOLD}${CYAN}║${RESET}`)
        console.log(`${BOLD}${CYAN}║  ${RESET}${CYAN}403${RESET}                      Rapport complet`)
        console.log(`${BOLD}${CYAN}║  ${RESET}${CYAN}403 /rejected${RESET}           Échecs de matching`)
        console.log(`${BOLD}${CYAN}║  ${RESET}${CYAN}403 /coverage${RESET}           Couverture des patterns`)
        console.log(`${BOLD}${CYAN}║  ${RESET}${CYAN}403 /suggest <demande>${RESET}  Suggérer un pattern`)
        console.log(`${BOLD}${CYAN}║  ${RESET}${CYAN}403 /suggestions${RESET}        Suggestions sauvegardées`)
        console.log(`${BOLD}${CYAN}║  ${RESET}${CYAN}403 /rebuild${RESET}            Reconstruire le cache`)
        console.log(`${BOLD}${CYAN}╚${RESET}\n`)
      } else {
        console.log(`${YELLOW}Usage: 403 /analyse, 403 /rejected, 403 /coverage, 403 /suggest <demande>${RESET}\n`)
      }
      continue
    }

    // ── Banc de tests (500) ──
    if (line === '501') {
      await handleTestSubmenu(rl)
      showMenu(currentEngine!)
      continue
    }

    // ── Suggestions (600) ──
    if (line === '601' || line === '602' || line === '603' || line === '604' || line === '605') {
      await handleSuggestionsMenu(rl)
      showMenu(currentEngine!)
      continue
    }

    // ── /suggestions ──
    if (line === '/suggestions') {
      await handleSuggestionsMenu(rl)
      showMenu(currentEngine!)
      continue
    }

    // ── Aide ──
    if (line === 'aide' || line === 'Aide' || line === 'AIDE') { showHelp(currentEngine!); continue }

    // ── Quitter ──
    if (line === 'fin' || line === 'Fin' || line === 'FIN') { stopFeuRougeDaemon(); stopTelecomDaemon(); console.log(`${GRAY}Bye.${RESET}`); rl.close(); exit(0) }

    if (line.startsWith('/')) {
      const [cmd, ...args] = line.slice(1).split(/\s+/)
      const eng = currentEngine!

      switch (cmd) {
        case 'menu': { showMenu(currentEngine!); break }
        case 'help': { showHelp(currentEngine!); break }
        case 'start': { const newEngine = await handleStartSession(rl, currentEngine!); if (newEngine) currentEngine = newEngine; break }
        case 'edit': { const newEngine = await handleEditAgent(rl, currentEngine!); if (newEngine) currentEngine = newEngine; break }
        case 'create': { await handleCreate(rl); break }
        case 'agents': { handleListAgents(currentEngine!); break }
        case 'use': { const newEngine = handleUseAgent(args, currentEngine!); if (newEngine) currentEngine = newEngine; break }
        case 'profile': { await editUserProfile(rl); break }
        case 'providers': { await handleProviders(rl, args, currentEngine!); break }
        case 'sessions': { showSessions(currentEngine!); break }
        case 'session': {
          const id = args[0]
          if (!id) { console.log(`${YELLOW}Usage: /session <id>${RESET}`); break }
          const found = eng.getSession(id)
          if (found) {
            eng.addMessage('user', `[switched to session ${id}]`)
            console.log(`${GREEN}Session → ${id}${RESET}`)
          } else {
            const partial = eng.listSessions().find(s => s.id.startsWith(id))
            if (partial) {
              eng.addMessage('user', `[switched to session ${partial.id}]`)
              console.log(`${GREEN}Session → ${partial.id}${RESET}`)
            } else {
              console.log(`${RED}Session introuvable.${RESET}`)
            }
          }
          break
        }
        case 'new': {
          eng.createSession()
          console.log(`${GREEN}Session créée : ${eng.getCurrentSession()?.id}${RESET}`)
          break
        }
        case 'status': { showIntercomStatus(); break }
        case 'notifications': {
          if (args[0] === 'history') {
            const days = parseInt(args[1], 10) || 7
            const history = loadNotificationHistory(days)
            if (history.length === 0) {
              console.log(`\n${YELLOW}Aucune notification archivée dans les ${days} derniers jours.${RESET}\n`)
            } else {
              const byDate = new Map<string, Notification[]>()
              for (const n of history) {
                const dateKey = n.timestamp.slice(0, 10)
                if (!byDate.has(dateKey)) byDate.set(dateKey, [])
                byDate.get(dateKey)!.push(n)
              }
              console.log(`\n${BOLD}Historique des notifications (${days} jours, ${history.length} entrées) :${RESET}\n`)
              for (const [date, entries] of byDate) {
                console.log(`  ${BOLD}${CYAN}${date}${RESET}  (${entries.length})`)
                for (const n of entries.slice(0, 5)) { // max 5 par jour, les plus récentes
                  const time = n.timestamp.slice(11, 19)
                  const icon = levelIcon(n.level)
                  const preview = n.message.split('\n')[0].slice(0, 100)
                  console.log(`    ${GRAY}${time}${RESET} ${icon} ${YELLOW}${n.from}${RESET} ${preview}`)
                }
                if (entries.length > 5) {
                  console.log(`    ${GRAY}... et ${entries.length - 5} autre(s)${RESET}`)
                }
              }
              console.log(`\n${GRAY}Fichiers : telecom/notifications/YYYY-MM-DD.json${RESET}\n`)
            }
          } else if (args[0] === 'filter') {
            const level = args[1]
            const valid = ['info', 'questions', 'tache', 'missions', 'mise-en-place', 'plan', 'storyboard', 'todo-list', 'avertissement', 'warning', 'conclusion', 'urgent', 'off']
            if (!valid.includes(level)) {
              const current: NotificationLevel | 'off' = getNotificationFilter()
              const label = current === 'off' ? 'Aucune' : current
              console.log(`\n${BOLD}Filtre notifications :${RESET} ${levelIcon(current)} ${label}`)
              console.log(`\n${YELLOW}Usage: /notifications filter <niveau>${RESET}`)
              console.log(`  ${CYAN}off${RESET}         ${GRAY}— Aucune notification${RESET}`)
              for (const lvl of listLevels()) {
                console.log(`  ${lvl.icon} ${lvl.level.padEnd(15)} ${GRAY}— ${lvl.description}${RESET}`)
              }
              console.log()
              break
            }
            if (level === 'off') {
              setNotificationFilter('off')
              console.log(`${YELLOW}🔕 Notifications désactivées${RESET}`)
            } else {
              setNotificationFilter(level as NotificationLevel)
              const pending = countPendingNotifications()
              const badge = pending > 0 ? ` ${GRAY}(${pending} en attente)${RESET}` : ''
              console.log(`${GREEN}✓ Filtre notifications : ${levelIcon(level as NotificationLevel)} ${level}${badge}${RESET}`)
            }
          } else if (args[0] === 'status' || !args[0]) {
            const current: NotificationLevel | 'off' = getNotificationFilter()
            const label = current === 'off' ? 'Aucune' : current
            console.log(`\n${BOLD}Filtre actif :${RESET} ${levelIcon(current)} ${label}`)
            console.log(`\n${YELLOW}Pour changer : /notifications filter <niveau>${RESET}`)
            for (const lvl of listLevels()) {
              console.log(`  ${lvl.icon} ${lvl.level.padEnd(15)} ${GRAY}— ${lvl.description}${RESET}`)
            }
            console.log(`  ${CYAN}🔕${RESET} ${'off'.padEnd(15)} ${GRAY}— Aucune notification${RESET}`)
            console.log()
          }
          break
        }
        case 'info': { showInfo(currentEngine!); break }
        case 'skills': {
          const skillName = args.join(' ')
          if (!skillName) {
            showSkillsList()
            break
          }
          const skill = loadSkill(skillName)
          if (!skill) {
            console.log(`${RED}Skill "${skillName}" introuvable. Utilisez /skills pour lister les skills disponibles.${RESET}`)
            break
          }
          const body = skill.content.replace(/---[\s\S]*?---\n/, '').trim()
          console.log(`\n${BOLD}${CYAN}════════════════════════════════════════════${RESET}`)
          console.log(`${BOLD}${CYAN}  ${skill.meta.name}${RESET}`)
          if (skill.meta.category) console.log(`  ${GRAY}${skill.meta.category}${RESET}`)
          console.log(`  ${GREEN}${skill.meta.description}${RESET}`)
          console.log(`${BOLD}${CYAN}════════════════════════════════════════════${RESET}\n`)
          console.log(`${body}\n`)
          break
        }
        case 'ps': {
          if (backgroundAgents.size === 0) {
            console.log(`${YELLOW}Aucun agent en arrière-plan.${RESET}`)
          } else {
            console.log(`\n${BOLD}Agents en arrière-plan :${RESET}`)
            for (const [name, proc] of backgroundAgents) {
              const alive = proc.exitCode === null
              console.log(`  ${alive ? `${GREEN}▶` : `${RED}■`}${RESET} ${CYAN}${name}${RESET} ${alive ? `PID: ${proc.pid}` : 'terminé'}`)
            }
          }
          break
        }
        case 'kill': {
          const target = args[0]
          if (!target) {
            console.log(`${YELLOW}Usage: /kill <nom> (ex: /kill timer-man)${RESET}`)
            break
          }
          const proc = backgroundAgents.get(target)
          if (!proc) {
            console.log(`${RED}Aucun agent "${target}" en cours.${RESET}`)
            break
          }
          const pidFile = join(process.cwd(), 'telecom', 'timer-agent.pid')
          if (existsSync(pidFile)) unlinkSync(pidFile)
          proc.kill('SIGTERM')
          backgroundAgents.delete(target)
          console.log(`${GREEN}✓ "${target}" arrêté${RESET}`)
          break
        }
        case 'logbook': {
          const lbPath = join(process.cwd(), 'telecom', 'agent-logbook.md')
          if (!existsSync(lbPath)) {
            console.log(`${YELLOW}Aucune entrée dans le logbook.${RESET}`)
          } else {
            const content = readFileSync(lbPath, 'utf-8').trim()
            const entries = content.split('\n## ').filter(Boolean)
            const count = entries.length
            console.log(`\n${BOLD}Agent Logbook (${count} entrée(s)) :${RESET}\n`)
            // show last 3 entries
            const recent = entries.slice(-3)
            for (const e of recent) {
              const title = e.split('\n')[0]
              console.log(`  ${CYAN}▶${RESET} ${title}${GRAY}...${RESET}`)
            }
            if (count > 3) console.log(`  ${GRAY}... et ${count - 3} entrée(s) plus ancienne(s)${RESET}`)
            console.log(`\n${YELLOW}Fichier : ${lbPath}${RESET}\n`)
          }
          break
        }
        case 'load': {
          const path = args.join(' ')
          if (!path) { console.log(`${YELLOW}Usage: /load <path>${RESET}`); break }
          try {
            const newAgent = loadAgentFromFile(path)
            currentEngine = createEngine({ agent: newAgent })
            currentEngine.createSession()
            console.log(`${GREEN}Agent chargé : ${newAgent.name}${RESET}`)
          } catch (err) {
            console.log(`${RED}Erreur : ${(err as Error).message}${RESET}`)
          }
          break
        }
        case 'permissions': {
          await handlePermissionsCommand(args)
          break
        }
        case 'project': {
          await handleProjectMenu(rl)
          break
        }
        case 'tasks': {
          if (args.length > 0) {
            dispatchProjectCommand('tasks ' + args.join(' '))
          } else {
            console.log(`${YELLOW}Usage: /tasks <project> [area]${RESET}`)
          }
          break
        }
        case 'test': {
          await handleTestSubmenu(rl)
          showMenu(currentEngine!)
          break
        }
        case 'exit':
        case 'quit': {
          stopFeuRougeDaemon()
          stopTelecomDaemon()
          console.log(`${GRAY}Bye.${RESET}`)
          rl.close()
          exit(0)
        }
        default: {
          console.log(`${YELLOW}Commande inconnue : /${cmd}. Tapez /menu, /? ou un numéro du menu.${RESET}`)
        }
      }
      continue
    }

    // If user mentions "timer-man" in natural language, convert to !spawn command
    if (line.toLowerCase().includes('timer-man') && !line.startsWith('!')) {
      const match = line.match(/(\d+)\s*(min|m|minute|sec|s)/i)
      const interval = match ? match[1] + (match[2]?.startsWith('s') ? 's' : 'm') : '1h'
      line = `!spawn timer-man ${interval}`
    }

    // ── Commandes internes ! ────────────────────────────
    if (line.startsWith('!explore')) {
      const rest = line.slice(9).trim()
      if (rest) {
        runParadesScript('explore', [rest])
      } else {
        console.log(`${YELLOW}Usage: !explore <projet> [--path <dossier>]${RESET}\n`)
      }
      continue
    }
    if (line.startsWith('!deploy')) {
      const rest = line.slice(8).trim()
      if (rest) {
        runParadesScript('deploy', rest.split(/\s+/))
      } else {
        console.log(`${YELLOW}Usage: !deploy <projet> [--dry-run]${RESET}\n`)
      }
      continue
    }
    if (line.startsWith('!git')) {
      const rest = line.slice(5).trim()
      if (rest) {
        runParadesScript('git', rest.split(/\s+/))
      } else {
        console.log(`${YELLOW}Usage: !git <action> <projet>${RESET}\n`)
      }
      continue
    }
    if (line.startsWith('!profiles')) {
      const rest = line.slice(10).trim()
      if (rest) {
        runParadesScript('profiles', rest.split(/\s+/))
      } else {
        runParadesScript('profiles', ['list'])
      }
      continue
    }
    if (line.startsWith('!doc')) {
      const rest = line.slice(5).trim()
      if (rest) {
        runParadesScript('doc', rest.split(/\s+/))
      } else {
        console.log(`${YELLOW}Usage: !doc <action> <type> [projet]${RESET}\n`)
      }
      continue
    }
    if (line.startsWith('!project')) {
      const rest = line.slice(9).trim()
      dispatchProjectCommand(rest || 'help')
      continue
    }
    if (line.startsWith('!tasks')) {
      const rest = line.slice(7).trim()
      dispatchProjectCommand(`tasks ${rest}`)
      continue
    }
    if (line.startsWith('!permissions')) {
      const args = line.slice(13).trim().split(/\s+/)
      await handlePermissionsCommand(args)
      continue
    }
    if (line.startsWith('!agents')) {
      handleListAgents(currentEngine!)
      continue
    }
    if (line.startsWith('!suggestions')) {
      // Déclencher l'agent-parades qui écrit dans suggestions.json
      // Le polling + menu interactif est géré en interne par triggerParades.
      writeLastContext({ action: 'route', demande: '!suggestions: ' + line.slice(12).trim() })
      triggerParades({ action: 'route', demande: '!suggestions: ' + line.slice(12).trim() }, handleSuggestionCommand)
      continue
    }

    const isCommand = line.startsWith('!')
    const isAssistantMsg = line.startsWith('@')

    // shell commands and assistant messages → handleShellLine
    if (isCommand || isAssistantMsg) {
      const handled = await handleShellLine(line, currentEngine!, backgroundAgents)
      if (handled) continue
    }

    // Script-runner : matching pattern direct (avant Intercom)
    // Permet d'exécuter les scripts sans passer par le LLM ni l'intercom.
    const scriptResult = matchAndExecute(line)
    if (scriptResult.matched) {
      if (scriptResult.stdout) {
        console.log(`\n${scriptResult.stdout}\n`)
      }
      if (scriptResult.stderr) {
        console.error(`${RED}${scriptResult.stderr}${RESET}\n`)
      }
      writeLastContext({ action: 'route', demande: line })
      continue
    }

    // Routeur intercom automatique (sans LLM) : détection par mots-clés
    // Uniquement si le script-runner n'a pas trouvé de pattern.
    const routeResult = tryRouteIntercom(line)
    if (routeResult) {
      console.log(`\n${GREEN}✓ Routé vers agent-telecom [${routeResult.subject}]${RESET}`)
      console.log(`\n${CYAN}${routeResult.response}${RESET}`)
      console.log()
      // Sauvegarder le contexte de routage pour le handler IPC
      // qui déclenchera triggerParades() à la notification 'conclusion'.
      writeLastContext({ action: 'route', demande: line })
      continue
    }

        // plain text → call the LLM
    const eng = currentEngine!
    const resolved = resolveProviderForModel(eng.agent.model, eng.agent.provider)
    if (!resolved) {
      console.log(`\n${YELLOW}⚠ Alice n'est pas encore connectée à un fournisseur LLM.${RESET}`)
      console.log(`   ${CYAN}1.${RESET} Configure un provider avec ${GREEN}/providers add${RESET} ou ${GREEN}/providers scan${RESET}`)
      console.log(`   ${CYAN}2.${RESET} Assure-toi que le provider a une clé API valide`)
      console.log(`   ${CYAN}3.${RESET} Modèle actuel : ${GRAY}${eng.agent.model}${RESET}`)
      console.log(`   ${CYAN}4.${RESET} Utilise !cmd pour les commandes shell en attendant\n`)
      continue
    }

    let systemPrompt = eng.agent.instructionsPrompt || 'You are a helpful assistant.'

    // Auto-injecter les Règles d'Or Universelles dans le system prompt de TOUT agent
    // (sauf Alice — modèle 1.2B, son seul rôle est parler + Intercom, les règles générales la noient)
    if (eng.agent.id !== 'alice') {
      try {
        const rulesPath = join(process.cwd(), 'data', 'rules', 'AGENT_RULES.md')
        if (existsSync(rulesPath)) {
          const rulesContent = readFileSync(rulesPath, 'utf-8').trim()
          if (rulesContent) {
            systemPrompt += `\n\n=== RÈGLES D\'OR UNIVERSELLES ===\n\n${rulesContent}`
          }
        }
      } catch {
        // Fichier introuvable ou inaccessible — on continue sans
      }
    }

    // Auto-injecter la skill correspondante dans le system prompt
    const SKILL_MAP: Record<string, string> = {
      alice: 'skill-alice',
    }
    const skillDir = SKILL_MAP[eng.agent.id]
    const skill = skillDir ? loadSkill(skillDir) : null
    if (skill) {
      const body = skill.content.replace(/---[\s\S]*?---\n/, '').trim()
      systemPrompt += `\n\n=== SKILL : ${skill.meta.name} ===\n\n${body}`
    }

    // Cahier d'aide INDEX.md — SUSPENDU pour Alice (modèle 1.2B, 35+ lignes le saturent).
    // Les patterns Intercom font le travail à sa place.

    // Écrire le message utilisateur pour les scripts d'Alice (handle.js lit ce fichier)
    const aliceInputPath = join(process.cwd(), 'telecom', 'alice-input.txt')
    try {
      mkdirSync(dirname(aliceInputPath), { recursive: true })
      writeFileSync(aliceInputPath, line, 'utf-8')
    } catch { /* ignoré — fichier non bloquant */ }

    process.stdout.write(`\n${YELLOW}⟳${RESET} ${GRAY}${resolved.provider} / ${resolved.model}${RESET} `)
    try {
      const llmResponse = await eng.callLLM(line, resolved, systemPrompt)
      process.stdout.write(`\r${GREEN}✓${RESET}\n`)
      // Nettoyer les codes ANSI avant stockage dans l'historique
      // pour éviter de polluer le contexte LLM au prochain appel
      const plainResponse = llmResponse.replace(/\x1b\[[0-9;]*m/g, '')
      eng.addMessage('assistant', plainResponse)
      console.log(`\n${llmResponse}\n`)      // Sauvegarder le contexte et déclencher les parades après une réponse LLM
          // Le contexte est écrit pour que le handler IPC puisse le lire si
          // le daemon intercom intervient après la réponse.
          writeLastContext({ action: 'llm-response', demande: line, llmResponse: plainResponse })
          triggerParades({ action: 'llm-response', demande: line, llmResponse: plainResponse }, handleSuggestionCommand)
        } catch (err) {
      process.stdout.write(`\r${RED}✗${RESET}\n`)
      const msg = (err as Error).message
      console.log(`\n${RED}Erreur LLM :${RESET} ${msg.slice(0, 200)}\n`)
      if (msg.includes('401') || msg.includes('403') || msg.includes('API key')) {
        console.log(`   ${YELLOW}→ Vérifie la clé API avec /providers key <nom> <nouvelle_clé>${RESET}\n`)
      }
    }
  } catch (e) {
    if ((e as Error).message !== 'CANCELLED') throw e
    cancelled = false
  }
  }
}
