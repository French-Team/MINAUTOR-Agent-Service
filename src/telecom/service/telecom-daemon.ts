#!/usr/bin/env node
/**
 * telecom-daemon.ts — Service fond qui surveille telecom/intercom/ et route les messages
 *
 * Usage:
 *   node dist/telecom/service/telecom-daemon.js          # Démarre le daemon (premier plan)
 *   node dist/telecom/service/telecom-daemon.js &         # Démarre en arrière-plan
 *   node dist/telecom/service/telecom-daemon.js --once    # Traite une fois et quitte
 *
 * Le daemon:
 *   1. Surveille telecom/intercom/ toutes les 2 secondes
 *   2. Trouve les messages en statut "pending"
 *   3. Les route vers le dossier telecom/routed/
 *   4. Met à jour le statut à "read"
 *   5. Émet une notification si le message est pour agent-telecom
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, unlinkSync, statSync, rmdirSync, watch } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fork, exec, spawn, execSync } from 'node:child_process'
import { pushNotification, type NotificationLevel } from '../../notify.js'
import { writeSuggestions, parseSuggestionsFromOutput, sortSuggestionsByFrequency } from '../../cli-suggestions.js'
import { getFeuRougeClient } from '../../feurouge/feurouge-client.js'
import { getAgentPermission } from '../../feurouge/permissions.js'
import { matchAndExecute, executeScript } from '../../script-runner.js'
import { fuzzyMatch, countRejectedDemandes } from '../../fuzzy-matcher.js'
import { readTaskBoard } from '../../project/task-board.js'
import { renderSuggestionTemplates, type TemplateContext } from '../../suggestion-templates.js'

const cwd = process.cwd()
const INTERCOM_DIR = join(cwd, 'telecom', 'intercom')
const ROUTED_DIR = join(cwd, 'telecom', 'routed')
const MEMOIRE_DIR = join(cwd, 'telecom', 'memoire-vive')
const POLL_INTERVAL = 1000 // 1 seconde
const WATCH_DEBOUNCE_MS = 500 // Ignorer les doublons fs.watch sous 500ms
const PID_FILE = join(cwd, 'telecom', 'daemon.pid')
const WATCHER_PID_FILE = join(cwd, 'telecom', 'watcher.pid')
const VIEWER_PID_FILE = join(cwd, 'telecom', 'notification-viewer.pid')
const STATUS_FILE = join(cwd, 'telecom', 'daemon.status.json')
const RESET_FILE = join(cwd, 'telecom', 'daemon.reset')
const TRIGGER_FILE = join(cwd, 'telecom', 'daemon.trigger')
const WATCHER_SHUTDOWN_FILE = join(cwd, 'telecom', 'watcher.shutdown')
const VIEWER_SHUTDOWN_FILE = join(cwd, 'telecom', 'notification-viewer.shutdown')
const MAX_ROUTE_HISTORY = 10
const CLEANUP_INTERVAL = 300 // Nettoyer la mémoire vive toutes les 300 itérations (~10 min)
const MEMOIRE_TTL_MS = 60 * 60 * 1000 // 1 heure

interface IntercomMessage {
  id: string
  from: string
  to: string
  type: string
  subject: string
  payload: Record<string, unknown>
  timestamp: string
  status: 'pending' | 'read' | 'processed' | 'archived'
}

const MAX_FILES = 3

function ensureDirs(): void {
  for (const dir of [INTERCOM_DIR, ROUTED_DIR]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }
}

/**
 * Nettoie l'état pré-existant d'une session antérieure du daemon.
 * Exécuté au démarrage pour garantir un état vierge :
 *   - vide telecom/intercom/ et telecom/routed/
 *   - supprime telecom/daemon.status.json, watcher.pid, trigger, reset
 *   - supprime telecom/notifications.json
 *   - vide data/watcher/telecom/
 */
function cleanupOldState(): void {
  const dirsToClean: string[] = [INTERCOM_DIR, ROUTED_DIR]
  const filesToDelete: string[] = [
    STATUS_FILE,
    WATCHER_PID_FILE,
    VIEWER_PID_FILE,
    TRIGGER_FILE,
    RESET_FILE,
    WATCHER_SHUTDOWN_FILE,
    VIEWER_SHUTDOWN_FILE,
    join(cwd, 'telecom', 'notifications.json'),
    join(cwd, 'telecom', 'agent-logbook.md'),
  ]

  // Nettoyer les fichiers JSON dans les dossiers
  for (const dir of dirsToClean) {
    if (!existsSync(dir)) continue
    const files = readdirSync(dir).filter(f => f.endsWith('.json'))
    for (const f of files) {
      try { unlinkSync(join(dir, f)) } catch { /* ignoré */ }
    }
    console.log(`  [Nettoyage] ${dir}: ${files.length} fichier(s) supprimé(s)`)
  }    // Nettoyer le PID du visionneur de notifications s'il existe
    try {
      if (existsSync(VIEWER_PID_FILE)) {
        const raw = readFileSync(VIEWER_PID_FILE, 'utf-8').trim()
        const pid = parseInt(raw, 10)
        if (!isNaN(pid)) {
          try { process.kill(pid, 'SIGTERM') } catch { /* déjà mort */ }
        }
        unlinkSync(VIEWER_PID_FILE)
        console.log(`  [Nettoyage] notification-viewer.pid supprimé (PID ${pid})`)
      }
    } catch { /* ignoré */ }

    // Nettoyer les fichiers de statut/signal
    for (const file of filesToDelete) {
    if (!existsSync(file)) continue
    try {
      unlinkSync(file)
      const name = file.split(/[/\\]/).pop() ?? file
      console.log(`  [Nettoyage] ${name} supprimé`)
    } catch { /* ignoré */ }
  }

  // Nettoyer les artefacts dynamiques dans telecom/agents/*/
  // (fichiers erreur-*, livrable-* des sessions précédentes)
  const agentsWorkspaceDir = join(cwd, 'telecom', 'agents')
  if (existsSync(agentsWorkspaceDir)) {
    const agentDirs = readdirSync(agentsWorkspaceDir).filter(d => {
      try { return statSync(join(agentsWorkspaceDir, d)).isDirectory() } catch { return false }
    })
    let totalDeleted = 0
    for (const agentId of agentDirs) {
      const agentPath = join(agentsWorkspaceDir, agentId)
      try {
        const files = readdirSync(agentPath).filter(f => f.startsWith('livrable-') || f.startsWith('erreur-'))
        for (const f of files) {
          try { unlinkSync(join(agentPath, f)); totalDeleted++ } catch { /* ignoré */ }
        }
      } catch { /* ignoré */ }
    }
    if (totalDeleted > 0) {
      console.log(`  [Nettoyage] telecom/agents/: ${totalDeleted} fichier(s) artefact(s) supprimé(s)`)
    }
  }

  // Nettoyer data/watcher/telecom/ s'il existe
  const watcherDir = join(cwd, 'data', 'watcher', 'telecom')
  if (existsSync(watcherDir)) {
    const files = readdirSync(watcherDir).filter(f => f.endsWith('.json'))
    for (const f of files) {
      try { unlinkSync(join(watcherDir, f)) } catch { /* ignoré */ }
    }
    console.log(`  [Nettoyage] ${watcherDir}: ${files.length} fichier(s) supprimé(s)`)
  }

  // Réinitialiser les compteurs en mémoire
  TOTAL_ROUTED = 0
  TOTAL_SPAWNS = 0
  TOTAL_BLOCKS = 0
  ROUTE_HISTORY.length = 0
  BLOCKED_COUNTS.clear()
  resetSpawnHistory()

  console.log('  [Nettoyage] État réinitialisé — démarrage vierge')

  // Purger les logs de scripts périmés
  purgeScriptLogs()
}

/**
 * Nettoie les fichiers dans telecom/memoire-vive/ plus vieux que 1 heure.
 * Supprime aussi les dossiers d'agent devenus vides.
 */
function cleanMemoireVive(): void {
  if (!existsSync(MEMOIRE_DIR)) return

  const agentDirs = readdirSync(MEMOIRE_DIR)
  const now = Date.now()

  for (const agentId of agentDirs) {
    const agentDir = join(MEMOIRE_DIR, agentId)
    try {
      const files = readdirSync(agentDir).filter(f => f !== '.gitkeep' && f !== '.gitignore')
      let deleted = 0

      for (const file of files) {
        const filePath = join(agentDir, file)
        try {
          const stat = statSync(filePath)
          if (stat.isFile() && now - stat.mtimeMs > MEMOIRE_TTL_MS) {
            unlinkSync(filePath)
            deleted++
          }
        } catch { /* fichier supprimé entre-temps */ }
      }

      // Supprimer le dossier s'il est vide (après nettoyage)
      const remaining = readdirSync(agentDir).filter(f => f !== '.gitkeep' && f !== '.gitignore')
      if (remaining.length === 0) {
        try { rmdirSync(agentDir) } catch { /* dossier non vide ou verrouillé */ }
      }

      if (deleted > 0) {
        const ts = new Date().toISOString().slice(11, 19)
        console.log(`[${ts}] Nettoyage mémoire vive: ${deleted} fichier(s) purgé(s) pour ${agentId}`)
      }
    } catch { /* dossier supprimé entre-temps */ }
  }
}

/**
 * Purge les logs run-*.log dans telecom/scripts/ en conservant
 * uniquement les MAX_SCRIPT_LOGS fichiers les plus récents.
 * Se base sur la date de modification du fichier pour l'ordre chronologique.
 */
function purgeScriptLogs(): void {
  const logDir = join(cwd, 'telecom', 'scripts')
  if (!existsSync(logDir)) return

  const files = readdirSync(logDir)
    .filter(f => f.startsWith('run-') && f.endsWith('.log'))
    .map(f => {
      try {
        return { name: f, mtime: statSync(join(logDir, f)).mtimeMs }
      } catch { return null }
    })
    .filter((f): f is { name: string; mtime: number } => f !== null)
    .sort((a, b) => a.mtime - b.mtime) // Plus ancien en premier

  if (files.length <= MAX_SCRIPT_LOGS) return

  const toDelete = files.slice(0, files.length - MAX_SCRIPT_LOGS)
  for (const f of toDelete) {
    try { unlinkSync(join(logDir, f.name)) } catch { /* ignoré */ }
  }

  const ts = new Date().toISOString().slice(11, 19)
  console.log(`[${ts}] Purge: ${toDelete.length} log(s) supprimé(s) dans telecom/scripts/ (max ${MAX_SCRIPT_LOGS})`)
}

