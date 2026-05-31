#!/usr/bin/env node
/**
 * telecom-watcher-console.ts — Console de surveillance TUI pour l'écosystème telecom
 *
 * Usage:
 *   node dist/telecom/service/telecom-watcher-console.js
 *
 * Affiche 3 quadrants en temps réel (lecture seule) :
 *   Q1 (TL) : Communications — Intercom + Routage (fusionnés)
 *   Q2 (BL) : Agents — spawns, livrables, erreurs
 *   Q3 (BR) : Logs — logbook et notifications
 *
 * Rafraîchissement : fs.watch + polling 1s.
 * Détection de mort du daemon parent via telecom/daemon.pid.
 * Se ferme automatiquement si le daemon parent meurt.
 *
 * Rendu : utilise term.box() + term.moveTo() + term.eraseLine()
 *   (pas de Document model — plus fiable sur Windows)
 */

// ── Imports ──
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, watch, unlinkSync } from 'node:fs'
import { join } from 'node:path'

import { computeColumnLayout } from './telecom-console-layout.js'
import { persistAllQuadrants } from './telecom-watcher-persist.js'
import { parseLogbookTime, parseLogbookSource, parseLogbookMessage } from './telecom-log-parser.js'

const require$ = createRequire(import.meta.url)

const termkit = require$('terminal-kit')

const term = termkit.terminal

// ── Constantes ──
const CWD = process.cwd()
const TELECOM_DIR = join(CWD, 'telecom')
const INTERCOM_DIR = join(TELECOM_DIR, 'intercom')
const ROUTED_DIR = join(TELECOM_DIR, 'routed')
const AGENTS_DIR = join(TELECOM_DIR, 'agents')
const LOGBOOK_PATH = join(CWD, 'telecom', 'agent-logbook.md')
const STATUS_FILE = join(CWD, 'telecom', 'daemon.status.json')
const PID_FILE = join(CWD, 'telecom', 'daemon.pid')
const WATCHER_PID_FILE = join(CWD, 'telecom', 'watcher.pid')
const WATCHER_SHUTDOWN_FILE = join(CWD, 'telecom', 'watcher.shutdown')
const NOTIFY_PATH = join(CWD, 'telecom', 'notifications.json')
const RESIZE_DEBUG_PATH = join(CWD, 'telecom', 'resize-debug.log')
const POLL_INTERVAL = 1000 // 1 seconde
const DAEMON_CHECK_INTERVAL = 5000 // 5 secondes

// ── Types ──
interface Region {
  x: number
  y: number
  w: number
  h: number
}

interface QuadrantData {
  region: Region
  title: string
  lastHash: string
  lastContent: string
}

// ── État global ──
const QUADRANTS: Record<string, QuadrantData> = {
  comms: { region: { x: 0, y: 0, w: 0, h: 0 }, title: ' Communications ', lastHash: '', lastContent: '' },
  agents: { region: { x: 0, y: 0, w: 0, h: 0 }, title: ' Agents ', lastHash: '', lastContent: '' },
  logs: { region: { x: 0, y: 0, w: 0, h: 0 }, title: ' Logs & Notifications ', lastHash: '', lastContent: '' },
}

const startTime = Date.now()
let shutdownScheduled = false
let watchers: ReturnType<typeof watch>[] = []
let pendingIntercomCount = 0
let redAlertTriggered = false
let redAlertTotal = 0
let redAlertResolved = 0
let lastRedAlertTime: number | null = null
// Cache des dimensions PowerShell (Windows uniquement) — rafraîchi tous les 3 cycles
// DÉCLARÉ AVANT lastTermSize car termWidth() y accède (TDZ bug si inversé)
let psCacheSize = { w: 80, h: 24 }
let cycleCounter = 0

// Cache léger UNIQUEMENT pour l'effacement écran (évite le flickering)
// Les régions et le redessin sont TOUJOURS exécutés sans condition.
// Initialisé APRÈS psCacheSize pour éviter ReferenceError (Temporal Dead Zone)
let lastTermSize = { w: termWidth(), h: termHeight() }

// ── Thèmes de couleurs des quadrants ──
const QUADRANT_THEMES: Record<string, { border: string; bg: string }> = {
  comms:  { border: '\x1b[36m', bg: '\x1b[48;5;24m' },  // Cyan (fusion Intercom + Routage)
  agents:   { border: '\x1b[33m', bg: '\x1b[48;5;94m' },  // Orange/Jaune
  logs:     { border: '\x1b[36m', bg: '\x1b[48;5;24m' },  // Cyan/Teal
}

// ── Dimensions safe ──

/**
 * Vérifie si la taille du terminal a changé et redessine si nécessaire.
 *
 * NE redessine les bordures et contenus QUE si la taille a réellement
 * changé — pas de redessin inutile à chaque cycle (cause de flicker).
 *
 * Principe :
 *   - Les régions utilisent `termWidth()/termHeight()` toujours à jour.
 *   - Le cache `lastTermSize` sert à la fois pour l'effacement ET pour
 *     décider si un redessin des bordures/contenus est nécessaire.
 *   - `updateQuadrant()` dans `collectAll()` gère déjà le rafraîchissement
 *     des contenus transformés (via hash).
 */
