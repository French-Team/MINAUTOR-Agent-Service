#!/usr/bin/env node
/**
 * cahier-read.ts — Lit un fichier du cahier d'aide d'Alice
 *
 * Usage: npx tsx skills/skill-welcome/scripts/cahier-read.ts <chemin>
 *
 * Chemins disponibles:
 *   01-envoyer, 02-lire, 03-exemples       (intercom)
 *   01-debug, 02-analysis, ... 08-list-agents (patterns)
 *   01-liste-agents, 02-architecture       (reference)
 *   INDEX                                   (index)
 *
 * Exemples:
 *   npx tsx skills/skill-welcome/scripts/cahier-read.ts 01-debug
 *   npx tsx skills/skill-welcome/scripts/cahier-read.ts 08-list-agents
 *   npx tsx skills/skill-welcome/scripts/cahier-read.ts INDEX
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const cwd = process.cwd()
const cahierDir = join(cwd, 'data', 'cahier-aides-alice')

const SECTIONS = ['01-intercom', '02-patterns', '03-reference'] as const

interface FileEntry {
  section: string
  id: string
  title: string
  path: string
}

function listFiles(): FileEntry[] {
  const entries: FileEntry[] = []
  for (const section of SECTIONS) {
    const dir = join(cahierDir, section)
    if (!existsSync(dir)) continue
    const files = readdirSync(dir).filter(f => f.endsWith('.md'))
    for (const f of files) {
      const id = f.replace(/\.md$/, '')
      const filePath = join(dir, f)
      const content = readFileSync(filePath, 'utf-8')
      const title = content.split('\n')[0]?.replace(/^#\s*/, '') || id
      entries.push({ section, id, title, path: filePath })
    }
  }
  return entries
}

function main(): void {
  const arg = process.argv[2]

  if (!arg) {
    console.log('Usage: npx tsx skills/skill-welcome/scripts/cahier-read.ts <chemin>')
    console.log('')
    console.log('Patterns:')
    const patterns = listFiles().filter(e => e.section === '02-patterns')
    for (const p of patterns) {
      console.log(`  ${p.id}  — ${p.title}`)
    }
    console.log('')
    console.log('Intercom:')
    const intercom = listFiles().filter(e => e.section === '01-intercom')
    for (const p of intercom) {
      console.log(`  ${p.id}  — ${p.title}`)
    }
    console.log('')
    console.log('Reference:')
    const refs = listFiles().filter(e => e.section === '03-reference')
    for (const p of refs) {
      console.log(`  ${p.id}  — ${p.title}`)
    }
    console.log('')
    console.log('  INDEX  — Index du cahier')
    process.exit(0)
  }

  // INDEX special case
  if (arg.toLowerCase() === 'index') {
    const indexPath = join(cahierDir, 'INDEX.md')
    if (existsSync(indexPath)) {
      console.log(readFileSync(indexPath, 'utf-8'))
      return
    }
    console.error('ERR: INDEX.md introuvable')
    process.exit(1)
  }

  // Search in all sections
  const search = arg.toLowerCase()
  const files = listFiles()

  // Exact match first
  let match = files.find(e => e.id === search)

  // Then partial match
  if (!match) {
    match = files.find(e => e.id.toLowerCase().includes(search) || e.title.toLowerCase().includes(search))
  }

  if (match) {
    console.log(`=== ${match.section}/${match.id} ===`)
    console.log('')
    console.log(readFileSync(match.path, 'utf-8'))
    return
  }

  console.error(`ERR: Aucun fichier trouve pour "${arg}"`)
  console.error('')
  console.error('Consulte l\'index:')
  console.error('  npx tsx skills/skill-welcome/scripts/cahier-index.ts')
  process.exit(1)
}

main()
