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
import { readFileSync, writeFileSync, existsSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

const require$ = createRequire(import.meta.url)
const termkit = require$('terminal-kit')
const term = termkit.terminal

// ── Constantes ──
const CWD = process.cwd()
const ARCHIVE_DIR = join(CWD, 'telecom', 'notifications')
const PID_FILE = join(CWD, 'telecom', 'daemon.pid')
const VIEWER_PID_FILE = join(CWD, 'telecom', 'notification-viewer.pid')
const VIEWER_SHUTDOWN_FILE = join(CWD, 'telecom', 'notification-viewer.shutdown')
const POLL_INTERVAL = 1500 // 1.5 secondes
const DAEMON_CHECK_INTERVAL = 5000 // 5 secondes
const ARCHIVE_FALLBACK_DAYS = 3 // jours d'archives à charger en fallback

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
const knownIds = new Set<string>()
let shutdownScheduled = false

// ── Cache mtime des archives (évite de relire les fichiers inchangés) ──
const archiveMtimes = new Map<string, number>()

// ── Session : ne charger que les notifications produites APRÈS le démarrage ──
const sessionStartTime = Date.now()

// ── Compteur de notifications non encore affichées ──
let newCount = 0

// ── Anti-flicker / dimensions ──
let lastTermSize = { w: 80, h: 24 }
let lastTitleHash = ''
let lastStatusHash = ''
let forceRedraw = false
let psCacheSize = { w: 80, h: 24 }
let cycleCounter = 0

// ── Région du contenu ──
let contentRegion = { x: 1, y: 1, w: 78, h: 22 }

// ── Historique scrollable ──
let allHistory: Notification[] = []
let scrollOffset = 0
let maxScrollLines = 0
const MAX_HISTORY = 500

// ── Helpers ──

function termWidth(): number {
  if (process.platform === 'win32' && psCacheSize.w > 0) {
    return psCacheSize.w
  }
  const w = process.stdout.columns ?? term.width
  return (typeof w === 'number' && w > 0 && isFinite(w)) ? Math.floor(w) : 80
}

function termHeight(): number {
  if (process.platform === 'win32' && psCacheSize.h > 0) {
    return psCacheSize.h
  }
  const h = process.stdout.rows ?? term.height
  return (typeof h === 'number' && h > 0 && isFinite(h)) ? Math.floor(h) : 24
}

/**
 * Récupère la taille réelle de la console Windows via PowerShell.
 * Contourne le problème où process.stdout.columns/rows sont figés.
 */
function getWindowsConsoleSize(): { w: number; h: number } {
  try {
    const { execSync } = require$('node:child_process')
    const cmd = 'powershell -noprofile -command "(Get-Host).UI.RawUI.WindowSize.Width; (Get-Host).UI.RawUI.WindowSize.Height"'
    const raw = execSync(cmd, { timeout: 3000, encoding: 'utf-8' }).trim()
    const parts = raw.split(/\r?\n/).map((s: string) => parseInt(s.trim(), 10)).filter((n: number) => !isNaN(n) && n > 0)
    if (parts.length >= 2) {
      return { w: Math.floor(parts[0]), h: Math.floor(parts[1]) }
    }
  } catch {
    /* PowerShell peut echouer si pas disponible */
  }
  return { w: 0, h: 0 }
}

/**
 * Rafraîchit le cache PowerShell tous les 3 cycles.
 */
function refreshWindowsSize(): void {
  if (process.platform !== 'win32') return
  cycleCounter++
  if (cycleCounter === 1 || cycleCounter % 3 === 0) {
    const real = getWindowsConsoleSize()
    if (real.w > 0 && real.h > 0) {
      psCacheSize = { w: real.w, h: real.h }
    }
  }
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

/**
 * Charge les notifications depuis les archives telecom/notifications/YYYY-MM-DD.json.
 * Le viewer utilise UNIQUEMENT les archives car pushNotification() écrit
 * systématiquement dans les DEUX fichiers (notifications.json + archive).
 * L'archive est la source fiable : jamais effacée par le CLI.
 * @param days - Nombre de jours en arrière à charger (aujourd'hui inclus)
 */
function loadArchivedNotifications(days: number): Notification[] {
  if (!existsSync(ARCHIVE_DIR)) return []

  const results: Notification[] = []
  const now = new Date()

  for (let d = 0; d < days; d++) {
    const date = new Date(now)
    date.setDate(date.getDate() - d)
    const dateKey = date.toISOString().slice(0, 10)
    const archivePath = join(ARCHIVE_DIR, `${dateKey}.json`)

    if (!existsSync(archivePath)) {
      // Fichier supprimé entre-temps → nettoyer le cache
      archiveMtimes.delete(archivePath)
      continue
    }

    // Vérifier le mtime avant de lire — sauter si inchangé
    try {
      const mtimeMs = statSync(archivePath).mtimeMs
      const cached = archiveMtimes.get(archivePath)
      if (cached !== undefined && mtimeMs <= cached) continue
      archiveMtimes.set(archivePath, mtimeMs)
    } catch {
      // stat peut échouer (fichier supprimé entre existsSync et statSync)
      archiveMtimes.delete(archivePath)
      continue
    }

    try {
      const raw = readFileSync(archivePath, 'utf-8').trim()
      if (!raw) continue
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) continue
      const valid = parsed.filter((n: unknown): n is Notification =>
        n !== null && typeof n === 'object' && typeof (n as Record<string, unknown>).id === 'string'
      )
      results.push(...valid)
    } catch {
      continue
    }
  }

  return results
}

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



// ── Layout / Redimensionnement ──

/**
 * Recalcule la région de contenu en fonction de la taille actuelle du terminal.
 */
function recalcRegions(): void {
  const tw = termWidth()
  const th = termHeight()
  contentRegion = {
    x: 1,
    y: 1,
    w: Math.max(4, tw - 2),
    h: Math.max(3, th - 3),
  }
}

/**
 * Dessine la bordure autour de la zone de contenu.
 *   ┌──────────────────┐
 *   │                  │
 *   └──────────────────┘
 */
function drawBorder(): void {
  const r = contentRegion
  const { x, y, w, h } = r
  if (w < 4 || h < 3) return

  const RESET = '\x1b[0m'
  const BORDER = '\x1b[36m'  // Cyan
  const hLine = '─'.repeat(w - 2)

  for (let row = 0; row < h; row++) {
    term.moveTo(x, y + row)
    if (row === 0) {
      term(BORDER + '┌' + hLine + '┐' + RESET)
    } else if (row === h - 1) {
      term(BORDER + '└' + hLine + '┘' + RESET)
    } else {
      term(BORDER + '│' + ' '.repeat(Math.max(0, w - 2)) + '│' + RESET)
    }
  }
}

/**
 * Vérifie si la taille du terminal a changé et redessine si nécessaire.
 */
function checkResize(): void {
  const tw = termWidth()
  const th = termHeight()
  const sizeChanged = (tw !== lastTermSize.w || th !== lastTermSize.h)

  if (!sizeChanged && !forceRedraw) return
  forceRedraw = false

  lastTermSize = { w: tw, h: th }
  lastTitleHash = ''
  lastStatusHash = ''

  try { term.eraseDisplay() } catch { /* ignorer */ }

  recalcRegions()
  drawBorder()
  drawTitleBar()
  drawStatusBar()
  // Le contenu est redessiné par le collectAll() appelant
}

// ── Rendu ──

/**
 * Dessine la barre de titre (ligne 0) avec anti-flicker (hash).
 */
function drawTitleBar(): void {
  const tw = termWidth()
  const daemonAlive = checkDaemon()
  const uptime = Math.floor((Date.now() - startTime) / 1000)

  const th = termHeight()
  const hash = `${tw}:${th}:${daemonAlive}:${uptime}`
  if (hash === lastTitleHash) return
  lastTitleHash = hash

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
 * Dessine une scrollbar verticale sur le côté droit de la zone de contenu.
 * @param innerH - Hauteur intérieure de la zone de contenu
 */
function drawScrollbar(innerH: number): void {
  if (maxScrollLines <= 0 || innerH < 2) return

  const r = contentRegion
  const { x, y, w } = r
  const scrollbarCol = x + w - 2  // dernière colonne à l'intérieur de la bordure

  // Taille du pouce proportionnelle à la part visible
  const totalLines = innerH + maxScrollLines
  const thumbSize = Math.max(1, Math.round(innerH * innerH / totalLines))

  // Position du pouce (0 = tout en haut, innerH - thumbSize = tout en bas)
  const maxThumbTop = innerH - thumbSize
  const thumbPos = maxScrollLines > 0
    ? Math.round((scrollOffset / maxScrollLines) * maxThumbTop)
    : 0

  const RESET = '\x1b[0m'
  const THUMB = '\x1b[37m'    // blanc
  const TRACK = '\x1b[90m'     // gris foncé

  for (let row = 0; row < innerH; row++) {
    term.moveTo(scrollbarCol, y + 1 + row)
    if (row >= thumbPos && row < thumbPos + thumbSize) {
      term(THUMB + '█' + RESET)
    } else {
      term(TRACK + '│' + RESET)
    }
  }
}

/**
 * Dessine la zone de contenu (dans contentRegion, entre la bordure) avec support du scroll.
 * @param lines - Toutes les lignes de l'historique (buildDisplayLines)
 * @param offset - Nombre de lignes à sauter depuis le début (scroll)
 */
function drawContent(lines: string[], offset: number): void {
  const r = contentRegion
  const { x, y, w, h } = r
  const innerH = h - 2  // à l'intérieur de la bordure (haut + bas)
  if (innerH < 1) return

  // Réserver 1 colonne pour la scrollbar
  const maxCols = w - 3
  if (maxCols < 1) return

  const RESET = '\x1b[0m'
  const BG_DARK = '\x1b[48;5;236m'

  for (let row = 0; row < innerH; row++) {
    const lineIdx = offset + row
    term.moveTo(x + 1, y + 1 + row)
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

  // Scrollbar par-dessus la dernière colonne
  drawScrollbar(innerH)
}

/**
 * Saute à une position de scroll et redessine le contenu + barres.
 * Utilisé par le clavier (flèches), la molette, et le clic sur la scrollbar.
 */
function scrollTo(newOffset: number): void {
  const clamped = Math.max(0, Math.min(maxScrollLines, newOffset))
  if (clamped === scrollOffset) return
  scrollOffset = clamped
  const lines = buildDisplayLines(allHistory)
  drawContent(lines, scrollOffset)
  drawStatusBar()
  newCount = 0
  const total = allHistory.length
  const daemonStatus = checkDaemon() ? 'actif' : 'mort'
  const scrollHint = scrollOffset > 0 ? ` \u2191${scrollOffset}` : ''
  term('\x1b]0;' + `Notifications Viewer — ${total} notifications — daemon ${daemonStatus}${scrollHint}` + '\x07')
}

/**
 * Dessine la barre d'état (dernière ligne) avec anti-flicker (hash).
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

  const th = termHeight()
  const hash = `${tw}:${th}:${total}:${urgent}:${warning}:${scrollOffset}:${newCount}`
  if (hash === lastStatusHash) return
  lastStatusHash = hash

  let status = ` Total: ${total}`
  if (newCount > 0) status += ` | 🆕 ${newCount} nouvelle${newCount > 1 ? 's' : ''}`
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
    // Vérifier redimensionnement (anti-flicker) + rafraîchir la taille Windows
    checkResize()
    refreshWindowsSize()

    // Charger les archives des derniers jours
    // L'archive est la source unique : pushNotification() écrit toujours dans les deux
    // fichiers (live + archive), mais le CLI vide notifications.json. L'archive persiste.
    const archived = loadArchivedNotifications(ARCHIVE_FALLBACK_DAYS)

    // Filtrer : ne garder que les notifications postérieures au démarrage du viewer
    // (les archives des sessions précédentes sont ignorées)
    const allSources = archived
    let addedThisCycle = 0

    for (const n of allSources) {
      if (!knownIds.has(n.id)) {
        knownIds.add(n.id)
        // Ignorer les notifications antérieures au démarrage (ancienne session)
        // ou avec un timestamp invalide (corrompu)
        const notifTime = new Date(n.timestamp).getTime()
        if (Number.isNaN(notifTime) || notifTime < sessionStartTime) continue
        allHistory.push(n)
        addedThisCycle++
      }
    }

    if (addedThisCycle > 0) newCount += addedThisCycle

    // Tronquer si trop grand
    if (allHistory.length > MAX_HISTORY) {
      allHistory = allHistory.slice(allHistory.length - MAX_HISTORY)
    }

    // Trier : les plus récentes en premier
    allHistory.sort((a, b) => b.timestamp.localeCompare(a.timestamp))

    const lines = buildDisplayLines(allHistory)
    const contentHeight = contentRegion.h - 2  // hauteur intérieure entre les bordures
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
    newCount = 0
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

  try {
    term.grabInput(false)
    term.hideCursor(false)
    term.fullscreen(false)
    term.styleReset()
    term('\nFermeture du visionneur de notifications.\n')
  } catch { /* ignore */ }
  process.exit(0)
}

// ── Initialisation ──

function initUI(): void {
  try {
    term.fullscreen(true)
    term.hideCursor(true)
    term.grabInput({ mouse: 'button' })

    // Marquer la taille initiale + dessiner le cadre et la barre de titre
    lastTermSize = { w: termWidth(), h: termHeight() }
    recalcRegions()
    drawBorder()
    drawTitleBar()
    drawStatusBar()

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

        // ── Touche 'r' : force un redessin complet ──
        if (name === 'r' || name === 'R') {
          lastTitleHash = lastStatusHash = ''
          forceRedraw = true
          try { term.eraseDisplay() } catch { /* ignorer */ }
          collectAll()
          return
        }

        // ── Gestion du scroll ──
        if (name === 'UP') {
          if (scrollOffset > 0) scrollTo(scrollOffset - 1)
          return
        }
        if (name === 'DOWN') {
          if (scrollOffset < maxScrollLines) scrollTo(scrollOffset + 1)
          return
        }
        if (name === 'PAGE_UP') {
          const contentHeight = contentRegion.h - 2
          scrollTo(scrollOffset - contentHeight)
          return
        }
        if (name === 'PAGE_DOWN') {
          const contentHeight = contentRegion.h - 2
          scrollTo(scrollOffset + contentHeight)
          return
        }
        if (name === 'HOME') {
          scrollTo(0)
          return
        }
        if (name === 'END') {
          scrollTo(maxScrollLines)
          return
        }
      })
    } catch { /* pas de clavier */ }

    try {
      term.on('mouse', (name: string, data: { x: number; y: number }) => {
        // ── Molette : 3 lignes par cran ──
        if (name === 'MOUSE_WHEEL_UP') {
          if (scrollOffset > 0) scrollTo(scrollOffset - 3)
          return
        }
        if (name === 'MOUSE_WHEEL_DOWN') {
          if (scrollOffset < maxScrollLines) scrollTo(scrollOffset + 3)
          return
        }

        // ── Clic gauche sur la scrollbar : saut proportionnel ──
        if (name !== 'MOUSE_LEFT_BUTTON_PRESSED') return
        const r = contentRegion
        const scrollbarCol = r.x + r.w - 2
        if (data.x !== scrollbarCol) return
        const innerH = r.h - 2
        if (maxScrollLines <= 0 || innerH < 2) return

        const trackTop = r.y + 1
        const relativeY = data.y - trackTop
        if (relativeY < 0 || relativeY >= innerH) return

        const ratio = Math.max(0, Math.min(1, relativeY / (innerH - 1)))
        scrollTo(Math.round(ratio * maxScrollLines))
      })
    } catch { /* pas de souris */ }
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
  const r = contentRegion
  const { x, y, w, h } = r
  const innerH = h - 2  // à l'intérieur de la bordure (haut + bas)
  if (innerH < 1) return

  const lines = msg.split('\n')
  const maxCols = w - 2  // à l'intérieur de la bordure
  const RESET = '\x1b[0m'
  const BG_DARK = '\x1b[48;5;236m'

  for (let row = 0; row < innerH; row++) {
    term.moveTo(x + 1, y + 1 + row)
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
