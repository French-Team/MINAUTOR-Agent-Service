#!/usr/bin/env node
/**
 * scripts/projects/list.js — Liste tous les projets
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = join(fileURLToPath(import.meta.url), '..')
const PROJECT_ROOT = join(__dirname, '..', '..')
const WORKSPACES_DIR = join(PROJECT_ROOT, 'workspaces')

function main() {
  if (!existsSync(WORKSPACES_DIR)) {
    console.log('Aucun projet trouvé — le dossier workspaces/ n\'existe pas encore.')
    return
  }

  const entries = readdirSync(WORKSPACES_DIR, { withFileTypes: true })
  const projects = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith('.')) continue

    const wsPath = join(WORKSPACES_DIR, entry.name, '.workspace')
    if (!existsSync(wsPath)) continue

    try {
      const raw = readFileSync(wsPath, 'utf-8')
      const lines = raw.split('\n')
      const info = {}
      for (const line of lines) {
        const m = line.match(/^(\w[\w-]*):\s*(.*)/)
        if (m) info[m[1]] = m[2].replace(/^['"]|['"]$/g, '').trim()
      }
      projects.push({
        name: info['name'] || entry.name,
        status: info['status'] || 'active',
        description: info['description'] || '',
        created: info['created_at'] || '',
      })
    } catch {
      // skip invalid
    }
  }

  if (projects.length === 0) {
    console.log('📂 Aucun projet trouvé.')
    console.log('   Pour créer un projet : "crée un projet <nom>"')
    return
  }

  console.log(`📂 Projets disponibles (${projects.length}) :`)
  console.log('')

  for (const p of projects) {
    const statusIcon = p.status === 'active' ? '●' : p.status === 'archived' ? '○' : '◌'
    const statusColor = p.status === 'active' ? '' : p.status === 'archived' ? ' (archivé)' : ''
    const desc = p.description ? ` — ${p.description}` : ''
    const date = p.created ? `  Créé le ${p.created.slice(0, 10)}` : ''
    console.log(`  ${statusIcon} ${p.name}${statusColor}${desc}`)
    if (date) console.log(`    ${date}`)
    console.log(`    Chemin: workspaces/${p.name}/`)
    console.log('')
  }

  console.log('Pour voir les détails : "info projet <nom>"')
}

main()
