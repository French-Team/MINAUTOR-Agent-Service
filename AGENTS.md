# Hermes Agent Engine - Agent Instructions

## Essential Commands
- **Build**: `npm run build` (TypeScript compilation)
- **Start**: `npm start` (runs CLI)
- **Test**: `node dist/test.js` (end-to-end workflow test)
- **Validate Agent**: `node dist/validate-agent.js <agent-id>`
- **Spawn Agent**: `node dist/spawn-agent.js <agent-id> "<instruction>"`

## CLI Usage
- Interactive menu: start with `npm start`
- Menu shortcuts: 1-9 correspond to main menu options
- Commands: 
  - `!cmd` - execute shell command
  - `@message` - add assistant message  
  - `/create` - create new agent
  - `/start` - start session with agent
  - `/use <id>` - load agent by ID
  - `/edit` - edit current agent
  - `/agents` - list local agents
  - `/providers` - manage LLM providers
  - `/sessions` - view sessions
  - `/new` - new session
  - `/info` - active session info
  - `/exit` or ESC - quit
- Agent creation flow: prompts for ID (kebab-case), name, description, provider, model

## Project Structure
- **Source**: `src/`
  - `engine.js` - core agent engine (sessions, tool execution, LLM calls)
  - `cli.js` - interactive command-line interface
  - `agents.ts` - agent file storage (.agents/ directory)
  - `providers.ts` - provider configuration (providers.json)
  - `skills.ts` - skill loading (skills/ directory)
  - `spawn-agent.ts` - subprocess agent execution
  - `test.ts` - end-to-end test workflow
  - `validate-agent.ts` - agent validation script
- **Configuration**:
  - `.agents/` - agent definition files (.ts)
  - `skills/` - skill directories (each with SKILL.md)
  - `providers.json` - LLM provider configs (gitignored, defaults on first run)
  - `data/golden-rules/` - validation rules for agents/scripts
  - `data/templates/` - agent templates (daemon, llm types)
- **Types**: `src/types/agent-definition.ts` - AgentDefinition interface

## Key Workflows
1. **Create Agent**: 
   - Via CLI `/create` or `scaffoldAgent(id, name, model, tools, instructions)`
   - Creates `.agents/<id>.ts`
   - Generates skill in `skills/skill-<id>/SKILL.md`
   - Validates agent, skill, and integration (max 3 attempts)

2. **Run Agent**:
   - CLI: `/start` → `/use <id>` → send prompts
   - Direct: `node dist/spawn-agent.js <agent-id> "<instruction>"`
   - Engine: `createEngine({agent})` → `createSession()` → `runTerminalCommand()`/`callLLM()`

3. **Skill System**:
   - Skills in `skills/<skill-id>/SKILL.md`
   - Required sections: ## Mission, ## Comportement, ## Compétences, ## Règles
   - Loaded via CLI `/skill` or `loadSkill(name)`
   - Auto-generated during agent creation

4. **Provider Management**:
   - Default: Kilo Gateway enabled (no API key required)
   - Others require API keys: Google, OpenRouter, Opencode Zen
   - Local providers: Ollama, LM Studio (no key needed, service must be running)
   - Keys stored in `providers.json` (gitignored)
   - Unique key constraint: one API key can only be used by one provider entry
   - Key rotation: automatic failover when rate-limited

## Important Constraints
- **Agent IDs**: must be kebab-case (lowercase, hyphens only, e.g., `my-agent`)
- **Descriptions**: minimum 10 words
- **Supported Providers**: kilo, google, openrouter, opencode-zen, ollama, lmstudio, custom
- **Tool Names**: standard set is `['run_terminal_command', 'add_message', 'set_output', 'skill']`
- **File Persistence**: 
  - Agents: `.agents/<id>.ts`
  - Skills: `skills/skill-<id>/SKILL.md`
  - Providers: `providers.json`
- **Cancellation**: ESC key cancels current operation in CLI
- **Background Agents**: use `spawn-agent.js` for daemon/timer agents
- **Notifications**: inter-agent communication via `pushNotification(from, message)`

## Testing & Validation
- Run full test: `node dist/test.js` (tests agent creation, providers, LLM calls)
- Validate specific agent: `node dist/validate-agent.js <agent-id>`
- Checks: agent file, skill file, skill structure, provider configuration
- Test cleanup: removes `.agents/` and `providers.json` after running

## Gotchas
- Build output goes to `dist/` - CLI runs from compiled JavaScript
- Provider config (`providers.json`) is regenerated with defaults if missing
- Kilo provider works without API key (uses `https://api.kilo.ai`)
- Some LLM calls require internet access (except local providers)
- Agent definitions must export default `definition: AgentDefinition`
- Skill generation uses LLM - may fail if provider/model unavailable
- Daemon agents should use `pushNotification` for communication
- Agent validation enforces golden rules from `data/golden-rules/`