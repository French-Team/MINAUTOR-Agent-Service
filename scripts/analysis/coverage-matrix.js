#!/usr/bin/env node
/**
 * coverage-matrix.js — Analyse complète couverture script-runner vs intercom
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PROJECT_ROOT = join(__dirname, '..', '..')

const REGISTRY_PATH = join(PROJECT_ROOT, 'data', 'scripts', 'registry.yaml')
const INTERCOM_PATH = join(PROJECT_ROOT, 'data', 'cahier-aides-alice', 'intercom-patterns.json')
const CACHE_PATH = join(PROJECT_ROOT, 'telecom', 'cache', 'embeddings.json')
const LOG_PATH = join(PROJECT_ROOT, 'telecom', 'logs', 'fuzzy-matches.log')

const R = '\x1b[0m'
const G = '\x1b[32m'
const Y = '\x1b[33m'
const C = '\x1b[36m'
const M = '\x1b[35m'
const B = '\x1b[1m'
const D = '\x1b[90m'

function parseScriptRegistry(yaml) {
  const scripts = []
  let current = null, currentParams = null, inParams = false
  for (const line of yaml.split('\n')) {
    const tr = line.trimEnd()
    const m = tr.match(/^\s*-\s+pattern:\s*"(.+)"/)
    if (m) {
      if (current && current.pattern && current.script) {
        current.params = currentParams ?? undefined; scripts.push(current)
      }
      current = { pattern: m[1] }; currentParams = null; inParams = false; continue
    }
    if (!current) continue
    const subj = tr.match(/^\s+subject:\s*"(.+)"/) || tr.match(/^\s+subject:\s*(\S+)/)
    if (subj) { current.subject = subj[1]; continue }
    const scr = tr.match(/^\s+script:\s*"(.+)"/) || tr.match(/^\s+script:\s*(\S+)/)
    if (scr) { current.script = scr[1]; continue }
    const desc = tr.match(/^\s+description:\s*"(.+)"/) || tr.match(/^\s+description:\s*(\S+)/)
    if (desc) { current.description = desc[1]; continue }
    if (tr.match(/^\s+params:/)) { currentParams = []; inParams = true; continue }
    if (inParams) {
      const nm = tr.match(/^\s+-\s+name:\s*"(.+)"/) || tr.match(/^\s+-\s+name:\s*(\S+)/)
      if (nm) { currentParams.push({ name: nm[1], from: '' }); continue }
      if (currentParams.length > 0) {
        const fm = tr.match(/^\s+from:\s*(\S+)/)
        if (fm) { currentParams[currentParams.length - 1].from = fm[1]; continue }
      }
      if (tr.match(/^\s+\w+:/) && !tr.startsWith(' ')) inParams = false
    }
  }
  if (current && current.pattern && current.script) {
    current.params = currentParams ?? undefined; scripts.push(current)
  }
  return scripts
}

function analyzeScriptRunner() {
  if (!existsSync(REGISTRY_PATH)) return { total: 0, bySubject: {}, scripts: [] }
  const raw = readFileSync(REGISTRY_PATH, 'utf-8')
  const scripts = parseScriptRegistry(raw)
  const bySubject = {}
  for (const s of scripts) {
    const subj = s.subject || '(aucun)'
    if (!bySubject[subj]) bySubject[subj] = { exact: [], catchAll: [], total: 0 }
    bySubject[subj].total++
    if (s.pattern === '.*') bySubject[subj].catchAll.push(s)
    else bySubject[subj].exact.push(s)
  }
  const subjectCounts = {}
  for (const [k, v] of Object.entries(bySubject)) subjectCounts[k] = v.total
  return { total: scripts.length, bySubject, subjectCounts, scripts }
}

function analyzeIntercom() {
  if (!existsSync(INTERCOM_PATH)) return { total: 0, patterns: [] }
  const raw = readFileSync(INTERCOM_PATH, 'utf-8')
  const data = JSON.parse(raw)
  return {
    total: (data.patterns || []).length,
    patterns: (data.patterns || []).map(p => ({
      id: p.id, name: p.name, subject: p.subject,
      keywords: p.keywords, minMatch: p.minMatch, keywordCount: p.keywords.length,
    })),
  }
}

function analyzeEmbeddings() {
  if (!existsSync(CACHE_PATH)) return { exists: false, entries: 0 }
  const raw = readFileSync(CACHE_PATH, 'utf-8')
  const cache = JSON.parse(raw)
  return { exists: true, entries: cache.entries?.length || 0, version: cache.version, updatedAt: cache.updatedAt }
}

function analyzeLogs() {
  if (!existsSync(LOG_PATH)) return { exists: false, accepted: 0, rejected: 0, rejectedDetails: [] }
  const content = readFileSync(LOG_PATH, 'utf-8').trim()
  if (!content) return { exists: true, accepted: 0, rejected: 0, rejectedDetails: [] }
  let accepted = 0, rejected = 0, rejectedDetails = []
  for (const line of content.split('\n')) {
    try {
      const e = JSON.parse(line)
      if (e.action === 'accepted') accepted++
      else if (e.action === 'rejected') { rejected++; rejectedDetails.push(e) }
    } catch {}
  }
  return { exists: true, accepted, rejected, rejectedDetails }
}

function buildCoverageMatrix(sr, ic) {
  const allSubjects = new Set()
  for (const subj of Object.keys(sr.subjectCounts)) allSubjects.add(subj)
  for (const p of ic.patterns) allSubjects.add(p.subject)
  const matrix = []
  for (const subject of allSubjects) {
    const srInfo = sr.bySubject[subject]
    const srExact = srInfo?.exact?.length || 0
    const srCC = srInfo?.catchAll?.length || 0
    const srTotal = srInfo?.total || 0
    const icInfo = ic.patterns.find(p => p.subject === subject)
    let srStatus = srTotal > 0 ? '✓' : '✗'
    if (srTotal > 0 && srExact === 0 && srCC > 0) srStatus = '⚠'
    let icStatus = icInfo ? '✓' : '✗'
    let gap = ''
    if (srTotal === 0 && icInfo) gap = 'SR manque patterns'
    if (srExact === 0 && icInfo) gap = 'SR seulement catch-all'
    if (srTotal > 0 && !icInfo) gap = 'IC manque mots-clés'
    if (srTotal === 0 && !icInfo) gap = 'NI SR NI IC'
    matrix.push({
      subject, srStatus, srExact, srCC, srTotal,
      icStatus, icId: icInfo?.id || '-', icKeywords: icInfo?.keywords || [],
      icKwCount: icInfo?.keywordCount || 0, icMinMatch: icInfo?.minMatch || '-',
      gap,
    })
  }
  return matrix.sort((a, b) => {
    if (a.gap && !b.gap) return -1; if (!a.gap && b.gap) return 1
    return a.subject.localeCompare(b.subject)
  })
}

function printResults(sr, ic, embeddings, logs, matrix) {
  const totalSr = sr.total
  const srSubjects = Object.keys(sr.subjectCounts).length
  const icSubjects = new Set(ic.patterns.map(p => p.subject)).size

  console.log(`\n${B}${C}══════════════════════════════════════════════════════════════════════════${R}`)
  console.log(`${B}${C}  MATRICE DE COUVERTURE : Script-Runner (regex) ↔ Intercom (keywords)${R}`)
  console.log(`${B}${C}══════════════════════════════════════════════════════════════════════════${R}`)

  console.log(`\n${B}Statistiques globales :${R}`)
  console.log(`  Script-runner : ${G}${totalSr}${R} patterns répartis sur ${G}${srSubjects}${R} sujets`)
  console.log(`  Intercom      : ${G}${ic.total}${R} patterns (mots-clés) répartis sur ${G}${icSubjects}${R} sujets`)

  const gaps = matrix.filter(r => r.gap)
  const overlaps = matrix.filter(r => !r.gap)
  console.log(`  Sujets communs : ${G}${overlaps.length}${R} | Gaps : ${M}${gaps.length}${R}`)

  console.log(`\n${B}${C}────────────────────────────────────────────────────────────────────────${R}`)
  console.log(`${B}  SUJET ${' '.repeat(28)} SR     IC      DÉTAIL${R}`)
  console.log(`${D}  ${'─'.repeat(70)}${R}`)

  for (const row of matrix) {
    const subj = row.subject.padEnd(28)
    const srBadge = `${row.srStatus} ${String(row.srTotal).padStart(2)}`
    const srDetail = row.srExact > 0 ? `${row.srExact} regex` : row.srCC > 0 ? `catch-all` : `--`
    const icBadge = `${row.icStatus} ${row.icId.padEnd(4)}`
    const icDetail = row.icKwCount > 0 ? `${row.icKwCount} kw(m${row.icMinMatch})` : `--`
    const gapColor = row.gap ? M : ''
    console.log(`  ${subj} ${srBadge}  ${srDetail.padEnd(8)}  ${icBadge}  ${icDetail.padEnd(14)} ${gapColor}${row.gap}${R}`)
  }

  if (gaps.length > 0) {
    console.log(`\n${B}${M}═════════ GAPS DÉTECTÉS ═════════${R}\n`)
    for (const g of gaps) {
      console.log(`  ${M}→ ${B}${g.subject}${R}`)
      if (g.srTotal === 0 && g.icKwCount > 0)
        console.log(`    SR: 0 patterns | IC: ${g.icKwCount} mots-clés (${g.icKeywords.join(', ')}) minMatch=${g.icMinMatch}`)
      else if (g.srExact === 0 && g.srCC > 0 && g.icKwCount > 0)
        console.log(`    SR: seulement catch-all .* (pas de patterns spécifiques) | IC: ${g.icKwCount} mots-clés`)
      else if (g.srTotal > 0 && g.icKwCount === 0)
        console.log(`    SR: ${g.srExact} patterns exacts | IC: 0 mots-clés dans intercom-patterns.json`)
      else
        console.log(`    SR: ${g.srTotal} patterns | IC: ${g.icKwCount} mots-clés`)
    }
  }

  // Analyse détaillée par subject
  console.log(`\n${B}${C}────────────────────────────────────────────────────────────────────────${R}`)
  console.log(`${B}  ANALYSE DÉTAILLÉE PAR SUJET${R}`)
  console.log(`${D}  ${'─'.repeat(70)}${R}`)

  const sortedSubjects = [...Object.entries(sr.subjectCounts)].sort((a, b) => b[1] - a[1])
  for (const [subj, count] of sortedSubjects) {
    const srInfo = sr.bySubject[subj]
    const exact = srInfo?.exact || []
    const icInfo = ic.patterns.find(p => p.subject === subj)

    console.log(`\n${B}  ${subj}${R} (${count} patterns SR${icInfo ? `, ${icInfo.keywordCount} keywords IC` : ''})`)

    // Top 5 descriptions de patterns SR
    console.log(`  ${D}Patterns SR :${R}`)
    const displayPatterns = exact.slice(0, 4)
    for (const p of displayPatterns) {
      const desc = (p.description || '').slice(0, 70)
      const hasParams = p.params ? ` [params: ${p.params.map(x => x.name).join(', ')}]` : ''
      console.log(`    ${D}• ${desc}${hasParams}${R}`)
    }
    if (exact.length > 4) console.log(`    ${D}  ... et ${exact.length - 4} autres${R}`)

    // Keywords IC
    if (icInfo) {
      console.log(`  ${D}Keywords IC : [${icInfo.keywords.join(', ')}] (minMatch=${icInfo.minMatch})${R}`)
    }
  }

  // Recommandations
  console.log(`\n${B}${C}══════════════════════════════════════════════════════════════════════════${R}`)
  console.log(`${B}  RECOMMANDATIONS${R}`)
  console.log(`${B}${C}══════════════════════════════════════════════════════════════════════════${R}\n`)

  // Vérifier les seuils minMatch problématiques
  console.log(`${B}Seuils minMatch :${R}`)
  for (const p of ic.patterns) {
    if (p.minMatch > p.keywordCount) {
      console.log(`  ${M}✗ ${p.id} ${p.subject}: minMatch=${p.minMatch} > ${p.keywordCount} keywords — IMPOSSIBLE À ATTEINDRE !${R}`)
    }
    const ratio = p.minMatch / p.keywordCount
    if (p.minMatch > 1 && ratio > 0.3 && p.minMatch <= p.keywordCount) {
      console.log(`  ${Y}⚠ ${p.id} ${p.subject}: minMatch=${p.minMatch}/${p.keywordCount} (${Math.round(ratio*100)}%) — seuil restrictif${R}`)
    }
  }

  let warned = false
  for (const p of ic.patterns) {
    if (p.minMatch > 1 && p.minMatch <= p.keywordCount) {
      const ratio = p.minMatch / p.keywordCount
      if (ratio >= 0.5) {
        if (!warned) {
          console.log(`\n${B}Sujets avec minMatch ≥ 50% des keywords (très restrictif) :${R}`)
          warned = true
        }
        console.log(`  ${B}${p.subject}${R} : ${p.minMatch}/${p.keywordCount} keywords requis (${Math.round(ratio*100)}%)`)
        console.log(`    Keywords : ${p.keywords.join(', ')}`)
        console.log(`    Conséquence : nécessite que l'utilisateur utilise ≥${p.minMatch} de ces mots précis`)
      }
    }
  }

  // Gaps prioritaires
  if (gaps.length > 0) {
    console.log(`\n${B}Gaps à combler en priorité :${R}`)
    for (const g of gaps) {
      if (g.srTotal === 0 && g.icKwCount > 0) {
        console.log(`  ${M}→ ${g.subject}${R} : ${g.icKwCount} mots-clés IC mais 0 patterns SR`)
        console.log(`    Ajouter des patterns regex pour : ${g.icKeywords.join(', ')}`)
      }
    }
  }

  // Fuzzy cache
  console.log(`\n${B}Cache embeddings (fuzzy matching) :${R}`)
  if (embeddings.exists) {
    const totalRelevant = sr.scripts.filter(s => s.pattern !== '.*').length
    const pct = Math.round(embeddings.entries / totalRelevant * 100)
    console.log(`  ${embeddings.entries}/${totalRelevant} patterns encodés (${pct}%) — version ${embeddings.version}`)
    if (embeddings.entries < totalRelevant) {
      console.log(`  ${Y}⚠ ${totalRelevant - embeddings.entries} patterns non encodés — fuzzy peut rater${R}`)
    }
  } else {
    console.log(`  ${M}✗ Cache absent — fuzzy matching non fonctionnel${R}`)
    console.log(`    Lancer rebuildCache() ou redémarrer le daemon`)
  }

  // Logs fuzzy
  console.log(`\n${B}Logs de routage fuzzy :${R}`)
  if (logs.exists) {
    console.log(`  Acceptés : ${G}${logs.accepted}${R} | Rejetés : ${Y}${logs.rejected}${R}`)
    if (logs.rejectedDetails.length > 0) {
      const demandeCount = {}
      for (const e of logs.rejectedDetails) {
        const d = (e.demande || '').toLowerCase().trim()
        if (d) demandeCount[d] = (demandeCount[d] || 0) + 1
      }
      const topRejected = Object.entries(demandeCount).sort((a, b) => b[1] - a[1]).slice(0, 5)
      if (topRejected.length > 0 && topRejected[0][1] > 1) {
        console.log(`  ${Y}Top demandes rejetées (récurrentes) :${R}`)
        for (const [d, c] of topRejected) {
          if (c >= 2) console.log(`    ${c}x "${d.slice(0, 55)}"`)
        }
      }
    }
  } else {
    console.log(`  ${Y}Aucun log disponible${R}`)
  }

  console.log(`\n${B}${C}══════════════════════════════════════════════════════════════════════════${R}`)
  console.log(`${B}  FLUX DE COMMUNICATION${R}`)
  console.log(`${B}${C}══════════════════════════════════════════════════════════════════════════${R}`)

  const flowSteps = [
    ['Étape 1', 'Script-runner', `${totalSr} patterns regex`, 'matchAndExecute()'],
    ['Étape 2', 'Intercom', `${ic.total} patterns keywords`, `tryRouteIntercom() (dans cli-main.ts)`],
    ['Étape 3', 'Fuzzy matching', `${embeddings.exists ? embeddings.entries + ' embeddings' : 'PAS ACTIF'}`, `fuzzyMatch() (dans telecom-daemon.ts)`],
    ['Étape 4', 'Fallback', 'Spawn agent-telecom', 'Maintenance manuelle'],
  ]

  for (const [step, system, coverage, source] of flowSteps) {
    const status = coverage.includes('PAS') || coverage.includes('0') && step !== 'Étape 4'
      ? `${M}✗${R}` : `${G}✓${R}`
    console.log(`  ${B}${step}${R} : ${status} ${system} — ${coverage}`)
    console.log(`        ${D}Source: ${source}${R}`)
    if (step === 'Étape 3' && !embeddings.exists) {
      console.log(`        ${Y}LM Studio requis sur http://localhost:1234${R}`)
    }
  }

  console.log(`\n${B}${C}══════════════════════════════════════════════════════════════════════════${R}`)
}

const sr = analyzeScriptRunner()
const ic = analyzeIntercom()
const embeddings = analyzeEmbeddings()
const logs = analyzeLogs()
const matrix = buildCoverageMatrix(sr, ic)
printResults(sr, ic, embeddings, logs, matrix)