/**
 * Purge les fichiers JSON dans data/watcher/telecom/ en conservant
 * uniquement les MAX_WATCHER_FILES fichiers les plus récents (par mtime).
 */
function purgeWatcherData(): void {
  const watcherDir = join(cwd, 'data', 'watcher', 'telecom')
  if (!existsSync(watcherDir)) return

  const files = readdirSync(watcherDir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        return { name: f, mtime: statSync(join(watcherDir, f)).mtimeMs }
      } catch { return null }
    })
    .filter((f): f is { name: string; mtime: number } => f !== null)
    .sort((a, b) => a.mtime - b.mtime) // Plus ancien en premier

  if (files.length <= MAX_WATCHER_FILES) return

  const toDelete = files.slice(0, files.length - MAX_WATCHER_FILES)
  for (const f of toDelete) {
    try { unlinkSync(join(watcherDir, f.name)) } catch { /* ignoré */ }
  }

  const ts = new Date().toISOString().slice(11, 19)
  console.log(`[${ts}] Purge: ${toDelete.length} fichier(s) supprimé(s) dans data/watcher/telecom/ (max ${MAX_WATCHER_FILES})`)
}

/** Garder max 3 fichiers par dossier, supprimer les plus anciens */
function rotateDir(dir: string): void {
  if (!existsSync(dir)) return
  const files = readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .sort()
  while (files.length > MAX_FILES) {
    const oldest = files.shift()!
    unlinkSync(join(dir, oldest))
  }
}

async function processMessages(): Promise<number> {
  ensureDirs()

  if (!existsSync(INTERCOM_DIR)) return 0

  const files = readdirSync(INTERCOM_DIR).filter(f => f.endsWith('.json'))
  let processed = 0

  for (const f of files) {
    const path = join(INTERCOM_DIR, f)

    try {
      const content = readFileSync(path, 'utf-8')
      const msg = JSON.parse(content) as IntercomMessage

      // Ne traiter que les messages en attente
      if (msg.status !== 'pending') continue

      // Lire le fichier à nouveau (vérifier atomicité)
      const freshContent = readFileSync(path, 'utf-8')
      const freshMsg = JSON.parse(freshContent) as IntercomMessage
      if (freshMsg.status !== 'pending') continue

      // Router le message
      msg.status = 'read'

      // Écrire la version mise à jour
      writeFileSync(path, JSON.stringify(msg, null, 2), 'utf-8')

      // Copier vers le dossier routé
      const routedPath = join(ROUTED_DIR, `${msg.id}.json`)
      writeFileSync(routedPath, JSON.stringify(msg, null, 2), 'utf-8')

      // Logger
      const ts = new Date().toISOString().slice(11, 19)
      console.log(`[${ts}] Routé: ${msg.from} → ${msg.to} [${msg.subject}]`)

      // Mettre à jour le statut
      TOTAL_ROUTED++
      ROUTE_HISTORY.push({ from: msg.from, to: msg.to, subject: msg.subject, at: new Date().toISOString() })
      if (ROUTE_HISTORY.length > MAX_ROUTE_HISTORY) ROUTE_HISTORY.shift()
      writeStatus()

      // Notifier l'utilisateur dans le CLI pour tout message routé
      const notifLevel: NotificationLevel =
        msg.type === 'alert' ? 'urgent'
        : msg.type === 'response' ? 'conclusion'
        : msg.type === 'signal' ? 'info'
        : 'info'
      const emoji = notifLevel === 'conclusion' ? '✅' : notifLevel === 'urgent' ? '⚠️' : '↪'
      const demande = typeof msg.payload.demande === 'string'
        ? msg.payload.demande.slice(0, 80)
        : ''
      const payloadHint = demande ? `: ${demande}` : ''
      const friendlyMessage = `${emoji} ${msg.from} → ${msg.to} [${msg.subject}]${payloadHint}`
      pushNotification(
        'intercom',
        friendlyMessage,
        notifLevel
      )

      // Priorité 1 : Essayer le script-runner (pattern matching → script pré-écrit)
      // Si un script match, on l'exécute directement sans spawner d'agent LLM.
      // C'est plus rapide, plus fiable et moins coûteux.
      const scriptResult = await tryScriptRunner(msg)
      if (!scriptResult) {
        // Priorité 2 : Pas de script trouvé → fallback sur l'agent LLM
        spawnAgent(msg.to, msg)
      }

      processed++
    } catch (err) {
      // Fichier malformé ou en cours d'écriture — on passe
      const ts = new Date().toISOString().slice(11, 19)
      console.error(`[${ts}] ERR: ${f} — ${(err as Error).message}`)
    }
  }

  // Rotation : garder max 3 fichiers dans chaque dossier
  rotateDir(INTERCOM_DIR)
  rotateDir(ROUTED_DIR)

  return processed
}

/**
 * Liste les fichiers seed disponibles dans le dossier personnel d'un agent
 * et retourne un bloc de contexte à inclure dans l'instruction.
 */
function buildWorkspaceSeedContext(agentId: string): string {
  const workspaceDir = join(cwd, 'telecom', 'agents', agentId)
  if (!existsSync(workspaceDir)) return ''

  const files = readdirSync(workspaceDir).filter(f => f !== '.gitkeep' && f !== '.gitignore')
  if (files.length === 0) return ''

  const parts: string[] = ['', 'Ressources disponibles dans ton dossier de travail :']

  // Lire le README.md si présent (juste le titre et la mission)
  if (files.includes('README.md')) {
    try {
      const readme = readFileSync(join(workspaceDir, 'README.md'), 'utf-8').trim()
      const lines = readme.split('\n').filter(l => l.startsWith('#') || l.startsWith('##')).slice(0, 2)
      if (lines.length > 0) {
        parts.push(`  README : ${lines.join(' — ').replace(/^#+\s*/g, '').trim()}`)
      }
    } catch { /* ignoré */ }
  }

  // Lister les autres fichiers (templates, logs, etc.)
  const autres = files.filter(f => f !== 'README.md')
  if (autres.length > 0) {
    parts.push(`  Fichiers : ${autres.join(', ')}`)
  }

  parts.push('Consulte ces fichiers avec run_terminal_command avant de commencer.')
  return parts.join('\n')
}

/** Instructions specifiques selon l'agent cible */
function buildInstruction(agentId: string, msg: IntercomMessage): string {
  const demande = typeof msg.payload.demande === 'string'
    ? msg.payload.demande
    : JSON.stringify(msg.payload)

  const base = [
    `Nouveau message intercom de ${msg.from}.`,
    `Subject: ${msg.subject}`,
    `Demande: ${demande}`,
    `Fichier: telecom/routed/${msg.id}.json`,
  ]

  const seedContext = buildWorkspaceSeedContext(agentId)

  if (agentId === 'agent-telecom') {
    return base.concat([
      '',
      `1. Lis le message dans telecom/routed/${msg.id}.json`,
      `2. Analyse la demande — le regex strict ET le fuzzy matching ont echoue`,
      `3. Consulte telecom/logs/fuzzy-matches.log pour voir les echecs recents similaires`,
      `4. Consulte data/scripts/registry.yaml pour comprendre les patterns existants`,
      `5. PROPOSE des ameliorations :`,
      `   a. Ajouter des variantes de patterns dans registry.yaml`,
      `   b. Ajuster les patterns existants trop stricts`,
      `   c. Ajouter des synonymes et mots-cles`,
      `6. Tu n'EXECUTES PAS la demande toi-meme — tu proposes des ameliorations`,
      `7. Utilise run_terminal_command pour modifier les fichiers si necessaire`,
      seedContext,
    ]).join('\n')
  }

  if (agentId === 'orchestrateur') {
    return base.concat([
      '',
      `1. Lis le message dans telecom/routed/${msg.id}.json`,
      '',
      '── PHASE 1 : LECTURE DU TABLEAU DES TACHES ──',
      '2. Determine le projet concerne :',
      `   a. Si msg.payload contient "project" : utilise ce nom de projet`,
      `   b. Sinon, cherche dans la demande si un nom de projet est mentionne`,
      `   c. En dernier recours, utilise le tableau global (passe la commande sans nom de projet)`,
      '3. Consulte le tableau des taches du projet :',
      '   node dist/project/task-board-cli.js summary <project>',
      '   Cela te donne la liste des domaines, les taches en cours et les prochaines disponibles.',
      '',
      '── PHASE 2 : ANALYSE DE LA DEMANDE ──',
      '4. Consulte le registre de mots-cles (keyword-registry.yaml)',
      '   pour determiner a quel domaine appartient la demande (backend, frontend, docs, infra, ...)',
      '   et quel agent specialise est le plus adapte.',
      '5. Verifie si le domaine est disponible :',
      '   node dist/project/task-board-cli.js can-assign <project> <domaine>',
      `   - Si la reponse contient "disponible" avec une tache : utilise son ID pour lancer la tache`,
      `   - Si la reponse contient "occupe" : tu ne peux pas deleguer dans ce domaine maintenant.`,
      `     Essaie un autre domaine parallelisable, ou reponds a l'utilisateur que la tache est en file d'attente.`,
      `   - SI LE DOMAINE EST OCCUPE : ne delegue PAS a un agent dans le meme domaine. Tu dois :`,
      `     a. Reporter la delegation a plus tard`,
      `     b. Ou, si un autre domaine est libre (frontend VS backend), deleguer sur cet autre domaine`,
      `     c. Tu peux paralleliser des taches de domaines DIFFERENTS, mais JAMAIS du meme domaine en meme temps.`,
      '',
      '── PHASE 3 : DELEGATION AVEC SUIVI ──',
      '6. Obtiens la prochaine tache disponible :',
      '   node dist/project/task-board-cli.js next <project> [domaine]',
      `   Cela retourne l'ID de la tache a executer.`,
      '7. Si la tache existe, demarre-la et assigne-la a l\'agent specialise :',
      '   node dist/project/task-board-cli.js start <project> <task-id> <agent-id>',
      `   (agent-id est le nom de l'agent specialise, ex: "agent-codeur-backend")`,
      '8. Ensuite, envoie la mission a l\'agent specialise :',
      `   a. Execute : node dist/telecom/service/intercom-manager.js send orchestrateur <agent-id> request delegation --payload '{"demande":"...","task_id":"<task-id>","project":"<project>"}'`,
      `      en incluant TOUJOURS le task_id et le project dans le payload.`,
      `   b. Le daemon telecom spawnera automatiquement l'agent cible.`,
      '',
      '── REGLES DE SEQUENCEMENT (IMPORTANT) ──',
      '- MEME DOMAINE = SEQUENTIEL : si une tache backend est en cours,',
      '  tu ne peux PAS deleguer une autre tache backend tant qu\'elle n\'est pas terminee.',
      '- DOMAINES DIFFERENTS = PARALLELE : tu PEUX deleguer frontend + backend en parallele,',
      '  tant qu\'ils sont dans des domaines differents.',
      '- DEPENDANCES : si une tache a des dependances (dependsOn dans le board),',
      '  elle n\'est disponible que quand ses dependances sont terminees.',
      '- UN AGENT = UNE TACHE : ne donne jamais toutes les missions a un meme agent.',
      '- FILE D\'ATTENTE : si le domaine est occupe, la tache reste en "todo" dans le board.',
      '  L\'utilisateur peut suivre l\'avancement avec !project tasks <project>.',
      '',
      '── QUAND UN AGENT RENVOIE UN RESULTAT ──',
      '9. Quand tu recois un resultat d\'un agent specialise (message intercom de retour) :',
      '   a. Lis le payload pour retrouver le task_id et le project',
      '   b. Marque la tache comme terminee :',
      '      node dist/project/task-board-cli.js done <project> <task-id>',
      '   c. Verifie s\'il y a une prochaine tache dans le meme domaine :',
      '      node dist/project/task-board-cli.js next <project> <domaine>',
      '   d. Si oui, repete la delegation (retour a la phase 3)',
      '   e. Si le board ne contient plus de taches "todo" :',
      '      - Tu peux creer la prochaine tache a partir de la demande utilisateur :',
      '        node dist/project/task-board-cli.js add <project> <domaine> "<titre de la tache>"',
      '      - Puis delegue normalement.',
      '',
      '── COMMANDES RAPIDES ──',
      '  Voir le resume complet  : node dist/project/task-board-cli.js summary <project>',
      '  Lire toutes les taches  : node dist/project/task-board-cli.js read <project> [domaine]',
      '  Verifier disponibilite   : node dist/project/task-board-cli.js can-assign <project> <domaine>',
      '  Prochaine tache         : node dist/project/task-board-cli.js next <project> [domaine]',
      '  Demarrer tache          : node dist/project/task-board-cli.js start <project> <task-id> <agent>',
      '  Terminer tache          : node dist/project/task-board-cli.js done <project> <task-id>',
      '  Ajouter une tache       : node dist/project/task-board-cli.js add <project> <domaine> "<titre>"',
      '  Taches en attente      : node dist/project/task-board-cli.js pending <project> [domaine]',
      '  Aide complete           : node dist/project/task-board-cli.js help',
      '',
      '5. Ne produit aucun livrable toi-meme — tu delegates toujours. Ton role est de COORDONNER.',
      '6. Si aucun mot-cle ne correspond : reponds "Tache non couverte — intervention humaine requise".',
      seedContext,
    ]).join('\n')
  }

  // Agent specialise quelconque
  return base.concat([
    '',
    `1. Lis le message dans telecom/routed/${msg.id}.json`,
    `2. Execute la tache demandee selon tes competences`,
    `3. Ecris le resultat dans telecom/papiers/${agentId}/ pour reference future`,
    `4. Envoie le resultat a l'orchestrateur pour suivi :`,
    `   a. Execute : node dist/telecom/service/intercom-manager.js send ${agentId} orchestrateur response result --payload '{"resultat":"...","demande_originale":"..."}'`,
    `      en remplacant le payload JSON par le resultat de ton travail`,
    `   b. Le daemon telecom spawnera automatiquement l'orchestrateur pour traiter le resultat`,
    `5. Si la tache depasse tes competences, renvoie un message a l'orchestrateur via intercom`,
    seedContext,
  ]).join('\n')
}

