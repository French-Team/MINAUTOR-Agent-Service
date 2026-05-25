#!/usr/bin/env node
/**
 * cahier-index.ts — Affiche l'index du cahier d'aide d'Alice
 *
 * Usage: npx tsx skills/skill-welcome/scripts/cahier-index.ts
 *
 * L'index liste toutes les sections du cahier : intercom, patterns, reference.
 * Alice utilise ce script comme point d'entree pour savoir ou trouver l'info.
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const cwd = process.cwd()
const indexPath = join(cwd, 'data', 'cahier-aides-alice', 'INDEX.md')

if (!existsSync(indexPath)) {
  console.error('ERR: Index introuvable')
  console.error(`    Chemin: ${indexPath}`)
  process.exit(1)
}

const content = readFileSync(indexPath, 'utf-8')
console.log(content)
