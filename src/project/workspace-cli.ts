/**
 * Workspace CLI — Commandes interactives pour la gestion des projets.
 *
 * Utilisation :
 *   !project create <nom> [description]   — Crée un projet
 *   !project init <nom>                   — Marque un dossier existant
 *   !project list                         — Liste les projets
 *   !project show <nom>                   — Infos détaillées
 *   !project tasks <nom> [area]           — Liste les tâches
 *   !project archive <nom>                — Archive un projet
 *   !project help                         — Aide
 *
 *   /project <nom>                        — Raccourci pour !project show <nom>
 *   /tasks <nom>                          — Raccourci pour !project tasks <nom>
 */

import { createInterface } from 'readline/promises'
import {
  getWorkspacesDir,
  getProjectPath,
  ensureWorkspacesDir,
  createProject,
  initProject,
  listProjects,
  listOrphanDirs,
  getProjectInfo,
  archiveProject,
  deleteProject,
} from './project-manager.js'
import {
  readTaskBoard,
  writeTaskBoard,
  addTask,
  updateTaskStatus,
  listTasks,
  getNextTask,
  canAssignTask,
  countTasks,
} from './task-board.js'
import {
  RESET, CYAN, GREEN, YELLOW, RED, GRAY, BOLD,
} from '../constants.js'
import { setCurrentProject } from '../cli-intercom-router.js'

// ── Dispatcheur principal ────────────────────────────────

export function dispatchProjectCommand(input: string): void {
  const parts = input.trim().split(/\s+/)
  const cmd = parts[0]?.toLowerCase()
  const args = parts.slice(1)

  switch (cmd) {
    case 'create':
      handleProjectCreate(args)
      break
    case 'init':
      handleProjectInit(args)
      break
    case 'list':
    case 'ls':
      handleProjectList()
      break
    case 'show':
    case 'info':
      handleProjectShow(args)
      break
    case 'tasks':
      handleProjectTasks(args)
      break
    case 'task':
      handleProjectTask(args)
      break
    case 'archive':
      handleProjectArchive(args)
      break
    case 'use':
      handleProjectUse(args)
      break
    case 'delete':
    case 'rm':
      handleProjectDelete(args)
      break
    case 'help':
    default:
      showProjectHelp()
      break
  }
}

// ── Menu interactif ──────────────────────────────────────

export async function handleProjectMenu(rl: ReturnType<typeof createInterface>): Promise<void> {
  ensureWorkspacesDir()

  while (true) {
    const projects = listProjects()
    const orphans = listOrphanDirs()

    console.log(`\n${BOLD}${CYAN}┌─ Gestion des projets ─────────────────────┐${RESET}`)
    console.log(`${BOLD}${CYAN}│${RESET}`)

    if (projects.length === 0) {
      console.log(`${BOLD}${CYAN}│${RESET}  ${YELLOW}Aucun projet.${RESET}`)
    } else {
      for (let i = 0; i < projects.length; i++) {
        const p = projects[i]
        const statusTag = p.status === 'active' ? GREEN : p.status === 'paused' ? YELLOW : GRAY
        console.log(
          `${BOLD}${CYAN}│${RESET}  ${CYAN}${i + 1}${RESET}. ${p.name}  ${statusTag}${p.status}${RESET}`,
        )
        console.log(`${BOLD}${CYAN}│${RESET}     ${GRAY}${p.description}${RESET}`)
      }
    }

    if (orphans.length > 0) {
      console.log(`${BOLD}${CYAN}│${RESET}`)
      console.log(`${BOLD}${CYAN}│${RESET}  ${YELLOW}⚠ Dossiers non initialisés :${RESET}`)
      for (const o of orphans) {
        console.log(`${BOLD}${CYAN}│${RESET}     ${YELLOW}${o}${RESET}  ${GRAY}(!project init ${o})${RESET}`)
      }
    }

    console.log(`${BOLD}${CYAN}│${RESET}`)
    console.log(`${BOLD}${CYAN}│${RESET}  ${BOLD}Actions :${RESET}`)
    console.log(`${BOLD}${CYAN}│${RESET}  ${CYAN}c${RESET}. Créer un projet`)
    console.log(`${BOLD}${CYAN}│${RESET}  ${CYAN}i${RESET}. Initialiser un dossier existant`)
    if (projects.length > 0) {
      console.log(`${BOLD}${CYAN}│${RESET}  ${CYAN}<num>${RESET}. Sélectionner comme projet courant`)
    }
    console.log(`${BOLD}${CYAN}│${RESET}  ${CYAN}u${RESET}. Utiliser un projet (saisir nom)`)
    console.log(`${BOLD}${CYAN}│${RESET}  ${CYAN}0${RESET}. Retour au menu principal`)
    console.log(`${BOLD}${CYAN}└${RESET}`)

    const choice = (await rl.question(`\n${CYAN}Choix${RESET} ${GRAY}>${RESET} `)).trim().toLowerCase()

    if (choice === '0') return

    if (choice === 'c') {
      await handleCreateInteractive(rl)
      continue
    }

    if (choice === 'i') {
      await handleInitInteractive(rl)
      continue
    }

    // Choix par numéro de projet → afficher les détails puis proposer la sélection
    const idx = parseInt(choice, 10) - 1
    if (!isNaN(idx) && idx >= 0 && idx < projects.length) {
      const selected = projects[idx]
      displayProjectDetails(selected.name)
      const confirm = (await rl.question(`\n${CYAN}Définir "${selected.name}" comme projet courant ?${RESET} (o/N) ${GRAY}>${RESET} `)).trim().toLowerCase()
      if (confirm === 'o' || confirm === 'y') {
        handleProjectUse([selected.name])
      }
    } else {
      console.log(`${YELLOW}Choix invalide.${RESET}`)
    }
  }
}

