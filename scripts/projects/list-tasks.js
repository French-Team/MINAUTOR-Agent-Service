#!/usr/bin/env node
/**
 * scripts/projects/list-tasks.js — Lister les tâches avec filtres
 *
 * Affiche les tâches d'un projet avec filtrage optionnel par domaine
 * et/ou statut. Les filtres sont extraits automatiquement de la demande.
 *
 * Exemples de déclencheurs :
 *   "liste les tâches du projet X"
 *   "liste les tâches backend du projet X"
 *   "liste les tâches terminées du projet X"
 *   "liste les tâches backend en cours du projet X"
 *   "liste les tâches bloquées du projet X"
 *
 * Variables d'environnement :
 *   SCRIPT_PARAM_PROJECT — nom du projet (depuis le pattern registry)
 *   SCRIPT_PROJECT      — nom du projet (depuis le payload intercom)
 *   SCRIPT_DEMANDE      — demande utilisateur brute
 *
 * Usage:
 *   node scripts/projects/list-tasks.js
 *   node scripts/projects/list-tasks.js --json
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = join(fileURLToPath(import.meta.url), '..')
const PROJECT_ROOT = join(__dirname, '..', '..')
const WORKSPACES_DIR = join(PROJECT_ROOT, 'workspaces')
const isJson = process.argv.includes('--json')

const KNOWN_AREAS = [
  'backend', 'frontend', 'docs', 'infra', 'devops', 'test', 'tests',
  'design', 'general', 'api', 'auth', 'db', 'config', 'deploy', 'security',
]

const STATUS_KEYWORDS = {
  'termin[eé]e[s]?|done|finie[s]?|complete[s]?|achev[eé]e[s]?': 'done',
  'en cours|active[s]?|in_progress|d[eé]marr[eé]e[s]?': 'in_progress',
  '[aà] faire|todo|pending|en attente|ouverte[s]?|planifi[eé]e[s]?': 'todo',
  'bloqu[eé]e[s]?|blocked|bloqu[eé]e': 'blocked',
  'annul[eé]e[s]?|cancelled|abandonn[eé]e[s]?': 'cancelled',
}

// ── Couleurs ANSI ──────────────────────────────────
const CYAN = '\x1b[36m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const RED = '\x1b[31m'
const GRAY = '\x1b[90m'
const BOLD = '\x1b[1m'
const RESET = '\x1b[0m'
const noColor = process.argv.includes('--no-color') || process.env.NO_COLOR
const C = c => noColor ? '' : c
const R = () => noColor ? '' : RESET

function statusEmoji(status) {
  switch (status) {
    case 'todo': return '⬜'
    case 'in_progress': return '🔄'
    case 'done': return '✅'
    case 'blocked': return '🚫'
    case 'cancelled': return '❌'
    default: return '❓'
  }
}

function statusLabel(status) {
  switch (status) {
    case 'todo': return 'À faire'
    case 'in_progress': return 'En cours'
    case 'done': return 'Terminée'
    case 'blocked': return 'Bloquée'
    case 'cancelled': return 'Annulée'
    default: return status
  }
}

// ── Utilitaires ────────────────────────────────────

function listProjects() {
  if (!existsSync(WORKSPACES_DIR)) return []
  return readdirSync(WORKSPACES_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.') && existsSync(join(WORKSPACES_DIR, e.name, '.workspace')))
    .map(e => e.name)
}

function readTaskBoard(name) {
  const tasksPath = join(WORKSPACES_DIR, name, '.tasks.json')
  if (!existsSync(tasksPath)) return { tasks: [] }
  try { return JSON.parse(readFileSync(tasksPath, 'utf-8')) }
  catch { return { tasks: [] } }
}

function plural(n, s) {
  return n !== 1 ? `${n} ${s}s` : `${n} ${s}`
}

// ── Extraction du nom de projet ────────────────────

function getProjectName() {
  let name = process.env.SCRIPT_PARAM_PROJECT
  if (!name) name = process.env.SCRIPT_PROJECT
  if (!name) {
    const demande = (process.env.SCRIPT_DEMANDE || '').toLowerCase()
    const match = demande.match(/(?:projet|project)\s+["']?([a-z0-9][a-z0-9_-]*)/)
    if (match) name = match[1]
  }
  return name || null
}

// ── Extraction des filtres ─────────────────────────

function parseAreaFilter(demande) {
  if (!demande) return null
  const lower = demande.toLowerCase().trim()
  for (const area of KNOWN_AREAS) {
    // Le domaine doit être entouré d'espaces, début/fin de chaîne, ou ponctuation
    // pour éviter de matcher dans les noms de projet (ex: "test" dans "list-tasks-test")
    const re = new RegExp('(?:^|\\s)' + area + '(?=$|\\s|[.,;!?])')
    if (re.test(lower)) return area
  }
  return null
}

function parseStatusFilter(demande) {
  if (!demande) return null
  const lower = demande.toLowerCase()
  for (const [pattern, status] of Object.entries(STATUS_KEYWORDS)) {
    const re = new RegExp(`\\b(${pattern})\\b`)
    if (re.test(lower)) return status
  }
  return null
}

function parseFilters() {
  const demande = (process.env.SCRIPT_DEMANDE || '').toLowerCase()
  return {
    area: parseAreaFilter(demande),
    status: parseStatusFilter(demande),
  }
}

// ── Affichage ──────────────────────────────────────

function showTaskList(projectName, tasks, filters) {
  const lines = []

  lines.push('')
  lines.push(`${CYAN}${BOLD}═══════════════════════════════════════════${R()}`)
  lines.push(`  ${BOLD}📋 Tâches : ${projectName}${R()}`)

  // Indiquer les filtres actifs
  const filterParts = []
  if (filters.area) filterParts.push(`domaine: ${CYAN}${filters.area}${R()}`)
  if (filters.status) filterParts.push(`statut: ${statusLabel(filters.status)}`)
  if (filterParts.length > 0) {
    lines.push(`  ${GRAY}Filtre${R()} : ${filterParts.join(', ')}`)
  }

  lines.push(`${CYAN}${BOLD}═══════════════════════════════════════════${R()}`)
  lines.push('')

  if (tasks.length === 0) {
    const areaHint = filters.area ? ` dans ${filters.area}` : ''
    const statusHint = filters.status ? ` en statut "${statusLabel(filters.status)}"` : ''
    lines.push(`  ${YELLOW}Aucune tâche${areaHint}${statusHint}.${R()}`)
    lines.push('')
    lines.push(`  ${GRAY}Pour ajouter une tâche : "ajoute une tâche \"...\" dans <domaine> au projet ${projectName}"${R()}`)
    lines.push('')
    return lines.join('\n')
  }

  // Grouper par statut si pas de filtre statut actif
  if (!filters.status) {
    const groups = { todo: [], in_progress: [], done: [], blocked: [], cancelled: [] }
    for (const t of tasks) {
      if (groups[t.status]) groups[t.status].push(t)
      else groups[t.status] = [t]
    }

    const order = ['in_progress', 'todo', 'blocked', 'done', 'cancelled']
    const labels = {
      in_progress: `${CYAN}${BOLD}🔄 En cours${R()}`,
      todo: `${YELLOW}${BOLD}⬜ À faire${R()}`,
      blocked: `${RED}${BOLD}🚫 Bloquée${R()}`,
      done: `${GREEN}${BOLD}✅ Terminée${R()}`,
      cancelled: `${GRAY}${BOLD}❌ Annulée${R()}`,
    }

    for (const status of order) {
      const group = groups[status]
      if (!group || group.length === 0) continue

      lines.push(`  ${labels[status]} (${group.length})`)
      for (const t of group) {
        const area = t.area ? ` ${GRAY}[${t.area}]${R()}` : ''
        const deps = t.dependsOn && t.dependsOn.length > 0
          ? ` ${GRAY}(attend: ${t.dependsOn.join(', ')})${R()}` : ''
        lines.push(`    ${statusEmoji(t.status)} ${t.id}${R()} ${t.title}${area}${deps}`)
      }
      lines.push('')
    }
  } else {
    // Avec filtre statut — liste plate
    for (const t of tasks) {
      const area = t.area ? ` ${GRAY}[${t.area}]${R()}` : ''
      const deps = t.dependsOn && t.dependsOn.length > 0
        ? ` ${GRAY}(attend: ${t.dependsOn.join(', ')})${R()}` : ''
      const assignee = t.assignedTo ? ` ${GRAY}→ ${t.assignedTo}${R()}` : ''
      lines.push(`  ${statusEmoji(t.status)} ${t.id} ${t.title}${area}${assignee}${deps}`)
    }
    lines.push('')
  }

  // Résumé
  const total = tasks.length
  const done = tasks.filter(t => t.status === 'done').length
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  lines.push(`  ${GRAY}${plural(total, 'tâche')} — ${pct}% terminée(s)${R()}`)
  lines.push('')

  // Suggestions
  lines.push(`  ${BOLD}${GREEN}Actions${R()}`)
  if (filters.status === 'blocked' || tasks.some(t => t.status === 'blocked')) {
    lines.push(`    ${GRAY}• Voir les détails : "état du projet ${projectName}"${R()}`)
    lines.push(`    ${GRAY}• Débloquer : "débloque la tâche <id> au projet ${projectName}"${R()}`)
  }
  if (filters.status === 'todo' || tasks.some(t => t.status === 'todo')) {
    lines.push(`    ${GRAY}• Démarrer : "continue sur le projet ${projectName}"${R()}`)
  }
  lines.push(`    ${GRAY}• Ajouter : "ajoute une tâche \"...\" dans <domaine> au projet ${projectName}"${R()}`)
  lines.push('')

  return lines.join('\n')
}

// ── Main ────────────────────────────────────────────

function findAndList(projectName) {
  const board = readTaskBoard(projectName)
  const filters = parseFilters()

  let tasks = board.tasks || []

  // Filtrer par domaine
  if (filters.area) {
    tasks = tasks.filter(t => t.area === filters.area)
  }

  // Filtrer par statut
  if (filters.status) {
    tasks = tasks.filter(t => t.status === filters.status)
  }

  if (isJson) {
    console.log(JSON.stringify({
      project: projectName,
      filters,
      total: tasks.length,
      tasks: tasks.map(t => ({
        id: t.id,
        title: t.title,
        area: t.area,
        status: t.status,
        assignedTo: t.assignedTo || null,
        dependsOn: t.dependsOn || [],
        createdAt: t.createdAt,
      })),
    }, null, 2))
    process.exit(0)
  }

  console.log(showTaskList(projectName, tasks, filters))
  process.exit(0)
}

function main() {
  const projectName = getProjectName()

  if (!projectName) {
    const projects = listProjects()
    if (projects.length === 1) {
      return findAndList(projects[0])
    }

    if (isJson) {
      console.log(JSON.stringify({ projects: listProjects() }, null, 2))
    } else {
      console.log(`${YELLOW}⚠ Aucun projet spécifié.${R()}`)
      console.log('   Dis par exemple : "liste les tâches backend du projet mon-projet"')
      console.log('   Ou : "liste les tâches terminées du projet mon-projet"')
      if (projects.length > 0) {
        console.log(`\n   Projets disponibles : ${projects.join(', ')}`)
      }
    }
    process.exit(0)
  }

  if (!existsSync(join(WORKSPACES_DIR, projectName))) {
    console.log(`${RED}❌ Projet "${projectName}" introuvable.${R()}`)
    const projects = listProjects()
    if (projects.length > 0) {
      console.log(`   Projets disponibles : ${projects.join(', ')}`)
    }
    process.exit(1)
  }

  findAndList(projectName)
}

main()
