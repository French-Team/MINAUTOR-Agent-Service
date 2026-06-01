#!/usr/bin/env node
/**
 * script-runner.ts — Moteur de matching pattern + exécution de scripts
 *
 * Remplace l'inférence LLM par des scripts pré-écrits garantis.
 * L'agent ne fait QUE matcher le pattern et lancer le script.
 *
 * Usage (depuis un agent ou le daemon) :
 *   const result = matchAndExecute(message, subject, payload)
 *
 * Usage CLI :
 *   node dist/script-runner.js <subject> "<demande>" [--json]
 */

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
/**
 * Mini-parser YAML pour le registre de scripts.
 * Gère uniquement la structure connue du registry.yaml :
 *   scripts:
 *     - pattern: ...
 *       subject: ...
 *       script: ...
 *       description: ...
 *       params:
 *         - name: ...
 *           from: ...
 */
function parseYaml(yaml: string): ScriptRegistry {
  const scripts: ScriptEntry[] = []
  let currentEntry: Partial<ScriptEntry> | null = null
  let currentParams: Array<{ name: string; from: string }> | null = null
  let inParams = false

  const lines = yaml.split('\n')
  for (const line of lines) {
    const trimmed = line.trimEnd()

    // Début d'une entrée script
    const scriptMatch = trimmed.match(/^\s*-\s+pattern:\s*"(.+)"/)
    if (scriptMatch) {
      if (currentEntry && currentEntry.pattern && currentEntry.script) {
        // Assigner les params avant de push (ils sont collectés dans currentParams)
        currentEntry.params = (currentParams ?? undefined) as Array<{ name: string; from: string }> | undefined
        scripts.push(currentEntry as ScriptEntry)
      }
      currentEntry = { pattern: scriptMatch[1] }
      currentParams = null
      inParams = false
      continue
    }

    if (!currentEntry) continue

    // subject
    const subjectMatch = trimmed.match(/^\s+subject:\s*"(.+)"/)
    if (subjectMatch) { currentEntry.subject = subjectMatch[1]; continue }

    const subjectMatch2 = trimmed.match(/^\s+subject:\s*(\S+)/)
    if (subjectMatch2) { currentEntry.subject = subjectMatch2[1]; continue }

    // script
    const scriptMatch2 = trimmed.match(/^\s+script:\s*"(.+)"/)
    if (scriptMatch2) { currentEntry.script = scriptMatch2[1]; continue }

    const scriptMatch3 = trimmed.match(/^\s+script:\s*(\S+)/)
    if (scriptMatch3) { currentEntry.script = scriptMatch3[1]; continue }

    // description
    const descMatch = trimmed.match(/^\s+description:\s*"(.+)"/)
    if (descMatch) { currentEntry.description = descMatch[1]; continue }

    const descMatch2 = trimmed.match(/^\s+description:\s*(\S+)/)
    if (descMatch2) { currentEntry.description = descMatch2[1]; continue }

    // params:
    if (trimmed.match(/^\s+params:/)) {
      currentParams = []
      inParams = true
      continue
    }

    // name: dans params
    if (inParams) {
      const nameMatch = trimmed.match(/^\s+-\s+name:\s*"(.+)"/)
      if (nameMatch) {
        currentParams!.push({ name: nameMatch[1], from: '' })
        continue
      }
      const nameMatch2 = trimmed.match(/^\s+-\s+name:\s*(\S+)/)
      if (nameMatch2) {
        currentParams!.push({ name: nameMatch2[1], from: '' })
        continue
      }

      // from: dans params
      if (currentParams!.length > 0) {
        const fromMatch = trimmed.match(/^\s+from:\s*(\S+)/)
        if (fromMatch) {
          const last = currentParams![currentParams!.length - 1]
          last.from = fromMatch[1]
          continue
        }
      }

      // Sortie de params (retour à un champ racine)
      if (trimmed.match(/^\s+\w+:/) && !trimmed.startsWith(' ')) {
        inParams = false
      }
    }
  }

  // Dernière entrée
  if (currentEntry && currentEntry.pattern && currentEntry.script) {
    currentEntry.params = currentParams ?? undefined
    scripts.push(currentEntry as ScriptEntry)
  }

  return { scripts }
}

