import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

export interface ProviderConfig {
  name: string
  provider: string
  apiKeys: string[]
  baseUrl: string
  defaultModel: string
  enabled: boolean
  currentKeyIndex: number
  maxParallel: number
  /** legacy single-key — migrated to apiKeys on load */
  apiKey?: string
}

interface ProvidersFile {
  providers: ProviderConfig[]
}

const CONFIG_PATH = join(process.cwd(), 'providers.json')

const DEFAULT_PROVIDERS: ProvidersFile = {
  providers: [
    {
      name: 'Kilo Gateway',
      provider: 'kilo',
      apiKeys: [],
      baseUrl: 'https://api.kilo.ai',
      defaultModel: 'kilo/kilo-auto/free',
      enabled: true,
      currentKeyIndex: 0,
      maxParallel: 1,
    },
    {
      name: 'Google Gemini',
      provider: 'google',
      apiKeys: [],
      baseUrl: 'https://generativelanguage.googleapis.com',
      defaultModel: 'gemini-2.5-flash',
      enabled: false,
      currentKeyIndex: 0,
      maxParallel: 1,
    },
    {
      name: 'OpenRouter',
      provider: 'openrouter',
      apiKeys: [],
      baseUrl: 'https://openrouter.ai/api/v1',
      defaultModel: 'openrouter/free',
      enabled: false,
      currentKeyIndex: 0,
      maxParallel: 1,
    },
    {
      name: 'Opencode Zen',
      provider: 'opencode-zen',
      apiKeys: [],
      baseUrl: 'https://zen.opencode.ai/v1',
      defaultModel: 'opencode-zen/default',
      enabled: false,
      currentKeyIndex: 0,
      maxParallel: 1,
    },
    {
      name: 'Ollama',
      provider: 'ollama',
      apiKeys: [],
      baseUrl: 'http://localhost:11434',
      defaultModel: 'llama3.2',
      enabled: false,
      currentKeyIndex: 0,
      maxParallel: 1,
    },
    {
      name: 'LM Studio',
      provider: 'lm-studio',
      apiKeys: [],
      baseUrl: 'http://localhost:1234/v1',
      defaultModel: 'local-model',
      enabled: false,
      currentKeyIndex: 0,
      maxParallel: 4,
    },
  ],
}

// ── Persistence ──────────────────────────────────────────

function loadProviders(): ProvidersFile {
  if (!existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_PROVIDERS, null, 2), 'utf-8')
    return DEFAULT_PROVIDERS
  }
  try {
    const content = readFileSync(CONFIG_PATH, 'utf-8')
    const data = JSON.parse(content) as ProvidersFile
    for (const p of data.providers) {
      // migrate legacy apiKey → apiKeys
      if (!p.apiKeys) p.apiKeys = []
      if (p.apiKey && !p.apiKeys.includes(p.apiKey)) {
        p.apiKeys.unshift(p.apiKey)
      }
      if (p.currentKeyIndex === undefined) p.currentKeyIndex = 0
      if (p.maxParallel === undefined) p.maxParallel = 1
      delete (p as any).apiKey
    }
    return data
  } catch {
    return DEFAULT_PROVIDERS
  }
}

function saveProviders(data: ProvidersFile): void {
  writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf-8')
}

// ── In-memory rate-limit cooldown ────────────────────────
const rateLimitedUntil = new Map<string, number>()

function resetExpiredCooldowns(): void {
  const now = Date.now()
  for (const [key, until] of rateLimitedUntil) {
    if (until <= now) rateLimitedUntil.delete(key)
  }
}

// ── Public API ───────────────────────────────────────────

export function listProviders(): ProviderConfig[] {
  return loadProviders().providers
}

export function getEnabledProviders(): ProviderConfig[] {
  return loadProviders().providers.filter(p => p.enabled)
}

export function getProvider(name: string): ProviderConfig | undefined {
  return loadProviders().providers.find(p => p.name === name)
}

export function getProvidersByType(providerType: string): ProviderConfig[] {
  return loadProviders().providers.filter(p => p.provider === providerType)
}

