/**
 * Tests unitaires pour les modules CLI extraits
 * Exécution : node dist/unit-tests.js
 */

import type { Engine } from '../engine.js'

import type { IncomingMessage, ServerResponse } from 'http'

// ── Imports ESM (obligatoire car "type": "module") ──────

import { top15, safeExit } from '../constants.js'
import { DEFAULT_AGENT, getAgent } from '../cli-utils.js'
import { showMenu, showHelp } from '../cli-menu.js'
import { showBanner } from '../cli-banner.js'
import { logDaemonStarted, logSkillLoaded, logWelcomeMessage } from '../cli-startup.js'
import { handleUseAgent, handleListAgents } from '../cli-agents.js'
import { showSessions, showInfo } from '../cli-sessions.js'

// Vérification d'existence des exports des autres modules
import { handleManageProvidersMenu, handleProviderActions } from '../cli-providers.js'
import { handleProviders } from '../cli-providers-advanced.js'
import { handleCommandPicker } from '../cli-selector.js'
import { handleEditAgent } from '../cli-edit.js'
import { handleShellLine } from '../cli-runner.js'
import { main as cliMain } from '../cli-main.js'

// Module moteur — engine-runner.ts
import { createRunner } from '../engine-runner.js'
import type { ToolCall } from '../types/agent-definition.js'

// Module télécom — anti-boucle
import { tryRecordSpawn, resetSpawnHistory, MAX_SPAWNS_PER_AGENT, SPAWN_WINDOW_MS, loadTelecomConfig, showHelp as daemonShowHelp, resetStats } from '../telecom/service/telecom-daemon.js'

// ── Types ────────────────────────────────────────────────

interface MockSession {
  id: string
  messages: { role: string; content: { text?: string }[] }[]
  createdAt: Date
}

interface MockEngine {
  agent: {
    id: string
    displayName: string
    model: string
    instructionsPrompt?: string
    toolNames: string[]
  }
  getCurrentSession(): MockSession | null
  listSessions(): MockSession[]
  getSession(id: string): MockSession | null
  addMessage(role: string, content: string): void
  createSession(): void
  runPrompt(line: string): Promise<{ response: string; toolCalls: { toolName: string; input: unknown }[] }>
  callLLM(prompt: string, resolved: { provider: string; model: string; baseUrl: string; apiKey: string }, systemPrompt: string): Promise<string>
  spawnAgent(agentId: string, instruction: string): Promise<void>
  getInstructionsForAgent(sessionId: string): string
  listProviderModels(provider: string, apiKey: string, baseUrl: string): Promise<string[]>
}

const mockSession: MockSession = {
  id: 'sess-abc-12345',
  messages: [{ role: 'user', content: [{ text: 'hello' }] }],
  createdAt: new Date('2025-01-01T00:00:00Z'),
}

const mockSession2: MockSession = {
  id: 'sess-def-67890',
  messages: [],
  createdAt: new Date('2025-01-02T00:00:00Z'),
}

function makeMockEngine(): Engine {
  const base: MockEngine = {
    agent: {
      id: 'test-agent',
      displayName: 'Test Agent',
      model: 'kilo-auto/free',
      instructionsPrompt: 'Tu es un agent de test.',
      toolNames: ['run_terminal_command', 'add_message'],
    },
    getCurrentSession: () => mockSession,
    listSessions: () => [mockSession, mockSession2],
    getSession: () => null,
    addMessage: () => {},
    createSession: () => {},
    runPrompt: async () => ({ response: '', toolCalls: [] }),
    callLLM: async () => 'mock response',
    spawnAgent: async () => {},
    getInstructionsForAgent: () => '',
    listProviderModels: async () => [],
  }
  return base as unknown as Engine
}

// ── Helper: mock dependencies pour createRunner() ────────

function makeMockRunnerDeps(overrides?: Partial<{
  addMessageCalls: { role: string; content: string }[]
  commandOutputs: Map<string, string>
  processToolsResults: string[]
}>) {
  const addMessageCalls: { role: string; content: string }[] = []
  const commandOutputs = overrides?.commandOutputs || new Map<string, string>()

  return {
    deps: {
      addMessage: (role: 'user' | 'assistant', content: string) => {
        addMessageCalls.push({ role, content })
      },
      runTerminalCommand: async (command: string) => {
        return commandOutputs.get(command) || `output: ${command}`
      },
      checkRateLimit: async () => {},
      processTools: async (calls: ToolCall[]) => {
        const results = overrides?.processToolsResults
        if (results) return results
        return calls.map(() => 'mock-tool-result')
      },
      agent: {
        id: 'test-agent',
        selfCorrection: { enabled: false, maxRetries: 0, retryOnFailure: false },
        streaming: { enabled: false },
        rateLimit: { backoffMultiplier: 1 },
      },
    },
    addMessageCalls,
  }
}

