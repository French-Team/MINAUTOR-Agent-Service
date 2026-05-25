import type { Engine } from './engine.js'
import {
  RESET, GRAY, BOLD,
} from './constants.js'
import { layer as userLogo } from './logo/layer-user.js'

// ── 256-color ANSI helpers ───────────────────────────────

/**
 * Convertit des valeurs RGB (0-255) en index ANSI 256 couleurs.
 */
function rgbTo256(r: number, g: number, b: number): number {
  return 16
    + (36 * Math.round(Math.max(0, Math.min(255, r)) / 255 * 5))
    + (6 * Math.round(Math.max(0, Math.min(255, g)) / 255 * 5))
    + Math.round(Math.max(0, Math.min(255, b)) / 255 * 5)
}

/**
 * Applique une couleur interpolée entre start et end à un caractère.
 * t ∈ [0, 1].
 */
function gradientChar(char: string, t: number, start: [number, number, number], end: [number, number, number]): string {
  if (char === ' ') return ' '
  const r = Math.round(start[0] + (end[0] - start[0]) * t)
  const g = Math.round(start[1] + (end[1] - start[1]) * t)
  const b = Math.round(start[2] + (end[2] - start[2]) * t)
  return `\x1b[38;5;${rgbTo256(r, g, b)}m${char}`
}

/**
 * Crée un dégradé sur toute la chaîne de caractères.
 */
function gradientText(text: string, start: [number, number, number], end: [number, number, number]): string {
  const len = text.length
  let out = ''
  for (let i = 0; i < len; i++) {
    out += gradientChar(text[i], len > 1 ? i / (len - 1) : 0, start, end)
  }
  return out + RESET
}

// ── Palettes de dégradé ──────────────────────────────────

const CYAN_BRIGHT: [number, number, number] = [0, 230, 255]
const MAGENTA_BRIGHT: [number, number, number] = [255, 80, 255]
// ── Logo utilisateur ─────────────────────────────────────
// Design choisi par l'utilisateur, importé depuis logo/layer-user.ts.
// Le cadre ▐▀▄ et le texte FIGlet "MINAUTOR AGENT SERVICE" sont auto-suffisants
// (pas besoin de boîte séparée).

const LOGO_LINES = userLogo

// ── Bannière principale ──────────────────────────────────

/**
 * Affiche la bannière avec le logo FIGlet "MINAUTOR AGENT SERVICE"
 * dans un cadre ▐▀▄, avec un dégradé de couleurs cyan → magenta.
 */
export function showBanner(engine: Engine): void {
  const agent = engine.agent
  const sessionId = engine.getCurrentSession()?.id || ''
  const shortId = sessionId ? sessionId.slice(0, 8) : '—'

  console.log('')

  // ── Logo FIGlet "MINAUTOR AGENT SERVICE" (dégradé cyan → magenta) ──
  for (const line of LOGO_LINES) {
    console.log(gradientText(line, CYAN_BRIGHT, MAGENTA_BRIGHT))
  }

  // ── Infos agent et session ──
  console.log(` ${GRAY}Agent: ${BOLD}${agent.displayName}${RESET}${GRAY}  │  Session: ${shortId}${RESET}\n`)
}
