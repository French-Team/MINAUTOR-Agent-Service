/**
 * Tests de charge et performance — Mesure le comportement sous stress
 * des composants clés du système.
 *
 * Usage : npx tsx src/load-tests.ts
 *
 * Ne fait aucun appel réseau ni sous-processus réel.
 */

// ── Imports ──────────────────────────────────────────────────────────

import { top15, safeExit } from './constants.js'
import { createEngine } from './engine.js'
import { createRunner } from './engine-runner.js'
import type { AgentDefinition } from './types/agent-definition.js'
import {
  resolveProviderForModel,
  getNextApiKey,
  markRateLimited,
  addProvider,
  removeProvider,
  listProviders,
  getProviderConfigPath,
} from './providers.js'
import {
  sanitizeNotificationMessage,
  levelIcon,
  listLevels,
  peekNotifications,
  countPendingNotifications,
  removeNotification as removeNotifyEntry,
  getNotifyPath,
} from './notify.js'
import { listLocalAgents, readLocalAgent } from './agents.js'
import type { ToolCall } from './types/agent-definition.js'

// ── ANSI / Formatting ────────────────────────────────────────────────

const RESET = '\x1b[0m'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const CYAN = '\x1b[36m'
const GRAY = '\x1b[90m'
const BOLD = '\x1b[1m'

interface MetricResult {
  label: string
  opsPerSec: number
  latencyMs: number
  durationMs: number
  heapDelta: number       // bytes
  cpuUserDelta: number    // µs
  cpuSystemDelta: number  // µs
}

const results: MetricResult[] = []
let passed = 0
let failed = 0

function assert(label: string, ok: boolean, detail?: string) {
  if (ok) { passed++; process.stdout.write(`  ${GREEN}\u2713${RESET} ${label}\n`) }
  else { failed++; process.stdout.write(`  ${RED}\u2717${RESET} ${label}${detail ? ` \u2014 ${RED}${detail}${RESET}` : ''}\n`) }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(1)} KB`
  return `${bytes} B`
}

function formatCpu(\u00b5s: number): string {
  if (\u00b5s >= 1_000_000) return `${(\u00b5s / 1_000_000).toFixed(2)}s`
  if (\u00b5s >= 1_000) return `${(\u00b5s / 1_000).toFixed(1)}ms`
  return `${\u00b5s}\u00b5s`
}

async function benchmark(label: string, iterations: number, fn: () => void | Promise<void>, minOpsPerSec?: number): Promise<void> {
  // Capturer m\u00e9moire et CPU avant warmup (\u00e9tat stable)
  const memBefore = process.memoryUsage().heapUsed
  const cpuBefore = process.cpuUsage()

  // Warmup
  for (let i = 0; i < Math.min(10, iterations); i++) await fn()

  const start = Date.now()
  for (let i = 0; i < iterations; i++) await fn()
  const durationMs = Date.now() - start

  // Capturer apr\u00e8s la boucle principale
  const memAfter = process.memoryUsage().heapUsed
  const cpuAfter = process.cpuUsage(cpuBefore) // diff par rapport \u00e0 cpuBefore

  const heapDelta = memAfter - memBefore
  const cpuUserDelta = cpuAfter.user
  const cpuSystemDelta = cpuAfter.system

  const opsPerSec = durationMs > 0 ? Math.round((iterations / durationMs) * 1000) : Infinity
  const latencyMs = durationMs > 0 ? Math.round((durationMs / iterations) * 1000) / 1000 : 0

  results.push({ label, opsPerSec, latencyMs, durationMs, heapDelta, cpuUserDelta, cpuSystemDelta })

  const durStr = durationMs >= 1000 ? `${(durationMs / 1000).toFixed(1)}s` : `${durationMs}ms`
  const opsStr = opsPerSec >= 1_000_000 ? `${(opsPerSec / 1_000_000).toFixed(1)}M ops/s` : `${opsPerSec.toLocaleString()} ops/s`
  const memStr = heapDelta >= 0 ? `+${formatBytes(heapDelta)}` : formatBytes(heapDelta)
  const cpuStr = `${formatCpu(cpuUserDelta)} user / ${formatCpu(cpuSystemDelta)} sys`

  if (minOpsPerSec !== undefined && opsPerSec < minOpsPerSec) {
    process.stdout.write(`  ${RED}\uD83D\uDD3B${RESET} ${label.padEnd(36)} ${RED}${opsStr}${RESET}  ${GRAY}(${latencyMs}ms/op, ${durStr})${RESET}\n`)
    process.stdout.write(`       ${GRAY}\uD83D\uDCBE ${memStr}  \uD83D\uDDA5\uFE0F ${cpuStr}${RESET}\n`)
    process.stdout.write(`       ${RED}Seuil non atteint : ${opsPerSec.toLocaleString()} < ${minOpsPerSec.toLocaleString()} ops/s${RESET}\n`)
    failed++
  } else {
    process.stdout.write(`  ${CYAN}\u26A1${RESET} ${label.padEnd(36)} ${GREEN}${opsStr}${RESET}  ${GRAY}(${latencyMs}ms/op, ${durStr})${RESET}\n`)
    process.stdout.write(`       ${GRAY}\uD83D\uDCBE ${memStr}  \uD83D\uDDA5\uFE0F ${cpuStr}${RESET}\n`)
    if (minOpsPerSec !== undefined) {
      passed++
    }
  }
}

// ── Tests de charge 1 : Providers \u2014 Key rotation \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

async function loadTestKeyRotation() {
  process.stdout.write(`\n${BOLD}\u2500\u2500 Providers \u2014 Key Rotation (10 000 rotations)${RESET}\n`)

  // Mettre en place un provider avec 5 cl\u00e9s pour tester l'alternateur
  const configPath = getProviderConfigPath()

  // Sauvegarder l'\u00e9tat initial
  const fs = await import('fs')
  const originalConfig = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf-8') : null

  try {
    // Ajouter un provider de test avec 5 cl\u00e9s
    addProvider({
      name: 'LoadTest Provider',
      provider: 'kilo',
      apiKeys: ['key-alpha', 'key-beta', 'key-gamma', 'key-delta', 'key-epsilon'],
      baseUrl: 'https://api.test.local',
      defaultModel: 'test-model',
      enabled: true,
    })

    await benchmark('getNextApiKey rotation (5 keys)', 10000, () => {
      getNextApiKey('kilo')
    }, 1_000)

    // Simuler 5 rate-limits cons\u00e9cutifs pour toutes les cl\u00e9s
    await benchmark('markRateLimited failover (5 calls)', 1000, () => {
      markRateLimited('key-alpha', 100)
    }, 1_000)

    // Marquer toutes les 5 cl\u00e9s comme rate-limited
    markRateLimited('key-beta', 60000)
    markRateLimited('key-gamma', 60000)
    markRateLimited('key-delta', 60000)
    markRateLimited('key-epsilon', 60000)

    assert('getNextApiKey retourne undefined (5/5 keys rate-limited)',
      getNextApiKey('kilo') === undefined
    )

    {
      const result = resolveProviderForModel('test-model')
      assert('resolveProviderForModel trouve le provider',
        result !== undefined && result.provider === 'kilo'
      )
    }

  } finally {
    removeProvider('LoadTest Provider')
    if (originalConfig) fs.writeFileSync(configPath, originalConfig, 'utf-8')
  }
}

// ── Tests de charge 2 : Providers \u2014 CRUD op\u00e9rations \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

async function loadTestProviderCRUD() {
  process.stdout.write(`\n${BOLD}\u2500\u2500 Providers \u2014 CRUD (10 000 op\u00e9rations)${RESET}\n`)

  try {
    await benchmark('addProvider (2 000 cr\u00e9ations)', 2000, () => {
      addProvider({
        name: `CRUD-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        provider: 'custom',
        apiKeys: ['test-key'],
        baseUrl: 'https://x.com',
        defaultModel: 'm',
        enabled: true,
      })
    }, 25)
  } finally {
    // Nettoyer tous les providers CRUD- cr\u00e9\u00e9s, m\u00eame si le bench crash
    const { listProviders } = await import('./providers.js')
    const all = listProviders()
    for (const p of all) {
      if (p && p.name && p.name.startsWith('CRUD-')) removeProvider(p.name)
    }
  }
}

