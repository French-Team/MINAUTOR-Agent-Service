#!/usr/bin/env node
/**
 * telecom-notification-viewer.ts — Fenêtre dédiée aux notifications
 *
 * Usage:
 *   node dist/telecom/service/telecom-notification-viewer.js
 *
 * Affiche les notifications en temps réel dans une fenêtre séparée.
 * Lit telecom/notifications.json toutes les 1 seconde.
 * Se ferme automatiquement si le daemon parent meurt.
 *
 * Lifecycle (géré par le daemon) :
 *   - Démarrée dans une nouvelle fenêtre cmd/shell
 *   - PID écrit dans telecom/notification-viewer.pid
 *   - Tuée par le daemon via killNotificationViewer() à l'arrêt
 *   - S'auto-détruit si le daemon meurt inopinément
 *
 * Rendu : terminal-kit fullscreen — 1 zone liste (TL→BR) + barre titre + barre statut
 */

import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, existsSync, watch, unlinkSync } from 'node:fs'
import { join } from 'node:path'

const require$ = createRequire(import.meta.url)
const termkit = require$('terminal-kit')
const term = termkit.terminal

// ── Constantes ──
const CWD = process.cwd()
const NOTIFY_PATH = join(CWD, 'telecom', 'notifications.json')
const PID_FILE = join(CWD, 'telecom', 'daemon.pid')
const VIEWER_PID_FILE = join(CWD, 'telecom', 'notification-viewer.pid')
const VIEWER_SHUTDOWN_FILE = join(CWD, 'telecom', 'notification-viewer.shutdown')
const POLL_INTERVAL = 1500 // 1.5 secondes
const DAEMON_CHECK_INTERVAL = 5000 // 5 secondes

interface Notification {
  id: string
  from: string
  message: string
  level: string
  timestamp: string
}

/**
 * Icône correspondant au niveau de notification
 */
function levelIcon(level: string): string {
  switch (level) {
    case 'urgent': return '🔴'
    case 'conclusion': return '📊'
    case 'avertissement':
    case 'warning': return '🟡'
    case 'todo-list': return '✅'
    case 'storyboard': return '🎬'
    case 'plan': return '📐'
    case 'mise-en-place': return '⚙️'
    case 'missions': return '🎯'
    case 'tache': return '📋'
    case 'questions': return '❓'
    case 'info': return '🔔'
    default: return '🔔'
  }
}

// ── État ──
let knownIds = new Set<string>()
let shutdownScheduled = false
let watchers: ReturnType<typeof watch>[] = []

// ── Historique scrollable ──
let allHistory: Notification[] = []
let scrollOffset = 0
let maxScrollLines = 0
const MAX_HISTORY = 500

// ── Helpers ──

function termWidth(): number {
  const w = process.stdout.columns ?? term.width
  return (typeof w === 'number' && w > 0 && isFinite(w)) ? Math.floor(w) : 80
}

function termHeight(): number {
  const h = process.stdout.rows ?? term.height
  return (typeof h === 'number' && h > 0 && isFinite(h)) ? Math.floor(h) : 24
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const parts: string[] = []
  if (h > 0) parts.push(`${h}h`)
  if (m > 0) parts.push(`${m}m`)
  parts.push(`${s}s`)
  return parts.join(' ')
}

/**
 * Retourne la largeur VISIBLE d'une chaîne, ignorant les codes ANSI
 * et comptant les caractères double-largeur (émojis) pour 2.
 */
