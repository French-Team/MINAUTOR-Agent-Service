/**
 * model-profiles
 *
 * Tuning des paramètres du pipeline de compression de contexte par modèle.
 *
 * Pourquoi par modèle ?
 * - Un petit modèle (1.2B) a une fenêtre nominale de 32k tokens, mais sa
 *   capacité de raisonnement chute bien avant : un historique de 30 messages
 *   le rend confus alors qu'un Gemini Flash le digère sans broncher.
 * - Un grand modèle (Gemini Flash, Claude) gère 1M tokens : compression
 *   inutile, on garde beaucoup de contexte intact.
 * - On veut donc des défauts adaptatifs sans forcer l'utilisateur à régler
 *   manuellement.
 *
 * Le matching se fait par regex sur le nom du modèle (case-insensitive).
 * Si rien ne correspond, on retombe sur le profil 'medium' (défaut sain).
 *
 * Aucune dépendance externe : tout est statique et déterministe.
 * Données chargées depuis data/model-profiles.json
 */

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { buildRegExp } from './regex-utils.js'
import type { ResumerOptions } from './telecom-context-resumer.js'
import type { ContextProfile } from '../../../types/agent-definition.js'

// ── Compile-time sync guard ──
// Vérification bidirectionnelle : si ProfileName et ContextProfile dérivent
// (valeurs différentes), une de ces lignes produit une erreur de type.
const _profileSyncA: ContextProfile = null as unknown as ProfileName
const _profileSyncB: ProfileName = null as unknown as ContextProfile

// Type structurel local pour éviter une dépendance circulaire avec index.ts
// (qui ré-exporte ce module). Doit rester en phase avec ProcessContextOptions.
type ContextOptions = ResumerOptions & {
  skipOptimiser?: boolean
  skipNettoyer?: boolean
  skipResumer?: boolean
  preserveFirstMessage?: boolean
}

export type ProfileName = 'tiny' | 'small' | 'medium' | 'large' | 'huge'

export interface ModelProfile {
  name: ProfileName
  description: string
  /** Paramètres injectés au pipeline. */
  options: Required<Pick<ContextOptions, 'keepRecent' | 'maxCharsPerMessage' | 'maxCharsPerSummaryLine'>>
}

// ── JSON file types ──

interface JsonProfile {
  name: string
  description: string
  options: {
    keepRecent: number
    maxCharsPerMessage: number
    maxCharsPerSummaryLine: number
  }
}

interface JsonMatchRule {
  pattern: string
  flags: string
  profile: string
  reason: string
}

interface JsonRouterPattern {
  pattern: string
  flags: string
}

interface ProfilesRegistry {
  profiles: Record<string, JsonProfile>
  rules: JsonMatchRule[]
  routerPatterns: JsonRouterPattern[]
}

// ── Lazy loader ──

const PROFILES_PATH = join(process.cwd(), 'data', 'model-profiles.json')

function loadRegistry(): ProfilesRegistry | null {
  try {
    if (!existsSync(PROFILES_PATH)) {
      console.warn(`[profiles] Fichier introuvable: ${PROFILES_PATH}`)
      return null
    }
    const raw = readFileSync(PROFILES_PATH, 'utf-8')
    const registry: ProfilesRegistry = JSON.parse(raw)
    if (!registry.profiles || !Array.isArray(registry.rules) || !Array.isArray(registry.routerPatterns)) {
      console.warn('[profiles] Structure invalide dans model-profiles.json')
      return null
    }
    return registry
  } catch (err) {
    console.warn(`[profiles] Impossible de charger model-profiles.json: ${(err as Error).message}`)
    return null
  }
}

interface LoadedData {
  profiles: Record<ProfileName, ModelProfile>
  rules: MatchRule[]
  routerPatterns: RegExp[]
}

interface MatchRule {
  pattern: RegExp
  profile: ProfileName
  reason: string
}

let _data: LoadedData | null = null

function getData(): LoadedData {
  if (_data) return _data

  const registry = loadRegistry()
  if (!registry) {
    return getFallbackData()
  }

  const profiles: Record<string, ModelProfile> = {}
  for (const [key, p] of Object.entries(registry.profiles)) {
    profiles[key] = {
      name: key as ProfileName,
      description: p.description,
      options: { ...p.options },
    }
  }

  const rules: MatchRule[] = registry.rules.map(r => ({
    pattern: buildRegExp(r.pattern, r.flags),
    profile: r.profile as ProfileName,
    reason: r.reason,
  }))

  const routerPatterns: RegExp[] = registry.routerPatterns.map(rp =>
    buildRegExp(rp.pattern, rp.flags)
  )

  _data = {
    profiles: profiles as Record<ProfileName, ModelProfile>,
    rules,
    routerPatterns,
  }
  return _data
}