// ── Tests de charge 3 : Notifications \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

async function loadTestNotifications() {
  process.stdout.write(`\n${BOLD}\u2500\u2500 Notifications \u2014 sanitize / icon / levels (50 000 op\u00e9rations)${RESET}\n`)

  const messages = [
    'Rapport termin\u00e9 avec succ\u00e8s',
    '```json\n{"status":"ok"}\n```\nLe d\u00e9ploiement est termin\u00e9.',
    '\uD83D\uDD34 Erreur: `TypeError: x is not a function` dans le module auth',
    '<from>alice</from><to>bob</to><type>request</type>',
    'node server.js && npm run build',
    '> git push origin main',
    '$ export API_KEY=secret',
    'cd /var/www && npm install',
    '\u2705 T\u00e2che accomplie \u2014 voir le rapport ci-joint pour les d\u00e9tails',
    '```\n$ curl -X POST https://api.test.local/v1/endpoint\n```\nR\u00e9ponse re\u00e7ue avec succ\u00e8s.',
  ]

  await benchmark('sanitizeNotificationMessage (50 000 appels)', 50000, () => {
    for (const msg of messages) sanitizeNotificationMessage(msg)
  }, 30_000)

  await benchmark('levelIcon lookup (50 000 appels)', 50000, () => {
    levelIcon('urgent')
    levelIcon('info')
    levelIcon('avertissement')
    levelIcon('conclusion')
    levelIcon('off')
  }, 5_000_000)

  await benchmark('listLevels (10 000 appels)', 10000, () => {
    listLevels()
  }, 5_000_000)
}

// ── Tests de charge 4 : Engine Runner \u2014 runPrompt \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

async function loadTestEngineRunner() {
  process.stdout.write(`\n${BOLD}\u2500\u2500 Engine Runner \u2014 runPrompt (5 000 prompts)${RESET}\n`)

  const addMessageCalls: { role: string; content: string }[] = []
  const deps = {
    addMessage: (role: 'user' | 'assistant', content: string) => {
      addMessageCalls.push({ role, content })
    },
    runTerminalCommand: async (command: string) => `output: ${command}`,
    checkRateLimit: async () => {},
    processTools: async (calls: ToolCall[]) => calls.map(() => 'mock-tool-result'),
    agent: {
      selfCorrection: { enabled: false, maxRetries: 0, retryOnFailure: false },
      streaming: { enabled: false },
      rateLimit: { backoffMultiplier: 1 },
    },
  }

  const runner = createRunner(deps)

  const prompts = [
    'Bonjour, que peux-tu faire ?',
    '!echo hello world',
    '@Message automatique',
    'Fais ceci:\n!ls\nEnsuite:\n@Ajout\u00e9',
    '!node --version  ',
  ]

  // runPrompt est async \u2014 il faut await chaque appel pour mesurer le temps r\u00e9el

  await benchmark('runPrompt (5 000 prompts, 5 patterns)', 5000, async () => {
    for (const p of prompts) await runner.runPrompt(p)
  }, 30_000)
}

// ── Tests de charge 5 : Constants \u2014 top15 tri \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

async function loadTestTop15() {
  process.stdout.write(`\n${BOLD}\u2500\u2500 Constants \u2014 top15() (10 000 tris)${RESET}\n`)

  // G\u00e9n\u00e9rer un tableau de mod\u00e8les r\u00e9aliste
  const generateModels = (n: number): string[] =>
    Array.from({ length: n }, (_, i) => {
      if (i % 5 === 0) return `model-${i}:free`
      if (i % 7 === 0) return 'gpt-5'
      return `model-${i}`
    })

  const smallSet = generateModels(15)
  const largeSet = generateModels(100)

  await benchmark('top15 (15 entr\u00e9es, 10 000 appels)', 10000, () => {
    top15(smallSet)
  }, 100_000)

  await benchmark('top15 (100 entr\u00e9es, 10 000 appels)', 10000, () => {
    top15(largeSet)
  }, 15_000)
}

// ── Tests de charge 6 : Agents \u2014 CRUD (sans fichier) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

async function loadTestAgentCRUD() {
  process.stdout.write(`\n${BOLD}\u2500\u2500 Agents \u2014 listLocalAgents() (5 000 appels)${RESET}\n`)

  await benchmark('listLocalAgents (5 000 appels)', 5000, () => {
    listLocalAgents()
  }, 800)
}

// ── Tests de charge 7 : R\u00e9solution Provider/Mod\u00e8le \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

async function loadTestProviderResolution() {
  process.stdout.write(`\n${BOLD}\u2500\u2500 Providers \u2014 resolveProviderForModel (5 000 r\u00e9solutions)${RESET}\n`)

  // Sauvegarder l'\u00e9tat initial
  const configPath = getProviderConfigPath()
  const fs = await import('fs')
  const originalConfig = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf-8') : null

  try {
    // S'assurer qu'il y a des providers activ\u00e9s pour la r\u00e9solution
    addProvider({
      name: 'ResolveTest Kilo',
      provider: 'kilo',
      apiKeys: ['test-key'],
      baseUrl: 'https://api.kilo.ai',
      defaultModel: 'kilo/kilo-auto/free',
      enabled: true,
    })

    const models = [
      'kilo/kilo-auto/free',
      'gemini-2.5-flash',
      'openrouter/free',
      'opencode-zen/default',
      'llama3.2',
      'inconnu-model',
      'gpt-4',
    ]

    await benchmark('resolveProviderForModel (5 000 r\u00e9solutions, 7 patterns)', 5000, () => {
      for (const m of models) resolveProviderForModel(m)
    }, 200)
  } finally {
    removeProvider('ResolveTest Kilo')
    if (originalConfig) fs.writeFileSync(configPath, originalConfig, 'utf-8')
  }
}

// ── Tests de charge 8 : Moteur complet \u2014 createEngine + sessions + callLLM \u2500\u2500

