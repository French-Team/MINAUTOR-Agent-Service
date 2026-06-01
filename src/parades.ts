/**
 * src/parades.ts — Service Parades : génération de propositions intelligentes
 *
 * Remplace l'ancien système de suggestions (triggerSuggestions / handle.js).
 * Orchestre agent-parades via spawn-agent.js avec :
 *   - Phase detection (lecture de data/rules/parades-phases.yaml)
 *   - Collecte de contexte (projets, tâches, notifications, logbook)
 *   - Spinner d'attente + polling sur suggestions.json
 *   - Annulation au premier input utilisateur
 *
 * ════════════════════════════════════════════════════════════════
 *   Flux :
 *     1. triggerParades(context) est appelé depuis le handler IPC
 *     2. Collecte le contexte → détermine la phase → construit le prompt
 *     3. Écrit le prompt dans telecom/.parades-context.json
 *     4. Spawn spawn-agent.js agent-parades (lit le fichier)
 *     5. Affiche le spinner ⟳  + polling toutes les 500ms
 *     6. Si suggestions.json trouvé → cache le menu → showSuggestionMenuRaw
 *     7. Si appui clavier → annulation immédiate
 * ════════════════════════════════════════════════════════════════
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'
import { exec, type ChildProcess } from 'child_process'
import { stdin } from 'process'

import {
  RESET, YELLOW, GRAY,
} from './constants.js'
import { load as loadYaml } from 'js-yaml'

import { showSuggestionMenuRaw, clearSuggestions } from './cli-suggestions.js'
import { getCurrentProject } from './cli-intercom-router.js'

// ── Types publics ────────────────────────────────────────

export interface ParadeContext {
  /** Nom du projet courant (optionnel) */
  projectName?: string
  /** Action qui a déclenché la génération */
  action: 'route' | 'llm-response' | 'project-use' | 'task-done'
  /** Demande originale de l'utilisateur */
  demande?: string
  /** Réponse LLM (si action = 'llm-response') */
  llmResponse?: string
}

// ── État interne ─────────────────────────────────────────

/** Anti-boucle : si déjà en cours, on ne relance pas */
let _paradesRunning = false

/** Référence au child process (pour kill en cas d'annulation) */
let _paradesChild: ChildProcess | null = null

/** Timers internes (spinner + polling) */
let _spinnerTimer: ReturnType<typeof setInterval> | null = null
let _pollingTimer: ReturnType<typeof setInterval> | null = null

// ── Chemins ──────────────────────────────────────────────

const LAST_CONTEXT_PATH = join(process.cwd(), 'telecom', '.last-context.json')
const PARADES_CONTEXT_PATH = join(process.cwd(), 'telecom', '.parades-context.json')
const SUGGESTIONS_PATH = join(process.cwd(), 'telecom', 'suggestions.json')
const RULES_PATH = join(process.cwd(), 'data', 'rules', 'parades-phases.yaml')
const AGENT_PATH = join(process.cwd(), 'dist', 'spawn-agent.js')

// ── API publique ─────────────────────────────────────────

/**
 * Vérifie si une génération de parades est en cours.
 * Utile pour le CLI qui peut vouloir éviter de relancer.
 */
export function isParadesRunning(): boolean {
  return _paradesRunning
}

/**
 * Écrit le contexte dans telecom/.last-context.json pour que le handler IPC
 * puisse le lire quand la notification 'conclusion' arrive.
 * Appelé APRÈS chaque action (routage, réponse LLM, commande projet).
 */
export function writeLastContext(context: ParadeContext): void {
  try {
    const dir = join(LAST_CONTEXT_PATH, '..')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(
      LAST_CONTEXT_PATH,
      JSON.stringify({ ...context, timestamp: Date.now() }, null, 2),
      'utf-8',
    )
  } catch {
    // Silencieux — non bloquant
  }
}

