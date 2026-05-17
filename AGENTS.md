# Minautor Agent Service - Agent Instructions

## Essential Commands

- **Build**: `npm run build` (TypeScript compilation)
- **Start**: `npm start` (runs CLI)
- **Final**: `npm run final` (clean build + start CLI)
- **Test**: `node dist/test.js` (end-to-end workflow test)
- **Validate Agent**: `node dist/validate-agent.js <agent-id>`
- **Spawn Agent**: `node dist/spawn-agent.js <agent-id> "<instruction>"` (background execution)

## CLI Usage

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

### Prompt Commands

- `!command` — Execute shell command
- `@message` — Add assistant message
- `/help` — Show help
- `/menu` — Show main menu
- `/create` — Create new agent
- `/start` — Start session with agent
- `/use <id>` — Load agent by ID
- `/edit` — Edit current agent
- `/agents` — List local agents
- `/providers` — Manage LLM providers
- `/sessions` — View sessions
- `/new` — New session
- `/info` — Active session info
- `/exit` or ESC — Quit

### Agent Creation Flow

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

## Project Structure

### Source Code (`src/`)

| File | Purpose |
|------|---------|
| `engine.ts` | Core LLM engine: sessions, tool loop, streaming, rate limiting, guardian, health checks, self-correction |
| `cli.ts` | Interactive CLI interface with full menu system |
| `agents.ts` | Agent CRUD operations and scaffolding (3 templates: standard, fast-bot, daemon) |
| `providers.ts` | LLM provider management with multi-key rotation and rate-limit failover |
| `generate-skill.ts` | Auto-generate SKILL.md files via LLM + validation |
| `skills.ts` | Skill loading and YAML frontmatter parsing |
| `spawn-agent.ts` | Background agent runner (subprocess execution) |
| `validate-agent.ts` | Agent validation script (structure, skill, PACO, providers) |
| `notify.ts` | Inter-process notifications via `.notifications.json` |
| `tmux.ts` | Tmux session wrapper (Unix only) |
| `types/agent-definition.ts` | TypeScript interfaces for agents and configurations |

### Configuration & Data

| Path | Purpose |
|------|---------|
| `.agents/` | Agent definition files (.ts) |
| `skills/` | Auto-generated SKILL.md files (one per agent) |
| `providers.json` | LLM provider configuration (gitignored, auto-created) |
| `data/profiles/` | 598 pre-configured agent profiles (agents, bots, daemons) |
| `data/golden-rules/` | Validation rules for agents and orchestration |
| `data/templates/` | Agent scaffolding templates |
| `data/protocols/` | PACO protocol documentation and keyword registry |
| `agent-logbook.md` | Execution log for spawned agents |
| `.notifications.json` | Inter-process notification queue |

## Built-in Agents

### Alice
**Role**: Main user interface and delegation hub  
**Model**: kilo-auto/free  
**Tools**: run_terminal_command, add_message, set_output, skill  
**Behavior**: Receives user requests, delegates to specialized agents via `spawn-agent.js`, maintains registry of available agents

### Orchestrateur
**Role**: PACO orchestrator (coordination only)  
**Model**: kilo-auto/free  
**Tools**: run_terminal_command, add_message, set_output  
**Behavior**: Coordinates work by delegating to appropriate agents. Never produces code, docs, or analysis directly. Consults keyword registry before each action.

### Agent Superviseur
**Role**: PACO supervisor (read-only monitoring)  
**Model**: kilo-auto/free  
**Tools**: add_message  
**Behavior**: Monitors orchestrator compliance. Alerts on violations. Can suspend orchestrator after 3 strikes.

### DAEMON-superviseur-01
**Role**: Background daemon supervisor  
**Model**: kilo-auto/free  
**Tools**: run_terminal_command, add_message, set_output  
**Behavior**: Wakes every 5 minutes to audit orchestrator. Checks `tâches_en_cours.json` and coordination logs. Enforces PACO protocol.

### Hécatonchires
**Role**: Project mapper and explorer  
**Model**: liquid/lfm2.5-1.2b  
**Tools**: run_terminal_command, add_message, set_output, skill  
**Behavior**: Explores and catalogs project structure. Can spawn multiple parallel instances (maxParallel: 4) to cover different directories simultaneously.

