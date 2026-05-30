/**
 * telecom-context-conservateur
 *
 * Etape 0 du pipeline de compression de contexte.
 * Role : analyser un system prompt (instructionsPrompt + SKILL.md + regles + ...)
 * et trier les patterns importants pour produire une "carte de conservation".
 *
 * Pour chaque bloc detecte (section, regle, directive), on determine :
 *   - critical    -> indispensable (mission, regles absolues)
 *   - important   -> utile a garder (competences, outils, comportement)
 *   - optional    -> bonus (exemples, narrations) -- conserve selon profil
 *   - noise       -> bruit decoratif (separateurs visuels, fluff)
 *
 * Aucun appel LLM : heuristiques deterministes par mots-cles et #tags.
 * Idempotent : `conserver(conserver(x)) ~= conserver(x)`.
 */

export type PatternImportance = 'critical' | 'important' | 'optional' | 'noise'

export interface Pattern {
  /** Identifiant unique dans l'analyse courante. */
  id: number
  /** Titre de la section (ex: "#Mission", "#Regles") ou bloc libre. */
  header: string
  /** Contenu textuel du bloc. */
  content: string
  /** Importance determinee par heuristique. */
  importance: PatternImportance
  /** #tags extraits du bloc (ex: ['#Mission', '#Intercom']). */
  tags: string[]
  /** Source indicative (instructions, skill, regles, autre). */
  source: string
  /** Nombre de caracteres du contenu original. */
  charCount: number
}

export interface ConservateurOptions {
  /** Si true, conserve aussi les patterns 'optional'. Defaut: true. */
  keepOptional?: boolean
  /** Si true, supprime les patterns 'noise'. Defaut: true. */
  dropNoise?: boolean
  /** Maximum de patterns a conserver (0 = illimite). Defaut: 0. */
  maxPatterns?: number
  /** Si true, active le trace detaillee pour debug. */
  trace?: boolean
}

export interface ConservateurResult {
  /** Tous les patterns detectes (avant filtrage). */
  patterns: Pattern[]
  /** Patterns conserves apres filtrage (keep=true). */
  kept: Pattern[]
  /** Patterns supprimes apres filtrage. */
  dropped: Pattern[]
  /** Statistiques de l'analyse. */
  stats: {
    total: number
    critical: number
    important: number
    optional: number
    noise: number
    kept: number
    dropped: number
    charsBefore: number
    charsAfter: number
  }
}

// -- Mots-cles pour la classification --

const CRITICAL_PATTERNS = [
  /\b(r[éeèêë]gl[éeèêë]s?|regles?)\b/i,
  /\bne\s+jamais\b/i,
  /\btoujours\b/i,
  /\bobligatoire\b/i,
  /\babsolu(?:e)?\b/i,
  /\bmission\b/i,
  /\bimp[éeèêë]rativement\b/i,
  /\bjamais\s+(ne\s+)?(code|modifie|supprime)\b/i,
  /\bne\s+(code|modifie|supprime)\s+jamais\b/i,
  /\b(r[éeèêë]gle|regle)\s+d['']or\b/i,
]

const IMPORTANT_PATTERNS = [
  /\b(utilise|peut|doit|peuvent|doivent)\b/i,
  /\b(comp[éeèêë]tence|comportement|r[ôo]le|mission)\b/i,
  /\b(outil|fonction|responsabilit[éeèêë])\b/i,
  /\b(sujet|router|intercom|routine)\b/i,
  /\b#(projet|intercom|outil|comp[éeèêë]tence|comportement|sujet|r[éeèêë]gle|mission)\b/i,
]

const OPTIONAL_PATTERNS = [
  /\b(exemple|exemples?)\b/i,
  /\b(conseil|astuce|note)\b/i,
  /\b(illustration|demonstration)\b/i,
  /c\.?f\.?\b/i,
  /\bp\.?s\.?\b/i,
]

const NOISE_LINE = /^[=\-*_~]{3,}$/

// -- Decoupage en blocs --

/**
 * Decoupe un texte en blocs delimites par les en-tetes de section (##)
 * ou les separateurs (===, ---, ___).
 */
function splitIntoBlocks(text: string): Array<{ header: string; content: string }> {
  const blocks: Array<{ header: string; content: string }> = []
  const lines = text.split('\n')

  let currentHeader = '(en-tete)'
  let currentLines: string[] = []
  let inCodeBlock = false

  for (const line of lines) {
    // Ignorer les separateurs dans les blocs de code
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock
      currentLines.push(line)
      continue
    }

    // Ne pas interpreter les headers a l'interieur des blocs de code
    if (inCodeBlock) {
      currentLines.push(line)
      continue
    }

    const headerMatch = line.match(/^#{1,3}\s+(.+)/)
    const sepMatch = line.match(/^(={3,}|-{3,}|_{3,})\s*$/)

    if (headerMatch || sepMatch) {
      // Finaliser le bloc precedent
      const content = currentLines.join('\n').trim()
      if (content || currentHeader !== '(en-tete)') {
        blocks.push({ header: currentHeader, content })
      }
      currentHeader = headerMatch ? headerMatch[1].trim() : '(separateur)'
      currentLines = []
    } else {
      currentLines.push(line)
    }
  }

  // Dernier bloc
  const content = currentLines.join('\n').trim()
  if (content || currentHeader !== '(en-tete)') {
    blocks.push({ header: currentHeader, content })
  }

  return blocks
}

