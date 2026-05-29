#!/usr/bin/env node
/**
 * scripts/debug/collect.js — Collecte les informations de debug
 */
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { freemem, totalmem, platform, release } from 'node:os'

const __dirname = join(fileURLToPath(import.meta.url), '..')
const PROJECT_ROOT = join(__dirname, '..', '..')

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 5000, windowsHide: true }).trim()
  } catch {
    return '(indisponible)'
  }
}

function main() {
  console.log('═══════════════════════════════════════════')
  console.log('  🔍 Collecte d\'informations de debug')
  console.log('═══════════════════════════════════════════')
  console.log('')

  console.log('── Système ──')
  console.log(`  Date    : ${new Date().toISOString()}`)
  console.log(`  Node    : ${run('node --version')}`)
  console.log(`  OS      : ${platform()} ${release()}`)
  console.log(`  RAM     : ${Math.round(freemem() / 1024 / 1024)} MB libre / ${Math.round(totalmem() / 1024 / 1024)} MB total`)
  console.log('')

  console.log('── Daemon Télécom ──')
  const statusFile = join(PROJECT_ROOT, 'telecom', 'daemon.status.json')
  if (existsSync(statusFile)) {
    try {
      const status = JSON.parse(readFileSync(statusFile, 'utf-8'))
      console.log(`  PID        : ${status.pid}`)
      console.log(`  Uptime     : ${status.uptimeSec}s`)
      console.log(`  Routages   : ${status.totalMessagesRouted}`)
      console.log(`  Spawns     : ${status.totalSpawns}`)
      console.log(`  Agents     : ${status.agentCount}`)
    } catch {
      console.log('  (fichier status invalide)')
    }
  } else {
    console.log('  Daemon non démarré')
  }
  console.log('')

  console.log('── Derniers routages ──')
  const routedDir = join(PROJECT_ROOT, 'telecom', 'routed')
  if (existsSync(routedDir)) {
    const files = readdirSync(routedDir).filter(f => f.endsWith('.json')).slice(-5)
    for (const f of files) {
      try {
        const msg = JSON.parse(readFileSync(join(routedDir, f), 'utf-8'))
        console.log(`  ${msg.timestamp ? msg.timestamp.slice(11, 19) : '?'} ${msg.from} → ${msg.to} [${msg.subject}]`)
      } catch {
        console.log(`  ${f} (illisible)`)
      }
    }
  }
  console.log('')

  console.log('── Logbook ──')
  const logbook = join(PROJECT_ROOT, 'telecom', 'agent-logbook.md')
  if (existsSync(logbook)) {
    const entries = readFileSync(logbook, 'utf-8').split('\n## ').filter(Boolean).slice(-5)
    for (const entry of entries) {
      const title = entry.split('\n')[0].trim()
      const dateMatch = entry.match(/\*\*Date :\*\*\s*(\S+)/)
      const date = dateMatch ? dateMatch[1].slice(11, 19) : ''
      console.log(`  ${date} ${title.slice(0, 60)}`)
    }
  }
  console.log('')

  console.log('── Agents ──')
  const agentsDir = join(PROJECT_ROOT, '.agents')
  if (existsSync(agentsDir)) {
    const agents = readdirSync(agentsDir).filter(f => f.endsWith('.ts') && f !== 'tsconfig.json')
    console.log(`  ${agents.length} agent(s) disponible(s)`)
  }
  console.log('')

  console.log('── Projets ──')
  const workspacesDir = join(PROJECT_ROOT, 'workspaces')
  if (existsSync(workspacesDir)) {
    const projects = readdirSync(workspacesDir, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.') && existsSync(join(workspacesDir, e.name, '.workspace')))
    console.log(`  ${projects.length} projet(s)`)
  }
  console.log('')

  console.log('═══════════════════════════════════════════')
}

main()
