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
 *
 * Règles chargées depuis data/rules/context-optimiser.json
 */

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { buildRegExp } from './regex-utils.js'

interface JsonRule {
  pattern: string
  flags: string
  replacement: string
  reason: string
}

interface RuleRegistry {
  rules: JsonRule[]
}

interface Rule {
  /** Pattern à détecter (insensible à la casse par défaut). */
  pattern: RegExp
  /** Remplacement (chaîne ou fonction). */
  replacement: string
  /** Description courte pour le debug. */
  reason: string
}

const RULES_PATH = join(process.cwd(), 'data', 'rules', 'context-optimiser.json')

function loadRules(): Rule[] {
  try {
    if (!existsSync(RULES_PATH)) {
      console.warn(`[optimiser] Fichier introuvable: ${RULES_PATH}`)
      return []
    }
    const raw = readFileSync(RULES_PATH, 'utf-8')
    const registry: RuleRegistry = JSON.parse(raw)
    if (!Array.isArray(registry.rules)) {
      console.warn('[optimiser] Règles invalides dans context-optimiser.json')
      return []
    }
    return registry.rules.map(r => ({
      pattern: buildRegExp(r.pattern, r.flags),
      replacement: r.replacement,
      reason: r.reason,
    }))
  } catch (err) {
    console.warn(`[optimiser] Impossible de charger context-optimiser.json: ${(err as Error).message}`)
    return []
  }
}

let _rules: Rule[] | null = null

function getRules(): Rule[] {
  if (!_rules) {
    _rules = loadRules()
  }
  return _rules
}

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

  for (const rule of getRules()) {
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