async function loadTestFullEngine() {
  process.stdout.write(`\n${BOLD}\u2500\u2500 Moteur complet \u2014 createEngine + sessions + callLLM (mock\u00e9)${RESET}\n`)

  // Sauvegarder fetch original et le remplacer par un mock ultra-rapide
  const originalFetch = globalThis.fetch

  // Mock fetch pour internalCallLLM \u2014 retourne une r\u00e9ponse factice sans r\u00e9seau
  const mockResponse = JSON.stringify({
    choices: [{ message: { content: 'Mock response charge.' } }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  })
  globalThis.fetch = async (_url: RequestInfo | URL, _init?: RequestInit) =>
    new Response(mockResponse, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })

  try {
    // Cr\u00e9er une config agent minimale pour createEngine
    const agent: AgentDefinition = {
      id: 'load-test-engine',
      displayName: 'Load Test Engine',
      model: 'kilo/kilo-auto/free',
      provider: 'kilo',
      instructionsPrompt: 'Tu es un assistant de test pour les benchmarks.',
      toolNames: [],
      rateLimit: {
        enabled: false,
        requestsPerMinute: 60,
        burst: 10,
        backoffMultiplier: 1,
      },
      guardian: {
        enabled: false,
        blockHarmful: false,
        requireConfirmation: false,
        auditTrail: false,
      },
      healthCheck: {
        enabled: false,
        checkIntervalMs: 60000,
        maxConsecutiveFailures: 3,
        autoRestart: false,
        maxRestarts: 0,
      },
      selfCorrection: {
        enabled: false,
        retryOnFailure: false,
        maxRetries: 0,
        validateOutput: false,
      },
      streaming: {
        enabled: false,
        chunkSize: 50,
        showThinking: false,
      },
      toolConfig: {
        parallelTools: false,
        toolTimeoutMs: 30000,
        maxParallel: 1,
      },
    }

    const engine = createEngine({ agent })

    await benchmark('createSession (5 000 sessions)', 5000, () => {
      engine.createSession()
    }, 250_000)

    // Cr\u00e9er une session de travail pour les benchmarks suivants
    engine.createSession()

    await benchmark('addMessage + getCurrentSession (10 000 ops)', 10000, () => {
      engine.addMessage('user', 'Un message de test pour la charge.')
      engine.getCurrentSession()
    }, 500_000)

    await benchmark('listSessions (5 000 appels)', 5000, () => {
      engine.listSessions()
    }, 10_000)

    // Benchmark callLLM \u2014 mock\u00e9, aucun r\u00e9seau r\u00e9el
    const llm = {
      provider: 'kilo',
      apiKey: 'mock-key',
      baseUrl: 'https://api.mock.local/v1',
      model: 'kilo/kilo-auto/free',
    }

    await benchmark('callLLM (5 000 appels, mock\u00e9)', 5000, async () => {
      await engine.callLLM(
        'Quel est le sens de la vie ?',
        llm,
        'Tu r\u00e9ponds toujours par 42.',
      )
    }, 20)

    // V\u00e9rifier que les sessions accumulent bien des messages
    const session = engine.getCurrentSession()
    assert('session cr\u00e9\u00e9e et accessible', session !== undefined)
    assert('session contient des messages',
      (session?.messages.length ?? 0) > 0
    )
    assert('listSessions non vide apr\u00e8s cr\u00e9ation',
      engine.listSessions().length >= 1
    )

  } finally {
    // Restaurer fetch original
    globalThis.fetch = originalFetch
  }
}

// ── Aide : Benchmark concurrentiel (Promise.all par batches) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

async function benchmarkConcurrent(
  label: string,
  totalOps: number,
  concurrency: number,
  fn: () => Promise<unknown>,
  minOpsPerSec?: number,
): Promise<void> {
  // Note : le warmup ci-dessous consomme concurrency appels fn()
  // L'appelant doit pr\u00e9voir cette consommation si fn() a des effets de bord (ex: names[])

  // Capturer m\u00e9moire et CPU avant warmup
  const memBefore = process.memoryUsage().heapUsed
  const cpuBefore = process.cpuUsage()

  // Warmup : une batch
  const warmupBatch = Array.from({ length: concurrency }, () => fn())
  await Promise.all(warmupBatch)

  const start = Date.now()
  let remaining = totalOps
  while (remaining > 0) {
    const batchSize = Math.min(concurrency, remaining)
    const batch = Array.from({ length: batchSize }, () => fn())
    await Promise.all(batch)
    remaining -= batchSize
  }
  const durationMs = Date.now() - start

  // Capturer apr\u00e8s la boucle principale
  const memAfter = process.memoryUsage().heapUsed
  const cpuAfter = process.cpuUsage(cpuBefore)

  const heapDelta = memAfter - memBefore
  const cpuUserDelta = cpuAfter.user
  const cpuSystemDelta = cpuAfter.system

  const opsPerSec = durationMs > 0 ? Math.round((totalOps / durationMs) * 1000) : Infinity
  const latencyMs = durationMs > 0 ? Math.round((durationMs / totalOps) * 1000) / 1000 : 0

  results.push({ label, opsPerSec, latencyMs, durationMs, heapDelta, cpuUserDelta, cpuSystemDelta })

  const durStr = durationMs >= 1000 ? `${(durationMs / 1000).toFixed(1)}s` : `${durationMs}ms`
  const opsStr = opsPerSec >= 1_000_000 ? `${(opsPerSec / 1_000_000).toFixed(1)}M ops/s` : `${opsPerSec.toLocaleString()} ops/s`
  const tag = `[concurrency=${concurrency}]`
  const memStr = heapDelta >= 0 ? `+${formatBytes(heapDelta)}` : formatBytes(heapDelta)
  const cpuStr = `${formatCpu(cpuUserDelta)} user / ${formatCpu(cpuSystemDelta)} sys`

  if (minOpsPerSec !== undefined && opsPerSec < minOpsPerSec) {
    process.stdout.write(`  ${RED}\uD83D\uDD3B${RESET} ${label.padEnd(32)} ${GRAY}${tag}${RESET} ${RED}${opsStr}${RESET}  ${GRAY}(${latencyMs}ms/op, ${durStr})${RESET}\n`)
    process.stdout.write(`       ${GRAY}\uD83D\uDCBE ${memStr}  \uD83D\uDDA5\uFE0F ${cpuStr}${RESET}\n`)
    process.stdout.write(`       ${RED}Seuil non atteint : ${opsPerSec.toLocaleString()} < ${minOpsPerSec.toLocaleString()} ops/s${RESET}\n`)
    failed++
  } else {
    process.stdout.write(`  ${CYAN}\u26A1${RESET} ${label.padEnd(32)} ${GRAY}${tag}${RESET} ${GREEN}${opsStr}${RESET}  ${GRAY}(${latencyMs}ms/op, ${durStr})${RESET}\n`)
    process.stdout.write(`       ${GRAY}\uD83D\uDCBE ${memStr}  \uD83D\uDDA5\uFE0F ${cpuStr}${RESET}\n`)
    if (minOpsPerSec !== undefined) {
      passed++
    }
  }
}