/**
 * Lit le contexte depuis telecom/.last-context.json.
 * Appelé par le handler IPC quand la notification 'conclusion' arrive.
 */
export function readLastContext(): ParadeContext | null {
  if (!existsSync(LAST_CONTEXT_PATH)) return null
  try {
    const raw = readFileSync(LAST_CONTEXT_PATH, 'utf-8').trim()
    if (!raw) return null
    return JSON.parse(raw) as ParadeContext
  } catch {
    return null
  }
}

/**
 * Nettoie le fichier de contexte (après annulation ou consommation).
 */
export function clearLastContext(): void {
  if (existsSync(LAST_CONTEXT_PATH)) {
    try { unlinkSync(LAST_CONTEXT_PATH) } catch { /* ignoré */ }
  }
}

/**
 * Point d'entrée principal. Déclenche la génération des parades :
 *   1. Anti-loop check
 *   2. Collecte le contexte (métadonnées, tâches, notifs, logbook)
 *   3. Lit les règles YAML → détermine la phase
 *   4. Construit le prompt complet
 *   5. Lance le spinner + polling
 *   6. Forke spawn-agent.js en arrière-plan
 *
 * Retourne immédiatement (non-bloquant). Le polling gère la suite.
 */
export function triggerParades(context: ParadeContext, onCommand?: (cmd: string) => void): void {
  if (_paradesRunning) return
  _paradesRunning = true

  // Nettoyer les suggestions précédentes
  clearSuggestions()

  // Phase 1 : collecte du contexte
  const metadata = collectMetadata(context)

  // Phase 2 : détermination de la phase d'évolution
  const { phase, phaseNumber } = determinePhase(metadata)

  // Phase 3 : construction du prompt pour l'agent
  const prompt = buildAgentPrompt(phase, metadata, context)

  // Phase 4 : écriture du prompt dans un fichier temporaire
  try {
    const dir = join(PARADES_CONTEXT_PATH, '..')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(PARADES_CONTEXT_PATH, prompt, 'utf-8')
  } catch {
    // Si on ne peut pas écrire le contexte, abandonner
    _paradesRunning = false
    return
  }

  // Phase 5 : spinner
  startSpinner(`Génération des parades (Phase ${phaseNumber} — ${phase.label})...`)

  // Phase 6 : spawn agent-parades en arrière-plan
  if (!existsSync(AGENT_PATH)) {
    stopSpinner()
    _paradesRunning = false
    cleanupContextFile()
    return
  }

  // Utiliser exec (non-bloquant) pour lancer spawn-agent.js.
  // L'instruction passée est courte : l'agent lit le fichier de contexte.
  // Chemin du fichier sans guillemets pour éviter de casser le quoting shell du exec
  const contextPath = PARADES_CONTEXT_PATH
  const instruction =
    `Génère les parades. Utilise run_terminal_command pour lire ce fichier: ${contextPath} (contexte JSON complet avec phase, métadonnées et instructions). Écris le résultat dans telecom/suggestions.json au format JSON requis (menu + items).`

  _paradesChild = exec(
    `node "${AGENT_PATH}" agent-parades "${instruction}"`,
    {
      cwd: process.cwd(),
      timeout: 120_000, // 2 min max
      maxBuffer: 5 * 1024 * 1024,
      windowsHide: true,
    },
    (_error) => {
      // Le processus est fini — que ce soit succès ou échec.
      // Le polling se charge de détecter suggestions.json.
      // On ne fait rien ici sauf nettoyer la ref.
      _paradesChild = null
      // Si le polling a déjà trouvé le fichier, _paradesRunning est déjà false.
      // Sinon, on le remet à false après un dernier check.
    },
  )

  // Phase 7 : polling + annulation
  startPolling(onCommand)
}

// ── Collecte du contexte ─────────────────────────────────

/**
 * Rassemble les métadonnées disponibles (projets, tâches, notifications,
 * logbook, parades précédentes, stats d'apprentissage).
 * Toutes les données sont optionnelles — si une source est indisponible,
 * elle est simplement omise du résultat (non-bloquant).
 */
