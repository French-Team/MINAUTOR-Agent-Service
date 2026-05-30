/**
 * validate-rules
 *
 * Validation au démarrage de tous les fichiers JSON de règles du projet.
 * Vérifie que chaque fichier est syntaxiquement valide et respecte
 * la structure attendue (tableaux, champs obligatoires).
 *
 * Utilisation :
 *   import { validateRulesAtStartup } from './validate-rules.js'
 *   validateRulesAtStartup()
 *
 * En cas d'échec, un message d'erreur clair est affiché et le processus
 * continue (non bloquant — mieux vaut un avertissement qu'un plantage).
 */

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { optimiserDetail } from './telecom/service/context/telecom-context-optimiser.js'

// ── Types ──

interface RuleFileEntry {
  path: string
  label: string
  validate?: (data: unknown, sourceFile?: string) => string | null
  /** Si true, la validation est critique (affiche erreur + avertissement). */
  critical?: boolean
}

type ValidationResult = {
  path: string
  label: string
  ok: boolean
  error?: string
}

// ── Validateurs structurels ──

// ── Helpers de validation regex ──

/**
 * Détecte si un pattern utilise des propriétés Unicode (\p{...} ou \P{...}).
 */
function usesUnicodeProperty(pattern: string): boolean {
  return /\\[pP]\{/u.test(pattern)
}

/**
 * Compile un pattern et retourne une erreur descriptive si invalide.
 */
function tryCompilePattern(pattern: string, flags: string, index: number): string | null {
  // Flag u obligatoire pour \p{...} / \P{...}
  if (usesUnicodeProperty(pattern) && !flags.includes('u')) {
    return `Élément [${index}] : pattern utilise \\p{L}/\\P{...} mais le flag "u" est absent (flags="${flags}")`
  }
  try {
    new RegExp(pattern, flags)
    return null
  } catch (err) {
    return `Élément [${index}] : pattern invalide — ${(err as Error).message}`
  }
}

/**
 * Valide que tous les patterns d'un tableau de règles sont des regex valides.
 */
function validateRulesRegexCompilable(
  rules: unknown[],
  sourceFile: string
): string | null {
  const errors: string[] = []
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i] as Record<string, unknown>
    if (!rule.pattern || !rule.flags) continue // déjà vérifié par ensureArrayOfObjects
    const err = tryCompilePattern(rule.pattern as string, rule.flags as string, i)
    if (err) errors.push(err)
  }
  if (errors.length > 0) {
    return `${sourceFile} — ${errors.length} problème(s) : ${errors.join(' ; ')}`
  }
  return null
}

/**
 * Détecte les doublons dans un tableau de règles.
 * Considère comme doublon deux règles ayant le même `pattern` + `reason`.
 * Le `flags` peut différer (une règle gi et une règle giu ne sont pas
 * considérées comme doublon — le pattern seul suffit à identifier un
 * doublon intentionnel).
 */
function validateRulesDuplicates(
  rules: unknown[],
  sourceFile: string
): string | null {
  const seen = new Map<string, number>()
  const errors: string[] = []

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i] as Record<string, unknown>
    const pattern = rule.pattern as string | undefined
    const reason = rule.reason as string | undefined
    if (!pattern || !reason) continue

    const key = `${reason}|${pattern}`
    const prev = seen.get(key)
    if (prev !== undefined) {
      errors.push(
        `Élément [${i}] "${reason}" duplique [${prev}] : même pattern et même raison`
      )
    } else {
      seen.set(key, i)
    }
  }

  if (errors.length > 0) {
    return `${sourceFile} — ${errors.length} doublon(s) : ${errors.join(' ; ')}`
  }
  return null
}

/**
 * Détecte les collisions : deux règles avec le même `pattern` mais des
 * `reason` différents. Cela signifie que le même pattern sert deux
 * intentions différentes, ce qui peut être un problème si les règles
 * ne s'excluent pas mutuellement (une règle peut en masquer une autre).
 *
 * Ce n'est pas toujours une erreur : parfois deux raisons légitimes
 * coexistent (ex: "salutation" et "salutation+politesse"). Le but est
 * d'alerter pour vérification humaine.
 */