// ── ANSI constants ───────────────────────────────────────

const RESET = '\x1b[0m'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const CYAN = '\x1b[36m'
const BOLD = '\x1b[1m'
const PASS = `${GREEN}✓${RESET}`
const FAIL = `${RED}✗${RESET}`

let passed = 0
let failed = 0

function assert(label: string, ok: boolean, detail?: string) {
  if (ok) { passed++; process.stdout.write(`  ${PASS} ${label}\n`) }
  else { failed++; process.stdout.write(`  ${FAIL} ${label}${detail ? ` — ${RED}${detail}${RESET}` : ''}\n`) }
}

// Helper: capture console.log dans un tableau avec restauration automatique
function withCapturedConsole(fn: (captured: string[]) => void): string[] {
  const captured: string[] = []
  const origLog = console.log
  console.log = (...args: unknown[]) => captured.push(args.map(String).join(' '))
  try {
    fn(captured)
  } finally {
    console.log = origLog
  }
  return captured
}

// ── Test: constants.ts — top15() ─────────────────────────

function testTop15() {
  console.log(`\n${BOLD}── constants.ts — top15()${RESET}`)

  // 1. Mettre les modèles :free en premier
  const mixed = ['gpt-4', 'gpt-4:free', 'claude-3', 'claude-3:free']
  const sorted = top15(mixed)
  assert('Les modèles :free apparaissent en premier',
    sorted[0] === 'gpt-4:free' && sorted[1] === 'claude-3:free',
    `got [${sorted.join(', ')}]`
  )

  // 2. Limiter à 15 résultats
  const many = Array.from({ length: 25 }, (_, i: number) => `model-${i}`)
  assert('Limité à 15 résultats maximum', top15(many).length === 15)

  // 3. TOP_MODELS prioritaires avant les inconnus
  const withTop = ['random-model', 'gpt-5', 'unknown']
  const result = top15(withTop)
  assert('TOP_MODELS (gpt-5) avant les modèles inconnus',
    result.indexOf('gpt-5') < result.indexOf('random-model'),
    `order: ${result.join(', ')}`
  )

  // 4. Fonctionne avec un tableau vide
  assert('Tableau vide → tableau vide',
    Array.isArray(top15([])) && top15([]).length === 0
  )

  // 5. Préserve les doublons
  const dups = ['model-a', 'model-b', 'model-a']
  const dedupResult = top15(dups)
  assert('Préserve les doublons',
    dedupResult.length === 3 && dedupResult.filter((m: string) => m === 'model-a').length === 2
  )
}

// ── Test: cli-utils.ts — DEFAULT_AGENT et getAgent() ─────

function testCliUtils() {
  console.log(`\n${BOLD}── cli-utils.ts — DEFAULT_AGENT & getAgent()${RESET}`)

  // 1. DEFAULT_AGENT a la bonne structure
  assert('DEFAULT_AGENT.id === "alice"', DEFAULT_AGENT.id === 'alice')
  assert('DEFAULT_AGENT.displayName === "Alice"', DEFAULT_AGENT.displayName === 'Alice')
  assert('DEFAULT_AGENT.model === "kilo-auto/free"', DEFAULT_AGENT.model === 'kilo-auto/free')
  assert('DEFAULT_AGENT a toolNames', Array.isArray(DEFAULT_AGENT.toolNames) && DEFAULT_AGENT.toolNames.length > 0)
  assert('DEFAULT_AGENT a instructionsPrompt',
    typeof DEFAULT_AGENT.instructionsPrompt === 'string' && DEFAULT_AGENT.instructionsPrompt.length > 10
  )

  // 2. getAgent() sans argument → DEFAULT_AGENT
  const defaultResult = getAgent([])
  assert('getAgent([]) retourne DEFAULT_AGENT',
    defaultResult.id === 'alice' && defaultResult.displayName === 'Alice'
  )

  // 3. getAgent() avec --agent (attention: --agent filepath charge un fichier,
  //    on ne peut pas tester ici car ça crashe si le fichier n'existe pas)
  //    On saute ce test car il nécessite un fichier valide sur disque.

  // 4. getAgent() avec --help (ni --agent ni -a) → DEFAULT_AGENT
  assert('getAgent(["--help"]) retourne DEFAULT_AGENT',
    getAgent(['--help']).id === 'alice'
  )
}