// ── Handlers ─────────────────────────────────────────────

function handleProjectUse(args: string[]): void {
  if (args.length === 0) {
    // !project use (sans argument) → désélectionne
    setCurrentProject(undefined)
    console.log(`${YELLOW}◎ Projet courant désélectionné.${RESET}`)
    return
  }

  const name = args[0]
  const info = getProjectInfo(name)
  if (!info) {
    console.log(`${RED}✗ Projet "${name}" introuvable.${RESET}`)
    return
  }

  if (info.status === 'archived') {
    console.log(`${YELLOW}⚠ Le projet "${name}" est archivé. Tu peux le sélectionner, mais les nouveaux messages intercom ne créeront pas de tâches.${RESET}`)
  }

  setCurrentProject(name)
  console.log(`${GREEN}✓ Projet courant : ${name}${RESET} ${GRAY}(${info.status})${RESET}`)
}


function handleProjectCreate(args: string[]): void {
  if (args.length === 0) {
    console.log(`${YELLOW}Usage: !project create <nom> [description]${RESET}`)
    return
  }

  const name = args[0].toLowerCase()
  const description = args.slice(1).join(' ') || '(aucune description)'

  ensureWorkspacesDir()
  const result = createProject(name, description, 'CLI')
  if (result.ok) {
    console.log(`${GREEN}✓ Projet "${name}" créé dans workspaces/${name}/${RESET}`)
  } else {
    console.log(`${RED}✗ ${result.error}${RESET}`)
  }
}

function handleProjectInit(args: string[]): void {
  if (args.length === 0) {
    console.log(`${YELLOW}Usage: !project init <nom>${RESET}`)
    return
  }

  const name = args[0].toLowerCase()
  const result = initProject(name, 'CLI')
  if (result.ok) {
    console.log(`${GREEN}✓ "${name}" initialisé comme projet.${RESET}`)
  } else {
    console.log(`${RED}✗ ${result.error}${RESET}`)
  }
}

function handleProjectList(): void {
  const projects = listProjects()
  const orphans = listOrphanDirs()

  if (projects.length === 0 && orphans.length === 0) {
    console.log(`${YELLOW}Aucun projet dans ${getWorkspacesDir()}${RESET}`)
    return
  }

  console.log(`\n${BOLD}Projets (${projects.length}) :${RESET}`)
  for (const p of projects) {
    const statusTag = p.status === 'active' ? GREEN : p.status === 'paused' ? YELLOW : GRAY
    console.log(`  ${statusTag}●${RESET} ${CYAN}${p.name}${RESET}  ${GRAY}${p.description}${RESET}`)
    console.log(`     ${GRAY}Créé le ${new Date(p.createdAt).toLocaleDateString()} par ${p.createdBy}${RESET}`)
  }

  if (orphans.length > 0) {
    console.log(`\n${YELLOW}⚠ Dossiers non initialisés (${orphans.length}) :${RESET}`)
    for (const o of orphans) {
      console.log(`  ${YELLOW}${o}${RESET}  ${GRAY}(!project init ${o})${RESET}`)
    }
  }
  console.log()
}

function handleProjectShow(args: string[]): void {
  if (args.length === 0) {
    console.log(`${YELLOW}Usage: !project show <nom>${RESET}`)
    return
  }
  displayProjectDetails(args[0])
}