function validateRulesCollisions(
  rules: unknown[],
  sourceFile: string
): string | null {
  const byPattern = new Map<string, Array<{ idx: number; reason: string }>>()
  const warnings: string[] = []

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i] as Record<string, unknown>
    const pattern = rule.pattern as string | undefined
    const reason = rule.reason as string | undefined
    if (!pattern || !reason) continue

    if (!byPattern.has(pattern)) {
      byPattern.set(pattern, [])
    }
    byPattern.get(pattern)!.push({ idx: i, reason })
  }

  for (const [pattern, items] of byPattern) {
    // On ignore les patterns utilisés par une seule règle
    if (items.length <= 1) continue

    // Vérifier si les raisons sont différentes (si toutes identiques,
    // c'est déjà détecté par validateRulesDuplicates)
    const uniqueReasons = new Set(items.map(i => i.reason))
    if (uniqueReasons.size <= 1) continue // toutes mêmes raisons → pas une collision

    const details = items
      .map(i => `[${i.idx}] "${i.reason}"`)
      .join(' vs ')
    const snippet = pattern.length > 60
      ? pattern.substring(0, 57) + '...'
      : pattern
    warnings.push(
      `Collision : ${details} → même pattern "${snippet}"`
    )
  }

  if (warnings.length > 0) {
    return `${sourceFile} — ${warnings.length} collision(s) : ${warnings.join(' ; ')}`
  }
  return null
}

// ── Échantillon de test pour la validation de cohérence ──
// Reprend le même texte que le test 11 du CLI (profil tiny),
// volontairement chargé en politesses et tournures verbeuses.
const COHERENCE_SAMPLE =
  "Bonjour, est-ce que tu peux s'il te plaît analyser ce code pour moi ? " +
  "Merci beaucoup d'avance. Je pense que c'est un bug dans la fonction de login. " +
  "En fait, je voudrais savoir s'il te plaît comment on pourrait corriger ce problème. " +
  "Désolé du dérangement, et merci encore pour ton aide."

/**
 * Vérifie la cohérence des règles appliquées : exécute l'optimiseur
 * sur un échantillon représentatif et s'assure que chaque `reason`
 * listée dans le résultat existe bien dans le fichier de règles.
 *
 * Cela détecte les cas où :
 *   - Une règle référencée par le code (via `reason`) n'existe plus
 *     dans le fichier JSON
 *   - Un `reason` a été mal orthographié ou modifié dans le code
 *     sans mise à jour correspondante du JSON
 */
function validateRulesAppliedCheck(
  rules: unknown[],
  sourceFile: string
): string | null {
  // Construire un set des raisons disponibles dans le fichier
  const availableReasons = new Set<string>()
  for (const rule of rules) {
    const r = rule as Record<string, unknown>
    const reason = r.reason as string | undefined
    if (reason) availableReasons.add(reason)
  }

  // Exécuter l'optimiseur sur l'échantillon
  const result = optimiserDetail(COHERENCE_SAMPLE, { trace: true })

  // Ignorer 'rollback-empty' qui est ajouté par l'optimiseur lui-même,
  // pas une règle du fichier JSON
  const applied = result.applied.filter(r => r !== 'rollback-empty')

  if (applied.length === 0) {
    // Aucune règle appliquée → impossible de vérifier la cohérence
    // (probablement un fichier de règles vide)
    return null
  }

  const missing: string[] = []
  for (const reason of applied) {
    if (!availableReasons.has(reason)) {
      missing.push(`"${reason}"`)
    }
  }

  if (missing.length > 0) {
    const sample = COHERENCE_SAMPLE.length > 60
      ? COHERENCE_SAMPLE.substring(0, 57) + '...'
      : COHERENCE_SAMPLE
    return `${sourceFile} — ${missing.length} raison(s) introuvable(s) parmi les règles : ${missing.join(', ')} (échantillon : "${sample}")`
  }
  return null
}