/**
 * Lit le statut d'une tâche depuis .tasks.json.
 */
function readTaskStatus(projectName: string, taskId: string): string | null {
  if (!projectName || !taskId) return null
  try {
    const tasksPath = join(cwd, 'workspaces', projectName, '.tasks.json')
    const raw = readFileSync(tasksPath, 'utf-8')
    const board = JSON.parse(raw) as { tasks: Array<{ id: string; status: string }> }
    const task = board.tasks.find(t => t.id === taskId)
    return task?.status ?? null
  } catch {
    return null
  }
}

/**
 * Extrait le premier ID de tâche (task-xxx) depuis la sortie d'un script.
 * Gère à la fois le format texte ("ID : task-xxx" ou "(task-xxx)")
 * et le format JSON ({"task":{"id":"task-xxx"}}).
 */
function extractTaskIdFromStdout(stdout: string): string | null {
  if (!stdout) return null

  // Essayer JSON d'abord
  try {
    const parsed = JSON.parse(stdout.trim())
    if (typeof parsed?.id === 'string' && /^task-/.test(parsed.id)) return parsed.id
    if (typeof parsed?.task?.id === 'string' && /^task-/.test(parsed.task.id)) return parsed.task.id
  } catch {
    // Pas du JSON, continuer
  }

  // Regex : capturer le premier task-xxx dans le texte
  const match = stdout.match(/task-[a-z0-9_-]+/)
  if (match) return match[0]

  return null
}

/**
 * Génère des suggestions de suivi contextuelles après un script exécuté avec succès.
 * Propose les 3-5 prochaines actions possibles selon le type de script.
 *
 * @param taskId - Si fourni, remplace les "..." par l'ID réel dans les suggestions
 * @param taskStatus - Si fourni, filtre les suggestions selon le statut réel de la tâche
 */
function getFollowUpSuggestions(
  scriptPath: string | undefined,
  projectName: string,
  demande: string,
  taskId?: string,
  taskStatus?: string,
  params?: Record<string, string>,
): string {
  if (!scriptPath) return ''

  const scriptName = scriptPath.split(/[/\\]/).pop()?.replace(/\.\w+$/, '') ?? ''
  const hasProject = !!projectName
  const proj = hasProject ? projectName : '<projet>'

  // ── Détection de projet vide ──
  let isProjectEmpty = false
  if (hasProject) {
    try {
      const board = readTaskBoard(projectName)
      isProjectEmpty = board.tasks.length === 0
    } catch {
      isProjectEmpty = true
    }
  }

  let lines: string[] = []
  lines.push('')
  lines.push('━ Suivi suggéré ━')

  // ── Suggestions d'initialisation pour projet vide ──
  if (isProjectEmpty) {
    lines.push(`  ── Initialisation ──`)
    lines.push(`  → définis les objectifs du projet "${projectName}" — Définir la vision`)
    lines.push(`  → choisis un langage / un framework pour ${projectName} — Choisir la stack`)
    lines.push(`  → crée un README initial pour ${projectName} — Documenter le projet`)
    lines.push(`  → liste les fonctionnalités principales de ${projectName} — Fonctionnalités`)
    lines.push(`  → configure l\'environnement de développement pour ${projectName} — Configuration`)
    lines.push('')
  }

  // ── Suggestions communes ──
  const commonSuggestions: string[] = []
  if (hasProject) {
    commonSuggestions.push(`  → continuer "${projectName}" — Voir la prochaine tâche`)
    commonSuggestions.push(`  → état "${projectName}" — Progression détaillée`)
    commonSuggestions.push(`  → menu "${projectName}" — Menu de navigation`)
  }

  // Suggestions spécifiques selon le script exécuté
  // Note : si le projet est vide, on saute ces suggestions (elles ne sont pas pertinentes
  // sans tâche existante — les suggestions d'initialisation sont déjà affichées ci-dessus)
  if (!isProjectEmpty) {
    // Contexte pour le rendu des templates
    const templateContext: TemplateContext = {
      taskId: taskId,
      project: projectName,
      area: params?.area,
      title: params?.title,
      name: params?.name,
    }

    // Essayer d'abord les templates externes (data/suggestions/templates.yaml)
    const templateLines = renderSuggestionTemplates(scriptName, templateContext)

    if (templateLines.length > 0) {
      // Templates trouvés → les utiliser directement
      lines.push(...templateLines)
    } else {
      // Aucun template pour ce script → fallback sur les cas spéciaux
      // qui nécessitent une logique conditionnelle ou des placeholders spécifiques
      switch (scriptName) {
        case 'decouverte': {
          // Détecter si un README a déjà été généré via la demande
          const hasReadme = demande.includes('readme')
          if (!hasReadme) {
            lines.push(`  ── Documentation ──`)
            lines.push(`  → génère un readme pour le projet ${proj} — Documenter l\'architecture`)
          }
          lines.push(`  ── Navigation ──`)
          lines.push(`  → continue sur le projet ${proj} — Voir la prochaine tâche`)
          break
        }

        case 'list':
          lines.push(`  ── Navigation ──`)
          if (hasProject) {
            lines.push(`  → menu "${projectName}" — Menu de navigation du projet`)
          }
          lines.push(`  ── Création ──`)
          lines.push('  → crée un projet "<nom>" — Nouveau projet')
          break

        case 'create':
          if (hasProject) {
            lines.push(`  ── Navigation ──`)
            lines.push(`  → menu "${projectName}" — Commencer à utiliser le projet`)
          }
          break

        case 'info':
          if (hasProject) {
            lines.push(`  ── Navigation ──`)
            lines.push(`  → menu "${projectName}" — Menu de navigation`)
            lines.push(`  ── Découverte ──`)
            lines.push(`  → découvre le projet ${projectName} — Explorer la structure`)
          }
          break

        default:
          // Suggestions génériques si on ne reconnaît pas le script
          if (hasProject) {
            lines.push(`  ── Navigation ──`)
            lines.push(...commonSuggestions)
          }
          break
      }
    }

    // Ajouter les suggestions communes si pas déjà fait (uniquement si aucune suggestion ajoutée)
    if (lines.length <= 2 && hasProject) {
      lines.push(`  ── Navigation ──`)
      lines.push(...commonSuggestions)
    }
  } // Fin du bloc !isProjectEmpty

  // Toujours proposer l'aide en dernier
  lines.push(`  ── Système ──`)
  lines.push('  → liste les projets — Voir tous les projets')

  // ── Filtrage dynamique selon le statut réel de la tâche ──
  if (taskStatus && lines.length > 1) {
    // Si la tâche est BLOQUÉE : ajouter une suggestion de déblocage si absente
    const systemIdx = lines.findIndex(l => l.includes('── Système ──'))
    if (taskStatus === 'blocked' && !lines.some(l => l.includes('débloque'))) {
      const insertAt = systemIdx >= 0 ? systemIdx : lines.length - 1
      lines.splice(insertAt, 0, `  ── Blocage ──`, `  → débloque la tâche "..." au projet ${proj} — Le blocage est résolu ?`)
    }
    // Si la tâche N'EST PAS bloquée : retirer les suggestions de déblocage
    if (taskStatus !== 'blocked') {
      lines = lines.filter(l => !l.includes('débloque la tâche'))
    }
  }

  let result = lines.join('\n')

  // Injecter l'ID de tâche si disponible : remplacer le premier "..." de chaque ligne
  if (taskId) {
    const idLabel = `\"${taskId}\"`
    result = lines.map(line => line.replace('"..."', idLabel)).join('\n')
  }

  // Remplacer tous les placeholders avec leurs valeurs réelles
  // Ne remplace que si la valeur réelle est disponible (non vide).
  // Si le placeholder est absent du paramètre, on le conserve tel quel
  // pour servir d'indication à l'utilisateur (ex: "menu <projet>" quand
  // aucun projet n'est encore sélectionné).
  if (params) {
    const realProject = params.project || (projectName || '')
    const realArea = params.area || ''
    const realName = params.name || ''
    const realTitle = params.title || ''

    if (realProject) {
      result = result
        .replace(/<projet>/g, realProject)
        .replace(/\{project\}/g, realProject)
    }
    if (realArea) {
      result = result
        .replace(/<domaine>/g, realArea)
        .replace(/\{area\}/g, realArea)
    }
    if (realName) {
      result = result
        .replace(/<nom>/g, realName)
        .replace(/\{name\}/g, realName)
    }
    if (realTitle) {
      result = result
        .replace(/<titre>/g, realTitle)
        .replace(/\{title\}/g, realTitle)
    }
  }

  return result
}

