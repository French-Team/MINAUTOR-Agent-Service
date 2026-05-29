#!/usr/bin/env node
/**
 * scripts/agents/info.js — Affiche les informations d'un agent
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = join(fileURLToPath(import.meta.url), '..')
const PROJECT_ROOT = join(__dirname, '..', '..')
const AGENTS_DIR = join(PROJECT_ROOT, '.agents')

function main() {
  let agentId = process.env.SCRIPT_PARAM_AGENT

  if (!agentId) {
    const demande = (process.env.SCRIPT_DEMANDE || '').toLowerCase()
    const match = demande.match(/(?:qui est|info|agent)\s+(\S+)/)
    if (match) agentId = match[1]
  }

  if (!agentId) {
    console.log('❌ Nom de l\'agent manquant.')
    console.log('Usage: "qui est <agent-id>"')
    process.exit(1)
  }

  const cleanId = agentId.replace(/[^a-z0-9_-]/gi, '').toLowerCase()
  const filePath = join(AGENTS_DIR, `${cleanId}.ts`)

  if (!existsSync(filePath)) {
    console.log(`❌ Agent "${cleanId}" introuvable.`)
    if (existsSync(AGENTS_DIR)) {
      const agents = readdirSync(AGENTS_DIR)
        .filter(f => f.endsWith('.ts') && f !== 'tsconfig.json')
        .map(f => f.replace(/\.ts$/, ''))
      if (agents.length > 0) {
        console.log(`   Agents disponibles : ${agents.join(', ')}`)
      }
    }
    process.exit(1)
  }

  try {
    const content = readFileSync(filePath, 'utf-8')
    const extract = (pattern) => {
      const m = content.match(pattern)
      return m ? m[1].trim() : '—'
    }
    const displayName = extract(/displayName:\s*'([^']+)'/)
    const model = extract(/model:\s*'([^']+)'/)
    const provider = extract(/provider:\s*'([^']+)'/)
    const tools = extract(/toolNames:\s*\[([^\]]+)\]/)

    console.log('═══════════════════════════════════════════')
    console.log(`  🤖 ${displayName}`)
    console.log(`  ID: ${cleanId}`)
    console.log('═══════════════════════════════════════════')
    console.log(`  Modèle  : ${model}`)
    console.log(`  Provider: ${provider}`)
    console.log(`  Outils  : ${tools || '—'}`)
    console.log(`  Fichier : .agents/${cleanId}.ts`)

    const skillPath = join(PROJECT_ROOT, 'skills', `skill-${cleanId}`, 'SKILL.md')
    if (existsSync(skillPath)) {
      console.log(`  Skill   : skills/skill-${cleanId}/SKILL.md`)
    }
  } catch (err) {
    console.log(`❌ Erreur de lecture : ${err.message}`)
    process.exit(1)
  }
}

main()