// ── Test: cli-startup.ts — logDaemonStarted(), logSkillLoaded(), logWelcomeMessage() ─

function testCliStartup() {
  console.log(`\n${BOLD}── cli-startup.ts — messages de démarrage${RESET}`)

  withCapturedConsole((captured) => {
    logDaemonStarted()
    const joined = captured.join('\n')
    assert('logDaemonStarted() affiche "Daemon telecom démarré"',
      joined.includes('Daemon telecom démarré'),
      `got: ${captured[0]}`
    )
  })

  withCapturedConsole((captured) => {
    logSkillLoaded()
    const joined = captured.join('\n')
    assert('logSkillLoaded() affiche "Skill"',
      joined.includes('Skill'),
      `lines: ${captured.slice(0, 2).join(' | ')}`
    )
    assert('logSkillLoaded() affiche le nom "skill-alice"',
      joined.includes('skill-alice'),
    )
    assert('logSkillLoaded() affiche la description de la skill',
      joined.includes('Lexique des scripts Alice'),
    )
  })

  withCapturedConsole((captured) => {
    logWelcomeMessage()
    const joined = captured.join('\n')
    assert('logWelcomeMessage() affiche "Bienvenue dans Minautor Agent Service"',
      joined.includes('Bienvenue dans Minautor Agent Service'),
      `got: ${captured.slice(0, 2).join(' | ')}`
    )
    assert('logWelcomeMessage() affiche un message de bienvenue',
      joined.includes('Bienvenue'),
    )
  })
}

// ── Test: cli-banner.ts — showBanner() ────────────────────

function testCliBanner() {
  console.log(`\n${BOLD}── cli-banner.ts — showBanner()${RESET}`)

  const engine = makeMockEngine()

  withCapturedConsole((captured) => {
    showBanner(engine)
    const joined = captured.join('\n')
    assert('Affiche le cadre du logo (▐ présent)',
      joined.includes('▐'),
      `lines: ${captured.slice(0, 3).join(' | ')}`
    )
    assert('Affiche le FIGlet MINAUTOR (_ présent)',
      joined.includes('_'),
    )
    assert('Affiche le nom de l\'agent',
      joined.includes('Test Agent'),
    )
    assert('Affiche l\'ID de session (tronqué)',
      joined.includes('sess-abc'),
      `got: ${captured.join(', ')}`
    )
  })
}

// ── Test: cli-menu.ts — showMenu() & showHelp() ──────────

function testCliMenu() {
  console.log(`\n${BOLD}── cli-menu.ts — showMenu() & showHelp()${RESET}`)

  const engine = makeMockEngine()

  withCapturedConsole((captured) => {
    showMenu(engine)
    assert('showMenu() affiche "Menu principal"',
      captured.some(l => l.includes('Menu principal')), `lines: ${captured.slice(0, 3).join(' | ')}`
    )
    assert('showMenu() affiche les options 1-9',
      captured.some(l => /[1-9]/.test(l))
    )
    assert('showMenu() affiche le hint "Ou tapez"',
      captured.some(l => l.includes('Ou tapez'))
    )
  })

  withCapturedConsole((captured) => {
    showHelp(engine)
    assert('showHelp() affiche "Minautor Agent Service"',
      captured.some(l => l.includes('Minautor')), `lines: ${captured.slice(0, 2).join(' | ')}`
    )
    assert('showHelp() affiche le modèle',
      captured.some(l => l.includes('kilo-auto/free'))
    )
    assert('showHelp() affiche les sections (Menu, Configuration, Agents, Sessions, Monitoring, Prompt modes)',
      captured.some(l => l.includes('Menu')) &&
      captured.some(l => l.includes('Configuration')) &&
      captured.some(l => l.includes('Agents')) &&
      captured.some(l => l.includes('Sessions')) &&
      captured.some(l => l.includes('Monitoring')) &&
      captured.some(l => l.includes('Prompt modes'))
    )
  })
}