/**
 * Essaye de matcher un message contre le registre de scripts.
 * Si un pattern match, exécute le script et notifie le résultat.
 * Retourne true si un script a été exécuté, false sinon (fallback LLM).
 */
async function tryScriptRunner(msg: IntercomMessage): Promise<boolean> {
  const demande = typeof msg.payload.demande === 'string'
    ? msg.payload.demande
    : JSON.stringify(msg.payload)

  // Passer le projet du payload en variable d'env pour les scripts
  const extraEnv: Record<string, string> = {}
  if (typeof msg.payload.project === 'string' && msg.payload.project) {
    extraEnv.SCRIPT_PROJECT = msg.payload.project
  }

  // Étape 1 : Regex strict via script-runner
  let result = matchAndExecute(demande, msg.subject, extraEnv)

  // Étape 2 : Fuzzy matching si le regex n'a pas matché
  if (!result.matched) {
    const fuzzyResult = await fuzzyMatch(demande, msg.subject)

    if (fuzzyResult.matched && fuzzyResult.entry) {
      console.log(`[Daemon] Fuzzy match: ${fuzzyResult.entry.script} (similarité: ${(fuzzyResult.similarity * 100).toFixed(0)}%)`)

      // Exécuter le script trouvé par fuzzy matching
      const execResult = executeScript(fuzzyResult.entry.script, extraEnv)

      result = {
        matched: true,
        script: fuzzyResult.entry.script,
        pattern: fuzzyResult.entry.pattern,
        subject: fuzzyResult.entry.subject,
        stdout: execResult.stdout,
        stderr: execResult.stderr,
        exitCode: execResult.exitCode,
        durationMs: execResult.durationMs,
        params: fuzzyResult.params,
      }
    } else {
      // Aucun match trouvé — logger pour suggestion auto
      checkAndSuggestPattern(demande, msg.subject)
      return false // Fallback LLM
    }
  }

  const ts = new Date().toISOString().slice(11, 19)
  const emoji = result.exitCode === 0 ? '✅' : '❌'
  const duration = result.durationMs > 1000
    ? `${(result.durationMs / 1000).toFixed(1)}s`
    : `${result.durationMs}ms`

  console.log(`[${ts}] ${emoji} ScriptRunner: ${result.script} (${duration})`)

  // Notifier le résultat
  const scriptName = result.script?.split(/[/\\]/).pop()?.replace(/\.\w+$/, '') ?? 'script'
  let message = result.stdout
    ? `✅ [${scriptName}]\n${result.stdout.slice(0, 500)}`
    : `✅ [${scriptName}] — (sortie vide)`

  // Ajouter les suggestions de suivi si le script a réussi
  if (result.exitCode === 0) {
    const projectName = result.params?.project ?? extraEnv.SCRIPT_PROJECT ?? ''
    const taskId = extractTaskIdFromStdout(result.stdout ?? '')
    const taskStatus = taskId ? readTaskStatus(projectName, taskId) : null

    // Si pas de projectName connu, essayer de l'extraire du stdout du script
    // (utile pour les scripts comme 'list' qui affichent les projets sans en cibler un)
    let detectedProject = projectName
    if (!detectedProject && result.stdout) {
      const projectMatch = result.stdout.match(/●\s+(\S+)/)
      if (projectMatch) {
        detectedProject = projectMatch[1]
        console.log(`[Daemon] Projet détecté depuis stdout: ${detectedProject}`)
      }
    }

    const suggestionsText = getFollowUpSuggestions(result.script, detectedProject, demande, taskId ?? undefined, taskStatus ?? undefined, result.params)
    if (suggestionsText) {
      message += `\n${suggestionsText}`
      // Écrire les suggestions structurées pour le menu interactif
      const structured = parseSuggestionsFromOutput(suggestionsText)
      if (structured.length > 0) {
        // Trier par fréquence d'utilisation avant d'écrire (apprentissage)
        // Utilise les stats du projet courant si disponible
        const sorted = sortSuggestionsByFrequency(structured, projectName)
        writeSuggestions(sorted)
      }
    }
  }

  const level: NotificationLevel = result.exitCode === 0 ? 'conclusion' : 'avertissement'
  pushNotification('script-runner', message, level)

  // Si le script a échoué, on notifie aussi l'erreur
  if (result.exitCode !== 0 && result.stderr) {
    pushNotification('script-runner', `⚠️ Erreur: ${result.stderr.slice(0, 200)}`, 'urgent')
  }

  // Logger dans un fichier de trace
  try {
    const logDir = join(cwd, 'telecom', 'scripts')
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true })
    const logFile = join(logDir, `run-${ts.replace(/[:]/g, '-')}.log`)
    writeFileSync(logFile, JSON.stringify({
      timestamp: new Date().toISOString(),
      subject: msg.subject,
      demande,
      script: result.script,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      stdout: result.stdout,
      stderr: result.stderr,
    }, null, 2), 'utf-8')
  } catch { /* log non bloquant */ }

  return true
}

/** Auto-decouverte des agents depuis le dossier .agents/ */
function getKnownAgents(): Set<string> {
  const AGENTS_DIR = join(cwd, '.agents')
  if (!existsSync(AGENTS_DIR)) return new Set()

  const ids = readdirSync(AGENTS_DIR)
    .filter(f => f.endsWith('.ts'))
    .map(f => f.replace(/\.ts$/, ''))

  return new Set(ids)
}

// ── Auto-suggestion de patterns ───────────────────────

const AUTO_SUGGEST_THRESHOLD = 3 // Nombre d'échecs similaires pour déclencher une suggestion
const PATTERN_SUGGESTIONS_FILE = join(cwd, 'telecom', 'pattern-suggestions.json')

/**
 * Vérifie si un pattern a déjà été suggéré pour une demande similaire,
 * pour éviter les suggestions en double.
 */
function isAlreadySuggested(demande: string): boolean {
  try {
    if (!existsSync(PATTERN_SUGGESTIONS_FILE)) return false
    const raw = readFileSync(PATTERN_SUGGESTIONS_FILE, 'utf-8')
    const suggestions = JSON.parse(raw) as Array<{ demande: string }>
    const normalize = (s: string) =>
      s.toLowerCase().replace(/[?,.!;:]/g, '').replace(/\s+/g, ' ').trim()
    const target = normalize(demande)
    return suggestions.some(s => normalize(s.demande) === target)
  } catch {
    return false
  }
}

/**
 * Compte les échecs récurrents de matching pour une demande donnée,
 * et si le seuil est atteint, génère automatiquement une suggestion de pattern
 * via analyze-patterns.js --suggest.
 *
 * Appelée après chaque échec de fuzzy matching dans tryScriptRunner().
 * Non-bloquante : les erreurs sont ignorées silencieusement.
 */
function checkAndSuggestPattern(demande: string, subject: string): void {
  try {
    // Vérifier si une suggestion similaire existe déjà
    if (isAlreadySuggested(demande)) return

    // Compter les échecs récents similaires
    const count = countRejectedDemandes(demande, AUTO_SUGGEST_THRESHOLD, 60)

    if (count >= AUTO_SUGGEST_THRESHOLD) {
      const ts = new Date().toISOString().slice(11, 19)
      console.log(`[${ts}] Auto-suggestion: ${count} échecs similaires pour "${demande.slice(0, 40)}"`)

      // Lancer analyze-patterns.js --suggest pour générer et sauvegarder la suggestion
      const scriptPath = join(cwd, 'scripts', 'telecom', 'analyze-patterns.js')
      if (!existsSync(scriptPath)) {
        console.log(`[${ts}] analyze-patterns.js introuvable: ${scriptPath}`)
        return
      }

      // Appel synchrone — rapide car ne fait que des regex + écriture fichier
      execSync(
        `node "${scriptPath}" --suggest "${demande.replace(/"/g, '\\"')}"`,
        { encoding: 'utf8', timeout: 10000, windowsHide: true },
      )

      console.log(`[${ts}] ✅ Suggestion sauvegardée`)

      // Notifier l'utilisateur discrètement
      pushNotification(
        'pattern-suggester',
        `💡 Suggestion de pattern pour "${demande.slice(0, 60)}" — disponible via 402 /suggestions`,
        'info',
      )
    }
  } catch {
    // Non-bloquant : les erreurs sont ignorées
  }
}

// ── Configuration anti-boucle ──────────────────────────

interface TelecomAntiLoopConfig {
  maxSpawnsPerAgent: number
  spawnWindowMs: number
  maxScriptLogs: number
  maxWatcherFiles: number
}

const DEFAULT_CONFIG: TelecomAntiLoopConfig = {
  maxSpawnsPerAgent: 3,
  spawnWindowMs: 5 * 60 * 1000, // 5 minutes
  maxScriptLogs: 20,
  maxWatcherFiles: 3,
}

