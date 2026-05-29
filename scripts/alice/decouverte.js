#!/usr/bin/env node
/**
 * scripts/alice/decouverte.js — Résumé de découverte du projet
 *
 * Analyse la structure du projet et produit un résumé des fichiers
 * et dossiers clés. S'exécute indépendamment de handle.js.
 *
 * Usage:
 *   node scripts/alice/decouverte.js          # résumé standard
 *   node scripts/alice/decouverte.js --json   # mode JSON
 *
 * Return codes:
 *   0 — Toujours (pas d'erreur)
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

const CWD = process.cwd()

// ── Utilitaires ──────────────────────────────────────

function readFile(path) {
  try {
    return readFileSync(path, 'utf-8')
  } catch {
    return null
  }
}

function listDir(dir, prefix = '') {
  const fullPath = join(CWD, dir)
  if (!existsSync(fullPath)) return []

  const entries = readdirSync(fullPath)
  const results = []
  for (const entry of entries) {
    const entryPath = join(fullPath, entry)
    const stat = statSync(entryPath)
    if (stat.isDirectory()) {
      results.push({ name: join(dir, entry), type: 'dir', size: null })
    } else {
      results.push({ name: join(dir, entry), type: 'file', size: stat.size })
    }
  }
  return results
}

function countLines(content) {
  if (!content) return 0
  return content.split('\n').length
}

// ── Analyses ─────────────────────────────────────────

function analyzeProject() {
  const info = {
    name: 'minautor-agents-service',
    readme: null,
    agents: null,
    rootFiles: [],
    srcDirs: [],
    agentCount: 0,
    skillCount: 0,
    profileCount: 0,
    totalSourceLines: 0,
  }

  // README
  const readme = readFile(join(CWD, 'README.md'))
  if (readme) {
    const title = readme.split('\n')[0]?.replace(/^#\s*/, '') || 'README'
    info.readme = { title, lines: countLines(readme) }
  }

  // AGENTS.md
  const agentsDoc = readFile(join(CWD, 'AGENTS.md'))
  if (agentsDoc) {
    info.agents = { lines: countLines(agentsDoc) }
  }

  // src/ directory structure
  if (existsSync(join(CWD, 'src'))) {
    const srcEntries = readdirSync(join(CWD, 'src'))
    for (const entry of srcEntries) {
      const fullPath = join(CWD, 'src', entry)
      if (statSync(fullPath).isDirectory()) {
        info.srcDirs.push(entry)
      } else if (entry.endsWith('.ts')) {
        info.rootFiles.push(entry)
        info.totalSourceLines += countLines(readFile(fullPath))
      }
    }
  }

  // Agents
  if (existsSync(join(CWD, '.agents'))) {
    const agents = readdirSync(join(CWD, '.agents'))
    info.agentCount = agents.filter(f => f.endsWith('.ts')).length
  }

  // Skills
  if (existsSync(join(CWD, 'skills'))) {
    const skills = readdirSync(join(CWD, 'skills'))
    info.skillCount = skills.filter(f => f.startsWith('skill-')).length
  }

  // Profiles
  if (existsSync(join(CWD, 'data', 'profiles'))) {
    const profileDirs = readdirSync(join(CWD, 'data', 'profiles'))
    for (const dir of profileDirs) {
      const dirPath = join(CWD, 'data', 'profiles', dir)
      if (statSync(dirPath).isDirectory()) {
        info.profileCount += readdirSync(dirPath).filter(f => f.endsWith('.json')).length
      }
    }
  }

  return info
}

// ── Formatage ────────────────────────────────────────

function formatSummary(info) {
  const lines = []
  lines.push('── Découverte du projet ──')
  lines.push('')
  lines.push(`Projet : ${info.name}`)
  if (info.readme) lines.push(`README : ${info.readme.title} (${info.readme.lines} lignes)`)
  if (info.agents) lines.push(`Documentation : AGENTS.md (${info.agents.lines} lignes)`)
  lines.push('')
  lines.push(`Agents : ${info.agentCount} définis`)
  lines.push(`Skills : ${info.skillCount} disponibles`)
  lines.push(`Profiles : ${info.profileCount} pré-configurés`)

  if (info.rootFiles.length > 0) {
    lines.push('')
    lines.push(`Fichiers source (src/) : ${info.rootFiles.length} fichiers`)
    for (const f of info.rootFiles.slice(0, 5)) {
      lines.push(`  • ${f}`)
    }
    if (info.rootFiles.length > 5) {
      lines.push(`  … et ${info.rootFiles.length - 5} autres`)
    }
    lines.push(`Total : ~${info.totalSourceLines} lignes de TypeScript`)
  }

  if (info.srcDirs.length > 0) {
    lines.push('')
    lines.push(`Dossiers source : ${info.srcDirs.join(', ')}`)
  }

  lines.push('')
  lines.push('── Fin de la découverte ──')
  return lines.join('\n')
}

// ── Main ─────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2)
  const jsonMode = args.includes('--json')

  const ts = new Date().toISOString().slice(11, 19) // HH:MM:SS
  const info = analyzeProject()

  if (jsonMode) {
    console.log(JSON.stringify(info, null, 2))
  } else {
    console.log(`[${ts}] decouverte.js:`)
    console.log(formatSummary(info))
  }

  process.exit(0)
}

main()
