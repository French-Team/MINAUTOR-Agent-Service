#!/usr/bin/env node
/**
 * cahier-search.ts — Cherche un pattern P1-P8 par mots-cles
 *
 * Usage: npx tsx skills/skill-welcome/scripts/cahier-search.ts <mot-cle> [mot-cle ...]
 *
 * Exemples:
 *   npx tsx skills/skill-welcome/scripts/cahier-search.ts bug erreur plante
 *   npx tsx skills/skill-welcome/scripts/cahier-search.ts liste agent
 *
 * Le script cherche les mots-cles dans les fichiers de patterns
 * et affiche ceux qui matchent, tries par pertinence.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const cwd = process.cwd()
const patternsDir = join(cwd, 'data', 'cahier-aides-alice', '02-patterns')
const keywords = process.argv.slice(2)

interface PatternMatch {
  id: string
  title: string
  matchCount: number
  totalKeywords: number
}

function getPatterns(): PatternMatch[] {
  if (!existsSync(patternsDir)) {
    console.error('ERR: Dossier des patterns introuvable')
    process.exit(1)
  }

  const files = readdirSync(patternsDir).filter(f => f.endsWith('.md'))
  return files.map(f => {
    const id = f.replace(/\.md$/, '')
    const path = join(patternsDir, f)
    const content = readFileSync(path, 'utf-8')
    const title = content.split('\n')[0]?.replace(/^#\s*/, '') || id
    return { id, title, matchCount: 0, totalKeywords: keywords.length }
  })
}

function main(): void {
  const args = process.argv.slice(2)

  if (args.length === 0) {
    console.log('Usage: npx tsx skills/skill-welcome/scripts/cahier-search.ts <mot-cle> [mot-cle ...]')
    console.log('')
    console.log('Cherche les patterns dont les mots-cles ou le contenu correspondent.')
    console.log('')
    console.log('Exemples:')
    console.log('  cahier-search bug            → patterns lies aux bugs')
    console.log('  cahier-search liste agent    → patterns pour lister')
    console.log('')
    console.log('Patterns disponibles:')
    const patterns = getPatterns()
    for (const p of patterns) {
      console.log(`  ${p.id}  — ${p.title}`)
    }
    process.exit(0)
  }

  const keywords = args.map(k => k.toLowerCase())
  const patterns = getPatterns()

  // Compter les matches par pattern
  for (const pattern of patterns) {
    const path = join(patternsDir, `${pattern.id}.md`)
    const content = readFileSync(path, 'utf-8').toLowerCase()

    let count = 0
    for (const kw of keywords) {
      if (content.includes(kw)) count++
    }
    pattern.matchCount = count
  }

  // Filtrer et trier par pertinence
  const matched = patterns
    .filter(p => p.matchCount > 0)
    .sort((a, b) => b.matchCount - a.matchCount)

  console.log(`=== Recherche: ${args.join(' ')} ===`)
  console.log('')

  if (matched.length === 0) {
    console.log('Aucun pattern trouve pour ces mots-cles.')
    console.log('')
    console.log('Essaie des synonymes ou consulte l\'index:')
    console.log('  npx tsx skills/skill-welcome/scripts/cahier-index.ts')
    process.exit(1)
  }

  for (const p of matched) {
    const ratio = `[${p.matchCount}/${keywords.length}]`
    console.log(`  ${ratio} ${p.id}  — ${p.title}`)
  }

  console.log('')
  console.log(`${matched.length} pattern(s) trouve(s). Pour voir les details:`)
  console.log(`  npx tsx skills/skill-welcome/scripts/cahier-read.ts ${matched[0].id}`)
}

main()
