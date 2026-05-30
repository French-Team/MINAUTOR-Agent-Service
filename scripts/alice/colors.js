#!/usr/bin/env node
/**
 * scripts/alice/colors.js — Module color partagé
 *
 * Constantes ANSI et utilitaires pour tous les scripts d'Alice.
 * Détection automatique --no-color / pipe.
 *
 * Usage:
 *   import { CYAN, BOLD, RESET, bar, noColor } from './colors.js'
 *   console.log(`${CYAN}titre${RESET}`)
 *   console.log(bar(0.75, 20))  // ███████████████░░░░░
 */

// ── Terminal-kit (utilitaires uniquement) ─────────────

import { readFileSync } from 'fs'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const termKit = (() => { try { return require('terminal-kit') } catch { return null } })()
const _stringWidth = termKit?.stringWidth || ((s) => (s || '').replace(/\x1b\[[0-9;]*m/g, '').length)

/**
 * Largeur réelle d'une chaîne à l'écran (handle les emojis, CJK).
 * Utilise terminal-kit si disponible, sinon fallback (supprime ANSI).
 */
export function strWidth(str) {
  return _stringWidth(str || '')
}

/**
 * Largeur actuelle du terminal (défaut 80 si non-TTY / indisponible).
 */
export function termWidth() {
  try {
    if (termKit?.terminal?.width) return termKit.terminal.width
  } catch { /* ignore */ }
  return 80
}

// ── Détection --no-color ─────────────────────────────

const args = process.argv.slice(2)
const hasFlag = args.includes('--no-color')
const hasEnvNoColor = process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== ''
const hasForceColor = process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== '0' && process.env.FORCE_COLOR !== 'false'
// Convention standard : NO_COLOR désactive, FORCE_COLOR force, --no-color l'emporte
export const noColor = hasFlag || (hasEnvNoColor && !hasForceColor)

// ── Constantes ANSI ──────────────────────────────────

const RAW = {
  CYAN: '\x1b[36m',
  GREEN: '\x1b[32m',
  YELLOW: '\x1b[33m',
  RED: '\x1b[31m',
  GRAY: '\x1b[90m',
  BOLD: '\x1b[1m',
  RESET: '\x1b[0m',
  LIME: '\x1b[92m',
  MAGENTA: '\x1b[35m',
  BLUE: '\x1b[34m',
}

// En mode noColor, toutes les couleurs sont des chaînes vides
export const CYAN   = noColor ? '' : RAW.CYAN
export const GREEN  = noColor ? '' : RAW.GREEN
export const YELLOW = noColor ? '' : RAW.YELLOW
export const RED    = noColor ? '' : RAW.RED
export const GRAY   = noColor ? '' : RAW.GRAY
export const BOLD   = noColor ? '' : RAW.BOLD
export const RESET  = noColor ? '' : RAW.RESET
export const LIME   = noColor ? '' : RAW.LIME
export const MAGENTA = noColor ? '' : RAW.MAGENTA
export const BLUE   = noColor ? '' : RAW.BLUE

// ── Utilitaires de formatage ─────────────────────────

/**
 * Longueur visible d'une chaîne (sans codes ANSI).
 * @param {string} str
 * @returns {number}
 */
function visibleLen(str) {
  return _stringWidth(str || '')
}


/**
 * Barre de progression ASCII.
 * @param {number} ratio — 0.0 à 1.0
 * @param {number} width — largeur en caractères (défaut 20)
 * @returns {string} ex: "███████████████░░░░░"
 */
export function bar(ratio, width = 20) {
  const clamped = Math.max(0, Math.min(1, ratio))
  const filled = Math.round(clamped * width)
  const empty = width - filled
  const fillChar = '█'
  const emptyChar = '░'
  return `${GREEN}${fillChar.repeat(filled)}${GRAY}${emptyChar.repeat(empty)}${RESET}`
}

/**
 * Colorie un nombre en jaune.
 * @param {number|string} n
 * @returns {string}
 */
export function num(n) {
  return `${YELLOW}${n}${RESET}`
}

/**
 * Colorie un nom de fichier en vert.
 * @param {string} name
 * @returns {string}
 */
export function fileName(name) {
  return `${GREEN}${name}${RESET}`
}

/**
 * Colorie une étiquette en cyan gras.
 * @param {string} label
 * @returns {string}
 */
export function label(label) {
  return `${CYAN}${BOLD}${label}${RESET}`
}

/**
 * En-tête de section.
 * @param {string} title
 * @returns {string}
 */
export function header(title) {
  const sep = '═'.repeat(5)
  return `${CYAN}${BOLD}${sep} ${title} ${sep}${RESET}`
}

/**
 * Sous-titre de tableau.
 * @param {string[]} cols — noms de colonnes
 * @param {number[]} widths — largeurs
 * @returns {string}
 */
export function tableHeader(cols, widths) {
  const parts = cols.map((c, i) => {
    const w = widths[i] || 20
    const padNeeded = Math.max(0, w - visibleLen(c))
    return `${BOLD}${c}${' '.repeat(padNeeded)}${RESET}`
  })
  return parts.join(' ')
}

/**
 * Ligne de séparation de tableau.
 * @param {number[]} widths
 * @returns {string}
 */
export function tableSep(widths) {
  const parts = widths.map(w => '─'.repeat(w))
  return `${GRAY}${parts.join(' ─ ')}${RESET}`
}

/**
 * Ligne de tableau avec cellules.
 * @param {string[]} cells
 * @param {number[]} widths
 * @returns {string}
 */
export function tableRow(cells, widths) {
  const parts = cells.map((c, i) => {
    const w = widths[i] || 20
    const padNeeded = Math.max(0, w - visibleLen(c))
    return c + ' '.repeat(padNeeded)
  })
  return parts.join(' ')
}

/**
 * Pad une chaîne à une largeur donnée.
 * @param {string|number} s
 * @param {number} n
 * @returns {string}
 */
export function pad(s, n) {
  const str = String(s ?? '')
  const padNeeded = Math.max(0, n - visibleLen(str))
  return str + ' '.repeat(padNeeded)
}

/**
 * Colorie une valeur selon son type.
 * @param {*} val
 * @returns {string}
 */
export function highlight(val) {
  if (val === null || val === undefined || val === '—') return `${GRAY}—${RESET}`
  if (typeof val === 'number') return num(val)
  if (typeof val === 'string' && /^\d+$/.test(val)) return num(val)
  return String(val)
}

// ── Utilitaires fichiers ────────────────────────────

/**
 * Lit un fichier, retourne null en cas d'erreur.
 * @param {string} path
 * @returns {string|null}
 */
export function readFile(path) {
  try { return readFileSync(path, 'utf-8') } catch { return null }
}

/**
 * Compte les lignes d'une chaîne.
 * @param {string|null|undefined} content
 * @returns {number}
 */
export function countLines(content) {
  if (!content) return 0
  return content.split('\n').length
}

// ── Utilitaires tableau box-drawing ──────────────────

/**
 * Pad une cellule de tableau box-drawing avec espace à gauche.
 * Retourne une chaîne de largeur visuelle exactement `w`.
 * @param {string} s — contenu (peut contenir des codes ANSI)
 * @param {number} w — largeur souhaitée
 * @returns {string}
 */
export function cellPad(s, w) {
  const visible = strWidth(s)
  return ` ${s}${' '.repeat(Math.max(0, w - visible - 1))}`
}

/**
 * Wrapping intelligent : coupe un texte aux points (.) quand il dépasse maxWidth.
 * Fallback : espace, puis coupe forcée en dernier recours.
 * @param {string} text
 * @param {number} maxWidth
 * @returns {string[]}
 */
export function splitAtSentences(text, maxWidth) {
  if (strWidth(text) <= maxWidth) return [text]
  const result = []
  let remaining = text
  while (strWidth(remaining) > maxWidth) {
    let cut = 0
    let w = 0
    while (w < maxWidth && cut < remaining.length) {
      w += strWidth(remaining[cut] || '')
      cut++
    }
    // Priorité au dernier point (.) avant la limite
    const lastPeriod = remaining.lastIndexOf('.', cut)
    if (lastPeriod > 0 && lastPeriod < cut) {
      result.push(remaining.slice(0, lastPeriod + 1).trim())
      remaining = remaining.slice(lastPeriod + 1).trim()
      continue
    }
    // Fallback : dernier espace
    const lastSpace = remaining.lastIndexOf(' ', cut)
    if (lastSpace > 0) {
      result.push(remaining.slice(0, lastSpace).trim()
)
      remaining = remaining.slice(lastSpace).trim()
      continue
    }
    // Dernier recours : coupe forcée
    result.push(remaining.slice(0, cut).trim())
    remaining = remaining.slice(cut).trim()
  }
  if (remaining) result.push(remaining)
  return result
}

/**
 * Formate des bytes en taille lisible (B, KB, MB).
 * @param {number|null|undefined} bytes
 * @returns {string}
 */
export function humanSize(bytes) {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ── Parseurs README ────────────────────────────────

/**
 * Extrait le contenu d'une section du README (entre ## header et le prochain ## ou ---).
 * @param {string|null|undefined} content — le contenu complet du README
 * @param {string} header — le nom de la section (sans le ##)
 * @returns {string|null}
 */
export function extractSection(content, header) {
  if (!content) return null
  const escaped = header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`## ${escaped}\\n\\n([\\s\\S]+?)(?:\\n\\n---|\\n## )`)
  const match = content.match(regex)
  if (!match) return null
  return match[1].trim()
}

/**
 * Parse les bullet points d'un texte (lignes commençant par - ou *).
 * @param {string|null|undefined} text
 * @returns {string[]}
 */
export function parseBullets(text) {
  if (!text) return []
  const bullets = []
  for (const line of text.split('\n')) {
    const m = line.match(/^[\-\*]\s+(.+)/)
    if (m) bullets.push(m[1])
  }
  return bullets
}

/**
 * Parse les listes numérotées d'un texte (lignes commençant par N.).
 * @param {string|null|undefined} text
 * @returns {Array<{num: string, text: string}>}
 */
export function parseNumberedList(text) {
  if (!text) return []
  const items = []
  for (const line of text.split('\n')) {
    const m = line.match(/^(\d+\.)\s+(.+)/)
    if (m) items.push({ num: m[1], text: m[2] })
  }
  return items
}

/**
 * Parse un tableau Markdown simple (lignes | ... | ... |) et retourne des couples {kit, desc}.
 * @param {string|null|undefined} text
 * @returns {Array<{kit: string, desc: string}>}
 */
export function parseTable(text) {
  if (!text) return []
  const rows = []
  const lines = text.split('\n')
  let inTable = false
  for (const line of lines) {
    if (line.startsWith('|') && line.includes('---')) { inTable = true; continue }
    if (inTable && line.startsWith('|')) {
      const cols = line.split('|').filter(c => c.trim()).map(c => c.trim())
      if (cols.length >= 2) rows.push({ kit: cols[0], desc: cols[1] })
    } else if (inTable && !line.startsWith('|')) {
      break
    }
  }
  return rows
}
