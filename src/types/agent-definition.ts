import type { AgentPermission as AgentPermissionDef } from '../feurouge/types.js'

export interface AgentDefinition {
  id: string
  name?: string
  displayName: string
  model: string
  provider?: string  // Optional: stores the provider type (kilo, lm-studio, ollama, etc.)
  instructionsPrompt: string
  toolNames: string[]
  spawnerPrompt?: string
  spawnableAgents?: string[]
  handleSteps?: (context: AgentStepContext) => Generator<ToolCall | 'STEP' | 'STEP_ALL', void, unknown>
  
  // New configurations
  selfCorrection?: SelfCorrection
  guardian?: Guardian
  healthCheck?: DaemonHealth
  streaming?: Streaming
  rateLimit?: RateLimit
  toolConfig?: ToolConfig
  
  // Permissions (FeuRouge)
  permissions?: AgentPermissionDef

  // Backward compatibility for daemon
  daemonConfig?: {
    defaultIntervalMs: number
    defaultNotificationMessage: string
  }
}

export interface SelfCorrection {
  enabled: boolean
  retryOnFailure: boolean
  maxRetries: number
  validateOutput: boolean
}

export interface Guardian {
  enabled: boolean
  blockHarmful: boolean
  requireConfirmation: boolean
  auditTrail: boolean
  blockedPatterns?: string[]
}

export interface DaemonHealth {
  enabled: boolean
  checkIntervalMs: number
  maxConsecutiveFailures: number
  autoRestart: boolean
  maxRestarts: number
}

export interface Streaming {
  enabled: boolean
  chunkSize: number
  showThinking: boolean
}

export interface RateLimit {
  enabled: boolean
  requestsPerMinute: number
  burst: number
  backoffMultiplier: number
}

/**
 * Profil de compression du contexte pour le pipeline telecom-context.
 * Source de vérité : `src/telecom/service/context/model-profiles.ts` (PROFILES).
 *
 * - tiny   : ≤1.5B params (LFM2.5-1.2B). Compression agressive.
 * - small  : 1.5–4B (Llama3.2-3B, Phi-3-mini). Compression marquée.
 * - medium : 4–15B (Llama3-8B, Mistral-7B). Défaut sain.
 * - large  : 15B–70B / cloud puissant (GPT-4, Claude Sonnet, Gemini Flash).
 * - huge   : long-context (Gemini 2.5 1M, Claude 200k+). Compression minimale.
 */
export type ContextProfile = 'tiny' | 'small' | 'medium' | 'large' | 'huge'

export interface ToolConfig {
  parallelTools: boolean
  toolTimeoutMs: number
  maxParallel: number
  /**
   * Override du profil de compression de contexte (optionnel).
   * Si absent, le profil est résolu automatiquement à partir du nom du modèle.
   * Utile par exemple pour forcer 'tiny' sur un daemon qui doit toujours être léger
   * indépendamment du modèle configuré.
   */
  contextProfile?: ContextProfile
}

export interface AgentState {
  agentId: string
  runId: string
  parentId: string | undefined
  messageHistory: Message[]
  output: Record<string, unknown> | undefined
  systemPrompt: string
  toolDefinitions: Record<string, { description: string | undefined; inputSchema: Record<string, unknown> }>
}

export interface AgentStepContext {
  agentState: AgentState
  prompt?: string
  params?: Record<string, unknown>
}

export interface ToolCall {
  toolName: string
  input: Record<string, unknown>
  includeToolCall?: boolean
}

export type TextPart = { type: 'text'; text: string }
export type ToolCallPart = { type: 'tool-call'; toolCallId: string; toolName: string; input: Record<string, unknown> }
export type ToolResultPart = { type: 'tool-result'; toolCallId: string; toolName: string; content: string }

export type Message =
  | { role: 'system'; content: TextPart[] }
  | { role: 'user'; content: (TextPart)[] }
  | { role: 'assistant'; content: (TextPart | ToolCallPart)[] }
  | { role: 'tool'; toolCallId: string; toolName: string; content: ToolResultPart[] }
