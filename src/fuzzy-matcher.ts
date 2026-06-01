/**
 * fuzzy-matcher.ts — Moteur de matching flou via embeddings LM Studio
 *
 * Utilise un modèle d'embeddings local (text-embedding-nomic-embed-text-v1.5)
 * via LM Studio pour comparer la similarité sémantique entre une demande
 * utilisateur et les patterns du registre de scripts.
 *
 * Cache les embeddings des patterns pour éviter des appels réseau répétés.
 * Non-bloquant : timeouts, fallback silencieux si LM Studio indisponible.
 *
 * Usage :
 *   const result = await fuzzyMatch("liste mes projets", "project-request")
 *   if (result.matched) { /* exécuter le script *\/ }
 */

import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { reloadRegistry, matchScript, type ScriptEntry } from './script-runner.js'

// ── Types ──────────────────────────────────────────────

export interface FuzzyMatchResult {
  matched: boolean
  entry?: ScriptEntry
  params?: Record<string, string>
  similarity: number
}

interface CacheEntry {
  pattern: string
  subject: string | undefined
  script: string
  description: string
  embedding: number[]
}

interface EmbeddingCache {
  version: number
  updatedAt: string
  entries: CacheEntry[]
}

// ── Configuration ──────────────────────────────────────

const LM_STUDIO_URL = 'http://localhost:1234/v1'
const EMBEDDING_MODEL = 'text-embedding-nomic-embed-text-v1.5'
const SIMILARITY_THRESHOLD = 0.75
const CACHE_FILE = join(process.cwd(), 'telecom', 'cache', 'embeddings.json')
const REGISTRY_PATH = join(process.cwd(), 'data', 'scripts', 'registry.yaml')
const LOG_FILE = join(process.cwd(), 'telecom', 'logs', 'fuzzy-matches.log')
const TIMEOUT_MS = 5000
const REBUILD_TIMEOUT_MS = 30000 // 30s max pour tout le rebuild
const REBUILD_COOLDOWN_MS = 60000 // Ne pas réessayer le rebuild avant 60s
const MAX_LOG_ENTRIES = 500

// ── Cosine Similarity ──────────────────────────────────

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

// ── Embeddings via LM Studio ───────────────────────────

/**
 * Envoie un texte à LM Studio et retourne son embedding.
 * Retourne null si LM Studio est indisponible ou en erreur.
 */
