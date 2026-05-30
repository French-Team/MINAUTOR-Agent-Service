#!/usr/bin/env node
/**
 * scripts/projects/unblock-task.js — Débloquer une tâche avec cascade
 *
 * Remet le statut d'une tâche de 'blocked' à 'todo'.
 * Si d'autres tâches étaient bloquées parce qu'elles dépendent de celle-ci,
 * vérifie si toutes leurs dépendances sont résolues et les débloque aussi.
 *
 * Déclenché par "débloque la tâche <id>", "débloque la tâche en cours", etc.
 *
 * Variables d'environnement :
 *   SCRIPT_PARAM_TASK     — ID de la tâche
 *   SCRIPT_PARAM_PROJECT  — nom du projet
 *   SCRIPT_PROJECT        — nom du projet (payload intercom)
 *   SCRIPT_DEMANDE        — demande utilisateur brute
 *
 * Usage:
 *   node scripts/projects/unblock-task.js
 *   node scripts/projects/unblock-task.js --json
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

// ── Cascade déblocage ──────────────────────────────

function cascadeUnblock(board, taskId, visited = new Set()) {
  if (visited.has(taskId)) return []
  visited.add(taskId)

  const affected = []
  // Trouver les tâches bloquées qui dépendent de taskId
  for (const t of board.tasks) {
    if (t.status === 'blocked' && t.dependsOn && t.dependsOn.includes(taskId)) {
      // Vérifier si TOUTES les dépendances sont résolues (done ou todo)
      const allDepsResolved = t.dependsOn.every(depId => {
        if (depId === taskId) return true // celle-ci est débloquée
        const dep = board.tasks.find(d => d.id === depId)
        return dep && (dep.status === 'done' || dep.status === 'todo')
      })
      if (allDepsResolved) {
        t.status = 'todo'
        affected.push(t)
        // Cascade
        const subAffected = cascadeUnblock(board, t.id, visited)
        affected.push(...subAffected)
      }
    }
  }
  return affected
}

// ── Affichage ──────────────────────────────────────

function showUnblocked(projectName, task, cascaded) {
  const lines = []
  lines.push('')
  lines.push(`${GREEN}${BOLD}═══════════════════════════════════════${R()}`)
  lines.push(`  ${GREEN}✅ Tâche débloquée${R()}`)
  lines.push(`${GREEN}${BOLD}═══════════════════════════════════════${R()}`)
  lines.push('')
  lines.push(`  ${BOLD}Projet${R()}  : ${CYAN}${projectName}${R()}`)
  lines.push(`  ${BOLD}Tâche${R()}   : ${task.title}`)
  lines.push(`  ${BOLD}ID${R()}      : ${GRAY}${task.id}${R()} ${GRAY}[${task.area}]${R()}`)
  const statusLabel = task.status === 'in_progress' ? '🔄 En cours' : '⬜ À faire'
  lines.push(`  ${BOLD}Nouveau${R()} : ${GREEN}${statusLabel}${R()}`)
  lines.push('')

  if (cascaded.length > 0) {
    lines.push(`  ${GREEN}${BOLD}✓ Cascade : ${cascaded.length} tâche(s) dépendante(s) aussi débloquée(s)${R()}`)
    for (const ct of cascaded) {
      const area = ct.area ? ` [${ct.area}]` : ''
      lines.push(`    ${GRAY}• ${ct.id} — ${ct.title}${area}${R()}`)
    }
    lines.push('')
  }

  lines.push(`  ${GRAY}Pour continuer : \"continuer ${projectName}\"${R()}`)
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

function showNotBlocked(task, projectName) {
  const lines = []
  lines.push('')
  lines.push(`${YELLOW}⚠ La tâche n'est pas bloquée.${R()}`)
  lines.push(`  ${BOLD}Tâche${R()} : ${task.title} ${GRAY}[${task.id} — ${task.status}]${R()}`)
  lines.push(`  ${BOLD}Projet${R()} : ${CYAN}${projectName}${R()}`)
  lines.push(`  ${GRAY}Seules les tâches avec le statut 'bloquée' peuvent être débloquées.${R()}`)
  lines.push('')
  return lines.join('\n')
}

// ── Main ────────────────────────────────────────────

function findAndUnblock(projectName) {
  const board = readTaskBoard(projectName)
  const taskId = getTaskId()
  const useActive = isActiveTaskRequest()

  let task = null
  if (taskId) {
    task = board.tasks.find(t => t.id === taskId)
  } else if (useActive) {
    task = board.tasks.find(t => t.status === 'in_progress')
  } else {
    task = board.tasks.find(t => t.status === 'in_progress')
  }

  if (!task) {
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
        console.log(JSON.stringify({ error: 'Aucune tâche à débloquer', project: projectName }, null, 2))
      } else {
        console.log(showNoActiveTask(projectName))
      }
    }
    process.exit(0)
  }

  if (task.status !== 'blocked') {
    if (isJson) {
      console.log(JSON.stringify({ error: 'Tâche non bloquée', task, project: projectName }, null, 2))
    } else {
      console.log(showNotBlocked(task, projectName))
    }
    process.exit(0)
  }

  // Restaurer le statut précédent si disponible, sinon 'todo'
  task.status = task.previousStatus || 'todo'
  delete task.previousStatus

  // Cascade sur les tâches dépendantes
  const cascaded = cascadeUnblock(board, task.id)

  writeTaskBoard(board, projectName)

  if (isJson) {
    console.log(JSON.stringify({
      project: projectName,
      task,
      cascadedTasks: cascaded.map(t => ({ id: t.id, title: t.title, area: t.area })),
    }, null, 2))
  } else {
    console.log(showUnblocked(projectName, task, cascaded))
  }

  process.exit(0)
}

function main() {
  const projectName = getProjectName()

  if (!projectName) {
    const projects = listProjects()
    if (projects.length === 1) {
      return findAndUnblock(projects[0])
    }

    if (isJson) {
      console.log(JSON.stringify({ projects: listProjects() }, null, 2))
    } else {
      console.log(`${YELLOW}⚠ Aucun projet spécifié.${R()}`)
      console.log('   Dis par exemple : "débloque la tâche task-abc au projet mon-projet"')
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

  findAndUnblock(projectName)
}

main()
