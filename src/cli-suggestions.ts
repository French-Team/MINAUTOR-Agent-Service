/**
 * cli-suggestions.ts — Menu interactif pour les suggestions de suivi
 *
 * Après l'exécution d'un script (block-task, add-task, etc.),
 * le daemon écrit des suggestions structurées dans telecom/suggestions.json.
 * Ce module les lit et affiche un menu numéroté dans le CLI.
 *
 * L'utilisateur tape un chiffre pour exécuter la commande correspondante,
 * ou 0 pour ignorer et taper sa propre commande.
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { Interface } from 'readline/promises'
import {
  RESET, CYAN, GREEN, YELLOW, GRAY, BOLD, RED,
} from './constants.js'

import { tracker } from './learning.js'

export interface Suggestion {
  /** Texte court affiché dans le menu (ex: "Renommer") */
  label: string
  /** Texte secondaire de description (ex: "Renommer la tâche") */
  description: string
  /** Commande complète à exécuter si l'utilisateur choisit cette suggestion */
  command: string
  /** Groupe de suggestion pour le regroupement visuel (ex: "Modification", "Ajout") */
  group?: string
}

const SUGGESTIONS_PATH = join(process.cwd(), 'telecom', 'suggestions.json')
const SUGGESTION_STATS_DIR = join(process.cwd(), 'telecom')
const SUGGESTION_STATS_PATH = join(SUGGESTION_STATS_DIR, 'suggestion_stats.json')

/**
 * Retourne le chemin du fichier de stats selon le projet.
 * Si un projectName est fourni, utilise suggestion_stats_<project>.json.
 * Sinon, utilise le fichier global suggestion_stats.json (fallback).
 */
function getStatsPath(projectName?: string): string {
  if (projectName) {
    return join(SUGGESTION_STATS_DIR, `suggestion_stats_${projectName}.json`)
  }
  return SUGGESTION_STATS_PATH
}
const SUGGESTION_PREFS_PATH = join(process.cwd(), 'telecom', 'suggestion_prefs.json')
const TEMPLATES_PATH = join(process.cwd(), 'data', 'suggestions', 'templates.yaml')

// ── Statistiques d'apprentissage ──

interface SuggestionStats {
  /** Map command → nombre de fois choisi */
  counts: Record<string, number>
  /** Nombre total de choix enregistrés */
  totalChoices: number
}

const DEFAULT_STATS: Readonly<SuggestionStats> = {
  counts: {},
  totalChoices: 0,
}

/**
 * Retourne une copie PROFONDE de DEFAULT_STATS avec des objets/tableaux NEUFS.
 * Nécessaire car le spread `{ ...DEFAULT_STATS }` ne copie que les références
 * (shallow copy). `counts: {}` est partagé entre toutes les instances — si
 * incrementSuggestionStats() mute `counts`, la mutation persiste dans
 * DEFAULT_STATS pour les appels suivants.
 */
function freshSuggestionStats(): SuggestionStats {
  return {
    counts: {},
    totalChoices: 0,
  }
}

/**
 * Charge les statistiques de choix depuis telecom/suggestion_stats.json.
 * Crée automatiquement le fichier avec des valeurs par défaut s'il n'existe pas.
 */
export function loadSuggestionStats(projectName?: string): SuggestionStats {
  const path = getStatsPath(projectName)
  if (!existsSync(path)) {
    try {
      const dir = join(path, '..')
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(path, JSON.stringify(DEFAULT_STATS, null, 2), 'utf-8')
    } catch { /* ignoré — non bloquant */ }
    return freshSuggestionStats()
  }
  try {
    const raw = readFileSync(path, 'utf-8').trim()
    if (!raw) return freshSuggestionStats()
    const parsed = JSON.parse(raw)
    return {
      counts: typeof parsed?.counts === 'object' && parsed.counts !== null ? parsed.counts : {},
      totalChoices: typeof parsed?.totalChoices === 'number' ? parsed.totalChoices : 0,
    }
  } catch {
    return freshSuggestionStats()
  }
}

