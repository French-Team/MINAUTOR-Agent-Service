# Minautor Agent Service

A multi-agent orchestration framework for TypeScript/Node.js, inspired by Codebuff. Provides a complete system for defining, managing, and running AI agents with LLM integration, session handling, tool execution, and PACO-based orchestration.

## Features

- **Multi-Agent Orchestration** — Define and run specialized agents with PACO protocol (delegation-based governance)
- **LLM Integration** — Support for Kilo Gateway, Google Gemini, OpenRouter, Opencode Zen, Ollama, LM Studio, and custom providers
- **Tool Execution** — Run terminal commands, manage messages, set outputs, invoke skills
- **Session Management** — Full message history, persistent sessions, multi-session support
- **Advanced Engine** — Tool loop, streaming, rate limiting, self-correction, health checks, guardian (command blocking)
- **Skill System** — Auto-generate and validate SKILL.md files for agents
- **Profile Library** — 598 pre-configured agent profiles (226 agents, 269 bots, 103 daemons)
- **Interactive CLI** — Full-featured menu-driven interface for agent creation, management, and execution
- **Multi-Key Rotation** — Automatic failover between API keys with rate-limit detection
- **Background Agents** — Spawn daemon agents for continuous monitoring and background tasks
- **Inter-Process Notifications** — Communication between background agents and CLI

## Installation

```bash
cd my-agent-engine
npm install
npm run build
```

## Quick Start

### Interactive CLI (Recommended)

```bash
npm run final
# or
npm run build && npm start
```

This launches an interactive menu where you can:
- Create new agents (with provider/model selection)
- Start sessions with existing agents
- Manage LLM providers and API keys
- View and manage sessions
- Execute prompts with tool execution

### Programmatic Usage

```typescript
import { createEngine } from './src/engine.js'
import type { AgentDefinition } from './src/types/agent-definition.js'

const agent: AgentDefinition = {
  id: 'my-agent',
  displayName: 'My Agent',
  model: 'kilo-auto/free',
  instructionsPrompt: 'You are a helpful assistant.',
  toolNames: ['run_terminal_command', 'add_message', 'set_output'],
}

const engine = createEngine({ agent })
engine.createSession()

// Run a terminal command
const output = await engine.runTerminalCommand('git status')
console.log(output)

// Add messages
engine.addMessage('user', 'What changed?')
engine.addMessage('assistant', 'Here are the changes...')

// Call LLM
const response = await engine.callLLM(
  'Summarize the git status',
  { provider: 'kilo', apiKey: '', baseUrl: 'https://api.kilo.ai', model: 'kilo-auto/free' },
  'You are a git expert.'
)
console.log(response)
```

### Spawn Background Agent

```bash
node dist/spawn-agent.js agent-id "Your instruction here"
```

Results are logged to `agent-logbook.md`.

## Project Structure

```
src/
├── engine.ts              # Core LLM engine (sessions, tool loop, streaming, rate limiting)
├── cli.ts                 # Interactive CLI interface
├── agents.ts              # Agent CRUD and scaffolding
├── providers.ts           # LLM provider management (multi-key rotation, failover)
├── generate-skill.ts      # Auto-generate and validate SKILL.md files
├── skills.ts              # Skill loading and parsing
├── spawn-agent.ts         # Background agent runner
├── validate-agent.ts      # Agent validation script
├── notify.ts              # Inter-process notifications
├── tmux.ts                # Tmux session wrapper (Unix only)
└── types/
    └── agent-definition.ts # TypeScript interfaces

.agents/                   # Agent definitions (.ts files)
├── alice.ts               # Main user interface agent
├── orchestrateur.ts       # PACO orchestrator (delegation-only)
├── agent-superviseur.ts   # PACO supervisor (read-only monitoring)
├── DAEMON-superviseur-01.ts # Background daemon supervisor
├── agent-hecatonchires.ts # Project mapper (parallel instances)
└── agent-reviewer.ts      # Code review and quality analysis

skills/                    # Auto-generated SKILL.md files
└── skill-<agent-id>/
    └── SKILL.md

data/
├── profiles/              # 598 pre-configured agent profiles
│   ├── agents/            # 226 conversational agent profiles
│   ├── bots/              # 269 automation bot profiles
│   └── daemons/           # 103 background daemon profiles
├── golden-rules/          # Validation rules for agents and skills
├── templates/             # Agent scaffolding templates
└── agent-name/            # Name generation data

providers.json             # LLM provider configuration (gitignored)
agent-logbook.md           # Execution log for spawned agents
.notifications.json        # Inter-process notification queue
```