// -- Extraction des #tags --

const TAG_REGEX = /#([a-zA-ZÀ-ÿ0-9_-]+)/g

function extractTags(text: string): string[] {
  const tags: string[] = []
  let match
  while ((match = TAG_REGEX.exec(text)) !== null) {
    tags.push(`#${match[1]}`)
  }
  return [...new Set(tags)] // dedoublonnage
}

// -- Classification d'un bloc --

function classifyBlock(header: string, content: string): { importance: PatternImportance; source: string } {
  const combined = `${header} ${content}`.toLowerCase()

  // 1. Lignes purement decoratives -> noise
  const contentLines = content.split('\n').filter(l => l.trim())
  if (contentLines.length > 0 && contentLines.every(l => NOISE_LINE.test(l.trim()))) {
    return { importance: 'noise', source: 'decoratif' }
  }

  // 2. Contenu vide ou quasi-vide -> noise
  if (content.length < 10 && !header.includes('#')) {
    return { importance: 'noise', source: 'vide' }
  }

  // 3. Header contient #Mission, #Regles -> critical
  if (/\b#(mission|regle|regles)\b/i.test(combined)) {
    return { importance: 'critical', source: 'section-critique' }
  }

  // 4. Mots-cles critiques
  for (const pattern of CRITICAL_PATTERNS) {
    if (pattern.test(combined)) {
      return { importance: 'critical', source: 'directive-critique' }
    }
  }

  // 5. Header contient #Projets, #Intercom, #Outils -> important
  if (/\b#(projet|intercom|outil|competence|comportement|sujet|projets|outils)\b/i.test(combined)) {
    return { importance: 'important', source: 'section-importante' }
  }

  // 6. Mots-cles importants
  for (const pattern of IMPORTANT_PATTERNS) {
    if (pattern.test(combined)) {
      return { importance: 'important', source: 'contenu-important' }
    }
  }

  // 7. Marqueurs optionnels
  for (const pattern of OPTIONAL_PATTERNS) {
    if (pattern.test(combined)) {
      return { importance: 'optional', source: 'contenu-optionnel' }
    }
  }

  // 8. Tout contenu textuel valide -> important par defaut
  if (content.trim().length >= 15) {
    return { importance: 'important', source: 'contenu-general' }
  }

  // 9. Court fragment residuel -> optional
  return { importance: 'optional', source: 'fragment' }
}

// -- Fonction principale --

/**
 * Analyse un system prompt et produit une carte de conservation.
 *
 * @param prompt Le system prompt complet a analyser
 * @param options Options de filtrage
 * @returns Resultat structure avec patterns, stats
 */
export function conserver(
  prompt: string,
  options: ConservateurOptions = {},
): ConservateurResult {
  const opts = {
    keepOptional: options.keepOptional ?? true,
    dropNoise: options.dropNoise ?? true,
    maxPatterns: options.maxPatterns ?? 0,
    trace: options.trace ?? false,
  }

  if (!prompt || !prompt.trim()) {
    return {
      patterns: [],
      kept: [],
      dropped: [],
      stats: { total: 0, critical: 0, important: 0, optional: 0, noise: 0, kept: 0, dropped: 0, charsBefore: 0, charsAfter: 0 },
    }
  }

  // Decoupage + classification
  const rawBlocks = splitIntoBlocks(prompt)
  const patterns: Pattern[] = rawBlocks.map((block, idx) => {
    const { importance, source } = classifyBlock(block.header, block.content)
    return {
      id: idx,
      header: block.header,
      content: block.content,
      importance,
      tags: extractTags(`${block.header} ${block.content}`),
      source,
      charCount: block.content.length,
    }
  })

  // Filtrage
  const kept = patterns.filter(p => {
    if (p.importance === 'noise' && opts.dropNoise) return false
    if (p.importance === 'optional' && !opts.keepOptional) return false
    return true
  })

  const dropped = patterns.filter(p => !kept.includes(p))

  // Appliquer maxPatterns si defini
  const finalKept = opts.maxPatterns > 0 ? kept.slice(0, opts.maxPatterns) : kept

  const charsBefore = prompt.length
  const charsAfter = finalKept.reduce((sum, p) => sum + p.content.length + p.header.length, 0)

  // Stats
  const total = patterns.length
  const critical = patterns.filter(p => p.importance === 'critical').length
  const important = patterns.filter(p => p.importance === 'important').length
  const optional = patterns.filter(p => p.importance === 'optional').length
  const noise = patterns.filter(p => p.importance === 'noise').length

  return {
    patterns,
    kept: finalKept,
    dropped,
    stats: {
      total,
      critical,
      important,
      optional,
      noise,
      kept: finalKept.length,
      dropped: dropped.length,
      charsBefore,
      charsAfter,
    },
  }
}

/**
 * Variante detaillee qui retourne aussi l'arbre de decision pour debug.
 */
export function conserverDetail(
  prompt: string,
  options: ConservateurOptions = {},
): ConservateurResult & { decisions: Array<{ header: string; importance: PatternImportance; reason: string }> } {
  const result = conserver(prompt, { ...options, trace: true })

  const decisions = result.patterns.map(p => ({
    header: p.header,
    importance: p.importance,
    reason: p.source,
  }))

  return { ...result, decisions }
}
