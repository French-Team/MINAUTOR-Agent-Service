#!/usr/bin/env node
/**
 * scripts/projects/work.js — Continuer/travailler sur le projet
 *
 * Affiche la prochaine tâche disponible, la démarre si nécessaire,
 * et guide l'utilisateur vers les actions suivantes.
 *
 * Déclenché par "continuer le projet", "travailler sur le projet",
 * "prochaine tâche", "commencer le travail"
 *
 * Variables d'environnement :
 *   SCRIPT_PARAM_PROJECT — nom du projet (depuis le pattern registry)
 *   SCRIPT_PROJECT      — nom du projet (depuis le payload intercom)
 *   SCRIPT_DEMANDE      — demande utilisateur brute
 *
 * Usage:
 *   node scripts/projects/work.js
 *   node scripts/projects/work.js --json
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
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
const C = c => noColor ? '' : c
const R = () => noColor ? '' : RESET

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

function writeTaskBoard(board, name) {
  const tasksPath = join(WORKSPACES_DIR, name, '.tasks.json')
  board.lastUpdated = new Date().toISOString()
  writeFileSync(tasksPath, JSON.stringify(board, null, 2), 'utf-8')
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

// ── Affichage ─────────────────────────────────────

function showWorkView(name) {
  const info = readProjectInfo(name)
  if (!info) return null

  const board = readTaskBoard(name)
  let tasks = board.tasks || []

  // Tâche en cours → prioritaire
  const activeTask = tasks.find(t => t.status === 'in_progress')
  // Prochaine tâche à faire
  const nextTask = !activeTask ? tasks.find(t => t.status === 'todo' || !t.status) : null

  const lines = []

  // ── En-tête ──
  lines.push('')
  const statusColor = info['status'] === 'active' ? GREEN : info['status'] === 'archived' ? GRAY : YELLOW
  lines.push(`${CYAN}${BOLD}═══════════════════════════════════════${R()}`)
  lines.push(`  ${CYAN}🔧 Projet : ${BOLD}${name}${R()}  ${statusColor}${info['status']}${R()}`)
  lines.push(`${CYAN}${BOLD}═══════════════════════════════════════${R()}`)

  // ── Tâche active ──
  if (activeTask) {
    const area = activeTask.area ? ` ${GRAY}[${activeTask.area}]${R()}` : ''
    const started = activeTask.startedAt
      ? ` ${GRAY}(démarré le ${new Date(activeTask.startedAt).toLocaleDateString()})${R()}`
      : ''
    lines.push('')
    lines.push(`  ${CYAN}${BOLD}⟳ Tâche en cours${R()}`)
    lines.push(`    ${BOLD}${activeTask.title}${R()}${area}`)
    lines.push(`    ${GRAY}ID: ${activeTask.id}${R()}${started}`)
    if (activeTask.assignedTo) {
      lines.push(`    ${GRAY}Assigné à : ${activeTask.assignedTo}${R()}`)
    }
    if (activeTask.description) {
      lines.push(`    ${activeTask.description}`)
    }
    lines.push('')
    lines.push(`  ${GRAY}Continue sur cette tâche, ou démarre la suivante.${R()}`)
  }
  // ── Prochaine tâche ──
  else if (nextTask) {
    const area = nextTask.area ? ` ${GRAY}[${nextTask.area}]${R()}` : ''
    const created = nextTask.createdAt
      ? ` ${GRAY}(créé le ${new Date(nextTask.createdAt).toLocaleDateString()})${R()}`
      : ''
    lines.push('')
    lines.push(`  ${YELLOW}${BOLD}□ Prochaine tâche${R()}`)
    lines.push(`    ${BOLD}${nextTask.title}${R()}${area}`)
    lines.push(`    ${GRAY}ID: ${nextTask.id}${R()}${created}`)
    if (nextTask.description) {
      lines.push(`    ${nextTask.description}`)
    }
    lines.push('')
    lines.push(`  ${GREEN}Prêt à commencer ?${R()}`)
    lines.push(`    Dis "démarre la tâche ${nextTask.id}" pour commencer`)

    // Si la tâche a des dépendances
    if (nextTask.dependsOn && nextTask.dependsOn.length > 0) {
      const deps = nextTask.dependsOn.map(depId => {
        const dep = tasks.find(t => t.id === depId)
        return dep ? `${dep.title} (${dep.status})` : depId
      }).join(', ')
      lines.push(`    ${YELLOW}⚠ Dépend de : ${deps}${R()}`)
    }
  } else {
    // Aucune tâche
    lines.push('')
    lines.push(`  ${GRAY}Aucune tâche en cours ou à faire.${R()}`)
    lines.push(`  ${GRAY}Ajoute une tâche avec : "ajoute une tâche au projet ${name}"${R()}`)
  }

  // ── Résumé des tâches ──
  const done = tasks.filter(t => t.status === 'done').length
  const inProgress = tasks.filter(t => t.status === 'in_progress').length
  const todo = tasks.filter(t => t.status === 'todo' || !t.status).length
  const total = tasks.length
  const progressPct = total > 0 ? Math.round((done / total) * 100) : 0

  if (total > 0) {
    lines.push('')
    lines.push(`  ${BOLD}Résumé${R()}  ${progressPct}%  ${GREEN}✓${done}${R()}  ${CYAN}⟳${inProgress}${R()}  ${YELLOW}□${todo}${R()}`)
  }

  // ── Suite ──
  lines.push('')
  lines.push(`  ${BOLD}${GREEN}Prochaines actions${R()}`)
  lines.push(`    ${GRAY}• Voir l'état complet : "état du projet ${name}"${R()}`)
  lines.push(`    ${GRAY}• Voir les tâches    : "liste des tâches ${name}"${R()}`)
  lines.push(`    ${GRAY}• Menu projet        : "menu projet ${name}"${R()}`)
  lines.push('')

  return lines.join('\n')
}

// ── Main ────────────────────────────────────────────

function main() {
  const projectName = getProjectName()

  if (!projectName) {
    const projects = listProjects()
    if (projects.length === 1) {
      // Un seul projet → auto-sélection
      const output = showWorkView(projects[0])
      if (output) {
        if (isJson) {
          const board = readTaskBoard(projects[0])
          console.log(JSON.stringify({
            project: projects[0],
            info: readProjectInfo(projects[0]),
            tasks: board.tasks || [],
          }, null, 2))
        } else {
          console.log(output)
        }
      }
      process.exit(0)
    }

    if (isJson) {
      console.log(JSON.stringify({ projects: listProjects() }, null, 2))
    } else {
      console.log(`${YELLOW}⚠ Aucun projet spécifié.${R()}`)
      console.log('   Dis par exemple : "continuer le projet soulseek-downloader"')
      if (projects.length > 0) {
        console.log(`\n   Projets disponibles : ${projects.join(', ')}`)
      }
    }
    process.exit(0)
  }

  const output = showWorkView(projectName)
  if (output) {
    console.log(output)
  } else {
    console.log(`${RED}❌ Projet "${projectName}" introuvable.${R()}`)
    const projects = listProjects()
    if (projects.length > 0) {
      console.log(`   Projets disponibles : ${projects.join(', ')}`)
    }
    process.exit(1)
  }

  process.exit(0)
}

main()