// ── Tests de charge 9 : Concurrentiel \u2014 Benchmark parall\u00e8le \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

async function loadTestConcurrent() {
  process.stdout.write(`\n${BOLD}\u2500\u2500 Concurrentiel \u2014 I/O + callLLM parall\u00e8les${RESET}\n`)

  // ── Nettoyage pr\u00e9ventif : supprimer tout r\u00e9sidu d'ex\u00e9cutions pr\u00e9c\u00e9dentes \u2500\u2500
  {
    const { listProviders } = await import('./providers.js')
    for (const p of listProviders()) {
      if (p && p.name && (p.name.startsWith('CONC-') || p.name.startsWith('CRUD-') || p.name === 'undefined' || p.name === 'LoadTest Provider' || p.name === 'ResolveTest Kilo')) {
        try { removeProvider(p.name) } catch {}
      }
    }
  }

  // ── Concurrent : addProvider (I/O fichier) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  process.stdout.write(`\n${GRAY}  addProvider concurrent \u2014 cr\u00e9e puis nettoie 400 providers en parall\u00e8le${RESET}\n`)
  {
    // Pr\u00e9-g\u00e9n\u00e9rer les noms pour \u00e9viter les races sur Date.now()
    // Pr\u00e9-g\u00e9n\u00e9rer les noms : 400 op\u00e9rations + 20 warmup
    const totalAddProvider = 400
    const names: string[] = []
    const nameCount = totalAddProvider + 20 // warmup compris
    for (let i = 0; i < nameCount; i++) {
      names.push(`CONC-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`)
    }
    let idx = 0

    try {
      await benchmarkConcurrent('addProvider concurrentiel', totalAddProvider, 20, async () => {
        const name = names[idx++]
        addProvider({
          name,
          provider: 'custom',
          apiKeys: ['test-key'],
          baseUrl: 'https://x.com',
          defaultModel: 'm',
          enabled: true,
        })
        return name
      }, 30)
    } finally {
      // Nettoyer tous les CONC- cr\u00e9\u00e9s, m\u00eame si le bench crash
      const { listProviders } = await import('./providers.js')
      for (const p of listProviders()) {
        if (p && p.name && p.name.startsWith('CONC-')) removeProvider(p.name)
      }
    }
  }

  // ── Concurrent : listLocalAgents (I/O dossier) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  process.stdout.write(`\n${GRAY}  listLocalAgents concurrent \u2014 400 appels parall\u00e8les (batch de 20)${RESET}\n`)

  await benchmarkConcurrent('listLocalAgents concurrentiel', 400, 20, async () => {
    listLocalAgents()
  }, 300)

  // ── Concurrent : callLLM mock\u00e9 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  process.stdout.write(`\n${GRAY}  callLLM concurrent \u2014 400 appels parall\u00e8les (batch de 10)${RESET}\n`)

  // Mock fetch pour le test concurrent
  const originalFetch = globalThis.fetch
  const mockResponse = JSON.stringify({
    choices: [{ message: { content: 'Mock concurrent.' } }],
  })
  globalThis.fetch = async (_url: RequestInfo | URL, _init?: RequestInit) =>
    new Response(mockResponse, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })

  try {
    const agent: AgentDefinition = {
      id: 'load-test-concurrent',
      displayName: 'Load Test Concurrent',
      model: 'kilo/kilo-auto/free',
      provider: 'kilo',
      instructionsPrompt: 'Assistant de test concurrentiel.',
      toolNames: [],
      rateLimit: { enabled: false, requestsPerMinute: 60, burst: 10, backoffMultiplier: 1 },
      guardian: { enabled: false, blockHarmful: false, requireConfirmation: false, auditTrail: false },
      healthCheck: { enabled: false, checkIntervalMs: 60000, maxConsecutiveFailures: 3, autoRestart: false, maxRestarts: 0 },
      selfCorrection: { enabled: false, retryOnFailure: false, maxRetries: 0, validateOutput: false },
      streaming: { enabled: false, chunkSize: 50, showThinking: false },
      toolConfig: { parallelTools: false, toolTimeoutMs: 30000, maxParallel: 1 },
    }
    const engine = createEngine({ agent })
    engine.createSession()

    const llm = {
      provider: 'kilo',
      apiKey: 'mock-key',
      baseUrl: 'https://api.mock.local/v1',
      model: 'kilo/kilo-auto/free',
    }

    await benchmarkConcurrent('callLLM concurrentiel (mock\u00e9)', 400, 10, async () => {
      await engine.callLLM(
        'Question concurrentielle ?',
        llm,
        'R\u00e9ponse mock\u00e9e rapide.',
      )
    }, 800)

  } finally {
    globalThis.fetch = originalFetch
  }
}

// ── Tests de charge 10 : Fuzzing \u2014 R\u00e9silience providers.json \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

