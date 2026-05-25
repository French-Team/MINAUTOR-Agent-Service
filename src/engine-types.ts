import type { AgentDefinition, Message } from './types/agent-definition.js'

export interface EngineConfig {
  agent: AgentDefinition
  cwd?: string
}

export interface Session {
  id: string
  messages: Message[]
  createdAt: Date
  output: Record<string, unknown> | undefined
}

export interface LLMProvider {
  provider: string
  apiKey: string
  baseUrl: string
  model: string
}
