#!/usr/bin/env node
/**
 * scripts/projects/add-task.js — Ajouter une tâche à un projet
 *
 * Ajoute une nouvelle tâche dans le .tasks.json du projet.
 * Le titre de la tâche peut être entre guillemets pour supporter les espaces.
 * Le domaine (area) est optionnel — par défaut "general".
 *
 * Déclenché par "ajoute une tâche <titre> au projet <projet>",
 * "ajoute tâche <titre> projet <projet>",
 * "nouvelle tâche <titre> dans <area> projet <projet>"
 *
 * Variables d'environnement :
 *   SCRIPT_PARAM_PROJECT — nom du projet (depuis le pattern registry)
 *   SCRIPT_PROJECT      — nom du projet (depuis le payload intercom)
 *   SCRIPT_DEMANDE      — demande utilisateur brute
 *
 * Usage:
 *   node scripts/projects/add-task.js
 *   node scripts/projects/add-task.js --json
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

// ── Parsing de la demande ──────────────────────────

function parseTaskInfo(demande) {
  // Titre : texte entre guillemets (prioritaire)
  let title = null
  let area = 'general'

  // Chercher le titre entre guillemets
  const quotedMatch = demande.match(/"([^"]+)"/)
  if (quotedMatch) {
    title = quotedMatch[1].trim()
  }

  // Domaine (area) : mot après "dans" avant "projet" ou "pour"
  // ex: "dans backend projet x" → area = "backend"
  // ex: "dans le backend pour projet x" → area = "backend"
  // ex: "backend projet x" → area = "backend"
  const areaMatch = demande.match(/(?:dans\s+(?:le\s+)?|^)(backend|frontend|docs|infra|devops|test|design|general|api|auth|db|config|deploy|security)\s+(?:\w+\s+)?(?:projet|project)/i)
  if (areaMatch) {
    area = areaMatch[1].toLowerCase()
  }

  // Fallback titre : si pas de guillemets, prendre les mots après "tâche" jusqu'à "dans"/"projet"
  if (!title) {
    const taskMatch = demande.match(/t[âa]che\s+(.+?)(?:\s+dans\s+\S+|projet|project|$)/i)
    if (taskMatch) {
      title = taskMatch[1].trim().replace(/["']/g, '')
    }
  }

  // Dernier fallback : tout ce qui reste après le nom du projet
  if (!title) {
    const projet = getProjectName()
    if (projet) {
      const afterProject = demande.replace(new RegExp(projet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '').trim()
      if (afterProject) title = afterProject
    }
  }

  return { title, area }
}

// ── Affichage ──────────────────────────────────────

function showSuccess(projectName, title, area, taskId) {
  const lines = []

  lines.push('')
  lines.push(`${GREEN}${BOLD}═══════════════════════════════════════${R()}`)
  lines.push(`  ${GREEN}✅ Tâche ajoutée avec succès${R()}`)
  lines.push(`${GREEN}${BOLD}═══════════════════════════════════════${R()}`)
  lines.push('')
  lines.push(`  ${BOLD}Projet${R()}  : ${CYAN}${projectName}${R()}`)
  lines.push(`  ${BOLD}Tâche${R()}   : ${title}`)
  lines.push(`  ${BOLD}Domaine${R()} : ${area}`)
  lines.push(`  ${BOLD}ID${R()}      : ${GRAY}${taskId}${R()}`)
  lines.push('')
  lines.push(`  ${GRAY}Prochaines actions :${R()}`)
  lines.push(`    ${GRAY}• Voir : \"état du projet ${projectName}\"${R()}`)
  lines.push(`    ${GRAY}• Lancer : \"continuer le projet ${projectName}\"${R()}`)
  lines.push('')

  return lines.join('\n')
}

function showUsage(projects) {
  console.log('')
  console.log(`${YELLOW}⚠ Format attendu :${R()}`)
  console.log(`   "ajoute une tâche \"<titre>\" au projet <nom>"`)
  console.log(`   "ajoute tâche \"<titre>\" dans <domaine> projet <nom>"`)
  console.log('')
  console.log(`   ${GRAY}Exemples :${R()}`)
  console.log(`   ${GRAY}  ajoute une tâche \"Implémenter l'authentification\" au projet soulseek-downloader${R()}`)
  console.log(`   ${GRAY}  ajoute tâche \"Refactor le module API\" dans backend projet mon-app${R()}`)
  console.log(`   ${GRAY}  nouvelle tâche \"Tests unitaires\" dans test projet mon-app${R()}`)

  if (projects.length > 0) {
    console.log('')
    console.log(`   Projets disponibles : ${projects.join(', ')}`)
  }
  console.log('')
  process.exit(1)
}

// ── Main ────────────────────────────────────────────

function main() {
  const projectName = getProjectName()
  if (!projectName) {
    const projects = listProjects()
    if (projects.length === 1) {
      // Un seul projet → auto-sélection, parse la demande pour le titre
      const demande = process.env.SCRIPT_DEMANDE || ''
      if (!demande) {
        showUsage(projects)
        return
      }
      // Continue with this project
      const { title, area } = parseTaskInfo(demande)
      if (!title) {
        showUsage(projects)
        return
      }

      // Ajouter la tâche
      const board = readTaskBoard(projects[0])
      const taskId = `task-${Date.now().toString(36)}-${(board.tasks.length + 1)}`
      const task = {
        id: taskId,
        title,
        area,
        status: 'todo',
        createdAt: new Date().toISOString(),
      }
      board.tasks.push(task)
      writeTaskBoard(board, projects[0])

      if (isJson) {
        console.log(JSON.stringify({ project: projects[0], task }, null, 2))
      } else {
        console.log(showSuccess(projects[0], title, area, taskId))
      }
      process.exit(0)
    }

    console.log(`${YELLOW}⚠ Aucun projet spécifié.${R()}`)
    showUsage(projects)
    return
  }

  // Vérifier que le projet existe
  if (!existsSync(join(WORKSPACES_DIR, projectName))) {
    console.log(`${RED}❌ Projet \"${projectName}\" introuvable.${R()}`)
    const projects = listProjects()
    if (projects.length > 0) {
      console.log(`   Projets disponibles : ${projects.join(', ')}`)
    }
    process.exit(1)
  }

  const demande = process.env.SCRIPT_DEMANDE || ''
  const { title, area } = parseTaskInfo(demande)

  if (!title) {
    showUsage(listProjects())
    return
  }

  // Ajouter la tâche via le board directement (plus fiable que task-board-cli)
  const board = readTaskBoard(projectName)
  const taskId = `task-${Date.now().toString(36)}-${(board.tasks.length + 1)}`
  const task = {
    id: taskId,
    title,
    area,
    status: 'todo',
    createdAt: new Date().toISOString(),
  }
  board.tasks.push(task)
  writeTaskBoard(board, projectName)

  if (isJson) {
    console.log(JSON.stringify({ project: projectName, task }, null, 2))
  } else {
    console.log(showSuccess(projectName, title, area, taskId))
  }

  process.exit(0)
}

main()
