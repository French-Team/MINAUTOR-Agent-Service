#!/usr/bin/env node
/**
 * scripts/alice/presentation-minautor.js — Carte de présentation du projet MINAUTOR
 * Déclenché quand l'utilisateur dit "bonjour" (sans nom)
 *
 * Usage:
 *   node scripts/alice/presentation-minautor.js
 *   node scripts/alice/presentation-minautor.js --json
 *   node scripts/alice/presentation-minautor.js --no-color
 */

import { existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import {
  CYAN, GREEN, YELLOW, GRAY, BOLD, RESET, LIME, MAGENTA,
  pad, strWidth, termWidth, readFile, countLines, splitAtSentences,
  extractSection, parseBullets, parseNumberedList, parseTable,
} from './colors.js'

const CWD = process.cwd()
const args = process.argv.slice(2)
const jsonMode = args.includes('--json')

// ── Logo ASCII ──────────────────────────────────────

function asciiLogo() {
  return [
    '',
    `  ${CYAN}${BOLD}███╗   ███╗${GRAY}██╗${CYAN}███╗   ██╗${GRAY} █████╗ ${CYAN}██╗   ██╗${GRAY}████████╗${CYAN} ██████╗ ${GRAY}██████╗${RESET}`,
    `  ${CYAN}████╗ ████║${GRAY}██║${CYAN}████╗  ██║${GRAY}██╔══██╗${CYAN}██║   ██║${GRAY}╚══██╔══╝${CYAN}██╔═══██╗${GRAY}██╔══██╗${RESET}`,
    `  ${CYAN}██╔████╔██║${GRAY}██║${CYAN}██╔██╗ ██║${GRAY}███████║${CYAN}██║   ██║${GRAY}   ██║   ${CYAN}██║   ██║${GRAY}██████╔╝${RESET}`,
    `  ${CYAN}██║╚██╔╝██║${GRAY}██║${CYAN}██║╚██╗██║${GRAY}██╔══██║${CYAN}██║   ██║${GRAY}   ██║   ${CYAN}██║   ██║${GRAY}██╔══██╗${RESET}`,
    `  ${CYAN}██║ ╚═╝ ██║${GRAY}██║${CYAN}██║ ╚████║${GRAY}██║  ██║${CYAN}╚██████╔╝${GRAY}   ██║   ${CYAN}╚██████╔╝${GRAY}██║  ██║${RESET}`,
    `  ${CYAN}╚═╝     ╚═╝${GRAY}╚═╝${CYAN}╚═╝  ╚═══╝${GRAY}╚═╝  ╚═╝${CYAN} ╚═════╝${GRAY}   ╚═╝   ${CYAN} ╚═════╝ ${GRAY}╚═╝  ╚═╝${RESET}`,
    '',
  ].join('\n')
}

// ── Badges ──────────────────────────────────────────

function badge(label, value, color = CYAN) {
  return `${color}${BOLD}[${label}]${RESET}${GRAY}:${RESET} ${BOLD}${value}${RESET}`
}

// ── Collecte des infos ──────────────────────────────

function gatherProjectInfo() {
  const readme = readFile(join(CWD, 'README.md'))
  const pkg = (() => {
    try { return JSON.parse(readFile(join(CWD, 'package.json')) || '{}') } catch { return {} }
  })()

  // Compter les fichiers source
  function walkDir(dir) {
    const full = join(CWD, dir)
    if (!existsSync(full)) return { files: 0, lines: 0 }
    let files = 0
    let lines = 0
    for (const entry of readdirSync(full)) {
      const p = join(full, entry)
      try {
        if (statSync(p).isDirectory()) {
          const sub = walkDir(dir + '/' + entry)
          files += sub.files
          lines += sub.lines
        } else if (entry.endsWith('.ts')) {
          files++
          lines += countLines(readFile(p))
        }
      } catch { /* ignore */ }
    }
    return { files, lines }
  }

  const src = walkDir('src')

  // Compter les agents
  const agentsDir = join(CWD, '.agents')
  const agentFiles = existsSync(agentsDir)
    ? readdirSync(agentsDir).filter(f => f.endsWith('.ts'))
    : []



  // Extraire les features clés du README
  const features = []

  if (readme) {
    const featureSection = readme.match(/## 💎 Caractéristiques Clés\n\n([\s\S]+?)\n\n---/)
    if (featureSection) {
      // Saute les emojis/icônes avant **nom**, accepte — – - : comme séparateur
      const items = featureSection[1].match(/- .*?\*\*(.+?)\*\*\s*[—–:-]\s*(.+)/g)
      if (items) {
        for (const item of items) {
          const m = item.match(/- .*?\*\*(.+?)\*\*\s*[—–:-]\s*(.+)/)
          if (m) features.push({ name: m[1], desc: m[2] })
        }
      }
    }
  }

  // Version : priorité au badge README, fallback package.json
  let version = pkg.version || '1.6.0'
  if (readme) {
    const badgeMatch = readme.match(/shields\.io\/badge\/version-([^.-]+(?:\.\d+)*)-/)
    if (badgeMatch) version = badgeMatch[1]
  }

  // Extraire dynamiquement les sections du README
  const pacoRaw = extractSection(readme, '🤖 Protocole PACO')
  const kitsRaw = extractSection(readme, '📦 Sécurité par Kits')
  const qualiteRaw = extractSection(readme, '🛡️ Qualité & Performance')

  // Parser les sections
  const pacoItems = parseNumberedList(pacoRaw || '')
  const pacoIntro = pacoRaw
    ? pacoRaw.split('\n').find(l => l.trim() && !/^\d+\./.test(l))?.trim() || ''
    : ''
  const qualiteBullets = parseBullets(qualiteRaw || '')
  const kitsTable = parseTable(kitsRaw || '')

  // Extraire la phrase d'intro des Kits
  const kitsIntro = kitsRaw
    ? kitsRaw.split('\n').find(l => l.trim() && !l.startsWith('|') && !l.startsWith('-') && !l.startsWith('```') && !l.startsWith('**'))?.trim() || ''
    : ''

  return {
    name: pkg.name || 'minautor-agents-service',
    version,
    description: pkg.description || readme?.split('\n')[2]?.replace(/^\*\*(.+?)\*\*$/, '$1')?.trim() || 'L\'orchestration multi-agents nouvelle génération pour TypeScript & Node.js',
    tagline: 'Framework d\'orchestration multi-agents conçu pour l\'ère de l\'IA',
    srcLines: src.lines,
    agentCount: agentFiles.length,
    features,
    nodeVersion: pkg.engines?.node || '≥22',
    license: pkg.license || 'MIT',
    // Sections dynamiques du README
    paco: pacoItems,
    pacoIntro,
    kitsIntro,
    kitsTable,
    qualite: qualiteBullets,
  }
}

// ── Construction de la carte ─────────────────────────

function buildOutput(info) {
  const lines = []

  // Largeur adaptative du cadre
  const cardWidth = Math.max(50, Math.min(termWidth() - 4, 80))

  // ── Helper : cadre ──
  const card = (line) => {
    const trimmed = line.replace(/^  /, '')  // enlève l'indentation standard
    const visible = strWidth(trimmed)
    const padRight = Math.max(0, cardWidth - visible)
    return `${GRAY}│${RESET} ${trimmed}${' '.repeat(padRight)} ${GRAY}│${RESET}`
  }

  // ── Haut du cadre ──
  lines.push(`${GRAY}┌${'─'.repeat(cardWidth + 2)}┐${RESET}`)
  lines.push(`${GRAY}│${RESET}${' '.repeat(cardWidth + 2)}${GRAY}│${RESET}`)  // ligne vide

  // ── Logo + Titre ──
  const logoLines = asciiLogo().split('\n')
  for (const logoLine of logoLines) {
    lines.push(card(logoLine))
  }
  // Titre + tagline : si trop long, on passe le tagline sur la ligne suivante
  const taglinePrefix = `  ${BOLD}${GREEN}Agent Service${RESET}    ${GRAY}v${info.version}${RESET}    ${GRAY}—${RESET}`
  const taglineFull = `${taglinePrefix}    ${CYAN}${info.tagline}${RESET}`
  if (strWidth(taglineFull) <= cardWidth) {
    lines.push(card(taglineFull))
  } else {
    // Ligne 1 : Agent Service vX.X.X —
    lines.push(card(taglinePrefix))
    // Ligne 2+ : tagline indenté
    const tagW = cardWidth - 4
    const tagLines = splitAtSentences(info.tagline, tagW)
    for (const tl of tagLines) {
      lines.push(card(`    ${CYAN}${tl}${RESET}`))
    }
  }

  // ── Séparateur interne (━ remplit cardWidth - 1) ──
  lines.push(card(''))
  lines.push(`${GRAY}│${RESET}  ${GRAY}${'━'.repeat(cardWidth - 1)}${RESET} ${GRAY}│${RESET}`)
  lines.push(card(''))

  // ── Section : Description ──
  lines.push(card(`  ${BOLD}${CYAN}◈${RESET} ${BOLD}Présentation${RESET}`))
  lines.push(card(''))
  // Wrap description (coupe aux points)
  const descLines = splitAtSentences(info.description, cardWidth)
  for (const dl of descLines) {
    lines.push(card(`  ${dl}`))
  }
  lines.push(card(''))

  // ── Section : Badges ──
  lines.push(card(`  ${BOLD}${CYAN}◈${RESET} ${BOLD}Informations${RESET}`))
  lines.push(card(''))
  const badges = [
    badge('LICENCE', info.license, GREEN),
    badge('NODE', info.nodeVersion, LIME),
    badge('TS', `~${info.srcLines} lignes`, YELLOW),
    badge('AGENTS', `${info.agentCount}`, MAGENTA),
  ]
  const badgeOneLine = badges.join('  ')
  if (strWidth(badgeOneLine) <= cardWidth) {
    // 1 ligne : les 4 badges
    lines.push(card(`  ${badgeOneLine}`))
  } else {
    // 2 lignes : 2 badges par ligne
    lines.push(card(`  ${badges.slice(0, 2).join('  ')}`))
    lines.push(card(`  ${badges.slice(2, 4).join('  ')}`))
  }
  lines.push(card(''))

  // ── Section : Fonctionnalités clés ──
  if (info.features.length > 0) {
    lines.push(card(''))
    lines.push(card(`  ${BOLD}${CYAN}◈${RESET} ${BOLD}Fonctionnalités${RESET}`))
    lines.push(card(''))
    for (const f of info.features) {
      const ftPrefix = `    ${GREEN}◆${RESET} ${BOLD}${f.name}${RESET} ${GRAY}—${RESET} `
      const fullLine = `${ftPrefix}${f.desc}`
      if (strWidth(fullLine) <= cardWidth) {
        lines.push(card(fullLine))
      } else {
        const ftPrefW = strWidth(ftPrefix)
        const subLines = splitAtSentences(f.desc, cardWidth - ftPrefW)
        for (let fi = 0; fi < subLines.length; fi++) {
          if (fi === 0) lines.push(card(`${ftPrefix}${subLines[fi]}`))
          else lines.push(card(`${' '.repeat(ftPrefW)}${subLines[fi]}`))
        }
      }
    }
  }

  // ── Section : PACO ──
  if (info.paco && info.paco.length > 0) {
    lines.push(card(''))
    lines.push(card(`  ${BOLD}${CYAN}◈${RESET} ${BOLD}Protocole PACO${RESET}`))
    if (info.pacoIntro) {
      lines.push(card(''))
      const piLines = splitAtSentences(info.pacoIntro, cardWidth - 4)
      for (const pi of piLines) {
        lines.push(card(`    ${GRAY}${pi}${RESET}`))
      }
    }
    lines.push(card(''))
    for (const item of info.paco) {
      const formatted = item.text.replace(/^\*\*(.+?)\*\*\s*[—–:-]\s*(.+)/, (_, name, desc) => {
        return `${BOLD}${name}${RESET} ${GRAY}—${RESET} ${desc}`
      })
      const pacoPrefix = `    ${GREEN}●${RESET} ${GRAY}${item.num}${RESET} `
      const pacoFull = `${pacoPrefix}${formatted}`
      if (strWidth(pacoFull) <= cardWidth) {
        lines.push(card(pacoFull))
      } else {
        const pacoPrefW = strWidth(pacoPrefix)
        const subLines = splitAtSentences(formatted, cardWidth - pacoPrefW)
        for (let pi = 0; pi < subLines.length; pi++) {
          if (pi === 0) lines.push(card(`${pacoPrefix}${subLines[pi]}`))
          else lines.push(card(`${' '.repeat(pacoPrefW)}${subLines[pi]}`))
        }
      }
    }
  }

  // ── Section : Kits ──
  if (info.kitsIntro || (info.kitsTable && info.kitsTable.length > 0)) {
    lines.push(card(''))
    lines.push(card(`  ${BOLD}${CYAN}◈${RESET} ${BOLD}Sécurité par Kits${RESET}`))
    if (info.kitsIntro) {
      lines.push(card(''))
      const kiLines = splitAtSentences(info.kitsIntro, cardWidth - 4)
      for (const ki of kiLines) {
        lines.push(card(`    ${GRAY}${ki}${RESET}`))
      }
    }
    if (info.kitsTable && info.kitsTable.length > 0) {
      // Mini tableau box-drawing pour les kits
      const maxKitLen = Math.max(10, ...info.kitsTable.map(r => strWidth(r.kit)))
      // Largeur droite : cardWidth - (2 indent + 1 ┌ + maxKitLen + 2 + 1 ┬ + 1 ┐)
      const rightW = cardWidth - maxKitLen - 7
      const descColW = rightW - 3  // largeur dispo pour le texte de desc (│ sp_desc pad │)

      // Pré-traiter : étendre les lignes avec wrapping des descriptions
      const expandedRows = []
      for (const row of info.kitsTable) {
        const descLines = splitAtSentences(row.desc, descColW)
        for (let ri = 0; ri < descLines.length; ri++) {
          expandedRows.push({
            kit: ri === 0 ? row.kit : null,
            desc: descLines[ri],
          })
        }
      }

      lines.push(card(''))
      // En-tête du tableau
      const hdr = `${GRAY}┌${'─'.repeat(maxKitLen + 2)}┬${'─'.repeat(rightW)}┐${RESET}`
      lines.push(card(`    ${hdr}`))
      for (const tRow of expandedRows) {
        const descPad = ` ${tRow.desc}`
        // padding = cardWidth - (2 indent + 1 pipe + kitPad(maxKitLen+2) + 1 pipe + descPad(1+desc) + 1 pipe)
        const padding = Math.max(0, cardWidth - maxKitLen - strWidth(tRow.desc) - 8)
        if (tRow.kit !== null) {
          const kitPad = ` ${BOLD}${tRow.kit}${RESET}${' '.repeat(maxKitLen - strWidth(tRow.kit) + 1)}`
          lines.push(card(`    ${GRAY}│${RESET}${kitPad}${GRAY}│${RESET}${descPad}${' '.repeat(padding)}${GRAY}│${RESET}`))
        } else {
          const kitPad = ' '.repeat(maxKitLen + 2)
          lines.push(card(`    ${GRAY}│${RESET}${kitPad}${GRAY}│${RESET}${descPad}${' '.repeat(padding)}${GRAY}│${RESET}`))
        }
      }
      const bot = `${GRAY}└${'─'.repeat(maxKitLen + 2)}┴${'─'.repeat(rightW)}┘${RESET}`
      lines.push(card(`    ${bot}`))
    }
  }

  // ── Section : Qualité & Performance ──
  if (info.qualite && info.qualite.length > 0) {
    lines.push(card(''))
    lines.push(card(`  ${BOLD}${CYAN}◈${RESET} ${BOLD}Qualité & Performance${RESET}`))
    lines.push(card(''))
    for (const bullet of info.qualite) {
      const formatted = bullet.replace(/^\*\*(.+?)\*\*\s*[—–:-]\s*(.+)/, (_, name, desc) => {
        return `${BOLD}${name}${RESET} ${GRAY}—${RESET} ${desc}`
      })
      const qlPrefix = `    ${GREEN}◆${RESET} `
      const qlFull = `${qlPrefix}${formatted}`
      if (strWidth(qlFull) <= cardWidth) {
        lines.push(card(qlFull))
      } else {
        const qlPrefW = strWidth(qlPrefix)
        const subLines = splitAtSentences(formatted, cardWidth - qlPrefW)
        for (let qi = 0; qi < subLines.length; qi++) {
          if (qi === 0) lines.push(card(`${qlPrefix}${subLines[qi]}`))
          else lines.push(card(`${' '.repeat(qlPrefW)}${subLines[qi]}`))
        }
      }
    }
  }

  // ── Section : Commandes ──
  lines.push(card(''))
  lines.push(card(`  ${BOLD}${CYAN}◈${RESET} ${BOLD}Commandes${RESET}`))
  lines.push(card(''))
  lines.push(card(`    ${pad('"bonjour"', 18)} ${GRAY}—${RESET} Cette carte de présentation`))
  lines.push(card(`    ${pad('"bonjour alice"', 18)} ${GRAY}—${RESET} Présentation personnelle d'Alice`))
  lines.push(card(`    ${pad('"decouverte"', 18)} ${GRAY}—${RESET} Rapport complet de découverte du projet`))
  lines.push(card(`    ${pad('"aide"', 18)} ${GRAY}—${RESET} Liste des agents et compétences`))
  lines.push(card(`    ${pad('"<question>"', 18)} ${GRAY}—${RESET} Transmission à un agent spécialisé`))

  // ── Footer ──
  lines.push(card(''))
  lines.push(`${GRAY}│${RESET}  ${GRAY}${'━'.repeat(cardWidth - 1)}${RESET} ${GRAY}│${RESET}`)
  const footerText = `${BOLD}${GREEN}✦${RESET} ${CYAN}${BOLD}MINAUTOR${RESET} ${GRAY}— L'excellence agentique par la structure ${BOLD}${GREEN}✦${RESET}`
  const fp = Math.max(0, cardWidth - 1 - strWidth(footerText))
  lines.push(`${GRAY}│${RESET}  ${' '.repeat(Math.floor(fp / 2))}${footerText}${' '.repeat(Math.ceil(fp / 2))} ${GRAY}│${RESET}`)
  lines.push(`${GRAY}│${RESET}  ${GRAY}${'━'.repeat(cardWidth - 1)}${RESET} ${GRAY}│${RESET}`)

  // ── Bas du cadre ──
  lines.push(card(''))
  lines.push(`${GRAY}└${'─'.repeat(cardWidth + 2)}┘${RESET}`)

  return lines.join('\n')
}

// ── Main ─────────────────────────────────────────────

function main() {
  const info = gatherProjectInfo()

  if (jsonMode) {
    console.log(JSON.stringify(info, null, 2))
  } else {
    console.log(buildOutput(info))
  }
  process.exit(0)
}

main()