## Core Concepts

### AgentDefinition

```typescript
interface AgentDefinition {
  id: string                    // kebab-case identifier
  displayName: string           // Human-readable name
  model: string                 // LLM model (e.g., 'kilo-auto/free')
  instructionsPrompt: string    // System prompt
  toolNames: string[]           // Available tools
  
  // Optional advanced configs
  selfCorrection?: {
    enabled: boolean
    retryOnFailure: boolean
    maxRetries: number
    validateOutput: boolean
  }
  guardian?: {
    enabled: boolean
    blockHarmful: boolean       // Block dangerous commands
    requireConfirmation: boolean
    auditTrail: boolean
    blockedPatterns?: string[]
  }
  streaming?: {
    enabled: boolean
    chunkSize: number
    showThinking: boolean
  }
  rateLimit?: {
    enabled: boolean
    requestsPerMinute: number
    burst: number
    backoffMultiplier: number
  }
  toolConfig?: {
    parallelTools: boolean
    toolTimeoutMs: number
    maxParallel: number
  }
  healthCheck?: {
    enabled: boolean
    checkIntervalMs: number
    maxConsecutiveFailures: number
    autoRestart: boolean
    maxRestarts: number
  }
}
```

### Engine API

| Method | Description |
|--------|-------------|
| `createEngine(config)` | Create engine instance with agent definition |
| `createSession()` | Create new session (returns Session) |
| `getCurrentSession()` | Get active session |
| `getSession(id)` | Get session by ID |
| `listSessions()` | List all sessions |
| `addMessage(role, content)` | Add message to current session |
| `setOutput(output)` | Set session output object |
| `runTerminalCommand(cmd, type?, timeout?)` | Execute shell command (SYNC/BACKGROUND) |
| `callLLM(prompt, llm, systemPrompt)` | Call LLM with tool loop support |
| `executeTool(call)` | Execute single tool call |
| `processTools(calls)` | Execute multiple tool calls (parallel if enabled) |
| `startHealthCheck()` | Start daemon health monitoring |
| `stopHealthCheck()` | Stop health check |

### Providers

Supported providers with automatic key rotation and rate-limit failover:

- **Kilo Gateway** — No API key required, free tier available
- **Google Gemini** — Requires API key
- **OpenRouter** — Requires API key
- **Opencode Zen** — Requires API key
- **Ollama** — Local, no key required
- **LM Studio** — Local, no key required
- **Custom** — Any OpenAI-compatible endpoint

### PACO Protocol

The Orchestration Protocol ensures agents follow strict governance:

1. **Orchestrateur** (Orchestrator) — Coordinates all work, delegates to specialized agents, never produces deliverables directly
2. **Agent Superviseur** (Supervisor) — Monitors orchestrator compliance (read-only), alerts on violations
3. **DAEMON-superviseur-01** — Background daemon that checks every 5 minutes, can suspend orchestrator after 3 violations

Keyword registry (`data/protocols/keyword-registry.yaml`) maps task keywords to appropriate agents.

### Tool Loop

The engine automatically:
1. Sends prompt to LLM
2. Parses tool calls from response
3. Executes tools (sequentially or parallel)
4. Sends results back to LLM
5. Repeats until no more tool calls (max 10 loops)

### Streaming

When enabled, LLM responses stream in real-time with configurable chunk size and thinking display.

## CLI Commands

### Main Menu (1-9)

```
1. Create agent
2. Start session
3. List agents
4. Edit agent
5. Manage providers
6. View sessions
7. Session info
8. Advanced commands
9. Quit
```

### Prompt Modes

- `!command` — Execute shell command
- `@message` — Add assistant message
- `/help` — Show help
- `/menu` — Show main menu
- `/create` — Create new agent
- `/start` — Start session
- `/use <id>` — Load agent by ID
- `/agents` — List agents
- `/providers` — Manage providers
- `/sessions` — List sessions
- `/new` — New session
- `/info` — Session info
- `/exit` or ESC — Quit

## Agent Creation Workflow

1. Select LLM provider (with API key validation)
2. Choose model from provider's available models
3. Enter agent ID (kebab-case)
4. Enter agent name and description
5. Select template (standard, fast-bot, or daemon)
6. Optionally select profile (injects pre-configured instructions)
7. System generates agent file in `.agents/<id>.ts`
8. System auto-generates skill in `skills/skill-<id>/SKILL.md`
9. Validation runs (agent structure, skill structure, provider config)
10. Agent registered in Alice's registry