// ── Types ──────────────────────────────────────────────

export interface ScriptEntry {
  pattern: string
  subject?: string
  script: string
  description: string
  params?: Array<{ name: string; from: string }>
}

export interface ScriptRegistry {
  scripts: ScriptEntry[]
}

export interface ScriptResult {
  matched: boolean
  script?: string
  pattern?: string
  subject?: string
  stdout: string
  stderr: string
  exitCode: number
  durationMs: number
  params?: Record<string, string>
}

// ── Chemins ────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PROJECT_ROOT = join(__dirname, '..')
const REGISTRY_PATH = join(PROJECT_ROOT, 'data', 'scripts', 'registry.yaml')

let _registry: ScriptRegistry | null = null

// ── Chargement du registre ─────────────────────────────

function loadRegistry(): ScriptRegistry {
  if (_registry) return _registry

  if (!existsSync(REGISTRY_PATH)) {
    console.error(`[ScriptRunner] Registre introuvable: ${REGISTRY_PATH}`)
    _registry = { scripts: [] }
    return _registry
  }

  try {
    const raw = readFileSync(REGISTRY_PATH, 'utf-8')
    const parsed = parseYaml(raw)
    _registry = parsed
    return _registry
  } catch (err) {
    console.error(`[ScriptRunner] Erreur de parsing du registre: ${(err as Error).message}`)
    _registry = { scripts: [] }
    return _registry
  }
}

/**
 * Recharge le registre (utile après modification).
 */
export function reloadRegistry(): ScriptRegistry {
  _registry = null
  return loadRegistry()
}

// ── Matching ───────────────────────────────────────────

export interface MatchResult {
  entry: ScriptEntry
  params: Record<string, string>
  match: RegExpMatchArray
}

/**
 * Trouve le premier script dont le pattern match la demande.
 * L'ordre du registre est respecté — premier match gagne.
 */
export function matchScript(
  demande: string,
  subject?: string,
): MatchResult | null {
  const registry = loadRegistry()
  const lowerDemande = demande.toLowerCase()

  for (const entry of registry.scripts) {
    // Filtre par subject si spécifié
    if (entry.subject && subject && entry.subject !== subject) {
      continue
    }

    // En l'absence de subject (appel CLI direct), ignorer les patterns catch-all .*
    // Ces patterns sont des fallbacks par catégorie, utiles uniquement quand
    // un subject est explicitement demandé (ex: depuis Alice ou un daemon).
    if (!subject && entry.pattern === '.*') {
      continue
    }

    try {
      const regex = new RegExp(entry.pattern, 'i')
      const match = lowerDemande.match(regex)

      if (match) {
        // Extraire les paramètres nommés
        const params: Record<string, string> = {}
        if (entry.params) {
          for (const p of entry.params) {
            const idx = parseInt(p.from, 10)
            if (!isNaN(idx) && match[idx]) {
              params[p.name] = match[idx].trim()
            }
          }
        }
        return { entry, params, match }
      }
    } catch {
      // Pattern regex invalide — on passe
      continue
    }
  }

  return null
}

// ── Exécution ──────────────────────────────────────────

/**
 * Exécute un script et retourne son résultat structuré.
 */
