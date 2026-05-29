/**
 * telecom-watcher-persist.ts — Persistance des quadrants en fichiers JSON
 *
 * Écrit 4 fichiers dans data/watcher/telecom/ à chaque cycle de mise à jour.
 * Ces fichiers sont lisibles par n'importe quel agent, notamment agent-telecom.
 *
 * Format : JSON structuré, sans ANSI, sans mise en forme écran.
 *
 * Fichiers produits :
 *   data/watcher/telecom/intercom.json    — Messages en attente, lus, traités
 *   data/watcher/telecom/routing.json     — Routages récents + stats daemon
 *   data/watcher/telecom/agents.json      — État des agents (spawns, livrables, erreurs, actifs)
 *   data/watcher/telecom/logs.json        — Dernières entrées logbook + notifications
 */

import { readFileSync, readdirSync, existsSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseLogbookTime, parseLogbookSource, parseLogbookMessage } from './telecom-log-parser.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PROJECT_ROOT = join(__dirname, '..', '..', '..')
const WATCHER_DIR = join(PROJECT_ROOT, 'data', 'watcher', 'telecom')

// ── Chemins des sources ──

const TELECOM_DIR = join(PROJECT_ROOT, 'telecom')
const INTERCOM_DIR = join(TELECOM_DIR, 'intercom')
const ROUTED_DIR = join(TELECOM_DIR, 'routed')
const AGENTS_DIR = join(TELECOM_DIR, 'agents')
const LOGBOOK_PATH = join(TELECOM_DIR, 'agent-logbook.md')
const STATUS_FILE = join(TELECOM_DIR, 'daemon.status.json')
const NOTIFY_PATH = join(TELECOM_DIR, 'notifications.json')

let FIRST_CYCLE = true

// ── Types ──

export interface IntercomEntry {
  timestamp: string
  from: string
  to: string
  subject: string
  status: 'pending' | 'read' | 'processed'
  demande: string
}

export interface RoutingEntry {
  timestamp: string
  from: string
  to: string
  subject: string
}

export interface AgentEntry {
  id: string
  livrables: number
  erreurs: number
  dernierLivrable: string | null
  actif: boolean
  actifDepuis: number | null   // secondes
  sujetActif: string | null
}

export interface LogEntry {
  timestamp: string
  source: string
  message: string
  type: 'logbook' | 'notification'
}

export interface DaemonStats {
  pid: number | null
  uptimeSec: number
  totalMessagesRouted: number
  totalSpawns: number
  totalBlocks: number
  agentCount: number
  activeSpawns: Array<{ agentId: string; subject: string; runningFor: number }>
}

// ── Helper : créé le dossier si nécessaire ──

function ensureDir(): void {
  if (!existsSync(WATCHER_DIR)) {
    mkdirSync(WATCHER_DIR, { recursive: true })
  }
}

// ── 1. Intercom ──

function persistIntercom(): void {
  const entries: IntercomEntry[] = []

  if (existsSync(INTERCOM_DIR)) {
    const files = readdirSync(INTERCOM_DIR).filter(f => f.endsWith('.json')).sort()
    for (const f of files) {
      try {
        const raw = readFileSync(join(INTERCOM_DIR, f), 'utf-8')
        const msg = JSON.parse(raw)
        entries.push({
          timestamp: msg.timestamp || '',
          from: msg.from || '?',
          to: msg.to || '?',
          subject: msg.subject || '',
          status: msg.status || 'pending',
          demande: msg.payload?.demande
            ? (typeof msg.payload.demande === 'string' ? msg.payload.demande : '')
            : '',
        })
      } catch { /* skip */ }
    }
  }

  // Résumé
  const pending = entries.filter(e => e.status === 'pending').length
  const read = entries.filter(e => e.status === 'read').length
  const processed = entries.filter(e => e.status === 'processed').length

  const data = {
    updatedAt: new Date().toISOString(),
    total: entries.length,
    pending,
    read,
    processed,
    messages: entries.slice(-30), // 30 derniers messages
  }

  writeFileSync(join(WATCHER_DIR, 'intercom.json'), JSON.stringify(data, null, 2), 'utf-8')
}

