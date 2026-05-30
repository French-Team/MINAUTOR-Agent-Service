#!/usr/bin/env node
/**
 * scripts/alice/decouverte.js — Résumé de découverte du projet (v2 color)
 *
 * Produit un rapport structuré avec tableaux ASCII, barres, métriques colorées.
 *
 * Usage:
 *   node scripts/alice/decouverte.js              # résumé standard
 *   node scripts/alice/decouverte.js --json       # mode JSON
 *   node scripts/alice/decouverte.js --compact    # version courte
 *   node scripts/alice/decouverte.js --no-color   # sans couleurs ANSI
 *
 * Return codes:
 *   0 — Toujours (pas d'erreur)
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import {
  CYAN, GREEN, YELLOW, RED, GRAY, BOLD, RESET, LIME, MAGENTA,
  noColor, bar, num, fileName, label, highlight,
  header, tableHeader, tableSep, tableRow, pad,
  strWidth, termWidth, readFile, countLines, cellPad,
  humanSize,
} from './colors.js'

const CWD = process.cwd()
const args = process.argv.slice(2)
const jsonMode = args.includes('--json')
const compactMode = args.includes('--compact')

// ── Configuration des cibles de progression ───────────

const SCRIPT_DIR = fileURLToPath(new URL('.', import.meta.url))
const CONFIG_PATH = join(SCRIPT_DIR, 'decouverte-targets.json')

const DEFAULT_TARGETS = { agents: 30, skills: 50, profiles: 1000, sourceLines: 15000 }

/**
 * Charge les cibles depuis :
 * 1. Fichier decouverte-targets.json (à côté du script)
 * 2. Arguments CLI : --agents=40 --skills=60 --profiles=2000
 * 3. Valeurs par défaut
 * Les arguments CLI écrasent le fichier, le fichier écarte les defaults.
 */
function loadTargets() {
  // Étape 1 : defaults
  const targets = { ...DEFAULT_TARGETS }

  // Étape 2 : fichier de config
  try {
    if (existsSync(CONFIG_PATH)) {
      const raw = readFileSync(CONFIG_PATH, 'utf-8')
      const parsed = JSON.parse(raw)
      if (typeof parsed.agents === 'number') targets.agents = parsed.agents
      if (typeof parsed.skills === 'number') targets.skills = parsed.skills
      if (typeof parsed.profiles === 'number') targets.profiles = parsed.profiles
      if (typeof parsed.sourceLines === 'number') targets.sourceLines = parsed.sourceLines
    }
  } catch { /* fichier invalide → on garde les courants */ }

  // Étape 3 : arguments CLI (écrasent tout)
  for (const arg of args) {
    const match = arg.match(/^--(?:target-)?(agents|skills|profiles|source-lines)=(\d+)$/i)
    if (match) {
      const rawKey = match[1].toLowerCase()
      const key = rawKey === 'source-lines' ? 'sourceLines' : rawKey
      const val = parseInt(match[2], 10)
      if (val > 0 && ['agents', 'skills', 'profiles', 'sourceLines'].includes(key)) {
        targets[key] = val
      }
    }
  }

  return targets
}

// ── Utilitaires ──────────────────────────────────────

function listTsFiles(dir) {
  const full = join(CWD, dir)
  if (!existsSync(full)) return []
  return readdirSync(full)
    .filter(f => f.endsWith('.ts'))
    .sort()
}

function listDirs(dir) {
  const full = join(CWD, dir)
  if (!existsSync(full)) return []
  return readdirSync(full).filter(e => {
    try { return statSync(join(full, e)).isDirectory() } catch { return false }
  }).sort()
}

// ── Extracteurs ───────────────────────────────────────

