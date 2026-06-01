/**
 * src/learning.ts — Learning Tracker pour le service Parades (Phase 3+)
 *
 * Module dédié au suivi des choix utilisateur, à la détection des préférences
 * et des changements de comportement. Les données sont stockées dans le bureau
 * de l'agent : `telecom/agents/agent-parades/stats.json`.
 *
 * ════════════════════════════════════════════════════════════════
 *   API publique :
 *     LearningTracker.load()          → LearningStats
 *     LearningTracker.recordChoice()  → void
 *     LearningTracker.recordMiss()    → void
 *     LearningTracker.getPreferences() → CategoryPreferences
 *     LearningTracker.isReady()       → boolean
 *     LearningTracker.getHistory()    → ChoiceHistoryEntry[]
 *     LearningTracker.resetStats()    → void
 *     LearningTracker.classifyCommand() → string
 * ════════════════════════════════════════════════════════════════
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

// ── Chemins ──────────────────────────────────────────────

const STATS_DIR = join(process.cwd(), 'telecom', 'agents', 'agent-parades')
const STATS_PATH = join(STATS_DIR, 'stats.json')
const HISTORY_PATH = join(STATS_DIR, 'history.json')

// ── Types publics ────────────────────────────────────────

export interface LearningStats {
  /** Nombre total de parades choisies par l'utilisateur */
  totalChoices: number
  /** Les 5 dernières commandes choisies (pour détection de shift) */
  last5Choices: string[]
  /** Fréquence des catégories choisies (clé = nom de catégorie, valeur = nombre) */
  categoryHits: Record<string, number>
  /** Fréquence des catégories ignorées/rejetées (clé = nom, valeur = nombre) */
  categoryMisses: Record<string, number>
  /** Dernière mise à jour (ISO timestamp) */
  lastUpdated: string
}

export interface CategoryPreferences {
  /** Catégories les plus choisies (top 3, triées par fréquence décroissante) */
  preferred: string[]
  /** Catégories systématiquement ignorées (misses >= 3 consécutives) */
  avoided: string[]
  /** True si un changement de comportement est détecté dans les 5 derniers choix */
  recentShift: boolean
}

export interface ChoiceHistoryEntry {
  /** Commande exacte qui a été choisie */
  command: string
  /** Catégorie de la commande (projet, tâche, agent, etc.) */
  category: string
  /** Timestamp ISO du choix */
  timestamp: string
}

// ── Valeurs par défaut ───────────────────────────────────

const DEFAULT_STATS: LearningStats = {
  totalChoices: 0,
  last5Choices: [],
  categoryHits: {},
  categoryMisses: {},
  lastUpdated: new Date(0).toISOString(),
}

// ── Helper : copie profonde de DEFAULT_STATS ─────────────

/**
 * Retourne une copie PROFONDE de DEFAULT_STATS avec lastUpdated à l'instant présent.
 *
 * Nécessaire car le spread `{ ...DEFAULT_STATS }` ne copie que les références
 * des tableaux/objets (shallow). Les .push() et [cat]++ modifieraient les objets
 * partagés par toutes les instances.
 */
function freshDefaultStats(): LearningStats {
  return {
    totalChoices: DEFAULT_STATS.totalChoices,
    last5Choices: [],
    categoryHits: {},
    categoryMisses: {},
    lastUpdated: new Date().toISOString(),
  }
}

// ── LearningTracker ──────────────────────────────────────

/**
 * Tracker d'apprentissage pour le service Parades.
 *
 * Chargement paresseux (lazy) : les stats ne sont lues depuis le disque
 * qu'au premier appel de `load()` ou `recordChoice()`. Cela évite des
 * accès disque inutiles si le tracker n'est jamais utilisé.
 *
 * Thread-safe : toutes les méthodes sont synchrones car Node.js est
 * single-thread. Les appels writeFileSync sont atomiques pour les fichiers
 * < 1KB (stats.json fait < 500 octets typiquement).
 */
export class LearningTracker {
  private _loaded = false
  private _stats: LearningStats = freshDefaultStats()
  private _history: ChoiceHistoryEntry[] = []

