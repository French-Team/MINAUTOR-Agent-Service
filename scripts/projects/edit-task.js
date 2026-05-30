#!/usr/bin/env node
/**
 * scripts/projects/edit-task.js — Modifier une tâche existante
 *
 * Permet de modifier le titre, la description ou le domaine d'une tâche.
 * La tâche peut être identifiée par son ID ou via la tâche en cours (active).
 *
 * Opérations supportées (détectées automatiquement depuis la demande) :
 *   - Renommer : "renomme la tâche <id> en 'Nouveau titre'"
 *   - Déplacer : "déplace la tâche <id> dans <domaine>"
 *   - Description : "change la description de la tâche <id> en '...'"
 *
 * Variables d'environnement :
 *   SCRIPT_PARAM_TASK     — ID de la tâche (depuis le pattern registry)
 *   SCRIPT_PARAM_PROJECT  — nom du projet (depuis le pattern registry)
 *   SCRIPT_PROJECT        — nom du projet (depuis le payload intercom)
 *   SCRIPT_DEMANDE        — demande utilisateur brute
 *   SCRIPT_PARAM_AREA     — nouveau domaine (depuis le pattern registry)
 *
 * Usage:
 *   node scripts/projects/edit-task.js
 *   node scripts/projects/edit-task.js --json
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

// ── Parsing de l'opération et de la nouvelle valeur ─

function parseEditOperation(demande) {
  const lower = demande.toLowerCase()

  // 1. Renommer : "renomme la tâche <id> en 'Nouveau titre'"
  //            ou "renomme la tâche en cours en 'Nouveau titre'"
  const renameMatch = lower.match(/renomme\s+(?:la\s+)?t[âa]che\s+(?:en cours\s+|task-[^\s]+\s+)?en\s+"([^"]+)"/)
  if (renameMatch) {
    return {
      type: 'title',
      label: 'Renommage',
      oldValue: '',
      newValue: renameMatch[1].trim(),
    }
  }

  // 2. Déplacer : "déplace la tâche <id> dans <domaine>"
  //            ou "déplace la tâche en cours dans <domaine>"
  const moveMatch = lower.match(/(?:déplace|déplacer|deplace|deplacer|mets?\s+dans)\s+(?:la\s+)?t[âa]che\s+(?:en cours\s+|task-[^\s]+\s+)?(?:vers\s+|dans\s+(?:le\s+)?)?(backend|frontend|docs|infra|devops|test|design|general|api|auth|db|config|deploy|security)/)
  if (moveMatch) {
    const newArea = moveMatch[1].toLowerCase()
    const areaLabel = 'backend|frontend|docs|infra|devops|test|design|general|api|auth|db|config|deploy|security'
      .split('|')
      .find(a => a === newArea) || newArea
    return {
      type: 'area',
      label: 'Domaine',
      oldValue: '',
      newValue: areaLabel,
    }
  }

  // 3. Description : "change la description de la tâche <id> en '...'"
  //               ou "modifie la description de la tâche <id> en '...'"
  const descMatch = lower.match(/(?:change|modifie|édite|edite|mets?\s+à\s+jour)\s+(?:la\s+)?description\s+(?:de\s+)?(?:la\s+)?t[âa]che\s+(?:en cours\s+|task-[^\s]+\s+)?en\s+"([^"]+)"/)
  if (descMatch) {
    return {
      type: 'description',
      label: 'Description',
      oldValue: '',
      newValue: descMatch[1].trim(),
    }
  }

  // 4. Format générique : "édite la tâche <id>: titre='Nouveau nom', domaine=backend"
  //                     ou "modifie la tâche <id>: description='texte'"
  const editMatch = lower.match(/(?:modifie|édite|edite|update)\s+(?:la\s+)?t[âa]che\s+(?:task-[^\s]+\s+|en cours\s+)?[:\s]+(.+)/)
  if (editMatch) {
    const rest = editMatch[1]
    // Chercher titre='...' ou titre="..."
    const titleMatch = rest.match(/titre\s*=\s*['"]([^'"]+)['"]/)
    if (titleMatch) {
      return { type: 'title', label: 'Renommage', oldValue: '', newValue: titleMatch[1].trim() }
    }
    // Chercher domaine=... ou area=...
    const areaMatch = rest.match(/(?:domaine|area)\s*=\s*['"]?(\w+)['"]?/)
    if (areaMatch) {
      return { type: 'area', label: 'Domaine', oldValue: '', newValue: areaMatch[1].toLowerCase() }
    }
    // Chercher description='...' ou description="..."
    const descEditMatch = rest.match(/(?:description|desc)\s*=\s*['"]([^'"]+)['"]/)
    if (descEditMatch) {
      return { type: 'description', label: 'Description', oldValue: '', newValue: descEditMatch[1].trim() }
    }
  }

  // 5. Fallback : dépôt direct "renommer en 'Nouveau titre'"
  const fallbackTitle = lower.match(/renommer?\s+en\s+"([^"]+)"/)
  if (fallbackTitle) {
    return { type: 'title', label: 'Renommage', oldValue: '', newValue: fallbackTitle[1].trim() }
  }

  // 6. Fallback : "déplacer dans <domaine>"
  const fallbackArea = lower.match(/(?:déplacer|deplacer)\s+(?:vers\s+|dans\s+(?:le\s+)?)?(backend|frontend|docs|infra|devops|test|design|general|api|auth|db|config|deploy|security)/)
  if (fallbackArea) {
    return { type: 'area', label: 'Domaine', oldValue: '', newValue: fallbackArea[1].toLowerCase() }
  }

  return null
}

// ── Domaine extrait du pattern move (SCRIPT_PARAM_AREA) ─

function getAreaFromParam() {
  return process.env.SCRIPT_PARAM_AREA || null
}

// ── Affichage ──────────────────────────────────────

function showSuccess(projectName, task, operation) {
  const lines = []

  lines.push('')
  lines.push(`${GREEN}${BOLD}═══════════════════════════════════════${R()}`)
  lines.push(`  ${GREEN}✅ Tâche modifiée${R()}`)
  lines.push(`${GREEN}${BOLD}═══════════════════════════════════════${R()}`)
  lines.push('')
  lines.push(`  ${BOLD}Projet${R()} : ${CYAN}${projectName}${R()}`)
  lines.push(`  ${BOLD}Tâche${R()}  : ${task.title}`)
  lines.push(`  ${BOLD}ID${R()}     : ${GRAY}${task.id}${R()}`)
  lines.push('')
  lines.push(`  ${BOLD}Opération${R()} : ${operation.label}`)
  lines.push(`  ${BOLD}Nouvelle valeur${R()} : ${GREEN}${operation.newValue}${R()}`)
  lines.push('')
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

function showParseError() {
  const lines = []
  lines.push('')
  lines.push(`${YELLOW}⚠ Action non reconnue.${R()}`)
  lines.push(`   Formats supportés :`)
  lines.push(`     "renomme la tâche <id> en 'Nouveau titre' au projet X"`)
  lines.push(`     "déplace la tâche <id> dans <domaine> au projet X"`)
  lines.push(`     "change la description de la tâche <id> en '...' au projet X"`)
  lines.push(`     "modifie la tâche <id>: titre='Nouveau', domaine=backend"`)
  lines.push('')
  return lines.join('\n')
}

// ── Application des modifications ──────────────────

function applyEdit(task, operation) {
  const oldValue = operation.type === 'title' ? task.title
    : operation.type === 'area' ? task.area
    : task.description || ''

  operation.oldValue = oldValue

  switch (operation.type) {
    case 'title':
      task.title = operation.newValue
      break
    case 'area':
      task.area = operation.newValue
      break
    case 'description':
      task.description = operation.newValue
      break
  }

  task.updatedAt = new Date().toISOString()
}

// ── Main ────────────────────────────────────────────

function main() {
  const projectName = getProjectName()

  // ── Pas de projet → auto-sélection ou erreur ──────
  if (!projectName) {
    const projects = listProjects()
    if (projects.length === 1) {
      // Auto-sélection si un seul projet
      const board = readTaskBoard(projects[0])
      const taskId = getTaskId()
      const useActive = isActiveTaskRequest()
      const demande = process.env.SCRIPT_DEMANDE || ''

      let task = null
      if (taskId) {
        task = board.tasks.find(t => t.id === taskId)
      } else if (useActive) {
        task = board.tasks.find(t => t.status === 'in_progress')
      } else {
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

      // Parser l'opération
      const operation = parseEditOperation(demande) || (getAreaFromParam() ? { type: 'area', label: 'Déplacement', oldValue: task.area || '', newValue: getAreaFromParam() } : null)
      if (!operation) {
        if (isJson) {
          console.log(JSON.stringify({ error: 'Action non reconnue', project: projects[0] }, null, 2))
        } else {
          console.log(showParseError())
        }
        process.exit(0)
      }

      applyEdit(task, operation)
      writeTaskBoard(board, projects[0])

      if (isJson) {
        console.log(JSON.stringify({ project: projects[0], task, operation }, null, 2))
      } else {
        console.log(showSuccess(projects[0], task, operation))
      }
      process.exit(0)
    }

    if (isJson) {
      console.log(JSON.stringify({ projects: listProjects() }, null, 2))
    } else {
      console.log(`${YELLOW}⚠ Aucun projet spécifié.${R()}`)
      console.log('   Dis par exemple : "renomme la tâche task-abc en \'Nouveau titre\' au projet mon-projet"')
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

  const board = readTaskBoard(projectName)
  const taskId = getTaskId()
  const useActive = isActiveTaskRequest()
  const demande = process.env.SCRIPT_DEMANDE || ''

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

  // Parser l'opération
  const operation = parseEditOperation(demande) || (getAreaFromParam() ? { type: 'area', label: 'Déplacement', oldValue: task.area || '', newValue: getAreaFromParam() } : null)
  if (!operation) {
    if (isJson) {
      console.log(JSON.stringify({ error: 'Action non reconnue', project: projectName }, null, 2))
    } else {
      console.log(showParseError())
    }
    process.exit(0)
  }

  applyEdit(task, operation)
  writeTaskBoard(board, projectName)

  if (isJson) {
    console.log(JSON.stringify({ project: projectName, task, operation }, null, 2))
  } else {
    console.log(showSuccess(projectName, task, operation))
  }

  process.exit(0)
}

main()