// ── 2. Routage ──

function persistRouting(): void {
  const entries: RoutingEntry[] = []

  if (existsSync(ROUTED_DIR)) {
    const files = readdirSync(ROUTED_DIR).filter(f => f.endsWith('.json')).sort()
    for (const f of files) {
      try {
        const raw = readFileSync(join(ROUTED_DIR, f), 'utf-8')
        const msg = JSON.parse(raw)
        entries.push({
          timestamp: msg.timestamp || '',
          from: msg.from || '?',
          to: msg.to || '?',
          subject: msg.subject || '',
        })
      } catch { /* skip */ }
    }
  }

  // Stats daemon
  let stats: DaemonStats = {
    pid: null,
    uptimeSec: 0,
    totalMessagesRouted: 0,
    totalSpawns: 0,
    totalBlocks: 0,
    agentCount: 0,
    activeSpawns: [],
  }
  if (existsSync(STATUS_FILE)) {
    try {
      const raw = readFileSync(STATUS_FILE, 'utf-8')
      const s = JSON.parse(raw)
      stats = {
        pid: s.pid ?? null,
        uptimeSec: s.uptimeSec ?? 0,
        totalMessagesRouted: s.totalMessagesRouted ?? 0,
        totalSpawns: s.totalSpawns ?? 0,
        totalBlocks: s.totalBlocks ?? 0,
        agentCount: s.agentCount ?? 0,
        activeSpawns: Array.isArray(s.activeSpawns)
          ? s.activeSpawns.map((a: { agentId: string; subject: string; startedAt: string }) => ({
              agentId: a.agentId,
              subject: a.subject || '',
              runningFor: Math.floor((Date.now() - new Date(a.startedAt).getTime()) / 1000),
            }))
          : [],
      }
    } catch { /* skip */ }
  }

  const data = {
    updatedAt: new Date().toISOString(),
    stats,
    routages: entries.slice(-30), // 30 derniers routages
  }

  writeFileSync(join(WATCHER_DIR, 'routing.json'), JSON.stringify(data, null, 2), 'utf-8')
}

// ── 3. Agents ──