/**
 * Charge la configuration anti-boucle depuis telecom-config.json
 * Retourne les valeurs par défaut si le fichier n'existe pas ou est invalide.
 */
export function loadTelecomConfig(): TelecomAntiLoopConfig {
  const configPath = join(cwd, 'telecom', 'config.json')
  if (!existsSync(configPath)) return { ...DEFAULT_CONFIG }

  try {
    const raw = readFileSync(configPath, 'utf-8')
    const parsed = JSON.parse(raw) as { antiLoop?: Partial<TelecomAntiLoopConfig> }
    const antiLoop = parsed.antiLoop ?? {}

    const maxSpawnsPerAgent =
      typeof antiLoop.maxSpawnsPerAgent === 'number' && Number.isInteger(antiLoop.maxSpawnsPerAgent) && antiLoop.maxSpawnsPerAgent > 0
        ? antiLoop.maxSpawnsPerAgent
        : DEFAULT_CONFIG.maxSpawnsPerAgent

    const spawnWindowMs =
      typeof antiLoop.spawnWindowMs === 'number' && antiLoop.spawnWindowMs >= 1000
        ? antiLoop.spawnWindowMs
        : DEFAULT_CONFIG.spawnWindowMs

    const maxScriptLogs =
      typeof antiLoop.maxScriptLogs === 'number' && Number.isInteger(antiLoop.maxScriptLogs) && antiLoop.maxScriptLogs > 0
        ? antiLoop.maxScriptLogs
        : DEFAULT_CONFIG.maxScriptLogs

    const maxWatcherFiles =
      typeof antiLoop.maxWatcherFiles === 'number' && Number.isInteger(antiLoop.maxWatcherFiles) && antiLoop.maxWatcherFiles > 0
        ? antiLoop.maxWatcherFiles
        : DEFAULT_CONFIG.maxWatcherFiles

    return { maxSpawnsPerAgent, spawnWindowMs, maxScriptLogs, maxWatcherFiles }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

const _config = loadTelecomConfig()
export const MAX_SPAWNS_PER_AGENT = _config.maxSpawnsPerAgent
export const SPAWN_WINDOW_MS = _config.spawnWindowMs
export const MAX_SCRIPT_LOGS = _config.maxScriptLogs
export const MAX_WATCHER_FILES = _config.maxWatcherFiles

/**
 * Valide et affiche la configuration anti-boucle au démarrage.
 * Logge le chemin du fichier, son état (trouvé/absent/invalide),
 * et les valeurs effectives utilisées.
 */
export function logTelecomConfig(): void {
  const configPath = join(cwd, 'telecom', 'config.json')

  console.log(`[Daemon] Config anti-boucle : ${configPath}`)

  if (!existsSync(configPath)) {
    console.log(`[Daemon]   → Fichier absent — valeurs par défaut utilisées`)
  } else {
    try {
      const raw = readFileSync(configPath, 'utf-8')
      const parsed = JSON.parse(raw) as { antiLoop?: Partial<TelecomAntiLoopConfig> }
      const antiLoop = parsed.antiLoop ?? {}

      console.log(`[Daemon]   → Fichier trouvé, lecture OK`)

      // Valider chaque champ individuellement pour des logs précis
      const rawMax = antiLoop.maxSpawnsPerAgent
      const rawWindow = antiLoop.spawnWindowMs

      if (rawMax === undefined) {
        console.log(`[Daemon]   ⚠ maxSpawnsPerAgent non défini → défaut (${DEFAULT_CONFIG.maxSpawnsPerAgent})`)
      } else if (typeof rawMax === 'number' && Number.isInteger(rawMax) && rawMax > 0) {
        console.log(`[Daemon]   ✓ maxSpawnsPerAgent = ${MAX_SPAWNS_PER_AGENT}`)
      } else {
        console.log(`[Daemon]   ⚠ maxSpawnsPerAgent invalide (${JSON.stringify(rawMax)}) → défaut (${DEFAULT_CONFIG.maxSpawnsPerAgent})`)
      }

      if (rawWindow === undefined) {
        const minutes = DEFAULT_CONFIG.spawnWindowMs / 60000
        console.log(`[Daemon]   ⚠ spawnWindowMs non défini → défaut (${DEFAULT_CONFIG.spawnWindowMs}ms = ${minutes} min)`)
      } else if (typeof rawWindow === 'number' && rawWindow >= 1000) {
        const minutes = Math.round((SPAWN_WINDOW_MS / 60000) * 10) / 10
        console.log(`[Daemon]   ✓ spawnWindowMs = ${SPAWN_WINDOW_MS}ms (${minutes} min)`)
      } else {
        console.log(`[Daemon]   ⚠ spawnWindowMs invalide (${JSON.stringify(rawWindow)}) → défaut (${DEFAULT_CONFIG.spawnWindowMs}ms)`)
      }

      const rawScriptLogs = antiLoop.maxScriptLogs

      if (rawScriptLogs === undefined) {
        console.log(`[Daemon]   ⚠ maxScriptLogs non défini → défaut (${DEFAULT_CONFIG.maxScriptLogs})`)
      } else if (typeof rawScriptLogs === 'number' && Number.isInteger(rawScriptLogs) && rawScriptLogs > 0) {
        console.log(`[Daemon]   ✓ maxScriptLogs = ${MAX_SCRIPT_LOGS}`)
      } else {
        console.log(`[Daemon]   ⚠ maxScriptLogs invalide (${JSON.stringify(rawScriptLogs)}) → défaut (${DEFAULT_CONFIG.maxScriptLogs})`)
      }

      const rawWatcherFiles = antiLoop.maxWatcherFiles

      if (rawWatcherFiles === undefined) {
        console.log(`[Daemon]   ⚠ maxWatcherFiles non défini → défaut (${DEFAULT_CONFIG.maxWatcherFiles})`)
      } else if (typeof rawWatcherFiles === 'number' && Number.isInteger(rawWatcherFiles) && rawWatcherFiles > 0) {
        console.log(`[Daemon]   ✓ maxWatcherFiles = ${MAX_WATCHER_FILES}`)
      } else {
        console.log(`[Daemon]   ⚠ maxWatcherFiles invalide (${JSON.stringify(rawWatcherFiles)}) → défaut (${DEFAULT_CONFIG.maxWatcherFiles})`)
      }
    } catch (err) {
      console.log(`[Daemon]   ✗ Erreur de lecture: ${(err as Error).message} — valeurs par défaut utilisées`)
    }
  }

  // Résumé des valeurs effectives
  const minutes = Math.round((SPAWN_WINDOW_MS / 60000) * 10) / 10
  console.log(`[Daemon]   → Effectif : max ${MAX_SPAWNS_PER_AGENT} spawns / ${minutes} min, purge scripts: ${MAX_SCRIPT_LOGS}, watcher: ${MAX_WATCHER_FILES}`)
}

// ── Statut du daemon ──────────────────────────────────

interface DaemonStatus {
  pid: number
  startedAt: string
  uptimeSec: number
  pollInterval: number
  totalMessagesRouted: number
  totalSpawns: number
  totalBlocks: number
  lastRoutes: Array<{ from: string; to: string; subject: string; at: string }>
  activeSpawns: Array<{ agentId: string; subject: string; startedAt: string }>
  spawnHistory: Array<{ agentId: string; recentSpawns: number; windowMs: number; blockedTotal: number }>
  agentCount: number
  spawnWindowMs: number
  maxSpawnsPerAgent: number
  configPresent: boolean
}

const DAEMON_STARTED = Date.now()
let TOTAL_ROUTED = 0
let TOTAL_SPAWNS = 0
let TOTAL_BLOCKS = 0
const ROUTE_HISTORY: Array<{ from: string; to: string; subject: string; at: string }> = []
const ACTIVE_SPAWNS = new Map<string, { agentId: string; subject: string; startedAt: string }>()
const BLOCKED_COUNTS = new Map<string, number>()

export function resetStats(): void {
  TOTAL_ROUTED = 0
  TOTAL_SPAWNS = 0
  TOTAL_BLOCKS = 0
  ROUTE_HISTORY.length = 0
  BLOCKED_COUNTS.clear()
  resetSpawnHistory()
  writeStatus()
  console.log(`[Daemon] Statistiques reinitialisees`)
  pushNotification('telecom-daemon', 'Statistiques du daemon reinitialisees', 'info')
}

function writeStatus(): void {
  const now = Date.now()
  const uptimeSec = Math.floor((now - DAEMON_STARTED) / 1000)
  const agentsDir = join(cwd, '.agents')
  const agentCount = existsSync(agentsDir) ? readdirSync(agentsDir).filter(f => f.endsWith('.ts')).length : 0

  // Construire l'historique des spawns depuis SPAWN_HISTORY + BLOCKED_COUNTS
  const spawnHistory: DaemonStatus['spawnHistory'] = []
  for (const [agentId, timestamps] of SPAWN_HISTORY) {
    const recent = timestamps.filter(t => now - t < SPAWN_WINDOW_MS).length
    const blocked = BLOCKED_COUNTS.get(agentId) ?? 0
    spawnHistory.push({ agentId, recentSpawns: recent, windowMs: SPAWN_WINDOW_MS, blockedTotal: blocked })
  }
  spawnHistory.sort((a, b) => b.blockedTotal - a.blockedTotal)

  const status: DaemonStatus = {
    pid: process.pid,
    startedAt: new Date(DAEMON_STARTED).toISOString(),
    uptimeSec,
    pollInterval: POLL_INTERVAL,
    totalMessagesRouted: TOTAL_ROUTED,
    totalSpawns: TOTAL_SPAWNS,
    totalBlocks: TOTAL_BLOCKS,
    lastRoutes: [...ROUTE_HISTORY],
    activeSpawns: [...ACTIVE_SPAWNS.values()],
    spawnHistory,
    agentCount,
    spawnWindowMs: SPAWN_WINDOW_MS,
    maxSpawnsPerAgent: MAX_SPAWNS_PER_AGENT,
    configPresent: existsSync(join(cwd, 'telecom', 'config.json')),
  }

  writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2), 'utf-8')
}

