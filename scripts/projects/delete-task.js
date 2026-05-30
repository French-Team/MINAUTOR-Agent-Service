#!/usr/bin/env node
/**
 * scripts/projects/delete-task.js — Supprimer une tâche du board
 *
 * FLUX EN 2 ÉTAPES (confirmation explicite) :
 *   1. Appel initial : "supprime la tâche task-xxx" → affiche les détails de la tâche
 *      et demande confirmation. La tâche N'EST PAS supprimée.
 *   2. Confirmation : "confirme la suppression de la tâche task-xxx" → supprime
 *      effectivement la tâche du board.
 *
 * La tâche peut être identifiée par son ID ou automatiquement via la tâche en cours (active).
 *
 * Déclenché par "supprime la tâche <id>", "confirme la suppression de la tâche <id>", etc.
 *
 * Variables d'environnement :
 *   SCRIPT_PARAM_TASK     — ID de la tâche (depuis le pattern registry)
 *   SCRIPT_PARAM_PROJECT  — nom du projet (depuis le pattern registry)
 *   SCRIPT_PROJECT        — nom du projet (depuis le payload intercom)
 *   SCRIPT_DEMANDE        — demande utilisateur brute
 *
 * Usage:
 *   node scripts/projects/delete-task.js
 *   node scripts/projects/delete-task.js --json
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

// ── Détection de confirmation ──────────────────────
// Si la demande commence par "confirme" ou "oui", c'est une confirmation.
function isConfirmation() {
  const demande = (process.env.SCRIPT_DEMANDE || '').toLowerCase().trim()
  // Supporte : 'confirme...', 'oui...', 'oui, confirme...', 'valide...'
  return /^(?:confirme|oui|valide)[\s,;:]/.test(demande + ' ')
}

// ── Extraction du nom de projet ────────────────────

function getProjectName() {
  let name = process.env.SCRIPT_PARAM_PROJECT
  if (!name) name = process.env.SCRIPT_PROJECT
  if (!name) {
    const demande = (process.env.SCRIPT_DEMANDE || '').toLowerCase()
    const match = demande.match(/(?:projet|project|du)\s+["']?([a-z0-9][a-z0-9_-]*)/)
    if (match) name = match[1]
  }
  return name || null
}

// ── Extraction de l'ID de tâche ────────────────────

function getTaskId() {
  const fromEnv = process.env.SCRIPT_PARAM_TASK
  if (fromEnv) return fromEnv

  const demande = (process.env.SCRIPT_DEMANDE || '').toLowerCase()

  // Negative lookbehind pour éviter de matcher à l'intérieur d'un nom de projet
  const taskIdMatch = demande.match(/(?:t[âa]che\s+)?(?<![a-z0-9-])(task-[a-z0-9-]+|t-[a-z0-9-]+)/)
  if (taskIdMatch) {
    const id = taskIdMatch[1]
    if (id !== 'en cours' && id !== 'active') return id
  }

  return null
}

// ── Vérifier si la demande concerne la tâche en cours ─

function isActiveTaskRequest() {
  const demande = (process.env.SCRIPT_DEMANDE || '').toLowerCase()
  return /en\s+cours|active/.test(demande) && /t[âa]che/.test(demande)
}

// ── Affichage : PENDING (confirmation demandée) ────

function showPendingDeletion(projectName, task) {
  const lines = []
  lines.push('')
  lines.push(`${YELLOW}${BOLD}═══════════════════════════════════════${R()}`)
  lines.push(`  ${YELLOW}⚠ Confirmation requise${R()}`)
  lines.push(`${YELLOW}${BOLD}═══════════════════════════════════════${R()}`)
  lines.push('')
  lines.push(`  ${BOLD}Projet${R()} : ${CYAN}${projectName}${R()}`)
  lines.push(`  ${BOLD}Tâche${R()}  : ${task.title}`)
  lines.push(`  ${BOLD}ID${R()}     : ${GRAY}${task.id}${R()}`)
  lines.push(`  ${BOLD}Statut${R()} : ${task.status === 'done' ? GREEN + '✓ Terminée' : task.status === 'in_progress' ? YELLOW + '⟳ En cours' : '⬜ À faire'}${R()}`)
  if (task.area) {
    lines.push(`  ${BOLD}Domaine${R()}: ${CYAN}${task.area}${R()}`)
  }
  lines.push('')
  lines.push(`  ${YELLOW}Cette action est irréversible.${R()}`)
  lines.push('')
  lines.push(`  ${BOLD}Pour confirmer, dis :${R()}`)
  lines.push(`  ${GRAY}  confirme la suppression de la tâche ${task.id} au projet ${projectName}${R()}`)
  lines.push('')
  return lines.join('\n')
}

// ── Affichage : DELETED (confirmation effectuée) ────

function showDeleted(projectName, task) {
  const lines = []
  lines.push('')
  lines.push(`${RED}${BOLD}═══════════════════════════════════════${R()}`)
  lines.push(`  ${RED}🗑 Tâche supprimée${R()}`)
  lines.push(`${RED}${BOLD}═══════════════════════════════════════${R()}`)
  lines.push('')
  lines.push(`  ${BOLD}Projet${R()} : ${CYAN}${projectName}${R()}`)
  lines.push(`  ${BOLD}Tâche${R()}  : ${task.title}`)
  lines.push(`  ${BOLD}ID${R()}     : ${GRAY}${task.id}${R()}`)
  lines.push(`  ${BOLD}Statut${R()} : ${task.status === 'done' ? GREEN + '✓ Terminée' : task.status === 'in_progress' ? YELLOW + '⟳ En cours' : '⬜ À faire'}${R()}`)
  if (task.area) {
    lines.push(`  ${BOLD}Domaine${R()}: ${CYAN}${task.area}${R()}`)
  }
  lines.push('')
  lines.push(`  ${GRAY}Cette tâche a été retirée du board.${R()}`)
  lines.push(`  ${GRAY}Prochaine action : "état du projet ${projectName}"${R()}`)
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

// ── Fonction centrale : trouver et (optionnellement) supprimer ──

function findAndDelete(projectName, confirm) {
  const board = readTaskBoard(projectName)
  const taskId = getTaskId()
  const useActive = isActiveTaskRequest()

  let task = null
  if (taskId) {
    task = board.tasks.find(t => t.id === taskId)
    if (!task) {
      if (isJson) {
        console.log(JSON.stringify({ error: `Tâche ${taskId} introuvable`, project: projectName }, null, 2))
      } else {
        console.log(showTaskNotFound(taskId, projectName))
      }
      process.exit(0)
    }
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
    // Fallback : pas d'ID, pas de "en cours" → tâche active par défaut
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

  if (confirm) {
    // ÉTAPE 2 : Confirmation donnée → supprimer la tâche
    board.tasks = board.tasks.filter(t => t.id !== task.id)
    writeTaskBoard(board, projectName)

    if (isJson) {
      console.log(JSON.stringify({
        project: projectName,
        deletedTask: task,
        remaining: board.tasks.length,
      }, null, 2))
    } else {
      console.log(showDeleted(projectName, task))
    }
  } else {
    // ÉTAPE 1 : Première demande → afficher les détails et demander confirmation
    if (isJson) {
      console.log(JSON.stringify({
        confirmation: true,
        project: projectName,
        task: task,
        message: `Pour confirmer, dis "confirme la suppression de la tâche ${task.id} au projet ${projectName}"`,
      }, null, 2))
    } else {
      console.log(showPendingDeletion(projectName, task))
    }
  }

  process.exit(0)
}

// ── Main ────────────────────────────────────────────

function main() {
  const projectName = getProjectName()
  const confirm = isConfirmation()

  // ── Pas de projet → auto-sélection ou erreur ──────
  if (!projectName) {
    const projects = listProjects()
    if (projects.length === 1) {
      return findAndDelete(projects[0], confirm)
    }

    if (isJson) {
      console.log(JSON.stringify({ projects: listProjects() }, null, 2))
    } else {
      console.log(`${YELLOW}⚠ Aucun projet spécifié.${R()}`)
      console.log('   Dis par exemple : "supprime la tâche task-abc au projet mon-projet"')
      if (projects.length > 0) {
        console.log(`\n   Projets disponibles : ${projects.join(', ')}`)
      }
    }
    process.exit(0)
  }

  // ── Projet spécifié ───────────────────────────────
  if (!existsSync(join(WORKSPACES_DIR, projectName))) {
    console.log(`${RED}❌ Projet "${projectName}" introuvable.${R()}`)
    const projects = listProjects()
    if (projects.length > 0) {
      console.log(`   Projets disponibles : ${projects.join(', ')}`)
    }
    process.exit(1)
  }

  findAndDelete(projectName, confirm)
}

main()
