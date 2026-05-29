#!/usr/bin/env node
/**
 * scripts/projects/info.js — Affiche les détails d'un projet
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = join(fileURLToPath(import.meta.url), '..')
const PROJECT_ROOT = join(__dirname, '..', '..')
const WORKSPACES_DIR = join(PROJECT_ROOT, 'workspaces')

function main() {
  let projectName = process.env.SCRIPT_PARAM_PROJECT
  if (!projectName) {
    const demande = (process.env.SCRIPT_DEMANDE || '').toLowerCase()
    const match = demande.match(/(?:projet|project)\s+(\S+)/)
    if (match) projectName = match[1]
  }

  if (!projectName) {
    console.log('❌ Nom du projet manquant.')
    console.log('Usage: demande "info projet <nom>"')
    process.exit(1)
  }

  const cleanName = projectName.replace(/[^a-z0-9_-]/gi, '').toLowerCase()
  const projectPath = join(WORKSPACES_DIR, cleanName)

  if (!existsSync(projectPath)) {
    console.log(`❌ Projet "${cleanName}" introuvable.`)
    console.log('')
    if (existsSync(WORKSPACES_DIR)) {
      const entries = readdirSync(WORKSPACES_DIR, { withFileTypes: true })
      const available = entries
        .filter(e => e.isDirectory() && !e.name.startsWith('.') && existsSync(join(WORKSPACES_DIR, e.name, '.workspace')))
        .map(e => e.name)
      if (available.length > 0) {
        console.log(`Projets disponibles : ${available.join(', ')}`)
      }
    }
    process.exit(1)
  }

  const wsPath = join(projectPath, '.workspace')
  if (!existsSync(wsPath)) {
    console.log(`❌ "${cleanName}" n'est pas un projet initialisé (pas de .workspace).`)
    process.exit(1)
  }

  const raw = readFileSync(wsPath, 'utf-8')
  const lines = raw.split('\n')
  const info = {}
  for (const line of lines) {
    const m = line.match(/^(\w[\w-]*):\s*(.*)/)
    if (m) info[m[1]] = m[2].replace(/^['"]|['"]$/g, '').trim()
  }

  let taskCount = 0, doneCount = 0, inProgressCount = 0
  const tasksPath = join(projectPath, '.tasks.json')
  if (existsSync(tasksPath)) {
    try {
      const board = JSON.parse(readFileSync(tasksPath, 'utf-8'))
      if (board.tasks) {
        taskCount = board.tasks.length
        doneCount = board.tasks.filter(t => t.status === 'done').length
        inProgressCount = board.tasks.filter(t => t.status === 'in_progress').length
      }
    } catch { /* skip */ }
  }

  console.log('═══════════════════════════════════════════')
  console.log(`  📂 ${info['name'] || cleanName}`)
  console.log(`  ${info['description'] || '(aucune description)'}`)
  console.log(`  Statut: ${info['status'] || 'active'}`)
  console.log('═══════════════════════════════════════════')
  console.log(`  Créé le : ${info['created_at'] ? info['created_at'].slice(0, 10) : '—'}`)
  console.log(`  Par     : ${info['created_by'] || '—'}`)
  console.log(`  Chemin  : workspaces/${cleanName}/`)
  console.log('')
  console.log(`  Tâches : ${taskCount} totales`)
  console.log(`    ✓ ${doneCount} terminées`)
  console.log(`    ⟳ ${inProgressCount} en cours`)
  console.log(`    □ ${taskCount - doneCount - inProgressCount} à faire`)
}

main()