## Built-in Agents

### Alice
Main user interface. Delegates to specialized agents via `spawn-agent.js`. Maintains registry of available agents.

### Orchestrateur
PACO orchestrator. Coordinates work by delegating to appropriate agents. Never produces code, docs, or analysis directly.

### Agent Superviseur
PACO supervisor. Monitors orchestrator compliance (read-only). Alerts on violations, can suspend after 3 strikes.

### DAEMON-superviseur-01
Background daemon. Wakes every 5 minutes to audit orchestrator. Checks `tâches_en_cours.json` and coordination logs.

### Hécatonchires
Project mapper. Explores and catalogs project structure. Can spawn multiple parallel instances (maxParallel: 4) to cover different directories.

### Agent Reviewer
Code review specialist. Analyzes agent and skill files, provides structured feedback with severity levels.

## Advanced Features

### Multi-Key API Rotation

Providers can have multiple API keys. The engine automatically:
- Rotates through keys in round-robin
- Detects rate-limiting (HTTP 429)
- Fails over to next available key
- Tracks cooldown periods

### Guardian (Command Blocking)

Blocks potentially harmful commands:
- `rm -rf`, `rmdir`, `del /s`
- `drop table`, `drop database`
- Pipe to shell: `curl | bash`
- System file access: `/etc/passwd`, `C:\Windows\System32`
- Custom patterns via `blockedPatterns`

### Self-Correction

When enabled:
- Retries failed LLM calls (configurable max retries)
- Validates output against criteria
- Exponential backoff on failure

### Health Checks

For daemon agents:
- Periodic health monitoring
- Auto-restart on consecutive failures
- Configurable check interval and max restarts

## Configuration

### providers.json

```json
{
  "providers": [
    {
      "name": "Kilo Gateway",
      "provider": "kilo",
      "apiKeys": [],
      "baseUrl": "https://api.kilo.ai",
      "defaultModel": "kilo-auto/free",
      "enabled": true,
      "currentKeyIndex": 0,
      "maxParallel": 1
    }
  ]
}
```

### Agent Profile

```json
{
  "profileName": "Python Developer",
  "description": "Specialized in Python development",
  "instructionsPrefix": "You are a Python expert...",
  "constraints": ["Only write Python code", "Follow PEP 8"],
  "config": {
    "selfCorrection": { "enabled": true, "maxRetries": 3 },
    "guardian": { "enabled": true, "blockHarmful": true }
  }
}
```

## Examples

### Create and Run an Agent

```bash
npm run final
# Select: 1 (Create agent)
# Provider: Kilo Gateway
# ID: my-code-reviewer
# Name: Code Reviewer
# Template: standard
# Profile: (optional)
```

### Spawn Background Agent

```bash
node dist/spawn-agent.js agent-hecatonchires "Explore src/ directory and map structure"
```

### Validate Agent

```bash
node dist/validate-agent.js my-agent
```

### Test Provider Connection

```typescript
import { testConnection } from './src/providers.js'

const result = await testConnection('google', 'your-api-key', 'https://generativelanguage.googleapis.com', 'gemini-2.5-flash')
if (result.ok) {
  console.log('✓ Connection successful')
} else {
  console.log('✗ Error:', result.error)
  result.diagnostics.forEach(d => console.log('  ' + d))
}
```

## Testing

```bash
node dist/test.js
```

Runs end-to-end workflow test:
- Creates test agent
- Validates provider configuration
- Makes LLM call
- Cleans up test files

## Troubleshooting

### "Agent not found"
Ensure agent file exists in `.agents/<id>.ts` and ID is kebab-case.

### "Invalid API key"
Check `providers.json` and verify key is correct for the provider. Use CLI to update.

### "Command timed out"
Increase timeout in `runTerminalCommand(cmd, 'SYNC', timeoutSeconds)` or check if command is hanging.

### "Rate limited"
Engine automatically rotates to next API key. If all keys are rate-limited, waits before retrying.

### Local provider not responding
Ensure Ollama or LM Studio is running on the configured port (default: 11434 for Ollama, 1234 for LM Studio).

## Development

```bash
npm run build          # Compile TypeScript
npm start              # Run CLI
npm run final          # Clean build + start
```

## License

MIT
