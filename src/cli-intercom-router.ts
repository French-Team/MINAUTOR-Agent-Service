/**
 * cli-intercom-router.ts — Détection automatique des intentions utilisateur
 *
 * Route les demandes vers agent-telecom via intercom, SANS passer par le LLM.
 * Le LLM est trop imprévisible pour exécuter des commandes shell fiables.
 * Ce routeur fait le travail à sa place.
 *
 * Fonctionnement :
 *   1. Analyse le message utilisateur (mots-clés)
 *   2. Si un pattern match → écrit un message intercom dans telecom/intercom/
 *   3. Le daemon telecom route vers agent-telecom
 *   4. Agent-telecom route vers l'orchestrateur → agent spécialisé
 *
 * Patterns chargés depuis data/cahier-aides-alice/intercom-patterns.json
 */

import { writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync, readFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'

// ── Patterns chargés depuis le JSON ─────────────────

interface IntercomPattern {
  keywords: string[]
  /** Nombre minimum de mots-clés à matcher (2+ évite les faux positifs) */
  minMatch: number
  /** Subject du message intercom */
  subject: string
  /** Message affiché à l'utilisateur */
  response: string
}

interface PatternRegistry {
  patterns: Array<{
    id: string
    name: string
    keywords: string[]
    minMatch: number
    subject: string
    response: string
  }>
}

const PATTERNS_FILE = join(process.cwd(), 'data', 'cahier-aides-alice', 'intercom-patterns.json')

function loadPatterns(): IntercomPattern[] {
  try {
    const raw = readFileSync(PATTERNS_FILE, 'utf-8')
    const registry: PatternRegistry = JSON.parse(raw)
    if (!Array.isArray(registry.patterns)) {
      console.warn('[intercom] patterns invalide dans intercom-patterns.json')
      return []
    }
    return registry.patterns.map(p => ({
      keywords: p.keywords,
      minMatch: p.minMatch,
      subject: p.subject,
      response: p.response,
    }))
  } catch (err) {
    console.warn(`[intercom] Impossible de charger intercom-patterns.json: ${(err as Error).message}`)
    return []
  }
}

let _patterns: IntercomPattern[] | null = null

function getPatterns(): IntercomPattern[] {
  if (!_patterns) {
    _patterns = loadPatterns()
  }
  return _patterns
}

// ── Projet courant ─────────────────────────────────

let _currentProject: string | undefined

/**
 * Définit le projet courant pour les prochains messages intercom.
 * Le nom du projet est automatiquement ajouté au payload de chaque message.
 */
export function setCurrentProject(name: string | undefined): void {
  _currentProject = name
}

/**
 * Retourne le nom du projet courant, ou undefined si aucun projet sélectionné.
 */
export function getCurrentProject(): string | undefined {
  return _currentProject
}

// ── Intercom writer ──────────────────────────────────

const INTERCOM_DIR = join(process.cwd(), 'telecom', 'intercom')
const TRIGGER_FILE = join(process.cwd(), 'telecom', 'daemon.trigger')
const MAX_FILES = 10

function rotateDir(dir: string): void {
  if (!existsSync(dir)) return
  const files = readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .sort()
  while (files.length > MAX_FILES) {
    const oldest = files.shift()!
    unlinkSync(join(dir, oldest))
  }
}

function shortTimestamp(): string {
  const d = new Date()
  return d.getFullYear().toString() +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0') + 'T' +
    String(d.getHours()).padStart(2, '0') +
    String(d.getMinutes()).padStart(2, '0') +
    String(d.getSeconds()).padStart(2, '0')
}

function writeIntercomMessage(subject: string, userMessage: string, projectName?: string): void {
  const uuid = randomUUID()
  const payload: Record<string, string> = { demande: userMessage }
  if (projectName) {
    payload.project = projectName
  }
  const msg = {
    id: uuid,
    from: 'alice',
    to: 'agent-telecom',
    type: 'request' as const,
    subject,
    payload,
    timestamp: new Date().toISOString(),
    status: 'pending' as const,
  }

  if (!existsSync(INTERCOM_DIR)) {
    mkdirSync(INTERCOM_DIR, { recursive: true })
  }

  const shortId = uuid.slice(0, 4)
  const fileName = `${subject}-${shortTimestamp()}-${shortId}.json`
  writeFileSync(join(INTERCOM_DIR, fileName), JSON.stringify(msg, null, 2), 'utf-8')
  rotateDir(INTERCOM_DIR)

  // Signaler au daemon de traiter immédiatement (si en cours d'exécution)
  try {
    writeFileSync(TRIGGER_FILE, String(Date.now()), 'utf-8')
  } catch { /* daemon absent ou dossier verrouillé */ }
}

// ── Routeur ──────────────────────────────────────────

export interface RouteResult {
  subject: string
  response: string
}

/**
 * Analyse un message utilisateur et le route vers agent-telecom si un pattern match.
 *
 * @param userMessage - Le message utilisateur à analyser
 * @param projectName - Nom du projet (optionnel, utilise le projet courant si non fourni)
 * @returns RouteResult si un pattern a matché, null sinon.
 */
export function tryRouteIntercom(userMessage: string, projectName?: string): RouteResult | null {
  const project = projectName ?? _currentProject
  const lower = userMessage.toLowerCase()

  for (const pattern of getPatterns()) {
    let matchCount = 0
    for (const kw of pattern.keywords) {
      if (lower.includes(kw)) {
        matchCount++
      }
    }
    if (matchCount >= pattern.minMatch) {
      writeIntercomMessage(pattern.subject, userMessage, project)
      return { subject: pattern.subject, response: pattern.response }
    }
  }

  return null
}
