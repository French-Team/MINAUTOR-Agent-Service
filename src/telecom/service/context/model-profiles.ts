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
 */

import type { ResumerOptions } from './telecom-context-resumer.js'
import type { ContextProfile } from '../../../types/agent-definition.js'

// ── Compile-time sync guard ──
// Vérification bidirectionnelle : si ProfileName et ContextProfile dérivent
// (valeurs différentes), une de ces lignes produit une erreur de type.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _profileSyncA: ContextProfile = null as unknown as ProfileName
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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

/**
 * Profils — du plus contraint au plus généreux.
 *
 * Heuristiques :
 * - keepRecent             : nombre de messages récents conservés intacts
 * - maxCharsPerMessage     : troncature d'un message conservé tel quel
 * - maxCharsPerSummaryLine : longueur max d'une ligne dans le bloc résumé
 *
 * Ordre de grandeur (1 token ≈ 4 caractères en français/anglais).
 */
export const PROFILES: Record<ProfileName, ModelProfile> = {
  tiny: {
    name: 'tiny',
    description: 'Modèles ≤ 1.5B (LFM2.5-1.2B, TinyLlama). Compression agressive : raisonnement dégrade vite avec un long contexte.',
    options: {
      keepRecent: 6,
      maxCharsPerMessage: 600,
      maxCharsPerSummaryLine: 120,
    },
  },
  small: {
    name: 'small',
    description: 'Modèles 1.5-4B (Llama3.2-3B, Phi-3-mini). Compression marquée mais préserve le contexte conversationnel court.',
    options: {
      keepRecent: 10,
      maxCharsPerMessage: 1000,
      maxCharsPerSummaryLine: 160,
    },
  },
  medium: {
    name: 'medium',
    description: 'Modèles 4-15B (Llama3-8B, Mistral-7B). Défaut sain pour la plupart des usages locaux/cloud.',
    options: {
      keepRecent: 12,
      maxCharsPerMessage: 1200,
      maxCharsPerSummaryLine: 180,
    },
  },
  large: {
    name: 'large',
    description: 'Modèles 15B-70B ou cloud (Gemini Flash, GPT-4, Claude Sonnet). Garde large historique intact.',
    options: {
      keepRecent: 20,
      maxCharsPerMessage: 2400,
      maxCharsPerSummaryLine: 240,
    },
  },
  huge: {
    name: 'huge',
    description: 'Modèles long-context (Gemini 2.5 Pro/Flash 1M, Claude 200k+). Compression minimale.',
    options: {
      keepRecent: 40,
      maxCharsPerMessage: 4000,
      maxCharsPerSummaryLine: 320,
    },
  },
}

/**
 * Règles de matching (testées dans l'ordre, première qui matche gagne).
 * Note : on matche sur le NOM du modèle (insensible à la casse), pas sur le
 * provider. Le préfixe optionnel `provider/` est tolerant.
 */
interface MatchRule {
  pattern: RegExp
  profile: ProfileName
  reason: string
}

