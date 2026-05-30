#!/usr/bin/env node
/**
 * scripts/projects/menu.js — Menu de navigation projet
 *
 * Affiche les actions disponibles pour un projet (commencer, continuer, état, etc.)
 * Déclenché par "commencer le projet", "menu projet", ou par défaut pour un projet.
 *
 * Variables d'environnement :
 *   SCRIPT_PARAM_PROJECT — nom du projet (depuis le pattern registry)
 *   SCRIPT_PROJECT      — nom du projet (depuis le payload intercom)
 *   SCRIPT_DEMANDE      — demande utilisateur brute
 *
 * Usage:
 *   node scripts/projects/menu.js
 *   node scripts/projects/menu.js --json
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = join(fileURLToPath(import.meta.url), '..')
const PROJECT_ROOT = join(__dirname, '..', '..')
const WORKSPACES_DIR = join(PROJECT_ROOT, 'workspaces')
const isJson = process.argv.includes('--json')

// ── Couleurs ANSI ──────────────────────────────────
const CYAN = '\x1b[36m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const RED = '\x1b[31m'
const GRAY = '\x1b[90m'
const BOLD = '\x1b[1m'
const RESET = '\x1b[0m'
const noColor = process.argv.includes('--no-color') || process.env.NO_COLOR
const C = (c) => noColor ? '' : c
const R = () => noColor ? '' : RESET

// ── Utilitaires ────────────────────────────────────

function listProjects() {
  if (!existsSync(WORKSPACES_DIR)) return []
  return readdirSync(WORKSPACES_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.') && existsSync(join(WORKSPACES_DIR, e.name, '.workspace')))
    .map(e => e.name)
}

function readProjectInfo(name) {
  const wsPath = join(WORKSPACES_DIR, name, '.workspace')
  if (!existsSync(wsPath)) return null
  try {
    const raw = readFileSync(wsPath, 'utf-8')
    const info = {}
    for (const line of raw.split('\n')) {
      const m = line.match(/^(\w[\w-]*):\s*(.*)/)
      if (m) info[m[1]] = m[2].replace(/^['"]|['"]$/g, '').trim()
    }
    return info
  } catch { return null }
}

function readTaskStats(name) {
  const tasksPath = join(WORKSPACES_DIR, name, '.tasks.json')
  if (!existsSync(tasksPath)) return { total: 0, done: 0, inProgress: 0, todo: 0, blocked: 0 }
  try {
    const board = JSON.parse(readFileSync(tasksPath, 'utf-8'))
    const tasks = board.tasks || []
    return {
      total: tasks.length,
      done: tasks.filter(t => t.status === 'done').length,
      inProgress: tasks.filter(t => t.status === 'in_progress').length,
      todo: tasks.filter(t => t.status === 'todo' || !t.status).length,
      blocked: tasks.filter(t => t.status === 'blocked').length,
    }
  } catch { return { total: 0, done: 0, inProgress: 0, todo: 0, blocked: 0 } }
}

function currentTask(name) {
  const tasksPath = join(WORKSPACES_DIR, name, '.tasks.json')
  if (!existsSync(tasksPath)) return null
  try {
    const board = JSON.parse(readFileSync(tasksPath, 'utf-8'))
    const tasks = board.tasks || []
    return tasks.find(t => t.status === 'in_progress') || tasks.find(t => t.status === 'todo' || !t.status) || null
  } catch { return null }
}

// ── Extraction du nom de projet ────────────────────

function getProjectName() {
  // Priorité 1 : paramètre explicite du pattern
  let name = process.env.SCRIPT_PARAM_PROJECT
  // Priorité 2 : projet passé par le daemon (payload.project)
  if (!name) name = process.env.SCRIPT_PROJECT
  // Priorité 3 : extraction depuis la demande
  if (!name) {
    const demande = (process.env.SCRIPT_DEMANDE || '').toLowerCase()
    const match = demande.match(/(?:projet|project)\s+["']?([a-z0-9][a-z0-9_-]*)/)
    if (match) name = match[1]
  }
  return name || null
}

// ── Affichage menu projet ──────────────────────────

function showProjectMenu(name) {
  const info = readProjectInfo(name)
  if (!info) return null

  const stats = readTaskStats(name)
  const current = currentTask(name)

  const statusIcon = info['status'] === 'active' ? '●' : info['status'] === 'archived' ? '○' : '◌'
  const statusColor = info['status'] === 'active' ? GREEN : info['status'] === 'archived' ? GRAY : YELLOW

  const lines = []

  // ── En-tête ──
  lines.push('')
  lines.push(`${CYAN}${BOLD}═══════════════════════════════════════${R()}`)
  lines.push(`  ${CYAN}📂 Projet : ${BOLD}${name}${R()}`)
  lines.push(`  ${statusColor}${statusIcon} ${info['status'] || 'active'}${R()}`)
  if (info['description'] && info['description'] !== '(aucune description)') {
    lines.push(`  ${GRAY}${info['description']}${R()}`)
  }
  lines.push(`${CYAN}${BOLD}═══════════════════════════════════════${R()}`)

  // ── Résumé des tâches ──
  lines.push('')
  lines.push(`  ${BOLD}Résumé des tâches${R()}  ${GRAY}(${stats.total} totales)${R()}`)
  if (stats.total > 0) {
    const progressPct = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0
    const barLen = 20
    const filled = Math.round((progressPct / 100) * barLen)
    const bar = `${GREEN}${'█'.repeat(filled)}${GRAY}${'░'.repeat(barLen - filled)}${R()}`
    lines.push(`    ${bar}  ${GREEN}${stats.done}✓${R()} ${CYAN}${stats.inProgress}⟳${R()} ${YELLOW}${stats.todo}□${R()}${stats.blocked > 0 ? ` ${RED}${stats.blocked}⊘${R()}` : ''}`)
  } else {
    lines.push(`    ${GRAY}Aucune tâche pour l'instant${R()}`)
  }

  // ── Tâche en cours ──
  if (current) {
    lines.push('')
    const statusTag = current.status === 'in_progress'
      ? `${CYAN}⟳ En cours${R()}`
      : `${YELLOW}□ À faire${R()}`
    const area = current.area ? ` ${GRAY}[${current.area}]${R()}` : ''
    lines.push(`  ${BOLD}Tâche active${R()} : ${statusTag}`)
    lines.push(`    ${current.title}${area}`)
    if (current.assignedTo) {
      lines.push(`    ${GRAY}Assigné à : ${current.assignedTo}${R()}`)
    }
  }

  // ── Actions disponibles ──
  lines.push('')
  lines.push(`  ${BOLD}${CYAN}Actions disponibles${R()} :`)
  lines.push('')
  lines.push(`    ${CYAN}[1]${R()}  Commencer le projet        ${GRAY}— lancer le travail sur le projet${R()}`)
  lines.push(`    ${CYAN}[2]${R()}  Continuer le travail        ${GRAY}— voir la prochaine tâche${R()}`)
  lines.push(`    ${CYAN}[3]${R()}  État du projet              ${GRAY}— détails complets${R()}`)
  lines.push(`    ${CYAN}[4]${R()}  Liste des tâches            ${GRAY}— toutes les tâches${R()}`)
  lines.push(`    ${CYAN}[5]${R()}  Ajouter une tâche           ${GRAY}— nouvelle tâche${R()}`)
  lines.push('')
  lines.push(`  ${GRAY}Pour agir, dis par exemple :${R()}`)
  lines.push(`    "continuer le projet ${name}"`)
  lines.push(`    "état du projet ${name}"`)
  lines.push(`    "liste des tâches ${name}"`)
  lines.push('')

  return lines.join('\n')
}

function showProjectList() {
  const projects = listProjects()
  if (projects.length === 0) {
    return `${YELLOW}Aucun projet trouvé.${R()}\nCrée un projet avec : "crée un projet <nom>"`
  }

  const lines = []
  lines.push(`\n${CYAN}${BOLD}📂 Projets disponibles (${projects.length})${R()}\n`)

  for (const name of projects) {
    const info = readProjectInfo(name)
    const stats = readTaskStats(name)
    const statusIcon = info?.['status'] === 'active' ? '●' : info?.['status'] === 'archived' ? '○' : '◌'
    const statusColor = info?.['status'] === 'active' ? GREEN : GRAY
    const desc = info?.['description'] && info['description'] !== '(aucune description)'
      ? ` ${GRAY}— ${info['description']}${R()}`
      : ''

    lines.push(`  ${statusColor}${statusIcon}${R()} ${CYAN}${name}${R()}${desc}`)
    if (stats.total > 0) {
      lines.push(`    ${GREEN}✓${stats.done}${R()} ${CYAN}⟳${stats.inProgress}${R()} ${YELLOW}□${stats.todo}${R()} ${GRAY}— ${stats.total} tâches${R()}`)
    }
  }

  lines.push('')
  lines.push(`${GRAY}Pour travailler sur un projet : "continuer le projet <nom>"${R()}`)
  lines.push(`${GRAY}Pour voir les détails      : "état du projet <nom>"${R()}`)
  lines.push('')

  return lines.join('\n')
}

// ── Main ────────────────────────────────────────────

function main() {
  const projectName = getProjectName()

  if (isJson) {
    const projects = listProjects()
    const data = {
      project: projectName || null,
      projects: projects.length > 0 ? projects.map(name => ({
        name,
        ...readProjectInfo(name),
        tasks: readTaskStats(name),
      })) : [],
      actions: [
        { id: 1, name: 'commencer', description: 'Commencer le projet' },
        { id: 2, name: 'continuer', description: 'Continuer le travail' },
        { id: 3, name: 'etat', description: 'État du projet' },
        { id: 4, name: 'taches', description: 'Liste des tâches' },
        { id: 5, name: 'ajouter-tache', description: 'Ajouter une tâche' },
      ],
    }
    console.log(JSON.stringify(data, null, 2))
    process.exit(0)
  }

  if (projectName) {
    const output = showProjectMenu(projectName)
    if (output) {
      console.log(output)
    } else {
      console.log(`${RED}❌ Projet "${projectName}" introuvable.${R()}`)
      console.log(showProjectList())
    }
  } else {
    console.log(showProjectList())
  }

  process.exit(0)
}

main()
