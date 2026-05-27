/**
 * FeuRouge Client — Interface IPC avec le daemon feurouge.
 *
 * Utilisé par :
 * - engine-guardian.ts : vérifier les commandes avant exécution
 * - spawn-agent.ts / telecom-daemon.ts : enregistrer les agents
 * - cli-main.ts : éditer les permissions
 */

import { fork, ChildProcess } from 'child_process'
import { join } from 'path'
import { existsSync } from 'fs'
import type { FeuRougeRequest, FeuRougeResponse, PermissionLevel } from './types.js'

let clientInstance: FeuRougeClient | null = null

export class FeuRougeClient {
  private child: ChildProcess | null = null
  private pending = new Map<string, (res: FeuRougeResponse) => void>()
  private timeoutMs: number
  private ready = false

  constructor(timeoutMs = 5000) {
    this.timeoutMs = timeoutMs
  }

  /**
   * Démarre le daemon feurouge en arrière-plan.
   */
  start(): boolean {
    const daemonPath = join(import.meta.dirname, 'feurouge-daemon.js')
    if (!existsSync(daemonPath)) {
      console.warn(`[FeuRouge] Daemon introuvable: ${daemonPath}`)
      return false
    }

    try {
      this.child = fork(daemonPath, [], {
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      })

      this.child.on('message', (msg: FeuRougeResponse) => {
        const id = msg.id
        if (id && this.pending.has(id)) {
          this.pending.get(id)!(msg)
          this.pending.delete(id)
        }
      })

      this.child.on('exit', (code) => {
        console.warn(`[FeuRouge] Daemon arrêté (code: ${code})`)
        this.child = null
        this.ready = false
        // Rejeter toutes les requêtes en attente
        for (const [id, reject] of this.pending) {
          reject({ id, ok: false, error: 'Daemon arrêté' })
        }
        this.pending.clear()
      })

      // Attendre que le daemon soit prêt
      this.ready = true
      return true
    } catch (err) {
      console.error(`[FeuRouge] Échec démarrage daemon: ${(err as Error).message}`)
      return false
    }
  }

  /**
   * Arrête le daemon.
   */
  stop(): void {
    if (this.child) {
      this.child.kill('SIGTERM')
      this.child = null
      this.ready = false
    }
  }

  /**
   * Vérifie si le daemon est actif.
   */
  isAlive(): boolean {
    return this.child !== null && this.child.exitCode === null
  }

  /**
   * Envoie une requête IPC et attend la réponse.
   */
  private async send(msg: FeuRougeRequest): Promise<FeuRougeResponse> {
    return new Promise((resolve) => {
      if (!this.child || !this.ready) {
        resolve({ id: msg.id, ok: false, error: 'Daemon non disponible' })
        return
      }

      this.pending.set(msg.id!, resolve)
      this.child.send(msg)

      // Timeout de sécurité
      setTimeout(() => {
        if (this.pending.has(msg.id!)) {
          this.pending.delete(msg.id!)
          resolve({ id: msg.id, ok: true, allowed: true, reason: 'FeuRouge timeout — autorisé par défaut' })
        }
      }, this.timeoutMs)
    })
  }

  /**
   * Vérifie une commande avant exécution.
   */
  async checkCommand(
    agentId: string,
    command: string,
    cwd: string,
  ): Promise<{ allowed: boolean; reason?: string }> {
    if (!this.isAlive()) {
      return { allowed: true }
    }

    const response = await this.send({
      type: 'check_command',
      id: generateId(),
      agentId,
      command,
      cwd,
    })

    return {
      allowed: response.allowed ?? true,
      reason: response.reason,
    }
  }

  /**
   * Enregistre un agent (PID) dans le daemon.
   */
  async registerAgent(
    agentId: string,
    pid: number,
    level: PermissionLevel,
    workspace?: string,
  ): Promise<boolean> {
    if (!this.isAlive()) return false

    const response = await this.send({
      type: 'register_agent',
      id: generateId(),
      agentId,
      pid,
      level,
      workspace,
    })

    return response.ok
  }

  /**
   * Désenregistre un agent.
   */
  async unregisterAgent(pid: number): Promise<boolean> {
    if (!this.isAlive()) return false

    const response = await this.send({
      type: 'unregister_agent',
      id: generateId(),
      pid,
    })

    return response.ok
  }

  /**
   * Édite une permission dans le fichier YAML.
   */
  async editPermission(
    agentId: string,
    field: string,
    value: unknown,
  ): Promise<boolean> {
    if (!this.isAlive()) return false

    const response = await this.send({
      type: 'edit_permissions',
      id: generateId(),
      agentId,
      field,
      value,
    })

    return response.ok
  }

  /**
   * Accorde un accès temporaire à un agent confiné.
   */
  async grantTempAccess(
    agentId: string,
    grantType: 'path' | 'command',
    value: string,
    grantedBy: string,
    durationMinutes?: number,
    reason?: string,
  ): Promise<{ ok: boolean; message: string }> {
    if (!this.isAlive()) {
      return { ok: false, message: 'Daemon FeuRouge non disponible' }
    }

    const response = await this.send({
      type: 'grant_temp_access',
      id: generateId(),
      agentId,
      grantType,
      value,
      grantedBy,
      durationMinutes,
      reason,
    })

    if (response.ok) {
      const typeLabel = grantType === 'path' ? 'chemin' : 'commande'
      const durStr = durationMinutes
        ? durationMinutes >= 60
          ? `${(durationMinutes / 60).toFixed(1)}h`
          : `${durationMinutes}min`
        : '5min'
      return {
        ok: true,
        message: `Accès temporaire accordé à "${agentId}" : ${typeLabel} "${value}" pour ${durStr}${reason ? ` (${reason})` : ''}`,
      }
    }

    return {
      ok: false,
      message: response.error ?? 'Échec de l\'octroi de permission temporaire',
    }
  }

  /**
   * Recharge les permissions depuis le fichier YAML.
   */
  async reloadPermissions(): Promise<boolean> {
    if (!this.isAlive()) return false

    const response = await this.send({
      type: 'reload',
      id: generateId(),
    })

    return response.ok
  }
}

/**
 * Obtient ou crée l'instance singleton du client feurouge.
 */
export function getFeuRougeClient(): FeuRougeClient {
  if (!clientInstance) {
    clientInstance = new FeuRougeClient()
  }
  return clientInstance
}

/**
 * Réinitialise l'instance (pour les tests).
 */
export function resetFeuRougeClient(): void {
  if (clientInstance) {
    clientInstance.stop()
    clientInstance = null
  }
}

function generateId(): string {
  return `fr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}
