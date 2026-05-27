/**
 * Project Manager — Gestion des projets dans workspaces/.
 *
 * Responsabilités :
 * 1. Créer un projet (workspaces/<name>/ + .workspace + .tasks.json)
 * 2. Initialiser un dossier déposé par l'utilisateur (.workspace marker)
 * 3. Lister les projets existants
 * 4. Supprimer / archiver un projet
 * 5. Détecter les dossiers orphelins (sans .workspace)
 *
 * Référence : workspace-isolation-spec.md — Section 3
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync, statSync, rmSync } from 'fs'
import { join } from 'path'
import type { ProjectInfo, ProjectStatus } from './types.js'
import { writeTaskBoard } from './task-board.js'
import { ensureSandbox } from './sandbox.js'

const WORKSPACES_DIR = join(process.cwd(), 'workspaces')

// ── Chemins ──────────────────────────────────────────────

export function getWorkspacesDir(): string {
  return WORKSPACES_DIR
}

export function getProjectPath(name: string): string {
  return join(WORKSPACES_DIR, name)
}

function getWorkspaceFilePath(projectPath: string): string {
  return join(projectPath, '.workspace')
}

function getReadmePath(): string {
  return join(WORKSPACES_DIR, 'README.md')
}

// ── Bootstrap ────────────────────────────────────────────

/**
 * Crée workspaces/ et son README.md si absent.
 */
export function ensureWorkspacesDir(): void {
  if (!existsSync(WORKSPACES_DIR)) {
    mkdirSync(WORKSPACES_DIR, { recursive: true })
  }
  if (!existsSync(getReadmePath())) {
    createWorkspaceReadme()
  }
  // Créer le sandbox pour les agents sans projet
  ensureSandbox()
}

function createWorkspaceReadme(): void {
  const readme = `# Workspaces — Projets utilisateur

Ce dossier contient tous les projets créés ou importés par les agents.

## Structure

\`\`\`
workspaces/
├── <nom-du-projet>/
│   ├── .workspace     # Marqueur de projet (fichier YAML)
│   ├── .tasks.json    # Tableau des tâches du projet
│   └── ...            # Fichiers du projet
└── README.md          # Ce fichier
\`\`\`

## Commandes

- \`!project create <nom> [description]\` — Crée un nouveau projet
- \`!project list\` — Liste tous les projets
- \`!project init <nom>\` — Marque un dossier existant comme projet
- \`!project show <nom>\` — Affiche les infos d'un projet
- \`!project tasks <nom>\` — Affiche les tâches d'un projet
- \`!project archive <nom>\` — Archive un projet

## Notes

- Les dossiers sans \`.workspace\` sont ignorés par le système.
- Pour utiliser un dossier existant : \`!project init <nom>\`
- Le fichier \`.tasks.json\` est géré par l'orchestrateur.
`

  writeFileSync(getReadmePath(), readme, 'utf-8')
}

// ── Création de projet ──────────────────────────────────

/**
 * Crée un nouveau projet dans workspaces/.
 * Initialise .workspace + .tasks.json vide.
 */
export function createProject(
  name: string,
  description: string,
  createdBy: string,
): { ok: boolean; error?: string } {
  // Validation du nom
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) {
    return {
      ok: false,
      error:
        'Nom invalide. Utilise uniquement des lettres minuscules, chiffres, tirets et underscores. Commence par une lettre ou un chiffre.',
    }
  }

  const projectPath = getProjectPath(name)

  if (existsSync(projectPath)) {
    return { ok: false, error: `Le projet "${name}" existe déjà.` }
  }

  try {
    mkdirSync(projectPath, { recursive: true })

    // .workspace marker
    const now = new Date().toISOString()
    const workspaceInfo: ProjectInfo = {
      name,
      createdAt: now,
      createdBy,
      status: 'active',
      description,
    }
    writeWorkspaceFile(projectPath, workspaceInfo)

    // .tasks.json vide
    writeTaskBoard({ project: name, lastUpdated: now, tasks: [] }, name)

    return { ok: true }
  } catch (err) {
    return { ok: false, error: `Erreur création projet : ${(err as Error).message}` }
  }
}

/**
 * Marque un dossier existant comme projet (crée .workspace).
 * Pour les dossiers que l'utilisateur a déposés dans workspaces/.
 */