function extractAgentInfo(filePath) {
  const content = readFile(filePath)
  if (!content) return null

  const id = content.match(/id:\s*'([^']+)'/) || content.match(/id:\s*"([^"]+)"/)
  const model = content.match(/model:\s*'([^']+)'/) || content.match(/model:\s*"([^"]+)"/)
  const provider = content.match(/provider:\s*'([^']+)'/) || content.match(/provider:\s*"([^"]+)"/)
  const displayName = content.match(/displayName:\s*'([^']+)'/) || content.match(/displayName:\s*"([^"]+)"/)
  const toolNamesMatch = content.match(/toolNames:\s*\[([^\]]+)\]/)
  const tools = toolNamesMatch ? toolNamesMatch[1].split(',').map(t => t.trim().replace(/['"]/g, '')).filter(Boolean) : []

  return {
    id: id ? id[1] : '?',
    displayName: displayName ? displayName[1] : null,
    model: model ? model[1] : '?',
    provider: provider ? provider[1] : '?',
    tools,
  }
}

function gatherSkills() {
  const skillsDir = join(CWD, 'skills')
  if (!existsSync(skillsDir)) return []
  const skills = []
  for (const entry of readdirSync(skillsDir).sort()) {
    const skillPath = join(skillsDir, entry, 'SKILL.md')
    if (existsSync(skillPath)) {
      const content = readFile(skillPath)
      const nameMatch = content?.match(/name:\s*(.+)/)
      const descMatch = content?.match(/description:\s*(.+)/)
      skills.push({
        id: entry,
        name: nameMatch ? nameMatch[1].trim() : entry,
        description: descMatch ? descMatch[1].trim() : '',
        lines: content ? countLines(content) : 0,
      })
    }
  }
  return skills
}

function gatherProfiles() {
  const profilesDir = join(CWD, 'data', 'profiles')
  if (!existsSync(profilesDir)) return {}
  const categories = {}
  for (const cat of readdirSync(profilesDir).sort()) {
    const catPath = join(profilesDir, cat)
    try {
      if (statSync(catPath).isDirectory()) {
        categories[cat] = readdirSync(catPath).filter(f => f.endsWith('.json')).length
      }
    } catch { /* ignore */ }
  }
  return categories
}

function gatherSrcFiles() {
  const srcDir = join(CWD, 'src')
  if (!existsSync(srcDir)) return { files: [], dirs: [], totalLines: 0 }
  const files = []
  const dirs = []
  let totalLines = 0

  for (const entry of readdirSync(srcDir).sort()) {
    const full = join(srcDir, entry)
    try {
      if (statSync(full).isDirectory()) {
        const subFiles = readdirSync(full).filter(f => f.endsWith('.ts'))
        let subLines = 0
        for (const sf of subFiles) {
          subLines += countLines(readFile(join(full, sf)))
        }
        dirs.push({ name: entry, files: subFiles.length, lines: subLines })
        totalLines += subLines
      } else if (entry.endsWith('.ts')) {
        const lines = countLines(readFile(full))
        const size = statSync(full).size
        files.push({ name: entry, lines, size })
        totalLines += lines
      }
    } catch { /* ignore */ }
  }

  files.sort((a, b) => b.lines - a.lines)
  return { files, dirs, totalLines }
}

// ── Sections formatées (colorées) ────────────────────

function sectionAgents(agents) {
  const lines = ['', header('AGENTS'), '']

  const w = [22, 22, 14, 20]
  lines.push(tableHeader(['ID', 'Modèle', 'Provider', 'Outils'], w))
  lines.push(tableSep(w))

  for (const a of agents) {
    const tools = a.tools.length > 0 ? a.tools.join(', ') : `${GRAY}—${RESET}`
    lines.push(tableRow([`${CYAN}${a.id}${RESET}`, a.model, a.provider, tools], w))
  }

  if (agents.length > 0) {
    lines.push(tableSep(w))
    lines.push(`${BOLD}${num(agents.length)}${RESET} agent(s) — ${num(agents.filter(a => a.tools.length > 0).length)} avec outils`)
  }

  return lines.join('\n')
}

function sectionSrcFiles(src) {
  const lines = ['', header('SOURCE (src/)'), '']

  if (src.files.length > 0) {
    const w = [30, 8, 10]
    lines.push(tableHeader(['Fichier', 'Lignes', 'Taille'], w))
    lines.push(tableSep(w))

    for (const f of src.files) {
      lines.push(tableRow([
        fileName(f.name),
        num(f.lines),
        humanSize(f.size),
      ], w))
    }
    lines.push('')
    lines.push(`${label('Total')} : ${num(src.totalLines)} lignes dans ${num(src.files.length)} fichiers`)
  }

  if (src.dirs.length > 0) {
    lines.push('')
    const w2 = [20, 10, 10, 22]
    lines.push(tableHeader(['Dossier', 'Fichiers', 'Lignes', 'Ratio'], w2))
    lines.push(tableSep(w2))

    const maxLines = Math.max(...src.dirs.map(d => d.lines), 1)
    for (const d of src.dirs) {
      const ratio = d.lines / maxLines
      lines.push(tableRow([
        `${CYAN}${d.name}${RESET}`,
        num(d.files),
        num(d.lines),
        bar(ratio, 16),
      ], w2))
    }
  }

  return lines.join('\n')
}

function sectionSkills(skills) {
  if (skills.length === 0) return `\n${GRAY}(aucune skill)${RESET}`

  const lines = ['', header('SKILLS'), '']
  const w = [24, 42, 8]
  lines.push(tableHeader(['ID', 'Description', 'Lignes'], w))
  lines.push(tableSep(w))

  for (const s of skills) {
    lines.push(tableRow([
      `${MAGENTA}${s.id}${RESET}`,
      s.description,
      num(s.lines),
    ], w))
  }

  return lines.join('\n')
}

function sectionProfiles(categories, targets) {
  const cats = Object.entries(categories)
  if (cats.length === 0) return `\n${GRAY}(aucun profil)${RESET}`

  const numCats = cats.length
  const share = numCats > 0 ? targets.profiles / numCats : 0

  // Calculer les totaux
  let total = 0
  for (const [, count] of cats) total += count

  // ── Largeur adaptative du tableau (comme le Kits table) ──
  const tableWidth = Math.min(termWidth() - 4, 100)

  // Colonnes : contenu détermine la largeur, le reste va à la barre
  const maxCatLen = Math.max(10, ...cats.map(([c]) => strWidth(c)))
  const wCat = maxCatLen + 2

  const valStr = `${total}/${targets.profiles}`
  const wVal = Math.max(14, strWidth(valStr) + 4)

  // Barre prend le reste : total = indent(2) + ┌(1) + wCat + ┬(1) + wVal + ┬(1) + wBar + ┐(1)
  const wBar = Math.max(8, tableWidth - wCat - wVal - 6)
  const barMax = wBar - 2

  const lines = ['', header('PROFILES'), '']

  // ── Top border ──
  lines.push(`${GRAY}┌${'─'.repeat(wCat)}┬${'─'.repeat(wVal)}┬${'─'.repeat(wBar)}┐${RESET}`)

  // ── Header ──
  lines.push(`${GRAY}│${RESET}${cellPad(`${BOLD}Catégorie${RESET}`, wCat)}${GRAY}│${RESET}${cellPad(`${BOLD}Actuel / Cible${RESET}`, wVal)}${GRAY}│${RESET}${cellPad(`${BOLD}Progression${RESET}`, wBar)}${GRAY}│${RESET}`)

  // ── Separator ──
  lines.push(`${GRAY}├${'─'.repeat(wCat)}┼${'─'.repeat(wVal)}┼${'─'.repeat(wBar)}┤${RESET}`)

  // ── Data rows ──
  for (const [cat, count] of cats) {
    const ratio = Math.min(count / share, 1)
    const barStr = bar(ratio, barMax)
    lines.push(`${GRAY}│${RESET}${cellPad(cat, wCat)}${GRAY}│${RESET}${cellPad(`${num(count)}${GRAY}/${Math.round(share)}${RESET}`, wVal)}${GRAY}│${RESET} ${barStr}${' '.repeat(Math.max(0, wBar - strWidth(barStr) - 1))}${GRAY}│${RESET}`)
  }

  // ── Footer separator ──
  lines.push(`${GRAY}├${'─'.repeat(wCat)}┼${'─'.repeat(wVal)}┼${'─'.repeat(wBar)}┤${RESET}`)

  // ── Total row ──
  lines.push(`${GRAY}│${RESET}${cellPad(`${BOLD}TOTAL${RESET}`, wCat)}${GRAY}│${RESET}${cellPad(`${BOLD}${num(total)}${RESET}${GRAY}/${targets.profiles}${RESET}`, wVal)}${GRAY}│${RESET} ${' '.repeat(Math.max(0, wBar - 1))}${GRAY}│${RESET}`)

  // ── Bottom border ──
  lines.push(`${GRAY}└${'─'.repeat(wCat)}┴${'─'.repeat(wVal)}┴${'─'.repeat(wBar)}┘${RESET}`)

  return lines.join('\n')
}

function sectionInfra() {
  const packageJson = readFile(join(CWD, 'package.json'))
  let pkg = {}
  if (packageJson) {
    try { pkg = JSON.parse(packageJson) } catch { /* ignore */ }
  }

  const eslint = existsSync(join(CWD, 'eslint.config.mjs'))
  const git = existsSync(join(CWD, '.git'))
  const github = existsSync(join(CWD, '.github'))
  const vscode = existsSync(join(CWD, '.vscode'))

  const lines = ['', header('INFRASTRUCTURE'), '']
  lines.push(`${pad('Package Manager', 22)} ${pkg.packageManager || 'npm'}`)
  lines.push(`${pad('Node', 22)} ${pkg.engines?.node || '—'}`)
  lines.push(`${pad('TypeScript', 22)} ${pkg.devDependencies?.typescript || '—'}`)
  lines.push(`${pad('ESLint', 22)} ${eslint ? `${GREEN}✓${RESET} configuré` : `${GRAY}—${RESET}`}`)
  lines.push(`${pad('Git', 22)} ${git ? `${GREEN}✓${RESET} .git` : `${GRAY}—${RESET}`}`)
  lines.push(`${pad('CI', 22)} ${github ? `${GREEN}✓${RESET} GitHub Actions` : `${GRAY}—${RESET}`}`)
  lines.push(`${pad('VS Code', 22)} ${vscode ? `${GREEN}✓${RESET} .vscode/settings.json` : `${GRAY}—${RESET}`}`)

  if (pkg.scripts) {
    lines.push('')
    lines.push(`${CYAN}Scripts npm :${RESET}`)
    const entries = Object.entries(pkg.scripts)
    const maxNameLen = Math.max(...entries.map(([n]) => n.length), 10)
    for (const [name, cmd] of entries) {
      lines.push(`  • ${pad(name, maxNameLen)}  ${cmd}`)
    }
  }

  return lines.join('\n')
}

function sectionOverview(info, src, targets) {
  const lines = ['', header('APERÇU'), '']
  lines.push(`${pad('Projet', 16)} ${BOLD}${info.name}${RESET}`)
  if (info.readme) lines.push(`${pad('README', 16)} ${num(info.readme.lines)} lignes`)
  if (info.agents) lines.push(`${pad('AGENTS.md', 16)} ${num(info.agents.lines)} lignes`)

  const totalFiles = src.files.length + src.dirs.reduce((a, d) => a + d.files, 0)
  lines.push(`${pad('TypeScript', 16)} ~${num(src.totalLines)} ${GRAY}lignes${RESET} (${num(totalFiles)} ${GRAY}fichiers${RESET})`)

  const configs = []
  if (existsSync(join(CWD, 'package.json'))) configs.push('package.json')
  if (existsSync(join(CWD, 'tsconfig.json'))) configs.push('tsconfig.json')
  if (existsSync(join(CWD, 'eslint.config.mjs'))) configs.push('eslint.config.mjs')
  if (configs.length > 0) {
    lines.push(`${pad('Config', 16)} ${configs.map(c => fileName(c)).join(', ')}`)
  }

  // Barre de progression adaptative vers les cibles
  const barWidth = Math.max(10, Math.min(35, Math.floor((termWidth() - 40) / 4)))
  lines.push('')
  if (info.agentCount > 0 || info.skillCount > 0) {
    lines.push(`${CYAN}Progression vers les cibles :${RESET}`)
    if (info.agentCount > 0) {
      const ratio = Math.min(info.agentCount / targets.agents, 1)
      lines.push(`  ${pad('Agents', 12)} ${bar(ratio, barWidth)} ${num(info.agentCount)}${GRAY}/${targets.agents}${RESET}`)
    }
    if (info.skillCount > 0) {
      const ratio = Math.min(info.skillCount / targets.skills, 1)
      lines.push(`  ${pad('Skills', 12)} ${bar(ratio, barWidth)} ${num(info.skillCount)}${GRAY}/${targets.skills}${RESET}`)
    }
    if (info.profileCount > 0) {
      const ratio = Math.min(info.profileCount / targets.profiles, 1)
      lines.push(`  ${pad('Profiles', 12)} ${bar(ratio, barWidth)} ${num(info.profileCount)}${GRAY}/${targets.profiles}${RESET}`)
    }
    if (src.totalLines > 0) {
      const ratio = Math.min(src.totalLines / targets.sourceLines, 1)
      lines.push(`  ${pad('Lignes TS', 12)} ${bar(ratio, barWidth)} ${num(src.totalLines)}${GRAY}/${targets.sourceLines}${RESET}`)
    }
  }

  return lines.join('\n')
}

// ── Main ─────────────────────────────────────────────

function main() {
  const ts = new Date().toISOString().slice(11, 19)

  // Collecter toutes les données
  const agentsDir = join(CWD, '.agents')
  const agents = existsSync(agentsDir)
    ? readdirSync(agentsDir)
        .filter(f => f.endsWith('.ts'))
        .map(f => extractAgentInfo(join(agentsDir, f)))
        .filter(Boolean)
    : []

  const src = gatherSrcFiles()
  const skills = gatherSkills()
  const profiles = gatherProfiles()

  const readmeContent = readFile(join(CWD, 'README.md'))
  const agentsDoc = readFile(join(CWD, 'AGENTS.md'))
  const targets = loadTargets()

  const info = {
    name: 'minautor-agents-service',
    readme: readmeContent ? { lines: countLines(readmeContent) } : null,
    agents: agentsDoc ? { lines: countLines(agentsDoc) } : null,
    agentCount: agents.length,
    skillCount: skills.length,
    profileCount: Object.values(profiles).reduce((a, b) => a + b, 0),
  }

  if (jsonMode) {
    console.log(JSON.stringify({ info, agents, src, skills, profiles }, null, 2))
    process.exit(0)
  }

  let outputLines = []

  if (compactMode) {
    outputLines.push(`${GRAY}[${ts}]${RESET} ${CYAN}Découverte du projet${RESET}`)
    outputLines.push('')
    outputLines.push(`${label('Projet')}  ${BOLD}${info.name}${RESET}`)
    outputLines.push(`${label('Agents')}  ${num(agents.length)} ${GRAY}·${RESET} ${label('Skills')}  ${num(skills.length)} ${GRAY}·${RESET} ${label('TS')}  ~${num(src.totalLines)} ${GRAY}lignes${RESET}`)
    outputLines.push(`${label('Provider')}  ${agents[0]?.provider || '?'}`)
  } else {
    outputLines.push(`${GRAY}[${ts}]${RESET} ${CYAN}${BOLD}Découverte du projet${RESET} ${GRAY}— ${info.name}${RESET}`)
    outputLines.push(sectionOverview(info, src, targets))
    outputLines.push('')
    outputLines.push(sectionAgents(agents))
    outputLines.push('')
    outputLines.push(sectionSrcFiles(src))
    outputLines.push('')
    outputLines.push(sectionSkills(skills))

    if (Object.keys(profiles).length > 0) {
      outputLines.push('')
      outputLines.push(sectionProfiles(profiles, targets))
    }

    outputLines.push('')
    outputLines.push(sectionInfra())
    outputLines.push('')
    outputLines.push(`${GRAY}${'═'.repeat(20)}${RESET} ${CYAN}${BOLD}FIN${RESET} ${GRAY}${'═'.repeat(20)}${RESET}`)
  }

  console.log(outputLines.join('\n'))
  process.exit(0)
}

main()