/**
 * Incrémente le compteur de choix pour une commande de suggestion.
 * La commande est normalisée (lowercase, trim) pour servir de clé.
 */
export function incrementSuggestionStats(command: string, projectName?: string): void {
  if (!command) return
  const stats = loadSuggestionStats(projectName)
  const key = command.trim().toLowerCase()
  if (!key) return
  stats.counts[key] = (stats.counts[key] ?? 0) + 1
  stats.totalChoices++
  try {
    writeFileSync(getStatsPath(projectName), JSON.stringify(stats, null, 2), 'utf-8')
  } catch { /* ignoré — non bloquant */ }
}

/**
 * Trie les suggestions par fréquence de choix (les plus choisies en premier).
 * Ajoute un petit facteur de découverte aléatoire pour les suggestions
 * ayant la même fréquence, évitant ainsi que le système ne s'enferme
 * dans une boucle de suggestions toujours identiques.
 *
 * Les suggestions sans historique (count=0) sont classées par leur ordre
 * original avec un léger jitter aléatoire.
 */
export function sortSuggestionsByFrequency(suggestions: Suggestion[], projectName?: string): Suggestion[] {
  if (suggestions.length <= 1) return suggestions

  const stats = loadSuggestionStats(projectName)

  return [...suggestions].sort((a, b) => {
    const countA = stats.counts[a.command.trim().toLowerCase()] ?? 0
    const countB = stats.counts[b.command.trim().toLowerCase()] ?? 0

    // Si les fréquences sont différentes, trier par fréquence décroissante
    if (countA !== countB) {
      return countB - countA
    }

    // Même fréquence : ajouter un jitter aléatoire (±0.5) pour éviter
    // l'ordre toujours identique et favoriser la découverte
    return Math.random() - 0.5
  })
}

// ── Préférences d'affichage ──

export interface SuggestionPrefs {
  /** Afficher automatiquement le menu des suggestions après une action */
  autoShow: boolean
}

const DEFAULT_PREFS: SuggestionPrefs = {
  autoShow: true,
}

/**
 * Charge les préférences d'affichage des suggestions.
 */