/** Affiche le statut du daemon depuis le fichier .telecom-daemon.status.json */
function showStatus(): void {
  if (!existsSync(STATUS_FILE)) {
    console.log(`Aucun daemon en cours d'execution (${STATUS_FILE} introuvable)`)
    return
  }

  let status: DaemonStatus
  try {
    const raw = readFileSync(STATUS_FILE, 'utf-8')
    status = JSON.parse(raw) as DaemonStatus
  } catch {
    console.log(`Fichier de statut invalide: ${STATUS_FILE}`)
    return
  }

  const pidAlive = existsSync(PID_FILE)
    ? (() => { try { process.kill(status.pid, 0); return true } catch { return false } })()
    : false

  const uptimeStr = formatUptime(status.uptimeSec)

  console.log(`${'='.repeat(56)}`)
  console.log(`  TELECOM DAEMON — Statut`)
  console.log(`${'='.repeat(56)}`)
  console.log('')
  console.log(`  ETAT`)
  console.log(`    PID       : ${status.pid}  ${pidAlive ? '(en cours)' : '(termine)'}`)
  console.log(`    Uptime    : ${uptimeStr}`)
  console.log(`    Demarre   : ${status.startedAt}`)
  console.log('')
  console.log(`  STATISTIQUES`)
  console.log(`    Messages routes  : ${status.totalMessagesRouted}`)
  console.log(`    Spawns effectues  : ${status.totalSpawns}`)
  console.log(`    Blocages anti-boucle : ${status.totalBlocks}`)
  console.log(`    Agents disponibles   : ${status.agentCount}`)
  console.log('')

  if (status.activeSpawns.length > 0) {
    console.log(`  SPAWNS ACTIFS (${status.activeSpawns.length})`)
    for (const s of status.activeSpawns) {
      const runningFor = Math.floor((Date.now() - new Date(s.startedAt).getTime()) / 1000)
      console.log(`    ${s.agentId.padEnd(20)} ${s.subject.slice(0, 30).padEnd(32)} ${runningFor}s`)
    }
    console.log('')
  }

  if (status.lastRoutes.length > 0) {
    console.log(`  DERNIERES ROUTES (${status.lastRoutes.length})`)
    for (const r of status.lastRoutes) {
      const time = r.at.slice(11, 19)
      console.log(`    ${time}  ${r.from.padEnd(16)} → ${r.to.padEnd(16)} ${r.subject.slice(0, 20)}`)
    }
    console.log('')
  }

  if (status.spawnHistory.length > 0) {
    console.log(`  HISTORIQUE DES SPAWNS (${status.spawnHistory.length} agents)`)
    console.log(`    ${'Agent'.padEnd(20)} ${'Recents'.padEnd(8)} ${'Bloques'.padEnd(8)} Fenetre`)
    for (const h of status.spawnHistory) {
      const windowMin = Math.round(h.windowMs / 60000)
      console.log(`    ${h.agentId.padEnd(20)} ${String(h.recentSpawns).padEnd(8)} ${String(h.blockedTotal).padEnd(8)} ${windowMin}min`)
    }
    console.log('')
  }

  console.log(`  CONFIG`)
  const windowMin = Math.round((status.spawnWindowMs / 60000) * 10) / 10
  console.log(`    Anti-boucle : max ${status.maxSpawnsPerAgent} spawns / ${windowMin} min`)
  console.log(`    Intervalle  : ${status.pollInterval}ms`)
  console.log(`    Config file : ${status.configPresent ? 'present' : 'absent'}`)
  console.log('')
  console.log(`${'='.repeat(56)}`)
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const parts: string[] = []
  if (h > 0) parts.push(`${h}h`)
  if (m > 0) parts.push(`${m}m`)
  parts.push(`${s}s`)
  return parts.join(' ')
}

/** Anti-boucle : limite les spawns consecutifs d'un meme agent */
const SPAWN_HISTORY = new Map<string, number[]>()

/**
 * Enregistre un spawn et retourne true si le taux est acceptable.
 * @param agentId - Identifiant de l'agent
 * @param _now - Timestamp optionnel (injecté pour les tests)
 */
export function tryRecordSpawn(agentId: string, nowOverride?: number): boolean {
  const now = nowOverride ?? Date.now()
  let timestamps = SPAWN_HISTORY.get(agentId) || []

  // Nettoyer les entrées hors fenêtre
  timestamps = timestamps.filter(t => now - t < SPAWN_WINDOW_MS)

  if (timestamps.length >= MAX_SPAWNS_PER_AGENT) {
    return false // Trop de spawns, on bloque
  }

  // Enregistrer ce nouveau spawn
  timestamps.push(now)
  SPAWN_HISTORY.set(agentId, timestamps)
  return true
}

/** Vide l'historique des spawns (utilisé par les tests) */
export function resetSpawnHistory(): void {
  SPAWN_HISTORY.clear()
}

function spawnAgent(agentId: string, msg: IntercomMessage): void {
  const known = getKnownAgents()
  if (!known.has(agentId)) {
    // Agent inconnu — on ne spawn pas, mais on loggue
    console.log(`[Daemon] Agent "${agentId}" non reconnu — aucun spawn automatique`)
    return
  }

  // Anti-boucle : bloquer si trop de spawns récents
  if (!tryRecordSpawn(agentId)) {
    const blocked = (BLOCKED_COUNTS.get(agentId) ?? 0) + 1
    BLOCKED_COUNTS.set(agentId, blocked)
    TOTAL_BLOCKS++
    console.log(`[Daemon] Anti-boucle: "${agentId}" bloque (${MAX_SPAWNS_PER_AGENT} spawns en 5 min)`)
    pushNotification('telecom-daemon', `Anti-boucle: "${agentId}" bloque — ${MAX_SPAWNS_PER_AGENT} spawns en 5 min`, 'avertissement')
    writeStatus()
    return
  }

  const spawnPath = join(import.meta.dirname, '..', '..', 'spawn-agent.js')
  if (!existsSync(spawnPath)) {
    const errMsg = `spawn-agent.js introuvable (${spawnPath}) — executez 'npm run build' pour compiler`
    console.error(`[Daemon] ERR: ${errMsg}`)
    pushNotification('telecom-daemon', `❌ Impossible de spawn ${agentId} : ${errMsg}`, 'urgent')
    return
  }

  const instruction = buildInstruction(agentId, msg)
  const ts = new Date().toISOString().slice(11, 19)
  console.log(`[${ts}] Spawn de ${agentId} pour ${msg.subject}...`)

  // Tracker le spawn actif
  const nowStr = new Date().toISOString()
  ACTIVE_SPAWNS.set(agentId + '@' + Date.now(), { agentId, subject: msg.subject, startedAt: nowStr })
  TOTAL_SPAWNS++
  writeStatus()

  const child = fork(spawnPath, [agentId, instruction], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })

  // ── Enregistrer l'agent auprès du FeuRouge avec le vrai PID ──
  if (child.pid) {
    const feurouge = getFeuRougeClient()
    if (feurouge.isAlive()) {
      const perm = getAgentPermission(agentId)
      const level = perm?.level ?? 'confined'
      const workspace = perm?.workspace ?? (level === 'confined' ? '.sandbox' : undefined)
      feurouge.registerAgent(agentId, child.pid, level, workspace)
        .then((ok) => {
          if (ok) {
            const wsLabel = workspace ? ` → ${workspace}` : ''
            console.log(`[Daemon] Agent "${agentId}" enregistré FeuRouge (PID ${child.pid}) [${level}]${wsLabel}`)
          }
        })
    }
  }

  let output = ''
  child.stdout?.on('data', (d: Buffer) => { output += d.toString() })
  child.stderr?.on('data', (d: Buffer) => { output += d.toString() })

  // Relayer les messages IPC de l'enfant vers le CLI parent
  child.on('message', (msg: unknown) => {
    if (typeof process.send === 'function') {
      process.send(msg, undefined, undefined, () => {})
    }
  })

  child.on('exit', (code) => {
    const exitCode = code ?? -1
    if (exitCode === 0) {
      console.log(`[${ts}] ${agentId} termine (succes)`)
    } else {
      console.error(`[${ts}] ${agentId} echoue (code: ${exitCode})`)
      if (output.trim()) {
        console.error(`[${ts}] Sortie: ${output.trim().slice(0, 300)}`)
      }
    }

    // Nettoyer le spawn actif
    for (const [key, val] of ACTIVE_SPAWNS) {
      if (val.agentId === agentId) {
        ACTIVE_SPAWNS.delete(key)
      }
    }
    writeStatus()
  })

  // Timeout de securite : tuer le processus apres 5 minutes
  // On ecrit d'abord un fichier d'erreur, puis on tue le processus.
  // Ceci est indispensable sur Windows où child.kill() ne peut pas être intercepté
  // (TerminateProcess synchrone) et contourne les handlers SIGTERM du spawn-agent.
  setTimeout(() => {
    if (child.exitCode === null) {
      const workspaceDir = join(cwd, 'telecom', 'agents', agentId)
      const safeTimestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const erreurPath = join(workspaceDir, `erreur-${safeTimestamp}.md`)
      try {
        if (!existsSync(workspaceDir)) mkdirSync(workspaceDir, { recursive: true })
        writeFileSync(erreurPath, [
          `# Erreur — ${agentId}`,
          `**Date :** ${new Date().toISOString()}`,
          '',
          `**Erreur :** Processus tué par le daemon (timeout 5 min)`,
          `**PID :** ${child.pid}`,
          `**Duree :** 5 min`,
          `**Instruction :** ${instruction.slice(0, 500)}`,
        ].join('\n'), 'utf-8')
      } catch { /* ignoré — le spawn-agent écrit aussi son propre fichier si SIGTERM est interceptable */ }

      child.kill()
      console.error(`[${ts}] ${agentId} tué (timeout 5min) — erreur écrite dans ${erreurPath}`)
    }
  }, 5 * 60 * 1000)
}

function writePid(): void {
  writeFileSync(PID_FILE, String(process.pid), 'utf-8')
}

// ── Cache de détection Windows Terminal ──────────────
let _wtAvailable: boolean | null = null
let _wtInstallAttempted = false

/**
 * Vérifie si wt.exe (Windows Terminal) est disponible dans le PATH.
 * Utilise `where wt` (l'équivalent Windows de `which`).
 * Le résultat est mis en cache pour la durée de vie du daemon.
 */
function canUseWindowsTerminal(): boolean {
  if (_wtAvailable !== null) return _wtAvailable
  if (process.platform !== 'win32') {
    _wtAvailable = false
    return false
  }
  try {
    execSync('where wt', { encoding: 'utf8', timeout: 2000 })
    _wtAvailable = true
    console.log('[Daemon] Windows Terminal détecté — onglets combinés')
  } catch {
    _wtAvailable = false
    console.log('[Daemon] Windows Terminal non trouvé — lancement séparé')
  }
  return _wtAvailable
}

