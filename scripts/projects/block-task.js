#!/usr/bin/env node
/**
 * scripts/projects/block-task.js — Bloquer une tâche avec cascade
 *
 * Met le statut d'une tâche à 'blocked'. Si d'autres tâches dépendent
 * de celle-ci (dependsOn), elles sont aussi mises à 'blocked' (cascade).
 *
 * Déclenché par "bloque la tâche <id>", "bloque la tâche en cours", etc.
 * Raison optionnelle : "bloque la tâche task-xxx: API externe KO"
 *
 * Variables d'environnement :
 *   SCRIPT_PARAM_TASK     — ID de la tâche
 *   SCRIPT_PARAM_PROJECT  — nom du projet
 *   SCRIPT_PROJECT        — nom du projet (payload intercom)
 *   SCRIPT_DEMANDE        — demande utilisateur brute
 *
 * Usage:
 *   node scripts/projects/block-task.js
 *   node scripts/projects/block-task.js --json
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

// ── Extraction de l'ID de tâche ────────────────────

function getTaskId() {
  const fromEnv = process.env.SCRIPT_PARAM_TASK
  if (fromEnv) return fromEnv
  const demande = (process.env.SCRIPT_DEMANDE || '').toLowerCase()
  const match = demande.match(/(?:t[âa]che\s+)?(?<![a-z0-9-])(task-[a-z0-9-]+|t-[a-z0-9-]+)/)
  if (match) {
    const id = match[1]
    if (id !== 'en cours' && id !== 'active') return id
  }
  return null
}

function isActiveTaskRequest() {
  const demande = (process.env.SCRIPT_DEMANDE || '').toLowerCase()
  return /en\s+cours|active/.test(demande) && /t[âa]che/.test(demande)
}

// ── Extraction de la raison (après ':', 'car', 'parce que') ──

function extractReason() {
  const demande = (process.env.SCRIPT_DEMANDE || '')
  const match = demande.match(/[:\-–—]+(.+)$/)
  if (match) return match[1].trim()
  const carMatch = demande.match(/\b(car|parce\s+que)\s+(.+)$/i)
  if (carMatch) return carMatch[2].trim()
  return null
}

// ── Propagation en cascade ─────────────────────────

function cascadeBlock(board, taskId, visited = new Set()) {
  if (visited.has(taskId)) return []
  visited.add(taskId)

  const affected = []
  // Trouver toutes les tâches qui dépendent de taskId
  for (const t of board.tasks) {
    if (t.dependsOn && t.dependsOn.includes(taskId)) {
      if (t.status !== 'blocked' && t.status !== 'done') {
        t.status = 'blocked'
        affected.push(t)
        // Cascade récursive
        const subAffected = cascadeBlock(board, t.id, visited)
        affected.push(...subAffected)
      }
    }
  }
  return affected
}

// ── Affichage ──────────────────────────────────────

function showBlocked(projectName, task, reason, cascaded) {
  const lines = []
  lines.push('')
  lines.push(`${RED}${BOLD}═══════════════════════════════════════${R()}`)
  lines.push(`  ${RED}🚫 Tâche bloquée${R()}`)
  lines.push(`${RED}${BOLD}═══════════════════════════════════════${R()}`)
  lines.push('')
  lines.push(`  ${BOLD}Projet${R()}  : ${CYAN}${projectName}${R()}`)
  lines.push(`  ${BOLD}Tâche${R()}   : ${task.title}`)
  lines.push(`  ${BOLD}ID${R()}      : ${GRAY}${task.id}${R()} ${GRAY}[${task.area}]${R()}`)
  if (reason) {
    lines.push(`  ${BOLD}Raison${R()}   : ${YELLOW}${reason}${R()}`)
  }
  lines.push(`  ${BOLD}Ancien${R()}  : ${task.status === 'in_progress' ? '⟳ En cours' : '⬜ À faire'}`)
  lines.push(`  ${BOLD}Nouveau${R()} : ${RED}🚫 Bloquée${R()}`)
  lines.push('')

  if (cascaded.length > 0) {
    lines.push(`  ${YELLOW}${BOLD}⚠ Cascade : ${cascaded.length} tâche(s) dépendante(s) aussi bloquée(s)${R()}`)
    for (const ct of cascaded) {
      const area = ct.area ? ` [${ct.area}]` : ''
      lines.push(`    ${GRAY}• ${ct.id} — ${ct.title}${area}${R()}`)
    }
    lines.push('')
  }

  lines.push(`  ${GRAY}Pour débloquer : \"débloque la tâche ${task.id} au projet ${projectName}\"${R()}`)
  lines.push('')
  return lines.join('\n')
}

function showNoActiveTask(projectName) {
  const lines = []
  lines.push('')
  lines.push(`${YELLOW}⚠ Aucune tâche en cours.${R()}`)
  lines.push(`   Voir les tâches disponibles : \"continuer ${projectName}\"`)
  lines.push('')
  return lines.join('\n')
}

function showTaskNotFound(taskId, projectName) {
  const lines = []
  lines.push('')
  lines.push(`${RED}${BOLD}═══════════════════════════════════════${R()}`)
  lines.push(`  ${RED}❌ Tâche introuvable${R()}`)
  lines.push(`${RED}${BOLD}═══════════════════════════════════════${R()}`)
  lines.push('')
  lines.push(`  ${BOLD}Tâche${R()}   : ${taskId}`)
  lines.push(`  ${BOLD}Projet${R()} : ${CYAN}${projectName}${R()}`)
  lines.push('')
  lines.push(`  ${GRAY}Vérifie les tâches avec : \"état du projet ${projectName}\"${R()}`)
  lines.push('')
  return lines.join('\n')
}

function showAlreadyBlocked(task, projectName) {
  const lines = []
  lines.push('')
  lines.push(`${YELLOW}⚠ Tâche déjà bloquée.${R()}`)
  lines.push(`  ${BOLD}Tâche${R()} : ${task.title} ${GRAY}[${task.id}]${R()}`)
  lines.push(`  ${BOLD}Projet${R()} : ${CYAN}${projectName}${R()}`)
  lines.push('')
  return lines.join('\n')
}

// ── Main ────────────────────────────────────────────

function findAndBlock(projectName) {
  const board = readTaskBoard(projectName)
  const taskId = getTaskId()
  const useActive = isActiveTaskRequest()
  const reason = extractReason()

  let task = null
  if (taskId) {
    task = board.tasks.find(t => t.id === taskId)
  } else if (useActive) {
    task = board.tasks.find(t => t.status === 'in_progress')
  } else {
    task = board.tasks.find(t => t.status === 'in_progress')
  }

  if (!task) {
    const label = taskId || '(active)'
    if (useActive || (!taskId && board.tasks.some(t => t.status === 'in_progress'))) {
      if (isJson) {
        console.log(JSON.stringify({ error: 'Aucune tâche en cours', project: projectName }, null, 2))
      } else {
        console.log(showNoActiveTask(projectName))
      }
    } else if (taskId) {
      if (isJson) {
        console.log(JSON.stringify({ error: `Tâche ${taskId} introuvable`, project: projectName }, null, 2))
      } else {
        console.log(showTaskNotFound(taskId, projectName))
      }
    } else {
      if (isJson) {
        console.log(JSON.stringify({ error: 'Aucune tâche à bloquer', project: projectName }, null, 2))
      } else {
        console.log(showNoActiveTask(projectName))
      }
    }
    process.exit(0)
  }

  if (task.status === 'blocked') {
    if (isJson) {
      console.log(JSON.stringify({ error: 'Tâche déjà bloquée', task, project: projectName }, null, 2))
    } else {
      console.log(showAlreadyBlocked(task, projectName))
    }
    process.exit(0)
  }

  // Sauvegarder l'ancien statut pour restauration au déblocage
  const oldStatus = task.status
  task.previousStatus = oldStatus
  task.status = 'blocked'

  // Cascade sur les tâches dépendantes
  const cascaded = cascadeBlock(board, task.id)

  writeTaskBoard(board, projectName)

  if (isJson) {
    console.log(JSON.stringify({
      project: projectName,
      task,
      reason: reason || null,
      previousStatus: oldStatus,
      cascadedTasks: cascaded.map(t => ({ id: t.id, title: t.title, area: t.area })),
    }, null, 2))
  } else {
    console.log(showBlocked(projectName, task, reason, cascaded))
  }

  process.exit(0)
}

function main() {
  const projectName = getProjectName()

  if (!projectName) {
    const projects = listProjects()
    if (projects.length === 1) {
      return findAndBlock(projects[0])
    }

    if (isJson) {
      console.log(JSON.stringify({ projects: listProjects() }, null, 2))
    } else {
      console.log(`${YELLOW}⚠ Aucun projet spécifié.${R()}`)
      console.log('   Dis par exemple : "bloque la tâche task-abc au projet mon-projet"')
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

  findAndBlock(projectName)
}

main()