### Agent Reviewer
**Role**: Code review and quality analysis  
**Model**: kilo-auto/free  
**Tools**: run_terminal_command, add_message, set_output, skill  
**Behavior**: Analyzes agent and skill files. Provides structured feedback with severity levels (urgent, important, obligatory, suggestions).

## Key Workflows

### 1. Create Agent

```bash
npm run final
# Select: 1 (Create agent)
# Follow prompts for provider, model, ID, name, template, profile
```

**What happens**:
- Agent file created in `.agents/<id>.ts`
- Skill auto-generated in `skills/skill-<id>/SKILL.md`
- Validation runs (max 3 attempts)
- Agent registered in Alice's registry

### 2. Run Agent (Interactive Session)

```bash
npm run final
# Select: 2 (Start session)
# Choose agent from list
# Send prompts (text, !command, @message)
```

**What happens**:
- Session created with full message history
- Tool loop executes: LLM → parse tools → execute → send results back
- Streaming enabled for real-time response display
- Session persists until quit

### 3. Run Agent (Background)

```bash
node dist/spawn-agent.js agent-id "Your instruction"
```

**What happens**:
- Agent runs in subprocess
- Results logged to `agent-logbook.md`
- Notifications sent via `.notifications.json`
- Process exits after completion

### 4. Manage Providers

```bash
npm run final
# Select: 5 (Manage providers)
# Add/remove/configure providers
# Set API keys
# Test connections
```

**What happens**:
- Provider config saved to `providers.json`
- API keys validated before saving
- Multi-key rotation configured
- Rate-limit failover enabled

### 5. Skill System

**Auto-generation**:
- LLM generates SKILL.md based on agent description
- Frontmatter YAML parsed for metadata
- Sections validated: ## Mission, ## Comportement, ## Compétences, ## Règles
- Placeholders checked (must be resolved)

**Loading**:
- Skills loaded from `skills/<skill-id>/SKILL.md`
- Frontmatter parsed for name and description
- Content available to agents via `skill` tool

## LLM Providers

### Supported Providers

| Provider | API Key | Local | Default Model |
|----------|---------|-------|----------------|
| Kilo Gateway | No | No | kilo-auto/free |
| Google Gemini | Yes | No | gemini-2.5-flash |
| OpenRouter | Yes | No | openrouter/free |
| Opencode Zen | Yes | No | opencode-zen/default |
| Ollama | No | Yes | llama3.2 |
| LM Studio | No | Yes | local-model |
| Custom | Optional | No | custom |

### Multi-Key Rotation

- Each provider can have multiple API keys
- Engine rotates through keys in round-robin
- Detects rate-limiting (HTTP 429)
- Fails over to next available key automatically
- Tracks cooldown periods per key

### Rate Limiting

- Configurable requests per minute + burst
- Exponential backoff on failure
- Automatic key rotation on 429 errors
- Cooldown tracking per API key

## PACO Protocol

### Overview

The Orchestration Protocol ensures agents follow strict governance:

1. **Orchestrateur** — Coordinates work, delegates to specialized agents, never produces deliverables
2. **Agent Superviseur** — Monitors orchestrator compliance (read-only), alerts on violations
3. **DAEMON-superviseur-01** — Background audit every 5 minutes, can suspend orchestrator

### Keyword Registry

Located at `data/protocols/keyword-registry.yaml`, maps task keywords to appropriate agents.

**Example**:
```yaml
keywords:
  - pattern: "code review"
    agent: "agent-reviewer"
  - pattern: "explore|map|structure"
    agent: "agent-hecatonchires"
```

### Compliance Rules

- Orchestrator must consult keyword registry before each action
- If keyword matches agent, must delegate
- If no match, respond "Tâche non couverte — intervention humaine requise"
- Supervisor monitors for violations
- After 3 violations, orchestrator is suspended

## Advanced Features

### Tool Loop

The engine automatically:
1. Sends prompt to LLM
2. Parses tool calls from response (! prefix or JSON blocks)
3. Executes tools (sequentially or parallel based on config)
4. Sends results back to LLM
5. Repeats until no more tool calls (max 10 loops)

### Streaming

When enabled:
- LLM responses stream in real-time
- Configurable chunk size for display
- Optional thinking display
- Smooth user experience