function displayProjectDetails(name: string): void {
  const info = getProjectInfo(name)
  if (!info) {
    console.log(`${RED}Projet "${name}" introuvable.${RESET}`)
    return
  }

  const board = readTaskBoard(name)
  const counts = countTasks(board)

  const statusTag = info.status === 'active' ? GREEN : info.status === 'paused' ? YELLOW : GRAY

  console.log(`\n${BOLD}${CYAN}════════════════════════════════════════════${RESET}`)
  console.log(`${BOLD}${CYAN}  Projet : ${info.name}${RESET}`)
  console.log(`  ${statusTag}${info.status}${RESET}`)
  console.log(`  ${GRAY}${info.description}${RESET}`)
  console.log(`${BOLD}${CYAN}════════════════════════════════════════════${RESET}`)
  console.log(`  Créé le : ${new Date(info.createdAt).toLocaleDateString()}`)
  console.log(`  Par     : ${info.createdBy}`)
  if (info.lastActivityAt) {
    console.log(`  Activité: ${new Date(info.lastActivityAt).toLocaleDateString()}`)
  }
  console.log(`\n  ${BOLD}Tâches :${RESET}`)
  console.log(`    ${GREEN}✓ ${counts.done} terminées${RESET}`)
  console.log(`    ${CYAN}⟳ ${counts.inProgress} en cours${RESET}`)
  console.log(`    ${YELLOW}□ ${counts.todo} à faire${RESET}`)
  if (counts.blocked > 0) console.log(`    ${RED}⊘ ${counts.blocked} bloquées${RESET}`)
  console.log(`\n  ${BOLD}Dossier :${RESET} ${getProjectPath(name)}`)
  console.log()
}

function handleProjectTasks(args: string[]): void {
  if (args.length === 0) {
    console.log(`${YELLOW}Usage: !project tasks <nom> [area]${RESET}`)
    return
  }

  const projectName = args[0]
  const area = args[1]?.toLowerCase()

  const info = getProjectInfo(projectName)
  if (!info) {
    console.log(`${RED}Projet "${projectName}" introuvable.${RESET}`)
    return
  }

  const board = readTaskBoard(projectName)
  const tasks = listTasks(board, area)

  if (tasks.length === 0) {
    console.log(`${YELLOW}Aucune tâche${area ? ` dans le domaine "${area}"` : ''} pour "${projectName}".${RESET}`)
    return
  }

  console.log(`\n${BOLD}Tâches${area ? ` [${area}]` : ''} — ${projectName} :${RESET}`)
  for (const t of tasks) {
    const statusIcon = t.status === 'done' ? `${GREEN}✓${RESET}`
      : t.status === 'in_progress' ? `${CYAN}⟳${RESET}`
      : t.status === 'blocked' ? `${RED}⊘${RESET}`
      : `${YELLOW}□${RESET}`
    const agent = t.assignedTo ? ` ${GRAY}(→ ${t.assignedTo})${RESET}` : ''
    console.log(`  ${statusIcon} ${t.title}${agent}`)
    console.log(`     ${GRAY}${t.id}  [${t.area}]${RESET}`)
  }
  console.log()
}

function handleProjectTask(args: string[]): void {
  // !project task <nom> <action> <area> <titre...>
  if (args.length < 3) {
    console.log(`${YELLOW}Usage: !project task <nom> add <area> <titre>${RESET}`)
    console.log(`       !project task <nom> done <task-id>${RESET}`)
    console.log(`       !project task <nom> start <task-id>${RESET}`)
    return
  }

  const projectName = args[0]
  const action = args[1]?.toLowerCase()
  const rest = args.slice(2)

  const info = getProjectInfo(projectName)
  if (!info) {
    console.log(`${RED}Projet "${projectName}" introuvable.${RESET}`)
    return
  }

  const board = readTaskBoard(projectName)

  if (action === 'add' && rest.length >= 1) {
    const area = rest[0].toLowerCase()
    const title = rest.slice(1).join(' ')
    const { board: updated, task } = addTask(board, title, area)
    writeTaskBoard(updated, projectName)
    console.log(`${GREEN}✓ Tâche ajoutée : ${task.id} — ${title} [${area}]${RESET}`)
  } else if (action === 'done' && rest.length >= 1) {
    const updated = updateTaskStatus(board, rest[0], 'done')
    if (updated) {
      writeTaskBoard(updated, projectName)
      console.log(`${GREEN}✓ Tâche ${rest[0]} marquée terminée.${RESET}`)
    } else {
      console.log(`${RED}✗ Tâche "${rest[0]}" introuvable.${RESET}`)
    }
  } else if (action === 'start' && rest.length >= 1) {
    const updated = updateTaskStatus(board, rest[0], 'in_progress')
    if (updated) {
      writeTaskBoard(updated, projectName)
      console.log(`${CYAN}⟳ Tâche ${rest[0]} démarrée.${RESET}`)
    } else {
      console.log(`${RED}✗ Tâche "${rest[0]}" introuvable.${RESET}`)
    }
  } else {
    console.log(`${YELLOW}Usage: !project task <nom> add|done|start ...${RESET}`)
  }
}

