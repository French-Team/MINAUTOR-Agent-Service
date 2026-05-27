/**
 * Types partagés pour la gestion des projets (workspaces/) et du tableau des tâches.
 *
 * Référence : workspace-isolation-spec.md — Section 3
 */

export type ProjectStatus = 'active' | 'paused' | 'archived'

export interface ProjectInfo {
  name: string
  createdAt: string       // ISO 8601
  createdBy: string       // agent ID
  status: ProjectStatus
  description: string
  lastActivityAt?: string // ISO 8601
}

export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'blocked' | 'cancelled'

export interface TaskEntry {
  id: string
  title: string
  area: string            // 'frontend', 'backend', 'docs', 'infra', etc.
  status: TaskStatus
  assignedTo?: string     // agent ID
  createdAt: string       // ISO 8601
  completedAt?: string    // ISO 8601
  dependsOn?: string[]    // IDs des tâches prérequises
}

export interface TaskBoard {
  project: string
  lastUpdated: string     // ISO 8601
  tasks: TaskEntry[]
}