async function loadTestFuzzing() {
  process.stdout.write(`\n${BOLD}\u2500\u2500 Fuzzing \u2014 R\u00e9silience providers.json corrompu${RESET}\n`)

  const configPath = getProviderConfigPath()
  const fs = await import('fs')
  const originalContent = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf-8') : null

  /** Applique une corruption, appelle listProviders + getNextApiKey, puis restaure */
  async function testCorruption(label: string, writeContent: () => void) {
    try {
      writeContent()

      // listProviders ne doit jamais crasher
      let providers: unknown[] = []
      let listOk = true
      try {
        providers = listProviders()
      } catch (e) {
        listOk = false
        assert(`${label} \u2192 listProviders crash`, false, (e as Error).message)
      }

      // getNextApiKey('kilo') ne doit jamais crasher
      let keyOk = true
      try {
        getNextApiKey('kilo')
      } catch (e) {
        keyOk = false
        assert(`${label} \u2192 getNextApiKey crash`, false, (e as Error).message)
      }

      // Validation douce : si les deux n'ont pas crash\u00e9, c'est un succ\u00e8s
      if (listOk && keyOk) {
        const listInfo = Array.isArray(providers) ? `${providers.length} entr\u00e9es` : 'non-tableau'
        assert(`${label} \u2192 listProviders ${listInfo}`, true)
      }
    } finally {
      // Restaurer le fichier original
      if (originalContent !== null) {
        fs.writeFileSync(configPath, originalContent, 'utf-8')
      }
    }
  }

  // ── 1. JSON invalide \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  await testCorruption('JSON invalide', () => {
    fs.writeFileSync(configPath, 'pas du tout du json { invalid', 'utf-8')
  })

  // ── 2. Fichier vide \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  await testCorruption('fichier vide', () => {
    fs.writeFileSync(configPath, '', 'utf-8')
  })

  // ── 3. providers: null (pas un tableau) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  await testCorruption('providers: null', () => {
    fs.writeFileSync(configPath, JSON.stringify({ providers: null }), 'utf-8')
  })

  // ── 4. providers: string \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  await testCorruption('providers: string', () => {
    fs.writeFileSync(configPath, JSON.stringify({ providers: 'pas-un-tableau' }), 'utf-8')
  })

  // ── 5. 10 000 entr\u00e9es null \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  await testCorruption('10 000 \u00d7 null', () => {
    const nulls: null[] = new Array(10_000).fill(null)
    fs.writeFileSync(configPath, JSON.stringify({ providers: nulls }), 'utf-8')
  })

  // ── 6. 10 000 entr\u00e9es vides {} (champs manquants) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  await testCorruption('10 000 \u00d7 {} vides', () => {
    const empties: Record<string, never>[] = new Array(10_000).fill({})
    fs.writeFileSync(configPath, JSON.stringify({ providers: empties }), 'utf-8')
  })

  // ── 7. 10 000 entr\u00e9es avec types incorrects \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  await testCorruption('10 000 \u00d7 types incorrects', () => {
    const entries = new Array(10_000).fill(null).map((_, i) => ({
      name: i,               // number au lieu de string
      provider: [],           // array au lieu de string
      apiKeys: 'not-an-array', // string au lieu de string[]
      enabled: 'yes',         // string au lieu de boolean
      baseUrl: null,          // null au lieu de string
      defaultModel: 42,       // number au lieu de string
      currentKeyIndex: 'zero',// string au lieu de number
      maxParallel: true,      // boolean au lieu de number
      extraField: { deep: { nested: { value: 1 } } }, // imbrication profonde
    }))
    fs.writeFileSync(configPath, JSON.stringify({ providers: entries }), 'utf-8')
  })

  // ── 8. 10 000 entr\u00e9es avec name: null \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  await testCorruption('10 000 \u00d7 name: null', () => {
    const entries = new Array(10_000).fill(null).map((_, i) => ({
      name: null,
      provider: 'kilo',
      apiKeys: ['key-' + i],
      enabled: true,
      baseUrl: 'https://x.com',
      defaultModel: 'm',
    }))
    fs.writeFileSync(configPath, JSON.stringify({ providers: entries }), 'utf-8')
  })

  // ── 9. 10 000 entr\u00e9es avec name absent \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  await testCorruption('10 000 \u00d7 name absent', () => {
    const entries = new Array(10_000).fill(null).map(() => ({
      provider: 'test',
      apiKeys: ['k'],
      enabled: true,
      baseUrl: 'https://x.com',
      defaultModel: 'm',
    }))
    fs.writeFileSync(configPath, JSON.stringify({ providers: entries }), 'utf-8')
  })

  // ── 10. Imbrication JSON extr\u00eame \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  await testCorruption('imbrication extr\u00eame (100 niveaux)', () => {
    let obj: Record<string, unknown> = { a: 'b' }
    for (let i = 0; i < 100; i++) {
      obj = { nested: obj, level: i }
    }
    fs.writeFileSync(configPath, JSON.stringify({
      providers: [{
        name: 'Deep Nest',
        provider: 'kilo',
        apiKeys: ['k'],
        enabled: true,
        baseUrl: 'https://x.com',
        defaultModel: 'm',
        meta: obj,
      }],
    }), 'utf-8')
  })

  // ── 11. Provider valide m\u00e9lang\u00e9 \u00e0 9 999 nulls \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  await testCorruption('9 999 null + 1 valide', () => {
    const entries: unknown[] = new Array(9_999).fill(null)
    entries.push({
      name: 'Fuzz Valid',
      provider: 'kilo',
      apiKeys: ['fuzz-key'],
      enabled: true,
      baseUrl: 'https://fuzz.test',
      defaultModel: 'fuzz-model',
    })
    fs.writeFileSync(configPath, JSON.stringify({ providers: entries }), 'utf-8')
  })

  // ── 13. Fichier avec caract\u00e8res non-UTF8 (binaires) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  await testCorruption('binaires / non-UTF8', () => {
    const buf = Buffer.alloc(1024)
    for (let i = 0; i < buf.length; i++) {
      buf[i] = i % 256  // bytes 0x00\u20130xFF cycliques
    }
    fs.writeFileSync(configPath, buf)
  })
}

// ── Tests de charge 11 : Fuzzing agents .ts corrompus ─────────────────────────