export function addProvider(config: Partial<ProviderConfig> & { name: string; provider: string }): void {
  const data = loadProviders()
  if (data.providers.find(p => p.name === config.name)) {
    throw new Error(`Provider "${config.name}" already exists`)
  }
  const apiKeys: string[] = []
  if (config.apiKeys) apiKeys.push(...config.apiKeys)
  if ((config as any).apiKey) apiKeys.push((config as any).apiKey)
  data.providers.push({
    name: config.name,
    provider: config.provider,
    apiKeys,
    baseUrl: config.baseUrl || 'https://api.openai.com/v1',
    defaultModel: config.defaultModel || 'gpt-4',
    enabled: config.enabled ?? true,
    currentKeyIndex: 0,
    maxParallel: config.maxParallel ?? 1,
  })
  saveProviders(data)
}

export function removeProvider(name: string): boolean {
  const data = loadProviders()
  const idx = data.providers.findIndex(p => p.name === name)
  if (idx === -1) return false
  data.providers.splice(idx, 1)
  saveProviders(data)
  return true
}

export function setProviderEnabled(name: string, enabled: boolean): boolean {
  const data = loadProviders()
  const provider = data.providers.find(p => p.name === name)
  if (!provider) return false
  provider.enabled = enabled
  saveProviders(data)
  return true
}

export function setProviderApiKey(name: string, apiKey: string): boolean {
  const data = loadProviders()
  const provider = data.providers.find(p => p.name === name)
  if (!provider) return false
  if (!provider.apiKeys.includes(apiKey)) {
    provider.apiKeys.push(apiKey)
    saveProviders(data)
  }
  return true
}

export function setProviderDefaultModel(name: string, model: string): boolean {
  const data = loadProviders()
  const provider = data.providers.find(p => p.name === name)
  if (!provider) return false
  provider.defaultModel = model
  saveProviders(data)
  return true
}

export function getProviderConfigPath(): string {
  return CONFIG_PATH
}

// ── Multi-key helpers ────────────────────────────────────

export function getProviderKeys(name: string): string[] {
  const p = getProvider(name)
  return p ? [...p.apiKeys] : []
}

export function addProviderKey(name: string, key: string): boolean {
  const data = loadProviders()
  const p = data.providers.find(pr => pr.name === name)
  if (!p) return false
  if (!p.apiKeys.includes(key)) {
    p.apiKeys.push(key)
    saveProviders(data)
  }
  return true
}

export function removeProviderKey(name: string, key: string): boolean {
  const data = loadProviders()
  const p = data.providers.find(pr => pr.name === name)
  if (!p) return false
  const idx = p.apiKeys.indexOf(key)
  if (idx === -1) return false
  p.apiKeys.splice(idx, 1)
  saveProviders(data)
  return true
}

// ── Key rotation / alternator ────────────────────────────

/**
 * Return the next available (non-rate-limited) API key for a given provider type.
 * Cycles through ALL keys across ALL provider entries of that type in round-robin.
 * Returns undefined if all keys are rate-limited.
 */
export function getNextApiKey(providerType: string): { key: string; providerName: string } | undefined {
  resetExpiredCooldowns()
  const entries = loadProviders().providers.filter(p => p.provider === providerType && p.enabled)
  if (entries.length === 0) return undefined

  // flatten all (key, providerName) pairs that aren't rate-limited
  const allFresh: { key: string; providerName: string }[] = []
  for (const entry of entries) {
    for (const k of entry.apiKeys) {
      if (!rateLimitedUntil.has(k)) {
        allFresh.push({ key: k, providerName: entry.name })
      }
    }
  }

  if (allFresh.length === 0) return undefined

  // round-robin: track a global cursor per provider type
  if (!cursor.has(providerType)) cursor.set(providerType, 0)
  let idx = cursor.get(providerType)!
  idx = idx % allFresh.length
  cursor.set(providerType, idx + 1)
  return allFresh[idx]
}

// in-memory round-robin cursor per provider type
const cursor = new Map<string, number>()

/**
 * Mark a key as rate-limited for a given duration.
 * Returns the next available key if any, allowing immediate failover.
 */
export function markRateLimited(apiKey: string, cooldownMs = 60000): { key: string; providerName: string } | undefined {
  rateLimitedUntil.set(apiKey, Date.now() + cooldownMs)

  // find which provider type this key belongs to
  const entries = loadProviders().providers.filter(p => p.apiKeys.includes(apiKey))
  if (entries.length === 0) return undefined

  return getNextApiKey(entries[0].provider)
}

/**
 * Check if a given API key is currently rate-limited.
 */
