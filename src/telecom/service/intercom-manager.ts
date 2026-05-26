#!/usr/bin/env node
/**
 * intercom-manager.ts — Outil CLI pour gérer les messages intercom
 *
 * Usage:
 *   node dist/telecom/service/intercom-manager.js send <from> <to> <type> <subject> [--stdin | --payload <json>]
 *   node dist/telecom/service/intercom-manager.js read <agent-id>
 *   node dist/telecom/service/intercom-manager.js route <message-id>
 *   node dist/telecom/service/intercom-manager.js status
 *
 * Le format des messages suit telecom/templates/protocol.md
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const cwd = process.cwd()
const INTERCOM_DIR = join(cwd, 'telecom', 'intercom')
const ROUTED_DIR = join(cwd, 'telecom', 'routed')
const MAX_FILES = 3

/** Garder max 3 fichiers par dossier, supprimer les plus anciens */
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

interface IntercomMessage {
  id: string
  from: string
  to: string
  type: 'request' | 'response' | 'signal' | 'log' | 'alert'
  subject: string
  payload: Record<string, unknown>
  timestamp: string
  status: 'pending' | 'read' | 'processed' | 'archived'
}

function ensureDirs(): void {
  for (const dir of [INTERCOM_DIR, ROUTED_DIR]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }
}

function listMessages(agentId?: string): IntercomMessage[] {
  if (!existsSync(INTERCOM_DIR)) return []
  const files = readdirSync(INTERCOM_DIR).filter(f => f.endsWith('.json'))
  const messages: IntercomMessage[] = []

  for (const f of files) {
    try {
      const path = join(INTERCOM_DIR, f)
      const content = readFileSync(path, 'utf-8')
      const msg = JSON.parse(content) as IntercomMessage
      if (!agentId || msg.to === agentId || msg.from === agentId) {
        messages.push(msg)
      }
    } catch {
      // skip malformed files
    }
  }

  return messages.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}

function cmdSend(args: string[]): void {
  const [from, to, type, subject] = args

  if (!from || !to || !type || !subject) {
    console.error('Usage: intercom-manager send <from> <to> <type> <subject> [--stdin | --payload <json>]')
    console.error('')
    console.error('  --stdin         Lit le payload JSON depuis stdin (defaut si aucun flag)')
    console.error('  --payload <str> Passe le payload directement en argument (evite le pipe)')
    process.exit(1)
  }

  ensureDirs()

  // Detecter le mode de payload : --payload <json> ou --stdin (ou defaut stdin)
  const payloadIdx = args.indexOf('--payload')
  const usePayload = payloadIdx !== -1 && payloadIdx + 1 < args.length

  let payload: Record<string, unknown>

  if (usePayload) {
    // Payload passe directement en argument
    const raw = args[payloadIdx + 1]
    try {
      payload = JSON.parse(raw) as Record<string, unknown>
    } catch {
      payload = { demande: raw }
    }
  } else {
    // Lire le payload depuis stdin (comportement historique)
    const stdinRaw = readFileSync(0, 'utf-8').trim()
    try {
      payload = JSON.parse(stdinRaw) as Record<string, unknown>
    } catch {
      payload = { demande: stdinRaw }
    }
  }

  const uuid = randomUUID()
  const message: IntercomMessage = {
    id: uuid,
    from,
    to,
    type: type as IntercomMessage['type'],
    subject,
    payload,
    timestamp: new Date().toISOString(),
    status: 'pending',
  }

  const shortId = uuid.slice(0, 4)
  const fileName = `${subject}-${shortTimestamp()}-${shortId}.json`
  const filePath = join(INTERCOM_DIR, fileName)
  writeFileSync(filePath, JSON.stringify(message, null, 2), 'utf-8')

  // Rotation : garder max 3 fichiers
  rotateDir(INTERCOM_DIR)

  console.log(`OK: ${fileName} — ${from} → ${to} [${type}] ${subject}`)
}

