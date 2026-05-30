/**
 * validate-ci-yaml
 *
 * Valide la syntaxe et la structure de tous les workflows YAML
 * dans .github/workflows/*.yml en utilisant js-yaml.
 *
 * Usage :
 *   npx tsx src/validate-ci-yaml.ts
 *
 * Parcourt automatiquement tous les fichiers .yml/.yaml du dossier,
 * valide chacun, puis affiche un résumé global.
 * Retourne 0 si tout est valide, 1 si des erreurs sont détectées.
 */

import { readFileSync, existsSync, readdirSync } from 'fs'
import { load as yamlLoad } from 'js-yaml'
import { join } from 'path'

// ── ANSI ──

const RESET = '\x1b[0m'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const CYAN = '\x1b[36m'
const GRAY = '\x1b[90m'
const BOLD = '\x1b[1m'

// ── Runners valides connus ──

const VALID_RUNNERS = new Set([
  'ubuntu-latest',
  'ubuntu-22.04',
  'ubuntu-24.04',
  'windows-latest',
  'windows-2022',
  'macos-latest',
  'macos-14',
  'macos-15',
])

const VALID_NODE_VERSIONS = new Set(['22', '24'])

// ── Types ──

interface ValidationIssue {
  severity: 'error' | 'warning'
  message: string
  jobName?: string
  stepIndex?: number
}

interface CiJob {
  'runs-on'?: string
  'timeout-minutes'?: number
  steps?: unknown[]
  needs?: string[]
  strategy?: {
    matrix?: {
      'node-version'?: string[]
    }
  }
}

// ── Validation ──

function validateCiYaml(filePath: string): { issues: ValidationIssue[]; doc: Record<string, unknown> } {
  const issues: ValidationIssue[] = []
  let doc: Record<string, unknown> = {}

  // 1. Existence
  if (!existsSync(filePath)) {
    issues.push({ severity: 'error', message: `Fichier introuvable : ${filePath}` })
    return { issues, doc }
  }

  // 2. Parsing YAML
  try {
    const raw = readFileSync(filePath, 'utf-8')
    doc = yamlLoad(raw) as Record<string, unknown>
  } catch (err) {
    issues.push({ severity: 'error', message: `YAML invalide : ${(err as Error).message}` })
    return { issues, doc }
  }

  // 3. Structure de base
  if (!doc.name) issues.push({ severity: 'error', message: 'Champ "name" manquant' })
  if (!doc.on) issues.push({ severity: 'error', message: 'Champ "on" (déclencheurs) manquant' })
  if (!doc.jobs || typeof doc.jobs !== 'object' || Array.isArray(doc.jobs)) {
    issues.push({ severity: 'error', message: 'Champ "jobs" manquant ou invalide' })
    return { issues, doc }
  }

  const jobs = doc.jobs as Record<string, CiJob>
  const jobNames = Object.keys(jobs)

  if (jobNames.length === 0) {
    issues.push({ severity: 'error', message: 'Aucun job défini' })
    return { issues, doc }
  }

  // 4. Valider chaque job
  for (const [jobName, job] of Object.entries(jobs)) {
    validateJob(jobName, job, jobNames, issues)
  }

  return { issues, doc }
}

