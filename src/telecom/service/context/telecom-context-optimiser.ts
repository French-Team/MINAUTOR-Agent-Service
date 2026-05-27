/**
 * telecom-context-optimiser
 *
 * Étape 1 du pipeline de compression de contexte.
 * Rôle : transformer du langage naturel verbeux en directives compactes
 * orientées IA. On supprime les formules de politesse, les hésitations,
 * les répétitions de courtoisie, et on remplace certaines tournures
 * verbeuses par leur équivalent court et impératif.
 *
 * Cette étape ne fait AUCUN appel LLM : ce sont des règles déterministes.
 * Elle se concentre sur le français (la langue principale du projet) avec
 * quelques règles anglaises de secours.
 */

interface Rule {
  /** Pattern à détecter (insensible à la casse par défaut). */
  pattern: RegExp
  /** Remplacement (chaîne ou fonction). */
  replacement: string
  /** Description courte pour le debug. */
  reason: string
}

/**
 * Règles de réécriture appliquées séquentiellement.
 * L'ordre compte : les règles longues passent avant les courtes pour
 * éviter les conflits.
 */
const RULES: Rule[] = [
  // ── Politesse / courtoisie superflue (FR) ──
  { pattern: /\bs['']il (?:te|vous) pla[iî]t\b[,.\s]*/gi, replacement: '', reason: 'politesse' },
  { pattern: /\bsvp\b[,.\s]*/gi, replacement: '', reason: 'politesse' },
  { pattern: /\bstp\b[,.\s]*/gi, replacement: '', reason: 'politesse' },
  { pattern: /\bmerci(?: beaucoup| d['']avance)?\b[,.\s!]*/gi, replacement: '', reason: 'politesse' },
  { pattern: /\bbonjour\b[,.\s!]*/gi, replacement: '', reason: 'salutation' },
  { pattern: /\b(?:salut|coucou|hello|hi)\b[,.\s!]*/gi, replacement: '', reason: 'salutation' },

  // ── Hésitations / fillers (FR) ──
  { pattern: /\b(?:euh+|hum+|ben|bah|du coup|en fait|alors)\b[,.\s]*/gi, replacement: '', reason: 'filler' },
  { pattern: /\bje pense que\b/gi, replacement: '', reason: 'hedging' },
  { pattern: /\bj['']imagine que\b/gi, replacement: '', reason: 'hedging' },

  // ── Tournures verbeuses → impératif compact (FR) ──
  { pattern: /\b(?:peux[- ]tu|pourrais[- ]tu|pourriez[- ]vous)\s+/gi, replacement: '', reason: 'requête→impératif' },
  { pattern: /\bj['']aimerais (?:bien |vraiment )?(?:que tu )?/gi, replacement: 'Tâche : ', reason: 'volonté→tâche' },
  { pattern: /\bje voudrais (?:bien |vraiment )?(?:que tu )?/gi, replacement: 'Tâche : ', reason: 'volonté→tâche' },
  { pattern: /\bil faut (?:que tu |que )/gi, replacement: 'Tâche : ', reason: 'volonté→tâche' },
  { pattern: /\bil faudrait (?:que tu |que )?/gi, replacement: 'Tâche : ', reason: 'volonté→tâche' },

  // ── Politesse / fillers (EN, secours) ──
  { pattern: /\bplease\b[,.\s]*/gi, replacement: '', reason: 'politesse' },
  { pattern: /\bthank(?:s| you)(?: very much)?\b[,.\s!]*/gi, replacement: '', reason: 'politesse' },
  { pattern: /\b(?:could|would) you(?: please)?\s+/gi, replacement: '', reason: 'requête→impératif' },
  { pattern: /\bcan you(?: please)?\s+/gi, replacement: '', reason: 'requête→impératif' },
  { pattern: /\bI(?: would| ['']d) like (?:you )?to\s+/gi, replacement: 'Task: ', reason: 'volonté→tâche' },
  { pattern: /\b(?:um+|uh+|well|so|like)\b[,.\s]*/gi, replacement: '', reason: 'filler' },

  // ── Compactage final ──
  { pattern: / +([,.;:!?])/g, replacement: '$1', reason: 'ponctuation' },
  { pattern: /([,.;:!?]){2,}/g, replacement: '$1', reason: 'ponctuation-doublée' },
]

export interface OptimiserOptions {
  /** Si false, conserve les salutations (utile pour le tout premier message). */
  stripGreetings?: boolean
  /** Si true, retourne aussi la liste des règles appliquées (debug). */
  trace?: boolean
}

export interface OptimiserResult {
  text: string
  applied: string[]
}

/**
 * Optimise un texte en langage naturel en directives compactes pour LLM.
 * Toujours sûr : si toutes les règles vidaient le texte, retourne l'original.
 */
export function optimiser(input: string, options: OptimiserOptions = {}): string {
  return optimiserDetail(input, options).text
}

/**
 * Variante qui retourne le détail des règles appliquées (pour observabilité).
 */
export function optimiserDetail(input: string, options: OptimiserOptions = {}): OptimiserResult {
  if (!input || !input.trim()) return { text: '', applied: [] }

  const applied: string[] = []
  let out = input

  for (const rule of RULES) {
    if (rule.reason === 'salutation' && options.stripGreetings === false) continue
    const before = out
    out = out.replace(rule.pattern, rule.replacement)
    if (options.trace && before !== out) applied.push(rule.reason)
  }

  // Sécurité : si tout a disparu, on garde l'original (le texte ne contenait
  // peut-être que des mots-clés que nos règles ont mal jugés).
  if (!out.trim()) return { text: input.trim(), applied: ['rollback-empty'] }

  // Capitaliser la première lettre (utile après suppression d'une politesse)
  out = out.trim().replace(/^[a-zà-ÿ]/u, c => c.toUpperCase())

  return { text: out, applied }
}
