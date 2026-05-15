import { execSync } from 'child_process'

const isWindows = process.platform === 'win32'

function detectTmux(): boolean {
  if (isWindows) return false
  try {
    execSync('which tmux', { encoding: 'utf-8', stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function assertTmuxAvailable(): void {
  if (isWindows) {
    throw new Error('tmux is not available on Windows. Use WSL or a terminal multiplexer for Windows.')
  }
  if (!detectTmux()) {
    throw new Error('tmux is not installed. Install it with: apt install tmux  or  brew install tmux')
  }
}

export function createTmuxSession(sessionName: string): string {
  assertTmuxAvailable()
  try {
    execSync(`tmux new-session -d -s "${sessionName}"`, { encoding: 'utf-8' })
    return `Created tmux session: ${sessionName}`
  } catch (err: unknown) {
    const error = err as { stderr?: Buffer; message?: string }
    const msg = error.stderr?.toString() || error.message || 'Unknown error'
    if (msg.includes('already exists')) {
      return `Session "${sessionName}" already exists`
    }
    throw new Error(`Failed to create tmux session: ${msg}`)
  }
}

export function sendTmuxCommand(sessionName: string, command: string): string {
  assertTmuxAvailable()
  try {
    execSync(`tmux send-keys -t "${sessionName}" "${command}" Enter`, { encoding: 'utf-8' })
    return `Sent command to session "${sessionName}": ${command}`
  } catch (err: unknown) {
    const error = err as { stderr?: Buffer; message?: string }
    const msg = error.stderr?.toString() || error.message || 'Unknown error'
    throw new Error(`Failed to send command to tmux session: ${msg}`)
  }
}

export function captureTmuxPane(sessionName: string): string {
  assertTmuxAvailable()
  try {
    const output = execSync(`tmux capture-pane -t "${sessionName}" -p`, { encoding: 'utf-8' })
    return output.trim()
  } catch (err: unknown) {
    const error = err as { stderr?: Buffer; message?: string }
    const msg = error.stderr?.toString() || error.message || 'Unknown error'
    throw new Error(`Failed to capture tmux pane: ${msg}`)
  }
}

export function killTmuxSession(sessionName: string): string {
  assertTmuxAvailable()
  try {
    execSync(`tmux kill-session -t "${sessionName}"`, { encoding: 'utf-8', stdio: 'ignore' })
    return `Killed tmux session: ${sessionName}`
  } catch (err: unknown) {
    const error = err as { stderr?: Buffer; message?: string }
    const msg = error.stderr?.toString() || error.message || 'Unknown error'
    if (msg.includes('no session')) {
      return `Session "${sessionName}" does not exist`
    }
    throw new Error(`Failed to kill tmux session: ${msg}`)
  }
}

export function listTmuxSessions(): string[] {
  assertTmuxAvailable()
  try {
    const output = execSync('tmux list-sessions -F "#{session_name}"', { encoding: 'utf-8' })
    return output.trim().split('\n').filter(Boolean)
  } catch (err: unknown) {
    const error = err as { stderr?: Buffer; message?: string }
    const msg = error.stderr?.toString() || error.message || 'Unknown error'
    if (msg.includes('no server running') || msg.includes('no session')) {
      return []
    }
    throw new Error(`Failed to list tmux sessions: ${msg}`)
  }
}

export { isWindows as tmuxNotAvailable }