async function loadTestFuzzingAgents() {
  process.stdout.write(`\n${BOLD}\u2500\u2500 Fuzzing Agents \u2014 100 fichiers .ts corrompus${RESET}\n`)
  const fs = await import('fs')
  const path = await import('path')
  const agentsDir = path.join(process.cwd(), '.agents')
  const backup = new Map<string, string | null>()
  if (fs.existsSync(agentsDir)) {
    for (const f of fs.readdirSync(agentsDir)) {
      if (f.endsWith('.ts') || f.endsWith('.json')) {
        backup.set(f, fs.readFileSync(path.join(agentsDir, f), 'utf-8'))
      }
    }
  }
  const testFiles: string[] = []

  async function testAgentFile(label: string, content: string | Buffer) {
    const filename = `fuzz-ts-${testFiles.length}-${Date.now()}.ts`
    testFiles.push(filename)
    const filePath = path.join(agentsDir, filename)
    try {
      if (typeof content === 'string') {
        fs.writeFileSync(filePath, content, 'utf-8')
      } else {
        fs.writeFileSync(filePath, content)
      }
      let listOk = true
      try {
        listLocalAgents()
      } catch (e) {
        listOk = false
        assert(`${label} \u2192 listLocalAgents crash`, false, (e as Error).message)
      }
      let readOk = true
      try {
        readLocalAgent(filename)
      } catch (e) {
        readOk = false
        assert(`${label} \u2192 readLocalAgent crash`, false, (e as Error).message)
      }
      if (listOk && readOk) {
        assert(`${label} \u2192 ok`, true)
      }
    } finally {
      try { fs.unlinkSync(filePath) } catch {}
    }
  }

  // 1. Fichiers vides (10 \u00d7)
  for (let i = 0; i < 10; i++) {
    await testAgentFile(`fichier vide (${i + 1}/10)`, '')
  }

  // 2. Binaires non-UTF8 (10 \u00d7)
  for (let i = 0; i < 10; i++) {
    const buf = Buffer.alloc(128 + i * 64)
    for (let j = 0; j < buf.length; j++) {
      buf[j] = (j * 37 + i * 13) % 256
    }
    await testAgentFile(`binaire non-UTF8 (${i + 1}/10)`, buf)
  }

  // 3. Syntaxe TS invalide (10 \u00d7)
  const gibberish = [
    'improt { something } from nowhere',
    'const x: string = 42; const y = x + "hello"',
    'function ( { return } )',
    'class { extends {} }',
    'type X = { a: string; b: number; } & Y & Z',
    'export default 42 as string;',
    'const x: Array<Array<Array<string>>>>>>>>',
    'const obj = { ...null, ...undefined, ...42 }',
    'async function*() { yield await Promise.resolve(1) }',
    'const x = (a, b, c, d, e, f, g, h, ...rest) => { return }',
  ]
  for (let i = 0; i < 10; i++) {
    await testAgentFile(`syntaxe invalide (${i + 1}/10)`, gibberish[i])
  }

  // 4. Objet TS tronqu\u00e9 (10 \u00d7)
  for (let i = 0; i < 10; i++) {
    const partial = [
      'import type { AgentDefinition }',
      'const definition: AgentDefinition = {',
      '  id: "test-',
      '  displayName: "Test',
      '  model: "model' + i + '",',
      '  instructionsPrompt: `Hello `,',
      '  toolNames: [',
    ].join('\n')
    await testAgentFile(`objet tronqu\u00e9 (${i + 1}/10)`, partial)
  }

  // 5. Imbrication TS profonde (10 \u00d7)
  for (let level = 1; level <= 10; level++) {
    let nested = '{}'
    for (let j = 0; j < level * 100; j++) {
      nested = '{ a: ' + nested + ', b: ' + j + ' }'
    }
    await testAgentFile(`imbrication ${level * 100} niveaux`, 'const x = ' + nested)
  }

  // 6. Commentaires seuls (10 \u00d7)
  const comments = [
    '// single line',
    '/* block comment */',
    '// ' + 'very long comment '.repeat(100),
    '/**\n * JSDoc\n * @param x - description\n */',
    '// ' + 'x '.repeat(5000),
    '/*\n' + '   line '.repeat(1000) + '\n*/',
    '// #region collapsed',
    '// @ts-nocheck\n// @ts-ignore',
    '/// <reference path="foo.d.ts" />',
    '#! /usr/bin/env node\n// shebang',
  ]
  for (let i = 0; i < 10; i++) {
    await testAgentFile(`commentaires seuls (${i + 1}/10)`, comments[i])
  }

  // 7. Lignes extr\u00eamement longues (10 \u00d7)
  for (let i = 0; i < 10; i++) {
    await testAgentFile(`ligne tr\u00e8s longue (${i + 1}/10)`, '// ' + 'verylongword'.repeat(5000 * (i + 1)) + '\n')
  }

  // 8. Caract\u00e8res cassant les regex (10 \u00d7)
  const regexBombs = [
    'const id = "' + '(?:'.repeat(50) + 'hello' + ')?'.repeat(50) + '"',
    'const name = "test.\\\\w+"',
    'const pattern = /(a|b|c|d|e|f|g)+/',
    'const x = "' + '\\\\'.repeat(100) + '"',
    'const x = "' + '*+?{}[]()|^$'.repeat(20) + '"',
    'const x = /' + '\\\\d+'.repeat(100) + '/',
    'const x = "' + '\n'.repeat(100) + '"',
    'const x = `' + '\${'.repeat(50) + '}'.repeat(50) + '`',
    'const x = "' + '\\\\\\\\'.repeat(200) + '"',
    'const regex = /' + '(?=)(?<=)(?<!)(?!'.repeat(20) + '/',
  ]
  for (let i = 0; i < 10; i++) {
    await testAgentFile(`regex breakers (${i + 1}/10)`, regexBombs[i])
  }

  // 9. Caract\u00e8res de contr\u00f4le (10 \u00d7)
  const controlChars = [
    '\\x00\\x00\\x00const id = "test"',
    '\\x01\\x02\\x03\\x04\\x05\\x06\\x07',
    '\\x08\\x09\\n\\x0B\\x0C\\r\\x0E\\x0F',
    '\\x10const x = 1\\x11',
    'const id = ' + '\\x00'.repeat(100) + '"test"',
    '\\x1B[31mRED\\x1B[0m const id = "escape"',
    '\\x7F\\x7F\\x7Fconst id = "del"',
    '\\x80\\x81\\x82const id = "invalid-utf"',
    '\\xFF\\xFE\\xFD\\xFC const id = "bom-like"',
    '\\x1B\\x5B\\x32\\x30\\x30\\x30\\x68 const id = "ansi"',
  ]
  for (let i = 0; i < 10; i++) {
    await testAgentFile(`caract\u00e8res contr\u00f4le (${i + 1}/10)`, controlChars[i])
  }

  // 10. Types TS invalides (10 \u00d7)
  const invalidTypes = [
    'type X = { [key: string]: number } & string extends number ? true : false',
    'const x: keyof typeof import("nonexistent") = null',
    'type X<T> = T extends any ? (x: T) => void : never',
    'type X = { [P in keyof T]: T[P] }[keyof T]',
    'type X = T extends infer U ? U extends string ? U : never : never',
    'type X = string | number | boolean | null | undefined | void | never | any | unknown',
    'type X = { a: 1 } & { b: 2 } & { c: 3 } & { d: 4 }',
    'type X<T extends (...args: any[]) => any> = Parameters<T>',
    'const x: { [key: string]: { [key: string]: { [key: string]: number } } } = {}',
    'type X = Extract<keyof { a: string; b: number; c: boolean }, string>',
  ]
  for (let i = 0; i < 10; i++) {
    await testAgentFile(`types TS invalides (${i + 1}/10)`, invalidTypes[i])
  }

  // Restauration de l'\u00e9tat initial
  {
    for (const f of fs.readdirSync(agentsDir)) {
      if (f.startsWith('fuzz-ts-')) {
        try { fs.unlinkSync(path.join(agentsDir, f)) } catch {}
      }
    }
    for (const [f, content] of backup) {
      if (content !== null) {
        try { fs.writeFileSync(path.join(agentsDir, f), content, 'utf-8') } catch {}
      }
    }
  }
}

// ── Benchmarks additionnels (apr\u00e8s fuzzing) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

