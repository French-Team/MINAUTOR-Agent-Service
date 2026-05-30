#!/usr/bin/env node
/**
 * scripts/projects/etat.js — État détaillé du projet
 *
 * Affiche les informations complètes d'un projet : description, statut,
 * tâches par domaine, progression, et suggère les prochaines actions.
 *
 * Déclenché par "état du projet", "progression du projet", "statut du projet"
 *
 * Variables d'environnement :
 *   SCRIPT_PARAM_PROJECT — nom du projet (depuis le pattern registry)
 *   SCRIPT_PROJECT      — nom du projet (depuis le payload intercom)
 *   SCRIPT_DEMANDE      — demande utilisateur brute
 *
 * Usage:
 *   node scripts/projects/etat.js
 *   node scripts/projects/etat.js --json
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

// ── Barre de progression ──────────────────────────

function progressBar(ratio, width = 20) {
  const clamped = Math.max(0, Math.min(1, ratio))
  const filled = Math.round(clamped * width)
  const empty = width - filled
  return `${GREEN}${'█'.repeat(filled)}${GRAY}${'░'.repeat(empty)}${R()}`
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

function showProjectState(name) {
  const info = readProjectInfo(name)
  if (!info) return null

  const board = readTaskBoard(name)
  const tasks = board.tasks || []
  const now = new Date()

  // Statistiques globales
  const done = tasks.filter(t => t.status === 'done')
  const inProgress = tasks.filter(t => t.status === 'in_progress')
  const todo = tasks.filter(t => t.status === 'todo' || !t.status)
  const blocked = tasks.filter(t => t.status === 'blocked')
  const total = tasks.length
  const progressPct = total > 0 ? Math.round((done.length / total) * 100) : 0

  // Par domaine
  const areas = {}
  for (const t of tasks) {
    const area = t.area || 'general'
    if (!areas[area]) areas[area] = { total: 0, done: 0, inProgress: 0, todo: 0, blocked: 0 }
    areas[area].total++
    areas[area][t.status === 'in_progress' ? 'inProgress' : t.status === 'done' ? 'done' : t.status === 'blocked' ? 'blocked' : 'todo']++
  }

  // Date de création
  const createdDate = info['created_at'] ? new Date(info['created_at']).toLocaleDateString() : '—'
  const daysSinceCreation = info['created_at']
    ? Math.floor((now - new Date(info['created_at'])) / (1000 * 60 * 60 * 24))
    : 0

  const lines = []

  // ── En-tête ──
  lines.push('')
  lines.push(`${CYAN}${BOLD}═══════════════════════════════════════════${R()}`)
  lines.push(`  ${BOLD}📂 État du projet : ${name}${R()}`)
  const statusColor = info['status'] === 'active' ? GREEN : info['status'] === 'archived' ? GRAY : YELLOW
  lines.push(`  ${statusColor}${info['status']}${R()}`)
  if (info['description'] && info['description'] !== '(aucune description)') {
    lines.push(`  ${GRAY}${info['description']}${R()}`)
  }
  lines.push(`${CYAN}${BOLD}═══════════════════════════════════════════${R()}`)

  // ── Informations générales ──
  lines.push('')
  lines.push(`  ${BOLD}Informations${R()}`)
  lines.push(`    Créé le  : ${createdDate} ${daysSinceCreation > 0 ? `(${daysSinceCreation} jours)` : ''}`)
  lines.push(`    Par      : ${info['created_by'] || '—'}`)
  lines.push(`    Chemin   : workspaces/${name}/`)
  if (board.lastUpdated) {
    const lastAct = new Date(board.lastUpdated).toLocaleDateString()
    const daysSinceAct = Math.floor((now - new Date(board.lastUpdated)) / (1000 * 60 * 60 * 24))
    lines.push(`    Dernière : ${lastAct} ${daysSinceAct > 0 ? `(${daysSinceAct} jours)` : '(aujourd\'hui)'}`)
  }

  // ── Progression globale ──
  lines.push('')
  lines.push(`  ${BOLD}Progression${R()}`)
  if (total > 0) {
    const barWidth = 25
    const bar = progressBar(progressPct / 100, barWidth)
    lines.push(`    ${bar}  ${BOLD}${progressPct}%${R()} ${GRAY}— ${done.length}/${total} terminées${R()}`)
    lines.push('')
    lines.push(`    ${GREEN}✓ ${done.length} terminées${R()}`)
    lines.push(`    ${CYAN}⟳ ${inProgress.length} en cours${R()}`)
    lines.push(`    ${YELLOW}□ ${todo.length} à faire${R()}`)
    if (blocked.length > 0) lines.push(`    ${RED}⊘ ${blocked.length} bloquées${R()}`)
  } else {
    lines.push(`    ${GRAY}Aucune tâche — le projet est vide${R()}`)
    lines.push(`    ${GRAY}Ajoute une tâche avec : "ajoute une tâche au projet ${name}"${R()}`)
  }

  // ── Par domaine ──
  const areaNames = Object.keys(areas).sort()
  if (areaNames.length > 1 || (areaNames.length === 1 && areas[areaNames[0]].total > 5)) {
    lines.push('')
    lines.push(`  ${BOLD}Répartition par domaine${R()}`)
    const maxAreaLen = Math.max(8, ...areaNames.map(a => a.length))
    for (const area of areaNames) {
      const a = areas[area]
      const pct = a.total > 0 ? Math.round((a.done / a.total) * 100) : 0
      const barLocal = progressBar(pct / 100, 12)
      const areaPadded = area.padEnd(maxAreaLen)
      const taskSummary = `${GREEN}${a.done}✓${R()} ${CYAN}${a.inProgress}⟳${R()} ${YELLOW}${a.todo}□${R()}${a.blocked > 0 ? ` ${RED}${a.blocked}⊘${R()}` : ''}`
      lines.push(`    ${CYAN}${areaPadded}${R()}  ${barLocal}  ${pct}%  ${taskSummary}`)
    }
  }

  // ── Tâches en cours ──
  if (inProgress.length > 0) {
    lines.push('')
    lines.push(`  ${BOLD}${CYAN}Tâches en cours${R()}`)
    for (const t of inProgress) {
      const area = t.area ? ` ${GRAY}[${t.area}]${R()}` : ''
      const assignee = t.assignedTo ? ` ${GRAY}→ ${t.assignedTo}${R()}` : ''
      const date = t.startedAt ? ` ${GRAY}(${new Date(t.startedAt).toLocaleDateString()})${R()}` : ''
      lines.push(`    ${CYAN}⟳${R()} ${t.title}${area}${assignee}${date}`)
    }
  }

  // ── Prochaines tâches ──
  if (todo.length > 0) {
    lines.push('')
    lines.push(`  ${BOLD}${YELLOW}Prochaines tâches${R()}`)
    const nextTasks = todo.slice(0, 5)
    for (const t of nextTasks) {
      const area = t.area ? ` ${GRAY}[${t.area}]${R()}` : ''
      const date = t.createdAt ? ` ${GRAY}(${new Date(t.createdAt).toLocaleDateString()})${R()}` : ''
      lines.push(`    ${YELLOW}□${R()} ${t.title}${area}${date}`)
    }
    if (todo.length > 5) {
      lines.push(`    ${GRAY}... et ${todo.length - 5} autre(s) tâche(s) à faire${R()}`)
    }
  }

  // ── Suggestions ──
  lines.push('')
  lines.push(`  ${BOLD}${GREEN}Suggestions${R()}`)
  if (inProgress.length > 0) {
    lines.push(`    ${GRAY}• Continue le travail : "continuer le projet ${name}"${R()}`)
  } else if (todo.length > 0) {
    lines.push(`    ${GRAY}• Démarre la première tâche : "continuer le projet ${name}"${R()}`)
  } else {
    lines.push(`    ${GRAY}• Ajoute une tâche : "ajoute une tâche au projet ${name}"${R()}`)
  }
  if (total > 0) {
    lines.push(`    ${GRAY}• Voir toutes les tâches : "liste des tâches ${name}"${R()}`)
  }
  lines.push(`    ${GRAY}• Menu projet : "menu projet ${name}"${R()}`)
  lines.push('')

  return lines.join('\n')
}

// ── Main ────────────────────────────────────────────

function main() {
  const projectName = getProjectName()

  if (isJson) {
    const projects = listProjects()
    if (projectName) {
      const info = readProjectInfo(projectName)
      const board = readTaskBoard(projectName)
      console.log(JSON.stringify({
        project: projectName,
        info,
        tasks: board.tasks || [],
        lastUpdated: board.lastUpdated,
      }, null, 2))
    } else {
      console.log(JSON.stringify({
        projects: projects.map(name => ({
          name,
          info: readProjectInfo(name),
          tasks: (readTaskBoard(name).tasks || []).length,
        }))
      }, null, 2))
    }
    process.exit(0)
  }

  if (projectName) {
    const output = showProjectState(projectName)
    if (output) {
      console.log(output)
    } else {
      console.log(`${RED}❌ Projet "${projectName}" introuvable.${R()}`)
      process.exit(1)
    }
  } else {
    console.log(`${YELLOW}⚠ Aucun projet spécifié.${R()}`)
    console.log('   Dis par exemple : "état du projet soulseek-downloader"')
    const projects = listProjects()
    if (projects.length > 0) {
      console.log(`\n   Projets disponibles : ${projects.join(', ')}`)
    }
    process.exit(1)
  }

  process.exit(0)
}

main()