function ensureArrayOfObjects(field: string, requiredKeys: string[]): (data: unknown) => string | null {
  return (data: unknown) => {
    const obj = data as Record<string, unknown>
    if (!obj[field]) return `Champ "${field}" manquant`
    if (!Array.isArray(obj[field])) return `Champ "${field}" n'est pas un tableau`
    const arr = obj[field] as unknown[]
    for (let i = 0; i < arr.length; i++) {
      const item = arr[i] as Record<string, unknown>
      for (const key of requiredKeys) {
        if (!(key in item)) return `Élément [${i}] du champ "${field}" manque la clé "${key}"`
      }
    }
    return null
  }
}

function contextOptimiserValidator(data: unknown): string | null {
  const structErr = ensureArrayOfObjects('rules', ['pattern', 'flags', 'replacement', 'reason'])(data)
  if (structErr) return structErr

  // Vérifier la compilabilité de chaque pattern
  const rules = (data as Record<string, unknown>).rules as unknown[]
  const regexErr = validateRulesRegexCompilable(rules, 'context-optimiser.json')
  if (regexErr) return regexErr

  // Vérifier les doublons (même pattern + même raison)
  const dupErr = validateRulesDuplicates(rules, 'context-optimiser.json')
  if (dupErr) return dupErr

  // Vérifier les collisions (même pattern, raisons différentes)
  const colErr = validateRulesCollisions(rules, 'context-optimiser.json')
  if (colErr) return colErr

  // Vérifier la cohérence des règles appliquées (test sur échantillon)
  const appErr = validateRulesAppliedCheck(rules, 'context-optimiser.json')
  if (appErr) return appErr

  return null
}

function modelProfilesValidator(data: unknown): string | null {
  const obj = data as Record<string, unknown>
  // Vérifier profiles (Record<string, ...>)
  if (!obj.profiles || typeof obj.profiles !== 'object' || Array.isArray(obj.profiles)) {
    return 'Champ "profiles" manquant ou invalide (attend un objet nommé)'
  }
  const profiles = obj.profiles as Record<string, unknown>
  const profileKeys = Object.keys(profiles)
  if (profileKeys.length === 0) return 'Champ "profiles" est vide'

  // Vérifier que chaque profil a les champs requis
  for (const [name, p] of Object.entries(profiles)) {
    const profile = p as Record<string, unknown>
    if (!profile.options) return `Profil "${name}" manque le champ "options"`
    const opts = profile.options as Record<string, unknown>
    for (const key of ['keepRecent', 'maxCharsPerMessage', 'maxCharsPerSummaryLine']) {
      if (!(key in opts)) return `Profil "${name}" manque l'option "${key}"`
    }
  }

  // Vérifier rules
  const rulesErr = ensureArrayOfObjects('rules', ['pattern', 'flags', 'profile', 'reason'])(data)
  if (rulesErr) return `rules: ${rulesErr}`

  // Vérifier la compilabilité des patterns de règles
  const rules = obj.rules as unknown[]
  const rulesRegexErr = validateRulesRegexCompilable(rules, 'model-profiles.json')
  if (rulesRegexErr) return rulesRegexErr

  // Vérifier les doublons dans rules
  const rulesDupErr = validateRulesDuplicates(rules, 'model-profiles.json')
  if (rulesDupErr) return rulesDupErr

  // Vérifier les collisions dans rules
  const rulesColErr = validateRulesCollisions(rules, 'model-profiles.json')
  if (rulesColErr) return rulesColErr

  // Vérifier routerPatterns
  const rpErr = ensureArrayOfObjects('routerPatterns', ['pattern', 'flags'])(data)
  if (rpErr) return `routerPatterns: ${rpErr}`

  // Vérifier la compilabilité des patterns de routage
  const routerPatterns = obj.routerPatterns as unknown[]
  const rpRegexErr = validateRulesRegexCompilable(routerPatterns, 'model-profiles.json (routerPatterns)')
  if (rpRegexErr) return rpRegexErr

  // Note : on ne vérifie PAS les doublons dans routerPatterns
  // car ils n'ont pas de champ 'reason' (seulement pattern + flags).

  return null
}

function intercomPatternsValidator(data: unknown): string | null {
  return ensureArrayOfObjects('patterns', ['keywords', 'minMatch', 'subject'])(data)
}

