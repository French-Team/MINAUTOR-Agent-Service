#!/usr/bin/env node
/**
 * scripts/suggestions/handle.js — Générateur de suggestions contextuelles
 *
 * Analyse le contexte du projet courant et les données dans data/ pour
 * générer des suggestions dynamiques, écrites dans telecom/suggestions.json.
 *
 * Usage:
 *   node scripts/suggestions/handle.js                          # suggestions génériques
 *   node scripts/suggestions/handle.js --project <nom>          # suggestions pour un projet
 *   node scripts/suggestions/handle.js --json                   # mode JSON
 *   node scripts/suggestions/handle.js --project <nom> --json   # les deux
 *
 * Return codes:
 *   0 — Toujours
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, statSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'

// ── Couleurs (depuis le module partagé d'Alice) ────────

import {
  CYAN, GREEN, YELLOW, RED, GRAY, BOLD, RESET, MAGENTA,
  header, num, label,
  readFile,
} from '../alice/colors.js'

const CWD = process.cwd()

// ── Chemins ─────────────────────────────────────────────

const WORKSPACES_DIR = join(CWD, 'workspaces')
const SUGGESTIONS_PATH = join(CWD, 'telecom', 'suggestions.json')
const DATA_DIR = join(CWD, 'data')

// ── Interface suggestion ────────────────────────────────

/**
 * @typedef {{ label: string, description: string, command: string }} Suggestion
 */

// ── Parse des arguments ─────────────────────────────────

const ALL_ARGS = process.argv.slice(2)
const jsonMode = ALL_ARGS.includes('--json')
const projectArg = (() => {
  const idx = ALL_ARGS.indexOf('--project')
  if (idx !== -1 && idx + 1 < ALL_ARGS.length) return ALL_ARGS[idx + 1]
  return null
})()

// ── Lecture dossiers data/ ──────────────────────────────

/**
 * Lit les N dernières entrées du logbook (telecom/agent-logbook.md).
 * Retourne les entrées parsées avec leur type (success, error, kill).
 * @param {number} maxLines — Nombre de lignes max à lire (défaut 300)
 * @returns {Array<{type: string, agent: string, date: string, instruction: string, detail: string}>}
 */