async function loadTestFuzzingNotifications() {
  process.stdout.write(`\n${BOLD}\u2500\u2500 Fuzzing Notifications \u2014 R\u00e9silience .notifications.json${RESET}\n`)
  const notifyPath = getNotifyPath()
  const fs = await import('fs')
  const originalContent = fs.existsSync(notifyPath) ? fs.readFileSync(notifyPath, 'utf-8') : null

  async function testCorruption(label: string, writeContent: () => void) {
    try {
      writeContent()

      // peekNotifications ne doit jamais crasher
      let peekOk = true
      try {
        peekNotifications()
      } catch (e) {
        peekOk = false
        assert(`${label} \u2192 peekNotifications crash`, false, (e as Error).message)
      }

      // countPendingNotifications ne doit jamais crasher
      let countOk = true
      try {
        countPendingNotifications()
      } catch (e) {
        countOk = false
        assert(`${label} \u2192 countPendingNotifications crash`, false, (e as Error).message)
      }

      // removeNotification ne doit jamais crasher
      let rmOk = true
      try {
        removeNotifyEntry('fuzz-test-id')
      } catch (e) {
        rmOk = false
        assert(`${label} \u2192 removeNotification crash`, false, (e as Error).message)
      }

      if (peekOk && countOk && rmOk) {
        assert(`${label} \u2192 ok`, true)
      }
    } finally {
      if (originalContent !== null) {
        fs.writeFileSync(notifyPath, originalContent, 'utf-8')
      }
    }
  }

  // ── 1. JSON invalide ──
  await testCorruption('JSON invalide', () => {
    fs.writeFileSync(notifyPath, 'pas du tout du json { invalid', 'utf-8')
  })

  // ── 2. Fichier vide ──
  await testCorruption('fichier vide', () => {
    fs.writeFileSync(notifyPath, '', 'utf-8')
  })

  // ── 3. null au lieu de tableau ──
  await testCorruption('null au lieu de tableau', () => {
    fs.writeFileSync(notifyPath, JSON.stringify(null), 'utf-8')
  })

  // ── 4. string au lieu de tableau ──
  await testCorruption('string au lieu de tableau', () => {
    fs.writeFileSync(notifyPath, JSON.stringify('pas-un-tableau'), 'utf-8')
  })

  // ── 5. 10 000 entr\u00e9es null ──
  await testCorruption('10 000 \u00d7 null', () => {
    const nulls: null[] = new Array(10_000).fill(null)
    fs.writeFileSync(notifyPath, JSON.stringify(nulls), 'utf-8')
  })

  // ── 6. 10 000 entr\u00e9es vides {} ──
  await testCorruption('10 000 \u00d7 {} vides', () => {
    const empties: Record<string, never>[] = new Array(10_000).fill({})
    fs.writeFileSync(notifyPath, JSON.stringify(empties), 'utf-8')
  })

  // ── 7. 10 000 notifications avec types incorrects ──
  await testCorruption('10 000 types incorrects', () => {
    const entries = new Array(10_000).fill(null).map((_, i) => ({
      id: i,                       // number au lieu de string
      from: [],                     // array au lieu de string
      message: null,                // null au lieu de string
      level: 'inexistant',          // niveau invalide
      timestamp: 1234567890,        // number au lieu de string ISO
      extra: { deep: { nested: 1 } }, // champ suppl\u00e9mentaire
    }))
    fs.writeFileSync(notifyPath, JSON.stringify(entries), 'utf-8')
  })

  // ── 8. 10 000 notifications avec id: null ──
  await testCorruption('10 000 \u00d7 id: null', () => {
    const entries = new Array(10_000).fill(null).map((_, i) => ({
      id: null,
      from: 'fuzz-agent',
      message: 'test message ' + i,
      level: 'info',
      timestamp: new Date().toISOString(),
    }))
    fs.writeFileSync(notifyPath, JSON.stringify(entries), 'utf-8')
  })

  // ── 9. 10 000 notifications avec id absent ──
  await testCorruption('10 000 \u00d7 id absent', () => {
    const entries = new Array(10_000).fill(null).map(() => ({
      from: 'fuzz-agent',
      message: 'test',
      level: 'info',
      timestamp: new Date().toISOString(),
    }))
    fs.writeFileSync(notifyPath, JSON.stringify(entries), 'utf-8')
  })

  // ── 10. Imbrication JSON extr\u00eame ──
  await testCorruption('imbrication 100 niveaux', () => {
    let obj: Record<string, unknown> = { id: 'test' }
    for (let i = 0; i < 100; i++) {
      obj = { nested: obj, level: i }
    }
    fs.writeFileSync(notifyPath, JSON.stringify([obj]), 'utf-8')
  })

  // ── 11. 9 999 null + 1 notification valide ──
  await testCorruption('9 999 null + 1 valide', () => {
    const entries: unknown[] = new Array(9_999).fill(null)
    entries.push({
      id: 'valid-id',
      from: 'fuzz-agent',
      message: 'notification valide',
      level: 'info',
      timestamp: new Date().toISOString(),
    })
    fs.writeFileSync(notifyPath, JSON.stringify(entries), 'utf-8')
  })

  // ── 12. Binaires / non-UTF8 ──
  await testCorruption('binaires / non-UTF8', () => {
    const buf = Buffer.alloc(1024)
    for (let i = 0; i < buf.length; i++) {
      buf[i] = (i * 37 + 13) % 256
    }
    fs.writeFileSync(notifyPath, buf)
  })

  // ── 13. 10 000 notifications dupliqu\u00e9es (m\u00eame id) ──
  await testCorruption('10 000 \u00d7 id dupliqu\u00e9', () => {
    const entry = {
      id: 'duplicate-id',
      from: 'fuzz-agent',
      message: 'm\u00eame notification en masse',
      level: 'urgent',
      timestamp: new Date().toISOString(),
    }
    const entries = new Array(10_000).fill(null).map(() => ({ ...entry }))
    fs.writeFileSync(notifyPath, JSON.stringify(entries), 'utf-8')
  })

  // ── 14. Dates invalides vari\u00e9es ──
  await testCorruption('dates invalides', () => {
    const timestamps = [null, undefined, 'pas-une-date', 0, '', '2024-13-01', 'not-a-date', true, {}, []]
    const entries = timestamps.map((ts, i) => ({
      id: 'ts-test-' + i,
      from: 'fuzz-agent',
      message: 'test timestamp',
      level: 'info',
      timestamp: ts,
    }))
    fs.writeFileSync(notifyPath, JSON.stringify(entries), 'utf-8')
  })

  // ── 15. Levels invalides vari\u00e9s ──
  await testCorruption('levels invalides', () => {
    const levels = [null, undefined, 'super-urgent', '', 0, true, {}, ['urgent'], 'INFO', 'Urgent', ' critical ', 'level-42']
    const entries = levels.map((lv, i) => ({
      id: 'level-test-' + i,
      from: 'fuzz-agent',
      message: 'test level',
      level: lv,
      timestamp: new Date().toISOString(),
    }))
    fs.writeFileSync(notifyPath, JSON.stringify(entries), 'utf-8')
  })

  // ── 16. Message extr\u00eamement long ──
  await testCorruption('message 1MB', () => {
    const entries = [{
      id: 'long-msg',
      from: 'fuzz-agent',
      message: 'x'.repeat(1_000_000),
      level: 'info',
      timestamp: new Date().toISOString(),
    }]
    fs.writeFileSync(notifyPath, JSON.stringify(entries), 'utf-8')
  })

  // ── 17. Objet au lieu de tableau ──
  await testCorruption('objet au lieu de tableau', () => {
    fs.writeFileSync(notifyPath, JSON.stringify({
      id: 'not-an-array',
      from: 'fuzz',
      message: 'objet',
      level: 'info',
      timestamp: new Date().toISOString(),
    }), 'utf-8')
  })

  // ── 18. Tableau h\u00e9t\u00e9roclite ──
  await testCorruption('tableau h\u00e9t\u00e9roclite', () => {
    const entries = [
      null,
      'string',
      42,
      true,
      { id: 'valid', from: 'a', message: 'm', level: 'info', timestamp: '2024-01-01' },
      ['nested', 'array'],
      undefined,
      Buffer.alloc(16).toJSON(),
    ]
    fs.writeFileSync(notifyPath, JSON.stringify(entries), 'utf-8')
  })

  // ── 19. Tableau vid\u00e9 apr\u00e8s ":" (JSON malform\u00e9 l\u00e9ger) ──
  await testCorruption('JSON partiel / tronqu\u00e9', () => {
    const partial = '[{"id":"test","from":"agent","message":"hello"'
    fs.writeFileSync(notifyPath, partial, 'utf-8')
  })

  // ── 20. BOM + accents + caract\u00e8res sp\u00e9ciaux ──
  await testCorruption('BOM + caract\u00e8res sp\u00e9ciaux', () => {
    const content = '\uFEFF' + JSON.stringify([{
      id: 'bom-test',
      from: 'f\u00fczz-\u00e4g\u00eant',
      message: '\u00e9\u00e8\u00ea\u00eb \u00e0\u00e2\u00e4\u00e6\u0153 \u00f9\u00fb\u00fc \u00f6\u00e9 Joyeux No\u00ebl \u00a9\u00ae™',
      level: 'info',
      timestamp: new Date().toISOString(),
    }])
    fs.writeFileSync(notifyPath, content, 'utf-8')
  })
}

