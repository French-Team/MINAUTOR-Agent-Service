#!/usr/bin/env node
/**
 * scripts/projects/decouverte.js — Exploration de structure de projet
 *
 * Analyse la structure d'un projet workspace, détecte le type de projet,
 * extrait les dépendances, explore l'architecture et génère un README technique.
 *
 * Déclenché par "explore le projet", "découvre le projet", "analyse le projet",
 * "structure du projet", "génère un readme pour le projet"
 *
 * Variables d'environnement :
 *   SCRIPT_PARAM_PROJECT — nom du projet (depuis le pattern registry)
 *   SCRIPT_PROJECT      — nom du projet (depuis le payload intercom)
 *   SCRIPT_DEMANDE      — demande utilisateur brute
 *
 * Usage:
 *   node scripts/projects/decouverte.js                   # exploration + affichage
 *   node scripts/projects/decouverte.js --readme          # génère le README.md
 *   node scripts/projects/decouverte.js --json            # sortie JSON
 *   node scripts/projects/decouverte.js --no-color        # sans couleurs
 *
 * Return codes:
 *   0 — Succès
 *   1 — Projet introuvable ou erreur
 */

import { existsSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join, relative, basename, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = join(fileURLToPath(import.meta.url), '..')
const PROJECT_ROOT = join(__dirname, '..', '..')
const WORKSPACES_DIR = join(PROJECT_ROOT, 'workspaces')
const isJson = process.argv.includes('--json')
const isGenerateReadme = process.argv.includes('--readme')

// Auto-détection : si la demande contient "readme" ou "génère", on génère le README
const demande = (process.env.SCRIPT_DEMANDE || '').toLowerCase()
const autoGenerateReadme = /readme|gén[èe]re/.test(demande)
const generateReadme = isGenerateReadme || autoGenerateReadme

// ── Couleurs ANSI ──────────────────────────────────
const CYAN = '\x1b[36m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const RED = '\x1b[31m'
const GRAY = '\x1b[90m'
const BOLD = '\x1b[1m'
const RESET = '\x1b[0m'
const noColor = process.argv.includes('--no-color') || process.env.NO_COLOR
const C = c => noColor ? '' : c
const R = () => noColor ? '' : RESET

// ── Utilitaires ────────────────────────────────────

function listProjects() {
  if (!existsSync(WORKSPACES_DIR)) return []
  return readdirSync(WORKSPACES_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.') && existsSync(join(WORKSPACES_DIR, e.name, '.workspace')))
    .map(e => e.name)
}

function readProjectInfo(name) {
  const wsPath = join(WORKSPACES_DIR, name, '.workspace')
  if (!existsSync(wsPath)) return null
  try {
    const raw = readFileSync(wsPath, 'utf-8')
    const info = {}
    for (const line of raw.split('\n')) {
      const m = line.match(/^(\w[\w-]*):\s*(.*)/)
      if (m) info[m[1]] = m[2].replace(/^['"]|['"]$/g, '').trim()
    }
    return info
  } catch { return null }
}

function readTaskBoard(name) {
  const tasksPath = join(WORKSPACES_DIR, name, '.tasks.json')
  if (!existsSync(tasksPath)) return { tasks: [] }
  try { return JSON.parse(readFileSync(tasksPath, 'utf-8')) }
  catch { return { tasks: [] } }
}

function readFileSafe(p) {
  try {
    if (!existsSync(p)) return null
    return readFileSync(p, 'utf-8')
  } catch { return null }
}

function countLines(content) {
  if (!content) return 0
  return content.split('\n').length
}

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ── Extraction du nom de projet ────────────────────

function getProjectName() {
  let name = process.env.SCRIPT_PARAM_PROJECT
  if (!name) name = process.env.SCRIPT_PROJECT
  if (!name) {
    const demande = (process.env.SCRIPT_DEMANDE || '').toLowerCase()
    const match = demande.match(/(?:projet|project)\s+["']?([a-z0-9][a-z0-9_-]*)/)
    if (match) name = match[1]
  }
  return name || null
}

// ── Analyse du projet ──────────────────────────────

const IGNORED_DIRS = new Set(['node_modules', '.git', '.svn', '__pycache__', 'dist', 'build', '.next', '.nuxt', '.cache', 'coverage', '.venv', 'venv', 'env'])
const IGNORED_FILES = new Set(['.DS_Store', 'Thumbs.db', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', '.gitignore'])
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.php', '.vue', '.svelte', '.css', '.scss', '.html', '.json', '.yaml', '.yml', '.toml', '.xml', '.md', '.sql', '.sh', '.bat', '.ps1'])

function scanDirectory(dirPath, prefix = '') {
  const entries = []
  try {
    const items = readdirSync(dirPath, { withFileTypes: true })
      .filter(e => !IGNORED_DIRS.has(e.name) && !IGNORED_FILES.has(e.name))
      .sort((a, b) => {
        // Directories first, then alphabetical
        if (a.isDirectory() && !b.isDirectory()) return -1
        if (!a.isDirectory() && b.isDirectory()) return 1
        return a.name.localeCompare(b.name)
      })

    for (const item of items) {
      const fullPath = join(dirPath, item.name)
      const relPath = prefix ? `${prefix}/${item.name}` : item.name

      if (item.isDirectory()) {
        const children = scanDirectory(fullPath, relPath)
        entries.push({
          name: item.name,
          type: 'directory',
          path: relPath,
          children,
          totalFiles: countFiles(children),
          totalLines: countLinesInTree(children),
        })
      } else if (item.isFile()) {
        const ext = extname(item.name).toLowerCase()
        const stats = statSync(fullPath)
        const content = SOURCE_EXTENSIONS.has(ext) ? readFileSafe(fullPath) : null
        entries.push({
          name: item.name,
          type: 'file',
          path: relPath,
          ext,
          size: stats.size,
          lines: content ? countLines(content) : 0,
          sizeHuman: humanSize(stats.size),
        })
      }
    }
  } catch { /* permission denied or missing */ }
  return entries
}

function countFiles(entries) {
  let count = 0
  for (const e of entries) {
    if (e.type === 'file') count++
    if (e.children) count += countFiles(e.children)
  }
  return count
}

function countLinesInTree(entries) {
  let count = 0
  for (const e of entries) {
    if (e.type === 'file') count += e.lines || 0
    if (e.children) count += countLinesInTree(e.children)
  }
  return count
}

function analyzeProject(projectPath) {
  const analysis = {
    type: 'unknown',
    frameworks: [],
    dependencies: { prod: [], dev: [] },
    scripts: {},
    structure: [],
    configFiles: [],
    hasGit: false,
    hasDocker: false,
    hasCi: false,
    hasTests: false,
    totalFiles: 0,
    totalLines: 0,
    largestFiles: [],
  }

  // package.json → Node.js / npm project
  const pkgPath = join(projectPath, 'package.json')
  const pkgContent = readFileSafe(pkgPath)
  if (pkgContent) {
    analysis.type = 'node'
    analysis.configFiles.push('package.json')
    try {
      const pkg = JSON.parse(pkgContent)

      if (pkg.dependencies) {
        analysis.dependencies.prod = Object.entries(pkg.dependencies).map(([n, v]) => ({ name: n, version: v }))
      }
      if (pkg.devDependencies) {
        analysis.dependencies.dev = Object.entries(pkg.devDependencies).map(([n, v]) => ({ name: n, version: v }))
      }
      if (pkg.scripts) {
        analysis.scripts = pkg.scripts
      }

      // Détection frameworks
      const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
      const frameworkMap = {
        'react': 'React', 'next': 'Next.js', 'vue': 'Vue.js', 'nuxt': 'Nuxt.js',
        'svelte': 'Svelte', 'angular': 'Angular', 'express': 'Express',
        'fastify': 'Fastify', 'koa': 'Koa', 'nestjs': 'NestJS',
        'prisma': 'Prisma', 'typeorm': 'TypeORM', 'drizzle': 'Drizzle',
        'tailwindcss': 'Tailwind CSS', 'bootstrap': 'Bootstrap',
        'socket.io': 'Socket.IO', 'graphql': 'GraphQL', 'apollo': 'Apollo',
        'jest': 'Jest', 'vitest': 'Vitest', 'mocha': 'Mocha', 'cypress': 'Cypress',
        'playwright': 'Playwright', 'eslint': 'ESLint', 'prettier': 'Prettier',
        'axios': 'Axios', 'zod': 'Zod', 'trpc': 'tRPC',
        'electron': 'Electron', 'expo': 'Expo', 'react-native': 'React Native',
      }
      for (const [key, name] of Object.entries(frameworkMap)) {
        if (allDeps[key]) analysis.frameworks.push(name)
      }

      // Tests
      if (allDeps.jest || allDeps.vitest || allDeps.mocha || allDeps.cypress || allDeps.playwright) {
        analysis.hasTests = true
      }
    } catch { /* invalid JSON */ }
  }

  // tsconfig.json
  if (existsSync(join(projectPath, 'tsconfig.json'))) {
    analysis.configFiles.push('tsconfig.json')
    if (analysis.type === 'unknown') analysis.type = 'typescript'
    else if (analysis.type === 'node') analysis.type = 'node-typescript'
  }

  // Python detection
  if (existsSync(join(projectPath, 'requirements.txt'))) {
    analysis.configFiles.push('requirements.txt')
    analysis.type = analysis.type === 'unknown' ? 'python' : `${analysis.type}-python`
  }
  if (existsSync(join(projectPath, 'pyproject.toml'))) {
    analysis.configFiles.push('pyproject.toml')
    analysis.type = analysis.type === 'unknown' ? 'python' : `${analysis.type}-python`
  }

  // Docker
  if (existsSync(join(projectPath, 'Dockerfile')) || existsSync(join(projectPath, 'docker-compose.yml')) || existsSync(join(projectPath, 'docker-compose.yaml'))) {
    analysis.hasDocker = true
    analysis.configFiles.push('Dockerfile')
  }

  // Git
  if (existsSync(join(projectPath, '.git'))) {
    analysis.hasGit = true
  }

  // CI
  if (existsSync(join(projectPath, '.github')) || existsSync(join(projectPath, '.gitlab-ci.yml')) || existsSync(join(projectPath, '.circleci'))) {
    analysis.hasCi = true
  }

  // Structure
  analysis.structure = scanDirectory(projectPath)
  analysis.totalFiles = countFiles(analysis.structure)
  analysis.totalLines = countLinesInTree(analysis.structure)

  // Largest files (top 5)
  const allFiles = []
  function collectFiles(entries) {
    for (const e of entries) {
      if (e.type === 'file' && e.ext !== '.json' && e.ext !== '.lock') {
        allFiles.push(e)
      }
      if (e.children) collectFiles(e.children)
    }
  }
  collectFiles(analysis.structure)
  allFiles.sort((a, b) => (b.lines || 0) - (a.lines || 0))
  analysis.largestFiles = allFiles.slice(0, 5)

  return analysis
}

// ── Génération README ──────────────────────────────

function generateReadmeContent(projectName, info, analysis, tasks) {
  const now = new Date().toISOString().split('T')[0]
  const lines = []

  // ── Titre ──
  lines.push(`# ${projectName}`)
  lines.push('')
  if (info?.description && info.description !== '(aucune description)') {
    lines.push(`> ${info.description}`)
    lines.push('')
  }

  // ── Badges ──
  const badges = []
  if (analysis.type !== 'unknown') badges.push(`![Type](https://img.shields.io/badge/type-${analysis.type.replace(/[^a-z0-9-]/g, '-')}-blue)`)
  if (analysis.hasTests) badges.push(`![Tests](https://img.shields.io/badge/tests-✓-green)`)
  if (analysis.hasDocker) badges.push(`![Docker](https://img.shields.io/badge/docker-✓-blue)`)
  if (analysis.hasCi) badges.push(`![CI](https://img.shields.io/badge/ci-✓-brightgreen)`)
  if (badges.length > 0) {
    lines.push(badges.join(' '))
    lines.push('')
  }

  // ── Metadata ──
  lines.push('## 📋 Informations')
  lines.push('')
  lines.push(`| Champ | Valeur |`)
  lines.push(`|-------|--------|`)
  lines.push(`| **Projet** | \`${projectName}\` |`)
  if (info?.status) lines.push(`| **Statut** | ${info.status} |`)
  if (info?.created_at) lines.push(`| **Créé le** | ${new Date(info.created_at).toLocaleDateString()} |`)
  if (info?.created_by) lines.push(`| **Créé par** | ${info.created_by} |`)
  lines.push(`| **Type** | ${analysis.type === 'unknown' ? 'Non détecté' : analysis.type} |`)
  lines.push(`| **Fichiers** | ${analysis.totalFiles} fichiers (${analysis.totalLines} lignes) |`)
  lines.push(`| **Tâches** | ${tasks.length} (${tasks.filter(t => t.status === 'done').length} terminées) |`)
  lines.push(`| **Analyse le** | ${now} |`)
  lines.push('')

  // ── Architecture ──
  lines.push('## 🏗️ Architecture')
  lines.push('')

  if (analysis.frameworks.length > 0) {
    lines.push(`**Frameworks :** ${analysis.frameworks.join(', ')}`)
    lines.push('')
  }

  // Tree structure (plain text for markdown)
  lines.push('```')
  lines.push(`${projectName}/`)
  function printTreePlain(entries, indent = '') {
    const len = entries.length
    for (let i = 0; i < len; i++) {
      const e = entries[i]
      const prefix = i === len - 1 ? '└── ' : '├── '
      if (e.type === 'directory') {
        lines.push(`${indent}${prefix}${e.name}/`)
        if (e.children && e.children.length > 0) {
          const nextIndent = i === len - 1 ? `${indent}    ` : `${indent}│   `
          printTreePlain(e.children, nextIndent)
        }
      } else {
        const sizeStr = e.lines > 0 ? ` (${e.lines} lignes, ${e.sizeHuman})` : ` (${e.sizeHuman})`
        lines.push(`${indent}${prefix}${e.name}${sizeStr}`)
      }
    }
  }
  printTreePlain(analysis.structure)
  lines.push('```')
  lines.push('')
  lines.push(`**Total :** ${analysis.totalFiles} fichiers, ${analysis.totalLines} lignes de code`)
  lines.push('')

  // ── Dépendances ──
  if (analysis.dependencies.prod.length > 0 || analysis.dependencies.dev.length > 0) {
    lines.push('## 📦 Dépendances')
    lines.push('')

    if (analysis.dependencies.prod.length > 0) {
      lines.push('### Production')
      lines.push('')
      lines.push('| Package | Version |')
      lines.push('|---------|---------|')
      for (const dep of analysis.dependencies.prod.sort((a, b) => a.name.localeCompare(b.name))) {
        lines.push(`| \`${dep.name}\` | \`${dep.version}\` |`)
      }
      lines.push('')
    }

    if (analysis.dependencies.dev.length > 0) {
      lines.push('### Développement')
      lines.push('')
      lines.push('| Package | Version |')
      lines.push('|---------|---------|')
      for (const dep of analysis.dependencies.dev.sort((a, b) => a.name.localeCompare(b.name))) {
        lines.push(`| \`${dep.name}\` | \`${dep.version}\` |`)
      }
      lines.push('')
    }
  }

  // ── Scripts ──
  const scriptEntries = Object.entries(analysis.scripts)
  if (scriptEntries.length > 0) {
    lines.push('## 🔧 Scripts')
    lines.push('')
    lines.push('| Commande | Description |')
    lines.push('|----------|-------------|')
    for (const [name, cmd] of scriptEntries) {
      lines.push(`| \`${name}\` | \`${cmd}\` |`)
    }
    lines.push('')
  }

  // ── Tâches ──
  if (tasks.length > 0) {
    lines.push('## ✅ Tâches')
    lines.push('')
    lines.push(`**Progression :** ${tasks.filter(t => t.status === 'done').length}/${tasks.length} terminées`)
    lines.push('')

    const statusEmoji = { 'done': '✅', 'in_progress': '🔄', 'todo': '⬜', 'blocked': '🔴' }
    const statusOrder = ['in_progress', 'todo', 'blocked', 'done']

    for (const status of statusOrder) {
      const filtered = tasks.filter(t => t.status === status)
      if (filtered.length === 0) continue

      const emoji = statusEmoji[status] || '⬜'
      const label = status === 'in_progress' ? 'En cours' : status === 'done' ? 'Terminées' : status === 'blocked' ? 'Bloquées' : 'À faire'
      lines.push(`### ${emoji} ${label} (${filtered.length})`)
      lines.push('')
      for (const t of filtered) {
        const area = t.area ? ` [${t.area}]` : ''
        lines.push(`- **${t.title}**${area} — \`${t.id}\``)
      }
      lines.push('')
    }
  }

  // ── Configuration ──
  if (analysis.configFiles.length > 0) {
    lines.push('## ⚙️ Configuration')
    lines.push('')
    for (const cfg of analysis.configFiles) {
      lines.push(`- \`${cfg}\``)
    }
    lines.push('')
  }

  // ── Infra ──
  lines.push('## 🚀 Infrastructure')
  lines.push('')
  if (analysis.hasGit) lines.push('- **Git** : Versionné')
  if (analysis.hasDocker) lines.push('- **Docker** : Conteneurisé')
  if (analysis.hasCi) lines.push('- **CI/CD** : Automatisé')
  if (analysis.hasTests) lines.push('- **Tests** : Présents')
  if (!analysis.hasGit && !analysis.hasDocker && !analysis.hasCi && !analysis.hasTests) {
    lines.push('*Aucune infrastructure détectée (standard).*')
  }
  lines.push('')

  // ── Plus gros fichiers ──
  if (analysis.largestFiles.length > 0) {
    lines.push('## 📄 Plus gros fichiers sources')
    lines.push('')
    lines.push('| Fichier | Lignes | Taille |')
    lines.push('|---------|--------|--------|')
    for (const f of analysis.largestFiles) {
      lines.push(`| \`${f.path}\` | ${f.lines} | ${f.sizeHuman} |`)
    }
    lines.push('')
  }

  // ── Footer ──
  lines.push('---')
  lines.push(`*Généré automatiquement le ${now} par l'outil de découverte de projet.*`)
  lines.push('')

  return lines.join('\n')
}

// ── Affichage console ──────────────────────────────

function showDiscovery(projectName, info, analysis, tasks) {
  const lines = []

  // ── En-tête ──
  lines.push('')
  lines.push(`${CYAN}${BOLD}════════════════════════════════════════════════════${R()}`)
  lines.push(`  ${CYAN}🔍 Découverte du projet : ${BOLD}${projectName}${R()}`)
  const statusIcon = info?.['status'] === 'active' ? '●' : info?.['status'] === 'archived' ? '○' : '◌'
  const statusColor = info?.['status'] === 'active' ? GREEN : GRAY
  lines.push(`  ${statusColor}${statusIcon} ${info?.['status'] || 'active'}${R()}  ${GRAY}— ${analysis.totalFiles} fichiers, ${analysis.totalLines} lignes${R()}`)
  lines.push(`${CYAN}${BOLD}════════════════════════════════════════════════════${R()}`)

  // ── Type de projet ──
  lines.push('')
  lines.push(`  ${BOLD}Type de projet${R()}`)
  const typeLabel = analysis.type === 'unknown' ? 'Non détecté' : analysis.type
  lines.push(`    ${CYAN}${typeLabel}${R()}`)
  if (analysis.frameworks.length > 0) {
    lines.push(`    Frameworks : ${analysis.frameworks.join(', ')}`)
  }
  if (analysis.configFiles.length > 0) {
    lines.push(`    Config     : ${analysis.configFiles.join(', ')}`)
  }

  // ── Dépendances ──
  if (analysis.dependencies.prod.length > 0 || analysis.dependencies.dev.length > 0) {
    lines.push('')
    lines.push(`  ${BOLD}Dépendances${R()}`)
    if (analysis.dependencies.prod.length > 0) {
      const deps = analysis.dependencies.prod.slice(0, 8)
      lines.push(`    ${GREEN}Production${R()}  : ${deps.map(d => `${CYAN}${d.name}${R()}@${GRAY}${d.version}${R()}`).join(', ')}`)
      if (analysis.dependencies.prod.length > 8) {
        lines.push(`    ${GRAY}     ... et ${analysis.dependencies.prod.length - 8} autre(s)${R()}`)
      }
    }
    if (analysis.dependencies.dev.length > 0) {
      const deps = analysis.dependencies.dev.slice(0, 6)
      lines.push(`    ${YELLOW}Développement${R()} : ${deps.map(d => `${CYAN}${d.name}${R()}@${GRAY}${d.version}${R()}`).join(', ')}`)
      if (analysis.dependencies.dev.length > 6) {
        lines.push(`    ${GRAY}     ... et ${analysis.dependencies.dev.length - 6} autre(s)${R()}`)
      }
    }
  }

  // ── Structure (arborescence) ──
  lines.push('')
  lines.push(`  ${BOLD}Structure${R()}`)
  lines.push('')
  lines.push(`    ${projectName}/`)
  function printTree(entries, indent = '    ') {
    const len = entries.length
    for (let i = 0; i < len; i++) {
      const e = entries[i]
      const isLast = i === len - 1
      const prefix = isLast ? '└── ' : '├── '

      if (e.type === 'directory') {
        const fileCount = e.totalFiles > 0 ? ` ${GRAY}(${e.totalFiles} fichiers)${R()}` : ''
        lines.push(`${indent}${prefix}${CYAN}${e.name}/${R()}${fileCount}`)
        if (e.children && e.children.length > 0) {
          const nextIndent = isLast ? `${indent}    ` : `${indent}│   `
          printTree(e.children, nextIndent)
        }
      } else {
        const sizeStr = e.lines > 0 ? ` ${GRAY}(${e.lines} lignes)${R()}` : ''
        lines.push(`${indent}${prefix}${e.name}${sizeStr}`)
      }
    }
  }
  printTree(analysis.structure.slice(0, 30)) // limit display
  if (analysis.structure.length > 30) {
    lines.push(`    ${GRAY}... et ${analysis.structure.length - 30} entrée(s) supplémentaires${R()}`)
  }

  // ── Plus gros fichiers ──
  if (analysis.largestFiles.length > 0) {
    lines.push('')
    lines.push(`  ${BOLD}Plus gros fichiers${R()}`)
    const maxNameLen = Math.max(...analysis.largestFiles.map(f => f.path.length), 10)
    for (const f of analysis.largestFiles) {
      lines.push(`    ${GRAY}•${R()} ${f.path.padEnd(maxNameLen)}  ${num(f.lines)} lignes  ${GRAY}${f.sizeHuman}${R()}`)
    }
  }

  // ── Infrastructure ──
  lines.push('')
  lines.push(`  ${BOLD}Infrastructure${R()}`)
  if (analysis.hasGit) lines.push(`    ${GREEN}✓${R()} Git`)
  if (analysis.hasDocker) lines.push(`    ${GREEN}✓${R()} Docker`)
  if (analysis.hasCi) lines.push(`    ${GREEN}✓${R()} CI/CD`)
  if (analysis.hasTests) lines.push(`    ${GREEN}✓${R()} Tests`)
  if (!analysis.hasGit && !analysis.hasDocker && !analysis.hasCi && !analysis.hasTests) {
    lines.push(`    ${GRAY}Standard (aucune infra spécifique détectée)${R()}`)
  }

  // ── Tâches ──
  if (tasks.length > 0) {
    lines.push('')
    lines.push(`  ${BOLD}Tâches${R()}`)
    const done = tasks.filter(t => t.status === 'done').length
    const inProgress = tasks.filter(t => t.status === 'in_progress').length
    const todo = tasks.filter(t => t.status === 'todo' || !t.status).length
    const pct = tasks.length > 0 ? Math.round((done / tasks.length) * 100) : 0
    const barLen = 15
    const filled = Math.round((pct / 100) * barLen)
    const bar = `${GREEN}${'█'.repeat(filled)}${GRAY}${'░'.repeat(barLen - filled)}${R()}`
    lines.push(`    ${bar}  ${BOLD}${pct}%${R()}  ${GREEN}✓${done}${R()}  ${CYAN}⟳${inProgress}${R()}  ${YELLOW}□${todo}${R()}  ${GRAY}(${tasks.length} totales)${R()}`)
  }

  // ── Actions ──
  lines.push('')
  lines.push(`  ${BOLD}${GREEN}Actions${R()}`)
  lines.push(`    ${GRAY}• Générer le README technique : \"génère un readme pour le projet ${projectName}\"${R()}`)
  lines.push(`    ${GRAY}• Voir l'état complet         : \"état du projet ${projectName}\"${R()}`)
  lines.push(`    ${GRAY}• Menu projet                : \"menu projet ${projectName}\"${R()}`)
  lines.push('')

  // Helper for num()
  function num(n) { return `${C(CYAN)}${n}${C(RESET)}` }
  // Override to use it properly
  // Actually let's just use the colors directly

  return lines.join('\n')
}

// ── Main ────────────────────────────────────────────

function main() {
  const projectName = getProjectName()

  if (!projectName) {
    const projects = listProjects()
    if (projects.length === 1) {
      // Auto-sélection
      const projectInfo = readProjectInfo(projects[0])
      const analysis = analyzeProject(join(WORKSPACES_DIR, projects[0]))
      const board = readTaskBoard(projects[0])

      if (generateReadme) {
        const readme = generateReadmeContent(projects[0], projectInfo, analysis, board.tasks || [])
        const readmePath = join(WORKSPACES_DIR, projects[0], 'README.md')
        writeFileSync(readmePath, readme, 'utf-8')
        console.log(`${GREEN}✅ README généré : ${readmePath}${R()}`)
        process.exit(0)
      }

      if (isJson) {
        console.log(JSON.stringify({
          project: projects[0],
          info: projectInfo,
          analysis: {
            type: analysis.type,
            frameworks: analysis.frameworks,
            dependencies: analysis.dependencies,
            scripts: analysis.scripts,
            totalFiles: analysis.totalFiles,
            totalLines: analysis.totalLines,
            largestFiles: analysis.largestFiles,
            hasGit: analysis.hasGit,
            hasDocker: analysis.hasDocker,
            hasCi: analysis.hasCi,
            hasTests: analysis.hasTests,
            configFiles: analysis.configFiles,
          },
          tasks: board.tasks || [],
        }, null, 2))
      } else {
        console.log(showDiscovery(projects[0], projectInfo, analysis, board.tasks || []))
      }
      process.exit(0)
    }

    console.log(`${YELLOW}⚠ Aucun projet spécifié.${R()}`)
    console.log('   Dis par exemple : "découvre le projet soulseek-downloader"')
    if (projects.length > 0) {
      console.log(`   Projets disponibles : ${projects.join(', ')}`)
    }
    process.exit(1)
  }

  const projectPath = join(WORKSPACES_DIR, projectName)
  if (!existsSync(projectPath)) {
    console.log(`${RED}❌ Projet "${projectName}" introuvable.${R()}`)
    const projects = listProjects()
    if (projects.length > 0) {
      console.log(`   Projets disponibles : ${projects.join(', ')}`)
    }
    process.exit(1)
  }

  const projectInfo = readProjectInfo(projectName)
  const analysis = analyzeProject(projectPath)
  const board = readTaskBoard(projectName)

  if (generateReadme) {
    const readme = generateReadmeContent(projectName, projectInfo, analysis, board.tasks || [])
    const readmePath = join(projectPath, 'README.md')
    writeFileSync(readmePath, readme, 'utf-8')
    console.log(`${GREEN}✅ README technique généré : ${readmePath}${R()}`)
    console.log(`   ${GRAY}Fichiers : ${analysis.totalFiles} | Lignes : ${analysis.totalLines} | Type : ${analysis.type}${R()}`)
    process.exit(0)
  }

  if (isJson) {
    console.log(JSON.stringify({
      project: projectName,
      info: projectInfo,
      analysis: {
        type: analysis.type,
        frameworks: analysis.frameworks,
        dependencies: analysis.dependencies,
        scripts: analysis.scripts,
        totalFiles: analysis.totalFiles,
        totalLines: analysis.totalLines,
        largestFiles: analysis.largestFiles,
        hasGit: analysis.hasGit,
        hasDocker: analysis.hasDocker,
        hasCi: analysis.hasCi,
        hasTests: analysis.hasTests,
        configFiles: analysis.configFiles,
      },
      tasks: board.tasks || [],
    }, null, 2))
  } else {
    console.log(showDiscovery(projectName, projectInfo, analysis, board.tasks || []))
  }

  process.exit(0)
}

main()