function collectMetadata(context: ParadeContext): Record<string, unknown> {
  const metadata: Record<string, unknown> = {}

  try {
    // Projets
    const workspacesDir = join(process.cwd(), 'workspaces')
    if (existsSync(workspacesDir)) {
      const dirs = readdirSync(workspacesDir).filter((d) => {
        try { return existsSync(join(workspacesDir, d, '.workspace')) }
        catch { return false }
      })
      metadata.projects = { count: dirs.length, list: dirs }
    } else {
      metadata.projects = { count: 0, list: [] }
    }

    // Tâches du projet courant
    if (context.projectName) {
      const tasksPath = join(
        process.cwd(),
        'workspaces',
        context.projectName,
        '.tasks.json',
      )
      if (existsSync(tasksPath)) {
        try {
          const tasksRaw = readFileSync(tasksPath, 'utf-8').trim()
          if (tasksRaw) {
            const tasksData = JSON.parse(tasksRaw)
            metadata.tasks = tasksData
          }
        } catch { /* fichier corrompu — on passe */ }
      }
    }

    // Notifications récentes
    const notifyPath = join(process.cwd(), 'telecom', 'notifications.json')
    if (existsSync(notifyPath)) {
      try {
        const raw = readFileSync(notifyPath, 'utf-8').trim()
        if (raw) {
          const notifs = JSON.parse(raw)
          metadata.notifications = {
            count: Array.isArray(notifs) ? notifs.length : 0,
            recent: Array.isArray(notifs) ? notifs.slice(-5) : [],
          }
        }
      } catch { /* fichier corrompu */ }
    }

    // Logbook (3 dernières entrées)
    const logbookPath = join(process.cwd(), 'telecom', 'agent-logbook.md')
    if (existsSync(logbookPath)) {
      try {
        const content = readFileSync(logbookPath, 'utf-8').trim()
        const entries = content.split('\n## ').filter(Boolean).slice(-3)
        metadata.logbook = entries.map((e: string) => ({
          title: e.split('\n')[0].slice(0, 100),
        }))
      } catch { /* fichier inaccessible */ }
    }

    // Parades déjà générées (via suivi.json)
    const suiviPath = join(
      process.cwd(),
      'telecom',
      'agents',
      'agent-parades',
      'suivi.json',
    )
    if (existsSync(suiviPath)) {
      try {
        const raw = readFileSync(suiviPath, 'utf-8')
        const suivi = JSON.parse(raw)
        const entries = suivi.entries ?? []
        metadata.evolution = {
            paradesGenerated: entries.length,
          }
          // Passer les 10 dernières entrées pour anti-répétition
          metadata.recentParades = entries.slice(-10).map(
          (e: { parades?: Array<{ command: string; status: string }>; action?: string }) => ({
            action: e.action ?? '',
            parades: (e.parades ?? []).map(
              (p: { command: string; status: string }) => ({
                command: p.command,
                status: p.status,
              }),
            ),
          }),
        )
      } catch {
        metadata.evolution = { paradesGenerated: 0 }
      }
    } else {
      metadata.evolution = { paradesGenerated: 0 }
    }

    // Stats d'apprentissage (Phase 3)
    const statsPath = join(
      process.cwd(),
      'telecom',
      'agents',
      'agent-parades',
      'stats.json',
    )
    if (existsSync(statsPath)) {
      try {
        const raw = readFileSync(statsPath, 'utf-8').trim()
        if (raw) {
          metadata.learningStats = JSON.parse(raw)
        }
      } catch { /* fichier corrompu */ }
    }
  } catch {
    // Silencieux — le métadata est un bonus, pas bloquant
  }

  return metadata
}

// ── Phases ───────────────────────────────────────────────

interface Condition {
  key: string
  operator: string
  value: unknown
}

