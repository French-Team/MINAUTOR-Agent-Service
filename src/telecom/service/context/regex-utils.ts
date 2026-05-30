/**
 * regex-utils
 *
 * Utilitaires partagés pour la manipulation d'expressions régulières
 * dans le pipeline de compression de contexte.
 * Utilisé par telecom-context-optimiser.ts et model-profiles.ts.
 */

/**
 * Détecte si un pattern utilise des propriétés Unicode (\p{...} ou \P{...})
 * qui nécessitent le flag `u` pour fonctionner.
 */
function usesUnicodeProperty(pattern: string): boolean {
  return /\\[pP]\{/u.test(pattern)
}

/**
 * Construit une RegExp depuis une source chaîne avec gestion d'erreur.
 *
 * - Auto-détecte les patterns utilisant \p{L} / \P{...} et ajoute
 *   le flag `u` automatiquement si absent (évite les plantages silencieux).
 * - Si la regex est invalide malgré tout, un avertissement est émis
 *   sur la console et une regex qui ne matche jamais (`/(?!)/`) est
 *   retournée.
 */
export function buildRegExp(source: string, flags: string): RegExp {
  // Auto-ajout du flag u si le pattern utilise \p{...} ou \P{...}
  const effectiveFlags = usesUnicodeProperty(source) && !flags.includes('u')
    ? flags + 'u'
    : flags

  try {
    return new RegExp(source, effectiveFlags)
  } catch (err) {
    console.warn(`[buildRegExp] Regex invalide : "${source}" (flags="${flags}") — ${(err as Error).message}`)
    return /(?!)/ // never matches
  }
}