/**
 * Cherche wt.exe dans le dossier WindowsApps (hors PATH).
 * Utilisé quand le package est installé mais pas dans le PATH du processus.
 */
function findWtInWindowsApps(): boolean {
  const localAppData = process.env.LOCALAPPDATA || join(process.env.USERPROFILE || '', 'AppData', 'Local')
  const windowsApps = join(localAppData, 'Microsoft', 'WindowsApps')
  const wtPath = join(windowsApps, 'wt.exe')
  try {
    execSync(`"${wtPath}" --version`, { timeout: 2000 })
    console.log(`[Daemon] wt.exe trouvé dans ${windowsApps}`)
    // Invalider le cache pour les prochains appels (recherche directe)
    _wtAvailable = null
    return true
  } catch {
    console.log('[Daemon] wt.exe inaccessible dans WindowsApps')
    return false
  }
}

/**
 * Installation automatique de Windows Terminal via winget (100% asynchrone).
 *
 * Appelée quand canUseWindowsTerminal() retourne false sur Windows.
 * 1. Vérifie d'abord si le package est déjà installé (via exec asynchrone)
 * 2. Si déjà installé mais pas dans le PATH → essaie de trouver wt.exe dans WindowsApps
 * 3. Si pas installé → lance winget install --scope user --silent
 *
 * Ne bloque PAS le démarrage du daemon. Les notifications arrivent en temps réel.
 */
function tryInstallWindowsTerminal(): void {
  if (process.platform !== 'win32' || _wtInstallAttempted) return
  _wtInstallAttempted = true

  console.log('[Daemon] Vérification de Windows Terminal...')

  // Étape 1 : vérifier si le package est déjà installé (asynchrone)
  const psCmd = [
    'powershell', '-NoProfile', '-Command',
    `"if (Get-AppxPackage -Name Microsoft.WindowsTerminal) { exit 0 } else { exit 1 }"`,
  ]

  exec(psCmd.join(' '), { timeout: 5000 }, (err) => {
    if (!err) {
      // Le package est installé → chercher wt.exe dans WindowsApps
      console.log('[Daemon] Windows Terminal déjà installé — localisation...')
      if (!findWtInWindowsApps()) {
        console.log('[Daemon] WT installé mais wt.exe introuvable — utilisation du fallback cmd')
      }
      return
    }

    // Étape 2 : package non installé → lancer winget
    console.log('[Daemon] Installation de Windows Terminal en arrière-plan...')
    pushNotification('telecom-daemon', '📦 Installation de Windows Terminal en arrière-plan...', 'info')

    exec([
      'winget install',
      '--id Microsoft.WindowsTerminal',
      '--scope user',
      '--silent',
      '--accept-package-agreements',
      '--accept-source-agreements',
    ].join(' '), {
      timeout: 120000, // 2 minutes max
    }, (wingetErr, _stdout, stderr) => {
      if (wingetErr) {
        const msg = stderr?.trim() || wingetErr.message
        console.error(`[Daemon] Échec installation WT: ${msg}`)
        pushNotification('telecom-daemon', `❌ Installation Windows Terminal échouée: ${msg.slice(0, 200)}`, 'urgent')
        return
      }
      console.log('[Daemon] Windows Terminal installé avec succès!')
      pushNotification('telecom-daemon', '✅ Windows Terminal installé! Redémarre le daemon pour utiliser les onglets combinés.', 'conclusion')
      // Invalider le cache
      _wtAvailable = null
      // Vérifier que wt.exe est maintenant accessible
      findWtInWindowsApps()
    })
  })
}

/**
 * Lance le watcher TUI et le visionneur de notifications.
 * Sur Windows, si wt.exe est disponible, OUVRE LES DEUX dans UNE SEULE fenêtre
 * Windows Terminal avec deux onglets (`wt -w -1 new-tab ... new-tab ...`).
 * Sinon, chaque fenêtre s'ouvre séparément via `start cmd /c`.
 *
 * Plateformes non-Windows : lancement séparé (osascript / x-terminal-emulator).
 */
function launchCombinedTabs(): void {
  // ── Windows Terminal : UNE commande, DEUX onglets ──
  if (process.platform === 'win32' && canUseWindowsTerminal()) {
    const watcherScript = join(cwd, 'dist', 'telecom', 'service', 'telecom-watcher-console.js')
    const viewerScript = join(cwd, 'dist', 'telecom', 'service', 'telecom-notification-viewer.js')

    // Construire les arguments wt avec les onglets disponibles
    const args: string[] = ['-w', '-1']  // Nouvelle fenêtre

    if (existsSync(watcherScript)) {
      args.push(
        'new-tab',
        '--title', `Telecom Watcher — PID:${process.pid}`,
        '-d', cwd,
        'cmd', '/c', `chcp 65001>nul && node "${watcherScript}"`,
      )
      args.push(';') // Séparateur de commandes wt.exe
    }
    if (existsSync(viewerScript)) {
      args.push(
        'new-tab',
        '--title', `Notifications Viewer — ${process.pid}`,
        '-d', cwd,
        'cmd', '/c', `chcp 65001>nul && node "${viewerScript}"`,
      )
    }

    if (args.length <= 2) {
      // Aucun script dispo (juste -w -1)
      console.log('[Daemon] Aucun script TUI disponible — onglets WT non lancés')
      return
    }

    const tabCount = args.filter(a => a === 'new-tab').length
    console.log(`[Daemon] Lancement de ${tabCount} onglet(s) Windows Terminal...`)

    try {
      spawn('wt', args, { stdio: 'ignore', detached: true }).unref()
    } catch (wtErr) {
      console.error(`[Daemon] ERR wt.exe: ${(wtErr as Error).message} — fallback cmd`)
      // Fallback : lancer séparément
      launchWatcherConsole()
      launchNotificationViewer()
    }
    return
  }

  // ── Fallback plateformes non-Windows ou WT indisponible ──
  launchWatcherConsole()
  launchNotificationViewer()

  // Lancer l'installation en arrière-plan si sur Windows sans WT
  if (process.platform === 'win32') {
    tryInstallWindowsTerminal()
  }
}

/**
 * Lance le watcher TUI dans une fenêtre de terminal séparée (fallback).
 * Utilisé quand Windows Terminal n'est pas disponible.
 * Détection automatique de la plateforme :
 *   win32 → start cmd /c
 *   darwin → osascript + Terminal.app
 *   linux  → x-terminal-emulator ou xterm
 */
function launchWatcherConsole(): void {
  const watcherScript = join(cwd, 'dist', 'telecom', 'service', 'telecom-watcher-console.js')
  const title = `Telecom Watcher — PID:${process.pid} — intercom:0 routed:0`

  if (!existsSync(watcherScript)) {
    console.log(`[Daemon] Watcher non lancé: script introuvable (${watcherScript})`)
    return
  }

  switch (process.platform) {
    case 'win32': {
      const cmd = `start "${title}" cmd /c "chcp 65001 >nul && node ${watcherScript}"`
      exec(cmd, (err: Error | null) => {
        if (err) console.error(`[Daemon] ERR lancement watcher: ${err.message}`)
      })
      break
    }
    case 'darwin': {
      const cmd = `osascript -e 'tell app "Terminal" to do script "node ${watcherScript}"'`
      exec(cmd, (err: Error | null) => {
        if (err) console.error(`[Daemon] ERR lancement watcher: ${err.message}`)
      })
      break
    }
    default: {
      const termCmd = `x-terminal-emulator -e "node ${watcherScript}" || xterm -e "node ${watcherScript}"`
      exec(termCmd, (err: Error | null) => {
        if (err) console.error(`[Daemon] ERR lancement watcher: ${err.message} — installe xterm ou x-terminal-emulator`)
      })
      break
    }
  }
}

/**
 * Lance le visionneur de notifications dans une fenêtre séparée (fallback).
 * Utilisé quand Windows Terminal n'est pas disponible.
 * Détection automatique de la plateforme (identique à launchWatcherConsole).
 */
function launchNotificationViewer(): void {
  const viewerScript = join(cwd, 'dist', 'telecom', 'service', 'telecom-notification-viewer.js')
  const title = `Notifications Viewer — ${process.pid}`

  if (!existsSync(viewerScript)) {
    console.log(`[Daemon] Notification viewer non lancé: script introuvable (${viewerScript})`)
    return
  }

  switch (process.platform) {
    case 'win32': {
      const cmd = `start "${title}" cmd /c "chcp 65001 >nul && node ${viewerScript}"`
      exec(cmd, (err: Error | null) => {
        if (err) console.error(`[Daemon] ERR lancement notification viewer: ${err.message}`)
      })
      break
    }
    case 'darwin': {
      const cmd = `osascript -e 'tell app "Terminal" to do script "node ${viewerScript}"'`
      exec(cmd, (err: Error | null) => {
        if (err) console.error(`[Daemon] ERR lancement notification viewer: ${err.message}`)
      })
      break
    }
    default: {
      const termCmd = `x-terminal-emulator -e "node ${viewerScript}" || xterm -e "node ${viewerScript}"`
      exec(termCmd, (err: Error | null) => {
        if (err) console.error(`[Daemon] ERR lancement notification viewer: ${err.message}`)
      })
      break
    }
  }
}

/**
 * Tue le visionneur de notifications.
 * Lit le PID depuis telecom/notification-viewer.pid.
 */
function killNotificationViewer(): void {
  if (!existsSync(VIEWER_PID_FILE)) return

  try {
    const raw = readFileSync(VIEWER_PID_FILE, 'utf-8').trim()
    const pid = parseInt(raw, 10)
    if (!isNaN(pid)) {
      try {
        process.kill(pid, 'SIGTERM')
        console.log(`[Daemon] Notification viewer tué (PID ${pid})`)
      } catch {
        // déjà mort
      }
    }
  } catch { /* fichier illisible */ }

  try { unlinkSync(VIEWER_PID_FILE) } catch { /* déjà supprimé */ }
}

/**
 * Tue le watcher console et nettoie les fichiers résiduels.
 * Lit le PID depuis telecom/watcher.pid (écrit par le watcher lui-même).
 */