interface PhaseRule {
  phase: number
  label: string
  description: string
  conditions: Condition[]
  instructions: string
  maxParades: number
}

interface PhaseConfig {
  phases: PhaseRule[]
  defaultPhase: number
  contextKeys: {
    required: string[]
    optional: string[]
  }
}

/**
 * Charge les règles de phase depuis data/rules/parades-phases.yaml.
 * Retourne une config de fallback si le fichier est introuvable ou invalide.
 */
function loadPhaseRules(): PhaseConfig {
  if (!existsSync(RULES_PATH)) {
    return {
      phases: [
        {
          phase: 1,
          label: 'Métadonnées',
          description: 'Phase par défaut (fichier YAML introuvable)',
          conditions: [],
          instructions: 'Métadonnées uniquement. Baser les parades sur les tâches, notifications et logbook.',
          maxParades: 4,
        },
      ],
      defaultPhase: 1,
      contextKeys: { required: ['projects.count'], optional: [] },
    }
  }

  try {
    const raw = readFileSync(RULES_PATH, 'utf-8')
    return loadYaml(raw) as PhaseConfig
  } catch {
    return {
      phases: [
        {
          phase: 1,
          label: 'Métadonnées',
          description: 'Fallback (YAML invalide)',
          conditions: [],
          instructions: 'Métadonnées uniquement.',
          maxParades: 4,
        },
      ],
      defaultPhase: 1,
      contextKeys: { required: ['projects.count'], optional: [] },
    }
  }
}

/**
 * Évalue une condition simple sur le contexte.
 * Supporte les opérateurs : ==, >, >=, <, <=, !=, exists
 * La notation pointée (ex: projects.count) est résolue récursivement.
 */
function evaluateCondition(
  key: string,
  operator: string,
  value: unknown,
  metadata: Record<string, unknown>,
): boolean {
  // Résolution de la notation pointée
  const parts = key.split('.')
  let current: unknown = metadata

  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      current = undefined
      break
    }
    current = (current as Record<string, unknown>)[part]
  }

  // Si la valeur n'existe pas dans le contexte
  if (current === undefined || current === null) {
    if (operator === '==') {
      // undefined == 0, null == 0 → true (valeur inexistante = 0)
      return value === 0 || value === null || value === undefined || value === ''
    }
    if (operator === '!=') {
      return value !== null && value !== undefined
    }
    if (operator === 'exists') return false
    return false
  }

  switch (operator) {
    case '==':
      return current == value
    case '>':
      return (current as number) > (value as number)
    case '>=':
      return (current as number) >= (value as number)
    case '<':
      return (current as number) < (value as number)
    case '<=':
      return (current as number) <= (value as number)
    case '!=':
      return current != value
    case 'exists':
      return true
    default:
      return false
  }
}

/**
 * Détermine la phase d'évolution en testant les conditions dans l'ordre.
 * Retourne la première phase dont TOUTES les conditions sont remplies.
 */
function determinePhase(
  metadata: Record<string, unknown>,
): { phase: PhaseRule; phaseNumber: number } {
  const config = loadPhaseRules()

  for (const phase of config.phases) {
    // Phase sans conditions → toujours éligible (dernier recours)
    if (phase.conditions.length === 0) {
      return { phase, phaseNumber: phase.phase }
    }

    const allMatch = phase.conditions.every((cond) =>
      evaluateCondition(cond.key, cond.operator, cond.value, metadata),
    )

    if (allMatch) {
      return { phase, phaseNumber: phase.phase }
    }
  }

  // Fallback : phase par défaut
  const defaultPhase = config.phases.find(
    (p) => p.phase === config.defaultPhase,
  )
  if (defaultPhase) {
    return { phase: defaultPhase, phaseNumber: config.defaultPhase }
  }

  // Dernier recours : Phase 1
  return {
    phase: {
      phase: 1,
      label: 'Métadonnées',
      description: 'Fallback ultime',
      conditions: [],
      instructions: 'Métadonnées uniquement.',
      maxParades: 4,
    },
    phaseNumber: 1,
  }
}

