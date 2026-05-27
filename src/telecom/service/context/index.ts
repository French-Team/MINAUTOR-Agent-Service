/**
 * Pipeline de compression de contexte.
 *
 * Ordre d'application :
 *   0. conservateur — analyse et trie les patterns du system prompt
 *   0.5 composeur   — assemble le system prompt optimisé
 *   1. optimiser    — langage naturel → directives IA compactes
 *   2. nettoyer     — caractères de contrôle, espaces, lignes vides
 *   3. resumer      — synthèse structurelle (anciens messages → bloc résumé)
 *   3.5 historien   — filtre les decisions/actions/todos de l'historique
 *
 * Les étapes 0-0.5 opèrent sur le system prompt (texte brut).
 * Les étapes 1 et 2 opèrent sur le texte de chaque message individuellement.
 * Les étapes 3 et 3.5 opèrent sur le tableau complet de messages.
 *
 * Aucune étape ne fait d'appel LLM : tout est déterministe et instantané.
 */

import type { Message, TextPart, ToolCallPart } from '../../../types/agent-definition.js'
import { optimiser } from './telecom-context-optimiser.js'
import { nettoyer } from './telecom-context-nettoyer.js'
import { resumer, type ResumerOptions } from './telecom-context-resumer.js'
import { conserver, type Pattern, PatternImportance, ConservateurOptions } from './telecom-context-conservateur.js'
import { composeur as _composeur, type ComposeurResult, ComposeurOptions } from './telecom-context-composeur.js'
import { analyserHistorique, historienResumePourLLM, type RapportSuivi, type SuiviEntry } from './telecom-context-historien.js'

export { optimiser, optimiserDetail } from './telecom-context-optimiser.js'
export { nettoyer, gainNettoyage } from './telecom-context-nettoyer.js'
export { resumer } from './telecom-context-resumer.js'
export {
  resolveProfile,
  resolveProfileDetail,
  resolveContextOptions,
  resolveContextOptionsFor,
  PROFILES,
} from './model-profiles.js'
export { conserver, conserverDetail } from './telecom-context-conservateur.js'
export { composeur, composer } from './telecom-context-composeur.js'
export type { ModelProfile, ProfileName } from './model-profiles.js'
export type { ResumerOptions, ResumerResult } from './telecom-context-resumer.js'
export type { OptimiserOptions, OptimiserResult } from './telecom-context-optimiser.js'
export type { NettoyerOptions } from './telecom-context-nettoyer.js'
export type { Pattern, PatternImportance, ConservateurOptions, ConservateurResult } from './telecom-context-conservateur.js'
export type { ComposeurOptions, ComposeurResult } from './telecom-context-composeur.js'
export { analyserHistorique, historienResumePourLLM, lireFichierSuivi, ajouterMarqueur, MARQUEURS } from './telecom-context-historien.js'
export type { RapportSuivi, SuiviEntry, SuiviCategorie, HistorienOptions } from './telecom-context-historien.js'

export interface ProcessContextOptions extends ResumerOptions {
  /** Désactiver l'étape optimiser (utile pour les messages déjà structurés). */
  skipOptimiser?: boolean
  /** Désactiver l'étape nettoyer. */
  skipNettoyer?: boolean
  /** Désactiver l'étape resumer. */
  skipResumer?: boolean
  /** Ne pas optimiser le premier message (préserver le contexte initial). */
  preserveFirstMessage?: boolean
}

/**
 * Applique optimiser + nettoyer au texte d'un message, en préservant sa structure.
 */
function transformMessage(
  msg: Message,
  textTransform: (text: string) => string,
): Message {
  if (msg.role === 'tool') {
    return {
      ...msg,
      content: msg.content.map(p => ({ ...p, content: textTransform(p.content) })),
    }
  }

  return {
    ...msg,
    content: msg.content.map(p => {
      const part = p as TextPart | ToolCallPart
      if (part.type === 'text') {
        return { ...part, text: textTransform(part.text) }
      }
      return part
    }),
  } as Message
}

