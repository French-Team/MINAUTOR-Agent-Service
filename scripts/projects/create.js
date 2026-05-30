#!/usr/bin/env node
/**
 * scripts/projects/create.js — Crée un nouveau projet
 */
import { execSync } from 'node:child_process'
import { existsSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = join(fileURLToPath(import.meta.url), '..')
const PROJECT_ROOT = join(__dirname, '..', '..')
const WORKSPACES_DIR = join(PROJECT_ROOT, 'workspaces')
const TASK_BOARD_CLI = join(PROJECT_ROOT, 'dist', 'project', 'task-board-cli.js')

function main() {
  let projectName = process.env.SCRIPT_PARAM_PROJECT

  if (!projectName) {
    const demande = (process.env.SCRIPT_DEMANDE || '').toLowerCase()
    const match = demande.match(/(?:cr[eé]e?r?|create|nouveau|new)\s+(?:un\s+)?(?:projet|project)\s+(?:"([^"]+)"|(\S+))/)
    if (match) projectName = match[1] || match[2]
  }

  if (!projectName) {
    console.log('❌ Nom du projet manquant.')
    console.log('Usage: "crée un projet <nom>"')
    process.exit(1)
  }

  const cleanName = projectName.replace(/[^a-z0-9 _-]/gi, '').replace(/\s+/g, '-').toLowerCase()

  if (!/^[a-z0-9][a-z0-9_-]*$/.test(cleanName)) {
    console.log(`❌ Nom invalide: "${cleanName}"`)
    process.exit(1)
  }

  if (existsSync(join(WORKSPACES_DIR, cleanName))) {
    console.log(`❌ Le projet "${cleanName}" existe déjà.`)
    if (existsSync(WORKSPACES_DIR)) {
      const projects = readdirSync(WORKSPACES_DIR, { withFileTypes: true })
        .filter(e => e.isDirectory() && !e.name.startsWith('.') && existsSync(join(WORKSPACES_DIR, e.name, '.workspace')))
        .map(e => e.name)
      if (projects.length > 0) {
        console.log(`   Projets existants : ${projects.join(', ')}`)
      }
    }
    process.exit(1)
  }

  // ── 1. Créer le dossier projet + fichiers de base ──
  const projectPath = join(WORKSPACES_DIR, cleanName)
  const now = new Date().toISOString()

  try {
    mkdirSync(projectPath, { recursive: true })

    const wsContent = [
      '# .workspace',
      `name: ${cleanName}`,
      `created_at: ${now}`,
      `created_by: script-runner`,
      `status: active`,
      `description: Projet automatique`,
    ].join('\n')
    writeFileSync(join(projectPath, '.workspace'), wsContent, 'utf-8')
    writeFileSync(join(projectPath, '.tasks.json'), JSON.stringify({
      project: cleanName,
      lastUpdated: now,
      tasks: [],
    }, null, 2), 'utf-8')

    console.log(`✅ Projet "${cleanName}" créé`)
    console.log(`   Chemin : workspaces/${cleanName}/`)

    // ── 2. Initialiser une tâche de bienvenue via task-board-cli ──
    //    (non bloquant — si l'outil est absent ou échoue, on continue)
    if (existsSync(TASK_BOARD_CLI)) {
      try {
        const cmd = `node "${TASK_BOARD_CLI}" add "${cleanName}" general "Initialisation du projet"`
        execSync(cmd, { encoding: 'utf-8', timeout: 10000, windowsHide: true })
        console.log(`   🗒️  Tâche d'initialisation ajoutée`)
      } catch {
        // task-board-cli indisponible ou erreur — ignoré
      }
    }
  } catch (err) {
    console.log(`❌ Erreur : ${err.message}`)
    process.exit(1)
  }
}

main()
