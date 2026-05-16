export interface AgentDefinition {
  id: string
  name?: string
  displayName: string
  model: string
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

export interface ToolConfig {
  parallelTools: boolean
  toolTimeoutMs: number
  maxParallel: number
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