function readLogbook(maxLines = 300) {
  const logbookPath = join(CWD, 'telecom', 'agent-logbook.md')
  if (!existsSync(logbookPath)) return []

  try {
    const content = readFileSync(logbookPath, 'utf-8')
    const lines = content.split('\n').reverse().slice(0, maxLines).reverse()
    const entries = []

    let currentEntry = null
    for (const line of lines) {
      const headerMatch = line.match(/^##\s+(.+?)\s+\(([^)]+)\)\s*$/)
      if (headerMatch) {
        if (currentEntry) entries.push(currentEntry)
        currentEntry = {
          type: 'success',
          agent: headerMatch[1].trim(),
          agentId: headerMatch[2].trim(),
          date: '',
          instruction: '',
          detail: '',
        }
        continue
      }

      if (!currentEntry) continue

      const dateMatch = line.match(/^\*\*Date :\*\*\s+(.+)$/)
      if (dateMatch) { currentEntry.date = dateMatch[1].trim(); continue }

      const instrMatch = line.match(/^\*\*Instruction :\*\*\s+(.+)$/)
      if (instrMatch) { currentEntry.instruction = instrMatch[1].trim(); continue }

      const errMatch = line.match(/^\*\*Erreur :\*\*\s+(.+)$/)
      if (errMatch) { currentEntry.type = 'error'; currentEntry.detail = errMatch[1].trim(); continue }

      const killMatch = line.match(/^\*\*Interrompu :\*\*\s+(.+)$/)
      if (killMatch) { currentEntry.type = 'kill'; currentEntry.detail = killMatch[1].trim(); continue }

      if (line.trim()) currentEntry.detail += (currentEntry.detail ? '\n' : '') + line.trim()
    }
    if (currentEntry) entries.push(currentEntry)

    return entries.reverse()
  } catch {
    return []
  }
}

/**
 * Lit les notifications actives (telecom/notifications.json) et les archives récentes.
 * @param {number} days — Jours d'archives à inclure (défaut 3)
 * @returns {{ active: Array, archived: Array, countByLevel: object, recentUrgent: number }}
 */
function readNotifications(days = 3) {
  const notifyPath = join(CWD, 'telecom', 'notifications.json')
  const archiveDir = join(CWD, 'telecom', 'notifications')

  // Notifications actives dans le fichier principal
  let active = []
  if (existsSync(notifyPath)) {
    try {
      const raw = readFileSync(notifyPath, 'utf-8').trim()
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) active = parsed
      }
    } catch { /* ignore */ }
  }

  // Archives récentes
  let archived = []
  if (existsSync(archiveDir)) {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)
    const cutoffStr = cutoff.toISOString().slice(0, 10)

    for (const f of readdirSync(archiveDir).filter(f => f.endsWith('.json') && f.replace(/\.json$/, '') >= cutoffStr).sort()) {
      try {
        const raw = readFileSync(join(archiveDir, f), 'utf-8').trim()
        if (raw) {
          const entries = JSON.parse(raw)
          if (Array.isArray(entries)) archived.push(...entries)
        }
      } catch { /* skip */ }
    }
  }

  // Compter par niveau
  const all = [...active, ...archived]
  const countByLevel = {}
  let recentUrgent = 0
  const recentThreshold = Date.now() - 24 * 60 * 60 * 1000 // 24h

  for (const n of all) {
    const level = n.level || 'info'
    countByLevel[level] = (countByLevel[level] || 0) + 1
    try {
      const ts = new Date(n.timestamp).getTime()
      if (!isNaN(ts) && ts > recentThreshold && (level === 'urgent' || level === 'avertissement' || level === 'warning')) {
        recentUrgent++
      }
    } catch { /* ignore */ }
  }

  return { active, archived: archived, countByLevel, recentUrgent }
}

/**
 * Lit les messages intercom en attente et routés.
 * @returns {{ pending: Array, routed: Array, pendingCount: number }}
 */
function readIntercom() {
  const intercomDir = join(CWD, 'telecom', 'intercom')
  const routedDir = join(CWD, 'telecom', 'routed')

  let pending = []
  let routed = []

  // Messages en attente dans intercom/
  if (existsSync(intercomDir)) {
    for (const f of readdirSync(intercomDir).filter(f => f.endsWith('.json')).sort()) {
      try {
        const raw = readFileSync(join(intercomDir, f), 'utf-8')
        const msg = JSON.parse(raw)
        pending.push(msg)
      } catch { /* skip */ }
    }
  }

  // Messages routés
  if (existsSync(routedDir)) {
    for (const f of readdirSync(routedDir).filter(f => f.endsWith('.json')).sort()) {
      try {
        const raw = readFileSync(join(routedDir, f), 'utf-8')
        const msg = JSON.parse(raw)
        routed.push(msg)
      } catch { /* skip */ }
    }
  }

  return {
    pending: pending.filter(m => m.status === 'pending'),
    routed: routed.filter(m => m.status === 'read' || m.status === 'processed'),
    pendingCount: pending.filter(m => m.status === 'pending').length,
  }
}
/**
 * Liste les profils disponibles dans data/profiles/ (agents, bots, daemons).
 * @returns {{ agents: number, bots: number, daemons: number, total: number }}
 */
function countProfiles() {
  const profilesDir = join(DATA_DIR, 'profiles')
  if (!existsSync(profilesDir)) return { agents: 0, bots: 0, daemons: 0, total: 0 }

  let agents = 0, bots = 0, daemons = 0
  for (const cat of readdirSync(profilesDir)) {
    const catPath = join(profilesDir, cat)
    try {
      if (statSync(catPath).isDirectory()) {
        const count = readdirSync(catPath).filter(f => f.endsWith('.json')).length
        if (cat === 'agents') agents = count
        else if (cat === 'bots') bots = count
        else if (cat === 'daemons') daemons = count
      }
    } catch { /* ignore */ }
  }
  return { agents, bots, daemons, total: agents + bots + daemons }
}

