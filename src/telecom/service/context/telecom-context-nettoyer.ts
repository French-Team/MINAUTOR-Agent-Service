/**
 * telecom-context-nettoyer
 *
 * Étape 2 du pipeline de compression de contexte.
 * Rôle : nettoyer un texte en éliminant tout ce qui « pollue » le contexte
 * sans ajouter d'information utile pour le LLM (caractères de contrôle,
 * espaces redondants, lignes vides multiples, etc.).
 *
 * Cette étape est purement déterministe : aucun appel LLM, aucune perte
 * d'information sémantique. Elle s'applique aussi bien à un message
 * utilisateur, à une réponse d'agent, qu'à un résumé.
 */

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g
const TRAILING_WS = /[ \t]+$/gm
const MULTI_SPACE = /[ \t]{2,}/g
const MULTI_BLANK = /\n{3,}/g
const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g

export interface NettoyerOptions {
  /** Si true, supprime aussi les emojis décoratifs sans valeur sémantique. */
  stripEmoji?: boolean
  /** Si true, normalise les guillemets typographiques en simples. */
  normalizeQuotes?: boolean
}

/**
 * Nettoie une chaîne en supprimant les caractères inutiles.
 * Idempotent : `nettoyer(nettoyer(x)) === nettoyer(x)`.
 */
export function nettoyer(input: string, options: NettoyerOptions = {}): string {
  if (!input) return ''

  let out = input

  // Normaliser les fins de ligne
  out = out.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  // Caractères de contrôle et zero-width
  out = out.replace(CONTROL_CHARS, '')
  out = out.replace(ZERO_WIDTH, '')

  // Guillemets typographiques → ASCII (optionnel)
  if (options.normalizeQuotes) {
    out = out
      .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
      .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/\u2026/g, '...')
  }

  // Emojis décoratifs (optionnel) — bloc Misc Symbols and Pictographs
  if (options.stripEmoji) {
    out = out.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
  }

  // Espaces en fin de ligne
  out = out.replace(TRAILING_WS, '')

  // Espaces/tabs multiples → un seul espace (sauf en début de ligne pour
  // préserver une éventuelle indentation utile dans du code)
  out = out
    .split('\n')
    .map(line => {
      const indentMatch = line.match(/^[ \t]*/)
      const indent = indentMatch ? indentMatch[0] : ''
      const rest = line.slice(indent.length).replace(MULTI_SPACE, ' ')
      return indent + rest
    })
    .join('\n')

  // Lignes vides multiples → max 1 ligne vide
  out = out.replace(MULTI_BLANK, '\n\n')

  return out.trim()
}

/**
 * Mesure rapide du gain en pourcentage par rapport à l'entrée d'origine.
 * Utile pour les logs et l'observabilité du pipeline.
 */
export function gainNettoyage(before: string, after: string): number {
  if (!before) return 0
  return Math.max(0, Math.round((1 - after.length / before.length) * 100))
}