/**
 * Détecte les doublons d'id dans les règles d'or.
 */
function validateGoldenRulesDuplicates(
  rules: unknown[],
  sourceFile: string
): string | null {
  const seen = new Map<string, number>()
  const errors: string[] = []

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i] as Record<string, unknown>
    const id = rule.id as string | undefined
    if (!id) continue

    const prev = seen.get(id)
    if (prev !== undefined) {
      errors.push(
        `Élément [${i}] id="${id}" duplique [${prev}]`
      )
    } else {
      seen.set(id, i)
    }
  }

  if (errors.length > 0) {
    return `${sourceFile} — ${errors.length} doublon(s) : ${errors.join(' ; ')}`
  }
  return null
}

/**
 * Détecte les collisions dans les règles d'or : deux règles avec le même
 * `check` (la logique de validation) mais des `id` différents. Cela
 * signifie que la même validation est définie deux fois avec des noms
 * différents, ce qui peut causer des confusions.
 */
function validateGoldenRulesCollisions(
  rules: unknown[],
  sourceFile: string
): string | null {
  const byCheck = new Map<string, Array<{ idx: number; id: string; description: string }>>()
  const warnings: string[] = []

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i] as Record<string, unknown>
    const id = rule.id as string | undefined
    const check = rule.check as string | undefined
    const description = rule.description as string | undefined
    if (!id || !check) continue

    if (!byCheck.has(check)) {
      byCheck.set(check, [])
    }
    byCheck.get(check)!.push({ idx: i, id, description: description ?? '—' })
  }

  for (const [check, items] of byCheck) {
    if (items.length <= 1) continue

    const uniqueIds = new Set(items.map(i => i.id))
    if (uniqueIds.size <= 1) continue // toutes mêmes id → doublon, pas collision

    const details = items
      .map(i => `[${i.idx}] "${i.id}"`)
      .join(' vs ')
    const snippet = check.length > 60
      ? check.substring(0, 57) + '...'
      : check
    warnings.push(
      `Collision : ${details} → même check "${snippet}"`
    )
  }

  if (warnings.length > 0) {
    return `${sourceFile} — ${warnings.length} collision(s) : ${warnings.join(' ; ')}`
  }
  return null
}

function goldenRulesValidator(data: unknown, sourceFile?: string): string | null {
  const structErr = ensureArrayOfObjects('rules', ['id', 'description', 'check'])(data)
  if (structErr) return structErr

  const rules = (data as Record<string, unknown>).rules as unknown[]
  const label = sourceFile ?? 'golden-rules'

  // Vérifier les doublons d'id
  const dupErr = validateGoldenRulesDuplicates(rules, label)
  if (dupErr) return dupErr

  // Vérifier les collisions de check
  const colErr = validateGoldenRulesCollisions(rules, label)
  if (colErr) return colErr

  return null
}

// ── Registre des fichiers à valider ──

const RULE_FILES: RuleFileEntry[] = [
  {
    path: join('data', 'rules', 'context-optimiser.json'),
    label: 'Règles de compression (optimiser)',
    validate: contextOptimiserValidator,
  },
  {
    path: join('data', 'model-profiles.json'),
    label: 'Profils de compression par modèle',
    validate: modelProfilesValidator,
  },
  {
    path: join('data', 'cahier-aides-alice', 'intercom-patterns.json'),
    label: 'Patterns intercom (routage Alice)',
    validate: intercomPatternsValidator,
  },
  {
    path: join('data', 'golden-rules', 'agent_structure.json'),
    label: 'Règles d\'or — structure agent',
    validate: goldenRulesValidator,
    critical: true,
  },
  {
    path: join('data', 'golden-rules', 'skill_structure.json'),
    label: 'Règles d\'or — structure skill',
    validate: goldenRulesValidator,
    critical: true,
  },
  {
    path: join('data', 'golden-rules', 'script_logic.json'),
    label: 'Règles d\'or — logique script',
    validate: goldenRulesValidator,
    critical: true,
  },
  {
    path: join('data', 'golden-rules', 'orchestration_team.json'),
    label: 'Règles d\'or — équipe orchestration',
    validate: goldenRulesValidator,
    critical: true,
  },
]

