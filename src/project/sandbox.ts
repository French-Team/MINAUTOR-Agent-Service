/**
 * Sandbox — Isolation des agents sans projet dans workspaces/.sandbox/.
 *
 * Quand un agent de niveau « confined » n'a pas de workspace explicite
 * dans permissions.yaml, il est automatiquement isolé dans ce dossier
 * sandbox. Il ne peut ni lire ni écrire dans les autres projets.
 *
 * Référence : workspace-isolation-spec.md — Section 3 (écart 🔴)
 */

import { existsSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

const WORKSPACES_DIR = join(process.cwd(), 'workspaces')
const SANDBOX_DIR = join(WORKSPACES_DIR, '.sandbox')
const WORKSPACE_MARKER = join(SANDBOX_DIR, '.workspace')

/**
 * Chemin absolu vers le dossier .sandbox.
 */
export function getSandboxPath(): string {
  return SANDBOX_DIR
}

/**
 * Chemin absolu vers le marqueur .workspace du sandbox.
 */
export function getSandboxWorkspacePath(): string {
  return WORKSPACE_MARKER
}

/**
 * Crée workspaces/.sandbox/ avec son marqueur .workspace et un .tasks.json vide.
 * Appelé automatiquement au démarrage du CLI.
 */
export function ensureSandbox(): void {
  if (!existsSync(SANDBOX_DIR)) {
    mkdirSync(SANDBOX_DIR, { recursive: true })
  }

  // Marqueur .workspace
  if (!existsSync(WORKSPACE_MARKER)) {
    const now = new Date().toISOString()
    const content = [
      '# .workspace',
      `name: .sandbox`,
      `created_at: ${now}`,
      `created_by: system`,
      `status: active`,
      `type: sandbox`,
      `description: Sandbox d'isolement pour les agents sans projet`,
      '',
      '# Ce dossier est isolé : les agents « confined » sans projet',
      '# y sont confinés. Ils ne peuvent pas accéder aux autres projets.',
    ].join('\n')
    writeFileSync(WORKSPACE_MARKER, content, 'utf-8')
  }

  // .tasks.json vide si absent
  const tasksPath = join(SANDBOX_DIR, '.tasks.json')
  if (!existsSync(tasksPath)) {
    const now = new Date().toISOString()
    writeFileSync(
      tasksPath,
      JSON.stringify({ project: '.sandbox', lastUpdated: now, tasks: [] }, null, 2),
      'utf-8',
    )
  }

  // README.md de documentation si absent
  const readmePath = join(SANDBOX_DIR, 'README.md')
  if (!existsSync(readmePath)) {
    const readme = [
      '# Sandbox — Agents sans projet',
      '',
      "Ce dossier isole les agents qui n'ont pas de projet explicite.",
      'Ils y sont confinés (niveau « confined ») :',
      '',
      '- Commandes de base autorisées (cat, ls, node, npm, …)',
      '- Interdiction de sortir de ce dossier',
      "- Pas d'accès à src/, data/, .agents/ ni aux autres projets",
      '',
      '## Structure',
      '',
      '```',
      'workspaces/.sandbox/',
      '  ├── .workspace     # Marqueur sandbox',
      '  ├── .tasks.json    # Tableau des tâches du sandbox',
      '  ├── README.md      # Ce fichier',
      '  └── <agent-id>/     # Dossiers temporaires par agent',
      '```',
      '',
      '## Nettoyage',
      '',
      "Les sous-dossiers d'agents sont supprimés périodiquement.",
      "Ne rien stocker d'important ici.",
    ].join('\n')
    writeFileSync(readmePath, readme, 'utf-8')
  }
}

/**
 * Vérifie si un chemin est dans le sandbox.
 */
export function isInSandbox(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/')
  return normalized.startsWith(SANDBOX_DIR.replace(/\\/g, '/'))
}