function killWatcherConsole(): void {
  if (!existsSync(WATCHER_PID_FILE)) return

  try {
    const raw = readFileSync(WATCHER_PID_FILE, 'utf-8').trim()
    const pid = parseInt(raw, 10)
    if (!isNaN(pid)) {
      try {
        process.kill(pid, 'SIGTERM')
        console.log(`[Daemon] Watcher console tué (PID ${pid})`)
      } catch {
        // Le watcher peut déjà être mort — on ignore
      }
    }
  } catch {
    /* fichier illisible */
  }

  // Nettoyer le fichier PID quoi qu'il arrive
  try { unlinkSync(WATCHER_PID_FILE) } catch { /* déjà supprimé */ }
}

export function showHelp(): void {
  const configPath = join(cwd, 'telecom', 'config.json')
  const agentsDir = join(cwd, '.agents')
  const minutes = Math.round((SPAWN_WINDOW_MS / 60000) * 10) / 10
  const configFound = existsSync(configPath)
  const agentCount = existsSync(agentsDir) ? readdirSync(agentsDir).filter(f => f.endsWith('.ts')).length : 0

  console.log(`${'='.repeat(56)}`)
  console.log(`  TELECOM DAEMON — Aide`)
  console.log(`${'='.repeat(56)}`)
  console.log('')
  console.log(`  DESCRIPTION`)
  console.log(`    Service fond qui surveille telecom/intercom/ et route les`)
  console.log(`    messages vers les agents. Les agents sont decouverts`)
  console.log(`    automatiquement depuis le dossier .agents/.`)
  console.log('')
  console.log(`  DOSSIERS SURVEILLES`)
  console.log(`    Intercom  : ${INTERCOM_DIR}`)
  console.log(`    Routage   : ${ROUTED_DIR}`)
  console.log(`    Agents    : ${agentsDir}  (${agentCount} agents)`)
  console.log(`    Config    : ${configPath}  ${configFound ? '(present)' : '(absent — defaut)'}`)
  console.log(`    PID       : ${PID_FILE}`)
  console.log('')
  console.log(`  CONFIGURATION ANTI-BOUCLE (telecom/config.json)`)
  console.log(`    maxSpawnsPerAgent : ${MAX_SPAWNS_PER_AGENT}`)
  console.log(`    spawnWindowMs     : ${SPAWN_WINDOW_MS}ms  (${minutes} min)`)
  console.log(`    maxScriptLogs     : ${MAX_SCRIPT_LOGS}`)
  console.log(`    maxWatcherFiles   : ${MAX_WATCHER_FILES}`)
  console.log('')
  console.log(`  COMMANDES`)
  console.log(`    node dist/telecom/service/telecom-daemon.js`)
  console.log(`        Demarre le daemon en premier plan`)
  console.log(`    node dist/telecom/service/telecom-daemon.js --once`)
  console.log(`        Traite les messages en attente puis quitte`)
  console.log(`    node dist/telecom/service/telecom-daemon.js --help`)
  console.log(`        Affiche cette aide`)
  console.log(`    node dist/telecom/service/telecom-daemon.js --no-cleanup`)
  console.log(`        Demarre le daemon en conservant l'etat pre-existant (debug)`)
  console.log(`    node dist/telecom/service/telecom-daemon.js --reset-stats`)
  console.log(`        Reinitialise les compteurs (routes, spawns, blocages)`)
  console.log('')
  console.log(`  INTERVALLE DE POLLING`)
  console.log(`    ${POLL_INTERVAL}ms  (toutes les ${POLL_INTERVAL / 1000} secondes)`)
  console.log('')
  console.log(`${'='.repeat(56)}`)
}

function main(): void {
  const args = process.argv.slice(2)
  const once = args.includes('--once')

  if (args.includes('--help') || args.includes('-h')) {
    showHelp()
    process.exit(0)
  }

  if (args.includes('--reset-stats')) {
    // Envoyer un signal de reset au daemon via fichier marqueur
    if (!existsSync(PID_FILE)) {
      console.log(`Aucun daemon en cours (${PID_FILE} introuvable)`)
      process.exit(1)
    }
    writeFileSync(RESET_FILE, String(Date.now()), 'utf-8')
    console.log(`Signal de reinitialisation envoye au daemon (PID: ${readFileSync(PID_FILE, 'utf-8').trim()})`)
    process.exit(0)
  }

  if (args.includes('--status')) {
    if (args.includes('--json')) {
      // Export JSON brut pour monitoring externe
      if (!existsSync(STATUS_FILE)) {
        console.log(`Aucun daemon en cours d'execution (${STATUS_FILE} introuvable)`)
        process.exit(1)
      }
      try {
        const raw = readFileSync(STATUS_FILE, 'utf-8')
        console.log(raw.trim())
      } catch {
        console.log(`Fichier de statut invalide: ${STATUS_FILE}`)
        process.exit(1)
      }
    } else {
      showStatus()
    }
    process.exit(0)
  }

  const noCleanup = args.includes('--no-cleanup')

  if (!once) {
    // Créer le dossier telecom/ avant d'écrire le PID
    mkdirSync(join(cwd, 'telecom'), { recursive: true })
    console.log(`[Daemon] Démarrage (PID: ${process.pid})`)
    if (noCleanup) {
      console.log(`[Daemon] --no-cleanup: état pré-existant conservé`)
    } else {
      console.log(`[Daemon] Nettoyage de l'état pré-existant...`)
      cleanupOldState()
    }
    writePid()
    console.log(`[Daemon] Surveillance: ${INTERCOM_DIR}`)
    console.log(`[Daemon] Routage vers: ${ROUTED_DIR}`)
    console.log(`[Daemon] Intervalle: ${POLL_INTERVAL}ms`)
    logTelecomConfig()
    console.log('')
    setupWatcher()
    launchCombinedTabs()

    // Garde-fou contre la double exécution de daemonCleanup (SIGTERM pendant le setTimeout)
    let cleanupInProgress = false

    function daemonCleanup(): void {
      if (cleanupInProgress) return
      cleanupInProgress = true

      console.log('')
      console.log(`[Daemon] Arrêt demandé — nettoyage...`)

      // 1. Écrire les flags de shutdown gracieux (exit code 0 → WT ferme l'onglet)
      try { writeFileSync(WATCHER_SHUTDOWN_FILE, '', 'utf-8') } catch { /* ignoré */ }
      try { writeFileSync(VIEWER_SHUTDOWN_FILE, '', 'utf-8') } catch { /* ignoré */ }

      // 2. Attendre un peu pour que watcher/viewer détectent le flag et sortent proprement
      //    (ils vérifient à chaque cycle de polling ~1-1.5s, donc 4s est suffisant)
      setTimeout(() => {
        // 3. Force-kill si encore en vie (TerminateProcess — non-gracieux mais définitif)
        killWatcherConsole()
        killNotificationViewer()

        // 4. Nettoyer les fichiers PID, status et flags
        try { unlinkSync(PID_FILE) } catch { /* déjà supprimé */ }
        try { unlinkSync(STATUS_FILE) } catch { /* déjà supprimé */ }
        try { unlinkSync(WATCHER_SHUTDOWN_FILE) } catch { /* déjà supprimé */ }
        try { unlinkSync(VIEWER_SHUTDOWN_FILE) } catch { /* déjà supprimé */ }

        console.log(`[Daemon] Daemon terminé.`)
        process.exit(0)
      }, 4000)
    }

    process.on('SIGINT', () => daemonCleanup())
    process.on('SIGTERM', () => daemonCleanup())
    // SIGHUP n'existe pas sur Windows, mais ne pas l'ajouter casse les tests Unix
    // On utilise SIGBREAK qui est l'équivalent Windows de SIGHUP (Ctrl+Break)
    process.on('SIGBREAK', () => daemonCleanup())
  }

  let loopCount = 0

  function checkResetSignal(): void {
    if (existsSync(RESET_FILE)) {
      try {
        unlinkSync(RESET_FILE)
      } catch { /* ignoré — fichier déjà supprimé par un autre processus */ }
      resetStats()
    }
  }

  /**
   * Watcher temps réel sur le dossier intercom.
   * Déclenche `processMessages()` immédiatement dès qu'un nouveau fichier .json apparaît.
   * Avec debounce pour éviter les doublons (fs.watch peut tirer plusieurs événements).
   */
  let lastWatchProcess = 0

  function setupWatcher(): void {
    if (!existsSync(INTERCOM_DIR)) mkdirSync(INTERCOM_DIR, { recursive: true })
    try {
      watch(INTERCOM_DIR, (eventType, filename) => {
        if (eventType === 'rename' && filename?.endsWith('.json')) {
          const now = Date.now()
          if (now - lastWatchProcess > WATCH_DEBOUNCE_MS) {
            lastWatchProcess = now
            processMessages() // fire-and-forget pour le watcher
          }
        }
      })
      console.log(`[Daemon] Watcher intercom actif (debounce: ${WATCH_DEBOUNCE_MS}ms)`)
    } catch (err) {
      // fs.watch peut ne pas être supporté sur certains systèmes (Docker, WSL ancien)
      // Dans ce cas, on se rabat sur le polling seul
      console.log(`[Daemon] Watcher indisponible — polling seul (${(err as Error).message})`)
    }
  }

  async function tick(): Promise<void> {
    try {
      checkResetSignal()

      // Vérifier le signal trigger avant le traitement normal
      // (écrit par cli-intercom-router.ts pour un déclenchement immédiat)
      let triggerHandled = false
      if (existsSync(TRIGGER_FILE)) {
        try { unlinkSync(TRIGGER_FILE) } catch { /* ignoré */ }
        await processMessages()
        triggerHandled = true
      }

      if (!triggerHandled) {
        const processed = await processMessages()
        if (!once && processed > 0) {
          loopCount++
        }
      }
      // Nettoyage périodique (toutes les ~300 itérations ≈ 10 min)
      if (!once && loopCount > 0 && loopCount % CLEANUP_INTERVAL === 0) {
        cleanMemoireVive()
        purgeScriptLogs()
        purgeWatcherData()
      }
    } catch (err) {
      console.error(`[Daemon] Erreur: ${(err as Error).message}`)
    }

    if (once) {
      cleanMemoireVive()
      process.exit(0)
    }

    // Si un trigger est arrivé pendant le traitement, on reboucle immédiatement
    if (existsSync(TRIGGER_FILE)) {
      try { unlinkSync(TRIGGER_FILE) } catch {}
      setImmediate(tick)
    } else {
      setTimeout(tick, POLL_INTERVAL)
    }
  }

  tick()
}

// Ne lancer le daemon que si exécuté directement (pas à l'import pour les tests)
const __filename = fileURLToPath(import.meta.url)
const resolvedMain = resolve(process.argv[1] || '')
if (resolvedMain === __filename) {
  main()
}