// ── Construction du prompt ──────────────────────────────

/**
 * Construit le prompt final pour l'agent-parades.
 * Combine :
 *   1. Prompt système (fixe)
 *   2. Règles de phase (lues du YAML)
 *   3. Contexte JSON (dynamique — métadonnées, tâches, etc.)
 */
function buildAgentPrompt(
  phase: PhaseRule,
  metadata: Record<string, unknown>,
  context: ParadeContext,
): string {
  // Nettoyer les données sensibles du contexte (exclure les longs contenus)
  const cleanMetadata: Record<string, unknown> = {
    evolutionPhase: phase.phase,
    phaseLabel: phase.label,
    projectsCount: (metadata.projects as { count?: number })?.count ?? 0,
    projectName: context.projectName ?? null,
    action: context.action,
    demande: context.demande ?? null,
  }

  // Ajouter les parades récentes si disponibles (pour anti-répétition)
  if (metadata.recentParades) {
    cleanMetadata.recentParades = metadata.recentParades
  }
  if (metadata.evolution) {
    cleanMetadata.evolution = metadata.evolution
  }
  if (metadata.tasks) {
    cleanMetadata.tasks = metadata.tasks
  }
  if (metadata.notifications) {
    cleanMetadata.notifications = metadata.notifications
  }
  if (metadata.logbook) {
    cleanMetadata.logbook = metadata.logbook
  }
  if (metadata.learningStats) {
    cleanMetadata.learningStats = metadata.learningStats
  }

  const contextJson = JSON.stringify(cleanMetadata, null, 2)

  const parts: string[] = [
    `Tu es l'Agent Parades du système Minautor Agents.`,
    ``,
    `## Mission`,
    `Analyse le contexte actuel du projet et génère des propositions`,
    `d'action intelligentes pour l'utilisateur. Tu remplaces l'ancien`,
    `système de suggestions statiques.`,
    ``,
    `## Règles de phase (Phase ${phase.phase} — ${phase.label})`,
    phase.instructions,
    ``,
    `## Format de sortie`,
    ``,
    `Tu dois écrire ta sortie dans telecom/suggestions.json au format suivant :`,
    ``,
    `{`,
    `  "menu": "Actions rapides",`,
    `  "items": [`,
    `    {`,
    `      "label": "Titre court de la proposition",`,
    `      "description": "Explication détaillée de pourquoi c'est pertinent",`,
    `      "command": "!project tasks mon-projet"`,
    `    }`,
    `  ]`,
    `}`,
    ``,
    `Le format doit être un JSON valide écrit avec run_terminal_command.`,
    `Exemple: node -e "require('fs').writeFileSync('telecom/suggestions.json', JSON.stringify({ menu: 'Actions rapides', items: [...] }), 'utf-8')"`,
    ``,
    `## Règles`,
    `1. ${phase.maxParades} propositions maximum. Qualité > quantité.`,
    `2. Ne JAMAIS exécuter les commandes toi-même.`,
    `3. Varier les propositions à chaque appel (ne pas répéter).`,
    `4. Consulter la fiche de suivi dans telecom/agents/agent-parades/suivi.json`,
    `   avec cat ou node pour éviter de proposer des parades déjà vues.`,
    `5. Ne rien proposer de destructeur.`,
    `6. Si le projet est vide ou nouveau, proposer des actions de démarrage.`,
    ``,
    `## Contexte JSON reçu`,
    contextJson,
    ``,
    `## Random seed (anti-répétition)`,
    `${Date.now()}`,
  ]

  return parts.join('\n')
}

// ── Spinner ──────────────────────────────────────────────

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