// ── Test: cli-agents.ts — handleUseAgent() ───────────────

function testCliAgents() {
  console.log(`\n${BOLD}── cli-agents.ts — handleUseAgent()${RESET}`)

  const engine = makeMockEngine()

  withCapturedConsole((captured) => {
    const result = handleUseAgent([], engine)
    assert('handleUseAgent([]) retourne null', result === null)
    assert('handleUseAgent([]) affiche un message d\'usage',
      captured.some(l => l.includes('Usage')), `got: ${captured.join(', ')}`
    )
  })
}

// ── Test: cli-sessions.ts — showSessions() & showInfo() ──

function testCliSessions() {
  console.log(`\n${BOLD}── cli-sessions.ts — showSessions() & showInfo()${RESET}`)

  const engine = makeMockEngine()

  withCapturedConsole((captured) => {
    showSessions(engine)
    assert('showSessions() affiche "Sessions"',
      captured.some(l => l.includes('Sessions'))
    )
    assert('showSessions() affiche les IDs des sessions',
      captured.some(l => l.includes('sess-abc')) || captured.some(l => l.includes('abc-12345'))
    )
    assert('showSessions() marque la session active',
      captured.some(l => l.includes('active'))
    )
  })

  withCapturedConsole((captured) => {
    showInfo(engine)
    assert('showInfo() affiche les infos de la session active',
      captured.some(l => l.includes('Session:')) || captured.some(l => l.includes('sess-abc'))
    )
    assert('showInfo() affiche le nombre de messages',
      captured.some(l => l.includes('Messages:')) || captured.some(l => l.includes('messages'))
    )
  })
}

// ── Test: cli-agents.ts — handleListAgents() ─────────────

function testHandleListAgents() {
  console.log(`\n${BOLD}── cli-agents.ts — handleListAgents()${RESET}`)

  const engine = makeMockEngine()

  withCapturedConsole((captured) => {
    handleListAgents(engine)
    assert('handleListAgents() affiche "Agent actif"',
      captured.some(l => l.includes('Agent actif')), `lines: ${captured.slice(0, 3).join(' | ')}`
    )
    assert('handleListAgents() affiche le nom de l\'agent actif',
      captured.some(l => l.includes('Test Agent'))
    )
  })
}

// ── Test: engine-runner.ts — createRunner(), runPrompt() ──

