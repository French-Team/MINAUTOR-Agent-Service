/**
 * cli-suggestions.ts — Menu interactif pour les suggestions de suivi
 *
 * Après l'exécution d'un script (block-task, add-task, etc.),
 * le daemon écrit des suggestions structurées dans telecom/suggestions.json.
 * Ce module les lit et affiche un menu numéroté dans le CLI.
 *
 * L'utilisateur tape un chiffre pour exécuter la commande correspondante,
 * ou 0 pour ignorer et taper sa propre commande.
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { Interface } from 'readline/promises'
import {
  RESET, CYAN, GREEN, YELLOW, GRAY, BOLD,
} from './constants.js'

export interface Suggestion {
  /** Texte court affiché dans le menu (ex: "Renommer") */
  label: string
  /** Texte secondaire de description (ex: "Renommer la tâche") */
  description: string
  /** Commande complète à exécuter si l'utilisateur choisit cette suggestion */
  command: string
}

const SUGGESTIONS_PATH = join(process.cwd(), 'telecom', 'suggestions.json')

/** Lit les suggestions depuis le fichier JSON */
export function loadSuggestions(): Suggestion[] {
  if (!existsSync(SUGGESTIONS_PATH)) return []
  try {
    const raw = readFileSync(SUGGESTIONS_PATH, 'utf-8').trim()
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (s: unknown): s is Suggestion =>
        s !== null &&
        typeof s === 'object' &&
        typeof (s as Record<string, unknown>).label === 'string' &&
        typeof (s as Record<string, unknown>).command === 'string',
    )
  } catch {
    return []
  }
}

/** Vérifie si des suggestions sont disponibles */
export function hasSuggestions(): boolean {
  return existsSync(SUGGESTIONS_PATH) && loadSuggestions().length > 0
}

/** Supprime le fichier de suggestions */
export function clearSuggestions(): void {
  if (existsSync(SUGGESTIONS_PATH)) {
    try {
      unlinkSync(SUGGESTIONS_PATH)
    } catch {
      /* ignoré */
    }
  }
}

/** Écrit les suggestions dans le fichier JSON */
export function writeSuggestions(suggestions: Suggestion[]): void {
  try {
    const dir = join(SUGGESTIONS_PATH, '..')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(SUGGESTIONS_PATH, JSON.stringify(suggestions, null, 2), 'utf-8')
  } catch {
    /* ignoré — non bloquant */
  }
}

/**
 * Parse le texte généré par getFollowUpSuggestions() pour en extraire
 * les suggestions structurées. Chaque ligne a le format :
 *   → <commande> — <label>
 */
export function parseSuggestionsFromOutput(output: string): Suggestion[] {
  const suggestions: Suggestion[] = []
  const lines = output.split('\n')
  for (const line of lines) {
    const match = line.match(/^ {2}→ (.+) — (.+)$/)
    if (match) {
      const command = match[1].trim()
      const label = match[2].trim()
      suggestions.push({
        label,
        description: label,
        command,
      })
    }
  }
  return suggestions
}

/**
 * Affiche le menu des suggestions dans stdout (sans rl.question)
 * et attend un appui clavier pour le choix.
 * Utilise le stdin en mode raw déjà configuré par cli-main.ts.
 *
 * @returns La commande à exécuter, ou null si l'utilisateur a ignoré
 */
export async function showSuggestionMenuRaw(): Promise<string | null> {
  const suggestions = loadSuggestions()
  if (suggestions.length === 0) return null

  // Ne pas afficher le menu si stdin n'est pas un TTY
  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    clearSuggestions()
    return null
  }

  const start = async (): Promise<string | null> => {
    return new Promise((resolve) => {
      // Afficher le menu
      const lines: string[] = []
      lines.push(`\n${BOLD}${CYAN}╔ Actions rapides${RESET}`)
      for (let i = 0; i < suggestions.length; i++) {
        const s = suggestions[i]
        const num = String(i + 1)
        lines.push(
          `${BOLD}${CYAN}║  ${RESET}${GREEN}${num}${RESET}.  ${s.label}  ${GRAY}— ${s.description}${RESET}`,
        )
      }
      lines.push(`${BOLD}${CYAN}║${RESET}`)
      lines.push(
        `${BOLD}${CYAN}║  ${RESET}${YELLOW}0${RESET}.  Ignorer et taper ma propre commande`,
      )
      lines.push(`${BOLD}${CYAN}╚${RESET}  ${GRAY}(appuyer sur un chiffre)${RESET}`)
      process.stdout.write(lines.join('\n') + '\n')

      // Réécouter un appui clavier (une seule fois)
      const handler = (_str: string, key: { name: string; sequence?: string }) => {
        process.stdin.removeListener('keypress', handler)
        clearSuggestions()

        const num = parseInt(key.name, 10)
        if (isNaN(num) || num < 1 || num > suggestions.length) {
          resolve(null)
          return
        }
        resolve(suggestions[num - 1].command)
      }
      process.stdin.on('keypress', handler)
    })
  }

  return start()
}

/**
 * Affiche le menu interactif des suggestions et attend le choix de l'utilisateur.
 *
 * @param rl - L'interface readline du CLI (pour éviter de créer une nouvelle instance)
 * @returns La commande à exécuter, ou null si l'utilisateur a ignoré
 */
export async function showSuggestionMenu(rl: Interface): Promise<string | null> {
  const suggestions = loadSuggestions()
  if (suggestions.length === 0) return null

  console.log(`\n${BOLD}${CYAN}╔ Actions rapides${RESET}`)
  for (let i = 0; i < suggestions.length; i++) {
    const s = suggestions[i]
    const num = String(i + 1)
    console.log(
      `${BOLD}${CYAN}║  ${RESET}${GREEN}${num}${RESET}.  ${s.label}  ${GRAY}— ${s.description}${RESET}`,
    )
  }
  console.log(`${BOLD}${CYAN}║${RESET}`)
  console.log(
    `${BOLD}${CYAN}║  ${RESET}${YELLOW}0${RESET}.  Ignorer et taper ma propre commande`,
  )
  console.log(`${BOLD}${CYAN}╚${RESET}`)

  const answer = (
    await rl.question(`${GRAY}Choix (0-${suggestions.length}): ${RESET}`)
  ).trim()

  // Nettoyer les suggestions maintenant que l'utilisateur a vu le menu
  clearSuggestions()

  const num = parseInt(answer, 10)
  if (isNaN(num) || num < 1 || num > suggestions.length) return null

  return suggestions[num - 1].command
}
