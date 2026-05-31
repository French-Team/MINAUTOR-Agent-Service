/**
 * suggestion-templates.ts — Chargeur et moteur de rendu pour les modèles de suggestions
 *
 * Les templates sont stockés dans data/suggestions/templates.yaml et
 * contiennent des commandes avec placeholders ({taskId}, {project}, {area}, {description}).
 *
 * Expansion dynamique des domaines :
 *   Lorsqu'une commande contient le placeholder {area} et qu'aucune valeur
 *   spécifique n'est fournie dans le contexte MAIS qu'un nom de projet est
 *   disponible, les domaines réels sont lus depuis le .tasks.json du projet
 *   et une suggestion est générée par domaine. Cela remplace les placeholders
 *   génériques (<domaine>) par des valeurs réelles (backend, frontend, etc.).
 *
 * Usage :
 *   import { renderSuggestionTemplates } from '../../suggestion-templates.js'
 *   const lines = renderSuggestionTemplates('add-task', {
 *     taskId: 'task-123',
 *     project: 'mon-projet',
 *     area: 'backend',
 *   })
 *   // → [ '  → renomme la tâche "task-123" en \'Nouveau titre\' au projet mon-projet — Renommer', ... ]
 */

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { load as yamlLoad } from 'js-yaml'
import { readTaskBoard } from './project/task-board.js'

// ── Types ──

export interface SuggestionTemplate {
  /** Commande avec placeholders (ex: 'renomme la tâche {taskId} en \'Nouveau titre\' au projet {project}') */
  command: string
  /** Texte court affiché dans le menu interactif (ex: 'Renommer') */
  label: string
  /** Groupe de suggestion pour le regroupement visuel (ex: 'Modification', 'Ajout', 'État') */
  group?: string
}

export interface TemplateContext {
  /** ID de la tâche, ou undefined */
  taskId?: string
  /** Nom du projet, ou undefined */
  project?: string
  /** Domaine (area), ou undefined */
  area?: string
  /** Titre, ou undefined */
  title?: string
  /** Nom, ou undefined */
  name?: string
  /** Description, ou undefined */
  description?: string
}

// ── Cache ──

interface YamlStructure {
  tasks?: Record<string, SuggestionTemplate[]>
}

const TEMPLATES_PATH = join(process.cwd(), 'data', 'suggestions', 'templates.yaml')
let cachedTemplates: Record<string, SuggestionTemplate[]> | null = null

// ── Chargement ──

/**
 * Charge tous les templates depuis data/suggestions/templates.yaml.
 * Le résultat est mis en cache pour la durée de vie du processus.
 * Si le fichier n'existe pas ou est invalide, retourne un objet vide.
 */
export function loadSuggestionTemplates(): Record<string, SuggestionTemplate[]> {
  if (cachedTemplates !== null) return cachedTemplates

  if (!existsSync(TEMPLATES_PATH)) {
    cachedTemplates = {}
    return cachedTemplates
  }

  try {
    const raw = readFileSync(TEMPLATES_PATH, 'utf-8')
    const parsed = yamlLoad(raw) as YamlStructure
    const tasks = parsed?.tasks ?? {}

    const result: Record<string, SuggestionTemplate[]> = {}
    for (const [key, templates] of Object.entries(tasks)) {
      if (Array.isArray(templates)) {
        result[key] = templates.map(t => ({
          command: String(t.command ?? ''),
          label: String(t.label ?? ''),
          group: t.group ? String(t.group) : undefined,
        })).filter(t => t.command && t.label)
      }
    }

    cachedTemplates = result
    return result
  } catch {
    cachedTemplates = {}
    return cachedTemplates
  }
}

/**
 * Vide le cache des templates (utile pour les tests ou le rechargement à chaud).
 */
export function clearTemplateCache(): void {
  cachedTemplates = null
}

// ── Rendu ──

/**
 * Remplace les placeholders dans une commande avec les valeurs du contexte.
 *
 * Règles de remplacement :
 * - {taskId}      → "task-xxx" si disponible, sinon "..."
 * - {project}     → valeur réelle si disponible, sinon "<projet>"
 * - {area}        → valeur réelle si disponible, sinon "<domaine>"
 * - {title}       → valeur réelle si disponible, sinon "<titre>"
 * - {name}        → valeur réelle si disponible, sinon "<nom>"
 * - {description} → valeur réelle si disponible, sinon "'...'"
 */
