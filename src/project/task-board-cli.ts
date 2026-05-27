#!/usr/bin/env node
/**
 * task-board-cli.ts — Interface CLI pour que l'orchestrateur lise et modifie
 * le tableau des tâches (.tasks.json) via run_terminal_command.
 *
 * Usage (depuis un agent) :
 *   node dist/project/task-board-cli.js read <project> [area]
 *   node dist/project/task-board-cli.js next <project> [area]
 *   node dist/project/task-board-cli.js start <project> <task-id> [agent]
 *   node dist/project/task-board-cli.js done <project> <task-id>
 *   node dist/project/task-board-cli.js pending <project> [area]
 *   node dist/project/task-board-cli.js can-assign <project> <area>
 *   node dist/project/task-board-cli.js add <project> <area> <title>
 *   node dist/project/task-board-cli.js summary <project>
 *   node dist/project/task-board-cli.js status <project> <task-id>
 *
 * Toutes les commandes retournent du texte formaté pour être lu par un LLM.
 */

import { existsSync } from 'fs'
import { join } from 'path'
import {
  readTaskBoard,
  writeTaskBoard,
  addTask,
  updateTaskStatus,
  getNextTask,
  canAssignTask,
  listTasks,
  countTasks,
} from './task-board.js'
import type { TaskBoard, TaskEntry } from './types.js'
import { getProjectInfo } from './project-manager.js'

const WORKSPACES_DIR = join(process.cwd(), 'workspaces')

function plural(n: number, s: string): string {
  const addS = n !== 1 && !s.endsWith('s')
  return `${n} ${s}${addS ? 's' : ''}`
}

function statusEmoji(status: string): string {
  switch (status) {
    case 'todo': return '⬜'
    case 'in_progress': return '🔄'
    case 'done': return '✅'
    case 'blocked': return '🚫'
    case 'cancelled': return '❌'
    default: return '❓'
  }
}

function cmdRead(project: string, area?: string): string {
  if (!existsSync(join(WORKSPACES_DIR, project))) {
    return `ERR: Projet "${project}" introuvable dans workspaces/.`
  }

  const board = readTaskBoard(project)
  const tasks = area ? listTasks(board, area) : board.tasks

  if (tasks.length === 0) {
    const areaHint = area ? ` dans le domaine "${area}"` : ''
    return `📋 Tableau des tâches pour ${project}${areaHint} :\n  Aucune tâche.`
  }

  const lines: string[] = [
    `📋 Tableau des tâches : ${project}`,
    `   Total: ${tasks.length} | ${plural(countTasks(board).todo, 'todo')} | ${plural(countTasks(board).inProgress, 'en cours')} | ${plural(countTasks(board).done, 'terminée')}`,
    '',
  ]

  if (area) {
    lines.push(`   Filtre domaine : ${area}`)
    lines.push('')
  }

  for (const t of tasks) {
    const deps = t.dependsOn && t.dependsOn.length > 0
      ? ` [attend: ${t.dependsOn.join(', ')}]` : ''
    const assignee = t.assignedTo ? ` → ${t.assignedTo}` : ''
    lines.push(`   ${statusEmoji(t.status)} ${t.id} ${t.title} [${t.area}]${assignee}${deps}`)
  }

  return lines.join('\n')
}

