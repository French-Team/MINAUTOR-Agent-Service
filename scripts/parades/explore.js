#!/usr/bin/env node
/**
 * scripts/parades/explore.js — Explore la structure d'un projet
 *
 * Usage: node scripts/parades/explore.js <projet> [--recent|--path <dossier>]
 *
 * Affiche :
 *   - Arborescence des fichiers (ls -la)
 *   - Documentation (README.md)
 *   - Derniers commits git
 *   - Dépendances (package.json, requirements.txt)
 *
 * Flags :
 *   --recent       : fichiers modifiés dans les dernières 24h
 *   --path <dir>   : explorer uniquement un sous-dossier
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const __dirname = join(fileURLToPath(import.meta.url), '..')
const PROJECT_ROOT = join(__dirname, '..', '..')
const WORKSPACES_DIR = join(PROJECT_ROOT, 'workspaces')

function usage() {
  console.log('Usage: node scripts/parades/explore.js <projet> [--recent|--path <dossier>]')
  console.log('')
  console.log('  --recent           Fichiers modifiés dans les dernières 24h')
  console.log('  --path <dossier>   Explorer uniquement un sous-dossier')
}

function main() {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    usage()
    process.exit(1)
  }

  // Parser les flags
  let projectName = ''
  let subPath = ''
  let recentOnly = false
  let i = 0

  while (i < args.length) {
    if (args[i] === '--recent') {
      recentOnly = true
      i++
    } else if (args[i] === '--path' && i + 1 < args.length) {
      subPath = args[i + 1]
      i += 2
    } else {
      projectName = args[i]
      i++
    }
  }

  if (!projectName) {
    console.log('❌ Nom du projet manquant.')
    usage()
    process.exit(1)
  }

  const cleanName = projectName.replace(/[^a-z0-9_-]/gi, '').toLowerCase()
  const projectPath = join(WORKSPACES_DIR, cleanName)

  if (!existsSync(projectPath)) {
    console.log(`❌ Projet "${cleanName}" introuvable dans workspaces/.`)
    console.log('')
    console.log('Projets disponibles :')
    if (existsSync(WORKSPACES_DIR)) {
      const entries = readdirSync(WORKSPACES_DIR, { withFileTypes: true })
      for (const e of entries) {
        if (e.isDirectory() && !e.name.startsWith('.') && existsSync(join(WORKSPACES_DIR, e.name, '.workspace'))) {
          console.log(`  • ${e.name}`)
        }
      }
    }
    process.exit(1)
  }

  const targetPath = subPath ? join(projectPath, subPath) : projectPath
  if (!existsSync(targetPath)) {
    console.log(`❌ Sous-dossier "${subPath}" introuvable dans ${cleanName}/.`)
    process.exit(1)
  }

  console.log('═══════════════════════════════════════════')
  console.log(`  🔍 Exploration : ${cleanName}`)
  if (subPath) console.log(`  Dossier : ${subPath}`)
  if (recentOnly) console.log(`  Mode : 24h uniquement`)
  console.log('═══════════════════════════════════════════')
  console.log('')

  // ── 1. README ──
  const readmePath = join(projectPath, 'README.md')
  if (existsSync(readmePath)) {
    const content = readFileSync(readmePath, 'utf-8').trim()
    const firstLines = content.split('\n').slice(0, 15).join('\n')
    console.log(`📖 README.md ${firstLines.length < content.length ? '(15 premières lignes)' : ''} :`)
    console.log('')
    console.log(firstLines)
    if (firstLines.length < content.length) console.log('...')
    console.log('')
  } else {
    console.log(`📖 Aucun README.md trouvé.`)
    console.log('')
  }

  // ── 2. Arborescence (ls -la) ──
  console.log(`📁 Arborescence :`)
  console.log('')
  try {
    const ls = execSync(`node -e "
      const fs = require('fs');
      const path = require('path');
      function walk(dir, prefix = '') {
        const entries = fs.readdirSync(dir, { withFileTypes: true }).filter(e => !e.name.startsWith('.'))
        for (let i = 0; i < entries.length; i++) {
          const e = entries[i]
          const isLast = i === entries.length - 1
          const connector = isLast ? '└── ' : '├── '
          console.log(prefix + connector + e.name + (e.isDirectory() ? '/' : ''))
          if (e.isDirectory() && !e.name.startsWith('.') && !e.name.includes('node_modules')) {
            walk(path.join(dir, e.name), prefix + (isLast ? '    ' : '│   '))
          }
        }
      }
      walk(${JSON.stringify(targetPath)});
    "`, {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8',
      timeout: 10000,
    })
    console.log(ls)
  } catch {
    try {
      const ls = execSync(`dir /b "${targetPath}"`, { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 5000 })
      console.log(ls.trim().split('\n').map(f => `  ${f.trim()}`).join('\n'))
      console.log('')
    } catch { /* skip */ }
  }

  // ── 3. Dépendances ──
  const pkgPath = join(projectPath, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
      const deps = { ...pkg.dependencies, ...pkg.devDependencies }
      const depCount = Object.keys(deps).length
      if (depCount > 0) {
        console.log(`📦 Dépendances (${depCount}) :`)
        console.log('')
        const allDeps = Object.entries(deps)
        for (const [name, ver] of allDeps.slice(0, 20)) {
          console.log(`  ${name} : ${ver}`)
        }
        if (allDeps.length > 20) console.log(`  ... et ${allDeps.length - 20} autre(s)`)
        console.log('')
      }
    } catch { /* invalid package.json */ }
  }

  const reqPath = join(projectPath, 'requirements.txt')
  if (existsSync(reqPath)) {
    const reqs = readFileSync(reqPath, 'utf-8').trim().split('\n').filter(Boolean)
    if (reqs.length > 0) {
      console.log(`📦 Dépendances Python (${reqs.length}) :`)
      console.log('')
      for (const r of reqs.slice(0, 15)) console.log(`  ${r}`)
      if (reqs.length > 15) console.log(`  ... et ${reqs.length - 15} autre(s)`)
      console.log('')
    }
  }

  // ── 4. Commits git ──
  if (existsSync(join(projectPath, '.git'))) {
    console.log(`🔖 Commits récents :`)
    console.log('')
    try {
      const gitLog = execSync(`git -C "${projectPath}" log --oneline -10`, {
        encoding: 'utf-8',
        timeout: 5000,
      })
      console.log(gitLog.trim() ? gitLog : '  (aucun commit)')
      console.log('')
    } catch {
      console.log('  (git non disponible)')
      console.log('')
    }

    if (recentOnly) {
      try {
        const diff = execSync(`git -C "${projectPath}" diff --stat '@{24 hours ago}'`, {
          encoding: 'utf-8',
          timeout: 5000,
        })
        if (diff.trim()) {
          console.log(`🕐 Modifications (24h) :`)
          console.log('')
          console.log(diff)
        } else {
          console.log(`🕐 Aucune modification dans les dernières 24h.`)
          console.log('')
        }
      } catch { /* skip */ }
    }
  } else {
    console.log(`🔖 Git : non initialisé`)
    console.log('')
  }

  // ── 5. Tâches ──
  const tasksPath = join(projectPath, '.tasks.json')
  if (existsSync(tasksPath)) {
    try {
      const board = JSON.parse(readFileSync(tasksPath, 'utf-8'))
      const tasks = board.tasks || []
      const done = tasks.filter(t => t.status === 'done').length
      const inProgress = tasks.filter(t => t.status === 'in_progress').length
      const blocked = tasks.filter(t => t.status === 'blocked').length
      const todo = tasks.length - done - inProgress - blocked
      console.log(`📋 Tâches (${tasks.length}) :`)
      console.log(`  ✓ ${done} terminées  ⟳ ${inProgress} en cours  ⊘ ${blocked} bloquées  □ ${todo} à faire`)
      console.log('')
    } catch { /* skip */ }
  }

  console.log('═══════════════════════════════════════════')
}

main()
