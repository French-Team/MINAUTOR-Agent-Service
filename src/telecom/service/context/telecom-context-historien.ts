/**
 * telecom-context-historien
 *
 * Etape 3.5 du pipeline de compression de contexte.
 * Role : analyser l'historique des messages d'une session pour extraire
 * les decisions, actions en cours, actions realisees, et actions restantes.
 *
 * Tous les agents sont invites a utiliser les marqueurs standardises dans
 * leurs messages pour que l'historien puisse facilement retrouver les
 * informations :
 *
 *   [DECISION]  — decision importante prise pendant la conversation
 *   [ACTION]    — action initiee ou en cours
 *   [FAIT]      — action ou tache terminee
 *   [TODO]      — action ou tache restante a faire
 *   [ATTENTE]   — element en attente (dependance, validation, info)
 *
 * Meme sans marqueurs, l'historien detecte les patterns par heuristiques
 * (mots-cles, verbes, contextes). Les marqueurs augmentent la precision.
 *
 * Produit un fichier de suivi persistant dans telecom/suivi/<session>.md
 * consulte par orchestrateur, agent-telecom, agent-reviewer, etc.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import type { Message, TextPart, ToolCallPart } from '../../../types/agent-definition.js'

// ── Types ──

export type SuiviCategorie = 'decision' | 'action' | 'fait' | 'todo' | 'attente'

export interface SuiviEntry {
  /** Categorie de l'entree. */
  categorie: SuiviCategorie
  /** Contenu textuel extrait. */
  texte: string
  /** Agent qui a emis ou initie l'entree. */
  source: string
  /** Role du message (user, assistant, tool). */
  role: string
  /** Index du message dans l'historique original. */
  messageIndex: number
  /** Timestamp approximatif (date du message ou de l'analyse). */
  timestamp: string
  /** Tags associes (extraits du message). */
  tags: string[]
}

export interface RapportSuivi {
  /** Date de generation. */
  genereLe: string
  /** Nombre de messages analyses. */
  messagesAnalyses: number
  /** Entrees extraites classees par categorie. */
  entrees: SuiviEntry[]
  /** Resume textuel structure. */
  resume: string
  /** Stats par categorie. */
  stats: {
    decisions: number
    actions: number
    faits: number
    todos: number
    attentes: number
    total: number
  }
}

export interface HistorienOptions {
  /** Chemin du dossier de suivi. Defaut: telecom/suivi/. */
  suiviDir?: string
  /** Nom de la session ou fichier de suivi. Defaut: 'last-context'. */
  sessionName?: string
  /** Si true, ecrit aussi le fichier de suivi sur disque. Defaut: true. */
  ecrireFichier?: boolean
  /** Si true, force la re-ecriture meme si pas de nouvelles entrees. */
  forceEcriture?: boolean
}

// ── Marqueurs standardises ──

/**
 * Marqueurs que les agents peuvent utiliser dans leurs messages.
 * L'historien les detecte avec une haute priorite.
 */
export const MARQUEURS = {
  DECISION: '[DECISION]',
  ACTION: '[ACTION]',
  FAIT: '[FAIT]',
  TODO: '[TODO]',
  ATTENTE: '[ATTENTE]',
} as const

const MARQUEUR_PATTERNS: Record<SuiviCategorie, RegExp> = {
  decision: /\[DECISION\]\s*(.+)/i,
  action: /\[ACTION\]\s*(.+)/i,
  fait: /\[FAIT\]\s*(.+)/i,
  todo: /\[TODO\]\s*(.+)/i,
  attente: /\[ATTENTE\]\s*(.+)/i,
}

// ── Heuristiques sans marqueurs ──

const DECISION_KEYWORDS = [
  /(?:on|j['']?|nous)\s+(?:a\s+)?(?:decid[éeèêë]|choisi|opt[éeèêë]|valid[éeèêë])/i,
  /\bla\s+d[eéèêë]cision\s+(?:est\s+)?(?:prise|faite|act[éeèêë])/i,
  /\b(?:direction|choix|strat[éeèêë]gie)\s+(?:retenue|adopt[éeèêë]|choisie)/i,
  /\bil\s+(?:a\s+)?(?:e[éeèêë]t[éeèêë]|convenu|d[éeèêë]cid[éeèêë])\s+(?:que|de)/i,
  /\bsolution\s+(?:re)t[éeèêë]?enue/i,
]