export function getSuggestionPrefs(): SuggestionPrefs {
  if (!existsSync(SUGGESTION_PREFS_PATH)) return { ...DEFAULT_PREFS }
  try {
    const raw = readFileSync(SUGGESTION_PREFS_PATH, 'utf-8').trim()
    if (!raw) return { ...DEFAULT_PREFS }
    const parsed = JSON.parse(raw)
    return {
      autoShow: typeof parsed?.autoShow === 'boolean' ? parsed.autoShow : DEFAULT_PREFS.autoShow,
    }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

/**
 * Sauvegarde les préférences d'affichage des suggestions.
 */
export function setSuggestionPrefs(prefs: SuggestionPrefs): void {
  try {
    const dir = join(SUGGESTION_PREFS_PATH, '..')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(SUGGESTION_PREFS_PATH, JSON.stringify(prefs, null, 2), 'utf-8')
  } catch { /* ignoré — non bloquant */ }
}

// ── Formatage pour l'affichage CLI ──

/**
 * Formate les statistiques d'apprentissage en lignes prêtes pour l'affichage.
 */
export function formatStatsForDisplay(projectName?: string): string[] {
  const lines: string[] = []
  const stats = loadSuggestionStats(projectName)

  if (stats.totalChoices === 0) {
    lines.push(`  ${GRAY}Aucune donnée d'apprentissage pour l'instant.${RESET}`)
    lines.push(`  ${GRAY}Les suggestions que tu choisis sont enregistrées ici.${RESET}`)
    return lines
  }

  lines.push(`  ${BOLD}Total des choix :${RESET} ${CYAN}${stats.totalChoices}${RESET}`)
  lines.push(`  ${BOLD}Commandes distinctes :${RESET} ${CYAN}${Object.keys(stats.counts).length}${RESET}`)
  lines.push('')
  lines.push(`  ${GRAY}── Top suggestions les plus choisies ──${RESET}`)

  // Trier par fréquence décroissante
  const sorted = Object.entries(stats.counts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)

  for (const [cmd, count] of sorted) {
    const pct = ((count / stats.totalChoices) * 100).toFixed(1)
    const bar = '█'.repeat(Math.round((count / sorted[0][1]) * 15))
    lines.push(`  ${GREEN}${String(count).padStart(3)}${RESET} × ${GRAY}${bar}${RESET} ${cmd.slice(0, 60)}${cmd.length > 60 ? '…' : ''}  ${GRAY}(${pct}%)${RESET}`)
  }

  return lines
}

/**
 * Formate les suggestions actuelles en lignes prêtes pour l'affichage.
 */
export function formatCurrentSuggestionsForDisplay(): string[] {
  const lines: string[] = []
  const suggestions = loadSuggestions()

  if (suggestions.length === 0) {
    lines.push(`  ${GRAY}Aucune suggestion active pour le moment.${RESET}`)
    lines.push(`  ${GRAY}Les suggestions apparaissent après l'exécution d'un script.${RESET}`)
    return lines
  }

  lines.push(`  ${BOLD}${suggestions.length} suggestion(s) disponible(s) :${RESET}\n`)

  let currentGroup: string | undefined = undefined
  for (let i = 0; i < suggestions.length; i++) {
    const s = suggestions[i]
    if (s.group && s.group !== currentGroup) {
      currentGroup = s.group
      lines.push(`  ${GRAY}── ${currentGroup} ──${RESET}`)
    } else if (!s.group && currentGroup !== undefined) {
      currentGroup = undefined
    }
    lines.push(`  ${GREEN}${i + 1}${RESET}.  ${s.label}  ${GRAY}— ${s.description}${RESET}`)
    lines.push(`      ${GRAY}→ ${s.command}${RESET}`)
  }

  return lines
}

/**
 * Charge et formate les templates YAML pour l'affichage CLI.
 */
export function formatTemplatesForDisplay(): string[] {
  const lines: string[] = []

  if (!existsSync(TEMPLATES_PATH)) {
    lines.push(`  ${YELLOW}Fichier de templates introuvable :${RESET}`)
    lines.push(`  ${GRAY}${TEMPLATES_PATH}${RESET}`)
    return lines
  }

  try {
    const raw = readFileSync(TEMPLATES_PATH, 'utf-8')

    // Le YAML a une structure tasks: avec des sous-sections indentées
    // Liste les noms des sous-sections (menu, etat, work, add-task, etc.)
    const subSectionRegex = /^  (\w[\w-]*):/gm
    const subSections: string[] = []
    let match: RegExpExecArray | null
    while ((match = subSectionRegex.exec(raw)) !== null) {
      subSections.push(match[1])
    }

    // Compter les templates (lignes - command:)
    const taskLines = raw.split('\n').filter(l => l.trim().startsWith('- command:'))

    if (subSections.length > 0) {
      lines.push(`  ${GRAY}Sous-sections disponibles (${subSections.length}) :${RESET}`)
      // Afficher en lignes de 5 pour lisibilité
      for (let i = 0; i < subSections.length; i += 5) {
        const chunk = subSections.slice(i, i + 5)
        lines.push(`  ${CYAN}${chunk.join(`${RESET}, ${CYAN}`)}${RESET}`)
      }
    }

    lines.push('')
    lines.push(`  ${GRAY}Fichier : ${TEMPLATES_PATH}${RESET}`)
    lines.push(`  ${GRAY}${subSections.length} section(s), ${taskLines.length} template(s) de suggestion${RESET}`)

    // Afficher le contenu complet ?
    lines.push('')
    lines.push(`  ${GRAY}Utilise !suggestions en ligne de commande pour un aperçu complet.${RESET}`)
  } catch {
    lines.push(`  ${RED}Erreur lors de la lecture du fichier de templates.${RESET}`)
  }

  return lines
}

/**
 * Supprime le fichier de statistiques (utile pour réinitialiser l'apprentissage).
 */
export function resetSuggestionStats(projectName?: string): void {
  const path = getStatsPath(projectName)
  if (existsSync(path)) {
    try { unlinkSync(path) } catch { /* ignoré */ }
  }
}

/**
 * Lit les suggestions depuis le fichier JSON.
 *
 * Accepte deux formats :
 *   - Array :  [{ label, description, command, group? }, ...]
 *   - Objet :  { menu: "Actions rapides", items: [{ label, description, command }, ...] }
 *
 * Le format objet est celui produit par l'agent-parades (spec Section 6).
 * Le format tableau est celui des scripts legacy.
 */
export function loadSuggestions(): Suggestion[] {
  if (!existsSync(SUGGESTIONS_PATH)) return []
  try {
    const raw = readFileSync(SUGGESTIONS_PATH, 'utf-8').trim()
    if (!raw) return []
    const parsed = JSON.parse(raw)

    // Type guard partagé pour les deux formats
    const isValidSuggestion = (s: unknown): s is Suggestion =>
      s !== null &&
      typeof s === 'object' &&
      typeof (s as Record<string, unknown>).label === 'string' &&
      typeof (s as Record<string, unknown>).command === 'string'

    // Format objet : { menu, items }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      if (!Array.isArray(parsed.items)) return []
      return (parsed.items as unknown[]).filter(isValidSuggestion)
    }

    // Format tableau : [Suggestion, ...]
    if (Array.isArray(parsed)) {
      return parsed.filter(isValidSuggestion)
    }

    return []
  } catch {
    return []
  }
}

/** Vérifie si des suggestions sont disponibles */
export function hasSuggestions(): boolean {
  return existsSync(SUGGESTIONS_PATH) && loadSuggestions().length > 0
}

/** Supprime le fichier de suggestions */
export function clearSuggestions(): void {
  if (existsSync(SUGGESTIONS_PATH)) {
    try {
      unlinkSync(SUGGESTIONS_PATH)
    } catch {
      /* ignoré */
    }
  }
}

/** Écrit les suggestions dans le fichier JSON */
export function writeSuggestions(suggestions: Suggestion[]): void {
  try {
    const dir = join(SUGGESTIONS_PATH, '..')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(SUGGESTIONS_PATH, JSON.stringify(suggestions, null, 2), 'utf-8')
  } catch {
    /* ignoré — non bloquant */
  }
}

/**
 * Parse le texte généré par getFollowUpSuggestions() pour en extraire
 * les suggestions structurées.
 *
 * Formats de ligne reconnus :
 *   → <commande> — <label>          → Suggestion avec commande
 *   ── <groupe> ──                   → Séparateur de groupe (appliqué aux suggestions suivantes)
 */
export function parseSuggestionsFromOutput(output: string): Suggestion[] {
  const suggestions: Suggestion[] = []
  let currentGroup: string | undefined = undefined
  const lines = output.split('\n')
  for (const line of lines) {
    // Détection d'un séparateur de groupe : "  ── Group ──"
    const groupMatch = line.match(/^ {2}── (.+?) ──$/)
    if (groupMatch) {
      currentGroup = groupMatch[1].trim()
      continue
    }

    // Détection d'une suggestion : "  → commande — label"
    const suggestionMatch = line.match(/^ {2}→ (.+) — (.+)$/)
    if (suggestionMatch) {
      const command = suggestionMatch[1].trim()
      const label = suggestionMatch[2].trim()
      suggestions.push({
        label,
        description: label,
        command,
        group: currentGroup,
      })
    }
  }
  return suggestions
}

/**
 * Construit les lignes du menu interactif avec séparateurs de groupe.
 * Insère une ligne de séparation visuelle (gris clair) entre chaque groupe.
 */
function formatSuggestionMenuLines(suggestions: Suggestion[]): string[] {
  const lines: string[] = []
  let currentGroup: string | undefined = undefined

  for (let i = 0; i < suggestions.length; i++) {
    const s = suggestions[i]
    const num = String(i + 1)

    // Insérer un séparateur de groupe si le groupe change
    if (s.group && s.group !== currentGroup) {
      currentGroup = s.group
      lines.push(`${BOLD}${CYAN}║  ${GRAY}── ${currentGroup} ──${RESET}`)
    } else if (!s.group && currentGroup !== undefined) {
      // Retour au groupe "non groupé" après un groupe nommé
      // (cas rare : suggestion sans groupe après une suggestion avec groupe)
      currentGroup = undefined
    }

    lines.push(
      `${BOLD}${CYAN}║  ${RESET}${GREEN}${num}${RESET}.  ${s.label}  ${GRAY}— ${s.description}${RESET}`,
    )
  }

  return lines
}

/**
 * Affiche le menu des suggestions dans stdout (sans rl.question)
 * et attend un appui clavier pour le choix.
 * Utilise le stdin en mode raw déjà configuré par cli-main.ts.
 *
 * @returns La commande à exécuter, ou null si l'utilisateur a ignoré
 */
export async function showSuggestionMenuRaw(projectName?: string): Promise<string | null> {
  const suggestions = loadSuggestions()
  if (suggestions.length === 0) return null

  // Ne pas afficher le menu si stdin n'est pas un TTY
  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    clearSuggestions()
    return null
  }

  const start = async (): Promise<string | null> => {
    return new Promise((resolve) => {
      // Afficher le menu avec séparateurs de groupe
      const lines: string[] = []
      lines.push(`\n${BOLD}${CYAN}╔ Actions rapides${RESET}`)
      lines.push(...formatSuggestionMenuLines(suggestions))
      lines.push(`${BOLD}${CYAN}║${RESET}`)
      lines.push(
        `${BOLD}${CYAN}║  ${RESET}${YELLOW}0${RESET}.  Ignorer et taper ma propre commande`,
      )
      lines.push(`${BOLD}${CYAN}╚${RESET}  ${GRAY}(appuyer sur un chiffre)${RESET}`)
      process.stdout.write(lines.join('\n') + '\n')

      // Réécouter un appui clavier (une seule fois)
      const handler = (_str: string, key: { name: string; sequence?: string }) => {
        process.stdin.removeListener('keypress', handler)
        clearSuggestions()

        const num = parseInt(key.name, 10)
        if (isNaN(num) || num < 1 || num > suggestions.length) {
          resolve(null)
          return
        }
        // Enregistrer le choix dans les deux systèmes de tracking
        incrementSuggestionStats(suggestions[num - 1].command, projectName)
        tracker.recordChoice(suggestions[num - 1].command)
        resolve(suggestions[num - 1].command)
      }
      process.stdin.on('keypress', handler)
    })
  }

  return start()
}

