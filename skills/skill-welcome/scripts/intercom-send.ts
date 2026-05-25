#!/usr/bin/env node
/**
 * intercom-send.ts — Envoie un message via intercom a agent-telecom
 *
 * Usage: npx tsx skills/skill-welcome/scripts/intercom-send.ts <subject> [message]
 *
 * Ecrit un fichier JSON dans telecom/intercom/<uuid>.json
 * au format du protocole telecom (telecom/templates/protocol.md).
 *
 * Subjects disponibles:
 *   debug-request       — Demande de debug (bug, erreur, plante)
 *   analysis-request    — Demande d'analyse (examine, verifie)
 *   review-request      — Demande de revue (review, qualite)
 *   create-request      — Demande de creation (cree, developpe)
 *   deploy-request      — Demande de deploiement (configure, installe)
 *   advice-request      — Demande de conseil (idee, suggestion)
 *   help-request        — Demande d'aide (aide, urgent)
 *   agent-list-request  — Demande de lister les agents
 *
 * Exemples:
 *   npx tsx skills/skill-welcome/scripts/intercom-send.ts debug-request "La fonction login plante"
 *   npx tsx skills/skill-welcome/scripts/intercom-send.ts agent-list-request "Je veux voir les agents"
 */

import { writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const cwd = process.cwd()
const INTERCOM_DIR = join(cwd, 'telecom', 'intercom')
const FROM = 'alice'
const TO = 'agent-telecom'
const TYPE = 'request'
const MAX_FILES = 3

/** Nettoyer les fichiers les plus anciens si > MAX_FILES */
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

/** Generer un timestamp compact lisible : 20260521T103054 */
function shortTimestamp(): string {
  const d = new Date()
  return d.getFullYear().toString() +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0') + 'T' +
    String(d.getHours()).padStart(2, '0') +
    String(d.getMinutes()).padStart(2, '0') +
    String(d.getSeconds()).padStart(2, '0')
}

const VALID_SUBJECTS = [
  'debug-request',
  'analysis-request',
  'review-request',
  'create-request',
  'deploy-request',
  'advice-request',
  'help-request',
  'agent-list-request',
] as const

type Subject = typeof VALID_SUBJECTS[number]

interface IntercomMessage {
  id: string
  from: string
  to: string
  type: string
  subject: string
  payload: Record<string, unknown>
  timestamp: string
  status: 'pending' | 'read' | 'processed' | 'archived'
}

function main(): void {
  const subject = process.argv[2]
  const userMessage = process.argv.slice(3).join(' ')

  // Help
  if (!subject || subject === '--help' || subject === '-h') {
    console.log('Usage: npx tsx skills/skill-welcome/scripts/intercom-send.ts <subject> [message]')
    console.log('')
    console.log('Subjects disponibles:')
    for (const s of VALID_SUBJECTS) {
      console.log(`  ${s}`)
    }
    console.log('')
    console.log('Exemple:')
    console.log('  intercom-send debug-request "La fonction login plante"')
    process.exit(0)
  }

  // Validate subject
  if (!VALID_SUBJECTS.includes(subject as Subject)) {
    console.error(`ERR: Subject invalide: "${subject}"`)
    console.error('')
    console.error('Subjects valides:')
    for (const s of VALID_SUBJECTS) {
      console.error(`  ${s}`)
    }
    process.exit(1)
  }

  // Build payload
  let payload: Record<string, unknown>
  if (!userMessage) {
    payload = { demande: '(demande sans details)' }
  } else {
    // Try to parse as JSON (for advanced usage with structured payloads)
    try {
      payload = JSON.parse(userMessage) as Record<string, unknown>
    } catch {
      // Plain text message
      payload = { demande: userMessage }
    }
  }

  // Generate message
  const uuid = randomUUID()
  const message: IntercomMessage = {
    id: uuid,
    from: FROM,
    to: TO,
    type: TYPE,
    subject,
    payload,
    timestamp: new Date().toISOString(),
    status: 'pending',
  }

  // Write to intercom directory
  if (!existsSync(INTERCOM_DIR)) {
    mkdirSync(INTERCOM_DIR, { recursive: true })
  }

  const shortId = uuid.slice(0, 4)
  const fileName = `${subject}-${shortTimestamp()}-${shortId}.json`
  const filePath = join(INTERCOM_DIR, fileName)
  writeFileSync(filePath, JSON.stringify(message, null, 2), 'utf-8')

  // Rotation : garder max 3 fichiers
  rotateDir(INTERCOM_DIR)

  console.log(`OK: Message envoye a ${TO}`)
  console.log(`    Subject: ${subject}`)
  console.log(`    Fichier: ${fileName}`)
  console.log(`    Payload: ${JSON.stringify(payload)}`)
}

main()
