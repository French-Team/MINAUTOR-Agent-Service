export type ToolName =
  | 'run_terminal_command'
  | 'add_message'
  | 'set_output'
  | 'read_files'
  | 'write_file'
  | 'spawn_agents'
  | 'end_turn'

export interface ToolParamsMap {
  run_terminal_command: RunTerminalCommandParams
  add_message: AddMessageParams
  set_output: SetOutputParams
  read_files: ReadFilesParams
  write_file: WriteFileParams
  spawn_agents: SpawnAgentsParams
  end_turn: EndTurnParams
}

export interface RunTerminalCommandParams {
  command: string
  process_type?: 'SYNC' | 'BACKGROUND'
  cwd?: string
  timeout_seconds?: number
}

export interface AddMessageParams {
  role: 'user' | 'assistant'
  content: string
}

export interface SetOutputParams {
  output: Record<string, unknown>
}

export interface ReadFilesParams {
  paths: string[]
}

export interface WriteFileParams {
  path: string
  content: string
  instructions?: string
}

export interface SpawnAgentsParams {
  agents: {
    agent_type: string
    prompt?: string
    params?: Record<string, unknown>
  }[]
}

export interface EndTurnParams {
  message?: string
}

export type GetToolParams<T extends ToolName> = ToolParamsMap[T]
