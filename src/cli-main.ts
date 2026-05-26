import { createInterface } from 'readline/promises'
import { stdin, stdout, exit } from 'process'
import { readFileSync, existsSync, unlinkSync, readdirSync } from 'fs'
import { join } from 'path'
import { fork, ChildProcess } from 'child_process'

const backgroundAgents = new Map<string, ChildProcess>()
import { listSkills, loadSkill } from './skills.js'
import { popAllNotifications, setNotificationFilter, getNotificationFilter, levelIcon, listLevels, countPendingNotifications, removeNotification, shouldShowNotification, loadNotificationHistory, cleanNotificationArchive, type NotificationLevel, type Notification } from './notify.js'
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
  RESET, CYAN, GREEN, YELLOW, RED, GRAY, BOLD, LIME,
} from './constants.js'

import { showSessions, showInfo, handleStartSession } from './cli-sessions.js'
import { handleManageProvidersMenu } from './cli-providers.js'
import { handleCreate } from './cli-create.js'
import { handleEditAgent } from './cli-edit.js'
import { handleProviders } from './cli-providers-advanced.js'
import { handleListAgents, handleUseAgent } from './cli-agents.js'
import { showMenu, showHelp } from './cli-menu.js'
import { showBanner } from './cli-banner.js'
import { loadUserProfile, getDisplayName, editUserProfile } from './cli-user.js'
import { logSkillLoaded, logDaemonStarted, logWelcomeMessage } from './cli-startup.js'
import { DEFAULT_AGENT, getAgent, loadAgentFromFile } from './cli-utils.js'
import { handleCommandPicker } from './cli-selector.js'
import { handleShellLine } from './cli-runner.js'
import { tryRouteIntercom } from './cli-intercom-router.js'

let currentEngine: Engine | null = null
let telecomDaemon: ChildProcess | null = null