export function initProject(
  name: string,
  createdBy: string,
): { ok: boolean; error?: string } {
  const projectPath = getProjectPath(name)

  if (!existsSync(projectPath)) {
    return { ok: false, error: `Le dossier "${name}" n'existe pas dans workspaces/.` }
  }

  if (!statSync(projectPath).isDirectory()) {
    return { ok: false, error: `"${name}" n'est pas un dossier.` }
  }

  if (existsSync(getWorkspaceFilePath(projectPath))) {
    return { ok: false, error: `"${name}" est déjà un projet initialisé.` }
  }

  try {
    const now = new Date().toISOString()
    const workspaceInfo: ProjectInfo = {
      name,
      createdAt: now,
      createdBy,
      status: 'active',
      description: '(projet importé)',
    }
    writeWorkspaceFile(projectPath, workspaceInfo)

    // .tasks.json si absent
    const tasksPath = join(projectPath, '.tasks.json')
    if (!existsSync(tasksPath)) {
      writeTaskBoard({ project: name, lastUpdated: now, tasks: [] }, name)
    }

    return { ok: true }
  } catch (err) {
    return { ok: false, error: `Erreur init projet : ${(err as Error).message}` }
  }
}

// ── Lecture ──────────────────────────────────────────────

/**
 * Liste tous les projets valides (avec .workspace).
 */
export function listProjects(): ProjectInfo[] {
  if (!existsSync(WORKSPACES_DIR)) return []

  try {
    const entries = readdirSync(WORKSPACES_DIR, { withFileTypes: true })
    const projects: ProjectInfo[] = []

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.')) continue // ignorer .sandbox, .tasks.json, etc.

      const wsPath = getWorkspaceFilePath(join(WORKSPACES_DIR, entry.name))
      if (!existsSync(wsPath)) continue

      const info = readWorkspaceFile(wsPath)
      if (info) projects.push(info)
    }

    return projects
  } catch {
    return []
  }
}

/**
 * Détecte les dossiers orphelins (dans workspaces/ mais sans .workspace).
 */
export function listOrphanDirs(): string[] {
  if (!existsSync(WORKSPACES_DIR)) return []

  try {
    const entries = readdirSync(WORKSPACES_DIR, { withFileTypes: true })
    const orphans: string[] = []

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.')) continue

      const wsPath = getWorkspaceFilePath(join(WORKSPACES_DIR, entry.name))
      if (!existsSync(wsPath)) {
        orphans.push(entry.name)
      }
    }

    return orphans
  } catch {
    return []
  }
}

/**
 * Retourne les infos d'un projet.
 */
export function getProjectInfo(name: string): ProjectInfo | null {
  const projectPath = getProjectPath(name)
  const wsPath = getWorkspaceFilePath(projectPath)
  if (!existsSync(wsPath)) return null
  return readWorkspaceFile(wsPath)
}

// ── Modification ─────────────────────────────────────────

/**
 * Archive un projet (passe son status à 'archived').
 */
export function archiveProject(name: string): boolean {
  return updateProjectStatus(name, 'archived')
}

/**
 * Supprime définitivement un projet (dossier + contenu).
 */
export function deleteProject(name: string): { ok: boolean; error?: string } {
  const projectPath = getProjectPath(name)

  if (!existsSync(projectPath)) {
    return { ok: false, error: `Le projet "${name}" n'existe pas.` }
  }

  try {
    rmSync(projectPath, { recursive: true, force: true })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: `Erreur suppression : ${(err as Error).message}` }
  }
}

// ── Internes ─────────────────────────────────────────────

function updateProjectStatus(name: string, status: ProjectStatus): boolean {
  const projectPath = getProjectPath(name)
  const wsPath = getWorkspaceFilePath(projectPath)
  if (!existsSync(wsPath)) return false

  const info = readWorkspaceFile(wsPath)
  if (!info) return false

  info.status = status
  writeWorkspaceFile(projectPath, info)
  return true
}

function readWorkspaceFile(filePath: string): ProjectInfo | null {
  try {
    const raw = readFileSync(filePath, 'utf-8')
    // Mini-parseur YAML pour les champs de .workspace
    const info: Record<string, string> = {}
    for (const line of raw.split('\n')) {
      const match = line.match(/^(\w[\w-]*):\s*(.*)/)
      if (match) {
        info[match[1]] = match[2].replace(/^['"]|['"]$/g, '').trim()
      }
    }
    return {
      name: info.name ?? '(inconnu)',
      createdAt: info.created_at ?? new Date().toISOString(),
      createdBy: info.created_by ?? 'unknown',
      status: (info.status as ProjectStatus) ?? 'active',
      description: info.description ?? '',
    }
  } catch {
    return null
  }
}

function writeWorkspaceFile(projectPath: string, info: ProjectInfo): void {
  const content = `# .workspace
name: ${info.name}
created_at: ${info.createdAt}
created_by: ${info.createdBy}
status: ${info.status}
description: ${info.description}
`
  writeFileSync(getWorkspaceFilePath(projectPath), content, 'utf-8')
}