const ACTION_KEYWORDS = [
  /(?:je|on|nous)\s+(?:suis|sommes)\s+(?:en\s+train\s+de|entrain\s+de)\s+/i,
  /(?:je\s+)?(?:travaille|continue|d[éeèêë]marre|lance|initie)\s+(?:sur|la\s+)?/i,
  /(?:en\s+cours|mis\s+en\s+oeuvre|d[éeèêë]but[éeèêë])\s+(?:de|par|sur)/i,
  /\bactuellement\s+(?:en\s+)?(?:cours|train)/i,
  /j['']?attaque\s+/i,
  /^\[?ACTION\]?/i,
]

const FAIT_KEYWORDS = [
  /(?:c['']?est\s+)?(?:termin[éeèêë]|fini|achev[éeèêë]|compl[éeèêë]t[éeèêë]|finalis[éeèêë]|livr[éeèêë])/i,
  /(?:j['']?ai|on\s+a|nous\s+avons)\s+(?:termin[éeèêë]|fini|achev[éeèêë]|mis\s+en\s+place|impl[éeèêë]ment[éeèêë])/i,
  /\b(?:impl[éeèêë]ment[éeèêë]|d[éeèêë]ploy[éeèêë]|install[éeèêë]|configur[éeèêë])\s+(?:avec\s+)?succ[eèêë]s/i,
  /(?:c['']?est\s+)?(?:op[éeèêë]rationnel|fonctionnel|pr[éeèêë]t|fini|bon)/i,
  /\b(?:fait|done|termin[éeèêë])\s*[!:.]/i,
]

const TODO_KEYWORDS = [
  /(?:reste\s+(?:a|à)\s+(?:faire|traiter|voir|impl[éeèêë]menter|d[éeèêë]ployer|tester))/i,
  /(?:prochaine?\s+(?:[éeèêë]tape|action|t[âa]che)|ensuite\s+(?:on|je)\s+(?:va|pourrait|devrait))/i,
  /(?:TODO|\[TODO\]|a\s+faire|reste|manquant|pending)/i,
  /(?:il\s+(?:nous|me|vous)\s+reste|il\s+(?:faut|faudra)\s+(?:encore|aussi))/i,
  /\bplanifi[éeèêë]\s+(?:pour|dans)\s+(la\s+)?(?:prochaine|semaine|version|iteration)/i,
]

const ATTENTE_KEYWORDS = [
  /(?:en\s+attente\s+(?:de|que)|dans\s+l['']attente)/i,
  /(?:j['']?attends|on\s+attend|nous\s+attendons)\s+(?:que|le\s+)?/i,
  /(?:b[éeèêë]soin\s+de|n[éeèêë]cessite|requiert)\s+(?:validation|approbation|retour|info)/i,
  /(?:d[éeèêë]pend\s+(?:de|du|de\s+la)|bloqu[éeèêë]\s+(?:par|sur))/i,
  /(?:en\s+suspens|en\s+standby|mis\s+en\s+pause|report[éeèêë])/i,
]

const TAG_EXTRACT = /#([a-zA-ZÀ-ÿ0-9_-]+)/g

// ── Extraction du texte ──

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

function extractTags(text: string): string[] {
  const tags: string[] = []
  let match
  while ((match = TAG_EXTRACT.exec(text)) !== null) {
    tags.push(`#${match[1]}`)
  }
  return [...new Set(tags)]
}