async function loadTestFuzzingBenchmarks() {
  process.stdout.write(`\n${BOLD}\u2500\u2500 Fuzzing \u2014 Benchmarks de performance sur donn\u00e9es valides${RESET}\n`)

  const configPath = getProviderConfigPath()
  const fs = await import('fs')
  const originalContent = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf-8') : null

  try {
    // \u00c9crire 10 000 entr\u00e9es valides dans providers.json
    const entries = new Array(10_000).fill(null).map((_, i) => ({
      name: 'Fuzz-' + i + '-' + Math.random().toString(36).slice(2, 6),
      provider: 'kilo',
      apiKeys: ['key-' + i],
      enabled: i % 2 === 0,
      baseUrl: 'https://fuzz.test',
      defaultModel: 'fuzz-model',
    }))
    fs.writeFileSync(configPath, JSON.stringify({ providers: entries }), 'utf-8')

    // Benchmark : listProviders + getNextApiKey sur 10 000 entr\u00e9es
    await benchmark('10k entries: listProviders + getNextApiKey', 500, () => {
      listProviders()
      getNextApiKey('kilo')
    }, 35)

  } finally {
    if (originalContent !== null) {
      fs.writeFileSync(configPath, originalContent, 'utf-8')
    }
  }
}

// ── Main \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

async function main() {
  process.stdout.write(`\n${BOLD}${CYAN}\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557${RESET}\n`)
  process.stdout.write(`${BOLD}${CYAN}         TESTS DE CHARGE / PERFORMANCE${RESET}\n`)
  process.stdout.write(`${BOLD}${CYAN}\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d${RESET}\n\n`)

  // ── Nettoyage pr\u00e9ventif global \u2500\u2500
  {
    const { listProviders } = await import('./providers.js')
    const testPatterns = ['CONC-', 'CRUD-', 'undefined', 'LoadTest Provider', 'ResolveTest Kilo']
    for (const p of listProviders()) {
      if (p && p.name && testPatterns.some(pat => p.name.startsWith(pat) || p.name === pat)) {
        try { removeProvider(p.name) } catch {}
      }
    }
  }

  const startTime = Date.now()

  await loadTestTop15()
  await loadTestKeyRotation()
  await loadTestProviderCRUD()
  await loadTestNotifications()
  await loadTestProviderResolution()
  await loadTestAgentCRUD()
  await loadTestEngineRunner()
  await loadTestFullEngine()
  await loadTestConcurrent()
  await loadTestFuzzing()
  await loadTestFuzzingAgents()
  await loadTestFuzzingNotifications()
  await loadTestFuzzingBenchmarks()

  // ── R\u00e9sum\u00e9 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const totalDuration = Date.now() - startTime
  const totalOps = results.reduce((sum, r) => sum + r.opsPerSec * (r.durationMs / 1000), 0)
  const totalHeap = results.reduce((sum, r) => sum + Math.max(0, r.heapDelta), 0)
  const totalCpuUser = results.reduce((sum, r) => sum + r.cpuUserDelta, 0)
  const totalCpuSys = results.reduce((sum, r) => sum + r.cpuSystemDelta, 0)

  process.stdout.write(`\n${BOLD}${CYAN}\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557${RESET}\n`)
  process.stdout.write(`${BOLD}${CYAN}  R\u00c9SUM\u00c9 DES PERFORMANCES${RESET}\n`)
  process.stdout.write(`${BOLD}${CYAN}\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d${RESET}\n\n`)

  // Top 3 plus rapides
  const sorted = [...results].sort((a, b) => b.opsPerSec - a.opsPerSec)
  process.stdout.write(`${BOLD}Top 3 plus rapides :${RESET}\n`)
  for (let i = 0; i < Math.min(3, sorted.length); i++) {
    const r = sorted[i]
    process.stdout.write(`  ${GREEN}#${i + 1}${RESET} ${r.label.padEnd(50)} ${CYAN}${r.opsPerSec.toLocaleString()} ops/s${RESET}\n`)
  }

  process.stdout.write(`\n${BOLD}Top 3 plus lents :${RESET}\n`)
  for (let i = sorted.length - 1; i >= Math.max(0, sorted.length - 3); i--) {
    const r = sorted[i]
    process.stdout.write(`  ${YELLOW}#${sorted.length - i}${RESET} ${r.label.padEnd(50)} ${CYAN}${r.opsPerSec.toLocaleString()} ops/s${RESET}  ${GRAY}(${(r.latencyMs * 1000).toFixed(0)} \u00b5s/op)${RESET}\n`)
  }

  process.stdout.write(`\n${BOLD}Total :${RESET}\n`)
  process.stdout.write(`  \u23F1\uFE0F  Dur\u00e9e                ${GREEN}${totalDuration >= 1000 ? (totalDuration / 1000).toFixed(1) + 's' : totalDuration + 'ms'}${RESET}\n`)
  process.stdout.write(`  \uD83D\uDD04 Op\u00e9rations totales    ${GREEN}~${Math.round(totalOps).toLocaleString()}${RESET}\n`)
  process.stdout.write(`  \u2705 Assertions            ${GREEN}${passed}/${passed + failed}${RESET}\n`)
  process.stdout.write(`  \uD83D\uDCBE M\u00e9moire totale        ${GREEN}${formatBytes(totalHeap)}${RESET}\n`)
  process.stdout.write(`  \uD83D\uDDA5\uFE0F  CPU total            ${GREEN}${formatCpu(totalCpuUser)} user / ${formatCpu(totalCpuSys)} sys${RESET}\n`)

  // Top 3 consommateurs m\u00e9moire
  const memSorted = [...results].sort((a, b) => b.heapDelta - a.heapDelta)
  const topMem = memSorted.filter(r => r.heapDelta > 0).slice(0, 3)
  if (topMem.length > 0) {
    process.stdout.write(`\n${BOLD}Top 3 consommateurs m\u00e9moire :${RESET}\n`)
    for (let i = 0; i < topMem.length; i++) {
      const r = topMem[i]
      process.stdout.write(`  ${YELLOW}#${i + 1}${RESET} ${r.label.padEnd(50)} ${CYAN}+${formatBytes(r.heapDelta)}${RESET}\n`)
    }
  }

  if (failed > 0) {
    process.stdout.write(`\n${BOLD}${RED}  ${failed} ASSERTION(S) EN \u00c9CHEC${RESET}\n`)
  }

  process.stdout.write(`\n${BOLD}${CYAN}\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557${RESET}\n\n`)
  safeExit(failed > 0 ? 1 : 0)
}

main().catch(err => {
  process.stderr.write(`${RED}\u274C Load test crash : ${err.message}${RESET}\n`)
  safeExit(1)
})