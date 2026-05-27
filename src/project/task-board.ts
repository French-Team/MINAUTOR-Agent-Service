/**
 * Task Board — Gestion du tableau des tâches (.tasks.json).
 *
 * Règles de séquencement (spec §7) :
 * - Tâches dans le MÊME domaine → séquentielles (1 à la fois)
 * - Tâches dans des domaines DIFFÉRENTS → parallélisables
 * - Ne jamais donner toutes les missions à un même agent
 * - Délégation séquentielle au fil de l'avancement
 *
 * Fichiers :
 *   workspaces/.tasks.json          — Tableau global (orchestrateur)
 *   workspaces/<projet>/.tasks.json — Tableau par projet
 */

import { readFileSync, existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { TaskEntry, TaskBoard, TaskStatus } from './types.js'

const WORKSPACES_DIR = join(process.cwd(), 'workspaces')

// ── Chemins ──────────────────────────────────────────────

function getGlobalBoardPath(): string {
  return join(WORKSPACES_DIR, '.tasks.json')
}

function getProjectBoardPath(projectName: string): string {
  return join(WORKSPACES_DIR, projectName, '.tasks.json')
}

// ── Lecture / Écriture ──────────────────────────────────

/**
 * Lit le tableau des tâches d'un projet (ou global).
 * Retourne un board vide si le fichier n'existe pas.
 */
export function readTaskBoard(projectName?: string): TaskBoard {
  const filePath = projectName
    ? getProjectBoardPath(projectName)
    : getGlobalBoardPath()

  if (!existsSync(filePath)) {
    return {
      project: projectName ?? '(global)',
      lastUpdated: new Date().toISOString(),
      tasks: [],
    }
  }

  try {
    const raw = readFileSync(filePath, 'utf-8')
    return JSON.parse(raw) as TaskBoard
  } catch {
    return {
      project: projectName ?? '(global)',
      lastUpdated: new Date().toISOString(),
      tasks: [],
    }
  }
}

/**
 * Écrit le tableau des tâches.
 */
export function writeTaskBoard(board: TaskBoard, projectName?: string): boolean {
  try {
    const filePath = projectName
      ? getProjectBoardPath(projectName)
      : getGlobalBoardPath()

    board.lastUpdated = new Date().toISOString()
    writeFileSync(filePath, JSON.stringify(board, null, 2), 'utf-8')
    return true
  } catch {
    return false
  }
}

// ── Gestion des tâches ──────────────────────────────────

let _taskCounter = 0

function generateTaskId(): string {
  _taskCounter++
  const ts = Date.now().toString(36)
  return `task-${ts}-${_taskCounter}`
}

/**
 * Ajoute une tâche au board.
 */
export function addTask(
  board: TaskBoard,
  title: string,
  area: string,
  dependsOn?: string[],
): { board: TaskBoard; task: TaskEntry } {
  const task: TaskEntry = {
    id: generateTaskId(),
    title,
    area,
    status: 'todo',
    createdAt: new Date().toISOString(),
    dependsOn,
  }

  board.tasks.push(task)
  return { board, task }
}

/**
 * Met à jour le statut d'une tâche.
 */
export function updateTaskStatus(
  board: TaskBoard,
  taskId: string,
  status: TaskStatus,
  assignedTo?: string,
): TaskBoard | null {
  const task = board.tasks.find((t) => t.id === taskId)
  if (!task) return null

  task.status = status
  if (status === 'done' || status === 'cancelled') {
    task.completedAt = new Date().toISOString()
  }
  if (assignedTo) {
    task.assignedTo = assignedTo
  }
  return board
}

/**
 * Met à jour les champs d'une tâche.
 */
export function updateTask(
  board: TaskBoard,
  taskId: string,
  updates: Partial<TaskEntry>,
): TaskBoard | null {
  const task = board.tasks.find((t) => t.id === taskId)
  if (!task) return null

  Object.assign(task, updates)
  if (updates.status === 'done' || updates.status === 'cancelled') {
    task.completedAt = new Date().toISOString()
  }
  return board
}

/**
 * Liste les tâches, optionnellement filtrées par domaine.
 */
export function listTasks(board: TaskBoard, area?: string): TaskEntry[] {
  let tasks = board.tasks
  if (area) {
    tasks = tasks.filter((t) => t.area === area)
  }
  return [...tasks].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

/**
 * Retourne la prochaine tâche disponible pour un domaine donné.
 * Vérifie les dépendances : une tâche avec dependsOn n'est disponible
 * que si toutes ses dépendances sont 'done'.
 */
export function getNextTask(board: TaskBoard, area?: string): TaskEntry | null {
  const filtered = area
    ? board.tasks.filter((t) => t.area === area && t.status === 'todo')
    : board.tasks.filter((t) => t.status === 'todo')

  // Trier par date de création (FIFO)
  const sorted = filtered.sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  // Vérifier les dépendances
  for (const task of sorted) {
    if (!task.dependsOn || task.dependsOn.length === 0) {
      return task
    }
    // Vérifier que toutes les dépendances sont terminées
    const allDepsDone = task.dependsOn.every((depId) => {
      const dep = board.tasks.find((t) => t.id === depId)
      return dep?.status === 'done'
    })
    if (allDepsDone) {
      return task
    }
  }

  return null
}

/**
 * Vérifie si une nouvelle tâche peut être assignée dans un domaine donné.
 * Règle : séquentiel par domaine → si une tâche 'in_progress' existe,
 * on ne peut pas en assigner une autre dans le même domaine.
 */
export function canAssignTask(board: TaskBoard, area: string): boolean {
  const inProgress = board.tasks.filter(
    (t) => t.area === area && t.status === 'in_progress',
  )
  return inProgress.length === 0
}

/**
 * Compte les tâches par statut.
 */
export function countTasks(
  board: TaskBoard,
): { todo: number; inProgress: number; done: number; blocked: number; cancelled: number } {
  const counts = { todo: 0, inProgress: 0, done: 0, blocked: 0, cancelled: 0 }
  for (const t of board.tasks) {
    switch (t.status) {
      case 'todo': counts.todo++; break
      case 'in_progress': counts.inProgress++; break
      case 'done': counts.done++; break
      case 'blocked': counts.blocked++; break
      case 'cancelled': counts.cancelled++; break
    }
  }
  return counts
}