export function executeScript(
  scriptPath: string,
  env: Record<string, string> = {},
): ScriptResult {
  const start = Date.now()
  const fullPath = join(PROJECT_ROOT, scriptPath)

  if (!existsSync(fullPath)) {
    return {
      matched: true,
      script: scriptPath,
      stdout: '',
      stderr: `Script introuvable: ${fullPath}`,
      exitCode: -1,
      durationMs: Date.now() - start,
    }
  }

  try {
    // Déterminer le runtime selon l'extension
    let cmd: string
    if (scriptPath.endsWith('.js')) {
      cmd = `node "${fullPath}"`
    } else if (scriptPath.endsWith('.sh')) {
      cmd = `bash "${fullPath}"`
    } else if (scriptPath.endsWith('.ts')) {
      cmd = `npx tsx "${fullPath}"`
    } else {
      cmd = `"${fullPath}"`
    }

    const output = execSync(cmd, {
      encoding: 'utf-8',
      timeout: 30_000, // 30s max par script
      env: { ...process.env, ...env },
      windowsHide: true,
    })

    return {
      matched: true,
      script: scriptPath,
      stdout: output.trim(),
      stderr: '',
      exitCode: 0,
      durationMs: Date.now() - start,
    }
  } catch (err: unknown) {
    const error = err as {
      stdout?: string
      stderr?: string
      status?: number
      message: string
    }
    return {
      matched: true,
      script: scriptPath,
      stdout: (error.stdout ?? '').toString().trim(),
      stderr: (error.stderr ?? error.message ?? '').toString().trim(),
      exitCode: error.status ?? -1,
      durationMs: Date.now() - start,
    }
  }
}

// ── API principale ─────────────────────────────────────

/**
 * Match + exécute en un seul appel.
 * C'est l'API principale à utiliser depuis le daemon ou l'agent.
 *
 * @param demande - La demande utilisateur brute
 * @param subject - Subject intercom (optionnel, pour filtrage)
 * @param extraEnv - Variables d'environnement supplémentaires
 * @returns ScriptResult structuré
 */
export function matchAndExecute(
  demande: string,
  subject?: string,
  extraEnv: Record<string, string> = {},
): ScriptResult {
  const matched = matchScript(demande, subject)

  if (!matched) {
    return {
      matched: false,
      stdout: '',
      stderr: `Aucun pattern trouvé pour: "${demande}"${subject ? ` (subject: ${subject})` : ''}`,
      exitCode: -1,
      durationMs: 0,
    }
  }

  // Passer les paramètres extraits comme variables d'env
  const env: Record<string, string> = { ...extraEnv }
  if (matched.params) {
    for (const [key, value] of Object.entries(matched.params)) {
      env[`SCRIPT_PARAM_${key.toUpperCase()}`] = value
    }
  }
  env.SCRIPT_DEMANDE = demande
  if (subject) env.SCRIPT_SUBJECT = subject
  env.SCRIPT_PATTERN = matched.entry.pattern
  env.SCRIPT_DESCRIPTION = matched.entry.description

  const result = executeScript(matched.entry.script, env)
  // Transmettre les paramètres extraits dans le résultat
  result.params = { ...matched.params }
  return result
}

// ── CLI ────────────────────────────────────────────────

function cliMain(): void {
  const [subject, ...demandeParts] = process.argv.slice(2)
  const isJson = process.argv.includes('--json')

  if (!subject || demandeParts.length === 0) {
    console.error('Usage: node dist/script-runner.js <subject> "<demande>" [--json]')
    console.error('       node dist/script-runner.js project-request "liste les projets" --json')
    process.exit(1)
  }

  const demande = demandeParts.filter(p => p !== '--json').join(' ')
  const result = matchAndExecute(demande, subject)

  if (isJson) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    if (result.matched) {
      console.log(`[ScriptRunner] ✓ Match: ${result.script}`)
      console.log(`  Durée: ${result.durationMs}ms`)
      console.log(`  Code: ${result.exitCode}`)
      console.log('')
      if (result.stdout) console.log(result.stdout)
      if (result.stderr) console.error(result.stderr)
    } else {
      console.log(`[ScriptRunner] ✗ Aucun match`)
      console.log(`  ${result.stderr}`)
    }
  }

  process.exit(result.exitCode >= 0 ? result.exitCode : 1)
}/**
 * Retourne le registre brut (debug).
 */
export function debugRegistry(): ScriptRegistry {
  return loadRegistry()
}

// Appel direct ou export
if (process.argv[1]?.endsWith('script-runner.js') || process.argv[1]?.endsWith('script-runner.ts')) {
  cliMain()
}
