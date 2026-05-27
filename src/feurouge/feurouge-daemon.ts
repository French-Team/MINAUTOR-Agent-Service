#!/usr/bin/env node
/**
 * DAEMON-feurouge-01 — Le "Feu Rouge" qui garde les agents dans leur périmètre.
 *
 * Fonctionnement :
 * 1. Lancé en arrière-plan par cli-main.ts (fork)
 * 2. Charge data/permissions/permissions.yaml
 * 3. Écoute les messages IPC : check_command, register_agent, etc.
 * 4. Répond en temps réel : ALLOWED / BLOCKED + raison
 *
 * Usage :
 *   node dist/feurouge/feurouge-daemon.js   (via fork depuis cli-main.ts)
 */

import { existsSync, writeFileSync, unlinkSync, mkdirSync } from 'fs'
import { join } from 'path'
import {
  loadPermissions,
  createDefaultPermissionsFile,
  registerAgent,
  unregisterAgent,
  checkCommand,
  editPermission,
  getPermissionsConfig,
  grantTempAccess,
} from './permissions.js'
import type {
  FeuRougeRequest,
  FeuRougeResponse,
  PermissionLevel,
} from './types.js'

const PID_FILE = join(process.cwd(), 'telecom', 'feurouge.pid')

// ── Initialisation ──────────────────────────────────────

function init(): void {
  // Créer le fichier de permissions par défaut si absent
  createDefaultPermissionsFile()

  // Charger les permissions
  const loaded = loadPermissions()
  if (loaded) {
    console.log(`[FeuRouge] Permissions chargées: ${getPermissionsConfig()?.agents.length ?? 0} agents`)
  } else {
    console.log(`[FeuRouge] Aucune permissions.yaml trouvée — mode permissif`)
  }

  // Écrire le PID
  const pidDir = join(process.cwd(), 'telecom')
  if (!existsSync(pidDir)) {
    mkdirSync(pidDir, { recursive: true })
  }
  writeFileSync(PID_FILE, String(process.pid), 'utf-8')
  console.log(`[FeuRouge] Daemon démarré (PID: ${process.pid})`)
}

// ── Gestionnaire IPC ────────────────────────────────────

function handleMessage(msg: FeuRougeRequest): FeuRougeResponse | null {
  switch (msg.type) {
    case 'ping':
      return { id: msg.id, ok: true }

    case 'check_command':
      if (!msg.agentId || msg.command === undefined) {
        return { id: msg.id, ok: false, error: 'Paramètres manquants: agentId, command' }
      }
      const result = checkCommand(msg.agentId, msg.command, msg.cwd ?? process.cwd())
      return {
        id: msg.id,
        ok: true,
        allowed: result.allowed,
        reason: result.reason,
      }

    case 'register_agent':
      if (!msg.agentId || msg.pid === undefined) {
        return { id: msg.id, ok: false, error: 'Paramètres manquants: agentId, pid' }
      }
      registerAgent(
        msg.agentId,
        msg.pid,
        (msg.level ?? 'confined') as PermissionLevel,
        msg.workspace,
      )
      const ws = msg.workspace ? ` → ${msg.workspace}` : ''
      console.log(`[FeuRouge] Agent enregistré: ${msg.agentId} (PID: ${msg.pid})${ws} [${msg.level ?? 'confined'}]`)
      return { id: msg.id, ok: true }

    case 'unregister_agent':
      if (msg.pid === undefined) {
        return { id: msg.id, ok: false, error: 'Paramètre manquant: pid' }
      }
      unregisterAgent(msg.pid)
      return { id: msg.id, ok: true }

    case 'edit_permissions':
      if (!msg.agentId || !msg.field) {
        return { id: msg.id, ok: false, error: 'Paramètres manquants: agentId, field' }
      }
      const edited = editPermission(msg.agentId, msg.field, msg.value)
      if (edited) {
        console.log(`[FeuRouge] Permission modifiée: ${msg.agentId}.${msg.field} = ${JSON.stringify(msg.value)}`)
        return { id: msg.id, ok: true }
      }
      return { id: msg.id, ok: false, error: `Impossible de modifier ${msg.agentId}.${msg.field}` }

    case 'grant_temp_access':
      if (!msg.agentId || !msg.grantType || !msg.value || !msg.grantedBy) {
        return { id: msg.id, ok: false, error: 'Paramètres manquants: agentId, grantType, value, grantedBy' }
      }
      const grantResult = grantTempAccess(
        msg.agentId,
        msg.grantType,
        msg.value,
        msg.grantedBy,
        msg.durationMinutes ?? 5,
        msg.reason,
      )
      if (grantResult.ok) {
        console.log(`[FeuRouge] Grant temporaire: ${grantResult.message}`)
        return { id: msg.id, ok: true }
      }
      return { id: msg.id, ok: false, error: 'Échec de l\'octroi de permission temporaire' }

    case 'reload':
      const reloaded = loadPermissions()
      if (reloaded) {
        console.log(`[FeuRouge] Permissions rechargées (${getPermissionsConfig()?.agents.length ?? 0} agents)`)
        return { id: msg.id, ok: true }
      }
      return { id: msg.id, ok: false, error: 'Échec du rechargement permissions.yaml' }

    default:
      return { id: (msg as FeuRougeRequest).id, ok: false, error: `Type de message inconnu: ${(msg as FeuRougeRequest).type}` }
  }
}

// ── Point d'entrée ──────────────────────────────────────

// Ne démarrer que si exécuté directement
const isMainModule = process.argv[1]?.replace(/\\/g, '/').endsWith('feurouge-daemon.js')

if (isMainModule) {
  init()

  // Écouter les messages IPC du parent
  process.on('message', (msg: FeuRougeRequest) => {
    const response = handleMessage(msg)
    if (response && process.send) {
      process.send(response)
    }
  })

  // Nettoyage à l'arrêt
  process.on('SIGTERM', () => {
    console.log('[FeuRouge] Arrêt (SIGTERM)')
    if (existsSync(PID_FILE)) unlinkSync(PID_FILE)
    process.exit(0)
  })

  process.on('SIGINT', () => {
    console.log('[FeuRouge] Arrêt (SIGINT)')
    if (existsSync(PID_FILE)) unlinkSync(PID_FILE)
    process.exit(0)
  })

  // Garder le processus en vie
  setInterval(() => {
    // Heartbeat silencieux — le daemon reste actif
  }, 30000).unref()

  console.log('[FeuRouge] Prêt — en attente de requêtes IPC')
}