function startSpinner(text: string): void {
  let i = 0
  process.stdout.write(`\n${YELLOW}${SPINNER_FRAMES[0]}${RESET} ${text}`)
  _spinnerTimer = setInterval(() => {
    i = (i + 1) % SPINNER_FRAMES.length
    process.stdout.write(`\r${YELLOW}${SPINNER_FRAMES[i]}${RESET} ${text}`)
  }, 100)
}

function stopSpinner(): void {
  if (_spinnerTimer) {
    clearInterval(_spinnerTimer)
    _spinnerTimer = null
  }
  process.stdout.write('\r\x1b[K')
}

// ── Polling + annulation ────────────────────────────────

const POLLING_INTERVAL_MS = 500

function startPolling(onCommand?: (cmd: string) => void): void {
  let stopped = false

  // Handler d'annulation (appui clavier)
  const cancelHandler = (_str: string, key: { name: string; sequence?: string }) => {
    if (stopped) return
    // Ignorer les touches de modification seules (shift, ctrl, etc.)
    if (!key.name || key.name === 'undefined') return
    // Détecter l'appui : n'importe quelle touche sauf échappement
    // (l'échappement est déjà géré globalement par cancelled flag)
    stopped = true

    if (stdin.isTTY && stdin.listeners('keypress').includes(cancelHandler)) {
      stdin.removeListener('keypress', cancelHandler)
    }

    stopSpinner()
    cleanup()

    process.stdout.write(
      `\r${GRAY}⏹ Génération des parades annulée.${RESET}\n\n`,
    )
  }

  if (stdin.isTTY) {
    stdin.on('keypress', cancelHandler)
  }

  // Timeout de sécurité : si jamais le fichier n'arrive pas, nettoyer après 2min
  const safetyTimeout = setTimeout(() => {
    if (stopped) return
    stopped = true
    if (stdin.isTTY && stdin.listeners('keypress').includes(cancelHandler)) {
      stdin.removeListener('keypress', cancelHandler)
    }
    stopSpinner()
    cleanup()
  }, 120_000)

  _pollingTimer = setInterval(() => {
    if (stopped) return

    try {
      if (existsSync(SUGGESTIONS_PATH)) {
        const raw = readFileSync(SUGGESTIONS_PATH, 'utf-8').trim()
        if (raw && raw !== '{}') {
          try {
            const parsed = JSON.parse(raw)
            if (parsed && parsed.menu && Array.isArray(parsed.items) && parsed.items.length > 0) {
              // Fichier trouvé et valide → arrêter polling
              stopped = true
              clearTimeout(safetyTimeout)

              if (_pollingTimer) {
                clearInterval(_pollingTimer)
                _pollingTimer = null
              }
              if (stdin.isTTY && stdin.listeners('keypress').includes(cancelHandler)) {
                stdin.removeListener('keypress', cancelHandler)
              }

              stopSpinner()
              cleanup()

              // Afficher le menu interactif et dispatcher la commande choisie
              showSuggestionMenuRaw(getCurrentProject())
                .then((cmd) => {
                  if (cmd && onCommand) {
                    onCommand(cmd)
                  }
                })
                .catch(() => {
                  /* non-bloquant */
                })
            }
          } catch {
            // JSON pas encore valide — attendre le prochain cycle
          }
        }
      }
    } catch {
      // Fichier peut être en cours d'écriture — réessayer
    }
  }, POLLING_INTERVAL_MS)

  function cleanup(): void {
    _paradesRunning = false
    cleanupContextFile()
    // Tuer le child si encore en vie
    if (_paradesChild && !_paradesChild.killed) {
      try { _paradesChild.kill('SIGTERM') } catch { /* déjà mort */ }
      _paradesChild = null
    }
  }
}

// ── Nettoyage du fichier de contexte ────────────────────

function cleanupContextFile(): void {
  try {
    if (existsSync(PARADES_CONTEXT_PATH)) unlinkSync(PARADES_CONTEXT_PATH)
  } catch { /* ignoré */ }
}