async function testEngineRunner() {
  console.log(`\n${BOLD}── engine-runner.ts — createRunner() & runPrompt()${RESET}`)

  // 1. createRunner retourne les bonnes méthodes
  {
    const { deps } = makeMockRunnerDeps()
    const runner = createRunner(deps)
    assert('createRunner retourne runPrompt', typeof runner.runPrompt === 'function')
    assert('createRunner retourne callLLM', typeof runner.callLLM === 'function')
  }

  // 2. runPrompt — texte simple sans ! ni @
  {
    const { deps: d, addMessageCalls } = makeMockRunnerDeps()
    const r = createRunner(d)
    const result = await r.runPrompt('Bonjour, que peux-tu faire ?')
    assert('runPrompt(text) appelle addMessage avec le rôle user',
      addMessageCalls.length === 1 && addMessageCalls[0].role === 'user'
    )
    assert('runPrompt(text) inclut le texte dans la réponse',
      result.response.includes('Bonjour')
    )
    assert('runPrompt(text) retourne 0 toolCalls',
      result.toolCalls.length === 0
    )
  }

  // 3. runPrompt — avec !command
  {
    const { deps: d, addMessageCalls } = makeMockRunnerDeps({
      commandOutputs: new Map([['echo hello', 'hello world']]),
    })
    const r = createRunner(d)
    const result = await r.runPrompt('!echo hello')
    assert('runPrompt(!cmd) appelle runTerminalCommand',
      result.response.includes('hello world'),
      `got: ${result.response}`
    )
    assert('runPrompt(!cmd) crée un ToolCall run_terminal_command',
      result.toolCalls.length === 1 &&
      result.toolCalls[0].toolName === 'run_terminal_command' &&
      (result.toolCalls[0].input as { command: string }).command === 'echo hello',
      `toolCalls: ${JSON.stringify(result.toolCalls)}`
    )
    assert('runPrompt(!cmd) appelle addMessage avec le rôle user',
      addMessageCalls.length === 1 && addMessageCalls[0].role === 'user'
    )
  }

  // 4. runPrompt — avec @message
  {
    const { deps: d, addMessageCalls } = makeMockRunnerDeps()
    const r = createRunner(d)
    const result = await r.runPrompt('@Voici une réponse automatique')
    assert('runPrompt(@msg) appelle addMessage avec le rôle assistant',
      addMessageCalls.some(c => c.role === 'assistant' && c.content.includes('Voici')),
      `calls: ${JSON.stringify(addMessageCalls)}`
    )
    assert('runPrompt(@msg) crée un ToolCall add_message',
      result.toolCalls.length === 1 &&
      result.toolCalls[0].toolName === 'add_message',
      `toolCalls: ${JSON.stringify(result.toolCalls)}`
    )
  }

  // 5. runPrompt — mixte (texte + !command + @message)
  {
    const { deps: d, addMessageCalls } = makeMockRunnerDeps({
      commandOutputs: new Map([['ls', 'file1.txt\nfile2.txt']]),
    })
    const r = createRunner(d)
    const result = await r.runPrompt('Fais ceci :\n!ls\nEnsuite cela :\n@Message ajouté')
    assert('runPrompt(mixte) crée 2 toolCalls (command + message)',
      result.toolCalls.length === 2,
      `got ${result.toolCalls.length} toolCalls`
    )
    assert('runPrompt(mixte) premier toolCall = run_terminal_command',
      result.toolCalls[0].toolName === 'run_terminal_command'
    )
    assert('runPrompt(mixte) second toolCall = add_message',
      result.toolCalls[1].toolName === 'add_message'
    )
    assert('runPrompt(mixte) réponse contient stdout de la commande',
      result.response.includes('file1.txt')
    )
    assert('runPrompt(mixte) addMessage appelée 2 fois (user + assistant)',
      addMessageCalls.length === 2
    )
  }

  // 6. runPrompt — !command avec espacement (trailing spaces)
  {
    const { deps: d } = makeMockRunnerDeps()
    const r = createRunner(d)
    const result = await r.runPrompt('!node --version  ')
    assert('runPrompt(!cmd avec trailing spaces) extrait et trim la commande',
      result.toolCalls.length === 1 &&
      (result.toolCalls[0].input as { command: string }).command === 'node --version',
      `toolCalls: ${JSON.stringify(result.toolCalls)}`
    )
  }

  // 7. runPrompt — prompt vide
  {
    const { deps: d } = makeMockRunnerDeps()
    const r = createRunner(d)
    const result = await r.runPrompt('')
    assert('runPrompt(vide) retourne réponse vide', result.response === '')
    assert('runPrompt(vide) retourne 0 toolCalls', result.toolCalls.length === 0)
  }

  // 8. callLLM — via un serveur HTTP local mock
  {
    const httpMod = await import('http')
    const server = httpMod.createServer((_req: IncomingMessage, res: ServerResponse) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        choices: [{ message: { content: 'Bonjour, je suis le serveur mock !' } }]
      }))
    })

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const addr = server.address()
    const port = addr && typeof addr === 'object' ? addr.port : 0

    try {
      const { deps: d } = makeMockRunnerDeps()
      const r = createRunner(d)
      const result = await r.callLLM(
        'Dis bonjour',
        {
          provider: 'custom',
          model: 'test-model',
          baseUrl: `http://127.0.0.1:${port}`,
          apiKey: 'test-key',
        },
        'Tu es un assistant de test',
      )
      assert('callLLM retourne la réponse du serveur mock',
        result.includes('serveur mock'),
        `response: ${result}`
      )
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }

  // 9. callLLM — sans streaming, réponse minimale
  {
    const httpMod = await import('http')
    const server = httpMod.createServer((_req: IncomingMessage, res: ServerResponse) => {
      let body = ''
      _req.on('data', (chunk: Buffer) => { body += chunk.toString() })
      _req.on('end', () => {
        const parsed = JSON.parse(body)
        assert('callLLM envoie les bons paramètres',
          parsed.model === 'custom-model' &&
          Array.isArray(parsed.messages) &&
          parsed.messages.length === 2
        )
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          choices: [{ message: { content: 'Réponse minimale.' } }]
        }))
      })
    })

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const addr = server.address()
    const port = addr && typeof addr === 'object' ? addr.port : 0

    try {
      const { deps: d } = makeMockRunnerDeps()
      const r = createRunner(d)
      const result = await r.callLLM(
        'Test',
        {
          provider: 'custom',
          model: 'custom-model',
          baseUrl: `http://127.0.0.1:${port}`,
          apiKey: 'test',
        },
        'System prompt',
      )
      assert('callLLM fonctionne en mode non-streaming',
        result.includes('Réponse minimale'),
        `response: ${result}`
      )
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}

