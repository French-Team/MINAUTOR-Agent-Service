#!/usr/bin/env node
/**
 * scripts/projects/done-task.js — Marquer une tâche comme terminée
 *
 * Met à jour le statut d'une tâche dans .tasks.json à "done".
 * La tâche peut être identifiée par son ID ou automatiquement
 * via la tâche en cours (active).
 *
 * Déclenché par "marque la tâche <id> comme terminée",
 * "termine la tâche en cours", "tâche <id> terminée"
 *
 * Variables d'environnement :
 *   SCRIPT_PARAM_TASK     — ID de la tâche (depuis le pattern registry)
 *   SCRIPT_PARAM_PROJECT  — nom du projet (depuis le pattern registry)
 *   SCRIPT_PROJECT        — nom du projet (depuis le payload intercom)
 *   SCRIPT_DEMANDE        — demande utilisateur brute
 *
 * Usage:
 *   node scripts/projects/done-task.js
 *   node scripts/projects/done-task.js --json
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
      if (m) info[m[1]] = m[2].replace(/^['\"]|['\"]$/g, '').trim()
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

// ── Extraction de l'ID de tâche ────────────────────

function getTaskId() {
  // Priorité 1 : paramètre explicite du pattern
  const fromEnv = process.env.SCRIPT_PARAM_TASK
  if (fromEnv) return fromEnv

  // Priorité 2 : extraction depuis la demande
  const demande = (process.env.SCRIPT_DEMANDE || '').toLowerCase()
  
  // Chercher un ID de tâche (task-xxx, t-xxx)
  // Utilise une negative lookbehind pour éviter de matcher
  // à l'intérieur d'un nom de projet (ex: "done-task-v2" contient "task-v2")
  const taskIdMatch = demande.match(/(?:t[âa]che\s+)?(?<![a-z0-9-])(task-[a-z0-9-]+|t-[a-z0-9-]+)/)
  if (taskIdMatch) {
    const id = taskIdMatch[1]
    // S'assurer que ce n'est pas un mot-clé comme "en cours"
    if (id !== 'en cours' && id !== 'active') return id
  }

  return null
}

// ── Vérifier si la demande concerne la tâche en cours ─

function isActiveTaskRequest() {
  const demande = (process.env.SCRIPT_DEMANDE || '').toLowerCase()
  return /en\s+cours|active/.test(demande) && /t[âa]che/.test(demande)
}

// ── Affichage ──────────────────────────────────────

function showSuccess(projectName, task, nextTask) {
  const lines = []

  lines.push('')
  lines.push(`${GREEN}${BOLD}═══════════════════════════════════════${R()}`)
  lines.push(`  ${GREEN}✅ Tâche terminée${R()}`)
  lines.push(`${GREEN}${BOLD}═══════════════════════════════════════${R()}`)
  lines.push('')
  lines.push(`  ${BOLD}Projet${R()} : ${CYAN}${projectName}${R()}`)
  lines.push(`  ${BOLD}Tâche${R()}  : ${task.title}`)
  const area = task.area ? ` ${GRAY}[${task.area}]${R()}` : ''
  lines.push(`  ${BOLD}ID${R()}     : ${GRAY}${task.id}${R()}${area}`)
  lines.push('')

  if (nextTask) {
    const nextArea = nextTask.area ? ` ${GRAY}[${nextTask.area}]${R()}` : ''
    lines.push(`  ${CYAN}${BOLD}⟳ Prochaine tâche${R()}`)
    lines.push(`    ${BOLD}${nextTask.title}${R()}${nextArea}`)
    lines.push(`    ${GRAY}ID: ${nextTask.id}${R()}`)
    if (nextTask.description) {
      lines.push(`    ${nextTask.description}`)
    }
    lines.push('')
    lines.push(`  ${GREEN}Continue avec : "continuer ${projectName}"${R()}`)
  } else {
    lines.push(`  ${YELLOW}Plus aucune tâche à faire dans ce projet.${R()}`)
    lines.push(`  ${GRAY}Ajoute-en une avec : "ajoute une tâche au projet ${projectName}"${R()}`)
  }

  lines.push('')
  return lines.join('\n')
}

function showNoActiveTask(projectName) {
  const lines = []
  lines.push('')
  lines.push(`${YELLOW}⚠ Aucune tâche en cours.${R()}`)
  lines.push(`   Voir les tâches disponibles : "continuer ${projectName}"`)
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
  lines.push(`  ${GRAY}Vérifie les tâches avec : "état du projet ${projectName}"${R()}`)
  lines.push('')
  return lines.join('\n')
}

// ── Main ────────────────────────────────────────────

function main() {
  const projectName = getProjectName()

  if (!projectName) {
    const projects = listProjects()
    if (projects.length === 1) {
      // Auto-sélection si un seul projet
      const board = readTaskBoard(projects[0])
      const taskId = getTaskId()
      const useActive = isActiveTaskRequest()

      let task = null
      if (taskId) {
        task = board.tasks.find(t => t.id === taskId)
      } else if (useActive) {
        task = board.tasks.find(t => t.status === 'in_progress')
      } else {
        // Par défaut : marquer la tâche active
        task = board.tasks.find(t => t.status === 'in_progress')
        if (!task) {
          if (isJson) {
            console.log(JSON.stringify({ error: 'Aucune tâche en cours', project: projects[0] }, null, 2))
          } else {
            console.log(showNoActiveTask(projects[0]))
          }
          process.exit(0)
        }
      }

      if (!task) {
        if (isJson) {
          console.log(JSON.stringify({ error: `Tâche ${taskId || '(active)'} introuvable`, project: projects[0] }, null, 2))
        } else {
          console.log(showTaskNotFound(taskId || '(active)', projects[0]))
        }
        process.exit(0)
      }

      // Marquer comme terminée
      task.status = 'done'
      task.completedAt = new Date().toISOString()
      writeTaskBoard(board, projects[0])

      // Trouver la prochaine tâche à faire
      const nextTask = board.tasks.find(t => t.status === 'todo' || !t.status)

      if (isJson) {
        console.log(JSON.stringify({
          project: projects[0],
          task,
          nextTask: nextTask || null,
        }, null, 2))
      } else {
        console.log(showSuccess(projects[0], task, nextTask || null))
      }
      process.exit(0)
    }

    if (isJson) {
      console.log(JSON.stringify({ projects: listProjects() }, null, 2))
    } else {
      console.log(`${YELLOW}⚠ Aucun projet spécifié.${R()}`)
      console.log('   Dis par exemple : "marque la tâche comme terminée projet mon-projet"')
      if (projects.length > 0) {
        console.log(`\n   Projets disponibles : ${projects.join(', ')}`)
      }
    }
    process.exit(0)
  }

  // Vérifier que le projet existe
  if (!existsSync(join(WORKSPACES_DIR, projectName))) {
    console.log(`${RED}❌ Projet "${projectName}" introuvable.${R()}`)
    const projects = listProjects()
    if (projects.length > 0) {
      console.log(`   Projets disponibles : ${projects.join(', ')}`)
    }
    process.exit(1)
  }

  const board = readTaskBoard(projectName)
  const taskId = getTaskId()
  const useActive = isActiveTaskRequest()

  let task = null
  if (taskId) {
    task = board.tasks.find(t => t.id === taskId)
  } else if (useActive) {
    task = board.tasks.find(t => t.status === 'in_progress')
    if (!task) {
      if (isJson) {
        console.log(JSON.stringify({ error: 'Aucune tâche en cours', project: projectName }, null, 2))
      } else {
        console.log(showNoActiveTask(projectName))
      }
      process.exit(0)
    }
  } else {
    // Par défaut : marquer la tâche active
    task = board.tasks.find(t => t.status === 'in_progress')
    if (!task) {
      if (isJson) {
        console.log(JSON.stringify({ error: 'Aucune tâche en cours', project: projectName }, null, 2))
      } else {
        console.log(showNoActiveTask(projectName))
      }
      process.exit(0)
    }
  }

  if (!task) {
    if (isJson) {
      console.log(JSON.stringify({ error: `Tâche ${taskId || '(active)'} introuvable`, project: projectName }, null, 2))
    } else {
      console.log(showTaskNotFound(taskId || '(active)', projectName))
    }
    process.exit(0)
  }

  // Marquer comme terminée
  task.status = 'done'
  task.completedAt = new Date().toISOString()
  writeTaskBoard(board, projectName)

  // Trouver la prochaine tâche à faire
  const nextTask = board.tasks.find(t => t.status === 'todo' || !t.status)

  if (isJson) {
    console.log(JSON.stringify({
      project: projectName,
      task,
      nextTask: nextTask || null,
    }, null, 2))
  } else {
    console.log(showSuccess(projectName, task, nextTask || null))
  }

  process.exit(0)
}

main()