function persistAgents(): void {
  // Lire les spawns actifs
  const activeSpawns = new Map<string, { subject: string; runningFor: number }>()
  if (existsSync(STATUS_FILE)) {
    try {
      const raw = readFileSync(STATUS_FILE, 'utf-8')
      const status = JSON.parse(raw)
      if (Array.isArray(status.activeSpawns)) {
        for (const s of status.activeSpawns) {
          const runningFor = Math.floor((Date.now() - new Date(s.startedAt).getTime()) / 1000)
          activeSpawns.set(s.agentId, { subject: s.subject || '', runningFor })
        }
      }
    } catch { /* skip */ }
  }

  const firstCycle = FIRST_CYCLE
  FIRST_CYCLE = false

  const agents: AgentEntry[] = []

  if (existsSync(AGENTS_DIR)) {
    const agentDirs = readdirSync(AGENTS_DIR).filter(f => {
      try { return statSync(join(AGENTS_DIR, f)).isDirectory() } catch { return false }
    }).sort()

    for (const agentId of agentDirs) {
      const agentPath = join(AGENTS_DIR, agentId)
      try {
        const files = readdirSync(agentPath).filter(f => f !== 'README.md' && f !== '.gitkeep')
        const livrables = files.filter(f => f.startsWith('livrable-'))
        const erreurs = files.filter(f => f.startsWith('erreur-'))
        const dernierLivrable = livrables.length > 0
          ? livrables.sort().pop()!.replace('livrable-', '').slice(0, 16)
          : null
        const actif = activeSpawns.has(agentId)
        const activeInfo = actif ? activeSpawns.get(agentId)! : null

        // Au premier cycle après le démarrage, on zéro les champs dynamiques
        // (spawnActif, erreurs, tempsActivite) pour offrir un état vierge
        // à agent-telecom. Les cycles suivants reflètent la réalité.
        if (firstCycle) {
          agents.push({
            id: agentId,
            livrables: 0,
            erreurs: 0,
            dernierLivrable: null,
            actif: false,
            actifDepuis: null,
            sujetActif: null,
          })
        } else {
          agents.push({
            id: agentId,
            livrables: livrables.length,
            erreurs: erreurs.length,
            dernierLivrable,
            actif,
            actifDepuis: activeInfo?.runningFor ?? null,
            sujetActif: activeInfo?.subject ?? null,
          })
        }
      } catch { /* skip */ }
    }
  }

  // Ajouter les spawns orphelins (sans dossier agent)
  for (const [agentId, info] of activeSpawns) {
    if (!agents.some(a => a.id === agentId)) {
      agents.push({
        id: agentId,
        livrables: 0,
        erreurs: 0,
        dernierLivrable: null,
        actif: true,
        actifDepuis: info.runningFor,
        sujetActif: info.subject,
      })
    }
  }

  const nbActifs = agents.filter(a => a.actif).length
  const totalErreurs = agents.reduce((acc, a) => acc + a.erreurs, 0)
  const totalLivrables = agents.reduce((acc, a) => acc + a.livrables, 0)

  const data = {
    updatedAt: new Date().toISOString(),
    totalAgents: agents.length,
    actifs: nbActifs,
    totalErreurs,
    totalLivrables,
    agents,
  }

  writeFileSync(join(WATCHER_DIR, 'agents.json'), JSON.stringify(data, null, 2), 'utf-8')
}

// ── 4. Logs ──



function persistLogs(): void {
  const entries: LogEntry[] = []

  // Logbook
  if (existsSync(LOGBOOK_PATH)) {
    try {
      const content = readFileSync(LOGBOOK_PATH, 'utf-8').trim()
      const rawEntries = content.split('\n## ').filter(Boolean)
      for (const entry of rawEntries.slice(-20)) {
        const time = parseLogbookTime(entry, true)  // date complète pour le fichier JSON
        const source = parseLogbookSource(entry)
        const msg = parseLogbookMessage(entry, 100)
        if (msg) {
          entries.push({
            timestamp: time,
            source,
            message: msg.slice(0, 150),
            type: 'logbook',
          })
        }
      }
    } catch { /* skip */ }
  }

  // Notifications
  if (existsSync(NOTIFY_PATH)) {
    try {
      const raw = readFileSync(NOTIFY_PATH, 'utf-8').trim()
      if (raw) {
        const notifs = JSON.parse(raw)
        if (Array.isArray(notifs)) {
          for (const n of notifs) {
            const time = (n.timestamp || '').slice(11, 19)
            const msg = (n.message || '').split('\n')[0].slice(0, 150)
            if (msg) {
              entries.push({
                timestamp: time,
                source: n.from || '?',
                message: msg,
                type: 'notification',
              })
            }
          }
        }
      }
    } catch { /* skip */ }
  }

  const data = {
    updatedAt: new Date().toISOString(),
    total: entries.length,
    entries: entries.slice(-50), // 50 dernières entrées
  }

  writeFileSync(join(WATCHER_DIR, 'logs.json'), JSON.stringify(data, null, 2), 'utf-8')
}

// ── API publique ──

/**
 * Persiste les 4 quadrants dans data/watcher/telecom/.
 * Appelée à chaque cycle de collecte du watcher.
 */
export function persistAllQuadrants(): void {
  try {
    ensureDir()
    persistIntercom()
    persistRouting()
    persistAgents()
    persistLogs()
  } catch {
    // Échec silencieux — ne pas casser le watcher pour un problème d'écriture
  }
}