  /**
   * Charge (ou recharge) les stats depuis le disque.
   * Crée automatiquement le fichier avec des valeurs par défaut
   * s'il n'existe pas ou s'il est corrompu.
   *
   * @returns Les LearningStats actuelles
   */
  load(): LearningStats {
    this._ensureDir()

    // Charger les stats
    if (existsSync(STATS_PATH)) {
      try {
        const raw = readFileSync(STATS_PATH, 'utf-8').trim()
        if (raw) {
          const parsed = JSON.parse(raw)
          this._stats = {
            totalChoices: typeof parsed.totalChoices === 'number' ? parsed.totalChoices : 0,
            last5Choices: Array.isArray(parsed.last5Choices) ? parsed.last5Choices.slice(0, 5) : [],
            categoryHits: parsed.categoryHits && typeof parsed.categoryHits === 'object' ? { ...parsed.categoryHits } : {},
            categoryMisses: parsed.categoryMisses && typeof parsed.categoryMisses === 'object' ? { ...parsed.categoryMisses } : {},
            lastUpdated: typeof parsed.lastUpdated === 'string' ? parsed.lastUpdated : new Date().toISOString(),
          }
        }
      } catch {
        // Fichier corrompu → réinitialiser (copie profonde)
        this._stats = freshDefaultStats()
        this._save()
      }
    } else {
      // Fichier inexistant → créer avec les valeurs par défaut (copie profonde)
      this._stats = freshDefaultStats()
      this._save()
    }

    // Charger l'historique
    if (existsSync(HISTORY_PATH)) {
      try {
        const raw = readFileSync(HISTORY_PATH, 'utf-8').trim()
        if (raw) {
          const parsed = JSON.parse(raw)
          if (Array.isArray(parsed)) {
            this._history = parsed.slice(-100) // garder max 100 entrées
          }
        }
      } catch {
        this._history = []
      }
    }

    this._loaded = true
    return { ...this._stats }
  }

  /**
   * Enregistre le choix d'une parade par l'utilisateur.
   * Met à jour :
   *   - totalChoices (+1)
   *   - last5Choices (push + trim)
   *   - categoryHits (incrémente la catégorie)
   *   - history (ajoute une entrée)
   *   - lastUpdated (timestamp maintenant)
   *
   * @param command - La commande exacte qui a été choisie
   * @param category - La catégorie de la commande (classifyCommand() si non fournie)
   */
  recordChoice(command: string, category?: string): void {
    if (!command) return

    this._ensureLoaded()

    const cat = category ?? classifyCommand(command)

    // Stats agrégées
    this._stats.totalChoices++
    this._stats.last5Choices.push(command)
    if (this._stats.last5Choices.length > 5) {
      this._stats.last5Choices.shift()
    }
    this._stats.categoryHits[cat] = (this._stats.categoryHits[cat] ?? 0) + 1
    this._stats.lastUpdated = new Date().toISOString()

    // Historique détaillé
    this._history.push({
      command,
      category: cat,
      timestamp: this._stats.lastUpdated,
    })
    if (this._history.length > 100) {
      this._history = this._history.slice(-100)
    }

    this._save()
  }

  /**
   * Enregistre une catégorie comme ignorée/rejetée.
   * Utile quand l'utilisateur ignore systématiquement certaines suggestions.
   *
   * @param category - La catégorie ignorée
   */
  recordMiss(category: string): void {
    if (!category) return

    this._ensureLoaded()

    this._stats.categoryMisses[category] = (this._stats.categoryMisses[category] ?? 0) + 1
    this._stats.lastUpdated = new Date().toISOString()

    this._save()
  }

  /**
   * Analyse les préférences actuelles de l'utilisateur.
   *
   * @returns CategoryPreferences avec :
   *   - preferred : top 3 catégories les plus choisies
   *   - avoided : catégories ignorées (misses >= 3)
   *   - recentShift : true si changement de comportement détecté
   */
  getPreferences(): CategoryPreferences {
    this._ensureLoaded()

    // Top 3 des catégories les plus choisies
    const sorted = Object.entries(this._stats.categoryHits)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
    const preferred = sorted.map(([cat]) => cat)

    // Catégories évitées (misses >= 3)
    const avoided = Object.entries(this._stats.categoryMisses)
      .filter(([, count]) => count >= 3)
      .map(([cat]) => cat)

    // Détection de shift : comparer les 5 dernières commandes
    // avec les 5 précédentes (positions 5-9 dans l'historique)
    const recentShift = this._detectShift()

    return { preferred, avoided, recentShift }
  }

  /**
   * Vérifie si le tracker a assez de données pour l'apprentissage.
   *
   * @returns true si totalChoices >= 10 (seuil minimum pour des stats significatives)
   */
  isReady(): boolean {
    this._ensureLoaded()
    return this._stats.totalChoices >= 10
  }

  /**
   * Retourne l'historique complet des choix.
   *
   * @returns Tableau des entrées d'historique (max 100)
   */
  getHistory(): ChoiceHistoryEntry[] {
    this._ensureLoaded()
    return [...this._history]
  }

  /**
   * Réinitialise toutes les stats et l'historique.
   * Écrit les fichiers avec des valeurs vides (overwrite) plutôt que de les supprimer,
   * car unlinkSync peut échouer avec EPERM sur Windows après un writeFileSync récent.
   * L'overwrite est fiable sur toutes les plateformes.
   */
  resetStats(): void {
    this._stats = freshDefaultStats()
    this._history = []
    this._loaded = true

    // Overwrite les fichiers avec des valeurs vides (fiable sur Windows)
    // Plutôt que de supprimer (unlinkSync peut échouer avec EPERM)
    this._save()
  }

