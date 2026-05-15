# Hermes Agent Engine

A lightweight agent engine inspired by Codebuff, designed to work with the Hermes control system. Provides a TypeScript framework for defining and running AI agents with terminal command execution, session management, and tmux integration.

## Features

- **AgentDefinition** — Define agents with ID, name, model, instructions, and tool sets
- **Session Handling** — Create, manage, and persist agent sessions with full message history
- **Terminal Execution** — Run shell commands synchronously with `runTerminalCommand`
- **Message Management** — Add and track messages with `addMessage`
- **Output Tracking** — Set and retrieve agent outputs with `setOutput`
- **Tmux Wrapper** — Create, send commands to, capture, and kill tmux sessions (Unix only)

## Installation

```bash
cd my-agent-engine
npm install
npm run build
```

## Usage

### Basic Agent

```typescript
import { createEngine } from './src/engine.js'
import type { AgentDefinition } from './types/agent-definition.js'

const agent: AgentDefinition = {
  id: 'my-agent',
  name: 'My Agent',
  model: 'google/gemini-2.5-flash',
  instructionsPrompt: 'You are a helpful coding assistant.',
  toolNames: ['run_terminal_command', 'add_message', 'set_output'],
}

const engine = createEngine({ agent })
engine.createSession()

// Run a terminal command
const output = engine.runTerminalCommand('git diff')
console.log(output)

// Add messages
engine.addMessage('user', 'Review the changes')
engine.addMessage('assistant', 'Here is my review...')

// Set output
engine.setOutput({ summary: 'Changes look good' })
```

### Running

```bash
npm run build
node dist/engine.js
```

### Tmux Sessions (Unix only)

```typescript
import { createTmuxSession, sendTmuxCommand, captureTmuxPane } from './src/tmux.js'

// Create a session
createTmuxSession('dev-session')

// Send a command
sendTmuxCommand('dev-session', 'npm run dev')

// Capture output
const output = captureTmuxPane('dev-session')
console.log(output)
```

### Custom Agent Definition

Create your own agent by defining an `AgentDefinition`:

```typescript
const gitCommitter: AgentDefinition = {
  id: 'git-committer',
  name: 'Git Committer',
  model: 'anthropic/claude-sonnet-4.6',
  toolNames: ['run_terminal_command', 'add_message', 'end_turn'],
  instructionsPrompt: 'Analyze git diff and create meaningful commits.',
}
```

## API Reference

### Engine (`src/engine.ts`)

| Method | Description |
|--------|-------------|
| `createEngine(config)` | Creates a new engine instance |
| `runTerminalCommand(cmd, type?, timeout?)` | Executes a shell command |
| `addMessage(role, content)` | Adds a message to the session |
| `setOutput(output)` | Sets the session output |
| `createSession()` | Creates a new session |
| `getCurrentSession()` | Gets the current session |
| `getSession(id)` | Gets a session by ID |
| `listSessions()` | Lists all sessions |

### Tmux (`src/tmux.ts`)

| Method | Description |
|--------|-------------|
| `createTmuxSession(name)` | Creates a new tmux session |
| `sendTmuxCommand(name, cmd)` | Sends a command to a tmux session |
| `captureTmuxPane(name)` | Captures pane output |
| `killTmuxSession(name)` | Kills a tmux session |
| `listTmuxSessions()` | Lists all tmux sessions |
