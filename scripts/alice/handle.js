#!/usr/bin/env node
/**
 * scripts/alice/handle.js — Dispatcher unique pour Alice
 *
 * Lit le message utilisateur depuis telecom/alice-input.txt (écrit par le CLI
 * avant d'appeler le LLM) ou depuis l'argument si fourni.
 *
 * Alice n'a qu'une instruction : run_terminal_command("node scripts/alice/handle.js")
 * — pas de substitution, pas de paramètre à passer.
 *
 * Usage:
 *   node scripts/alice/handle.js                # lit depuis telecom/alice-input.txt
 *   node scripts/alice/handle.js "bonjour"       # ou en argument direct (test)
 *   node scripts/alice/handle.js --json         # mode JSON
 *
 * Return codes:
 *   0 — Pattern matché, réponse affichée
 *   0 — Aucun pattern (fallback aussi exit 0 — pas d'erreur)
 */

import { execSync } from 'child_process'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { CYAN, GRAY, RESET } from './colors.js'

const CWD = process.cwd()
const INPUT_FILE = join(CWD, 'telecom', 'alice-input.txt')
const PATTERNS_PATH = join(CWD, 'data', 'cahier-aides-alice', 'intercom-patterns.json')

// ── Sous-scripts ─────────────────────────────────────

function runScript(scriptPath) {
  try {
    return execSync(`node ${scriptPath}`, {
      cwd: CWD,
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch (err) {
    return null
  }
}

function runIntercom(message) {
  try {
    return execSync(`node scripts/alice/intercom.js "${message.replace(/"/g, '\\"')}"`, {
      cwd: CWD,
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch {
    return null
  }
}

// ── Greetings (hardcoded pour fiabilité) ─────────────

function isGreetingWithName(text) {
  return /^(bonjour|salut|hello|bonsoir|coucou)\s+(alice|mon\s*coeur|toi)/i.test(text)
}

function isSimpleGreeting(text) {
  return /^(bonjour|salut|hello|bonsoir|coucou|salutation)/i.test(text)
}

function isDecouverte(text) {
  return /^(decouverte|explore|explorer|découverte|structure|projet\s*complet)/i.test(text)
}

function presentationProjetResponse() {
  return runScript('scripts/alice/presentation-minautor.js') ?? 'Bienvenue sur Minautor Agents Service !'
}

function presentationAliceResponse() {
  return runScript('scripts/alice/presentation.js') ?? 'Bonjour ! Je suis Alice, votre assistante.'
}

function decouverteResponse() {
  return runScript('scripts/alice/decouverte.js') ?? 'Analyse du projet indisponible.'
}

// ── Intercom patterns ────────────────────────────────

function loadPatterns() {
  if (!existsSync(PATTERNS_PATH)) return []
  try {
    const raw = readFileSync(PATTERNS_PATH, 'utf-8')
    return JSON.parse(raw).patterns || []
  } catch {
    return []
  }
}

function matchPattern(message, patterns) {
  const lower = message.toLowerCase()

  for (const pattern of patterns) {
    let matchCount = 0
    for (const kw of pattern.keywords) {
      if (lower.includes(kw)) matchCount++
    }
    if (matchCount >= (pattern.minMatch || 1)) {
      return pattern
    }
  }

  return null
}

// ── Main ─────────────────────────────────────────────

function readUserMessage(args) {
  // Priorité 1 : argument en ligne de commande
  const messageArgs = args.filter(a => a !== '--json')
  const fromArg = messageArgs.join(' ').trim()
  if (fromArg) return fromArg

  // Priorité 2 : fichier telecom/alice-input.txt (écrit par le CLI avant l'appel LLM)
  try {
    if (existsSync(INPUT_FILE)) {
      const content = readFileSync(INPUT_FILE, 'utf-8').trim()
      if (content) return content
    }
  } catch { /* fichier inaccessible */ }

  return ''
}

function main() {
  const args = process.argv.slice(2)
  const jsonMode = args.includes('--json')

  const userMessage = readUserMessage(args)
  const ts = new Date().toISOString().slice(11, 19) // HH:MM:SS

  if (!userMessage) {
    if (jsonMode) {
      console.log(JSON.stringify({ matched: false, type: 'fallback', response: 'Bonjour !' }))
    } else {
      console.log(`${GRAY}[${ts}]${RESET} handle.js: ${CYAN}Bonjour !${RESET}`)
    }
    process.exit(0)
  }

  // ── Cascade de matching ──────────────────────────

  // 1. Greeting with name → présentation d'Alice
  if (isGreetingWithName(userMessage)) {
    const response = presentationAliceResponse()
    if (jsonMode) {
      console.log(JSON.stringify({ matched: true, type: 'presentation-alice', response }))
    } else {
      console.log(`${GRAY}[${ts}]${RESET} handle.js:\n${response}`)
    }
    process.exit(0)
  }

  // 2. Simple greeting → présentation du projet
  if (isSimpleGreeting(userMessage)) {
    const response = presentationProjetResponse()
    if (jsonMode) {
      console.log(JSON.stringify({ matched: true, type: 'presentation-projet', response }))
    } else {
      console.log(`${GRAY}[${ts}]${RESET} handle.js:\n${response}`)
    }
    process.exit(0)
  }

  // 3. Decouverte → exploration complète du projet
  if (isDecouverte(userMessage)) {
    const response = decouverteResponse()
    if (jsonMode) {
      console.log(JSON.stringify({ matched: true, type: 'decouverte', response }))
    } else {
      console.log(`${GRAY}[${ts}]${RESET} handle.js:\n${response}`)
    }
    process.exit(0)
  }

  // 4. Intercom patterns → délègue à intercom.js
  const patterns = loadPatterns()
  const matched = matchPattern(userMessage, patterns)

  if (matched) {
    const response = runIntercom(userMessage)
    const fallback = 'Je transmets ta demande au service compétent.'

    if (jsonMode) {
      console.log(JSON.stringify({
        matched: true,
        type: 'intercom',
        subject: matched.subject,
        response: response || fallback,
      }))
    } else {
      console.log(`${CYAN}${response || fallback}${RESET}`)
    }
    process.exit(0)
  }

  // 5. Fallback
  if (jsonMode) {
    console.log(JSON.stringify({
      matched: false,
      type: 'fallback',
      response: 'Je transmets ta demande au service compétent.',
    }))
  } else {
    console.log(`${CYAN}Je transmets ta demande au service compétent.${RESET}`)
  }

  process.exit(0)
}

main()