  // ── Méthodes privées ─────────────────────────────────

  /**
   * Sauvegarde les stats et l'historique sur le disque.
   * Atomicité : writeFileSync est synchrone donc atomique pour Node.js.
   */
  private _save(): void {
    this._ensureDir()
    try {
      writeFileSync(STATS_PATH, JSON.stringify(this._stats, null, 2), 'utf-8')
      writeFileSync(
        HISTORY_PATH,
        JSON.stringify(this._history.slice(-100), null, 2),
        'utf-8',
      )
    } catch {
      // Non bloquant — les données en mémoire sont conservées
    }
  }

  /**
   * Garantit que le dossier de stats existe.
   */
  private _ensureDir(): void {
    if (!existsSync(STATS_DIR)) {
      try {
        mkdirSync(STATS_DIR, { recursive: true })
      } catch {
        // Non bloquant
      }
    }
  }

  /**
   * Charge les stats si ce n'est pas déjà fait (lazy loading).
   */
  private _ensureLoaded(): void {
    if (!this._loaded) {
      this.load()
    }
  }

  /**
   * Détecte un changement de comportement (shift) en comparant
   * les 5 dernières commandes avec les 5 précédentes.
   *
   * Utilise directement l'historique (cuttures d'index connues)
   * pour éviter les bugs de `indexOf` avec les commandes dupliquées.
   *
   * Principe :
   *   - Dernier slice : les 5 dernières entrées de l'historique
   *   - Slice d'avant : les 5 entrées juste avant (positions -10 à -5)
   *   - Si la distribution des catégories change significativement
   *     (une catégorie apparaît dans un groupe mais pas dans l'autre),
   *     on considère qu'il y a un shift.
   *
   * @returns true si un shift est détecté
   */
  private _detectShift(): boolean {
    const hLen = this._history.length
    if (hLen < 8) return false // besoin d'au moins 3 récentes + 5 de référence

    // Slice des 5 dernières entrées
    const recentSlice = this._history.slice(-5)
    // Slice des 5 entrées d'avant (positions -10 à -5)
    const beforeSlice = this._history.slice(Math.max(0, hLen - 10), hLen - 5)

    if (beforeSlice.length < 3) return false

    // Extraire les catégories directement (déjà stockées dans l'historique)
    const recentCats = new Set(recentSlice.map((e) => e.category))
    const beforeCats = new Set(beforeSlice.map((e) => e.category))

    // Détecter les catégories nouvelles ou disparues
    const newCats = [...recentCats].filter((c) => !beforeCats.has(c))
    const lostCats = [...beforeCats].filter((c) => !recentCats.has(c))

    // Shift significatif si au moins une catégorie a changé
    return newCats.length > 0 || lostCats.length > 0
  }
}

// ── Fonction utilitaire (hors classe) ───────────────────

/**
 * Classifie une commande en catégorie.
 * Utilise des patterns regex simples sur le début de la commande.
 *
 * @param command - La commande à classifier (ex: "!project tasks mon-projet")
 * @returns La catégorie détectée (parmi DEFAULT_CATEGORIES)
 *
 * @example
 *   classifyCommand("!project tasks soulseek")   // → "task"
 *   classifyCommand("!explore mon-projet")        // → "explore"
 *   classifyCommand("/help")                      // → "help"
 *   classifyCommand("cat package.json")           // → "other"
 */
export function classifyCommand(command: string): string {
  const c = command.trim().toLowerCase()

  // Ordre important : les plus spécifiques d'abord

  if (/^!task/i.test(c)) return 'task'
  if (/^!project/i.test(c)) {
    // Sous-analyse : si la commande contient "task", c'est une tâche
    if (/\btask/i.test(c) || /\bt[âa]che/i.test(c)) return 'task'
    return 'project'
  }
  if (/^!(?:explore|discover)/i.test(c)) return 'explore'
  if (/^!deploy/i.test(c)) return 'deploy'
  if (/^!doc/i.test(c)) return 'doc'
  if (/^!git/i.test(c)) return 'git'
  if (/^!agent/i.test(c)) return 'agent'
  if (/^!(?:profile)/i.test(c)) return 'profile'
  if (/^\/(?:help|aide)/i.test(c)) return 'help'
  if (/^\/(?:notif|status|state)/i.test(c)) return 'notification'

  return 'other'
}

// ── Instance singleton ─────────────────────────────────

/**
 * Instance singleton du LearningTracker.
 * Utiliser cette instance exportée pour éviter de créer
 * plusieurs trackers qui liraient/écriraient le même fichier.
 *
 * @example
 *   import { tracker } from './learning.js'
 *   tracker.recordChoice('!project tasks mon-projet', 'task')
 *   const prefs = tracker.getPreferences()
 */
export const tracker = new LearningTracker()