/**
 * Liste les skills disponibles dans skills/.
 * @returns {string[]}
 */
function listSkills() {
  const skillsDir = join(CWD, 'skills')
  if (!existsSync(skillsDir)) return []
  return readdirSync(skillsDir)
    .filter(e => {
      try { return statSync(join(skillsDir, e)).isDirectory() } catch { return false }
    })
    .sort()
}

/**
 * Liste les agents disponibles dans .agents/.
 * @returns {Array<{id: string, model: string}>}
 */
function listAgents() {
  const agentsDir = join(CWD, '.agents')
  if (!existsSync(agentsDir)) return []
  return readdirSync(agentsDir)
    .filter(f => f.endsWith('.ts'))
    .map(f => {
      const id = f.replace(/\.ts$/, '')
      const content = readFile(join(agentsDir, f))
      const modelMatch = content?.match(/model:\s*'([^']+)'/)
      return { id, model: modelMatch ? modelMatch[1] : '?' }
    })
    .sort((a, b) => a.id.localeCompare(b.id))
}

/**
 * Charge le registre des scripts (data/scripts/registry.yaml).
 * @returns {Array<{pattern: string, script: string, description: string}>}
 */
function loadScriptRegistry() {
  const registryPath = join(DATA_DIR, 'scripts', 'registry.yaml')
  if (!existsSync(registryPath)) return []

  const content = readFile(registryPath)
  if (!content) return []

  // Mini-parseur YAML pour extraire les scripts
  const scripts = []
  const lines = content.split('\n')
  let inScripts = false
  let current = null

  for (const line of lines) {
    if (line.trim().startsWith('scripts:')) {
      inScripts = true
      continue
    }
    if (inScripts) {
      if (line.trim().startsWith('- pattern:')) {
        if (current) scripts.push(current)
        current = { pattern: '', script: '', description: '' }
        current.pattern = line.split(/pattern:\s*/)[1]?.replace(/['"]/g, '').trim() || ''
      } else if (current && line.trim().startsWith('script:')) {
        current.script = line.split(/script:\s*/)[1]?.replace(/['"]/g, '').trim() || ''
      } else if (current && line.trim().startsWith('description:')) {
        current.description = line.split(/description:\s*/)[1]?.replace(/['"]/g, '').trim() || ''
      } else if (line.trim() === '' && current) {
        // End of entry
        if (current.pattern || current.script) {
          scripts.push(current)
        }
        current = null
      }
    }
  }
  if (current && (current.pattern || current.script)) scripts.push(current)

  return scripts
}

// ── Lecture tâches du projet ────────────────────────────

/**
 * Lit le tableau des tâches d'un projet.
 * @param {string} projectName
 * @returns {{ tasks: Array<{id: string, title: string, area: string, status: string}>, exists: boolean }}
 */
function readProjectTasks(projectName) {
  const tasksPath = join(WORKSPACES_DIR, projectName, '.tasks.json')
  if (!existsSync(tasksPath)) return { tasks: [], exists: false }

  try {
    const raw = readFileSync(tasksPath, 'utf-8')
    const board = JSON.parse(raw)
    return { tasks: board.tasks || [], exists: true }
  } catch {
    return { tasks: [], exists: false }
  }
}

/**
 * Compte les tâches par statut.
 * @param {Array<{status: string}>} tasks
 * @returns {{todo: number, inProgress: number, done: number, blocked: number}}
 */
function countTaskStatuses(tasks) {
  const counts = { todo: 0, inProgress: 0, done: 0, blocked: 0 }
  for (const t of tasks) {
    switch (t.status) {
      case 'todo': counts.todo++; break
      case 'in_progress': counts.inProgress++; break
      case 'done': counts.done++; break
      case 'blocked': counts.blocked++; break
    }
  }
  return counts
}

/**
 * Liste les domaines (areas) uniques d'un projet.
 * @param {Array<{area: string}>} tasks
 * @returns {string[]}
 */
function listAreas(tasks) {
  const areas = new Set()
  for (const t of tasks) areas.add(t.area)
  return [...areas].sort()
}

/**
 * Liste les projets disponibles dans workspaces/.
 * @returns {string[]}
 */
function listProjects() {
  if (!existsSync(WORKSPACES_DIR)) return []
  return readdirSync(WORKSPACES_DIR)
    .filter(e => {
      try {
        if (!statSync(join(WORKSPACES_DIR, e)).isDirectory()) return false
        if (e.startsWith('.')) return false
        return existsSync(join(WORKSPACES_DIR, e, '.workspace'))
      } catch { return false }
    })
    .sort()
}

// ── Générateurs de suggestions ─────────────────────────

/**
 * Suggestions génériques (aucun projet sélectionné).
 * @returns {Suggestion[]}
 */
function generateGenericSuggestions() {
  const projects = listProjects()
  const profiles = countProfiles()
  const agents = listAgents()
  const skills = listSkills()
  const scripts = loadScriptRegistry()

  // ── Sources dynamiques ──
  const logbook = readLogbook()
  const notifications = readNotifications()
  const intercom = readIntercom()

  /** @type {Suggestion[]} */
  const suggestions = []

  // ── Logbook : erreurs récentes ou agent tué ──
  const recentErrors = logbook.filter(e => (e.type === 'error' || e.type === 'kill') && e.date)
  if (recentErrors.length > 0) {
    const latest = recentErrors[recentErrors.length - 1]
    const icon = latest.type === 'kill' ? '❌ Tué' : '⚠ Erreur'
    suggestions.push({
      label: `Voir l\'incident récent — ${latest.agent}`,
      description: `${icon} : ${latest.detail.slice(0, 80)}`,
      command: `cat telecom/agent-logbook.md | tail -n 40 | head -n 20`,
    })
  }

  // ── Logbook : récent succès → continuer ──
  const recentSuccesses = logbook.filter(e => e.type === 'success' && e.instruction && e.date)
  if (recentSuccesses.length > 0) {
    const latest = recentSuccesses[recentSuccesses.length - 1]
    if (latest.date) {
      const hoursAgo = Math.floor((Date.now() - new Date(latest.date.replace(' ', 'T')).getTime()) / 3600000)
      if (hoursAgo <= 24) {
        suggestions.push({
          label: `Reprendre le travail — ${latest.agent}`,
          description: hoursAgo < 1
            ? 'Dernière activité il y a moins d\'une heure — poursuivre ?'
            : `Dernière activité il y a ${hoursAgo}h — continuer ?`,
          command: `cat telecom/agent-logbook.md | tail -n 30`,
        })
      }
    }
  }

  // ── Notifications : urgent ──
  if (notifications.recentUrgent > 0) {
    suggestions.push({
      label: 'Consulter les notifications urgentes',
      description: `${notifications.recentUrgent} notification(s) urgentes ou avertissements récents`,
      command: 'node scripts/telecom/summary.js',
    })
  }

  // ── Notifications : en attente (non urgent) ──
  if (notifications.active.length > 0 && notifications.recentUrgent === 0) {
    const levels = Object.entries(notifications.countByLevel)
      .filter(([k]) => k !== 'info')
      .map(([k, v]) => `${k}=${v}`)
      .join(', ')
    suggestions.push({
      label: 'Voir les notifications',
      description: `${notifications.active.length} notification(s) active(s)${levels ? ' (' + levels + ')' : ''}`,
      command: '/notifications',
    })
  }

  // ── Intercom : messages en attente ──
  if (intercom.pendingCount > 0) {
    const subjects = [...new Set(intercom.pending.map(m => m.subject))].join(', ')
    suggestions.push({
      label: 'Traiter les messages intercom',
      description: `${intercom.pendingCount} message(s) en attente — ${subjects}`,
      command: 'node dist/telecom/service/intercom-manager.js read alice',
    })
  }

  // ── Intercom : routés récents ──
  if (intercom.routed.length > 0) {
    suggestions.push({
      label: 'Voir les messages routés',
      description: `${intercom.routed.length} message(s) routé(s) récents`,
      command: 'ls telecom/routed/',
    })
  }

  // Projets
  if (projects.length > 0) {
    suggestions.push({
      label: 'Lister les projets',
      description: `${projects.length} projet(s) disponible(s)`,
      command: '!project list',
    })
    // Si un seul projet disponible, la commande est concrète
    if (projects.length === 1) {
      suggestions.push({
        label: `Utiliser le projet ${projects[0]}`,
        description: 'Définir le projet courant pour des suggestions contextuelles',
        command: `!project use ${projects[0]}`,
      })
    } else {
      suggestions.push({
        label: 'Choisir un projet',
        description: `${projects.length} projets disponibles : ${projects.join(', ')}`,
        command: `!project use ${projects[0]}`,
      })
    }
  } else {
    suggestions.push({
      label: 'Créer un projet',
      description: 'Commence par créer un projet',
      command: '!project create mon-projet "Description du projet"',
    })
  }

  // Découverte
  suggestions.push({
    label: 'Découvrir le projet',
    description: 'Explorer la structure et les métriques du projet',
    command: `node scripts/alice/decouverte.js`,
  })

  // Agents
  if (agents.length > 0) {
    suggestions.push({
      label: 'Lister les agents',
      description: `${agents.length} agent(s) disponible(s)`,
      command: '/agents',
    })
  }

  // Skills
  if (skills.length > 0) {
    suggestions.push({
      label: 'Voir les skills',
      description: `${skills.length} skill(s) disponible(s)`,
      command: '/skills',
    })
  }

  // Profils disponibles
  if (profiles.total > 0) {
    suggestions.push({
      label: 'Explorer les profils',
      description: `${profiles.total} profils (${profiles.agents} agents, ${profiles.bots} bots, ${profiles.daemons} daemons)`,
      command: 'node scripts/alice/decouverte.js --compact',
    })
  }

  // Scripts disponibles via le registre
  const projectScripts = scripts.filter(s => s.description.toLowerCase().includes('projet') || s.description.toLowerCase().includes('tâche'))
  if (projectScripts.length > 0) {
    suggestions.push({
      label: 'Voir l\'aide des projets',
      description: `${projectScripts.length} scripts liés aux projets disponibles`,
      command: '!project help',
    })
  }

  // Aide
  suggestions.push({
    label: 'Afficher l\'aide',
    description: 'Voir toutes les commandes disponibles',
    command: '/help',
  })

  // Sélecteur
  suggestions.push({
    label: 'Ouvrir le sélecteur',
    description: 'Navigation rapide par catégories',
    command: '/?',
  })

  return suggestions
}

/**
 * Suggestions pour un projet spécifique.
 * @param {string} projectName
 * @returns {Suggestion[]}
 */
function generateProjectSuggestions(projectName) {
  const { tasks, exists } = readProjectTasks(projectName)
  const counts = countTaskStatuses(tasks)
  const areas = listAreas(tasks)
  const projects = listProjects()

  // ── Sources dynamiques ──
  const logbook = readLogbook()
  const notifications = readNotifications()
  const intercom = readIntercom()

  /** @type {Suggestion[]} */
  const suggestions = []

  // ── Logbook : erreurs récentes pouvant concerner ce projet ──
  const projectErrors = logbook.filter(e =>
    (e.type === 'error' || e.type === 'kill') &&
    e.date &&
    (e.instruction.toLowerCase().includes(projectName.toLowerCase()) ||
     e.agentId.toLowerCase().includes(projectName.toLowerCase()) ||
     e.agent.toLowerCase().includes(projectName.toLowerCase()))
  )
  if (projectErrors.length > 0) {
    const latest = projectErrors[projectErrors.length - 1]
    suggestions.push({
      label: `⚠ Incident lié au projet : ${latest.agent}`,
      description: latest.detail.slice(0, 100),
      command: `cat telecom/agent-logbook.md | tail -n 50 | head -n 25`,
    })
  }

  // ── Notifications : urgentes liées au projet ──
  if (notifications.recentUrgent > 0) {
    const projectNotifs = [...notifications.active, ...(notifications.archived || [])].filter(n =>
      (n.message || '').toLowerCase().includes(projectName.toLowerCase())
    )
    if (projectNotifs.length > 0 || notifications.recentUrgent > 0) {
      suggestions.push({
        label: 'Consulter les notifications urgentes',
        description: `${notifications.recentUrgent} alerte(s) récente(s) — peut concerner le projet`,
        command: 'node scripts/telecom/summary.js',
      })
    }
  }

  // ── Intercom : messages en attente ──
  if (intercom.pendingCount > 0) {
    const projectIntercom = intercom.pending.filter(m => {
      const payload = JSON.stringify(m.payload || {}).toLowerCase()
      return payload.includes(projectName.toLowerCase())
    })
    if (projectIntercom.length > 0) {
      suggestions.push({
        label: `Messages intercom pour ${projectName}`,
        description: `${projectIntercom.length} message(s) en attente liés au projet`,
        command: 'node dist/telecom/service/intercom-manager.js read alice',
      })
    }
  }

  // ── Appels récents du logbook vers ce projet ──
  const recentCalls = logbook.filter(e =>
    e.type === 'success' && e.date &&
    e.instruction.toLowerCase().includes(projectName.toLowerCase())
  )
  if (recentCalls.length > 0) {
    const latest = recentCalls[recentCalls.length - 1]
    if (latest.date) {
      const hoursAgo = Math.floor((Date.now() - new Date(latest.date.replace(' ', 'T')).getTime()) / 3600000)
      if (hoursAgo <= 24) {
        suggestions.push({
          label: `Continuer sur ${projectName}`,
          description: `Dernière action il y a ${hoursAgo < 1 ? 'moins d\'1h' : hoursAgo + 'h'} — reprendre`,
          command: `cat telecom/agent-logbook.md | tail -n 30`,
        })
      }
    }
  }

  // ── Infos projet ──
  suggestions.push({
    label: `Voir le projet ${projectName}`,
    description: 'Détails et statistiques du projet',
    command: `!project show ${projectName}`,
  })

  suggestions.push({
    label: `Lister les tâches de ${projectName}`,
    description: `${tasks.length} tâche(s) au total`,
    command: `!project tasks ${projectName}`,
  })

  // ── Séquences de travail ──
  if (counts.todo > 0) {
    suggestions.push({
      label: 'Démarrer la prochaine tâche',
      description: `${counts.todo} tâche(s) à faire`,
      command: `!project tasks ${projectName}`,
    })
  }

  if (counts.inProgress > 0) {
    suggestions.push({
      label: 'Voir les tâches en cours',
      description: `${counts.inProgress} tâche(s) en cours`,
      command: `!project tasks ${projectName}`,
    })
  }

  if (counts.blocked > 0) {
    suggestions.push({
      label: 'Voir les tâches bloquées',
      description: `${counts.blocked} tâche(s) bloquée(s) — nécessite attention`,
      command: `!project tasks ${projectName}`,
    })
  }

  // ── Ajout de tâches par domaine ──
  if (areas.length > 0) {
    for (const area of areas.slice(0, 3)) {
      suggestions.push({
        label: `Ajouter une tâche [${area}]`,
        description: `Nouvelle tâche dans le domaine ${area}`,
        command: `!project task ${projectName} add ${area} <titre>`,
      })
    }
  } else {
    suggestions.push({
      label: 'Ajouter une première tâche',
      description: 'Définir la première action pour ce projet',
      command: `!project task ${projectName} add <area> <titre>`,
    })
  }

  // ── Navigation entre projets ──
  if (projects.length > 1) {
    const others = projects.filter(p => p !== projectName)
    for (const other of others.slice(0, 2)) {
      suggestions.push({
        label: `Passer au projet ${other}`,
        description: 'Changer de projet courant',
        command: `!project use ${other}`,
      })
    }
  }

  // ── Découverte ──
  suggestions.push({
    label: `Explorer ${projectName}`,
    description: 'Analyse détaillée du projet',
    command: `node scripts/alice/decouverte.js`,
  })

  // ── Gestion ──
  suggestions.push({
    label: 'Lister tous les projets',
    description: `${projects.length} projet(s) au total`,
    command: '!project list',
  })

  return suggestions
}

// ── Écriture des suggestions ───────────────────────────

/**
 * Écrit les suggestions dans telecom/suggestions.json.
 * @param {Suggestion[]} suggestions
 */
function writeSuggestions(suggestions) {
  try {
    const dir = join(SUGGESTIONS_PATH, '..')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(SUGGESTIONS_PATH, JSON.stringify(suggestions, null, 2), 'utf-8')
  } catch (err) {
    console.error(`${RED}[Suggestions] Erreur écriture : ${err.message}${RESET}`)
  }
}

// ── Affichage ───────────────────────────────────────────

/**
 * Affiche les suggestions dans la console.
 * @param {Suggestion[]} suggestions
 * @param {string|null} context — description du contexte
 */
function displaySuggestions(suggestions, context) {
  const ts = new Date().toISOString().slice(11, 19)

  console.log(`\n${GRAY}[${ts}]${RESET} ${CYAN}${BOLD}Suggestions contextuelles${RESET}`)
  console.log(`  ${GRAY}Contexte : ${context || 'Aucun projet sélectionné'}${RESET}`)
  console.log()

  if (suggestions.length === 0) {
    console.log(`  ${YELLOW}Aucune suggestion disponible pour ce contexte.${RESET}`)
    return
  }

  for (let i = 0; i < suggestions.length; i++) {
    const s = suggestions[i]
    const num = String(i + 1).padStart(2)
    console.log(`  ${GREEN}${num}${RESET}.  ${BOLD}${s.label}${RESET}`)
    console.log(`      ${GRAY}${s.description}${RESET}`)
    console.log(`      ${GRAY}→${RESET} ${CYAN}${s.command}${RESET}`)
    console.log()
  }

  console.log(`  ${GRAY}━ ${suggestions.length} suggestion(s) — disponible(s) dans le menu Suggestions${RESET}\n`)
}

// ── Main ────────────────────────────────────────────────

function main() {
  const projectName = projectArg

  /** @type {Suggestion[]} */
  let suggestions = []
  let context = ''

  if (projectName) {
    // Suggestions pour un projet spécifique
    suggestions = generateProjectSuggestions(projectName)
    context = `Projet : ${CYAN}${projectName}${RESET}`
  } else {
    // Suggestions génériques
    suggestions = generateGenericSuggestions()
    const projects = listProjects()
    context = projects.length > 0
      ? `${CYAN}${projects.length}${RESET} projet(s) disponible(s)`
      : `${YELLOW}Aucun projet${RESET}`
  }

  // Toujours écrire les suggestions dans le fichier JSON
  writeSuggestions(suggestions)

  // Mode JSON
  if (jsonMode) {
    console.log(JSON.stringify({
      context: projectName || null,
      total: suggestions.length,
      suggestions: suggestions.map((s, i) => ({ ...s, index: i + 1 })),
    }, null, 2))
    process.exit(0)
  }

  // Affichage console
  displaySuggestions(suggestions, context)
  process.exit(0)
}

main()