const RULES: MatchRule[] = [
  // ── HUGE : 1M tokens et + ──
  { pattern: /gemini[-_.]?2\.5[-_.]?(?:pro|flash)/i, profile: 'huge', reason: 'Gemini 2.5 (1M tokens)' },
  { pattern: /gemini[-_.]?1\.5/i, profile: 'huge', reason: 'Gemini 1.5 (1M-2M tokens)' },
  { pattern: /claude[-_.]?(?:3|4)[-_.]?(?:opus|sonnet)/i, profile: 'huge', reason: 'Claude 3/4 Opus/Sonnet (200k+)' },

  // ── LARGE : 100k+ ou modèles cloud puissants ──
  { pattern: /gemini[-_.]?(?:pro|flash)/i, profile: 'large', reason: 'Gemini générique' },
  { pattern: /gpt[-_.]?4/i, profile: 'large', reason: 'GPT-4 famille' },
  { pattern: /claude/i, profile: 'large', reason: 'Claude générique' },
  { pattern: /llama[-_.]?3(?:\.[12])?[-_.]?(?:70b|405b)/i, profile: 'large', reason: 'Llama3 70B/405B' },
  { pattern: /qwen[-_.]?(?:2\.5|3)/i, profile: 'large', reason: 'Qwen 2.5/3 (souvent 128k+)' },
  { pattern: /trinity[-_.]?large/i, profile: 'large', reason: 'Arcee Trinity Large' },
  { pattern: /deepseek[-_.]?(?:v[34]|r1)/i, profile: 'large', reason: 'DeepSeek V3/R1' },

  // ── SMALL : 1.5-4B ──
  // Note : la famille Llama3.2 (1B/3B) est traitée uniformément en "small"
  // par simplicité ; le 1B serait techniquement "tiny" mais l'écart est faible.
  { pattern: /(?:^|[\/_-])(?:1\.5b|2b|3b|3\.8b)(?:[\/_-]|$|[^0-9])/i, profile: 'small', reason: 'Modèle 1.5-4B explicite' },
  { pattern: /llama[-_.]?3\.2(?!.*(?:7|8|13|70)b)/i, profile: 'small', reason: 'Llama3.2 (1B/3B par défaut)' },
  { pattern: /phi[-_.]?3[-_.]?mini/i, profile: 'small', reason: 'Phi-3-mini' },
  { pattern: /tinyllama/i, profile: 'small', reason: 'TinyLlama (limite haute du tiny)' },

  // ── TINY : ≤ 1.5B ──
  { pattern: /lfm2(?:\.5)?[-_.]?1\.2b/i, profile: 'tiny', reason: 'Liquid LFM2/2.5-1.2B' },
  { pattern: /(?:^|[\/_-])(?:0\.5b|0\.6b|1\.2b|1b)(?:[\/_-]|$|[^0-9])/i, profile: 'tiny', reason: 'Modèle ≤ 1.2B explicite' },
  { pattern: /qwen[-_.]?(?:0\.5|1\.5)b/i, profile: 'tiny', reason: 'Qwen 0.5B/1.5B' },
  { pattern: /smollm/i, profile: 'tiny', reason: 'SmolLM' },

  // ── MEDIUM : famille génériques 7B-13B ──
  { pattern: /(?:^|[\/_-])(?:7b|8b|13b|14b)(?:[\/_-]|$|[^0-9])/i, profile: 'medium', reason: 'Modèle 7-14B explicite' },
  { pattern: /mistral[-_.]?(?:7b|small)/i, profile: 'medium', reason: 'Mistral 7B/Small' },
  { pattern: /llama[-_.]?3(?:\.1)?[-_.]?(?:7|8)b/i, profile: 'medium', reason: 'Llama3.x 7B/8B' },
]

/**
 * Routeurs « free » de Kilo / OpenRouter : on ne sait pas vers quel modèle
 * la requête sera dispatchée. On reste conservateur (small) plutôt que
 * gaspiller du contexte sur un petit modèle inconnu.
 *
 * IMPORTANT : ces patterns sont testés APRÈS les règles spécifiques. Sinon
 * un modèle connu suffixé ":free" (ex: gemini-2.5-flash:free) serait
 * faussement rétrogradé en "small" alors qu'on connaît sa fenêtre réelle.
 */
const ROUTER_PATTERNS: RegExp[] = [
  /kilo[-_.]?auto/i,
  /openrouter[-_.]?auto/i,
  /:free$/i,
]

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
  if (!model) return PROFILES.medium

  // 1. Règles spécifiques d'abord : un modèle connu gagne sur le routeur
  for (const rule of RULES) {
    if (rule.pattern.test(model)) return PROFILES[rule.profile]
  }

  // 2. Routeur générique inconnu → conservateur 'small'
  for (const pat of ROUTER_PATTERNS) {
    if (pat.test(model)) return PROFILES.small
  }

  // 3. Défaut : medium
  return PROFILES.medium
}

/**
 * Variante exposant la raison du match (pour debug/observabilité).
 */
export function resolveProfileDetail(model: string): { profile: ModelProfile; reason: string } {
  if (!model) return { profile: PROFILES.medium, reason: 'aucun modèle fourni → medium par défaut' }

  for (const rule of RULES) {
    if (rule.pattern.test(model)) {
      return { profile: PROFILES[rule.profile], reason: rule.reason }
    }
  }

  for (const pat of ROUTER_PATTERNS) {
    if (pat.test(model)) {
      return { profile: PROFILES.small, reason: `routeur générique ${pat.source} → small (conservateur, modèle destination inconnu)` }
    }
  }

  return { profile: PROFILES.medium, reason: 'aucune règle ne matche → medium par défaut' }
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
  const override = opts.override
  if (override) {
    if (override in PROFILES) {
      return { ...PROFILES[override as ProfileName].options }
    }
    if (!warnedInvalidOverrides.has(override)) {
      warnedInvalidOverrides.add(override)
      const valid = Object.keys(PROFILES).join(', ')
      console.warn(
        `⚠  contextProfile "${override}" inconnu — fallback sur la résolution par modèle. Valeurs valides : ${valid}.`,
      )
    }
  }
  return resolveContextOptions(opts.model)
}