function cmdNext(project: string, area?: string): string {
  if (!existsSync(join(WORKSPACES_DIR, project))) {
    return `ERR: Projet "${project}" introuvable dans workspaces/.`
  }

  const board = readTaskBoard(project)
  const task = getNextTask(board, area)

  if (!task) {
    // Vérifier s'il y a des tâches en cours qui bloquent
    const inProgress = board.tasks.filter(
      t => t.status === 'in_progress' && (!area || t.area === area)
    )
    const todo = board.tasks.filter(
      t => t.status === 'todo' && (!area || t.area === area)
    )

    if (inProgress.length > 0) {
      const blockedBy = inProgress.map(t => `${t.id} (${t.area})`).join(', ')
      return `⏳ Aucune tâche disponible pour le domaine${area ? ` "${area}"` : ''}.
   Tâche(s) en cours qui bloquent le séquencement : ${blockedBy}
   Règle : séquentiel par domaine — une seule tâche à la fois.
   Terminez d'abord la tâche en cours avant de passer à la suivante.

   Domaine(s) parallélisable(s) disponible(s) : ${getAvailableDomains(board, area)}`
    }

    if (todo.length > 0) {
      return `⏳ ${todo.length} tâche(s) en attente mais dépendances non résolues.
   Utilisez "status" pour voir les détails de chaque tâche.`
    }

    return `✅ Aucune tâche en attente pour le projet "${project}"${area ? ` (domaine: ${area})` : ''}.
   Toutes les tâches sont terminées ou en cours.`
  }

  return `📌 Prochaine tâche disponible :
   ID: ${task.id}
   Titre: ${task.title}
   Domaine: ${task.area}
   Statut: ${task.status}
   Créée: ${task.createdAt.slice(0, 10)}
   Dépendances: ${task.dependsOn && task.dependsOn.length > 0 ? task.dependsOn.join(', ') : 'aucune'}

Pour assigner cette tâche : node dist/project/task-board-cli.js start ${project} ${task.id} <agent-id>`
}

function getAvailableDomains(board: TaskBoard, currentArea?: string): string {
  const areas = new Set(board.tasks.map(t => t.area))
  const available: string[] = []

  for (const area of areas) {
    if (area === currentArea) continue
    if (canAssignTask(board, area) && board.tasks.some(t => t.area === area && t.status === 'todo')) {
      available.push(area)
    }
  }

  return available.length > 0 ? available.join(', ') : 'aucun'
}

function cmdStart(project: string, taskId: string, agent?: string): string {
  if (!existsSync(join(WORKSPACES_DIR, project))) {
    return `ERR: Projet "${project}" introuvable dans workspaces/.`
  }

  const board = readTaskBoard(project)
  const task = board.tasks.find(t => t.id === taskId)

  if (!task) {
    return `ERR: Tâche "${taskId}" introuvable dans le projet "${project}".`
  }

  if (task.status === 'in_progress') {
    return `⚠ Tâche "${taskId}" déjà en cours${task.assignedTo ? ` (assignée à ${task.assignedTo})` : ''}.`
  }

  if (task.status === 'done') {
    return `⚠ Tâche "${taskId}" déjà terminée.`
  }

  // Vérifier le séquencement
  if (!canAssignTask(board, task.area)) {
    const inProgress = board.tasks.filter(
      t => t.area === task.area && t.status === 'in_progress'
    )
    return `⛔ Domaine "${task.area}" bloqué : ${inProgress.length} tâche(s) en cours.
   Terminez d'abord : ${inProgress.map(t => `${t.id} (${t.title})`).join(', ')}
   Règle : séquentiel par domaine — une seule tâche à la fois.`
  }

  const updated = updateTaskStatus(board, taskId, 'in_progress', agent)
  if (!updated) return `ERR: Impossible de mettre à jour la tâche "${taskId}".`

  writeTaskBoard(updated, project)

  const assignee = agent ? ` → ${agent}` : ''
  return `✅ Tâche "${task.title}" (${taskId}) démarrée${assignee}.
   Domaine: ${task.area}
   Plus aucune tâche disponible dans le domaine "${task.area}" tant que celle-ci n'est pas terminée.`
}