/**
 * Pipeline complet : optimiser → nettoyer (par message) → resumer (global).
 *
 * Idempotent : appliquer le pipeline plusieurs fois ne dégrade pas le résultat.
 *
 * @param messages Historique brut depuis la session
 * @param options  Réglages fins (ou défauts saints)
 * @returns Historique compressé prêt à être sérialisé en payload LLM
 */
export function processContext(
  messages: Message[],
  options: ProcessContextOptions = {},
): Message[] {
  if (messages.length === 0) return []

  // Étapes 1 + 2 : transformations textuelles.
  // Règle : on n'applique JAMAIS l'optimiser aux messages 'user' — l'intention
  // de l'utilisateur doit rester verbatim. L'optimiser sert pour les sorties
  // d'agents et autres contenus verbeux générés, pas pour la requête humaine.
  let transformed = messages
  if (!options.skipOptimiser || !options.skipNettoyer) {
    transformed = messages.map((msg, idx) => {
      const isFirst = idx === 0
      const isUser = msg.role === 'user'
      const skipOptForThis =
        options.skipOptimiser ||
        isUser ||
        (options.preserveFirstMessage && isFirst)

      return transformMessage(msg, text => {
        let t = text
        if (!skipOptForThis) t = optimiser(t)
        if (!options.skipNettoyer) t = nettoyer(t)
        // Si la transformation a vidé le contenu, on garde un marqueur pour
        // éviter d'orphelin la conversation (un user/assistant manquant
        // décaleraient l'alignement des tours).
        if (!t.trim() && text.trim()) t = '(message compressé)'
        return t
      })
    })
  }

  // Étape 3 : compression structurelle
  if (!options.skipResumer) {
    return resumer(transformed, options)
  }

  return transformed
}
/**
 * Optimisation one-shot du system prompt : conservateur → composeur.
 *
 * Applique les étapes 0 et 0.5 du pipeline pour réduire la taille
 * du system prompt sans perdre les directives critiques.
 *
 * @param prompt   Le system prompt complet
 * @param maxChars Troncature optionnelle (0 = illimité)
 * @returns Le prompt optimisé
 */
export function optimizeSystemPrompt(prompt: string, maxChars = 0): string {
  if (!prompt || !prompt.trim()) return prompt
  const result = conserver(prompt, { dropNoise: true })
  const composed = _composeur(result.kept, { compactWhitespace: true, stripDecorators: true, maxChars })
  return composed.text ?? prompt
}

/**
 * Variante détaillée qui retourne les stats de compression.
 */
export function optimizeSystemPromptDetail(
  prompt: string,
  maxChars = 0,
): { text: string; stats: { charsBefore: number; charsAfter: number; ratio: number; kept: number; dropped: number } } {
  if (!prompt || !prompt.trim()) {
    return { text: prompt, stats: { charsBefore: 0, charsAfter: 0, ratio: 0, kept: 0, dropped: 0 } }
  }
  const result = conserver(prompt, { dropNoise: true })
  const composed = _composeur(result.kept, { compactWhitespace: true, stripDecorators: true, maxChars })
  return {
    text: composed.text ?? prompt,
    stats: {
      charsBefore: result.stats.charsBefore,
      charsAfter: composed.charsAfter,
      ratio: composed.compressionRatio,
      kept: result.stats.kept,
      dropped: result.stats.dropped,
    },
  }
}

/**
 * Variante détaillée du pipeline qui retourne aussi des stats.
 */
export interface ProcessContextResult {
  messages: Message[]
  stats: {
    inputCount: number
    outputCount: number
    summarized: number
    kept: number
  }
}

export function processContextDetail(
  messages: Message[],
  options: ProcessContextOptions = {},
): ProcessContextResult {
  const inputCount = messages.length
  const out = processContext(messages, options)

  // Stats cohérentes : on dérive directement de l'output.
  // Si on a résumé, le 1er message est le bloc résumé system synthétique.
  const hasSummary =
    !options.skipResumer &&
    out.length > 0 &&
    out[0].role === 'system' &&
    out.length < inputCount

  const summarized = hasSummary ? inputCount - (out.length - 1) : 0
  const kept = hasSummary ? out.length - 1 : out.length

  return {
    messages: out,
    stats: { inputCount, outputCount: out.length, summarized, kept },
  }
}