function cmdRead(args: string[]): void {
  const agentId = args[0]

  if (!agentId) {
    console.error('Usage: intercom-manager read <agent-id>')
    process.exit(1)
  }

  const messages = listMessages(agentId)

  if (messages.length === 0) {
    console.log(`Aucun message pour ${agentId}.`)
    return
  }

  console.log(`Messages pour ${agentId} (${messages.length}) :`)
  console.log('')
  for (const msg of messages) {
    const status = msg.status === 'pending' ? '⏳' : msg.status === 'read' ? '📖' : '✅'
    console.log(`  ${status} [${msg.id.slice(0, 8)}] ${msg.from} → ${msg.to}`)
    console.log(`      Type: ${msg.type}  Subject: ${msg.subject}`)
    console.log(`      Payload: ${JSON.stringify(msg.payload).slice(0, 120)}`)
    console.log(`      ${msg.timestamp}`)
    console.log()
  }
}

function cmdRoute(args: string[]): void {
  const messageId = args[0]

  if (!messageId) {
    console.error('Usage: intercom-manager route <message-id>')
    console.error('       intercom-manager route all')
    process.exit(1)
  }

  ensureDirs()

  if (messageId === 'all') {
    const messages = listMessages()
    const pending = messages.filter(m => m.status === 'pending')
    if (pending.length === 0) {
      console.log('Aucun message en attente.')
      return
    }
    for (const msg of pending) {
      routeSingle(msg)
    }
    console.log(`${pending.length} message(s) routé(s).`)
    return
  }

  // Route by partial ID match
  const files = readdirSync(INTERCOM_DIR).filter(f => f.startsWith(messageId) && f.endsWith('.json'))
  if (files.length === 0) {
    console.error(`Message "${messageId}" introuvable.`)
    process.exit(1)
  }

  for (const f of files) {
    const path = join(INTERCOM_DIR, f)
    const content = readFileSync(path, 'utf-8')
    const msg = JSON.parse(content) as IntercomMessage
    routeSingle(msg)
  }
}

function routeSingle(msg: IntercomMessage): void {
  const srcPath = join(INTERCOM_DIR, `${msg.id}.json`)

  // Marquer comme lu
  msg.status = 'read'
  writeFileSync(srcPath, JSON.stringify(msg, null, 2), 'utf-8')

  // Copier vers le dossier routé
  const destPath = join(ROUTED_DIR, `${msg.id}.json`)
  writeFileSync(destPath, JSON.stringify(msg, null, 2), 'utf-8')

  console.log(`  Routé: ${msg.id.slice(0, 8)} ${msg.from} → ${msg.to} [${msg.subject}]`)
}

function cmdStatus(): void {
  ensureDirs()
  const messages = listMessages()
  const pending = messages.filter(m => m.status === 'pending')
  const read = messages.filter(m => m.status === 'read')

  const routedFiles = existsSync(ROUTED_DIR) ? readdirSync(ROUTED_DIR).filter(f => f.endsWith('.json')) : []

  console.log('=== État de l\'intercom ===')
  console.log('')
  console.log(`  Messages en attente : ${pending.length}`)
  console.log(`  Messages lus         : ${read.length}`)
  console.log(`  Messages routés      : ${routedFiles.length}`)
  console.log(`  Total dans intercom/ : ${messages.length}`)
  console.log('')
  if (pending.length > 0) {
    console.log('En attente:')
    for (const m of pending) {
      console.log(`  ⏳ [${m.id.slice(0, 8)}] ${m.from} → ${m.to} — ${m.subject}`)
    }
  }
}

function main(): void {
  const [command, ...args] = process.argv.slice(2)

  switch (command) {
    case 'send':
      cmdSend(args)
      break
    case 'read':
      cmdRead(args)
      break
    case 'route':
      cmdRoute(args)
      break
    case 'status':
      cmdStatus()
      break
    default:
      console.log('Usage: intercom-manager <command> [args...]')
      console.log('')
      console.log('Commandes:')
      console.log('  send <from> <to> <type> <subject> --stdin   Envoyer un message')
      console.log('  read <agent-id>                             Lire les messages')
      console.log('  route <message-id|all>                      Router un/les message(s)')
      console.log('  status                                      État de l\'intercom')
      process.exit(1)
  }
}

main()