function startTelecomDaemon(): void {
  const daemonPath = join(import.meta.dirname, 'telecom', 'service', 'telecom-daemon.js')
  if (existsSync(daemonPath)) {
    telecomDaemon = fork(daemonPath, [], { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] })
    backgroundAgents.set('telecom-daemon', telecomDaemon)

    // Recevoir les notifications en temps réel via IPC
    telecomDaemon.on('message', (msg: unknown) => {
      const data = msg as { type?: string; id?: string; from?: string; message?: string; level?: string }
      if (data?.type === 'notification' && data.id) {
        // Vérifier le filtre actif avant d'afficher en temps réel
        const notifLevel = (data.level ?? 'info') as NotificationLevel
        if (!shouldShowNotification(notifLevel)) {
          // Filtrée : la notification reste dans le fichier pour
          // ne pas la perdre si l'utilisateur change le filtre plus tard
          return
        }

        // Tentative de suppression de la notification du fichier.
        // Si removeNotification retourne true, c'est que la notification
        // était encore dans le fichier (pas encore consommée par le loop).
        // Dans ce cas, on l'affiche en temps réel.
        // Si false, le loop l'a déjà affichée → on ne double pas.
        const wasPending = removeNotification(data.id)
        if (wasPending) {
          const icon = levelIcon(notifLevel)
          const msgLines = (data.message || '').split('\n')
          process.stdout.write(`\n${BOLD}${LIME}╔ Notification${RESET}\n`)
          process.stdout.write(`${BOLD}${LIME}║  ${RESET}${icon} ${YELLOW}${data.from}${RESET}\n`)
          for (const line of msgLines) {
            if (line) {
              process.stdout.write(`${BOLD}${LIME}║${RESET}    ${line}\n`)
            } else {
              process.stdout.write(`${BOLD}${LIME}║${RESET}\n`)
            }
          }
          process.stdout.write(`${BOLD}${LIME}╚${RESET}\n`)
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

function showIntercomStatus(): void {
  const intercomDir = join(process.cwd(), 'telecom', 'intercom')
  const routedDir = join(process.cwd(), 'telecom', 'routed')

  console.log(`\n${BOLD}${CYAN}┌─ Status du systeme ─────────────────────┐${RESET}`)

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
    'exit', 'quit',
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

  // ── Messages de démarrage ──
  logSkillLoaded()
  startTelecomDaemon()
  // Nettoyer les archives de notifications plus vieilles que 30 jours
  cleanNotificationArchive()
  logWelcomeMessage()

  // ── Menu principal (liste numérotée) ──
  showMenu(currentEngine!)

  while (true) {
    try {
    // vérifier les notifications des agents en arrière-plan
    const alerts = popAllNotifications()
    if (alerts.length > 0) {
      console.log(`\n${BOLD}${LIME}╔ Notifications${RESET}`)
      for (const n of alerts) {
        const icon = levelIcon(n.level ?? 'info')
        const msgLines = n.message.split('\n')
        console.log(`\n${BOLD}${LIME}║  ${RESET}${icon} ${YELLOW}${n.from}${RESET}`)
        for (const line of msgLines) {
          if (line) {
            console.log(`${BOLD}${LIME}║${RESET}    ${line}`)
          } else {
            console.log(`${BOLD}${LIME}║${RESET}`)
          }
        }
      }
      console.log(`${BOLD}${LIME}╚${RESET}\n`)
    }

    const displayName = getDisplayName(loadUserProfile())
    const prefix = GRAY + displayName + RESET
    const pending = countPendingNotifications()
    const badge = pending > 0 ? ` ${YELLOW}[${pending}]${RESET} ` : ''
    let line = (await rl.question(`${prefix}${badge}> `)).trim()

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

    // ── Configuration ──
    if (line === '1') {
      await handleManageProvidersMenu(rl)
      continue
    }
    if (line === '2') { await editUserProfile(rl); continue }

    // ── Agents ──
    if (line === '3') { await handleCreate(rl); continue }
    if (line === '4') { handleListAgents(currentEngine!); continue }
    if (line === '5') { const newEngine = await handleEditAgent(rl, currentEngine!); if (newEngine) currentEngine = newEngine; continue }

    // ── Sessions ──
    if (line === '6') { const newEngine = await handleStartSession(rl, currentEngine!); if (newEngine) currentEngine = newEngine; continue }
    if (line === '7') {
      showSessions(currentEngine!)
      // Afficher aussi les infos de la session active
      console.log()
      showInfo(currentEngine!)
      console.log()
      continue
    }

    // ── Monitoring ──
    if (line === '8') {
      showIntercomStatus()
      continue
    }

    // ── Aide ──
    if (line === '9') { showHelp(currentEngine!); continue }

    // ── Quitter ──
    if (line === '0') { stopTelecomDaemon(); console.log(`${GRAY}Bye.${RESET}`); rl.close(); exit(0) }

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
          if (args[0] === 'load') {
            const skillName = args.slice(1).join(' ')
            if (!skillName) { console.log(`${YELLOW}Usage: /skills load <nom>${RESET}`); break }
            const skill = loadSkill(skillName)
            if (!skill) { console.log(`${RED}Skill "${skillName}" introuvable.${RESET}`); break }
            console.log(`\n${BOLD}${CYAN}┌─ Skill : ${skill.meta.name} ─────────────────────┐${RESET}`)
            console.log(`${GRAY}${skill.meta.description}${RESET}`)
            console.log(`${BOLD}${CYAN}└────────────────────────────────────────────┘${RESET}\n`)
            const body = skill.content.replace(/---[\s\S]*?---\n/, '').trim()
            console.log(`${body}\n`)
            eng.addMessage('assistant', `[Skill "${skillName}" loaded]`)
          } else {
            const all = listSkills()
            if (all.length === 0) {
              console.log(`${YELLOW}Aucune skill disponible.${RESET}`)
            } else {
              console.log(`\n${BOLD}Skills disponibles (${all.length}) :${RESET}`)
              for (const s of all) {
                console.log(`  ${CYAN}${s.name}${RESET}  ${GRAY}${s.description}${RESET}`)
              }
              console.log(`\n${YELLOW}Utilise /skills load <nom> pour charger une skill.${RESET}\n`)
            }
          }
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
        case 'exit':
        case 'quit': {
          stopTelecomDaemon()
          console.log(`${GRAY}Bye.${RESET}`)
          rl.close()
          exit(0)
        }
        default: {
          console.log(`${YELLOW}Commande inconnue : /${cmd}. Tapez /menu, /?, ou 0-9.${RESET}`)
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

    const isCommand = line.startsWith('!')
    const isAssistantMsg = line.startsWith('@')

    // shell commands and assistant messages → handleShellLine
    if (isCommand || isAssistantMsg) {
      const handled = await handleShellLine(line, currentEngine!, backgroundAgents)
      if (handled) continue
    }

    // Routeur intercom automatique (sans LLM) : détection par mots-clés
    const routeResult = tryRouteIntercom(line)
    if (routeResult) {
      console.log(`\n${GREEN}✓ Routé vers agent-telecom [${routeResult.subject}]${RESET}`)
      console.log(`\n${CYAN}${routeResult.response}${RESET}`)

      // Afficher un indicateur de traitement en arrière-plan
      const daemonAlive = telecomDaemon !== null && telecomDaemon.exitCode === null
      if (daemonAlive) {
        const pendingAfter = countPendingNotifications()
        const badge = pendingAfter > 0 ? ` ${YELLOW}[${pendingAfter} notification(s)]${RESET}` : ''
        console.log(`${GRAY}⏳ Traitement en cours dans le daemon telecom...${badge}${RESET}`)
        console.log(`   Les notifications arrivent en temps réel ci-dessous.${RESET}\n`)
      } else {
        console.log(`${YELLOW}⚠ Daemon telecom pas actif — le message sera traité au prochain démarrage.${RESET}\n`)
      }
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

    // Auto-injecter la skill correspondante dans le system prompt
    // Mapping : l'agent alice utilise la skill-welcome (pas de raccourci build)
    const SKILL_MAP: Record<string, string> = {
      alice: 'skill-welcome',
    }
    const skillDir = SKILL_MAP[eng.agent.id]
    const skill = skillDir ? loadSkill(skillDir) : null
    if (skill) {
      const body = skill.content.replace(/---[\s\S]*?---\n/, '').trim()
      systemPrompt += `\n\n=== SKILL : ${skill.meta.name} ===\n\n${body}`
    }

    // Auto-injecter l'INDEX du cahier d'aide pour Alice
    if (eng.agent.id === 'alice') {
      try {
        const cahierIndexPath = join(process.cwd(), 'data', 'cahier-aides-alice', 'INDEX.md')
        if (existsSync(cahierIndexPath)) {
          const indexContent = readFileSync(cahierIndexPath, 'utf-8').trim()
          if (indexContent) {
            systemPrompt += `\n\n=== CAHIER D\'AIDE - INDEX ===\n\n${indexContent}`
          }
        }
      } catch {
        // Fichier introuvable — on continue sans
      }
    }

    process.stdout.write(`\n${YELLOW}⟳${RESET} ${GRAY}${resolved.provider} / ${resolved.model}${RESET} `)
    try {
      const llmResponse = await eng.callLLM(line, resolved, systemPrompt)
      process.stdout.write(`\r${GREEN}✓${RESET}\n`)
      eng.addMessage('assistant', llmResponse)
      console.log(`\n${llmResponse}\n`)
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