function cmdDone(project: string, taskId: string): string {
  if (!existsSync(join(WORKSPACES_DIR, project))) {
    return `ERR: Projet "${project}" introuvable dans workspaces/.`
  }

  const board = readTaskBoard(project)
  const task = board.tasks.find(t => t.id === taskId)

  if (!task) {
    return `ERR: Tâche "${taskId}" introuvable dans le projet "${project}".`
  }

  if (task.status === 'done') {
    return `⚠ Tâche "${taskId}" déjà marquée comme terminée.`
  }

  const updated = updateTaskStatus(board, taskId, 'done')
  if (!updated) return `ERR: Impossible de mettre à jour la tâche "${taskId}".`

  writeTaskBoard(updated, project)

  // Trouver la prochaine tâche dans le même domaine (si existe)
  const nextTask = getNextTask(updated, task.area)

  const lines = [
    `✅ Tâche "${task.title}" (${taskId}) marquée comme terminée.`,
    `   Domaine: ${task.area}`,
    `   Assignée à: ${task.assignedTo || '(non spécifié)'}`,
  ]

  if (nextTask) {
    lines.push('')
    lines.push(`📌 Prochaine tâche disponible dans le domaine "${task.area}" :`)
    lines.push(`   ${nextTask.id} — ${nextTask.title}`)
    lines.push(`   Pour lancer : node dist/project/task-board-cli.js start ${project} ${nextTask.id} <agent-id>`)
  } else {
    const board2 = readTaskBoard(project) // re-read to be safe
    const todoInArea = board2.tasks.filter(t => t.area === task.area && t.status === 'todo')
    if (todoInArea.length > 0) {
      lines.push('')
      lines.push(`⏳ ${todoInArea.length} tâche(s) en attente dans le domaine "${task.area}" (dépendances non résolues).`)
    } else {
      lines.push('')
      lines.push(`✅ Domaine "${task.area}" : toutes les tâches sont terminées.`)
      const board2 = readTaskBoard(project)
      const otherAreas = new Set(
        board2.tasks.filter(t => t.status === 'todo').map(t => t.area)
      )
      if (otherAreas.size > 0) {
        lines.push(`   Domaines avec tâches en attente : ${[...otherAreas].join(', ')}`)
      }
    }
  }

  return lines.join('\n')
}

function cmdPending(project: string, area?: string): string {
  if (!existsSync(join(WORKSPACES_DIR, project))) {
    return `ERR: Projet "${project}" introuvable dans workspaces/.`
  }

  const board = readTaskBoard(project)
  const pending = board.tasks.filter(
    t => (t.status === 'todo' || t.status === 'in_progress') && (!area || t.area === area)
  )

  if (pending.length === 0) {
    return `✅ Aucune tâche en attente pour "${project}"${area ? ` (domaine: ${area})` : ''}.`
  }

  const lines: string[] = [
    `⏳ Tâches en attente pour ${project} (${pending.length}) :`,
    '',
  ]

  for (const t of pending) {
    const statusIcon = t.status === 'in_progress' ? '🔄' : '⬜'
    lines.push(`   ${statusIcon} ${t.id} ${t.title} [${t.area}]${t.assignedTo ? ` → ${t.assignedTo}` : ''}`)
  }

  return lines.join('\n')
}

function cmdCanAssign(project: string, area: string): string {
  if (!existsSync(join(WORKSPACES_DIR, project))) {
    return `ERR: Projet "${project}" introuvable dans workspaces/.`
  }

  const board = readTaskBoard(project)
  const canAssign = canAssignTask(board, area)

  if (canAssign) {
    const next = getNextTask(board, area)
    if (next) {
      return `✅ Domaine "${area}" disponible.
   Prochaine tâche : ${next.id} — ${next.title}
   Pour lancer : node dist/project/task-board-cli.js start ${project} ${next.id} <agent-id>`
    }
    return `✅ Domaine "${area}" disponible mais aucune tâche en attente.`
  }

  const inProgress = board.tasks.filter(
    t => t.area === area && t.status === 'in_progress'
  )
  return `⛔ Domaine "${area}" occupé : ${inProgress.length} tâche(s) en cours.
   ${inProgress.map(t => `${t.id} — ${t.title}${t.assignedTo ? ` (${t.assignedTo})` : ''}`).join('\n   ')}
   Règle : séquentiel par domaine — une seule tâche à la fois dans le même domaine.`
}

function cmdAdd(project: string, area: string, title: string): string {
  if (!existsSync(join(WORKSPACES_DIR, project))) {
    return `ERR: Projet "${project}" introuvable dans workspaces/.`
  }

  const board = readTaskBoard(project)
  const { task } = addTask(board, title, area)
  writeTaskBoard(board, project)

  return `✅ Tâche ajoutée :
   ID: ${task.id}
   Titre: ${task.title}
   Domaine: ${task.area}
   Statut: ${task.status}
   Projet: ${project}

Pour lancer cette tâche : node dist/project/task-board-cli.js start ${project} ${task.id} <agent-id>`
}

