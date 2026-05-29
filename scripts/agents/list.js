#!/usr/bin/env node
/**
 * scripts/agents/list.js — Liste tous les agents disponibles
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = join(fileURLToPath(import.meta.url), '..')
const PROJECT_ROOT = join(__dirname, '..', '..')
const AGENTS_DIR = join(PROJECT_ROOT, '.agents')

function main() {
  if (!existsSync(AGENTS_DIR)) {
    console.log('🤖 Aucun agent trouvé.')
    return
  }

  const files = readdirSync(AGENTS_DIR)
    .filter(f => f.endsWith('.ts') && f !== 'tsconfig.json')

  if (files.length === 0) {
    console.log('🤖 Aucun agent dans .agents/.')
    return
  }

  console.log(`🤖 Agents disponibles (${files.length}) :`)
  console.log('')

  for (const file of files) {
    const agentId = file.replace(/\.ts$/, '')
    const filePath = join(AGENTS_DIR, file)
    try {
      const content = readFileSync(filePath, 'utf-8')
      const nameMatch = content.match(/displayName:\s*'([^']+)'/)
      const modelMatch = content.match(/model:\s*'([^']+)'/)
      const displayName = nameMatch ? nameMatch[1] : agentId
      const model = modelMatch ? modelMatch[1] : ''
      console.log(`  ● ${displayName}` + (model ? ` [${model}]` : ''))
      console.log(`    ID: ${agentId}`)
      console.log('')
    } catch {
      console.log(`  ● ${agentId}`)
      console.log('')
    }
  }
}

main()
