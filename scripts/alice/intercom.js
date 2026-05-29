#!/usr/bin/env node
/**
 * scripts/alice/intercom.js — Intercom d'Alice
 *
 * Détecte l'intention de l'utilisateur via les patterns dans
 * data/cahier-aides-alice/intercom-patterns.json et écrit dans intercom.
 *
 * Usage:
 *   node scripts/alice/intercom.js "<message_utilisateur>"
 *   node scripts/alice/intercom.js --json "<message_utilisateur>"
 *
 * Return codes:
 *   0 — Pattern matché, message écrit dans intercom
 *   1 — Aucun pattern matché
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'

// ── Chemins ──────────────────────────────────────────

const CWD = process.cwd()
const PATTERNS_PATH = join(CWD, 'data', 'cahier-aides-alice', 'intercom-patterns.json')
const INTERCOM_DIR = join(CWD, 'telecom', 'intercom')
const TRIGGER_FILE = join(CWD, 'telecom', 'daemon.trigger')
const MAX_FILES = 10

// ── Utilitaires ─────────────────────────────────────

function shortTimestamp() {
  const d = new Date()
  return d.getFullYear().toString() +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0') + 'T' +
    String(d.getHours()).padStart(2, '0') +
    String(d.getMinutes()).padStart(2, '0') +
    String(d.getSeconds()).padStart(2, '0')
}

function rotateDir(dir) {
  if (!existsSync(dir)) return
  const files = readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .sort()
  while (files.length > MAX_FILES) {
    const oldest = files.shift()
    unlinkSync(join(dir, oldest))
  }
}

function writeIntercomMessage(subject, userMessage) {
  const uuid = randomUUID()
  const msg = {
    id: uuid,
    from: 'alice',
    to: 'orchestrateur',
    type: 'request',
    subject,
    payload: { demande: userMessage },
    timestamp: new Date().toISOString(),
    status: 'pending',
  }

  if (!existsSync(INTERCOM_DIR)) {
    mkdirSync(INTERCOM_DIR, { recursive: true })
  }

  const shortId = uuid.slice(0, 4)
  const fileName = `${subject}-${shortTimestamp()}-${shortId}.json`
  writeFileSync(join(INTERCOM_DIR, fileName), JSON.stringify(msg, null, 2), 'utf-8')
  rotateDir(INTERCOM_DIR)

  // Signaler au daemon
  try {
    writeFileSync(TRIGGER_FILE, String(Date.now()), 'utf-8')
  } catch { /* daemon absent */ }
}

// ── Chargement des patterns ────────────────────────

function loadPatterns() {
  if (!existsSync(PATTERNS_PATH)) {
    console.error(`[Intercom] Fichier patterns introuvable: ${PATTERNS_PATH}`)
    return []
  }
  try {
    const raw = readFileSync(PATTERNS_PATH, 'utf-8')
    const data = JSON.parse(raw)
    return data.patterns || []
  } catch (err) {
    console.error(`[Intercom] Erreur lecture patterns: ${err.message}`)
    return []
  }
}

// ── Matching ────────────────────────────────────────

function matchPattern(message, patterns) {
  const lower = message.toLowerCase()

  for (const pattern of patterns) {
    let matchCount = 0
    for (const kw of pattern.keywords) {
      if (lower.includes(kw)) {
        matchCount++
      }
    }
    if (matchCount >= pattern.minMatch) {
      return pattern
    }
  }

  return null
}

// ── Main ────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2)
  const jsonMode = args.includes('--json')
  const messageArgs = args.filter(a => a !== '--json')

  let userMessage = messageArgs.join(' ').trim()

  // Si stdin non vide, lire depuis stdin
  if (!userMessage && !process.stdin.isTTY) {
    const chunks = []
    const decoder = new TextDecoder()
    let bytes
    while ((bytes = process.stdin.read()) !== null) {
      chunks.push(decoder.decode(bytes, { stream: true }))
    }
    userMessage = chunks.join('').trim()
  }

  if (!userMessage) {
    if (jsonMode) {
      console.log(JSON.stringify({ matched: false, error: 'Aucun message fourni' }))
    } else {
      console.log('[Intercom] Usage: node scripts/alice/intercom.js "<message>"')
      console.log('[Intercom]        node scripts/alice/intercom.js --json "<message>"')
    }
    process.exit(1)
  }

  const patterns = loadPatterns()
  if (patterns.length === 0) {
    if (jsonMode) {
      console.log(JSON.stringify({ matched: false, error: 'Aucun pattern chargé' }))
    } else {
      console.log('[Intercom] Aucun pattern chargé — vérifie data/cahier-aides-alice/intercom-patterns.json')
    }
    process.exit(1)
  }

  const matched = matchPattern(userMessage, patterns)

  if (!matched) {
    if (jsonMode) {
      console.log(JSON.stringify({ matched: false }))
    } else {
      console.log('')
    }
    process.exit(1)
  }

  // Pattern matché → écrire le message intercom
  writeIntercomMessage(matched.subject, userMessage)

  if (jsonMode) {
    console.log(JSON.stringify({
      matched: true,
      subject: matched.subject,
      response: matched.response,
      patternId: matched.id,
      patternName: matched.name,
    }))
  } else {
    console.log(matched.response)
  }

  process.exit(0)
}

main()
