# Workspace Isolation System — Specification

> **Date:** 2026-05-21
> **Status:** Draft / Discussion
> **Goal:** Isolate agents to per-project workspaces, enforce permissions via a real-time guard daemon.

---

## Table of Contents

1. [Current Architecture Audit](#1-current-architecture-audit)
2. [New System Overview](#2-new-system-overview)
3. [Directory Structure](#3-directory-structure)
4. [Permissions Model](#4-permissions-model)
5. [Permissions File (YAML)](#5-permissions-file-yaml)
6. [The "Feu Rouge" Daemon](#6-the-feu-rouge-daemon)
7. [Flow: Full Lifecycle](#7-flow-full-lifecycle)
8. [Edge Cases & Constraints](#8-edge-cases--constraints)
9. [Open Questions](#9-open-questions)
10. [Appendices: File-by-File Impact](#10-appendices)

---

## 1. Current Architecture Audit

### 1.1 Directory Layout (Existing)

```
minautor-agents-service/          <-- project root (program code)
├── src/                            Agent engine & CLI source
│   ├── engine.ts                   Core engine (cwd = process.cwd())
│   ├── engine-guardian.ts          Command guardian (harmful patterns)
│   ├── engine-executor.ts          Tool executor (run_terminal_command, add_message, set_output, skill)
│   ├── engine-runner.ts            LLM runner with tool loop
│   ├── engine-sessions.ts          Session manager
│   ├── engine-llm.ts               Internal LLM caller (OpenAI-compatible)
│   ├── cli-main.ts                 Main CLI loop
│   ├── cli-menu.ts                 Menu display
│   ├── cli-intercom-router.ts      Keyword router → writes to intercom/
│   ├── cli-selector.ts             Command picker UI
│   ├── cli-skills.ts               Skills viewer
│   ├── cli-agents.ts               Agent listing/loading
│   ├── cli-providers.ts            Provider management UI
│   ├── cli-create.ts               Agent creation wizard
│   ├── cli-sessions.ts             Session management
│   ├── cli-edit.ts                 Agent editing
│   ├── cli-user.ts                 User profile
│   ├── cli-banner.ts               FIGlet banner
│   ├── cli-startup.ts              Startup messages
│   ├── cli-utils.ts                Agent loading utilities
│   ├── cli-runner.ts               Shell command runner helper
│   ├── agents.ts                   Agent CRUD, profiling, scaffolding
│   ├── providers.ts                Provider management, key rotation, model fetch
│   ├── skills.ts                   Skill loading & listing
│   ├── spawn-agent.ts              Agent subprocess spawner
│   ├── generate-skill.ts           Skill generation via LLM
│   ├── validate-agent.ts           Agent validation script
│   ├── notify.ts                   Inter-process notifications
│   ├── test.ts                     E2E tests
│   ├── constants.ts                Colors, URLs, helpers
│   └── telecom/service/
│       ├── telecom-daemon.ts       Background daemon: polls & routes intercom messages
│       ├── intercom-manager.ts     CLI tool for intercom operations
│       └── context/                (empty context files)
├── .agents/                        Agent definition files (<id>.ts)
│   ├── alice.ts
│   ├── orchestrateur.ts
│   ├── agent-superviseur.ts
│   ├── agent-reviewer.ts
├── skills/                         Skill definition files
├── data/                           Profiles, golden rules, protocols
├── telecom/                        Runtime data (auto-created)
│   ├── intercom/                   Pending intercom messages (.json)
│   ├── routed/                     Routed intercom messages (processed)
│   ├── agents/<id>/                Per-agent workspace (seed files, livrables)
│   ├── papiers/<id>/               Per-agent persistent storage
│   ├── memoire-vive/<id>/          Per-agent temp storage (TTL 1h)
│   ├── notifications.json          Pending notifications queue
│   ├── notifications/              Archived notifications (YYYY-MM-DD.json)
│   ├── agent-logbook.md            Spawned agent execution log
│   └── daemon.*                    PID, status, trigger, reset files
├── providers.json                  LLM provider config
└── data/protocols/
    ├── paco-protocol.md            Orchestration protocol
    └── keyword-registry.yaml       Agent delegation mapping
```

### 1.2 Current Flow — User Request to Agent Execution

```
User says "crée une app React"
       │
       ▼
Alice (in CLI) receives prompt
       │
       ├── tryRouteIntercom() matches keyword ["crée", "développe"]
       │      └── writes intercom message: telecom/intercom/create-request-<ts>-<id>.json
       │
       ▼
Telecom Daemon (polling intercom/ every 1s)
       │
       ├── reads pending message
       ├── marks as "read"
       ├── copies to telecom/routed/
       ├── pushNotification() → CLI user sees notification
       └── fork("spawn-agent.js", [agent-telecom, instruction])
              │
              ▼
       spawn-agent.js creates workspace:
         telecom/agents/agent-telecom/
         telecom/papiers/agent-telecom/
         telecom/memoire-vive/agent-telecom/
              │
              └── calls engine.callLLM(instruction, ...)
                      │  Agent-telecom routes to orchestrateur via intercom
                      ▼
              Orchestrateur is spawned (same pattern)
                      │
                      ├── reads keyword-registry.yaml
                      ├── delegates to specialized agent (via intercom)
                      └── agent is spawned → works → returns result
```

### 1.3 Current Permission/Isolation Mechanisms

| Mechanism | What it does | Limitation |
|-----------|-------------|-----------|
| **Guardian** (`engine-guardian.ts`) | Blocks harmful command patterns (`rm -rf`, `drop table`, `curl | bash`) | Pattern-based only, no path/workspace awareness |
| **Guardian** | `requireConfirmation` flag can pause dangerous commands | Binary on/off, not workspace-aware |
| **Workspace seeding** (`spawn-agent.ts`) | Creates `telecom/agents/<id>/` folder with context | Agent still has full FS access via `process.cwd()` |
| **Engine cwd** (`engine.ts` L4) | `const cwd = config.cwd \|\| process.cwd()` | Always defaults to project root |
| **Agent instructions** | Natural language "tu travailles dans X dossier" | Not enforced, agent can ignore |

**Critical gap:** There is NO technical enforcement of workspace boundaries. Any agent can read/write any file in the project tree including `.agents/`, `data/`, `skills/`, `providers.json`.

### 1.4 Existing Intercom Protocol

Messages follow this structure (JSON files in `telecom/intercom/`):
```json
{
  "id": "uuid",
  "from": "alice",
  "to": "agent-telecom",
  "type": "request" | "response" | "signal" | "log" | "alert",
  "subject": "create-request",
  "payload": { "demande": "..." },
  "timestamp": "2026-05-21T10:30:00.000Z",
  "status": "pending" | "read" | "processed" | "archived"
}
```

---

## 2. New System Overview

### 2.1 Core Principle

The project `minautor-agents-service/` is the **program** that manages agents. It is NOT a user project workspace.

User projects live in `workspaces/<project-name>/`. Agents are confined to operate within these workspaces via a real-time guard daemon ("feu rouge").

### 2.2 Communication Flow

```
User ──► Alice ──► intercom ──► orchestrateur ──► agent/bot/daemon
                                                    │
                                                    │ confined to
                                                    ▼
                                            workspaces/<project>/
```

- **Alice** only talks to user. She uses intercom to route requests. She does NOT manage agents or projects directly.
- **Intercom** is the exclusive communication bus between agents.
- **Orchestrateur** coordinates and delegates. Never produces deliverables.
- **Feu Rouge Daemon** runs in background, intercepts all `run_terminal_command` calls, and enforces workspace boundaries in real time.

### 2.3 Permission Levels

Each agent has a permission level defined in its `AgentDefinition`:

| Level | Label | Access |
|-------|-------|--------|
| `admin` | Administrator | Full access to project root (`.agents/`, `data/`, `skills/`, `providers.json`, engine internals). For agents like Alice, orchestrateur, agent-superviseur. |
| `restricted` | Restricted | Access to `workspaces/` root (can list projects) but NOT to the program files (`src/`, `.agents/`, etc.). |
| `confined` | Confined | Access to ONE specific project: `workspaces/<project-name>/` only. Cannot list other projects. This is the default for user-created agents. |
| `readonly` | Read-only audit | Read-only access to a specific project or to the whole system. For supervisor agents. |

### 2.4 How an Agent Gets Its Workspace

The workspace is **decided dynamically** by the orchestrateur at delegation time, NOT hardcoded in the agent definition:

1. User request arrives via intercom (e.g., "crée un backend en Node.js pour mon projet ecommerce")
2. Orchestrateur parses the request, determines which project is referenced (or creates one)
3. Orchestrateur delegates to the specialized agent WITH the workspace info in the instruction:
   ```
   @agent-builder: mission
   ## Workspace
   workspaces/ecommerce/
   ## Mission
   Crée la structure backend Node.js dans ce dossier.
   ```
4. The spawned agent receives the workspace path in its enriched instruction
5. The Feu Rouge Daemon ensures the agent cannot write outside `workspaces/ecommerce/`

---

## 3. Directory Structure (New)

```
minautor-agents-service/
├── src/                                (unchanged)
├── .agents/                            (unchanged)
├── skills/                             (unchanged)
├── data/                               (unchanged)
│   └── permissions/                    NEW: permissions system
│       └── permissions.yaml            Master permissions file
├── workspaces/                         NEW: all user projects
│   ├── .tasks.json                     Global task board (orchestrateur-managed)
│   ├── .permissions.lock               Lock file for feurouge daemon
│   ├── mon-projet-react/
│   │   ├── .workspace                  Marker: this is a registered project
│   │   ├── .tasks.json                 Per-project task board
│   │   ├── package.json
│   │   ├── src/
│   │   └── ...
│   ├── api-backend/
│   │   ├── .workspace
│   │   ├── .tasks.json
│   │   └── ...
│   └── README.md                       Workspaces overview (auto-generated)
├── telecom/                            (unchanged — internal agent comms)
└── providers.json                      (unchanged)
```

### 3.1 Project Marker: `.workspace`

A file created at `workspaces/<projet>/.workspace` to mark a valid project:

```yaml
# .workspace
name: mon-projet-react
created_at: 2026-05-21T10:30:00Z
created_by: alice
status: active
description: Projet React e-commerce
```

- Any directory `workspaces/<name>/` containing a `.workspace` file is a valid project.
- Directories without `.workspace` are ignored by the system (user can drop a folder, then run `/project init` to mark it).

### 3.2 Task Board: `.tasks.json`

A JSON file that tracks missions and prevents agents from stepping on each other:

```json
{
  "project": "mon-projet-react",
  "tasks": [
    {
      "id": "task-001",
      "title": "Créer le composant Header",
      "area": "frontend",
      "status": "done",
      "assigned_to": "agent-builder-01",
      "created_at": "2026-05-21T10:30:00Z",
      "completed_at": "2026-05-21T11:00:00Z"
    },
    {
      "id": "task-002",
      "title": "Implémenter l'authentification",
      "area": "backend",
      "status": "in_progress",
      "assigned_to": "agent-builder-02",
      "created_at": "2026-05-21T11:00:00Z"
    },
    {
      "id": "task-003",
      "title": "Créer page de connexion",
      "area": "frontend",
      "status": "todo"
    }
  ]
}
```

**Sequencing rules:**
- Tasks in the SAME area are serialized (one at a time)
- Tasks in DIFFERENT areas can run in parallel (frontend + backend simultaneously)
- The orchestrateur reads `.tasks.json` before each delegation, assigns the next available task
- NEVER give all tasks to one agent — delegate sequentially as progress is made
- Each new delegation spawns a fresh agent instance for that specific mission

---

## 4. Permissions Model

### 4.1 Where Permissions Are Defined

Permissions have two complementary sources:

**A. AgentDefinition (TypeScript) — static defaults**
New optional field in `src/types/agent-definition.ts`:

```typescript
export interface AgentDefinition {
  // ... existing fields ...
  permissions?: {
    level: 'admin' | 'restricted' | 'confined' | 'readonly'
    defaultWorkspace?: string  // Optional: fixed workspace (for confined agents)
    allowedCommands?: string[] // Override: commands this agent can run
    forbiddenCommands?: string[] // Override: commands this agent CANNOT run
    allowedPaths?: string[]    // Override: paths this agent can access
    forbiddenPaths?: string[]  // Override: paths this agent cannot access
  }
}
```

**B. Permissions YAML — dynamic, runtime-editable**
Stored at `data/permissions/permissions.yaml`, this is the SOURCE OF TRUTH at runtime:

```yaml
# data/permissions/permissions.yaml
# Géré par le daemon feurouge. Éditable via commandes.
# Les permissions statiques (agent-definition.ts) sont importées
# automatiquement au démarrage de chaque agent.

version: 1
agents:
  - id: alice
    level: admin
    allowed_paths:
      - "."
    forbidden_commands:
      - "rm -rf"
      - "del /s"

  - id: orchestrateur
    level: admin
    allowed_commands:
      - "node dist/telecom/service/intercom-manager.js send *"
      - "cat"
      - "ls"
      - "findstr"
      - "dir"
    allowed_paths:
      - "data/protocols/"
      - "telecom/"
      - "workspaces/"

  - id: agent-superviseur
    level: readonly

  # Wildcard: fallback for any agent not listed
  - id: "*"
    level: confined
    allowed_commands:
      - "cat"
      - "ls"
      - "dir"
      - "findstr"
      - "node *"
      - "npm *"
      - "npx *"
      - "mkdir"
      - "writefile"
      - "echo"
    forbidden_commands:
      - "rm -rf"
      - "del /s"
      - "format"
    forbidden_paths:
      - ".."
      - ".agents/"
      - "data/"
      - "src/"
      - "telecom/"
      - "providers.json"
      - "skills/"
```

### 4.2 Permission Resolution Logic

When an agent calls `run_terminal_command(cmd)`:

1. **Feurouge daemon intercepts** the command (see §6)
2. **Look up** agent ID in `permissions.yaml` → get level, allowed/forbidden lists
3. **If not found**, use `*` wildcard entry (default: confined)
4. **Check forbidden paths**: if the command target path matches `forbidden_paths` → BLOCK
5. **Check forbidden commands**: if the command matches `forbidden_commands` → BLOCK
6. **Check allowed paths**: if `allowed_paths` is set AND the target path is NOT in it → BLOCK
7. **Check allowed commands**: if `allowed_commands` is set AND the command is NOT in it → BLOCK
8. **If level is `readonly`**: all write operations blocked
9. **If level is `confined`**: restrict to `workspaces/<project>/` automatically
10. **Pass**: command executes normally

**Block response format** (returned to the agent):
```
[FEU ROUGE] Commande bloquée: "rm -rf workspaces/mon-projet/node_modules"
Raison: forbidden_commands contient "rm -rf"
Agent: agent-builder-02 (confined dans workspaces/mon-projet/)
Pour demander une exception: contacte l'utilisateur.
```

### 4.3 Runtime Permission Editing

The YAML file can be edited:
- Via `!permissions show` — display current permissions
- Via `!permissions edit <agent-id> <field> <value>` — modify a specific rule
- Via `!permissions reload` — force daemon to re-read YAML
- Via direct file edit in `data/permissions/permissions.yaml` (daemon auto-reloads on change)

---

## 5. Permissions File (YAML) — Full Schema

```yaml
version: 1

# Global defaults applied when agent level is "confined"
defaults:
  confined:
    allowed_commands:
      - "cat"
      - "ls"
      - "dir"
      - "findstr"
      - "node"
      - "npm"
      - "npx"
      - "mkdir"
      - "echo"
      - "writefile"
      - "type"
      - "copy"
      - "move"
    forbidden_commands:
      - "rm -rf"
      - "del /s"
      - "rmdir /s"
      - "format"
      - "curl * | bash"
      - "wget * | sh"
    forbidden_paths:
      - ".agents/"
      - "data/"
      - "src/"
      - "providers.json"
      - "package.json"            # can't modify the program's own package.json
      - "tsconfig.json"
      - "workspaces/*/.tasks.json" # can't modify task board (orchestrateur only)

# Per-agent overrides
agents:
  - id: alice
    level: admin
    allowed_paths: ["."]

  - id: orchestrateur
    level: admin
    allowed_commands:
      - "node dist/telecom/service/intercom-manager.js *"
      - "cat"
      - "ls"
      - "dir"
      - "findstr"
      - "echo"
    allowed_paths:
      - "data/protocols/"
      - "telecom/"
      - "workspaces/"

  - id: agent-superviseur
    level: readonly
    allowed_commands:
      - "cat"
      - "ls"
      - "dir"
      - "findstr"

  - id: DAEMON-superviseur-01
    level: admin
    allowed_paths: ["."]

  - id: DAEMON-feurouge-01
    level: admin          # The feurouge daemon itself
    allowed_paths:
      - "data/permissions/"
      - "telecom/"

  - id: agent-telecom
    level: admin
    allowed_commands:
      - "node dist/telecom/service/intercom-manager.js *"
      - "node dist/spawn-agent.js *"
      - "cat"
      - "ls"
      - "dir"
      - "findstr"
      - "echo"

  # Wildcard: all other agents
  - id: "*"
    level: confined
    # Inherits from defaults.confined
```

**Important:** When a `confined` agent is spawned for a specific project (e.g., `workspaces/ecommerce/`), the daemon dynamically injects `allowed_paths: ["workspaces/ecommerce/"]` for that agent's PID only. This means two instances of the same agent on different projects cannot see each other's files.

---

## 6. The "Feu Rouge" Daemon

### 6.1 Overview

A new background daemon (`DAEMON-feurouge-01`) that:

- Starts within 60 seconds of the project's main CLI startup
- Intercepts ALL `run_terminal_command` calls in real time
- Checks the command against the permission rules
- Blocks violating commands with explanatory messages
- Logs all blocks for audit
- Allows runtime permission editing
- Acts as the "red light" — agents learn they cannot escape their workspace

### 6.2 Architecture

```
Agent calls run_terminal_command("rm -rf workspaces/mon-projet/")
       │
       ▼
Engine (engine-guardian.ts or engine-executor.ts)
       │
       ├── [NEW] Send command to feurouge daemon for approval
       │       │
       │       ▼
       │   DAEMON-feurouge-01
       │       │
       │       ├── Lookup agent ID → permissions.yaml
       │       ├── Check path against allowed/forbidden
       │       ├── Check command against allowed/forbidden
       │       ├── Check agent level (confined → workspace-enforce)
       │       │
       │       ├── ALLOWED ──► return OK → command executes
       │       └── BLOCKED ──► return error message → command fails
       │
       ▼
Agent receives result (success or [FEU ROUGE] block message)
```

### 6.3 Interception Mechanism

**Option A (Recommended): IPC via daemon check**
- Before executing each `run_terminal_command`, the engine sends the command + agent PID to the feurouge daemon via IPC (same pattern as notifications)
- Daemon checks rules and responds (ALLOW / BLOCK + reason)
- Engine only executes if ALLOWED
- Latency: < 10ms per check (in-memory lookup of permission YAML)

**Option B: Wrapper command**
- `run_terminal_command` is wrapped to prepend a feurouge check
- `feurouge-check <agent-id> <command> && <actual-command>`
- The check binary reads permissions.yaml and returns exit code 0 (allow) or 1 (block)
- Simpler but less elegant

**Option C: Filesystem watchdog**
- Daemon watches for new files created outside allowed paths
- Post-hoc detection, not real-time blocking
- Not recommended per user requirement (temps réel)

### 6.4 Daemon Implementation Plan

New files:
- `src/feurouge/feurouge-daemon.ts` — Background daemon
- `src/feurouge/permissions.ts` — Permissions loader & checker
- `src/feurouge/permissions-cli.ts` — CLI tool for runtime edits
- `data/permissions/permissions.yaml` — Permissions file (auto-created)

Integration points:
- **`src/engine-guardian.ts`** — Add feurouge IPC call before executing command
- **`src/engine-executor.ts`** — May need to propagate agent identity
- **`src/spawn-agent.ts`** — Pass workspace context + agent ID to feurouge registration
- **`src/cli-main.ts`** — Start feurouge daemon after telecom daemon (within 60s)
- **`src/telecom/service/telecom-daemon.ts`** — Register spawned agents with feurouge

### 6.5 Daemon Permissions API

The daemon listens on a simple IPC channel (file-based or socket):

```typescript
// Request (from engine to daemon)
interface FeuRougeRequest {
  type: 'check_command'
  agentId: string
  agentPid: number
  command: string
  cwd: string
  workspace?: string  // Set if agent is confined to a project
  timestamp: string
}

// Response (from daemon to engine)
interface FeuRougeResponse {
  allowed: boolean
  reason?: string  // If blocked: explanation
  rule?: string    // Which rule was violated
}

// Registration (from spawn-agent to daemon)
interface FeuRougeRegistration {
  type: 'register_agent'
  agentId: string
  agentPid: number
  workspace?: string  // If confined to a project
  level: 'admin' | 'restricted' | 'confined' | 'readonly'
}
```

### 6.6 Startup Sequence

```
CLI démarre
  │
  ├── Démarre telecom-daemon (existant)
  │
  ├── Démarre DAEMON-feurouge-01 (NEW — dans les 60s)
  │       │
  │       ├── Lit data/permissions/permissions.yaml
  │       ├── Crée data/permissions/ si absent
  │       ├── Si permissions.yaml absent, crée avec défauts
  │       ├── Ouvre channel IPC
  │       └── Signal : prêt
  │
  └── Menu CLI affiché
```

---

## 7. Flow: Full Lifecycle

### 7.1 User Creates a New Project

```
User: "crée un projet React appelé ecommerce"
  │
  ▼
Alice: routes via intercom (subject: create-request)
  │
  ▼
Telecom Daemon: spawns agent-telecom
  │
  ▼
agent-telecom: forwards to orchestrateur
  │
  ▼
Orchestrateur:
  1. Checks workspaces/ — ecommerce/ doesn't exist
  2. Creates workspaces/ecommerce/
  3. Creates workspaces/ecommerce/.workspace (marker)
  4. Creates workspaces/ecommerce/.tasks.json (empty)
  5. Delegates to agent-scaffold-01 with mission:
     "Crée un projet React dans workspaces/ecommerce/"
  │
  ▼
agent-scaffold-01:
  - Works in workspaces/ecommerce/
  - Runs npx create-react-app
  - Feu Rouge ensures it can't write outside ecommerce/
  - On completion: updates .tasks.json via intercom
  │
  ▼
Orchestrateur:
  - Marks project as "initialized"
  - Notifies user via intercom → notification in CLI
```

### 7.2 User Requests Work on Existing Project

```
User: "ajoute un système d'authentification à ecommerce"
  │
  ▼
Alice: routes via intercom (subject: create-request or analysis-request)
  │
  ▼
Telecom Daemon → agent-telecom → orchestrateur
  │
  ▼
Orchestrateur:
  1. Reads workspaces/ecommerce/.tasks.json
  2. Checks if any backend task is already in progress
  3. Area "backend" → no current task → OK to assign
  4. Creates task: { id: "task-auth-01", area: "backend", title: "Auth", status: "in_progress" }
  5. Delegates to agent-builder with workspace context:
     "Mission: Implémenter JWT auth dans workspaces/ecommerce/
      Fichier .tasks.json: workspaces/ecommerce/.tasks.json
      Ta mission spécifique: ajouter authentification"
  │
  ▼
Agent spawns with:
  - Workspace: workspaces/ecommerce/
  - Level: confined
  - Feu Rouge enforces boundary
  │
  ▼
Agent completes → reports to orchestrateur via intercom
  │
  ▼
Orchestrateur:
  - Updates .tasks.json: task-auth-01 → done
  - If more backend tasks: assign next one sequentially
  - If frontend tasks exist: can assign in parallel
  - Notifies user
```

### 7.3 Parallel Work (Different Areas)

```
User: "en même temps, crée une page login sur le front"
  │
  ▼
Orchestrateur:
  1. Reads .tasks.json
  2. Backend task (auth) = in_progress (area: backend)
  3. Frontend task (login page) = area: frontend ← DIFFERENT
  4. → Can run in parallel!
  5. Creates task: { id: "task-login-01", area: "frontend", title: "Page login" }
  6. Delegates to a DIFFERENT agent instance
  │
  ▼
Agent A (backend): works in workspaces/ecommerce/backend/
Agent B (frontend): works in workspaces/ecommerce/frontend/
Both confined by Feu Rouge
Both report independently
```

### 7.4 Agent Violates Workspace Boundary

```
Agent tries: "cat ../../providers.json"
  │
  ▼
Engine sends check to Feurouge Daemon:
  { agentId: "agent-builder-02", command: "cat ../../providers.json", cwd: "workspaces/ecommerce/" }
  │
  ▼
Feurouge Daemon:
  1. Lookup agent-builder-02 → level: confined, workspace: "workspaces/ecommerce/"
  2. Path resolves to: workspaces/../../providers.json → normalized: providers.json
  3. Check: is "providers.json" in allowed_paths? No
  4. Check: is "providers.json" in forbidden_paths? Yes
  5. → BLOCKED
  │
  ▼
Engine returns to agent:
  [FEU ROUGE] Commande bloquée: "cat ../../providers.json"
  Raison: forbidden_paths contient "providers.json"
  Ton périmètre: workspaces/ecommerce/ uniquement
```

---

## 8. Edge Cases & Constraints

### 8.1 Agent Identity Propagation

The Feu Rouge daemon needs to know WHICH agent issued a command. Currently, `run_terminal_command` does not carry agent identity.

**Solution:** The engine must attach `agentId` and `agentPid` to each command check. This requires:
- `engine-runner.ts` or `engine-executor.ts` to include agent context
- `spawn-agent.ts` to register the agent with feurouge at startup
- `telecom-daemon.ts` to register spawned agents with feurouge

### 8.2 Path Traversal Attacks

Agents might try `../` or symlinks to escape workspace.

**Solution:** The feurouge daemon MUST resolve paths via `path.resolve()` before checking. Symlinks are resolved to their real path. If the resolved path is not within the allowed root → BLOCK.

### 8.3 Indirect Escapes via Git/NPM

Agent runs `npm install` which downloads packages. These go to `node_modules/` inside the workspace — that's fine. But what if the agent runs `git clone https://...` and tries to clone outside?

**Solution:** The feurouge daemon checks the WORKING DIRECTORY of the command, not just the command string. If `git clone` is run from inside the workspace, the destination stays within the workspace. If the command explicitly specifies a path outside → BLOCK.

### 8.4 What About Agents That Need Multiple Workspaces?

Rare but possible (e.g., a "merge" agent that needs to read two projects).

**Solution:** The orchestrateur can request a temporary exception via the feurouge daemon's API:
```typescript
interface FeuRougeTempAccess {
  type: 'grant_temp_access'
  agentId: string
  paths: string[]  // Additional paths for this agent only
  durationMs: number
}
```

### 8.5 Multiple Instances of the Same Agent

If `agent-builder-02` is spawned for `workspaces/ecommerce/` and also for `workspaces/blog/`, the two instances must have DIFFERENT workspaces.

**Solution:** The PID is the unique key in feurouge's tracking table. Each spawn creates a separate registration:

```yaml
# Daemon's in-memory table (not persisted)
current_agents:
  - agentId: agent-builder-02
    pid: 12345
    workspace: workspaces/ecommerce/
    level: confined
  - agentId: agent-builder-02
    pid: 12346
    workspace: workspaces/blog/
    level: confined
```

### 8.6 What About File Operations Outside `run_terminal_command`?

Currently, agents can only interact with the filesystem via `run_terminal_command` (shell commands). There's no `write_file` or `read_file` tool in the agent tool set. This means all FS operations go through the guardian/executor pipeline — which is exactly where feurouge intercepts.

**If** a future `write_file` or `read_file` tool is added, it MUST also go through feurouge.

### 8.7 Initial Permissions File Creation

When the user first installs / starts the system without a `permissions.yaml`:

1. Feurouge daemon checks `data/permissions/permissions.yaml`
2. If absent, creates it with sensible defaults:
   - `alice` → admin
   - `orchestrateur` → admin (restricted commands)
   - `agent-superviseur` → readonly
   - `agent-telecom` → admin
   - `DAEMON-superviseur-01` → admin
   - `DAEMON-feurouge-01` → admin
   - `*` → confined (with defaults)
3. Existing agents in `.agents/` are scanned and added to the file with `confined` level
4. User can then customize via `!permissions edit`

### 8.8 Workspace for Orphaned Agents

If an agent is spawned without a specific project (e.g., "analyse ce fichier"), it gets a temporary sandbox:

```
workspaces/.sandbox/<agent-id>-<timestamp>/
```

This sandbox is auto-cleaned after the agent exits (TTL: 1 hour).

---

## 9. Open Questions

The following questions still need user input to finalize the specification:

1. **Logging & audit**: Should feurouge violations be logged to a specific file? Notification level?
2. **Global `.tasks.json` vs per-project**: Should there be one task board per project, or a global one at `workspaces/.tasks.json`?
3. **Orchestrateur's workspace access**: Should orchestrateur have write access to `.tasks.json` files? Or only read, with write done by a dedicated task-manager agent?
4. **Fallback behavior**: If feurouge daemon crashes, should commands be ALLOWED (fail-open) or BLOCKED (fail-closed)?
5. **Startup delay**: 60s max to start feurouge — should it be faster? Should it block the CLI until ready?
6. **Nested workspaces**: Should projects be able to have sub-projects (e.g., `workspaces/ecommerce/admin-panel/`)?
7. **Permission inheritance**: If an agent has `confined` level, can it be temporarily promoted to `restricted` for a specific operation?

---

## 10. Appendices: File-by-File Impact

### 10.1 New Files to Create

| File | Purpose |
|------|---------|
| `src/feurouge/feurouge-daemon.ts` | Background daemon — intercepts commands, enforces permissions |
| `src/feurouge/permissions.ts` | Permissions loader (YAML parser), checker, in-memory cache |
| `src/feurouge/permissions-cli.ts` | CLI tool for runtime permission editing |
| `data/permissions/permissions.yaml` | Master permissions file (auto-created) |
| `src/project/project-manager.ts` | Project CRUD: create, init, list, delete |
| `src/project/task-board.ts` | Task board reader/writer (`.tasks.json`) |

### 10.2 Modified Files

| File | What changes |
|------|-------------|
| `src/types/agent-definition.ts` | Add `permissions?: {...}` field |
| `src/spawn-agent.ts` | Register agent with feurouge daemon; pass workspace context |
| `src/engine.ts` | Accept `cwd` override per session; inject feurouge IPC |
| `src/engine-guardian.ts` | Add feurouge check before command execution |
| `src/engine-executor.ts` | Add agent context to tool execution |
| `src/cli-main.ts` | Start feurouge daemon after telecom daemon |
| `src/telecom/service/telecom-daemon.ts` | Register spawned agents with feurouge |
| `src/cli-intercom-router.ts` | Add project-related subjects (project-init, task-assign) |
| `src/cli-menu.ts` | Add project management entries (if needed) |
| `src/cli-selector.ts` | Add project commands |
| `src/validate-agent.ts` | Add permission rules validation |
| `src/generate-skill.ts` | Inject workspace context into generated skills |
| `src/agents.ts` | Read/parse permissions field from agent definition |

### 10.3 Unchanged Files

| File | Reason |
|------|--------|
| `src/engine-llm.ts` | LLM communication — no FS access |
| `src/engine-sessions.ts` | Session management — no FS access |
| `src/engine-rate-limit.ts` | Rate limiting — no FS access |
| `src/engine-health.ts` | Health checks — no FS access |
| `src/engine-parser.ts` | Tool call parsing — no FS access |
| `src/notify.ts` | Notifications — no FS boundary concern |
| `src/skills.ts` | Skill loading — admin-only operation |
| `src/providers.ts` | Provider management — admin-only |
| `src/constants.ts` | Constants — no logic changes |
| `.agents/*.ts` | Agent definitions — content unchanged (permissions added in type) |
| `data/protocols/*` | PACO protocol — unchanged (works above this system) |
| `providers.json` | Provider config — no workspace concern |

---

*End of specification — workspace-isolation-spec.md*