function checkResize(): void {
  const tw = termWidth()
  const th = termHeight()
  const sizeChanged = (tw !== lastTermSize.w || th !== lastTermSize.h)

  if (!sizeChanged && !forceRedraw) return  // ← RIEN si taille stable + pas de force
  forceRedraw = false

  // La taille a changé (ou force) → recalculer régions, effacer et tout redessiner
  lastTermSize = { w: tw, h: th }

  // Logger les dimensions pour diagnostic
  try {
    const logLine = `[${new Date().toISOString()}] RESIZE: w=${tw} h=${th} | stdout.columns=${process.stdout.columns} stdout.rows=${process.stdout.rows} term.width=${term.width} term.height=${term.height}\n`
    writeFileSync(RESIZE_DEBUG_PATH, logLine, { flag: 'a', encoding: 'utf-8' })
  } catch { /* ignorer */ }
  try { term.eraseDisplay() } catch { /* ignorer */ }

  // Redessiner toutes les bordures aux nouvelles dimensions
  recalcRegions()
  for (const id of ['comms', 'agents', 'logs'] as const) {
    drawQuadrantBorder(id)
  }

  // Réécrire les contenus existants aux nouvelles dimensions
  for (const id of ['comms', 'agents', 'logs'] as const) {
    if (QUADRANTS[id].lastContent) {
      writeQuadrantContent(id, QUADRANTS[id].lastContent)
    }
  }
}

// ── Anti-flicker: hash caches pour les barres ──
let lastTitleHash = ''
let lastStatusHash = ''
let lastSecondaryHash = ''

// Flag pour forcer un redessin complet au prochain cycle (touche 'r')
let forceRedraw = false

/**
 * Récupère la taille réelle de la console Windows via PowerShell
 * qui lit directement l'API Console Windows (GetConsoleScreenBufferInfo).
 * 
 * Sur Windows, process.stdout.columns/rows et term.width/height peuvent
 * être figés après l'initialisation. PowerShell contourne ce problème.
 * Coût : ~50-100ms par appel — d'où le cache de 3 cycles.
 *
 * Commande simplifiée : pas de guillemets imbriqués, chaque valeur sur sa
 * propre ligne pour éviter les problèmes de parsing sur les shells Windows.
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
 * Rafraîchit le cache PowerShell si nécessaire.
 * Premier appel immédiat (cycle 1), puis tous les 3 cycles.
 * Appelé une fois par cycle depuis collectAll() pour éviter les doubles appels.
 */
function refreshWindowsSize(): void {
  if (process.platform !== 'win32') return
  cycleCounter++
  // Premier cycle immédiat, puis tous les 3 cycles
  if (cycleCounter === 1 || cycleCounter % 3 === 0) {
    const real = getWindowsConsoleSize()
    if (real.w > 0 && real.h > 0) {
      psCacheSize = { w: real.w, h: real.h }
    }
  }
}

/**
 * Retourne la largeur du terminal.
 * Sur Windows : utilise le cache PowerShell (rafraîchi tous les 3 cycles).
 * Fallback : process.stdout.columns → term.width → 80.
 */
function termWidth(): number {
  if (process.platform === 'win32' && psCacheSize.w > 0) {
    return psCacheSize.w
  }
  const w = process.stdout.columns ?? term.width
  return (typeof w === 'number' && w > 0 && isFinite(w)) ? Math.floor(w) : 80
}

/**
 * Retourne la hauteur du terminal.
 * Sur Windows : utilise le cache PowerShell (rafraîchi tous les 3 cycles).
 * Fallback : process.stdout.rows → term.height → 24.
 */
function termHeight(): number {
  if (process.platform === 'win32' && psCacheSize.h > 0) {
    return psCacheSize.h
  }
  const h = process.stdout.rows ?? term.height
  return (typeof h === 'number' && h > 0 && isFinite(h)) ? Math.floor(h) : 24
}

// ── Dessin des quadrants ──

/**
 * Calcule les régions des 3 quadrants :
 *   - Top : Communications (Intercom + Routage fusionnés) — pleine largeur
 *   - Bottom-left : Agents
 *   - Bottom-right : Logs
 *
 * Layout :
 *   ┌──── Communications (Intercom + Routage) ────┐
 *   │                                               │
 *   ├──── Agents ────┤ ├──── Logs & Notifications ─┤
 *   │                 │ │                            │
 *   └─────────────────┘ └────────────────────────────┘
 */
function recalcRegions(): void {
  const tw = termWidth()
  const th = termHeight()

  // 2 colonnes pour la ligne du bas (Agents | Logs)
  const layout = computeColumnLayout(tw, th, 2)

  const rowGap = 1
  const topHeight = Math.floor((layout.columnHeight - rowGap) * 0.5)
  const bottomHeight = layout.columnHeight - topHeight - rowGap

  // Top : Communications — pleine largeur
  QUADRANTS.comms.region = {
    x: 1,                            // MARGIN = 1
    y: 1,
    w: Math.max(4, tw - 2),          // pleine largeur - marges
    h: Math.max(3, topHeight),
  }

  // Bottom-left : Agents
  QUADRANTS.agents.region = {
    x: layout.columns[0].x,
    y: 1 + topHeight + rowGap,
    w: layout.columns[0].w,
    h: Math.max(3, bottomHeight),
  }

  // Bottom-right : Logs
  QUADRANTS.logs.region = {
    x: layout.columns[1].x,
    y: 1 + topHeight + rowGap,
    w: layout.columns[1].w,
    h: Math.max(3, bottomHeight),
  }
}

