/**
 * telecom-context-composeur
 *
 * Étape 0.5 du pipeline de compression de contexte.
 * Rôle : prendre les patterns conservés par `conserver()` et composer
 * un `instructionsPrompt` optimisé — compact, ordonné, prêt à injecter
 * dans le payload LLM.
 *
 * Travaille en binôme avec `conservateur` :
 *   1. conservateur  → trie les patterns par importance
 *   2. composeur     → assemble le prompt final
 *
 * Aucun appel LLM : transformations textuelles pures.
 */

import type { Pattern, PatternImportance } from './telecom-context-conservateur.js'

export interface ComposeurOptions {
  /** Si true, réduit les lignes vides multiples à une seule. Défaut: true. */
  compactWhitespace?: boolean
  /** Si true, supprime les séparateurs purement décoratifs. Défaut: true. */
  stripDecorators?: boolean
  /** Ordre de priorité des sections. Défaut: critical → important → optional. */
  orderBy?: 'importance' | 'source' | 'original'
  /** Si true, ne garde que les patterns 'critical' et 'important' (supprime 'optional'). */
  strictMode?: boolean
  /** Maximum de caractères pour le prompt final (0 = illimité). Défaut: 0. */
  maxChars?: number
}

export interface ComposeurResult {
  /** Le texte optimisé. */
  text: string
  /** Nombre de patterns conservés dans le résultat. */
  keptPatterns: number
  /** Nombre de patterns supprimés (ne fait pas partie du résultat). */
  droppedPatterns: number
  /** Taille en caractères avant composition. */
  charsBefore: number
  /** Taille en caractères après composition. */
  charsAfter: number
  /** Ratio de compression (0-100). */
  compressionRatio: number
}

const DEFAULTS: Required<ComposeurOptions> = {
  compactWhitespace: true,
  stripDecorators: true,
  orderBy: 'importance',
  strictMode: false,
  maxChars: 0,
}

/** Lignes purement décoratives à supprimer. */
const DECORATOR_LINE = /^[═╔╚║┌┐└┘├┤┬┴┼─│*_=\-–—•·]{3,}$/
const BOX_BORDERS = /^[╔╚║╠╣╦╩╬═╗╝╟╢╤╧╨╥]+$/

/**
 * Nettoie une ligne individuelle : vire les décorateurs, les bordures de boîtes.
 */
function isLineMeaningful(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) return true // les lignes vides sont des séparateurs, utiles
  if (DECORATOR_LINE.test(trimmed)) return false
  if (BOX_BORDERS.test(trimmed)) return false
  return true
}

/**
 * Compacte les lignes vides multiples (max 1).
 */
function collapseBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n')
}

/**
 * Ordonne les patterns selon le critère choisi.
 */
function orderPatterns(
  patterns: Pattern[],
  orderBy: 'importance' | 'source' | 'original',
): Pattern[] {
  if (orderBy === 'original') return [...patterns]

  const importanceOrder: Record<PatternImportance, number> = {
    critical: 0,
    important: 1,
    optional: 2,
    noise: 3,
  }

  return [...patterns].sort((a, b) => {
    if (orderBy === 'importance') {
      return importanceOrder[a.importance] - importanceOrder[b.importance]
    }
    // source: grouper par source
    return a.source.localeCompare(b.source)
  })
}

/**
 * Formate un pattern en texte : avec son header si c'est une section nommée.
 */
function formatPattern(pattern: Pattern, compact: boolean): string {
  const parts: string[] = []

  // Ne pas rajouter de header pour les patterns sans nom
  if (pattern.header && pattern.header !== '(en-tête)' && pattern.header !== '(séparateur)') {
    parts.push(`## ${pattern.header}`)
  }

  // Contenu
  let content = pattern.content
  if (compact) {
    // Supprimer les espaces de fin de ligne
    content = content.replace(/[ \t]+$/gm, '')
  }

  if (content) {
    parts.push(content)
  }

  return parts.join('\n')
}

/**
 * Compose un system prompt optimisé à partir des patterns conservés.
 *
 * @param patterns Tableau de patterns (typiquement le `.kept` de `conserver`)
 * @param options Options de composition
 * @returns Texte optimisé + métriques
 */
export function composeur(
  patterns: Pattern[],
  options: ComposeurOptions = {},
): ComposeurResult {
  const opts = { ...DEFAULTS, ...options }

  if (patterns.length === 0) {
    return {
      text: '',
      keptPatterns: 0,
      droppedPatterns: 0,
      charsBefore: 0,
      charsAfter: 0,
      compressionRatio: 0,
    }
  }

  // Calculer la taille d'entrée
  const charsBefore = patterns.reduce((sum, p) => sum + p.header.length + p.content.length, 0)

  // 1. Filtrer selon strictMode
  let filtered = patterns
  let droppedCount = 0
  if (opts.strictMode) {
    const before = filtered.length
    filtered = filtered.filter(p => p.importance === 'critical' || p.importance === 'important')
    droppedCount += before - filtered.length
  }

  // 2. Ordonner
  const ordered = orderPatterns(filtered, opts.orderBy)

  // 3. Formater chaque pattern
  const formatted = ordered.map(p => formatPattern(p, opts.compactWhitespace))

  // 4. Joindre avec séparation
  let text = formatted.filter(Boolean).join('\n\n')

  // 5. Post-traitement
  if (opts.stripDecorators) {
    const lines = text.split('\n')
    const clean = lines.filter(l => isLineMeaningful(l))
    text = clean.join('\n')
  }

  if (opts.compactWhitespace) {
    text = collapseBlankLines(text)
  }

  // 6. Troncature si maxChars défini
  if (opts.maxChars > 0 && text.length > opts.maxChars) {
    text = text.slice(0, opts.maxChars).trimEnd() + '\n…'
  }

  const charsAfter = text.length
  const compressionRatio = charsBefore > 0
    ? Math.round((1 - charsAfter / charsBefore) * 100)
    : 0

  return {
    text: text.trim(),
    keptPatterns: ordered.length,
    droppedPatterns: droppedCount,
    charsBefore,
    charsAfter,
    compressionRatio,
  }
}

/**
 * Version one-shot : enchaîne `conserver` + `composeur`.
 * Pratique pour l'intégration dans le pipeline.
 */
export function composer(
  conserverResult: { kept: Pattern[]; stats: { charsBefore: number } },
  options: ComposeurOptions = {},
): ComposeurResult {
  return composeur(conserverResult.kept, options)
}