function cmdStatus(project: string, taskId: string): string {
  if (!existsSync(join(WORKSPACES_DIR, project))) {
    return `ERR: Projet "${project}" introuvable dans workspaces/.`
  }

  const board = readTaskBoard(project)
  const task = board.tasks.find(t => t.id === taskId)

  if (!task) {
    return `ERR: Tâche "${taskId}" introuvable dans le projet "${project}".`
  }

  // Vérifier les dépendances
  let depsStatus = 'aucune'
  if (task.dependsOn && task.dependsOn.length > 0) {
    const deps = task.dependsOn.map(depId => {
      const dep = board.tasks.find(t => t.id === depId)
      return dep ? `${dep.id}: ${dep.status} (${dep.title})` : `${depId}: introuvable`
    })
    depsStatus = deps.join('\n      ')
  }

  return `📌 Détail de la tâche ${taskId} :
   Titre: ${task.title}
   Domaine: ${task.area}
   Statut: ${statusEmoji(task.status)} ${task.status}
   Assignée à: ${task.assignedTo || '(non assignée)'}
   Créée: ${task.createdAt.slice(0, 19).replace('T', ' ')}
   Terminée: ${task.completedAt ? task.completedAt.slice(0, 19).replace('T', ' ') : '—'}
   Dépendances: ${depsStatus}`
}

function cmdSummary(project: string): string {
  if (!existsSync(join(WORKSPACES_DIR, project))) {
    return `ERR: Projet "${project}" introuvable dans workspaces/.`
  }

  const board = readTaskBoard(project)
  const counts = countTasks(board)

  // Regrouper par domaine
  const byArea = new Map<string, { todo: number; inProgress: number; done: number }>()
  for (const t of board.tasks) {
    if (!byArea.has(t.area)) {
      byArea.set(t.area, { todo: 0, inProgress: 0, done: 0 })
    }
    const area = byArea.get(t.area)!
    if (t.status === 'todo') area.todo++
    else if (t.status === 'in_progress') area.inProgress++
    else if (t.status === 'done') area.done++
  }

  const projInfo = getProjectInfo(project)
  const status = projInfo ? projInfo.status : '?'

  const lines: string[] = [
    `📊 Résumé du projet "${project}" [${status}]`,
    `   ${plural(counts.todo, 'todo')} | ${plural(counts.inProgress, 'en cours')} | ${plural(counts.done, 'terminée')} | ${plural(counts.blocked + counts.cancelled, 'autre')}`,
    `   Total: ${board.tasks.length} tâche(s)`,
    '',
    `   Par domaine :`,
  ]

  for (const [area, c] of byArea) {
    const canAssign = canAssignTask(board, area)
    const next = getNextTask(board, area)
    const assignable = canAssign && next ? '✓ disponible' : canAssign ? '✓ libre (rien en attente)' : '⛔ occupé'
    const inProgStr = c.inProgress > 0 ? ` | ${c.inProgress} en cours` : ''
    lines.push(`     ${area.padEnd(15)} ${c.todo} todo${inProgStr} | ${c.done} done | ${assignable}`)
  }

  // Tâche en cours
  const inProgress = board.tasks.filter(t => t.status === 'in_progress')
  if (inProgress.length > 0) {
    lines.push('')
    lines.push(`   En cours actuellement :`)
    for (const t of inProgress) {
      lines.push(`     🔄 ${t.id} ${t.title} [${t.area}]${t.assignedTo ? ` → ${t.assignedTo}` : ''}`)
    }
  }

  lines.push('')
  lines.push(`Pour voir les tâches : node dist/project/task-board-cli.js read ${project}`)
  lines.push(`Pour la prochaine disponible : node dist/project/task-board-cli.js next ${project}`)

  return lines.join('\n')
}