// ── Validation ──

function validateOne(entry: RuleFileEntry, rootDir: string): ValidationResult {
  const fullPath = join(rootDir, entry.path)

  // Vérifier existence
  if (!existsSync(fullPath)) {
    return {
      path: entry.path,
      label: entry.label,
      ok: false,
      error: 'Fichier introuvable',
    }
  }

  // Vérifier syntaxe JSON
  let parsed: unknown
  try {
    const raw = readFileSync(fullPath, 'utf-8')
    parsed = JSON.parse(raw)
  } catch (err) {
    return {
      path: entry.path,
      label: entry.label,
      ok: false,
      error: `JSON invalide : ${(err as Error).message}`,
    }
  }

  // Vérifier structure (si validateur fourni)
  if (entry.validate) {
    // Passer le nom du fichier source pour les messages d'erreur
    const sourceFileName = entry.path.split(/[\\/]/).pop() ?? entry.label
    const errMsg = entry.validate(parsed, sourceFileName)
    if (errMsg) {
      return {
        path: entry.path,
        label: entry.label,
        ok: false,
        error: `Structure invalide : ${errMsg}`,
      }
    }
  }

  return { path: entry.path, label: entry.label, ok: true }
}

/**
 * Valide tous les fichiers JSON de règles au démarrage.
 * Affiche les résultats dans une boîte formatée.
 * Non bloquant : le processus continue même en cas d'erreur,
 * mais les fichiers critiques émettent un avertissement plus visible.
 *
 * @returns true si tous les fichiers sont valides, false sinon.
 */
export function validateRulesAtStartup(): boolean {
  const rootDir = process.cwd()
  const results: ValidationResult[] = []

  for (const entry of RULE_FILES) {
    results.push(validateOne(entry, rootDir))
  }

  const ok = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok)
  const criticalFailed = failed.filter(f =>
    RULE_FILES.find(e => e.path === f.path)?.critical
  )

  // ── Choisir la couleur du cadre ──
  const frameOk = failed.length === 0
  const frameColor = frameOk ? '\x1b[32m' : '\x1b[33m' // green / yellow
  const reset = '\x1b[0m'
  const gray = '\x1b[90m'
  const red = '\x1b[31m'
  const green = '\x1b[32m'
  const yellow = '\x1b[33m'
  const bold = '\x1b[1m'

  console.log(`\n${bold}${frameColor}┌─ Validation des fichiers de règles ───────────────────┐${reset}`)
  for (const r of results) {
    const bullet = r.ok ? `${green}✓${reset}` : `${red}✗${reset}`
    console.log(`  ${bullet} ${r.label}`)
    if (!r.ok) {
      console.log(`     ${red}${r.error}${reset}`)
      console.log(`     ${gray}→ ${r.path}${reset}`)
    }
  }
  console.log(`  ${gray}${ok}/${results.length} OK${reset}`)

  if (criticalFailed.length > 0) {
    console.log(`\n  ${bold}${red}⚠  ATTENTION${reset}`)
    console.log(`  ${red}${criticalFailed.length} fichier(s) critique(s) invalide(s) :${reset}`)
    for (const f of criticalFailed) {
      console.log(`  ${red}  • ${f.path}${reset}`)
    }
    console.log(`  ${yellow}  Les règles d'or sont dégradées — les validations risquent d'être incomplètes.${reset}`)
  }

  if (failed.length === 0) {
    console.log(`  ${green}Tous les fichiers de règles sont valides.${reset}`)
  }

  console.log(`${bold}${frameColor}└────────────────────────────────────────────────────────┘${reset}\n`)

  return failed.length === 0
}

// ── Point d'entrée autonome (npm run validate:rules) ──

const isMainModule =
  process.argv[1]?.replace(/\\/g, '/').endsWith('validate-rules.js') ||
  process.argv[1]?.replace(/\\/g, '/').endsWith('validate-rules.ts')

if (isMainModule) {
  const allOk = validateRulesAtStartup()
  process.exit(allOk ? 0 : 1)
}
