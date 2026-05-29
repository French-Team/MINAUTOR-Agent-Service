#!/usr/bin/env node
/**
 * scripts/help/show.js — Affiche l'aide générale du système
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = join(fileURLToPath(import.meta.url), '..')
const PROJECT_ROOT = join(__dirname, '..', '..')
const REGISTRY_PATH = join(PROJECT_ROOT, 'data', 'scripts', 'registry.yaml')

function main() {
  console.log('═══════════════════════════════════════════')
  console.log('  🤖 Assistant IA — Aide générale')
  console.log('═══════════════════════════════════════════')
  console.log('')
  console.log('  Je peux t\'aider avec les commandes suivantes :')
  console.log('')

  if (existsSync(REGISTRY_PATH)) {
    try {
      const yaml = readFileSync(REGISTRY_PATH, 'utf-8')
      for (const line of yaml.split('\n')) {
        const descMatch = line.match(/^\s+description:\s*"(.+)"/)
        if (descMatch) {
          console.log(`  • ${descMatch[1]}`)
        }
      }
      console.log('')
    } catch { /* skip */ }
  }

  console.log('  Exemples concrets :')
  console.log('    "liste les projets"      — Voir tous les projets')
  console.log('    "info projet <nom>"      — Détails d\'un projet')
  console.log('    "crée un projet <nom>"   — Nouveau projet')
  console.log('    "liste les agents"       — Voir tous les agents')
  console.log('    "qui est <agent>"        — Détails d\'un agent')
  console.log('    "j\'ai un bug"           — Collecter des infos de debug')
  console.log('')
  console.log('═══════════════════════════════════════════')
}

main()