function showHelp(): void {
  console.log(`task-board-cli — Gestion du tableau des tâches pour l'orchestrateur

Usage:
  node dist/project/task-board-cli.js read <project> [area]
    Affiche toutes les tâches d'un projet, filtrées par domaine optionnel.

  node dist/project/task-board-cli.js next <project> [area]
    Retourne la prochaine tâche disponible (FIFO, dépendances vérifiées).

  node dist/project/task-board-cli.js start <project> <task-id> [agent]
    Marque une tâche comme "en cours" et l'assigne à un agent.

  node dist/project/task-board-cli.js done <project> <task-id>
    Marque une tâche comme terminée. Suggère la suivante dans le même domaine.

  node dist/project/task-board-cli.js pending <project> [area]
    Liste les tâches en attente (todo + in_progress).

  node dist/project/task-board-cli.js can-assign <project> <area>
    Vérifie si une nouvelle tâche peut être assignée dans ce domaine.
    Règle : séquentiel par domaine — une seule tâche à la fois.

  node dist/project/task-board-cli.js add <project> <area> <title>
    Ajoute une nouvelle tâche au projet.

  node dist/project/task-board-cli.js status <project> <task-id>
    Affiche les détails d'une tâche spécifique.

  node dist/project/task-board-cli.js summary <project>
    Résumé complet du projet : stats, domaines, tâche en cours.

Règles de séquencement :
  - Même domaine → séquentiel (1 tâche à la fois)
  - Domaines différents → parallélisable
  - Dépendances → vérifiées automatiquement via dependsOn[]
`)
}

function main(): void {
  const [command, ...args] = process.argv.slice(2)

  switch (command) {
    case 'read': {
      const [project, area] = args
      if (!project) { console.log('Usage: task-board-cli read <project> [area]'); process.exit(1) }
      console.log(cmdRead(project, area))
      break
    }
    case 'next': {
      const [project, area] = args
      if (!project) { console.log('Usage: task-board-cli next <project> [area]'); process.exit(1) }
      console.log(cmdNext(project, area))
      break
    }
    case 'start': {
      const [project, taskId, agent] = args
      if (!project || !taskId) { console.log('Usage: task-board-cli start <project> <task-id> [agent]'); process.exit(1) }
      console.log(cmdStart(project, taskId, agent))
      break
    }
    case 'done': {
      const [project, taskId] = args
      if (!project || !taskId) { console.log('Usage: task-board-cli done <project> <task-id>'); process.exit(1) }
      console.log(cmdDone(project, taskId))
      break
    }
    case 'pending': {
      const [project, area] = args
      if (!project) { console.log('Usage: task-board-cli pending <project> [area]'); process.exit(1) }
      console.log(cmdPending(project, area))
      break
    }
    case 'can-assign': {
      const [project, area] = args
      if (!project || !area) { console.log('Usage: task-board-cli can-assign <project> <area>'); process.exit(1) }
      console.log(cmdCanAssign(project, area))
      break
    }
    case 'add': {
      const [project, area, ...titleParts] = args
      if (!project || !area || titleParts.length === 0) { console.log('Usage: task-board-cli add <project> <area> <title>'); process.exit(1) }
      console.log(cmdAdd(project, area, titleParts.join(' ')))
      break
    }
    case 'status': {
      const [project, taskId] = args
      if (!project || !taskId) { console.log('Usage: task-board-cli status <project> <task-id>'); process.exit(1) }
      console.log(cmdStatus(project, taskId))
      break
    }
    case 'summary': {
      const [project] = args
      if (!project) { console.log('Usage: task-board-cli summary <project>'); process.exit(1) }
      console.log(cmdSummary(project))
      break
    }
    case 'help':
    case '--help':
    case '-h':
      showHelp()
      break
    default:
      console.log(`Usage: node dist/project/task-board-cli.js <command> [args...]`)
      console.log(`  Commands: read, next, start, done, pending, can-assign, add, status, summary`)
      console.log(`  Pour plus d'aide : node dist/project/task-board-cli.js help`)
      process.exit(1)
  }
}

// Appel direct ou export pour les tests
if (process.argv[1]?.endsWith('task-board-cli.js') || process.argv[1]?.endsWith('task-board-cli.ts')) {
  main()
}