// ── Test: telecom-daemon.ts — loadTelecomConfig() ───────────

function testLoadTelecomConfig() {
  console.log(`\n${BOLD}── telecom-daemon.ts — loadTelecomConfig()${RESET}`)

  // 1. Pas de fichier de config → valeurs par défaut
  const def = loadTelecomConfig()
  assert('maxSpawnsPerAgent par défaut = 3', def.maxSpawnsPerAgent === 3, `got ${def.maxSpawnsPerAgent}`)
  assert('spawnWindowMs par défaut = 300000', def.spawnWindowMs === 300000, `got ${def.spawnWindowMs}`)

  // 2. Les constantes exportées reflètent la config (pas de fichier → défaut)
  assert('MAX_SPAWNS_PER_AGENT = 3 (depuis config défaut)', MAX_SPAWNS_PER_AGENT === 3, `got ${MAX_SPAWNS_PER_AGENT}`)
  assert('SPAWN_WINDOW_MS = 300000 (depuis config défaut)', SPAWN_WINDOW_MS === 300000, `got ${SPAWN_WINDOW_MS}`)
}

// ── Test: telecom-daemon.ts — tryRecordSpawn() anti-boucle ──

function testTryRecordSpawn() {
  console.log(`\n${BOLD}── telecom-daemon.ts — tryRecordSpawn() anti-boucle${RESET}`)

  // Vérifier les constantes de configuration
  assert('MAX_SPAWNS_PER_AGENT = 3', MAX_SPAWNS_PER_AGENT === 3, `got ${MAX_SPAWNS_PER_AGENT}`)
  assert('SPAWN_WINDOW_MS = 5 min (300000ms)', SPAWN_WINDOW_MS === 300000, `got ${SPAWN_WINDOW_MS}`)

  resetSpawnHistory()

  // 1. Premier spawn → autorisé
  assert('1er spawn accepté', tryRecordSpawn('agent-X', 0) === true)

  // 2. Deuxième spawn rapide → autorisé
  assert('2e spawn accepté', tryRecordSpawn('agent-X', 100) === true)

  // 3. Troisième spawn rapide → autorisé (limite pas encore atteinte)
  assert('3e spawn accepté', tryRecordSpawn('agent-X', 200) === true)

  // 4. Quatrième spawn rapide → BLOQUÉ (3 dans la fenêtre)
  assert('4e spawn bloqué (limite 3 dépassée)', tryRecordSpawn('agent-X', 300) === false)

  // 5. Un agent différent n'est pas impacté
  assert('Agent Y non impacté par le blocage de X', tryRecordSpawn('agent-Y', 400) === true)

  // 6. Après 5 min + 1ms, le premier spawn expire → nouveau spawn accepté
  //    SPAWN_WINDOW_MS = 300000, donc à t=300001, le spawn de t=0 est hors fenêtre
  //    Il reste t=100 et t=200 (2 spawns) → 3e autorisé
  assert('5 min après : nouveau spawn accepté (ancien expiré)',
    tryRecordSpawn('agent-X', SPAWN_WINDOW_MS + 1) === true,
    `à t=${SPAWN_WINDOW_MS + 1}`
  )

  // 7. Vérifier que le 4e juste après est bloqué (les 3 anciens sont encore dans la fenêtre)
  assert('4e spawn bloqué juste après (3 spawns encore dans la fenêtre)',
    tryRecordSpawn('agent-X', SPAWN_WINDOW_MS + 4) === false
  )

  // 8. Nettoyage
  resetSpawnHistory()
  assert('Historique vide après reset', tryRecordSpawn('agent-X', 0) === true)
}

// ── Test: telecom-daemon.ts — resetStats() ────────────────

function testResetStats() {
  console.log(`\n${BOLD}── telecom-daemon.ts — resetStats()${RESET}`)

  withCapturedConsole((captured) => {
    resetStats()
    const joined = captured.join('\n')

    assert('Logge "Statistiques reinitialisees"',
      joined.includes('Statistiques reinitialisees'),
      `got: ${captured.slice(0, 2).join(' | ')}`
    )
  })
}