function fillPlaceholders(command: string, ctx: TemplateContext): string {
  return command
    .replace(/\{taskId\}/g, ctx.taskId ? `"${ctx.taskId}"` : '"..."')
    .replace(/\{project\}/g, ctx.project || '<projet>')
    .replace(/\{area\}/g, ctx.area || '<domaine>')
    .replace(/\{title\}/g, ctx.title || '<titre>')
    .replace(/\{name\}/g, ctx.name || '<nom>')
    .replace(/\{description\}/g, ctx.description || "'...'")
}

// ── Expansion dynamique des domaines ──

/**
 * Récupère la liste des domaines (areas) réellement présents dans un projet,
 * en lisant son fichier .tasks.json. Exclut les valeurs vides ou nulles.
 *
 * @param projectName - Nom du projet
 * @returns Tableau trié des domaines uniques, ou [] si le fichier n'existe pas / est vide / erreur
 */
export function getProjectAreas(projectName: string): string[] {
  if (!projectName) return []
  try {
    const board = readTaskBoard(projectName)
    const areas = new Set<string>()
    for (const task of board.tasks) {
      if (task.area && task.area.trim()) {
        areas.add(task.area.trim())
      }
    }
    return [...areas].sort()
  } catch {
    return []
  }
}

/**
 * Génère les lignes de suggestion formatées à partir des templates YAML
 * pour un nom de script donné.
 *
 * Expansion automatique des domaines :
 *   Quand une commande contient {area} et qu'aucune valeur spécifique n'est
 *   fournie dans le contexte, les domaines réels du projet sont chargés depuis
 *   .tasks.json et une suggestion est générée par domaine au lieu d'un seul
 *   placeholder générique <domaine>.
 *
 * @param scriptName - Nom du script exécuté (ex: 'add-task', 'done-task')
 * @param context    - Contexte avec les valeurs à injecter dans les placeholders
 * @returns Tableau de lignes formatées (ex: '  → renomme la tâche "task-123" — Renommer')
 */
export function renderSuggestionTemplates(
  scriptName: string,
  context: TemplateContext,
): string[] {
  const allTemplates = loadSuggestionTemplates()
  const templates = allTemplates[scriptName]

  if (!templates || templates.length === 0) {
    return []
  }

  const result: string[] = []
  let currentGroup = ''

  for (const tpl of templates) {
    // Détection d'expansion pour {area} :
    // Si la commande contient {area} ET que le contexte ne fournit pas
    // de domaine spécifique MAIS qu'un projet est nommé, on lit les
    // domaines réels depuis .tasks.json et on génère une ligne par domaine.
    const hasAreaPlaceholder = tpl.command.includes('{area}')
    const shouldExpandAreas = hasAreaPlaceholder && !context.area && !!context.project

    if (shouldExpandAreas) {
      const realAreas = getProjectAreas(context.project!)

      if (realAreas.length > 0) {
        // Une ligne par domaine réel trouvé dans le projet
        for (const area of realAreas) {
          const command = fillPlaceholders(tpl.command, { ...context, area })
          // Ajouter un séparateur de groupe si le groupe change
          if (tpl.group && tpl.group !== currentGroup) {
            currentGroup = tpl.group
            result.push(`  ── ${currentGroup} ──`)
          }
          result.push(`  → ${command} — ${tpl.label}`)
        }
      } else {
        // Aucun domaine trouvé → fallback générique avec <domaine>
        const command = fillPlaceholders(tpl.command, context)
        if (tpl.group && tpl.group !== currentGroup) {
          currentGroup = tpl.group
          result.push(`  ── ${currentGroup} ──`)
        }
        result.push(`  → ${command} — ${tpl.label}`)
      }
    } else {
      // Cas normal : remplacer les placeholders avec les valeurs du contexte
      // Ajouter un séparateur de groupe si le groupe change
      if (tpl.group && tpl.group !== currentGroup) {
        currentGroup = tpl.group
        result.push(`  ── ${currentGroup} ──`)
      }
      const command = fillPlaceholders(tpl.command, context)
      result.push(`  → ${command} — ${tpl.label}`)
    }
  }

  return result
}
