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
 * Patterns basés sur data/cahier-aides-alice/02-patterns/
 */

import { writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'

// ── Patterns ──────────────────────────────────────────

interface IntercomPattern {
  keywords: string[]
  /** Nombre minimum de mots-clés à matcher (2+ évite les faux positifs) */
  minMatch: number
  /** Subject du message intercom */
  subject: string
  /** Message affiché à l'utilisateur */
  response: string
}

const PATTERNS: IntercomPattern[] = [
  // P1 — Bug / erreur / crash
  {
    keywords: ['bug', 'erreur', 'crash', 'plante', 'plante', 'casse'],
    minMatch: 1,
    subject: 'debug-request',
    response: 'Je transmets ta demande de debug à agent-telecom.',
  },
  // P2 — Analyse / inspection
  {
    keywords: ['analyse', 'examine', 'vérifie', 'inspecte', 'diagnostic'],
    minMatch: 1,
    subject: 'analysis-request',
    response: 'Je transmets ta demande d\'analyse à agent-telecom.',
  },
  // P3 — Revue de code / qualité
  {
    keywords: ['review', 'revue', 'qualité', 'ameliorer', 'améliorer', 'relis'],
    minMatch: 1,
    subject: 'review-request',
    response: 'Je transmets ta demande de review à agent-telecom.',
  },
  // P4 — Création / développement
  {
    keywords: ['crée', 'créé', 'fais', 'développe', 'code', 'genere', 'génère', 'ecris', 'écris', 'implemente', 'implémente'],
    minMatch: 1,
    subject: 'create-request',
    response: 'Je transmets ta demande de création à agent-telecom.',
  },
  // P5 — Configuration / déploiement
  {
    keywords: ['configure', 'installe', 'déploie', 'deploie', 'setup', 'init'],
    minMatch: 1,
    subject: 'deploy-request',
    response: 'Je transmets ta demande de déploiement à agent-telecom.',
  },
  // P6 — Conseil / idée
  {
    keywords: ['idée', 'idee', 'suggestion', 'conseil', 'comment faire'],
    minMatch: 1,
    subject: 'advice-request',
    response: 'Je transmets ta demande de conseil à agent-telecom.',
  },
  // P7 — Aide urgente
  {
    keywords: ['aide', 'besoin', 'urgent', 'bloqué', 'bloque', 'coince', 'coincé'],
    minMatch: 1,
    subject: 'help-request',
    response: 'Je transmets ta demande d\'aide à agent-telecom.',
  },
  // P8 — Liste des agents (nécessite 2 mots-clés pour éviter les faux positifs)
  {
    keywords: ['liste', 'lister', 'agent', 'disponible', 'équipe', 'equipe', 'voir', 'catalogue', 'annuaire', 'qui'],
    minMatch: 2,
    subject: 'agent-list-request',
    response: 'Je te transmets la demande pour voir la liste des agents disponibles.',
  },
]

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

function writeIntercomMessage(subject: string, userMessage: string): void {
  const uuid = randomUUID()
  const msg = {
    id: uuid,
    from: 'alice',
    to: 'agent-telecom',
    type: 'request' as const,
    subject,
    payload: { demande: userMessage },
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
 * @returns RouteResult si un pattern a matché, null sinon.
 */
export function tryRouteIntercom(userMessage: string): RouteResult | null {
  const lower = userMessage.toLowerCase()

  for (const pattern of PATTERNS) {
    let matchCount = 0
    for (const kw of pattern.keywords) {
      if (lower.includes(kw)) {
        matchCount++
      }
    }
    if (matchCount >= pattern.minMatch) {
      writeIntercomMessage(pattern.subject, userMessage)
      return { subject: pattern.subject, response: pattern.response }
    }
  }

  return null
}