function visibleWidth(text: string): number {
  const plain = text.replace(/\x1b\[[0-9;]*m/g, '')
  let w = 0
  for (const ch of plain) {
    const cp = ch.codePointAt(0) ?? 1
    if (cp >= 0x1F000 && cp <= 0x1FFFF) w += 2
    else if (cp === 0xFE0F || cp === 0x200D) w += 0
    else w += 1
  }
  return w
}

/**
 * Tronque une chaîne à `maxCols` cellules VISIBLES en préservant les codes ANSI.
 */
function truncateWidth(text: string, maxCols: number): string {
  const ansiRegex = /\x1b\[[0-9;]*m/g
  let result = ''
  let visW = 0
  let lastIdx = 0
  let match: RegExpExecArray | null

  while ((match = ansiRegex.exec(text)) !== null) {
    const segment = text.slice(lastIdx, match.index)
    const taken = takeVisible(segment, maxCols - visW)
    result += taken.text
    visW += taken.width
    if (visW >= maxCols) return result
    result += match[0]
    lastIdx = ansiRegex.lastIndex
  }
  if (visW < maxCols) {
    result += takeVisible(text.slice(lastIdx), maxCols - visW).text
  }
  return result

  function takeVisible(str: string, budget: number): { text: string; width: number } {
    if (budget <= 0) return { text: '', width: 0 }
    let out = ''
    let w = 0
    for (const ch of str) {
      const cp = ch.codePointAt(0) ?? 1
      let cw = 1
      if (cp >= 0x1F000 && cp <= 0x1FFFF) cw = 2
      else if (cp === 0xFE0F || cp === 0x200D) cw = 0
      if (w + cw > budget) break
      out += ch
      w += cw
    }
    return { text: out, width: w }
  }
}

// ── Données ──

function loadNotifications(): Notification[] {
  if (!existsSync(NOTIFY_PATH)) return []
  try {
    const raw = readFileSync(NOTIFY_PATH, 'utf-8').trim()
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((n: unknown): n is Notification =>
      n !== null && typeof n === 'object' && typeof (n as Record<string, unknown>).id === 'string'
    )
  } catch {
    return []
  }
}

/**
 * Construit le texte à afficher dans la zone de notification.
 * Header résumé + chaque notification formatée (timestamp, icône, source, message).
 */
/**
 * Construit les lignes de texte à afficher depuis un tableau d'historique.
 * Header résumé + chaque notification formatée (timestamp, icône, source, message).
 * Retourne un tableau de lignes (pas de join — drawContent applique le scroll dessus).
 */
function buildDisplayLines(history: Notification[]): string[] {
  const total = history.length
  const tw = termWidth()
  const cols = tw - 2 // marge des 2 côtés

  const lines: string[] = []

  // Header
  const header = `Notifications: ${total}  (${total > 0 ? `${total} notification(s)` : 'aucune'})`
  lines.push(header)
  lines.push('')

  if (total === 0) {
    lines.push('(aucune notification)')
    return lines
  }

  for (const n of history) {
    const time = (n.timestamp || '').slice(11, 19)
    const icon = levelIcon(n.level)
    const from = n.from || '?'
    const msgLines = (n.message || '').split('\n')
    const firstLine = msgLines[0] || ''
    const preview = ` ${time} ${icon} ${from}  ${firstLine}`
    lines.push(truncateWidth(preview, cols))

    // Lignes supplémentaires du message (indentées)
    for (let i = 1; i < msgLines.length; i++) {
      const subLine = msgLines[i].trim()
      if (subLine) {
        const indented = `       ${subLine}`
        lines.push(truncateWidth(indented, cols))
      }
    }

    // Séparateur entre notifications
    lines.push(truncateWidth(`  ${'─'.repeat(Math.min(cols - 4, 30))}`, cols))
  }

  return lines
}



// ── Rendu ──

/**
 * Dessine la barre de titre (ligne 0)
 */
function drawTitleBar(): void {
  const tw = termWidth()
  const daemonAlive = checkDaemon()
  const uptime = Math.floor((Date.now() - startTime) / 1000)
  const status = daemonAlive ? 'Daemon: actif' : 'Daemon: mort'

  const title = ` Notifications — ${status} | Uptime: ${formatUptime(uptime)} `
  const padded = title.length >= tw
    ? title.slice(0, tw)
    : title + ' '.repeat(tw - title.length)

  term.moveTo(0, 0)
  term.bgBlue.white.bold(padded)
  term.bgBlack.defaultColor()
}

/**
 * Dessine la zone de contenu (lignes 1 à th-2) avec support du scroll.
 * @param lines - Toutes les lignes de l'historique (buildDisplayLines)
 * @param offset - Nombre de lignes à sauter depuis le début (scroll)
 */
function drawContent(lines: string[], offset: number): void {
  const tw = termWidth()
  const th = termHeight()
  const contentHeight = th - 3 // titre + status + bordure de status
  if (contentHeight < 2) return

  const maxCols = tw - 2
  const RESET = '\x1b[0m'
  const BG_DARK = '\x1b[48;5;236m'

  for (let row = 0; row < contentHeight; row++) {
    const lineIdx = offset + row
    term.moveTo(1, 1 + row)
    if (lineIdx < lines.length) {
      const line = lines[lineIdx].replace(/%/g, '%%')
      const lineW = visibleWidth(line)
      const display = lineW >= maxCols ? truncateWidth(line, maxCols) : line + ' '.repeat(maxCols - lineW)
      if (row % 2 === 1) {
        const striped = BG_DARK + display.replace(/\x1b\[0m/g, RESET + BG_DARK)
        term(striped + RESET)
      } else {
        term(display)
      }
    } else if (row % 2 === 1) {
      term(BG_DARK + ' '.repeat(maxCols) + RESET)
    } else {
      term(' '.repeat(maxCols))
    }
  }
}

/**
 * Dessine la barre d'état (dernière ligne) avec indicateur de scroll.
 * Utilise allHistory pour le décompte (inclut les notifications consommées).
 */
function drawStatusBar(): void {
  const tw = termWidth()
  const total = allHistory.length
  const levels = new Map<string, number>()
  for (const n of allHistory) {
    levels.set(n.level, (levels.get(n.level) ?? 0) + 1)
  }

  const urgent = levels.get('urgent') ?? 0
  const warning = levels.get('avertissement') ?? 0

  let status = ` Total: ${total}`
  if (urgent > 0) status += ` | 🔴 ${urgent} urgent`
  if (warning > 0) status += ` | 🟡 ${warning} avertissement`
  status += ` | 📜 ${scrollOffset === 0 ? 'fin' : `${scrollOffset}↑`}`
  status += ` | PID: ${process.pid} `

  term.moveTo(0, termHeight() - 1)
  const padded = status.length >= tw
    ? status.slice(0, tw)
    : status + ' '.repeat(tw - status.length)

  // Barre colorée selon la criticité
  if (urgent > 0) {
    term.bgRed.white.bold(padded)
  } else if (warning > 0) {
    term.bgYellow.black.bold(padded)
  } else {
    term.bgWhite.black(padded)
  }
  term.bgBlack.defaultColor()
}

// ── Lifecycle ──

const startTime = Date.now()

function checkDaemon(): boolean {
  try {
    if (existsSync(PID_FILE)) {
      const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10)
      if (!isNaN(pid)) {
        process.kill(pid, 0)
        return true
      }
    }
  } catch {
    /* mort */
  }
  return false
}

function collectAll(): void {
  try {
    const fresh = loadNotifications()
    let hasNew = false

    // Fusionner les nouvelles notifications dans l'historique
    for (const n of fresh) {
      if (!knownIds.has(n.id)) {
        knownIds.add(n.id)
        allHistory.push(n)
        hasNew = true
      }
    }

    // Tronquer si trop grand
    if (allHistory.length > MAX_HISTORY) {
      allHistory = allHistory.slice(allHistory.length - MAX_HISTORY)
    }

    // Trier : les plus récentes en premier
    allHistory.sort((a, b) => b.timestamp.localeCompare(a.timestamp))

    const lines = buildDisplayLines(allHistory)
    const contentHeight = termHeight() - 3
    maxScrollLines = Math.max(0, lines.length - contentHeight)

    // Auto-scroll : si on était tout en bas (scrollOffset === 0),
    // on suit automatiquement les nouvelles notifications.
    // Si l'utilisateur a scrollé vers le haut, on reste où il est.
    if (scrollOffset === 0) {
      // Rester à 0 = toujours voir les plus récentes
    }
    scrollOffset = Math.min(scrollOffset, maxScrollLines)

    drawContent(lines, scrollOffset)
    drawTitleBar()
    drawStatusBar()
    const total = allHistory.length
    const daemonStatus = checkDaemon() ? 'actif' : 'mort'
    const scrollHint = scrollOffset > 0 ? ` ↑${scrollOffset}` : ''
    term('\x1b]0;' + `Notifications Viewer — ${total} notifications — daemon ${daemonStatus}${scrollHint}` + '\x07')
  } catch {
    /* erreur silencieuse */
  }
}

function shutdown(): void {
  if (shutdownScheduled) return
  shutdownScheduled = true

  try { unlinkSync(VIEWER_PID_FILE) } catch { /* déjà supprimé */ }
  for (const w of watchers) {
    try { w.close() } catch { /* ignore */ }
  }
  watchers = []

  try {
    term.hideCursor(false)
    term.fullscreen(false)
    term.styleReset()
    term('\nFermeture du visionneur de notifications.\n')
  } catch { /* ignore */ }
  process.exit(0)
}

function setupFileWatcher(): void {
  for (const w of watchers) {
    try { w.close() } catch { /* ignore */ }
  }
  watchers = []

  try {
    const telecomDir = join(CWD, 'telecom')
    if (existsSync(telecomDir)) {
      const w = watch(telecomDir, { recursive: false }, () => {
        // Forcer le rafraîchissement à la prochaine collecte
      })
      watchers.push(w)
    }
  } catch { /* fs.watch pas disponible */ }
}

// ── Initialisation ──

function initUI(): void {
  try {
    term.fullscreen(true)
    term.hideCursor(true)

    // Premier rendu (remplit allHistory depuis le fichier)
    collectAll()

    try {
      term.on('resize', () => {
        collectAll()
      })
    } catch { /* pas de resize */ }

    try {
      term.on('key', (name: string) => {
        if (name === 'CTRL_C') {
          shutdown()
          return
        }

        // ── Gestion du scroll ──
        const contentHeight = termHeight() - 3
        let newOffset = scrollOffset

        switch (name) {
          case 'UP':
            if (scrollOffset > 0) newOffset = scrollOffset - 1
            break
          case 'DOWN':
            if (scrollOffset < maxScrollLines) newOffset = scrollOffset + 1
            break
          case 'PAGE_UP':
            newOffset = Math.max(0, scrollOffset - contentHeight)
            break
          case 'PAGE_DOWN':
            newOffset = Math.min(maxScrollLines, scrollOffset + contentHeight)
            break
          case 'HOME':
            newOffset = 0
            break
          case 'END':
            newOffset = maxScrollLines
            break
          default:
            return // pas une touche de scroll → rien à redessiner
        }

        if (newOffset !== scrollOffset) {
          scrollOffset = newOffset
          const lines = buildDisplayLines(allHistory)
          drawContent(lines, scrollOffset)
          drawStatusBar()
          const total = allHistory.length
          const daemonStatus = checkDaemon() ? 'actif' : 'mort'
          const scrollHint = scrollOffset > 0 ? ` ↑${scrollOffset}` : ''
          term('\x1b]0;' + `Notifications Viewer — ${total} notifications — daemon ${daemonStatus}${scrollHint}` + '\x07')
        }
      })
    } catch { /* pas de clavier */ }
  } catch (err) {
    logCrash('initUI', err)
    throw err
  }
}

function logCrash(context: string, err: unknown): void {
  try {
    const stack = err instanceof Error ? (err.stack ?? String(err)) : String(err)
    const msg = `[${new Date().toISOString()}] CRASH [${context}]: ${stack}\n`
    writeFileSync(join(CWD, 'telecom', 'viewer-crash.log'), msg, { flag: 'a', encoding: 'utf-8' })
  } catch { /* ignore */ }
}

// ── Boucle principale ──

function main(): void {
  try {
    if (!process.stdout.isTTY) {
      process.stderr.write([
        'Erreur : Le visionneur de notifications necessite un terminal interactif.\n',
        'Lancez-le depuis une fenetre de terminal dediee :\n',
        '  start cmd /c "chcp 65001 >nul && node dist/telecom/service/telecom-notification-viewer.js"\n',
      ].join(''))
      process.exit(1)
    }

    if (process.platform === 'win32') {
      try {
        const { execSync } = require$('node:child_process')
        execSync('chcp 65001 >nul', { timeout: 1000 })
      } catch { /* non bloquant */ }
    }

    initUI()

    try {
      writeFileSync(VIEWER_PID_FILE, String(process.pid), 'utf-8')
    } catch { /* non bloquant */ }

    collectAll()
    setupFileWatcher()

    const pollTimer = setInterval(() => {
      // Vérifier si le daemon demande un shutdown gracieux
      if (existsSync(VIEWER_SHUTDOWN_FILE)) {
        try { unlinkSync(VIEWER_SHUTDOWN_FILE) } catch { /* déjà supprimé */ }
        shutdown()
        return
      }
      collectAll()
    }, POLL_INTERVAL)

    const daemonCheckTimer = setInterval(() => {
      if (!checkDaemon()) {
        updateContent('⚠ Daemon arrete.\nFermeture dans 5 secondes...')
        setTimeout(() => shutdown(), 5000)
        clearInterval(daemonCheckTimer)
        clearInterval(pollTimer)
      }
    }, DAEMON_CHECK_INTERVAL)

    process.on('SIGTERM', () => shutdown())
    process.on('SIGINT', () => shutdown())
  } catch (err) {
    logCrash('main', err)
    try {
      term.hideCursor(false)
      term.fullscreen(false)
      term.styleReset()
    } catch { /* ignore */ }
    process.stderr.write(`\n\x1b[31mNotification viewer crash: ${err instanceof Error ? err.message : String(err)}\x1b[0m\n`)
    process.exit(1)
  }
}

/**
 * Met à jour le contenu de la zone d'affichage avec un message texte spécifique.
 * Utilisé pour les messages de shutdown/daemon mort.
 */
function updateContent(msg: string): void {
  const th = termHeight()
  const tw = termWidth()
  const contentHeight = th - 3
  if (contentHeight < 2) return

  const lines = msg.split('\n')
  const maxCols = tw - 2
  const RESET = '\x1b[0m'
  const BG_DARK = '\x1b[48;5;236m'

  for (let row = 0; row < contentHeight; row++) {
    term.moveTo(1, 1 + row)
    if (row < lines.length) {
      const line = lines[row].replace(/%/g, '%%')
      const lineW = visibleWidth(line)
      const display = lineW >= maxCols ? truncateWidth(line, maxCols) : line + ' '.repeat(maxCols - lineW)
      if (row % 2 === 1) {
        const striped = BG_DARK + display.replace(/\x1b\[0m/g, RESET + BG_DARK)
        term(striped + RESET)
      } else {
        term(display)
      }
    } else if (row % 2 === 1) {
      term(BG_DARK + ' '.repeat(maxCols) + RESET)
    } else {
      term(' '.repeat(maxCols))
    }
  }
}

main()