/**
 * Affiche le menu interactif des suggestions et attend le choix de l'utilisateur.
 *
 * @param rl - L'interface readline du CLI (pour éviter de créer une nouvelle instance)
 * @returns La commande à exécuter, ou null si l'utilisateur a ignoré
 */
export async function showSuggestionMenu(rl: Interface, projectName?: string): Promise<string | null> {
  const suggestions = loadSuggestions()
  if (suggestions.length === 0) return null

  console.log(`\n${BOLD}${CYAN}╔ Actions rapides${RESET}`)
  const menuLines = formatSuggestionMenuLines(suggestions)
  for (const line of menuLines) {
    console.log(line)
  }
  console.log(`${BOLD}${CYAN}║${RESET}`)
  console.log(
    `${BOLD}${CYAN}║  ${RESET}${YELLOW}0${RESET}.  Ignorer et taper ma propre commande`,
  )
  console.log(`${BOLD}${CYAN}╚${RESET}`)

  const answer = (
    await rl.question(`${GRAY}Choix (0-${suggestions.length}): ${RESET}`)
  ).trim()

  // Nettoyer les suggestions maintenant que l'utilisateur a vu le menu
  clearSuggestions()

  const num = parseInt(answer, 10)
  if (isNaN(num) || num < 1 || num > suggestions.length) return null

  // Enregistrer le choix dans les deux systèmes de tracking
  incrementSuggestionStats(suggestions[num - 1].command, projectName)
  tracker.recordChoice(suggestions[num - 1].command)

  return suggestions[num - 1].command
}