async function getEmbedding(text: string): Promise<number[] | null> {
  try {
    const res = await fetch(`${LM_STUDIO_URL}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: text,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return null
    const json = (await res.json()) as {
      data?: Array<{ embedding: number[]; index: number }>
    }
    return json.data?.[0]?.embedding ?? null
  } catch {
    return null
  }
}

// ── Pattern → Phrases ──────────────────────────────────

/**
 * Convertit un pattern regex + sa description en un tableau de phrases
 * à encoder. La description est prioritaire ; le pattern nettoyé sert
 * de complément pour couvrir plus de formulations.
 */
function patternToPhrases(pattern: string, description: string): string[] {
  const phrases: string[] = []

  // La description est déjà une phrase lisible
  if (description && description.length > 3) {
    phrases.push(description)
  }

  // Nettoyer le pattern regex en phrase lisible
  const cleaned = pattern
    // Enlever les ancres
    .replace(/^\^/, '')
    .replace(/\$$/, '')
    // Remplacer les quantifieurs par des espaces
    .replace(/\\s\+/g, ' ')
    .replace(/\\s\*/g, ' ')
    .replace(/\\s/g, ' ')
    .replace(/\\S\+/g, ' quelque chose ')
    .replace(/\\S\*/g, ' quelque chose ')
    .replace(/\\w\+/g, ' mot ')
    .replace(/\\d\+/g, ' nombre ')
    // Enlever les groupes (capturants ou non)
    .replace(/\(\?:/g, '')
    .replace(/\(/g, '')
    .replace(/\)\?/g, '')
    .replace(/\)/g, '')
    // Enlever les métacaractères
    .replace(/\[\^\\\]\+/g, '')
    .replace(/\[/g, '')
    .replace(/\]/g, '')
    .replace(/\?/g, '')
    .replace(/\.\*/g, ' tout ')
    .replace(/\.\+/g, ' quelque chose ')
    .replace(/\\/g, '')
    // Nettoyer les espaces multiples
    .replace(/\s+/g, ' ')
    .trim()

  if (cleaned && cleaned.length > 3 && !phrases.includes(cleaned)) {
    phrases.push(cleaned)
  }

  return phrases
}

// ── Cooldown anti-rebuild ────────────────────────────

let _lastRebuildAttempt = 0

/**
 * Vérifie si une tentative de rebuild est autorisée (cooldown).
 * Évite de bombarder LM Studio si le service est down.
 */
function canAttemptRebuild(): boolean {
  const now = Date.now()
  if (now - _lastRebuildAttempt < REBUILD_COOLDOWN_MS) return false
  _lastRebuildAttempt = now
  return true
}

// ── Gestion du cache ───────────────────────────────────

function loadCache(): EmbeddingCache {
  try {
    if (existsSync(CACHE_FILE)) {
      const raw = readFileSync(CACHE_FILE, 'utf-8')
      return JSON.parse(raw) as EmbeddingCache
    }
  } catch {
    // Fichier corrompu → on ignore et on rebuild
  }
  return { version: 1, updatedAt: '', entries: [] }
}

function saveCache(cache: EmbeddingCache): void {
  const dir = dirname(CACHE_FILE)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8')
}

/**
 * Vérifie si le cache est à jour en comparant les dates de modification
 * du registre et du fichier de cache.
 */
function isCacheValid(): boolean {
  try {
    if (!existsSync(CACHE_FILE)) return false
    if (!existsSync(REGISTRY_PATH)) return true // pas de registre → cache toujours valide

    const cacheMtime = statSync(CACHE_FILE).mtimeMs
    const registryMtime = statSync(REGISTRY_PATH).mtimeMs

    return cacheMtime > registryMtime
  } catch {
    return false
  }
}

/**
 * Reconstruit le cache complet des embeddings à partir du registre.
 * Parcourt tous les scripts, génère des phrases à partir de chaque pattern,
 * les encode via LM Studio, et stocke le résultat moyenné.
 *
 * Retourne true si le cache a été reconstruit avec succès.
 */
export async function rebuildCache(): Promise<boolean> {
  const registry = reloadRegistry()

  // Filtrer les entrées génériques (catch-all ".*") qui pollueraient le fuzzy
  const relevantEntries = registry.scripts.filter(
    e => e.pattern !== '.*' && e.description && e.description.length > 3,
  )

  if (relevantEntries.length === 0) return false

  const entries: CacheEntry[] = []

  for (const entry of relevantEntries) {
    const phrases = patternToPhrases(entry.pattern, entry.description)
    const allEmbeddings: number[][] = []

    // Paralléliser les appels d'embedding pour les phrases d'un même pattern
    const phraseResults = await Promise.allSettled(
      phrases.map(p => getEmbedding(p)),
    )
    for (const r of phraseResults) {
      if (r.status === 'fulfilled' && r.value) {
        allEmbeddings.push(r.value)
      }
    }

    if (allEmbeddings.length > 0) {
      // Moyenner les embeddings des différentes phrases pour un même pattern
      const dim = allEmbeddings[0].length
      const avg = new Array(dim).fill(0)
      for (const emb of allEmbeddings) {
        for (let i = 0; i < dim; i++) {
          avg[i] += emb[i] / allEmbeddings.length
        }
      }
      entries.push({
        pattern: entry.pattern,
        subject: entry.subject,
        script: entry.script,
        description: entry.description,
        embedding: avg,
      })
    }
  }

  if (entries.length === 0) return false

  saveCache({
    version: 1,
    updatedAt: new Date().toISOString(),
    entries,
  })

  return true
}

/**
 * Rebuild avec timeout global.
 * Évite de bloquer le daemon si LM Studio est lent.
 */
async function rebuildCacheWithTimeout(): Promise<boolean> {
  const result = await Promise.race([
    rebuildCache(),
    new Promise<false>(resolve => setTimeout(() => resolve(false), REBUILD_TIMEOUT_MS)),
  ])
  return result
}

/**
 * Retourne des statistiques sur le cache des embeddings pour le diagnostic.
 * Utile pour savoir combien de patterns sont couverts par le fuzzy matching.
 */
export function getCoverage(): {
  cached: number
  total: number
  outdated: boolean
  cacheSize: number
} {
  const registry = reloadRegistry()
  const total = registry.scripts.filter(
    e => e.pattern !== '.*' && e.description && e.description.length > 3,
  ).length

  const cache = loadCache()
  const cached = cache.entries.length
  const outdated = existsSync(CACHE_FILE) && existsSync(REGISTRY_PATH)
    ? statSync(CACHE_FILE).mtimeMs < statSync(REGISTRY_PATH).mtimeMs
    : false

  let cacheSize = 0
  try {
    if (existsSync(CACHE_FILE)) {
      cacheSize = statSync(CACHE_FILE).size
    }
  } catch { /* ignore */ }

  return { cached, total, outdated, cacheSize }
}

/**
 * Vide le cache des embeddings (force un rebuild au prochain appel).
 * Sauvegarde d'abord l'ancien cache dans embeddings.backup.json.
 */
export function clearEmbeddingCache(): void {
  // Backup
  try {
    if (existsSync(CACHE_FILE)) {
      const dir = dirname(CACHE_FILE)
      const backup = join(dir, 'embeddings.backup.json')
      writeFileSync(backup, readFileSync(CACHE_FILE, 'utf-8'), 'utf-8')
    }
  } catch {
    // Non-bloquant
  }
  // Vider le cache actif
  try {
    if (existsSync(CACHE_FILE)) {
      // On ne supprime pas, on vide (pour éviter les erreurs de lecture concurrentes)
      saveCache({ version: 1, updatedAt: '', entries: [] })
    }
  } catch {
    // Non-bloquant
  }
}

// ── Logger ─────────────────────────────────────────────

interface LogEntry {
  timestamp: string
  demande: string
  action: 'accepted' | 'rejected'
  matched_pattern?: string
  similarity?: number
  script?: string
  subject?: string | null
}

/**
 * Ajoute une entrée dans le fichier de log des fuzzy matches.
 * Gère la rotation (max MAX_LOG_ENTRIES) et la création du dossier.
 */
function appendLogEntry(entry: LogEntry): void {
  try {
    const logDir = dirname(LOG_FILE)
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true })

    // Lire les entrées existantes
    let entries: string[] = []
    try {
      if (existsSync(LOG_FILE)) {
        const content = readFileSync(LOG_FILE, 'utf-8').trim()
        if (content) entries = content.split('\n')
      }
    } catch {
      // Ignoré — on continue avec un tableau vide
    }

    // Ajouter la nouvelle entrée
    entries.push(JSON.stringify(entry))

    // Rotation
    if (entries.length > MAX_LOG_ENTRIES) {
      entries = entries.slice(entries.length - MAX_LOG_ENTRIES)
    }

    writeFileSync(LOG_FILE, entries.join('\n') + '\n', 'utf-8')
  } catch {
    // Non-bloquant
  }
}

// ── API publique ───────────────────────────────────────

/**
 * Tente un matching flou entre une demande utilisateur et les patterns
 * du registre de scripts, via embeddings LM Studio.
 *
 * Le processus :
 * 1. Vérifie la validité du cache (rebuild si nécessaire, avec cooldown)
 * 2. Obtient l'embedding de la demande via LM Studio
 * 3. Compare (similarité cosinus) avec les embeddings des patterns connus
 * 4. Retourne le meilleur match au-dessus du seuil de similarité
 *
 * Retourne { matched: false } si LM Studio est indisponible, si le cache
 * est vide, ou si aucun pattern n'atteint le seuil.
 *
 * @param demande - Texte brut de la demande utilisateur
 * @param subject - Subject intercom optionnel (filtre les patterns par subject)
 */
export async function fuzzyMatch(
  demande: string,
  subject?: string,
): Promise<FuzzyMatchResult> {
  // Étape 1 : Cache valide et cooldown respecté ?
  if (!isCacheValid()) {
    if (canAttemptRebuild()) {
      const ok = await rebuildCacheWithTimeout()
      if (!ok) return { matched: false, similarity: 0 }
    } else {
      return { matched: false, similarity: 0 }
    }
  }

  // Étape 2 : Embedding de la demande
  const demandeEmbedding = await getEmbedding(demande)
  if (!demandeEmbedding) {
    // LM Studio indisponible → fallback silencieux
    return { matched: false, similarity: 0 }
  }

  // Étape 3 : Charger le cache
  const cache = loadCache()
  if (cache.entries.length === 0) return { matched: false, similarity: 0 }

  // Étape 4 : Trouver le meilleur match
  let bestMatch: { entry: CacheEntry; similarity: number } | null = null
  let bestSimilarity = 0 // similarité maximale, même sous le seuil

  for (const cached of cache.entries) {
    // Filtrer par subject si spécifié
    if (subject && cached.subject !== subject) continue

    const sim = cosineSimilarity(demandeEmbedding, cached.embedding)
    if (sim > bestSimilarity) {
      bestSimilarity = sim
    }
    if (sim > SIMILARITY_THRESHOLD && (!bestMatch || sim > bestMatch.similarity)) {
      bestMatch = { entry: cached, similarity: sim }
    }
  }

  // Étape 5 : Retourner le résultat
  if (bestMatch) {
    // Essayer le regex matching pour extraire les paramètres
    // (peut réussir même si le fuzzy a été prioritaire)
    const fullMatch = matchScript(demande, bestMatch.entry.subject)

    // Logger la correspondance
    appendLogEntry({
      timestamp: new Date().toISOString(),
      demande,
      matched_pattern: bestMatch.entry.pattern,
      similarity: Math.round(bestMatch.similarity * 100) / 100,
      script: bestMatch.entry.script,
      action: 'accepted',
    })

    return {
      matched: true,
      entry: {
        pattern: bestMatch.entry.pattern,
        subject: bestMatch.entry.subject,
        script: bestMatch.entry.script,
        description: bestMatch.entry.description,
      },
      params: fullMatch?.params,
      similarity: bestMatch.similarity,
    }
  }

  // Logger l'échec pour analyse ultérieure par agent-telecom
  appendLogEntry({
    timestamp: new Date().toISOString(),
    demande,
    subject: subject ?? null,
    action: 'rejected',
    similarity: Math.round(bestSimilarity * 100) / 100,
  })

  return { matched: false, similarity: bestSimilarity }
}

/**
 * Vérifie si LM Studio est accessible (ping l'endpoint /v1/models).
 * Utile pour les diagnostics.
 */
// ── Comptage des échecs récurrents ──────────────────────

/**
 * Compte combien de demandes similaires (même texte normalisé) ont été rejetées
 * dans le fichier de log des fuzzy matches.
 *
 * Permet au daemon de détecter les échecs récurrents et de déclencher
 * une suggestion automatique de pattern.
 *
 * @param demande - Texte brut de la demande utilisateur
 * @param minCount - Nombre minimum d'occurrences pour être significatif (défaut 3)
 * @param windowMinutes - Fenêtre temporelle en minutes (défaut 60, 0 = tout)
 * @returns Le nombre d'occurrences similaires trouvées
 *
 * Exemple :
 *   const count = countRejectedDemandes("problème de connexion")
 *   if (count >= 3) { /* déclencher suggestion *\/ }
 */
export function countRejectedDemandes(
  demande: string,
  windowMinutes: number = 60,
): number {
  if (!demande || !demande.trim()) return 0
  try {
    if (!existsSync(LOG_FILE)) return 0

    const content = readFileSync(LOG_FILE, 'utf-8').trim()
    if (!content) return 0

    const entries: Array<{ demande?: string; action?: string; timestamp?: string; subject?: string | null }> = []
    for (const line of content.split('\n')) {
      try { entries.push(JSON.parse(line)) } catch { /* skip malformed */ }
    }

    // Normaliser la demande pour la comparaison
    const normalize = (s: string) =>
      s.toLowerCase().replace(/[?,.!;:]/g, '').replace(/\s+/g, ' ').trim()

    const targetNormalized = normalize(demande)

    // Fenêtre temporelle
    const windowMs = windowMinutes > 0 ? windowMinutes * 60 * 1000 : 0
    const cutoff = windowMs > 0 ? Date.now() - windowMs : 0

    let count = 0
    for (const e of entries) {
      if (e.action !== 'rejected') continue
      if (!e.demande) continue
      if (cutoff > 0 && e.timestamp) {
        const ts = new Date(e.timestamp).getTime()
        if (isNaN(ts) || ts < cutoff) continue
      }

      const normalized = normalize(e.demande)
      if (normalized === targetNormalized || normalized.includes(targetNormalized) || targetNormalized.includes(normalized)) {
        count++
      }
    }

    return count
  } catch {
    return 0
  }
}

export async function checkLmStudio(): Promise<{
  alive: boolean
  models?: string[]
  error?: string
}> {
  try {
    const res = await fetch(`${LM_STUDIO_URL}/models`, {
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) {
      return { alive: false, error: `HTTP ${res.status}` }
    }
    const json = (await res.json()) as { data?: Array<{ id: string }> }
    const models = json.data?.map(m => m.id) ?? []
    return {
      alive: true,
      models,
    }
  } catch (err) {
    const msg = (err as Error).message
    if (msg.includes('ECONNREFUSED') || msg.includes('fetch')) {
      return { alive: false, error: 'LM Studio non démarré' }
    }
    return { alive: false, error: msg.slice(0, 80) }
  }
}