function detecterSource(message: Message): string {
  const text = extractText(message)
  // Tenter d'extraire le nom de l'agent depuis le message
  const agentMatch = text.match(/^##?\s*(.+?)(?:\n|$)/)
  if (agentMatch) return agentMatch[1].trim()
  return message.role
}

// ── Analyse d'un message ──

/**
 * Analyse un message individuel et retourne les entrees de suivi detectees.
 */
function analyserMessage(
  msg: Message,
  index: number,
  timestamp: string,
): SuiviEntry[] {
  const text = extractText(msg)
  if (!text.trim()) return []

  const entries: SuiviEntry[] = []
  const source = detecterSource(msg)
  const tags = extractTags(text)

  // 1. D'abord les marqueurs explicites (haute priorite)
  for (const [categorie, pattern] of Object.entries(MARQUEUR_PATTERNS)) {
    const match = text.match(pattern)
    if (match) {
      entries.push({
        categorie: categorie as SuiviCategorie,
        texte: match[1].trim(),
        source,
        role: msg.role,
        messageIndex: index,
        timestamp,
        tags,
      })
    }
  }

  // 2. Ensuite les heuristiques (si aucun marqueur n'a matché pour cette catégorie)
  const categoriesTrouvees = new Set(entries.map(e => e.categorie))

  if (!categoriesTrouvees.has('decision')) {
    for (const pattern of DECISION_KEYWORDS) {
      if (pattern.test(text)) {
        entries.push({
          categorie: 'decision',
          texte: text.slice(0, 200).trim(),
          source,
          role: msg.role,
          messageIndex: index,
          timestamp,
          tags,
        })
        break
      }
    }
  }

  if (!categoriesTrouvees.has('action')) {
    for (const pattern of ACTION_KEYWORDS) {
      if (pattern.test(text)) {
        entries.push({
          categorie: 'action',
          texte: text.slice(0, 200).trim(),
          source,
          role: msg.role,
          messageIndex: index,
          timestamp,
          tags,
        })
        break
      }
    }
  }

  if (!categoriesTrouvees.has('fait')) {
    for (const pattern of FAIT_KEYWORDS) {
      if (pattern.test(text)) {
        entries.push({
          categorie: 'fait',
          texte: text.slice(0, 200).trim(),
          source,
          role: msg.role,
          messageIndex: index,
          timestamp,
          tags,
        })
        break
      }
    }
  }

  if (!categoriesTrouvees.has('todo')) {
    for (const pattern of TODO_KEYWORDS) {
      if (pattern.test(text)) {
        entries.push({
          categorie: 'todo',
          texte: text.slice(0, 200).trim(),
          source,
          role: msg.role,
          messageIndex: index,
          timestamp,
          tags,
        })
        break
      }
    }
  }

  if (!categoriesTrouvees.has('attente')) {
    for (const pattern of ATTENTE_KEYWORDS) {
      if (pattern.test(text)) {
        entries.push({
          categorie: 'attente',
          texte: text.slice(0, 200).trim(),
          source,
          role: msg.role,
          messageIndex: index,
          timestamp,
          tags,
        })
        break
      }
    }
  }

  return entries
}

// ── Generation du resume textuel ──

function genererResume(entrees: SuiviEntry[]): string {
  const sections: string[] = []
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ')

  sections.push(`# Suivi de session`)
  sections.push(`**Genere le :** ${now}`)
  sections.push(`**Entrees extraites :** ${entrees.length}`)
  sections.push('')

  // Decisions
  const decisions = entrees.filter(e => e.categorie === 'decision')
  if (decisions.length > 0) {
    sections.push('## Decisions prises')
    for (const d of decisions) {
      sections.push(`- ${d.texte} _(source: ${d.source})_`)
    }
    sections.push('')
  }

  // Actions en cours
  const actions = entrees.filter(e => e.categorie === 'action')
  if (actions.length > 0) {
    sections.push('## Actions en cours')
    for (const a of actions) {
      sections.push(`- ${a.texte} _(source: ${a.source})_`)
    }
    sections.push('')
  }

  // Realise
  const faits = entrees.filter(e => e.categorie === 'fait')
  if (faits.length > 0) {
    sections.push('## Realise')
    for (const f of faits) {
      sections.push(`- ${f.texte} _(source: ${f.source})_`)
    }
    sections.push('')
  }

  // Reste a faire
  const todos = entrees.filter(e => e.categorie === 'todo')
  if (todos.length > 0) {
    sections.push('## Reste a faire')
    for (const t of todos) {
      sections.push(`- ${t.texte} _(source: ${t.source})_`)
    }
    sections.push('')
  }

  // En attente
  const attentes = entrees.filter(e => e.categorie === 'attente')
  if (attentes.length > 0) {
    sections.push('## En attente')
    for (const a of attentes) {
      sections.push(`- ${a.texte} _(source: ${a.source})_`)
    }
    sections.push('')
  }

  return sections.join('\n')
}

// ── Fonction principale ──

/**
 * Analyse un historique de messages et produit un rapport de suivi.
 *
 * @param messages Historique complet de la session
 * @param options Options de configuration
 * @returns Rapport de suivi structure
 */
export function analyserHistorique(
  messages: Message[],
  options: HistorienOptions = {},
): RapportSuivi {
  const opts = {
    suiviDir: options.suiviDir ?? join(process.cwd(), 'telecom', 'suivi'),
    sessionName: options.sessionName ?? 'last-context',
    ecrireFichier: options.ecrireFichier ?? true,
    forceEcriture: options.forceEcriture ?? false,
  }

  const now = new Date().toISOString()

  // Analyser chaque message
  const entrees: SuiviEntry[] = []
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    const msgTimestamp = 'createdAt' in msg
      ? (msg as unknown as { createdAt: string }).createdAt
      : now
    const found = analyserMessage(msg, i, msgTimestamp)
    entrees.push(...found)
  }

  // Statistiques
  const stats = {
    decisions: entrees.filter(e => e.categorie === 'decision').length,
    actions: entrees.filter(e => e.categorie === 'action').length,
    faits: entrees.filter(e => e.categorie === 'fait').length,
    todos: entrees.filter(e => e.categorie === 'todo').length,
    attentes: entrees.filter(e => e.categorie === 'attente').length,
    total: entrees.length,
  }

  // Resume textuel
  const resume = genererResume(entrees)

  const rapport: RapportSuivi = {
    genereLe: now,
    messagesAnalyses: messages.length,
    entrees,
    resume,
    stats,
  }

  // Ecrire le fichier de suivi
  if (opts.ecrireFichier && (entrees.length > 0 || opts.forceEcriture)) {
    ecrireFichierSuivi(rapport, opts.suiviDir, opts.sessionName)
  }

  return rapport
}