function validateJob(
  jobName: string,
  job: CiJob,
  allJobNames: string[],
  issues: ValidationIssue[],
): void {
  // 4a. runs-on
  if (!job['runs-on']) {
    issues.push({ severity: 'error', message: 'runs-on manquant', jobName })
  } else if (!VALID_RUNNERS.has(job['runs-on'])) {
    issues.push({
      severity: 'warning',
      message: `runs-on "${job['runs-on']}" non standard`,
      jobName,
    })
  }

  // 4b. timeout-minutes
  if (job['timeout-minutes'] !== undefined) {
    if (typeof job['timeout-minutes'] !== 'number' || job['timeout-minutes'] < 1) {
      issues.push({
        severity: 'error',
        message: `timeout-minutes invalide : ${job['timeout-minutes']}`,
        jobName,
      })
    }
  }

  // 4c. strategy.matrix.node-version
  const nodeVersions = job.strategy?.matrix?.['node-version']
  if (nodeVersions) {
    for (const v of nodeVersions) {
      if (!VALID_NODE_VERSIONS.has(String(v))) {
        issues.push({
          severity: 'warning',
          message: `Version Node.js "${v}" non standard (attendue : 22 ou 24)`,
          jobName,
        })
      }
    }
  }

  // 4d. steps
  if (!job.steps || !Array.isArray(job.steps) || job.steps.length === 0) {
    issues.push({ severity: 'error', message: 'Aucune step définie', jobName })
    return
  }

  for (let i = 0; i < job.steps.length; i++) {
    const step = job.steps[i] as Record<string, unknown>
    const stepNum = i + 1

    if (!step.name) {
      issues.push({
        severity: 'warning',
        message: `Step ${stepNum} : name manquant`,
        jobName,
        stepIndex: stepNum,
      })
    }

    if (!step.uses && !step.run) {
      issues.push({
        severity: 'error',
        message: `Step ${stepNum} "${step.name ?? '?'}" : ni uses ni run`,
        jobName,
        stepIndex: stepNum,
      })
    }

    // Vérifier format uses
    if (step.uses && typeof step.uses === 'string') {
      if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+@/.test(step.uses)) {
        issues.push({
          severity: 'warning',
          message: `Step ${stepNum} "${step.name}" : uses "${step.uses}" format suspect (attendu : owner/repo@ref)`,
          jobName,
          stepIndex: stepNum,
        })
      }
    }

    // Vérifier les chemins source : si un run référence src/ sans npx tsx
    if (step.run && typeof step.run === 'string' && step.run.includes('src/') && !step.run.startsWith('npx ')) {
      issues.push({
        severity: 'warning',
        message: `Step ${stepNum} "${step.name}" : run contient src/ sans npx tsx`,
        jobName,
        stepIndex: stepNum,
      })
    }

    // continue-on-error : vérifier la casse correcte (continue-on-error, pas continue-on-failure)
    if (step['continue-on-error'] !== undefined && typeof step['continue-on-error'] !== 'boolean') {
      issues.push({
        severity: 'warning',
        message: `Step ${stepNum} "${step.name}" : continue-on-error devrait être un booléen`,
        jobName,
        stepIndex: stepNum,
      })
    }
  }

  // 4e. needs
  if (job.needs && Array.isArray(job.needs)) {
    for (const need of job.needs) {
      if (!allJobNames.includes(need)) {
        issues.push({
          severity: 'error',
          message: `needs "${need}" : job introuvable`,
          jobName,
        })
      }
    }
  }
}

// ── Affichage ──

function displayIssues(filePath: string, issues: ValidationIssue[]): void {
  const shortPath = filePath.replace(/\\/g, '/').replace(/^.*[/](.github[/])/, '.github/')

  console.log(`\n${BOLD}${CYAN}══════════════════════════════════════════════${RESET}`)
  console.log(`${BOLD}${CYAN}  VALIDATION WORKFLOW : ${shortPath}${RESET}`)
  console.log(`${BOLD}${CYAN}══════════════════════════════════════════════${RESET}\n`)

  const errors = issues.filter(i => i.severity === 'error')
  const warnings = issues.filter(i => i.severity === 'warning')

  if (issues.length === 0) {
    console.log(`  ${GREEN}✅ Fichier valide — aucune anomalie détectée${RESET}\n`)
    return
  }

  if (errors.length > 0) {
    console.log(`  ${RED}${BOLD}❌ ${errors.length} ERREUR(S) :${RESET}\n`)
    for (const err of errors) {
      const ctx = err.jobName ? `[${err.jobName}]` : ''
      console.log(`     ${RED}•${RESET} ${ctx} ${err.message}`)
    }
    console.log('')
  }

  if (warnings.length > 0) {
    console.log(`  ${YELLOW}${BOLD}⚠ ${warnings.length} AVERTISSEMENT(S) :${RESET}\n`)
    for (const warn of warnings) {
      const ctx = warn.jobName ? `[${warn.jobName}]` : ''
      console.log(`     ${YELLOW}•${RESET} ${ctx} ${warn.message}`)
    }
    console.log('')
  }
}