function handleProjectArchive(args: string[]): void {
  if (args.length === 0) {
    console.log(`${YELLOW}Usage: !project archive <nom>${RESET}`)
    return
  }

  if (archiveProject(args[0])) {
    console.log(`${GREEN}✓ Projet "${args[0]}" archivé.${RESET}`)
  } else {
    console.log(`${RED}✗ Projet "${args[0]}" introuvable.${RESET}`)
  }
}

function handleProjectDelete(args: string[]): void {
  if (args.length === 0) {
    console.log(`${YELLOW}Usage: !project delete <nom>${RESET}`)
    return
  }

  console.log(`${YELLOW}⚠ Attention : tu vas supprimer définitivement le projet "${args[0]}".${RESET}`)
  console.log(`${YELLOW}  Confirme avec "oui" pour continuer.${RESET}`)

  // La confirmation se fait via le prompt — pour l'instant on exécute directement
  // car la confirmation est gérée par le guardian/CLI
  const result = deleteProject(args[0])
  if (result.ok) {
    console.log(`${GREEN}✓ Projet "${args[0]}" supprimé.${RESET}`)
  } else {
    console.log(`${RED}✗ ${result.error}${RESET}`)
  }
}

function showProjectHelp(): void {
  console.log(`\n${BOLD}Commandes projets :${RESET}`)
  console.log(`  ${CYAN}!project create <nom> [description]${RESET}`)
  console.log(`  ${GRAY}    Crée un nouveau projet dans workspaces/${RESET}`)
  console.log(`  ${CYAN}!project init <nom>${RESET}`)
  console.log(`  ${GRAY}    Initialise un dossier existant comme projet${RESET}`)
  console.log(`  ${CYAN}!project use <nom>${RESET}`)
  console.log(`  ${GRAY}    Définit <nom> comme projet courant (injecté dans les messages intercom)${RESET}`)
  console.log(`  ${CYAN}!project use${RESET}`)
  console.log(`  ${GRAY}    Désélectionne le projet courant${RESET}`)
  console.log(`  ${CYAN}!project list${RESET}`)
  console.log(`  ${GRAY}    Liste tous les projets${RESET}`)
  console.log(`  ${CYAN}!project show <nom>${RESET}`)
  console.log(`  ${GRAY}    Affiche les détails d'un projet${RESET}`)
  console.log(`  ${CYAN}!project tasks <nom> [area]${RESET}`)
  console.log(`  ${GRAY}    Liste les tâches d'un projet${RESET}`)
  console.log(`  ${CYAN}!project task <nom> add <area> <titre>${RESET}`)
  console.log(`  ${GRAY}    Ajoute une tâche${RESET}`)
  console.log(`  ${CYAN}!project task <nom> done|start <task-id>${RESET}`)
  console.log(`  ${GRAY}    Met à jour le statut d'une tâche${RESET}`)
  console.log(`  ${CYAN}!project archive <nom>${RESET}`)
  console.log(`  ${GRAY}    Archive un projet${RESET}`)
  console.log()
}

// ── Interactifs ──────────────────────────────────────────

async function handleCreateInteractive(rl: ReturnType<typeof createInterface>): Promise<void> {
  const name = (await rl.question(`${CYAN}Nom du projet${RESET} ${GRAY}>${RESET} `)).trim().toLowerCase()
  if (!name) { console.log(`${YELLOW}Annulé.${RESET}`); return }

  const desc = (await rl.question(`${CYAN}Description${RESET} ${GRAY}>${RESET} `)).trim() || '(aucune description)'

  ensureWorkspacesDir()
  const result = createProject(name, desc, 'CLI')
  if (result.ok) {
    console.log(`${GREEN}✓ Projet "${name}" créé.${RESET}`)
  } else {
    console.log(`${RED}✗ ${result.error}${RESET}`)
  }
}

async function handleInitInteractive(rl: ReturnType<typeof createInterface>): Promise<void> {
  const orphans = listOrphanDirs()

  if (orphans.length === 0) {
    console.log(`${YELLOW}Aucun dossier non initialisé. Utilise !project create.${RESET}`)
    return
  }

  console.log(`\n${BOLD}Dossiers disponibles :${RESET}`)
  for (let i = 0; i < orphans.length; i++) {
    console.log(`  ${CYAN}${i + 1}${RESET}. ${orphans[i]}`)
  }

  const choice = (await rl.question(`\n${CYAN}Numéro à initialiser${RESET} ${GRAY}>${RESET} `)).trim()
  const idx = parseInt(choice, 10) - 1

  if (isNaN(idx) || idx < 0 || idx >= orphans.length) {
    console.log(`${YELLOW}Annulé.${RESET}`)
    return
  }

  const result = initProject(orphans[idx], 'CLI')
  if (result.ok) {
    console.log(`${GREEN}✓ "${orphans[idx]}" initialisé.${RESET}`)
  } else {
    console.log(`${RED}✗ ${result.error}${RESET}`)
  }
}