export function isRateLimited(apiKey: string): boolean {
  resetExpiredCooldowns()
  return rateLimitedUntil.has(apiKey)
}

/**
 * Check if an API key is already used by another provider entry.
 */
export function isApiKeyUsed(apiKey: string): { name: string; provider: string } | undefined {
  if (!apiKey) return undefined
  for (const p of loadProviders().providers) {
    if (p.apiKeys.includes(apiKey)) return { name: p.name, provider: p.provider }
  }
  return undefined
}

/**
 * Test a provider/model connection by making a minimal LLM call.
 * Returns { ok: true } or { ok: false, error, diagnostics }.
 */
export async function testConnection(
  providerType: string,
  apiKey: string,
  baseUrl: string,
  model: string,
): Promise<{ ok: true } | { ok: false; error: string; diagnostics: string[] }> {
  const { createEngine } = await import('./engine.js')
  const engine = createEngine({
    agent: { id: 'test', displayName: 'Test', model, instructionsPrompt: 'Réponds en un mot.', toolNames: [] },
  })
  engine.createSession()

  const llmProvider = { provider: providerType, apiKey, baseUrl, model }
  try {
    const response = await engine.callLLM('Dis "ok"', llmProvider, 'Réponds uniquement "ok" en minuscules.')
    if (response.toLowerCase().includes('ok')) {
      return { ok: true }
    }
    return { ok: false, error: 'Réponse inattendue du modèle', diagnostics: [`Réponse reçue : ${response.slice(0, 100)}`] }
  } catch (err) {
    const msg = (err as Error).message
    const diagnostics: string[] = []

    if (msg.includes('401') || msg.includes('403')) {
      diagnostics.push('🔑 La clé API est invalide ou a expiré')
      if (providerType === 'google') diagnostics.push('   → Crée une clé sur https://aistudio.google.com/apikey')
      if (providerType === 'openrouter') diagnostics.push('   → Vérifie ta clé sur https://openrouter.ai/keys')
      if (providerType === 'opencode-zen') diagnostics.push('   → Vérifie ta clé Opencode Zen')
    } else if (msg.includes('429')) {
      diagnostics.push('⏳ Trop de requêtes — attends quelques secondes')
    } else if (msg.includes('404')) {
      diagnostics.push('📭 Endpoint introuvable — vérifie l\'URL de base')
      diagnostics.push(`   URL testée : ${baseUrl}/chat/completions`)
    } else if (msg.includes('timeout') || msg.includes('ETIMEDOUT') || msg.includes('ECONNREFUSED')) {
      diagnostics.push('🔌 Le serveur ne répond pas')
      if (providerType === 'ollama' || providerType === 'lm-studio') {
        diagnostics.push('   → Vérifie que le service local est démarré')
      } else {
        diagnostics.push('   → Vérifie ta connexion réseau')
      }
    } else if (msg.includes('fetch')) {
      diagnostics.push('🌐 Erreur réseau — impossible de joindre le serveur')
    } else {
      diagnostics.push(`❌ ${msg.slice(0, 200)}`)
    }

    return { ok: false, error: msg.slice(0, 120), diagnostics }
  }
}

/**
 * Get all unique provider types that have at least one configured key.
 */
export function getProviderTypesWithKeys(): string[] {
  const types = new Set<string>()
  for (const p of loadProviders().providers) {
    if (p.apiKeys.length > 0) types.add(p.provider)
  }
  return Array.from(types)
}

// ── Model fetching (unchanged) ───────────────────────────

