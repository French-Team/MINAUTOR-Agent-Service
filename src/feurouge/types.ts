/**
 * Types partagés pour le système FeuRouge — permissions & isolation.
 */

export type PermissionLevel = 'admin' | 'restricted' | 'confined' | 'readonly'

/** Permissions statiques d'un agent (dans permissions.yaml ou AgentDefinition) */
export interface AgentPermission {
  id: string
  level: PermissionLevel
  /** Pour confined : quel workspace (projet) */
  workspace?: string
  allowedCommands?: string[]
  forbiddenCommands?: string[]
  allowedPaths?: string[]
  forbiddenPaths?: string[]
}

/** Défauts appliqués aux agents d'un niveau donné */
export interface PermissionDefaults {
  confined: {
    allowedCommands: string[]
    forbiddenCommands: string[]
    forbiddenPaths: string[]
  }
}

/** Structure complète du fichier permissions.yaml */
export interface PermissionConfig {
  version: number
  defaults?: PermissionDefaults
  agents: AgentPermission[]
}

/** Traçage runtime des agents (par PID, non persisté) */
export interface AgentRegistration {
  agentId: string
  pid: number
  workspace?: string
  level: PermissionLevel
}

// ── IPC Messages (entre le CLI et le daemon feurouge) ──

export interface FeuRougeCheckRequest {
  type: 'check_command'
  id: string
  agentId: string
  command: string
  cwd: string
}

export interface FeuRougeRegisterRequest {
  type: 'register_agent'
  id: string
  agentId: string
  pid: number
  workspace?: string
  level: PermissionLevel
}

export interface FeuRougeUnregisterRequest {
  type: 'unregister_agent'
  id: string
  pid: number
}

export interface FeuRougeEditRequest {
  type: 'edit_permissions'
  id: string
  agentId: string
  field: string
  value: unknown
}

export interface FeuRougeReloadRequest {
  type: 'reload'
  id: string
}

export interface FeuRougePingRequest {
  type: 'ping'
  id?: string
}

export type FeuRougeRequest =
  | FeuRougeCheckRequest
  | FeuRougeRegisterRequest
  | FeuRougeUnregisterRequest
  | FeuRougeEditRequest
  | FeuRougeReloadRequest
  | FeuRougePingRequest

export interface FeuRougeResponse {
  id?: string
  ok: boolean
  allowed?: boolean
  reason?: string
  error?: string
}