/** Dessine la bordure et le titre d'un quadrant (ASCII uniquement — fiable sur Windows cmd) */
function drawQuadrantBorder(id: string): void {
  const r = QUADRANTS[id].region
  const title = QUADRANTS[id].title
  const theme = QUADRANT_THEMES[id]
  const { x, y, w, h } = r
  if (w < 4 || h < 3) return

  // +-- Title ---------+
  // |                  |
  // +------------------+
  const RESET = '\x1b[0m'
  const hLine = '-'.repeat(w - 2)
  const titleBar = title + '-'.repeat(Math.max(0, w - 2 - title.length))

  for (let row = 0; row < h; row++) {
    term.moveTo(x, y + row)
    if (row === 0) {
      term(theme.border + '+' + titleBar.slice(0, w - 2) + '+' + RESET)
    } else if (row === h - 1) {
      term(theme.border + '+' + hLine + '+' + RESET)
    } else {
      term(theme.border + '|' + ' '.repeat(Math.max(0, w - 2)) + '|' + RESET)
    }
  }
}

/**
 * Réécrit le contenu d'un quadrant (sans redessiner la bordure)
 * avec zebra striping (fond gris alterné sur les lignes paires).
 */
function writeQuadrantContent(id: string, text: string): void {
  const r = QUADRANTS[id].region
  const theme = QUADRANT_THEMES[id]
  const { x, y, w, h } = r
  if (w < 4 || h < 3) return

  const lines = text.split('\n')
  const maxLines = h - 2
  const maxCols = w - 2
  const BG_DARK = theme.bg  // fond teinté selon le quadrant
  const RESET = '\x1b[0m'

  for (let row = 0; row < maxLines; row++) {
    term.moveTo(x + 1, y + 1 + row)

    if (row < lines.length) {
      // Échapper % (terminal-kit les interprète comme formatteur printf)
      const line = lines[row].replace(/%/g, '%%')
      // Utiliser visibleWidth() + truncateAnsiWidth() pour éviter que les
      // codes ANSI (bold, couleurs) ou les émojis double-largeur (✅📖⏳)
      // faussent le calcul de longueur. Avant : line.length / line.slice()
      // qui coupait au milieu des ANSI → bordure droite écrasée, mots
      // tronqués (ex: "Statut" → "statu"), émojis débordants.
      const lineW = visibleWidth(line)
      const display = lineW >= maxCols ? truncateAnsiWidth(line, maxCols) : line + ' '.repeat(maxCols - lineW)

      if (row % 2 === 1) {
        // Zebra : fond teinté, ré-appliqué après chaque reset interne
        const striped = BG_DARK + display.replace(/\x1b\[0m/g, RESET + BG_DARK)
        term(striped + RESET)
      } else {
        term(display)
      }
    } else if (row % 2 === 1) {
      // Ligne vide paire → fond teinté aussi pour l'alternance
      term(BG_DARK + ' '.repeat(maxCols) + RESET)
    } else {
      term(' '.repeat(maxCols))
    }
  }
}



// ── Barre de titre ──

const TOP_TITLE = ' MINAUTOR Agents Service — Surveillance des communications '

/** Dessine la barre de titre en haut (ligne 0, fond bleu, texte blanc centré) */
function drawTitleBar(): void {
  const tw = termWidth()
  const pending = pendingIntercomCount
  const hasTimer = lastRedAlertTime !== null
  const dimLabel = ` [W:${tw} H:${termHeight()}] `

  // Hash → sauter le redessin si rien n'a changé (anti-flicker)
  const hash = `${tw}:${pending}:${redAlertTriggered}:${redAlertTotal}:${hasTimer}`
  if (hash === lastTitleHash) return
  lastTitleHash = hash

  term.moveTo(0, 0)

  // Badge de compteur en attente
  const badge = pending > 0
    ? ` ${pending} en attente `
    : ''

  // Timer depuis la derniere alerte rouge
  let timerText = ''
  if (hasTimer && lastRedAlertTime !== null) {
    const elapsed = Math.floor((Date.now() - lastRedAlertTime) / 1000)
    timerText = ` +${formatUptime(elapsed)} `
  }

  // Titre complet avec badge + timer
  const fullTitle = TOP_TITLE + badge + timerText

  // Centrer le titre dans la largeur du terminal
  const centered = fullTitle.length >= tw
    ? fullTitle.slice(0, tw)
    : ' '.repeat(Math.floor((tw - fullTitle.length) / 2)) + fullTitle + ' '.repeat(Math.ceil((tw - fullTitle.length) / 2))
  // Rattacher l'indicateur de dimensions à droite (sans casser le centrage)
  const padded = dimLabel.length >= tw
    ? dimLabel.slice(0, tw)
    : centered.slice(0, tw - dimLabel.length) + dimLabel

  // Si badge présent, utiliser yellow/green pour le compteur
  if (pending > 0 || timerText) {
    const badgePos = padded.indexOf(badge)
    const timerPos = timerText ? padded.indexOf(timerText) : -1

    // Si le badge et le timer sont visibles dans la zone centrée
      if (badgePos !== -1 || timerPos !== -1) {
      let cursor = 0

      // Dessiner les segments un par un (bleu / badge / bleu / timer / bleu)
      const segments: { start: number; end: number; style: 'blue' | 'badge' | 'timer' }[] = []

      if (badgePos !== -1 && badge.length > 0) {
        segments.push({ start: 0, end: badgePos, style: 'blue' })
        segments.push({ start: badgePos, end: badgePos + badge.length, style: 'badge' })
        cursor = badgePos + badge.length
      }
      if (timerPos !== -1) {
        segments.push({ start: cursor, end: timerPos, style: 'blue' })
        segments.push({ start: timerPos, end: timerPos + timerText.length, style: 'timer' })
        cursor = timerPos + timerText.length
      }
      if (cursor < padded.length) {
        segments.push({ start: cursor, end: padded.length, style: 'blue' })
      }

      for (const seg of segments) {
        const text = padded.slice(seg.start, seg.end)
        if (seg.style === 'blue') {
          term.bgBlue.white.bold(text)
        } else if (seg.style === 'badge') {
          if (pending > 20) {
            term.bgRed.black.bold(text)
          } else if (pending >= 10) {
            term.bgYellow.black.bold(text)
          } else {
            term.bgGreen.black.bold(text)
          }
        } else if (seg.style === 'timer') {
          if (pending > 20) {
            term.bgRed.black.bold(text)
          } else if (pending >= 10) {
            term.bgYellow.black.bold(text)
          } else {
            term.bgGreen.black.bold(text)
          }
        }
      }
    } else {
      // Badge/Timer tronqués — fond bleu uniforme
      term.bgBlue.white.bold(padded)
    }
  } else {
    term.bgBlue.white.bold(padded)
  }

  term.bgBlack.defaultColor()
}

// ── Barres d'état ──

/** Barre d'état principale (ligne th-1) — infos watcher */
function drawStatusBar(): void {
  const th = termHeight()
  const tw = termWidth()
  const uptime = Math.floor((Date.now() - startTime) / 1000)
  const daemonAlive = checkDaemon()

  // Hash → sauter le redessin si rien n'a changé (anti-flicker)
  const hash = `${tw}:${th}:${redAlertTotal}:${redAlertResolved}:${pendingIntercomCount}:${uptime}:${daemonAlive}`
  if (hash === lastStatusHash) return
  lastStatusHash = hash

  term.moveTo(0, th - 1)
  const alertLabel = redAlertTotal > 0 ? ` | Alertes: ${redAlertTotal}` : ''
  const label = ` Watcher PID: ${process.pid} | Uptime: ${formatUptime(uptime)} | Daemon: ${daemonAlive ? 'actif' : 'mort'}${alertLabel}  `
  term.bgWhite.black(label + ' '.repeat(Math.max(0, tw - label.length)))
  term.bgBlack.defaultColor()
}

/** Barre secondaire (ligne th-2) — compteurs */
function drawSecondaryStatusBar(): void {
  const th = termHeight()
  const tw = termWidth()

  // Hash → sauter le redessin si rien n'a changé (anti-flicker)
  const hash = `${tw}:${th}:${redAlertTotal}:${redAlertResolved}:${pendingIntercomCount}`
  if (hash === lastSecondaryHash) return
  lastSecondaryHash = hash

  term.moveTo(0, th - 2)

  const parts: string[] = []
  parts.push(`Alertes: ${redAlertTotal}`)
  parts.push(`Resolues: ${redAlertResolved}`)
  parts.push(`En attente: ${pendingIntercomCount}`)

  const label = ' ' + parts.join(' | ') + '  '
  term.bgBrightBlack.white(label + ' '.repeat(Math.max(0, tw - label.length)))
  term.bgBlack.defaultColor()
}

/** Met à jour le titre de la fenêtre du terminal via ANSI escape (Windows inclus) */
function setTerminalTitle(title: string): void {
  try {
    // \x1b = ESC, \x07 = BEL — séquence ANSI standard pour le titre de fenêtre
    term('\x1b]0;' + title + '\x07')
  } catch {
    // Ignorer si le terminal ne supporte pas
  }
}

// ── Helpers ANSI (visuel vs string length) ──

/**
 * Retourne la largeur d'affichage d'un caractère (1 = normal, 2 = double-largeur).
 * Certains terminaux affichent les émojis et certains symboles sur 2 cellules
 * au lieu d'1, ce qui fait déborder le contenu si on ne compte que length.
 */
function charWidth(cp: number): number {
  // Émojis et symboles du plan supplémentaire (U+1F000+)
  if (cp >= 0x1F000 && cp <= 0x1FFFF) return 2
  // Symboles divers (U+2600-U+26FF) — la plupart sont simple, mais certains doubles
  // ⏳ U+23F3 — double sur Windows Terminal
  if (cp === 0x23F3) return 2
  // ✅ U+2705 (Dingbats) — double
  if (cp === 0x2705) return 2
  // ⬜ U+2B1C, ⬛ U+2B1B — doubles
  if (cp >= 0x2B1B && cp <= 0x2B1C) return 2
  // ⭐ U+2B50 — double
  if (cp === 0x2B50) return 2
  // Variation selectors (U+FE0F) — largeur 0
  if (cp === 0xFE0F) return 0
  // Zero-width joiner (U+200D) — largeur 0
  if (cp === 0x200D) return 0
  // Symboles de bloc (sparkline) U+2580-U+259F — simple
  // Checkmarks, flèches, symboles géométriques — simple
  return 1
}

/**
 * Retourne la largeur VISIBLE d'une chaîne, ignorant les codes ANSI
 * ET en comptant les caractères double-largeur (émojis) pour 2.
 *
 * Sans ça :
 *   - Les codes ANSI gonflent `line.length` → padding inexact
 *   - Les émojis (✅📖⏳) prennent 2 cellules mais sont comptés pour 1 → débordent
 */
function visibleWidth(text: string): number {
  const plain = text.replace(/\x1b\[[0-9;]*m/g, '')
  let w = 0
  for (const ch of plain) {
    w += charWidth(ch.codePointAt(0) ?? 1)
  }
  return w
}

/**
 * Tronque une chaîne à `maxCols` cellules VISIBLES, en préservant
 * intacts les codes ANSI (couleurs, gras) et en respectant la largeur
 * réelle des caractères (émojis double-largeur).
 *
 * Remplace `line.slice(0, maxCols)` qui coupait au milieu des \x1b[...m
 * et ne gérait pas les émojis. Résultat :
 *   - plus de bordure droite écrasée par un débordement
 *   - plus de mots tronqués au milieu d'un code ANSI
 */
function truncateAnsiWidth(text: string, maxCols: number): string {
  const ansiRegex = /\x1b\[[0-9;]*m/g
  let result = ''
  let visW = 0
  let lastIdx = 0
  let match: RegExpExecArray | null

  while ((match = ansiRegex.exec(text)) !== null) {
    // Segment visible entre lastIdx et ce code ANSI
    const segment = text.slice(lastIdx, match.index)
    const taken = takeVisible(segment, maxCols - visW)
    result += taken.text
    visW += taken.width
    if (visW >= maxCols) return result
    // Conserver le code ANSI intact
    result += match[0]
    lastIdx = ansiRegex.lastIndex
  }

  // Texte restant après le dernier code ANSI
  if (visW < maxCols) {
    const remaining = text.slice(lastIdx)
    result += takeVisible(remaining, maxCols - visW).text
  }

  return result

  /** Sous-fonction : prend autant de caractères visibles que possible sans dépasser budget */
  function takeVisible(str: string, budget: number): { text: string; width: number } {
    if (budget <= 0) return { text: '', width: 0 }
    let out = ''
    let w = 0
    for (const ch of str) {
      const cw = charWidth(ch.codePointAt(0) ?? 1)
      if (w + cw > budget) break
      out += ch
      w += cw
    }
    return { text: out, width: w }
  }
}

// ── Mise à jour des quadrants ──

function simpleHash(str: string): string {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i)
    h |= 0
  }
  return h.toString(36)
}

function updateQuadrant(id: string, content: string): void {
  const q = QUADRANTS[id]
  const hash = simpleHash(content)
  if (hash === q.lastHash) return

  q.lastHash = hash
  q.lastContent = content
  writeQuadrantContent(id, content)
}

// ── Collecte des données ──

/** Marque un texte avec ANSI via la méthode term.color() */
function col(text: string, colorName: 'yellow' | 'green' | 'dim' | 'red' | 'cyan'): string {
  // On utilise des séquences ANSI directement (fiables sur tous les terminaux)
  const codes: Record<string, string> = {
    yellow: '\x1b[33m',
    green: '\x1b[32m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    cyan: '\x1b[36m',
    reset: '\x1b[0m',
  }
  return codes[colorName] + text + codes.reset
}

/** Met un texte en gras via ANSI */
function bold(text: string): string {
  return '\x1b[1m' + text + '\x1b[22m'
}

function collectCommsData(): string {
  const lines: string[] = []
  let pending = 0
  let read = 0
  let processed = 0

  // 1. Intercom — messages entrants
  if (existsSync(INTERCOM_DIR)) {
    const files = readdirSync(INTERCOM_DIR).filter(f => f.endsWith('.json')).sort()
    for (const f of files) {
      try {
        const raw = readFileSync(join(INTERCOM_DIR, f), 'utf-8')
        const msg = JSON.parse(raw)
        const time = (msg.timestamp || '').slice(11, 19)
        const status: string = msg.status || 'pending'

        let icon: string
        let color: 'yellow' | 'green' | 'dim'
        if (status === 'pending') {
          icon = '⏳'
          color = 'yellow'
          pending++
        } else if (status === 'read') {
          icon = '📖'
          color = 'green'
          read++
        } else {
          icon = '✅'
          color = 'dim'
          processed++
        }

        const sujet = (msg.subject || '').slice(0, 20)
        const fromColored = col((msg.from || '?').padEnd(12), color)
        const toColored = (msg.to || '?').padEnd(12)
        lines.push(` ${icon} ${time} ${fromColored}→ ${toColored} ${sujet}`)
      } catch {
        /* ignorer */
      }
    }
  }

  pendingIntercomCount = pending

  // 2. Routages — messages routés (sous les intercom)
  const routingLines: string[] = []
  if (existsSync(ROUTED_DIR)) {
    const files = readdirSync(ROUTED_DIR).filter(f => f.endsWith('.json')).sort()
    for (const f of files) {
      try {
        const raw = readFileSync(join(ROUTED_DIR, f), 'utf-8')
        const msg = JSON.parse(raw)
        const time = (msg.timestamp || '').slice(11, 19)
        routingLines.push(` ${time} ${(msg.from || '?').padEnd(12)}→ ${(msg.to || '?').padEnd(12)} ${(msg.subject || '').slice(0, 25)}`)
      } catch {
        /* ignorer */
      }
    }
  }

  // 3. Stats du daemon
  let stats = ''
  if (existsSync(STATUS_FILE)) {
    try {
      const raw = readFileSync(STATUS_FILE, 'utf-8')
      const status = JSON.parse(raw)
      const pendingCol = pending > 0 ? col(String(pending), 'yellow') : String(pending)
      stats = `[Msg:${status.totalMessagesRouted ?? '?'} Spawn:${status.totalSpawns ?? '?'} Bloc:${status.totalBlocks ?? '?'} Ag:${status.agentCount ?? '?'}] [En att: ${pendingCol} | Lus: ${read} | Tr: ${processed}]`
    } catch {
      const pendingCol = pending > 0 ? col(String(pending), 'yellow') : String(pending)
      stats = `[Total: ${lines.length} | En att: ${pendingCol} | Lus: ${read} | Tr: ${processed}]`
    }
  }

  // Assemblage
  let output = stats

  if (lines.length > 0) {
    output += '\n' + bold('─ Intercom ─'.padEnd(40)) + '\n' + lines.join('\n')
  }

  if (routingLines.length > 0) {
    output += '\n' + bold('─ Routages ─'.padEnd(40)) + '\n' + routingLines.join('\n')
  }

  if (lines.length === 0 && routingLines.length === 0) {
    output += '\n(aucune communication)'
  }

  return output
}

function collectAgentsData(): string {
  const lines: string[] = []

  // Lire les spawns actifs depuis le status file pour les intégrer dans les lignes
  const activeSpawns = new Map<string, { subject: string; runningFor: number }>()
  if (existsSync(STATUS_FILE)) {
    try {
      const raw = readFileSync(STATUS_FILE, 'utf-8')
      const status = JSON.parse(raw)
      if (Array.isArray(status.activeSpawns)) {
        for (const s of status.activeSpawns) {
          const runningFor = Math.floor((Date.now() - new Date(s.startedAt).getTime()) / 1000)
          activeSpawns.set(s.agentId, { subject: s.subject || '', runningFor })
        }
      }
    } catch {
      /* ignorer */
    }
  }

  if (existsSync(AGENTS_DIR)) {
    const agentDirs = readdirSync(AGENTS_DIR).filter(f => {
      try { return statSync(join(AGENTS_DIR, f)).isDirectory() } catch { return false }
    }).sort()

    for (const agentId of agentDirs) {
      const agentPath = join(AGENTS_DIR, agentId)
      try {
        const files = readdirSync(agentPath).filter(f => f !== 'README.md' && f !== '.gitkeep')
        const livrables = files.filter(f => f.startsWith('livrable-'))
        const erreurs = files.filter(f => f.startsWith('erreur-'))

        // Vérifier si l'agent est actuellement en cours de spawn
        const active = activeSpawns.get(agentId)

        let icon: string
        let line: string

        if (active) {
          // Agent actif — indicateur visuel coloré + temps écoulé + sujet
          icon = col('▶', 'green')
          const runningLabel = col(`[${active.runningFor}s]`, 'yellow')
          const sujet = active.subject ? ` ${col(active.subject.slice(0, 24), 'dim')}` : ''
          line = `${icon} ${col(agentId.padEnd(18), 'green')} ${runningLabel}${sujet}`
        } else {
          // Agent inactif — icône selon état, activité alignée
          const idPad = agentId.padEnd(18)
          if (erreurs.length > 0) {
            icon = '✗'
            const dernierLivrable = livrables.length > 0 ? livrables.sort().pop()! : ''
            const date = dernierLivrable ? dernierLivrable.replace('livrable-', '').slice(0, 16).replace(/T/g, ' ') : '--/--/-- --:--'
            line = `${icon} ${idPad} ${date} +${erreurs.length}err`
          } else if (livrables.length > 0) {
            icon = '◈'
            const dernierLivrable = livrables.sort().pop()!
            const date = dernierLivrable.replace('livrable-', '').slice(0, 16).replace(/T/g, ' ')
            line = `${icon} ${idPad} ${date} +${livrables.length}liv`
          } else {
            icon = '■'
            line = `${icon} ${idPad} (idle)`
          }
        }

        lines.push(line)
      } catch {
        /* ignorer */
      }
    }
  }

  // Ajouter les spawns actifs qui n'ont PAS de dossier agent (orphans)
  // mais pas de section séparée — intégrés dans la liste
  for (const [agentId, info] of activeSpawns) {
    if (!lines.some(l => l.includes(agentId))) {
      const runningLabel = col(`[${info.runningFor}s]`, 'yellow')
      const sujet = info.subject ? ` ${col(info.subject.slice(0, 24), 'dim')}` : ''
      lines.push(`${col('▶', 'green')} ${col(agentId.padEnd(14), 'green')} ${runningLabel}${sujet}`)
    }
  }

  const colHeaders = `${bold('Agent'.padEnd(16))} ${bold('Activite'.padEnd(22))}`
  return colHeaders + (lines.length > 0 ? '\n' + lines.join('\n') : '\n(aucun agent)')
}



function collectLogsData(): string {
  const lines: string[] = []

  // Dernières entrées du logbook — on parse temps + source + message
  if (existsSync(LOGBOOK_PATH)) {
    try {
      const content = readFileSync(LOGBOOK_PATH, 'utf-8').trim()
      // Découper par sections ##
      const rawEntries = content.split('\n## ').filter(Boolean)
      for (const entry of rawEntries.slice(-15)) {
        const time = parseLogbookTime(entry)
        const source = parseLogbookSource(entry)
        const msg = parseLogbookMessage(entry, 70)
        if (msg) {
          lines.push(` ${time || '--:--:--'} ${source.padEnd(10)}${msg.slice(0, 70)}`)
        }
      }
    } catch {
      /* ignorer */
    }
  }

  // Dernières notifications
  if (existsSync(NOTIFY_PATH)) {
    try {
      const raw = readFileSync(NOTIFY_PATH, 'utf-8').trim()
      if (raw) {
        const notifs = JSON.parse(raw)
        if (Array.isArray(notifs)) {
          for (const n of notifs.slice(-10)) {
            const time = (n.timestamp || '').slice(11, 19)
            const msg = (n.message || '').split('\n')[0].slice(0, 80)
            if (msg) lines.push(` ${time} ${(n.from || '?').padEnd(10)}${msg}`)
          }
        }
      }
    } catch {
      /* ignorer */
    }
  }

  const colHeaders = `${bold('Heure'.padEnd(8))} ${bold('Source'.padEnd(10))} ${bold('Message'.padEnd(70))}`
  const dataLines = lines.length > 0 ? lines.slice(-30).join('\n') : '(aucun log)'

  return colHeaders + '\n' + dataLines}

function collectAll(): void {
  try {
    // Persistance des 4 quadrants en fichiers JSON (pour agent-telecom)
    persistAllQuadrants()

    checkResize() // recalcule régions + redessine bordures et contenus

    updateQuadrant('comms', collectCommsData())
    updateQuadrant('agents', collectAgentsData())
    updateQuadrant('logs', collectLogsData())

    // Alerte sonore + log au passage du seuil rouge (> 20)
    if (pendingIntercomCount > 20 && !redAlertTriggered) {
      redAlertTriggered = true
      redAlertTotal++
      lastRedAlertTime = Date.now()
      try { term('\x07') } catch { /* ignorer */ }
      try {
        const now = new Date()
        const ts = now.toISOString().replace('T', ' ').slice(0, 19)
        const entry = [
          '',
          `## Watcher Telecom (system)`,
          '',
          `**Date :** ${ts}`,
          `**Alerte :** Seuil rouge depasse — ${pendingIntercomCount} messages en attente dans intercom`,
          '',
        ].join('\n')
        writeFileSync(LOGBOOK_PATH, entry, { flag: 'a', encoding: 'utf-8' })
      } catch { /* ignorer */ }
    } else if (pendingIntercomCount <= 20) {
      if (redAlertTriggered) {
        // Log de resolution — une seule fois quand on repasse sous le seuil
        redAlertResolved++
        try {
          const now = new Date()
          const ts = now.toISOString().replace('T', ' ').slice(0, 19)
          const entry = [
            '',
            `## Watcher Telecom (system)`,
            '',
            `**Date :** ${ts}`,
            `**Resolution :** Seuil rouge terminee — ${pendingIntercomCount} messages en attente dans intercom`,
            '',
          ].join('\n')
          writeFileSync(LOGBOOK_PATH, entry, { flag: 'a', encoding: 'utf-8' })
        } catch { /* ignorer */ }
      }
      redAlertTriggered = false
      lastRedAlertTime = null
    }

    refreshWindowsSize() // PowerShell: rafraîchir les dimensions réelles (tous les 3 cycles)
    // Logger les sources de dimensions tous les 6 cycles pour diagnostic
    if (cycleCounter % 6 === 0) {
      try {
        const psc = process.platform === 'win32' ? `ps=${psCacheSize.w}x${psCacheSize.h}` : 'ps=off'
        const logLine = `[${new Date().toISOString()}] CYCLE: stdout=${process.stdout.columns}x${process.stdout.rows} term=${term.width}x${term.height} ${psc}\n`
        writeFileSync(RESIZE_DEBUG_PATH, logLine, { flag: 'a', encoding: 'utf-8' })
      } catch { /* ignorer */ }
    }

    drawTitleBar()
    drawSecondaryStatusBar()
    drawStatusBar()
    const pending = pendingIntercomCount > 0 ? ` | ${pendingIntercomCount} en attente` : ''
    setTerminalTitle(`Telecom Watcher — PID:${process.pid} — uptime:${formatUptime(Math.floor((Date.now() - startTime) / 1000))}${pending}`)
  } catch {
    // Erreur silencieuse pendant la collecte
  }
}

// ── Vérification du daemon parent ──

function readDaemonPid(): number | null {
  try {
    if (existsSync(PID_FILE)) {
      const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10)
      return isNaN(pid) ? null : pid
    }
  } catch {
    /* ignorer */
  }
  return null
}

function checkDaemon(): boolean {
  const pid = readDaemonPid()
  if (pid === null) return false
  try {
    process.kill(pid, 0) // test d'existence sans tuer
    return true
  } catch {
    return false
  }
}

// ── Watcher fichiers (fs.watch) ──

function setupFileWatchers(): void {
  // Nettoyer les anciens watchers
  for (const w of watchers) {
    try { w.close() } catch { /* ignore */ }
  }
  watchers = []

  if (existsSync(TELECOM_DIR)) {
    try {
      const w = watch(TELECOM_DIR, { recursive: true }, () => {
        collectAll()
      })
      watchers.push(w)
    } catch {
      // fs.watch peut ne pas être disponible sur certains systèmes de fichiers
    }
  }
}

// ── Utilitaires ──

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

function shutdown(): void {
  if (shutdownScheduled) return
  shutdownScheduled = true

  // Supprimer le fichier PID du watcher
  try { unlinkSync(WATCHER_PID_FILE) } catch { /* deja supprime */ }

  // Nettoyer les watchers
  for (const w of watchers) {
    try { w.close() } catch { /* ignore */ }
  }
  watchers = []

  try {
    term.hideCursor(false)
    term.fullscreen(false)
    term.styleReset()
    term('\nWatcher telecom arrete.\n')
  } catch {
    /* ignorer */
  }
  process.exit(0)
}

// ── Initialisation ──

function initUI(): void {
  try {
    term.fullscreen(true)
    term.hideCursor(true)

    // Barre de titre en haut (ligne 0)
    drawTitleBar()

    // PAS d'appel PowerShell ici — déferré au premier cycle collectAll()
    // pour éviter les crashs au démarrage (PowerShell peut échouer selon
    // la configuration du terminal / execution policy)

    // Calculer et dessiner les 4 quadrants
    recalcRegions()
    // Synchroniser le cache avec l'état réel après fullscreen
    lastTermSize = { w: termWidth(), h: termHeight() }
    for (const id of ['comms', 'agents', 'logs'] as const) {
      drawQuadrantBorder(id)
    }

    // Barres d'état en bas
    drawSecondaryStatusBar()
    drawStatusBar()

    // Gestion du redimensionnement
    try {
      term.on('resize', () => {
        checkResize()
        drawTitleBar()
        drawSecondaryStatusBar()
        drawStatusBar()
      })
    } catch {
      /* Pas de redimensionnement disponible */
    }

    // Touches clavier
    try {
      term.on('key', (name: string) => {
        if (name === 'CTRL_C') {
          shutdown()
        } else if (name === 'r' || name === 'R') {
          const real = getWindowsConsoleSize()
          if (real.w > 0 && real.h > 0) psCacheSize = real
          // Invalider TOUS les caches pour forcer le redessin complet
          lastTitleHash = lastStatusHash = lastSecondaryHash = ''
          QUADRANTS.comms.lastHash = QUADRANTS.agents.lastHash = QUADRANTS.logs.lastHash = ''
          forceRedraw = true  // ← force le redessin des bordures dans checkResize()
          try { term.eraseDisplay() } catch { /* ignorer */ }
          collectAll()
        }
      })
    } catch {
      /* Pas de clavier disponible */
    }
  } catch (err) {
    // Logger l'erreur avant de re-throw
    logCrash('initUI', err)
    throw err
  }
}

/**
 * Logger une erreur dans telecom/watcher-crash.log pour diagnostic.
 */
function logCrash(context: string, err: unknown): void {
  try {
    const stack = err instanceof Error ? (err.stack ?? String(err)) : String(err)
    const msg = `[${new Date().toISOString()}] CRASH [${context}]: ${stack}\n`
    writeFileSync(join(CWD, 'telecom', 'watcher-crash.log'), msg, { flag: 'a', encoding: 'utf-8' })
  } catch {
    /* ignorer les erreurs de logging */
  }
}

// ── Boucle principale ──

function main(): void {
  try {
    // Le watcher nécessite un terminal interactif (TTY).
    if (!process.stdout.isTTY) {
      const errMsg = [
        'Erreur : Le watcher necessite un terminal interactif.',
        '',
        'Lancez-le depuis une fenetre de terminal dediee :',
        '  start cmd /c "chcp 65001 >nul && node dist/telecom/service/telecom-watcher-console.js"',
        '',
        'Le daemon le fait automatiquement avec :',
        '  start "Telecom Watcher" cmd /c "node ..."',
      ].join('\n')
      process.stderr.write(errMsg + '\n')
      process.exit(1)
    }

    // Sur Windows, tenter de passer en UTF-8 (au cas où lancé directement)
    if (process.platform === 'win32') {
      try {
        const { execSync } = require$('node:child_process')
        execSync('chcp 65001 >nul', { timeout: 1000 })
      } catch {
        /* non bloquant — le chcp peut échouer si pas dans un vrai cmd */
      }
    }

    // Initialiser l'interface
    initUI()

    // Écrire le PID du watcher pour que le daemon puisse le tuer
    try {
      writeFileSync(WATCHER_PID_FILE, String(process.pid), 'utf-8')
    } catch {
      /* non bloquant */
    }

    // Première collecte immédiate
    try {
      collectAll()
    } catch (err) {
      logCrash('collectAll-first', err)
      throw err
    }

    // Configurer fs.watch pour les mises à jour temps réel
    setupFileWatchers()

    // Polling périodique (1s) comme fallback
    const pollTimer = setInterval(() => {
      // Vérifier si le daemon demande un shutdown gracieux
      if (existsSync(WATCHER_SHUTDOWN_FILE)) {
        try { unlinkSync(WATCHER_SHUTDOWN_FILE) } catch { /* déjà supprimé */ }
        shutdown()
        return
      }
      collectAll()
    }, POLL_INTERVAL)

    // Vérification de la survie du daemon (5s)
    const daemonCheckTimer = setInterval(() => {
      if (!checkDaemon()) {
        // Daemon mort → on écrit dans Q4 et on ferme dans 10s
        updateQuadrant('logs', '⚠ Daemon parent arrete.\nFermeture du watcher dans 10s...')
        setTimeout(() => {
          shutdown()
        }, 10000)
        clearInterval(daemonCheckTimer)
        clearInterval(pollTimer)
      }
    }, DAEMON_CHECK_INTERVAL)

    // Nettoyage à la sortie
    process.on('SIGTERM', () => shutdown())
    process.on('SIGINT', () => shutdown())
  } catch (err) {
    // Attraper toute erreur non gérée dans main(), logger et exit
    logCrash('main', err)
    try {
      term.hideCursor(false)
      term.fullscreen(false)
      term.styleReset()
    } catch {
      /* ignorer */
    }
    const msg = err instanceof Error ? err.message : String(err)
    process.stderr.write(`\n\x1b[31mWatcher crashe: ${msg}\x1b[0m\n`)
    process.exit(1)
  }
}

// ── Point d'entrée ──
main()