function displaySummary(doc: Record<string, unknown>, issues: ValidationIssue[]): void {
  const jobs = doc.jobs as Record<string, CiJob> | undefined
  const jobNames = jobs ? Object.keys(jobs) : []
  const errors = issues.filter(i => i.severity === 'error').length
  const warnings = issues.filter(i => i.severity === 'warning').length

  console.log(`  ${GRAY}${'─'.repeat(46)}${RESET}`)
  console.log(`  ${GRAY}Jobs : ${jobNames.length}${RESET}`)
  for (const name of jobNames) {
    const job = jobs![name]
    const steps = job.steps?.length ?? 0
    const needs = job.needs?.join(', ') || '—'
    const runner = job['runs-on'] ?? '?'
    console.log(`    ${GRAY}•${RESET} ${CYAN}${name}${RESET} (${runner}) : ${steps} steps, dépend de [${needs}]`)
  }
  console.log(`  ${GRAY}${'─'.repeat(46)}${RESET}`)
  console.log(`  ${errors > 0 ? RED : GREEN}  ${errors} erreur(s), ${warnings} avertissement(s)${RESET}`)
  console.log('')
}

// ── Main ──

function main(): void {
  const cwd = process.cwd()
  const workflowsDir = join(cwd, '.github', 'workflows')

  if (!existsSync(workflowsDir)) {
    console.log(`\n  ${YELLOW}⚠ Dossier .github/workflows/ introuvable${RESET}\n`)
    return
  }

  const workflowFiles = readdirSync(workflowsDir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'))

  if (workflowFiles.length === 0) {
    console.log(`\n  ${YELLOW}⚠ Aucun fichier .yml/.yaml trouvé dans .github/workflows/${RESET}\n`)
    return
  }

  let totalErrors = 0
  let totalWarnings = 0
  const perFileCounts: { file: string; errors: number; warnings: number }[] = []

  for (const file of workflowFiles) {
    const filePath = join(workflowsDir, file)
    const { issues, doc } = validateCiYaml(filePath)

    displayIssues(filePath, issues)
    displaySummary(doc, issues)

    const errCount = issues.filter(i => i.severity === 'error').length
    const warnCount = issues.filter(i => i.severity === 'warning').length
    totalErrors += errCount
    totalWarnings += warnCount
    perFileCounts.push({ file, errors: errCount, warnings: warnCount })
  }

  const border = '═'.repeat(46)
  console.log(`\n  ${BOLD}${CYAN}${border}${RESET}`)
  console.log(`  ${BOLD}${CYAN}  RÉSUMÉ GLOBAL — ${workflowFiles.length} workflow(s)${RESET}`)
  console.log(`  ${BOLD}${CYAN}${border}${RESET}\n`)

  for (const { file, errors, warnings } of perFileCounts) {
    const status = errors > 0 ? `${RED}❌${RESET}` : `${GREEN}✅${RESET}`
    console.log(`  ${status} ${CYAN}${file}${RESET} — ${errors} erreur(s), ${warnings} avertissement(s)`)
  }

  console.log(`\n  ${GRAY}${'─'.repeat(46)}${RESET}`)
  const color = totalErrors > 0 ? RED : GREEN
  console.log(`  ${color}${BOLD}  Total : ${totalErrors} erreur(s), ${totalWarnings} avertissement(s)${RESET}\n`)

  process.exit(totalErrors > 0 ? 1 : 0)
}

// ── Point d'entrée autonome ──

const isMainModule =
  process.argv[1]?.replace(/\\/g, '/').endsWith('validate-ci-yaml.js') ||
  process.argv[1]?.replace(/\\/g, '/').endsWith('validate-ci-yaml.ts')

if (isMainModule) {
  main()
}
