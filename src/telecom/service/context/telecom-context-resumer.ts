/**
 * telecom-context-resumer
 *
 * Étape 3 du pipeline de compression de contexte.
 * Rôle : prendre l'historique complet d'une session et produire une
 * version « premium » : les N derniers échanges sont conservés intacts
 * (parce qu'ils sont les plus pertinents pour la prochaine réponse) et
 * les plus anciens sont synthétisés en un seul bloc système structuré.
 *
 * Contrairement aux deux étapes précédentes, cette étape opère sur la
 * structure (un tableau de messages) et non sur du texte brut. Elle ne
 * fait pas d'appel LLM : la « review + ré-organisation » est faite par
 * heuristique (regroupement par rôle, troncature ciblée, listing).
 */

import type { Message, TextPart, ToolCallPart } from '../../../types/agent-definition.js'

export interface ResumerOptions {
  /** Nombre de messages récents à conserver tels quels. Défaut : 12. */
  keepRecent?: number
  /** Longueur max d'un message conservé tel quel (caractères). Défaut : 1200. */
  maxCharsPerMessage?: number
  /** Longueur max d'un message dans le bloc résumé. Défaut : 180. */
  maxCharsPerSummaryLine?: number
  /** Si true, force toujours la production d'un bloc résumé même si peu de messages. */
  alwaysSummarize?: boolean
}

const DEFAULTS: Required<ResumerOptions> = {
  keepRecent: 12,
  maxCharsPerMessage: 1200,
  maxCharsPerSummaryLine: 180,
  alwaysSummarize: false,
}

/**
 * Extrait le texte d'un message, qu'il soit utilisateur, assistant ou tool.
 */
function extractText(msg: Message): string {
  if (msg.role === 'tool') {
    return msg.content.map(p => p.content).join(' ')
  }
  return msg.content
    .map(p => {
      const part = p as TextPart | ToolCallPart
      if (part.type === 'text') return part.text
      if (part.type === 'tool-call') return `[outil:${part.toolName}]`
      return ''
    })
    .join(' ')
}

/**
 * Tronque un message texte à `maxChars` en préservant le début (généralement
 * plus informatif que la fin sur de longues sorties d'agents).
 */
function truncateMessage(msg: Message, maxChars: number): Message {
  const text = extractText(msg)
  if (text.length <= maxChars) return msg

  const truncated = text.slice(0, maxChars).trimEnd() + ` …(+${text.length - maxChars} car. tronqués)`

  if (msg.role === 'tool') {
    return {
      ...msg,
      content: msg.content.map((p, i) =>
        i === 0 ? { ...p, content: truncated } : { ...p, content: '' }
      ),
    }
  }

  return {
    ...msg,
    content: [{ type: 'text', text: truncated }],
  } as Message
}

/**
 * Construit une ligne de résumé pour un message ancien.
 */
function summaryLine(msg: Message, maxChars: number): string {
  const role = msg.role.padEnd(9)
  const text = extractText(msg).replace(/\s+/g, ' ').trim()
  const ellipsis = text.length > maxChars ? '…' : ''
  return `- [${role.trim()}] ${text.slice(0, maxChars)}${ellipsis}`
}

export interface ResumerResult {
  messages: Message[]
  summarized: number
  kept: number
}

/**
 * Compresse un historique de messages.
 * Retourne un nouveau tableau (l'entrée n'est pas mutée).
 */
export function resumer(messages: Message[], options: ResumerOptions = {}): Message[] {
  return resumerDetail(messages, options).messages
}

/**
 * Variante détaillée pour observabilité (combien de messages résumés/conservés).
 */
export function resumerDetail(messages: Message[], options: ResumerOptions = {}): ResumerResult {
  const opts = { ...DEFAULTS, ...options }
  if (messages.length === 0) return { messages: [], summarized: 0, kept: 0 }

  // Cas simple : peu de messages → on tronque seulement les plus longs
  if (messages.length <= opts.keepRecent && !opts.alwaysSummarize) {
    const trimmed = messages.map(m => truncateMessage(m, opts.maxCharsPerMessage))
    return { messages: trimmed, summarized: 0, kept: trimmed.length }
  }

  const cutoff = Math.max(0, messages.length - opts.keepRecent)
  const oldOnes = messages.slice(0, cutoff)
  const recent = messages.slice(cutoff)

  // Compter les rôles dans les anciens
  const counts = oldOnes.reduce<Record<string, number>>((acc, m) => {
    acc[m.role] = (acc[m.role] ?? 0) + 1
    return acc
  }, {})
  const countsLine = Object.entries(counts)
    .map(([role, n]) => `${role}=${n}`)
    .join(', ')

  // Construire le bloc résumé : header + lignes par message
  const lines = oldOnes.map(m => summaryLine(m, opts.maxCharsPerSummaryLine))
  const summaryText = [
    `=== HISTORIQUE RÉSUMÉ (${oldOnes.length} échanges antérieurs : ${countsLine}) ===`,
    ...lines,
    `=== FIN HISTORIQUE RÉSUMÉ ===`,
  ].join('\n')

  const summaryMsg: Message = {
    role: 'system',
    content: [{ type: 'text', text: summaryText }],
  }

  // Tronquer aussi les messages récents trop longs
  const trimmedRecent = recent.map(m => truncateMessage(m, opts.maxCharsPerMessage))

  return {
    messages: [summaryMsg, ...trimmedRecent],
    summarized: oldOnes.length,
    kept: trimmedRecent.length,
  }
}