export async function fetchModels(providerType: string, apiKey: string, baseUrl: string): Promise<string[]> {
  const slimUrl = baseUrl.replace(/\/+$/, '')
  const timeout = 15000

  async function tryFetch(url: string, options?: RequestInit): Promise<Response> {
    const res = await fetch(url, { ...options, signal: AbortSignal.timeout(timeout) })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      const detail = body ? ` — ${body.slice(0, 200)}` : ''
      throw Object.assign(new Error(`HTTP ${res.status}${detail}`), { httpStatus: res.status, responseBody: body })
    }
    return res
  }

  if (providerType === 'kilo') {
    const url = `${slimUrl}/api/gateway/models`
    const res = await tryFetch(url, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    })
    const json = await res.json() as { data?: Array<{ id: string }> }
    if (json.data && Array.isArray(json.data)) {
      return json.data.map(m => m.id).filter(Boolean)
    }
    throw new Error('Format de réponse inattendu — data[] manquant')
  }

  if (providerType === 'google') {
    const url = `${slimUrl}/v1beta/models?key=${encodeURIComponent(apiKey)}`
    const res = await tryFetch(url)
    const json = await res.json() as { models?: Array<{ name: string }> }
    if (json.models) {
      return json.models.map(m => m.name.replace(/^models\//, '')).filter(Boolean)
    }
    throw new Error('Format de réponse inattendu — models[] manquant')
  }

  if (providerType === 'openrouter' || providerType === 'opencode-zen' || providerType === 'custom') {
    const url = `${slimUrl}/models`
    const res = await tryFetch(url, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    })
    const json = await res.json() as { data?: Array<{ id: string }> }
    if (json.data) {
      return json.data.map(m => m.id).filter(Boolean)
    }
    throw new Error('Format de réponse inattendu — data[] manquant')
  }

  if (providerType === 'ollama') {
    const res = await tryFetch(`${slimUrl}/api/tags`)
    const json = await res.json() as { models?: Array<{ name: string }> }
    if (json.models) {
      return json.models.map(m => m.name.replace(/^.*?\//, '')).filter(Boolean)
    }
    throw new Error('Format de réponse inattendu — models[] manquant')
  }

  if (providerType === 'lm-studio') {
    const url = `${slimUrl}/models`
    const res = await tryFetch(url)
    const json = await res.json() as { data?: Array<{ id: string }> }
    if (json.data) {
      return json.data.map(m => m.id).filter(Boolean)
    }
    throw new Error('Format de réponse inattendu — data[] manquant')
  }

  throw new Error(`Provider "${providerType}" non supporté`)
}

export function getModelFetchGuidance(providerType: string, err: Error): string[] {
  const msg = err.message
  const httpStatus = (err as any).httpStatus as number | undefined
  const lines: string[] = []

  if (msg.includes('fetch') || msg.includes('ENOTFOUND') || msg.includes('ECONNREFUSED')) {
    if (isLocalProvider(providerType)) {
      lines.push(`🖥️  ${providerType === 'ollama' ? 'Ollama' : 'LM Studio'} n'est pas démarré`)
      lines.push(`   → Démarre le service localement`)
      if (providerType === 'ollama') lines.push('   → Télécharge : https://ollama.com')
      if (providerType === 'lm-studio') lines.push('   → Télécharge : https://lmstudio.ai')
    } else {
      lines.push('🔌 Impossible de contacter le serveur — vérifie ta connexion réseau')
    }
    const urlMatch = err.message.match(/https?:\/\/[^\s,)\]]+/)
    if (urlMatch) lines.push(`   URL testée : ${urlMatch[0]}`)
  } else if (httpStatus === 400 || httpStatus === 401 || httpStatus === 403 || msg.toLowerCase().includes('unauthorized') || msg.toLowerCase().includes('forbidden') || msg.toLowerCase().includes('not valid') || msg.toLowerCase().includes('invalid')) {
    lines.push('🔑 La clé API est invalide ou n\'a pas les permissions nécessaires')
    if (providerType === 'google') lines.push('   → Crée une clé sur https://aistudio.google.com/apikey')
    if (providerType === 'google') lines.push('   → Active l\'API "Generative Language" dans Google Cloud Console')
    if (providerType === 'openrouter') lines.push('   → Vérifie ta clé sur https://openrouter.ai/keys')
    if (providerType === 'opencode-zen') lines.push('   → Vérifie ta clé Opencode Zen')
    if (providerType === 'custom') lines.push('   → Vérifie que ta clé API est correcte pour ce provider')
  } else if (httpStatus === 429) {
    lines.push('⏳ Quota épuisé (429) — l\'alternateur va basculer sur la clé suivante')
  } else if (httpStatus && httpStatus >= 500) {
    lines.push('⚠️ Le serveur du provider est indisponible — réessaye plus tard')
  } else if (msg.includes('timeout') || msg.includes('ETIMEDOUT') || msg.includes('ECONNREFUSED')) {
    lines.push('⏱️ Le serveur ne répond pas — vérifie l\'URL de base')
  } else if (msg.includes('Unexpected') || msg.includes('inattendu')) {
    lines.push(`🔄 Le format de réponse est inattendu — l'URL "${providerType}" est peut-être incorrecte`)
  } else {
    lines.push(`❌ Erreur : ${msg.slice(0, 120)}`)
  }

  if (msg.includes('HTTP 404')) {
    lines.push('📭 URL introuvable — vérifie le endpoint /models ou /api/gateway/models')
  }

  return lines
}