// ── Ecriture du fichier de suivi ──

/**
 * Ecrit le fichier de suivi persistant sur disque.
 * Les agents peuvent consulter ce fichier pour comprendre le contexte.
 */
function ecrireFichierSuivi(
  rapport: RapportSuivi,
  suiviDir: string,
  sessionName: string,
): void {
  if (!existsSync(suiviDir)) {
    mkdirSync(suiviDir, { recursive: true })
    // Premier fichier dans ce dossier : ajouter un .gitignore
    const gitignorePath = join(suiviDir, '.gitignore')
    if (!existsSync(gitignorePath)) {
      writeFileSync(gitignorePath, '*\n', 'utf-8')
    }
  }

  const filePath = join(suiviDir, `${sessionName}.md`)

  // Verifier si le fichier existe deja (pour ne pas ecraser avec des donnees vides)
  if (!rapport.entrees.length && existsSync(filePath)) {
    return // Ne pas ecraser un fichier existant avec un rapport vide
  }

  // Construire le contenu du fichier
  const lignes: string[] = [
    `# Suivi de session — ${sessionName}`,
    `**Genere le :** ${new Date(rapport.genereLe).toISOString().slice(0, 16).replace('T', ' ')}`,
    `**Messages analyses :** ${rapport.messagesAnalyses}`,
    `**Entrees :** ${rapport.stats.total} (decisions: ${rapport.stats.decisions}, actions: ${rapport.stats.actions}, realises: ${rapport.stats.faits}, reste: ${rapport.stats.todos}, attentes: ${rapport.stats.attentes})`,
    '',
    '---',
    '',
    rapport.resume,
    '',
    '---',
    '',
    '## Donnees brutes',
    '',
    '```json',
    JSON.stringify(rapport.entrees, null, 2),
    '```',
  ]

  writeFileSync(filePath, lignes.join('\n'), 'utf-8')
}

/**
 * Lit le fichier de suivi d'une session.
 * Utilise par les agents (orchestrateur, agent-telecom, agent-reviewer)
 * pour consulter le contexte decisionnel courant.
 */
export function lireFichierSuivi(
  suiviDir?: string,
  sessionName: string = 'last-context',
): string | null {
  const dir = suiviDir ?? join(process.cwd(), 'telecom', 'suivi')
  const filePath = join(dir, `${sessionName}.md`)

  if (!existsSync(filePath)) return null

  try {
    return readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
}

/**
 * Helper pour ajouter rapidement un marqueur a un message.
 * Usage dans les system prompts ou instructions d'agents :
 *   const msg = ajouterMarqueur('decision', 'On utilise React pour le frontend');
 *   // → '[DECISION] On utilise React pour le frontend'
 */
export function ajouterMarqueur(
  categorie: SuiviCategorie,
  texte: string,
): string {
  const marqueur = `[${categorie.toUpperCase()}]`
  return `${marqueur} ${texte}`
}

/**
 * Version pipeline : analyse l'historique et retourne le resume textuel
 * pret a etre injecte comme message system dans le contexte LLM.
 */
export function historienResumePourLLM(
  messages: Message[],
  options?: HistorienOptions,
): string {
  const opt = options ?? {}
  const rapport = analyserHistorique(messages, { ...opt, ecrireFichier: opt.ecrireFichier ?? true })
  if (rapport.entrees.length === 0) return ''

  return [
    '=== SUIVI DE SESSION ===',
    `Decisions: ${rapport.stats.decisions}, Actions en cours: ${rapport.stats.actions},`,
    `Realises: ${rapport.stats.faits}, Reste a faire: ${rapport.stats.todos}, Attentes: ${rapport.stats.attentes}`,
    '',
    rapport.resume,
    '=== FIN SUIVI DE SESSION ===',
  ].join('\n')
}
