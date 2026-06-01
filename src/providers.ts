import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, isAbsolute } from 'path'

export interface ApiKeyEntry {
  id: string
  key: string
  label?: string
}

export interface ProviderConfig {
  name: string
  provider: string
  apiKeys: ApiKeyEntry[]
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

let configPath = join(process.cwd(), 'providers.json')

/**
 * Override the providers.json path (for tests to use a temp file).
 * Pass undefined/null to reset to default.
 */
export function setProviderConfigPath(path?: string): void {
  if (path && (isAbsolute(path) || /^[a-zA-Z]:\\/.test(path) || /^[a-zA-Z]:\//.test(path))) {
    configPath = path
  } else if (path) {
    configPath = join(process.cwd(), path)
  } else {
    configPath = join(process.cwd(), 'providers.json')
  }
}


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
      baseUrl: 'https://opencode.ai/zen/v1',
      defaultModel: 'opencode-zen/default',
      enabled: false,
      currentKeyIndex: 0,
      maxParallel: 1,
    },
    {
      name: 'Ollama (local)',
      provider: 'ollama-local',
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

/** Deep-clone simple helper (JSON roundtrip — safe for ProvidersFile shape) */
function cloneDefaults(): ProvidersFile {
  return JSON.parse(JSON.stringify(DEFAULT_PROVIDERS)) as ProvidersFile
}

/** Backup a corrupted file before repairing */
function backupPath(): string { return configPath + '.corrupted' }

function loadProviders(): ProvidersFile {
  if (!existsSync(configPath)) {
    writeFileSync(configPath, JSON.stringify(cloneDefaults(), null, 2), 'utf-8')
    return cloneDefaults()
  }
  try {
    const content = readFileSync(configPath, 'utf-8')
    const data = JSON.parse(content) as ProvidersFile
    // Résilience : providers[] doit être un tableau ; filtrer les entrées null/malformées
    if (!Array.isArray(data.providers)) {
      // Backup + repair the corrupted file, then return fresh defaults
      backupAndRepair(content, 'providers[] not an array')
      return cloneDefaults()
    }
    data.providers = data.providers.filter(p => p && typeof p === 'object')
    for (const p of data.providers) {
      // migrate legacy string apiKeys → ApiKeyEntry[]
      if (!p.apiKeys) p.apiKeys = []
      if (typeof p.apiKeys[0] === 'string') {
        p.apiKeys = (p.apiKeys as unknown as string[]).map(k => ({
          id: generateKeyId(),
          key: k,
        }))
      }
      if (p.apiKey && !(p.apiKeys as ApiKeyEntry[]).some(e => e.key === p.apiKey)) {
        ;(p.apiKeys as ApiKeyEntry[]).unshift({ id: generateKeyId(), key: p.apiKey })
      }
      if (p.currentKeyIndex === undefined) p.currentKeyIndex = 0
      if (p.maxParallel === undefined) p.maxParallel = 1
      p.apiKey = undefined

      // migrate legacy provider type 'ollama' → 'ollama-local'
      if (p.provider === 'ollama') {
        if (p.name === 'Ollama') p.name = 'Ollama (local)'
        p.provider = 'ollama-local'
      }
    }
    return data
  } catch (err) {
    // Backup + repair the corrupted file, then return fresh defaults
    const corrupted = tryReadRaw()
    backupAndRepair(corrupted, (err as Error).message)
    return cloneDefaults()
  }
}

/** Try to read the raw file content (best-effort) */
function tryReadRaw(): string {
  try { return readFileSync(configPath, 'utf-8') } catch { return '(unreadable)' }
}

/** Rename corrupted file → .corrupted, then write fresh defaults */
function backupAndRepair(corruptedContent: string, reason: string): void {
  try {
    // Rename corrupted file to .corrupted (with timestamp suffix if already exists)
    let bp = backupPath()
    if (existsSync(bp)) {
      bp = configPath + '.corrupted.' + Date.now()
    }
    // Copy content to backup then write defaults
    writeFileSync(bp, corruptedContent, 'utf-8')
    writeFileSync(configPath, JSON.stringify(cloneDefaults(), null, 2), 'utf-8')
    console.error(`[providers] ⚠ Fichier providers.json corrompu (${reason})`)
    console.error(`[providers]   → Sauvegardé dans ${backupPath().replace(process.cwd() + '/', '')}`)
    console.error(`[providers]   → Fichier réinitialisé avec la configuration par défaut`)
  } catch {
    // Échec du backup — on force l'écriture des defaults au moins
    try { writeFileSync(configPath, JSON.stringify(cloneDefaults(), null, 2), 'utf-8') } catch { /* dernier recours */ }
  }
}

function saveProviders(data: ProvidersFile): void {
  writeFileSync(configPath, JSON.stringify(data, null, 2), 'utf-8')
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

export function addProvider(config: {
  name: string
  provider: string
  apiKeys?: (string | ApiKeyEntry)[]
  apiKey?: string
  baseUrl?: string
  defaultModel?: string
  enabled?: boolean
  maxParallel?: number
}): void {
  const data = loadProviders()
  if (data.providers.find(p => p.name === config.name)) {
    throw new Error(`Provider "${config.name}" already exists`)
  }
  const apiKeys: ApiKeyEntry[] = []
  if (config.apiKeys) {
    for (const k of config.apiKeys) {
      apiKeys.push(typeof k === 'string' ? { id: generateKeyId(), key: k } : k)
    }
  }
  if (config.apiKey) apiKeys.push({ id: generateKeyId(), key: config.apiKey })
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

export function setProviderApiKey(name: string, apiKey: string, label?: string): boolean {
  const data = loadProviders()
  const provider = data.providers.find(p => p.name === name)
  if (!provider) return false
  if (!provider.apiKeys.some(e => e.key === apiKey)) {
    provider.apiKeys.push({ id: generateKeyId(), key: apiKey, label })
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
  return configPath
}

// ── Multi-key helpers ────────────────────────────────────

export function getProviderKeys(name: string): ApiKeyEntry[] {
  const p = getProvider(name)
  return p ? [...p.apiKeys] : []
}

export function addProviderKey(name: string, key: string, label?: string): boolean {
  const data = loadProviders()
  const p = data.providers.find(pr => pr.name === name)
  if (!p) return false
  if (!p.apiKeys.some(e => e.key === key)) {
    p.apiKeys.push({ id: generateKeyId(), key, label })
    saveProviders(data)
  }
  return true
}

export function removeProviderKey(name: string, key: string): boolean {
  const data = loadProviders()
  const p = data.providers.find(pr => pr.name === name)
  if (!p) return false
  const idx = p.apiKeys.findIndex(e => e.key === key)
  if (idx === -1) return false
  p.apiKeys.splice(idx, 1)
  saveProviders(data)
  return true
}

// ── Key ID generator ─────────────────────────────────────

let keyIdCounter = 0
function generateKeyId(): string {
  keyIdCounter++
  // short, readable ID: k_001, k_002, …
  return 'k_' + String(keyIdCounter).padStart(3, '0')
}

// ── Key rotation / alternator ────────────────────────────

/**
 * Return the next available (non-rate-limited) API key for a given provider type.
 * Cycles through ALL keys across ALL provider entries of that type in round-robin.
 * Returns undefined if all keys are rate-limited.
 */
/**
 * Return the next available (non-rate-limited) API key entry for a given provider type.
 * Cycles through ALL keys across ALL provider entries of that type in round-robin.
 * Returns the ApiKeyEntry + providerName, or undefined if all keys are rate-limited.
 */
export function getNextApiKey(providerType: string): { keyId: string; key: string; providerName: string } | undefined {
  resetExpiredCooldowns()
  const entries = loadProviders().providers.filter(p => p.provider === providerType && p.enabled)
  if (entries.length === 0) return undefined

  // flatten all non-rate-limited ApiKeyEntry objects
  const allFresh: { keyId: string; key: string; providerName: string }[] = []
  for (const entry of entries) {
    for (const k of entry.apiKeys) {
      if (!rateLimitedUntil.has(k.id)) {
        allFresh.push({ keyId: k.id, key: k.key, providerName: entry.name })
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
 * Read the current rotation cursor position for a provider type.
 * Returns the index into the flattened keys list, or 0 if not set.
 */
export function getRotationCursor(providerType: string): number {
  return cursor.get(providerType) ?? 0
}

/**
 * Mark a key entry as rate-limited for a given duration.
 * Returns the next available key if any, allowing immediate failover.
 */
export function markRateLimited(keyIdOrKey: string, cooldownMs = 60000): { keyId: string; key: string; providerName: string } | undefined {
  rateLimitedUntil.set(keyIdOrKey, Date.now() + cooldownMs)

  // find which provider type this key entry belongs to
  // Try matching by keyId first, then fallback to matching by key value
  let entries = loadProviders().providers.filter(p => p.apiKeys.some(e => e.id === keyIdOrKey))
  if (entries.length === 0) {
    entries = loadProviders().providers.filter(p => p.apiKeys.some(e => e.key === keyIdOrKey))
    if (entries.length > 0) {
      // Also mark the actual keyId
      for (const e of entries[0].apiKeys) {
        if (e.key === keyIdOrKey) {
          rateLimitedUntil.set(e.id, Date.now() + cooldownMs)
          break
        }
      }
    }
  }
  if (entries.length === 0) return undefined

  return getNextApiKey(entries[0].provider)
}

/**
 * Check if a given key entry ID is currently rate-limited.
 */
export function isRateLimited(keyId: string): boolean {
  resetExpiredCooldowns()
  return rateLimitedUntil.has(keyId)
}

/**
 * Return detailed key status for all keys of a provider.
 */
export function getProviderKeyStatuses(name: string): {
  keyId: string
  keySuffix: string
  label?: string
  providerName: string
  providerType: string
  rateLimited: boolean
  remainingCooldownMs: number
  isNextKey: boolean
}[] {
  resetExpiredCooldowns()
  const now = Date.now()
  const p = loadProviders().providers.find(pr => pr.name === name)
  if (!p) return []

  // Flatten all non-rate-limited keys like getNextApiKey does
  const allFresh: { keyId: string; key: string }[] = []
  for (const k of p.apiKeys) {
    if (!rateLimitedUntil.has(k.id) || (rateLimitedUntil.get(k.id) ?? 0) <= now) {
      allFresh.push({ keyId: k.id, key: k.key })
    }
  }

  // Determine which key will be selected next (the one at cursor position)
  const cursorPos = getRotationCursor(p.provider)
  const nextKeyId = allFresh.length > 0 ? allFresh[cursorPos % allFresh.length]?.keyId : undefined

  return p.apiKeys.map(k => {
    const until = rateLimitedUntil.get(k.id)
    const rateLimited = until !== undefined && until > now
    return {
      keyId: k.id,
      keySuffix: k.key.slice(-4),
      label: k.label,
      providerName: p.name,
      providerType: p.provider,
      rateLimited,
      remainingCooldownMs: until ? Math.max(0, until - now) : 0,
      isNextKey: k.id === nextKeyId && !rateLimited,
    }
  })
}

/**
 * Check if an API key string is already used by another provider entry.
 */
export function isApiKeyUsed(apiKey: string): { name: string; provider: string } | undefined {
  if (!apiKey) return undefined
  for (const p of loadProviders().providers) {
    if (p.apiKeys.some(e => e.key === apiKey)) return { name: p.name, provider: p.provider }
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
      const endpoint = (providerType === 'ollama' || providerType === 'ollama-local' || providerType === 'ollama-cloud') ? '/api/chat' : '/chat/completions'
      diagnostics.push(`   URL testée : ${baseUrl}${endpoint}`)
    } else if (msg.includes('timeout') || msg.includes('ETIMEDOUT') || msg.includes('ECONNREFUSED')) {
      diagnostics.push('🔌 Le serveur ne répond pas')
      if (providerType === 'ollama' || providerType === 'ollama-local' || providerType === 'lm-studio') {
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

/**
 * Return the API key string for a given key ID.
 */
export function getKeyById(keyId: string): string | undefined {
  for (const p of loadProviders().providers) {
    const found = p.apiKeys.find(e => e.id === keyId)
    if (found) return found.key
  }
  return undefined
}

/**
 * Find the key ID for a given API key string.
 * Returns the matching keyId, or the key string itself if not found.
 */
export function getKeyIdByKey(key: string): string {
  for (const p of loadProviders().providers) {
    const found = p.apiKeys.find(e => e.key === key)
    if (found) return found.id
  }
  return key
}

// ── Provider types requiring a valid API key ─────────────
const KEY_REQUIRED = ['google', 'openrouter', 'opencode-zen', 'custom', 'ollama-cloud']

/**
 * Minimal API key format validation per provider.
 * Catches obviously invalid/fake keys (e.g. 'test-key') before making HTTP calls.
 * Returns true if the key passes basic format checks, false if clearly invalid.
 */
function isValidApiKeyFormat(providerType: string, apiKey: string): boolean {
  // Empty key is valid for optional-key providers (checked in fetchModels)
  if (!apiKey) return !KEY_REQUIRED.includes(providerType)
  // Providers with optional keys: any non-empty key passes
  if (!KEY_REQUIRED.includes(providerType)) return true
  // Required-key providers: key must be at least 10 chars
  return apiKey.length >= 10
}

// ── Model fetching ───────────────────────────────────────

export async function fetchModels(providerType: string, apiKey: string, baseUrl: string): Promise<string[]> {
  // ── Pre-check : valide le format de la clé AVANT tout appel réseau ──
  // Évite les throw HTTP distrayants dans le debugger (ex: 'test-key' → Google 400)
  if (!isValidApiKeyFormat(providerType, apiKey)) {
    const body = JSON.stringify({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } })
    throw Object.assign(
      new Error(`HTTP 400 — ${body.slice(0, 200)}`),
      { httpStatus: 400, responseBody: body },
    )
  }
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

  if (providerType === 'ollama-local') {
    const res = await tryFetch(`${slimUrl}/api/tags`)
    const json = await res.json() as { models?: Array<{ name: string }> }
    if (json.models) {
      return json.models.map(m => m.name.replace(/^.*?\//, '')).filter(Boolean)
    }
    throw new Error('Format de réponse inattendu — models[] manquant')
  }

  if (providerType === 'ollama-cloud') {
    const res = await tryFetch(`${slimUrl}/api/tags`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    })
    const json = await res.json() as { models?: Array<{ name: string }> }
    if (json.models) {
      return json.models.map(m => m.name).filter(Boolean)
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
  const httpStatus = (err as { httpStatus?: number }).httpStatus
  const lines: string[] = []

  // Priorité 1 : Erreurs de connexion (avant les erreurs d'authentification)
  if (msg.includes('fetch') || msg.includes('ENOTFOUND') || msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT') || msg.includes('timeout')) {
    if (providerType === 'ollama') providerType = 'ollama-local'

    if (isLocalProvider(providerType)) {
      lines.push(`🖥️  ${providerType === 'ollama-local' ? 'Ollama' : 'LM Studio'} n'est pas démarré`)
      lines.push(`   → Démarre le service localement`)
      if (providerType === 'ollama-local') lines.push('   → Télécharge : https://ollama.com')
      if (providerType === 'lm-studio') lines.push('   → Télécharge : https://lmstudio.ai')
    } else {
      lines.push('🔌 Impossible de contacter le serveur — vérifie ta connexion réseau')
    }
    const urlMatch = err.message.match(/https?:\/\/[^\s,)\]]+/)
    if (urlMatch) lines.push(`   URL testée : ${urlMatch[0]}`)
  }
  // Priorité 2 : Erreurs d'authentification (seulement pour les providers qui nécessitent une clé)
  else if ((httpStatus === 400 || httpStatus === 401 || httpStatus === 403 || msg.toLowerCase().includes('unauthorized') || msg.toLowerCase().includes('forbidden')) && !isLocalProvider(providerType)) {
    lines.push('🔑 La clé API est invalide ou n\'a pas les permissions nécessaires')
    if (providerType === 'google') lines.push('   → Crée une clé sur https://aistudio.google.com/apikey')
    if (providerType === 'google') lines.push('   → Active l\'API "Generative Language" dans Google Cloud Console')
    if (providerType === 'openrouter') lines.push('   → Vérifie ta clé sur https://openrouter.ai/keys')
    if (providerType === 'opencode-zen') lines.push('   → Vérifie ta clé Opencode Zen')
    if (providerType === 'ollama-cloud') lines.push('   → Crée une clé sur https://ollama.com/settings/keys')
    if (providerType === 'custom') lines.push('   → Vérifie que ta clé API est correcte pour ce provider')
  }
  // Priorité 3 : Autres erreurs HTTP
  else if (httpStatus === 429) {
    lines.push('⏳ Quota épuisé (429) — l\'alternateur va basculer sur la clé suivante')
  } else if (httpStatus && httpStatus >= 500) {
    lines.push('⚠️ Le serveur du provider est indisponible — réessaye plus tard')
  } else if (msg.includes('Unexpected') || msg.includes('inattendu')) {
    lines.push(`🔄 Le format de réponse est inattendu — l'URL "${providerType}" est peut-être incorrecte`)
  } else if (msg.includes('HTTP 404')) {
    lines.push('📭 URL introuvable — vérifie le endpoint /models ou /api/gateway/models')
  } else {
    lines.push(`❌ Erreur : ${msg.slice(0, 120)}`)
  }

  return lines
}

/**
 * Resolve the best provider config for a given model name.
 * Returns { provider, apiKey, baseUrl, model } or undefined if no match.
 */
export function resolveProviderForModel(model: string, providerHint?: string): { provider: string; apiKey: string; baseUrl: string; model: string } | undefined {
  // 0. If provider hint is provided, use key rotation first
  if (providerHint) {
    const rotated = getNextApiKey(providerHint)
    if (rotated) {
      const entry = loadProviders().providers.find(p => p.name === rotated.providerName)
      if (entry) {
        return { provider: providerHint, apiKey: rotated.key, baseUrl: entry.baseUrl, model }
      }
    }
    // Fallback: if all keys are rate-limited, pick the first entry anyway (last resort)
    const fallback = loadProviders().providers.find(p => p.provider === providerHint && p.enabled)
    if (!fallback) {
      const allProviders = loadProviders().providers.filter(p => p.provider === providerHint)
      if (allProviders.length > 0) {
        return { provider: providerHint, apiKey: allProviders[0].apiKeys[0]?.key || '', baseUrl: allProviders[0].baseUrl, model }
      }
    }
    if (fallback) {
      const rotated2 = getNextApiKey(providerHint)
      return { provider: providerHint, apiKey: rotated2?.key || fallback.apiKeys[0]?.key || '', baseUrl: fallback.baseUrl, model }
    }
  }

  // 1. Detect provider from model prefix
  let providerType: string | undefined
  if (model.startsWith('kilo/') || model.startsWith('kilo-auto/')) providerType = 'kilo'
  else if (model.startsWith('gemini-') || model.startsWith('google/')) providerType = 'google'
  else if (model.startsWith('openrouter/')) providerType = 'openrouter'
  else if (model.startsWith('opencode-zen/')) providerType = 'opencode-zen'
  else if (model.startsWith('ollama/') || model === 'llama3.2' || model.includes('llama')) providerType = 'ollama-local'
  else if (model.startsWith('lm-studio/')) providerType = 'lm-studio'

  // 2. Try the detected type first — use key rotation
  const KEY_OPTIONAL = ['kilo', 'ollama-local', 'lm-studio']
  if (providerType) {
    const rotated = getNextApiKey(providerType)
    if (rotated) {
      const entry = loadProviders().providers.find(p => p.name === rotated.providerName)
      if (entry) {
        return { provider: providerType, apiKey: rotated.key, baseUrl: entry.baseUrl, model }
      }
    }
    // All keys rate-limited or no keys: try to match any enabled entry
    const entries = loadProviders().providers.filter(p =>
      p.provider === providerType && p.enabled &&
      (KEY_OPTIONAL.includes(providerType) || p.apiKeys.length > 0)
    )
    if (entries.length > 0) {
      const entry = entries[0]
      return { provider: providerType, apiKey: entry.apiKeys[0]?.key || '', baseUrl: entry.baseUrl, model }
    }
  }

  // 3. Fallback: try all enabled providers
  const all = loadProviders().providers.filter(p => p.enabled)
  for (const p of all) {
    const rotated = p.apiKeys.length > 0 ? getNextApiKey(p.provider) : undefined
    if (rotated) {
      return { provider: p.provider, apiKey: rotated.key, baseUrl: p.baseUrl, model }
    }
  }
  // Last resort: pick the first enabled provider even if rate-limited
  const match = all.find(p => p.defaultModel === model || p.apiKeys.length > 0 || KEY_OPTIONAL.includes(p.provider))
  if (match) {
    return { provider: match.provider, apiKey: match.apiKeys[0]?.key || '', baseUrl: match.baseUrl, model }
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
    { type: 'ollama-local', label: 'Ollama (local)', local: true },
    { type: 'ollama-cloud', label: 'Ollama Cloud', local: false },
    { type: 'lm-studio', label: 'LM Studio (local)', local: true },
  ]
}

export function isLocalProvider(providerType: string): boolean {
  return providerType === 'ollama-local' || providerType === 'lm-studio'
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
    if (providerType === 'ollama-local') {
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