### Guardian (Command Blocking)

Blocks potentially harmful commands:
- `rm -rf`, `rmdir`, `del /s` (file deletion)
- `drop table`, `drop database` (database deletion)
- Pipe to shell: `curl | bash`, `wget | sh`
- System file access: `/etc/passwd`, `C:\Windows\System32`
- Custom patterns via `blockedPatterns`

### Self-Correction

When enabled:
- Retries failed LLM calls (configurable max retries)
- Validates output against criteria
- Exponential backoff on failure
- Improves reliability for critical tasks

### Health Checks

For daemon agents:
- Periodic health monitoring
- Auto-restart on consecutive failures
- Configurable check interval and max restarts
- Audit trail logging

## Important Constraints

### Agent IDs
- Must be kebab-case (lowercase, hyphens only)
- Example: `my-code-reviewer`, `agent-hecatonchires`
- No underscores, spaces, or uppercase

### Descriptions
- Minimum 10 words
- Clear and specific
- Describes agent's primary mission

### Tool Names
Standard set: `['run_terminal_command', 'add_message', 'set_output', 'skill']`

### File Persistence
- Agents: `.agents/<id>.ts`
- Skills: `skills/skill-<id>/SKILL.md`
- Providers: `providers.json`
- Notifications: `.notifications.json`
- Logbook: `agent-logbook.md`

### Cancellation
- ESC key cancels current operation in CLI
- Graceful shutdown of background agents

### Background Agents
- Use `spawn-agent.js` for daemon/timer agents
- Results logged to `agent-logbook.md`
- Notifications via `.notifications.json`

## Testing & Validation

### Run Full Test

```bash
node dist/test.js
```

Tests:
- Agent creation workflow
- Provider configuration
- LLM calls
- Skill generation
- Cleanup (removes test files)

### Validate Specific Agent

```bash
node dist/validate-agent.js my-agent
```

Checks:
- Agent file exists and is valid
- Skill file exists and is valid
- Skill structure (required sections)
- PACO orchestration team present
- Provider configuration valid

### Validation Rules

Located in `data/golden-rules/`:
- `agent_structure.json` — Agent file requirements
- `orchestration_team.json` — PACO team requirements
- `skill_structure.json` — Skill file requirements
- `script_logic.json` — Script execution rules

## Gotchas & Troubleshooting

### Build Output
- Build output goes to `dist/` — CLI runs from compiled JavaScript
- Always run `npm run build` before `npm start`
- Use `npm run final` for clean build + start

### Provider Configuration
- `providers.json` is auto-created with defaults if missing
- Kilo provider works without API key
- Local providers (Ollama, LM Studio) require service running
- API keys are gitignored for security

### Agent Definitions
- Must export default `definition: AgentDefinition`
- TypeScript source in `.agents/<id>.ts`
- Compiled to JavaScript in `dist/`

### Skill Generation
- Uses LLM — may fail if provider/model unavailable
- Validates frontmatter YAML
- Checks for unresolved placeholders
- Sections must be at least 10 characters

### Daemon Agents
- Should use `pushNotification` for communication
- Background execution via `spawn-agent.js`
- Results logged to `agent-logbook.md`
- Notifications queued in `.notifications.json`

### Rate Limiting
- Engine automatically rotates API keys
- If all keys rate-limited, waits before retrying
- Cooldown tracked per key
- Exponential backoff applied

### Local Providers
- Ollama: default port 11434
- LM Studio: default port 1234
- Ensure service is running before use
- Check connection with provider test

## Profile Library

### Overview

598 pre-configured agent profiles in 3 categories:

- **226 Agents** — Conversational profiles (Python, React, Next.js, Rust, CSS, revue, planification, etc.)
- **269 Bots** — Automation profiles (Git, Docker, tests, scripts, réseau, etc.)
- **103 Daemons** — Background profiles (logs, maintenance, surveillance, coordination, etc.)

### Using Profiles

During agent creation, optionally select a profile to:
- Inject pre-configured instructions
- Set recommended tool configurations
- Apply domain-specific constraints
- Enable specialized features

### Profile Structure

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

## Development

```bash
npm run build          # Compile TypeScript to dist/
npm start              # Run CLI from dist/
npm run final          # Clean build + start
```

## License

MIT