/**
 * Resolve the best provider config for a given model name.
 * Returns { provider, apiKey, baseUrl, model } or undefined if no match.
 */
export function resolveProviderForModel(model: string): { provider: string; apiKey: string; baseUrl: string; model: string } | undefined {
  // 1. Detect provider from model prefix
  let providerType: string | undefined
  if (model.startsWith('kilo/')) providerType = 'kilo'
  else if (model.startsWith('gemini-') || model.startsWith('google/')) providerType = 'google'
  else if (model.startsWith('openrouter/')) providerType = 'openrouter'
  else if (model.startsWith('opencode-zen/')) providerType = 'opencode-zen'
  else if (model.startsWith('ollama/') || model === 'llama3.2' || model.includes('llama')) providerType = 'ollama'
  else if (model.startsWith('lm-studio/')) providerType = 'lm-studio'

  // 2. Try the detected type first
  const KEY_OPTIONAL = ['kilo', 'ollama', 'lm-studio']
  if (providerType) {
    // for key-optional providers, match any enabled entry
    // for key-required providers, only match if a key exists
    const entries = loadProviders().providers.filter(p =>
      p.provider === providerType && p.enabled &&
      (KEY_OPTIONAL.includes(providerType) || p.apiKeys.length > 0)
    )
    if (entries.length > 0) {
      const entry = entries[0]
      return { provider: providerType, apiKey: entry.apiKeys[0] || '', baseUrl: entry.baseUrl, model }
    }
  }

  // 3. Fallback: try all enabled providers
  const all = loadProviders().providers.filter(p => p.enabled)
  const match = all.find(p => p.defaultModel === model || p.apiKeys.length > 0 || KEY_OPTIONAL.includes(p.provider))
  if (match) {
    return { provider: match.provider, apiKey: match.apiKeys[0] || '', baseUrl: match.baseUrl, model }
  }

  return undefined
}

export function getKnownProviders(): { type: string; label: string; local: boolean }[] {
  return [
    { type: 'kilo', label: 'Kilo Gateway (recommandé)', local: false },
    { type: 'google', label: 'Google Gemini', local: false },
    { type: 'openrouter', label: 'OpenRouter', local: false },
    { type: 'opencode-zen', label: 'Opencode Zen', local: false },
    { type: 'custom', label: 'Custom (autre)', local: false },
    { type: 'ollama', label: 'Ollama (local)', local: true },
    { type: 'lm-studio', label: 'LM Studio (local)', local: true },
  ]
}

export function isLocalProvider(providerType: string): boolean {
  return providerType === 'ollama' || providerType === 'lm-studio'
}

/**
 * Ping a local provider to see if it's running.
 * Returns { alive, version } or { alive: false, error }.
 */
export async function checkLocalProvider(providerType: string): Promise<{ alive: boolean; version?: string; error?: string }> {
  const config = loadProviders().providers.find(p => p.provider === providerType)
  if (!config) return { alive: false, error: 'Non configuré' }

  const base = config.baseUrl.replace(/\/+$/, '')

  try {
    if (providerType === 'ollama') {
      const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3000) })
      if (!res.ok) return { alive: false, error: `HTTP ${res.status}` }
      const json = await res.json() as { models?: unknown[] }
      const count = json.models?.length ?? 0
      return { alive: true, version: `${count} modèle(s)` }
    }

    if (providerType === 'lm-studio') {
      const res = await fetch(`${base}/models`, { signal: AbortSignal.timeout(3000) })
      if (!res.ok) return { alive: false, error: `HTTP ${res.status}` }
      const json = await res.json() as { data?: unknown[] }
      const count = json.data?.length ?? 0
      return { alive: true, version: `${count} modèle(s)` }
    }

    return { alive: false, error: 'Type inconnu' }
  } catch (err) {
    const msg = (err as Error).message
    if (msg.includes('ECONNREFUSED') || msg.includes('fetch')) {
      return { alive: false, error: 'Service non démarré' }
    }
    return { alive: false, error: msg.slice(0, 80) }
  }
}