function getFallbackData(): LoadedData {
  _data = {
    profiles: {
      tiny: {
        name: 'tiny',
        description: 'Profil tiny (fallback)',
        options: { keepRecent: 6, maxCharsPerMessage: 600, maxCharsPerSummaryLine: 120 },
      },
      small: {
        name: 'small',
        description: 'Profil small (fallback)',
        options: { keepRecent: 10, maxCharsPerMessage: 1000, maxCharsPerSummaryLine: 160 },
      },
      medium: {
        name: 'medium',
        description: 'Profil medium (fallback)',
        options: { keepRecent: 12, maxCharsPerMessage: 1200, maxCharsPerSummaryLine: 180 },
      },
      large: {
        name: 'large',
        description: 'Profil large (fallback)',
        options: { keepRecent: 20, maxCharsPerMessage: 2400, maxCharsPerSummaryLine: 240 },
      },
      huge: {
        name: 'huge',
        description: 'Profil huge (fallback)',
        options: { keepRecent: 40, maxCharsPerMessage: 4000, maxCharsPerSummaryLine: 320 },
      },
    },
    rules: [],
    routerPatterns: [],
  }
  return _data
}

/**
 * Profils exporté avec lazy-load depuis le JSON.
 * Compatible avec l'ancienne interface `Record<ProfileName, ModelProfile>`.
 */
export const PROFILES: Record<ProfileName, ModelProfile> = new Proxy({} as Record<ProfileName, ModelProfile>, {
  get(_target, prop: string | symbol) {
    const data = getData()
    return data.profiles[prop as ProfileName]
  },
  has(_target, prop: string | symbol) {
    return prop in getData().profiles
  },
  ownKeys() {
    return Object.keys(getData().profiles)
  },
  getOwnPropertyDescriptor() {
    return { enumerable: true, configurable: true }
  },
})

/**
 * Résout le profil pour un nom de modèle donné.
 *
 * Ordre :
 *  1. Règles spécifiques (un modèle nommé explicitement gagne toujours,
 *     même s'il porte un suffixe ":free").
 *  2. Routeurs génériques (kilo-auto, openrouter-auto, :free pur)
 *     → conservateur "small" car on ne connaît pas le modèle destination.
 *  3. Défaut : medium.
 *
 * @param model Nom du modèle (ex: 'liquid/lfm2.5-1.2b', 'gemini-2.5-flash')
 * @returns Le profil correspondant
 */
export function resolveProfile(model: string): ModelProfile {
  const data = getData()
  if (!model) return data.profiles.medium

  // 1. Règles spécifiques d'abord : un modèle connu gagne sur le routeur
  for (const rule of data.rules) {
    if (rule.pattern.test(model)) return data.profiles[rule.profile]
  }

  // 2. Routeur générique inconnu → conservateur 'small'
  for (const pat of data.routerPatterns) {
    if (pat.test(model)) return data.profiles.small
  }

  // 3. Défaut : medium
  return data.profiles.medium
}

/**
 * Variante exposant la raison du match (pour debug/observabilité).
 */
export function resolveProfileDetail(model: string): { profile: ModelProfile; reason: string } {
  const data = getData()
  if (!model) return { profile: data.profiles.medium, reason: 'aucun modèle fourni → medium par défaut' }

  for (const rule of data.rules) {
    if (rule.pattern.test(model)) {
      return { profile: data.profiles[rule.profile], reason: rule.reason }
    }
  }

  for (const pat of data.routerPatterns) {
    if (pat.test(model)) {
      return { profile: data.profiles.small, reason: `routeur générique ${pat.source} → small (conservateur, modèle destination inconnu)` }
    }
  }

  return { profile: data.profiles.medium, reason: 'aucune règle ne matche → medium par défaut' }
}

/**
 * Retourne directement les options à passer au pipeline.
 * Sucre syntaxique pour le cas le plus courant.
 */
export function resolveContextOptions(model: string): ContextOptions {
  return { ...resolveProfile(model).options }
}

/** Cache des overrides invalides déjà signalés, pour ne warner qu'une fois. */
const warnedInvalidOverrides = new Set<string>()

/**
 * Résout les options en respectant un éventuel override agent.
 *
 * Priorité :
 *  1. `override` explicite (depuis AgentDefinition.toolConfig.contextProfile)
 *     — honoré même s'il ne correspond pas au modèle. C'est volontaire :
 *     un daemon peut vouloir un profil 'tiny' sur un Gemini Flash pour
 *     limiter la taille des notifications, etc.
 *  2. Résolution automatique par nom de modèle.
 *
 * Si `override` est fourni mais inconnu (ne correspond à aucun ProfileName),
 * on émet un warning UNE SEULE FOIS et on retombe sur la résolution par
 * modèle, plutôt que planter — protection contre les fichiers d'agent mal
 * typés (ex: typo "tinny" au lieu de "tiny").
 */
export function resolveContextOptionsFor(opts: { model: string; override?: string }): ContextOptions {
  const data = getData()
  const override = opts.override
  if (override) {
    if (override in data.profiles) {
      return { ...data.profiles[override as ProfileName].options }
    }
    if (!warnedInvalidOverrides.has(override)) {
      warnedInvalidOverrides.add(override)
      const valid = Object.keys(data.profiles).join(', ')
      console.warn(
        `⚠  contextProfile "${override}" inconnu — fallback sur la résolution par modèle. Valeurs valides : ${valid}.`,
      )
    }
  }
  return resolveContextOptions(opts.model)
}