// ── Test: telecom-daemon.ts — showHelp() ──────────────────

function testShowHelp() {
  console.log(`\n${BOLD}── telecom-daemon.ts — showHelp()${RESET}`)

  withCapturedConsole((captured) => {
    daemonShowHelp()
    const joined = captured.join('\n')

    assert('Affiche l\'en-tête "TELECOM DAEMON — Aide"',
      joined.includes('TELECOM DAEMON'),
      `lines: ${captured.slice(0, 3).join(' | ')}`
    )
    assert('Affiche la section DESCRIPTION',
      joined.includes('DESCRIPTION'),
    )
    assert('Affiche la section DOSSIERS SURVEILLES',
      joined.includes('DOSSIERS SURVEILLES'),
    )
    assert('Affiche les dossiers surveillés (Intercom, Routage, Agents, Config, PID)',
      joined.includes('Intercom') &&
      joined.includes('Routage') &&
      joined.includes('Agents') &&
      joined.includes('Config') &&
      joined.includes('PID'),
      `chemins: ${captured.filter(l => l.includes(':')).slice(0, 5).join(' | ')}`
    )
    assert('Affiche la section CONFIGURATION ANTI-BOUCLE',
      joined.includes('CONFIGURATION ANTI-BOUCLE'),
    )
    assert('Affiche maxSpawnsPerAgent et spawnWindowMs',
      joined.includes('maxSpawnsPerAgent') &&
      joined.includes('spawnWindowMs'),
      `lignes config: ${captured.filter(l => l.includes('spawn')).join(' | ')}`
    )
    assert('Affiche la section COMMANDES',
      joined.includes('COMMANDES'),
    )
    assert('Affiche les commandes --help, --once',
      joined.includes('--help') &&
      joined.includes('--once'),
    )
    assert('Affiche l\'intervalle de polling',
      joined.includes('INTERVALLE DE POLLING'),
    )
  })
}

// ── Tests d\'existence des exports ─────────────────────────

function testExports() {
  console.log(`\n${BOLD}── Vérification des exports de tous les modules${RESET}`)

  assert('cli-runner.ts: handleShellLine exportée', typeof handleShellLine === 'function')
  assert('cli-providers.ts: handleManageProvidersMenu exportée', typeof handleManageProvidersMenu === 'function')
  assert('cli-providers.ts: handleProviderActions exportée', typeof handleProviderActions === 'function')
  assert('cli-providers-advanced.ts: handleProviders exportée', typeof handleProviders === 'function')
  assert('cli-selector.ts: handleCommandPicker exportée', typeof handleCommandPicker === 'function')
  assert('cli-edit.ts: handleEditAgent exportée', typeof handleEditAgent === 'function')
  assert('cli-main.ts: main exportée', typeof cliMain === 'function')
}

// ── Main ─────────────────────────────────────────────────

async function main() {
  console.log(`\n${BOLD}${CYAN}═══════════════════════════════════════════${RESET}`)
  console.log(`${BOLD}${CYAN}  TESTS UNITAIRES : Modules CLI${RESET}`)
  console.log(`${BOLD}${CYAN}═══════════════════════════════════════════${RESET}\n`)

  testTop15()
  testCliUtils()
  testCliStartup()
  testCliBanner()
  testCliMenu()
  testCliAgents()
  testCliSessions()
  testHandleListAgents()
  await testEngineRunner()
  testLoadTelecomConfig()
  testTryRecordSpawn()
  testResetStats()
  testShowHelp()
  testExports()

  // ── Résumé ──
  const total = passed + failed
  console.log(`\n${BOLD}${CYAN}═══════════════════════════════════════════${RESET}`)
  console.log(`${BOLD}${CYAN}  RÉSULTATS : ${passed}/${total} tests OK${RESET}`)
  if (failed > 0) console.log(`${BOLD}${RED}  ${failed} ÉCHEC(S) — voir ci-dessus${RESET}`)
  else console.log(`${BOLD}${GREEN}  TOUS LES TESTS SONT PASSÉS${RESET}`)
  console.log(`${BOLD}${CYAN}═══════════════════════════════════════════${RESET}\n`)

  safeExit(failed > 0 ? 1 : 0)
}

main().catch(err => {
  console.error(`${RED}Test crash : ${err.message}${RESET}`)
  safeExit(1)
})
