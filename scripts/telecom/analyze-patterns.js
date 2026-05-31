#!/usr/bin/env node
/**
 * scripts/telecom/analyze-patterns.js — Analyse et suggestion de patterns
 *
 * Outil de maintenance pour agent-telecom.
 * Analyse les échecs de matching (fuzzy-matches.log), le registre de patterns,
 * et propose des améliorations.
 *
 * Usage :
 *   node scripts/telecom/analyze-patterns.js                          # Résumé complet
 *   node scripts/telecom/analyze-patterns.js --rejected               # Analyse des échecs uniquement
 *   node scripts/telecom/analyze-patterns.js --coverage               # Couverture des patterns
 *   node scripts/telecom/analyze-patterns.js --suggest <demande>      # Suggère un pattern pour une demande
 *   node scripts/telecom/analyze-patterns.js --pattern <pattern>      # Teste un pattern contre les logs
 *   node scripts/telecom/analyze-patterns.js --rejected --json        # Sortie JSON brute
 *
 * Variables d'environnement :
 *   SCRIPT_DEMANDE — demande brute (optionnel)
 */

import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = join(__dirname, '..', '..')

// ── Chemins ──────────────────────────────────────────────

const LOG_FILE = join(PROJECT_ROOT, 'telecom', 'logs', 'fuzzy-matches.log')
const REGISTRY_FILE = join(PROJECT_ROOT, 'data', 'scripts', 'registry.yaml')
const CACHE_FILE = join(PROJECT_ROOT, 'telecom', 'cache', 'embeddings.json')
const SUGGESTIONS_FILE = join(PROJECT_ROOT, 'telecom', 'pattern-suggestions.json')

// ── Helpers ──────────────────────────────────────────────

function loadLogFile() {
  if (!existsSync(LOG_FILE)) return []
  try {
    const content = readFileSync(LOG_FILE, 'utf-8').trim()
    if (!content) return []
    return content.split('\n')
      .map(line => {
        try { return JSON.parse(line) } catch { return null }
      })
      .filter(e => e !== null)
  } catch {
    return []
  }
}

function parseSimpleYaml(yaml) {
  const scripts = []
  let current = null

  for (const line of yaml.split('\n')) {
    const trimmed = line.trimEnd()

    // Début d'une entrée
    const patternMatch = trimmed.match(/^\s*-\s+pattern:\s*"(.+)"$/)
    if (patternMatch) {
      if (current && current.pattern && current.script) {
        scripts.push(current)
      }
      current = { pattern: patternMatch[1] }
      continue
    }

    if (!current) continue

    const subjectMatch = trimmed.match(/^\s+subject:\s*"?([^"\s]+)"?$/)
    if (subjectMatch) { current.subject = subjectMatch[1]; continue }

    const scriptMatch = trimmed.match(/^\s+script:\s*"?([^"\s]+)"?$/)
    if (scriptMatch) { current.script = scriptMatch[1]; continue }

    const descMatch = trimmed.match(/^\s+description:\s*"(.+)"$/)
    if (descMatch) { current.description = descMatch[1]; continue }
  }

  // Dernière entrée
  if (current && current.pattern && current.script) {
    scripts.push(current)
  }

  return { scripts }
}

function loadRegistry() {
  if (!existsSync(REGISTRY_FILE)) return { scripts: [] }
  try {
    const yaml = readFileSync(REGISTRY_FILE, 'utf-8')
    return parseSimpleYaml(yaml)
  } catch {
    return { scripts: [] }
  }
}

function formatCount(n) {
  return String(n).padStart(3)
}

// ── Analyses ─────────────────────────────────────────────

/**
 * Analyse les échecs (rejected) et les regroupe par similarité textuelle.
 */
function analyzeRejected(entries) {
  return entries.filter(e => e.action === 'rejected')
}

function groupRejectedByText(rejected) {
  const groups = {}

  for (const e of rejected) {
    // Normaliser la demande pour le grouping (minuscules, espaces simples)
    const key = e.demande.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 60)

    if (!groups[key]) {
      groups[key] = { demande: e.demande, count: 0, lastSeen: e.timestamp, subjects: new Set() }
    }
    groups[key].count++
    if (e.timestamp > groups[key].lastSeen) groups[key].lastSeen = e.timestamp
    if (e.subject) groups[key].subjects.add(e.subject)
  }

  return Object.values(groups)
    .map(g => ({ ...g, subjects: [...g.subjects] }))
    .sort((a, b) => b.count - a.count)
}

/**
 * Suggère un pattern pour une demande non reconnue.
 * Utilise une heuristique simple : supprimer les mots communs, garder les mots-clés.
 */
function suggestPattern(demande) {
  const stopWords = ['le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'je', 'tu', 'il', 'elle',
    'nous', 'vous', 'ils', 'elles', 'mon', 'ton', 'son', 'ma', 'ta', 'sa', 'mes', 'tes', 'ses',
    'nos', 'vos', 'leurs', 'ce', 'cet', 'cette', 'ces', 'et', 'ou', 'mais', 'donc', 'car',
    'ni', 'que', 'qui', 'quoi', 'dont', 'où', 'sur', 'sous', 'dans', 'avec', 'pour', 'par',
    'moi', 'toi', 'lui', 'elle', 'nous', 'vous', 'eux', 'est', 'sont', 'a', 'ont', 'fait',
    'peut', 'veux', 'vais', 'aller', 'faire', 'voir', 'savoir', 'pouvoir', 'vouloir']

  const words = demande.toLowerCase().replace(/[?,.!;:]/g, '').split(/\s+/).filter(w => w.length > 2)
  const keywords = words.filter(w => !stopWords.includes(w))

  if (keywords.length === 0) return demande.replace(/[^a-zA-ZÀ-ÿ0-9\s]/g, '').trim() || '.*'

  // Construire un pattern qui match les mots-clés dans n'importe quel ordre
  const escaped = keywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (escaped.length === 1) return escaped[0]
  return `(?=.*${escaped.join(')(?=.*')}).*`
}

/**
 * Sauvegarde une suggestion dans le fichier pattern-suggestions.json.
 */
function saveSuggestion(demande, pattern, subject, script, rationale) {
  const dir = dirname(SUGGESTIONS_FILE)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  let suggestions = []
  try {
    if (existsSync(SUGGESTIONS_FILE)) {
      suggestions = JSON.parse(readFileSync(SUGGESTIONS_FILE, 'utf-8'))
    }
  } catch { /* fichier corrompu */ }

  // Vérifier si une suggestion similaire existe déjà
  const existing = suggestions.find(s => s.demande === demande)
  if (existing) {
    existing.count++
    existing.timestamp = new Date().toISOString()
  } else {
    suggestions.push({
      demande,
      suggestedPattern: pattern,
      subject,
      script,
      rationale,
      count: 1,
      timestamp: new Date().toISOString(),
    })
  }

  // Garder max 100 suggestions
  if (suggestions.length > 100) {
    suggestions = suggestions.slice(-100)
  }

  writeFileSync(SUGGESTIONS_FILE, JSON.stringify(suggestions, null, 2), 'utf-8')
}

// ── Modes d'affichage ────────────────────────────────────

function showFullReport(entries, registry) {
  const accepted = entries.filter(e => e.action === 'accepted')
  const rejected = entries.filter(e => e.action === 'rejected')

  console.log('═══════════════════════════════════════════')
  console.log('  🔧 Analyse des patterns — Rapport complet')
  console.log('═══════════════════════════════════════════\n')

  // Stats générales
  console.log('── Statistiques ──')
  console.log(`  Total logs       : ${entries.length}`)
  console.log(`  ✅ Acceptés      : ${accepted.length}`)
  console.log(`  ❌ Rejetés       : ${rejected.length}`)
  console.log(`  Taux de succès   : ${entries.length > 0 ? ((accepted.length / entries.length) * 100).toFixed(1) : 'N/A'}%`)
  console.log(`  Patterns connus  : ${registry.scripts.length}`)
  console.log(`  Période          : ${entries.length > 0 ? `${entries[0].timestamp.slice(0, 10)} → ${entries[entries.length - 1].timestamp.slice(0, 10)}` : 'N/A'}`)
  console.log('')

  // Top des échecs
  const rejectedGrouped = groupRejectedByText(rejected)
  if (rejectedGrouped.length > 0) {
    console.log(`── Top ${Math.min(rejectedGrouped.length, 10)} demandes non reconnues ──`)
    for (const g of rejectedGrouped.slice(0, 10)) {
      const subjects = g.subjects.length > 0 ? ` [${g.subjects.join(', ')}]` : ''
      console.log(`  ${formatCount(g.count)}×  "${g.demande.slice(0, 50)}"${subjects}`)
      console.log(`      Dernier: ${g.lastSeen.slice(0, 19)}`)
      // Proposer un pattern
      const suggested = suggestPattern(g.demande)
      console.log(`      💡 Suggestion: "${suggested}"`)
      console.log('')
    }
  } else {
    console.log('  ✅ Aucun échec enregistré — tout va bien !')
    console.log('')
  }

  // Top des acceptés (patterns les plus utilisés)
  if (accepted.length > 0) {
    const patternCounts = {}
    for (const e of accepted) {
      const key = e.script || e.matched_pattern || '?'
      if (!patternCounts[key]) patternCounts[key] = { count: 0, script: e.script || '?' }
      patternCounts[key].count++
    }

    const sorted = Object.entries(patternCounts)
      .map(([_, v]) => v)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    if (sorted.length > 0) {
      console.log(`── Top ${sorted.length} patterns les plus utilisés ──`)
      for (const s of sorted) {
        const scriptName = s.script.split('/').pop().replace('.js', '')
        console.log(`  ${formatCount(s.count)}×  ${scriptName}`)
      }
      console.log('')
    }
  }

  // Couverture des patterns (scripts jamais matchés)
  const matchedScripts = new Set(accepted.filter(e => e.script).map(e => e.script))
  const unmatched = registry.scripts.filter(e => !matchedScripts.has(e.script))
  if (unmatched.length > 0) {
    console.log(`── Patterns jamais utilisés (${unmatched.length}) ──`)
    for (const u of unmatched) {
      const name = u.script.split('/').pop().replace('.js', '') || u.script
      console.log(`  ${name.padEnd(25)} ${u.description.slice(0, 40)}`)
    }
    console.log('')
  }
}

function showRejectedReport(entries) {
  const rejected = entries.filter(e => e.action === 'rejected')

  if (rejected.length === 0) {
    console.log('✅ Aucune demande non reconnue dans le log.')
    return
  }

  const grouped = groupRejectedByText(rejected)
  const isJson = process.argv.includes('--json')

  if (isJson) {
    console.log(JSON.stringify({
      total: rejected.length,
      unique: grouped.length,
      groups: grouped.slice(0, 20),
      fetchedAt: new Date().toISOString(),
    }, null, 2))
    return
  }

  console.log(`❌ ${grouped.length} demande(s) unique(s) non reconnue(s) (${rejected.length} total)\n`)

  for (const g of grouped.slice(0, 15)) {
    const subjects = g.subjects.length > 0 ? `[${g.subjects.join(', ')}]` : ''
    console.log(`  ${formatCount(g.count)}×  "${g.demande.slice(0, 55)}" ${subjects}`)
    console.log(`      Dernier: ${g.lastSeen.slice(0, 19)}`)
    const suggested = suggestPattern(g.demande)
    console.log(`      💡 Suggestion de pattern: "${suggested}"`)
    console.log('')
  }

  if (grouped.length > 15) {
    console.log(`  ... et ${grouped.length - 15} autre(s) groupe(s).`)
    console.log(`  Utilise --json pour la liste complète.`)
    console.log('')
  }

  // Recommandations
  console.log('── Recommandations ──')
  for (const g of grouped.slice(0, 5)) {
    const suggested = suggestPattern(g.demande)
    const subject = g.subjects[0] || 'project-request'
    console.log('  Ajouter au registre (data/scripts/registry.yaml) :')
    console.log(`    - pattern: "${suggested}"`)
    console.log(`      subject: "${subject}"`)
    console.log(`      script: "scripts/projects/..."  # À adapter`)
    console.log(`      description: "Pattern suggéré pour: ${g.demande.slice(0, 30)}"`)
    console.log('')
  }
}

function showCoverage(registry, entries) {
  const accepted = entries.filter(e => e.action === 'accepted')
  const matchedPatterns = new Set(accepted.filter(e => e.matched_pattern).map(e => e.matched_pattern))
  const matchedScripts = new Set(accepted.filter(e => e.script).map(e => e.script))

  const totalPatterns = registry.scripts.length
  const matchedCount = matchedPatterns.size
  const percentMatched = totalPatterns > 0 ? ((matchedCount / totalPatterns) * 100).toFixed(1) : 'N/A'

  // Stats du cache
  let cacheStats = { size: 0, entries: 0, outdated: false }
  if (existsSync(CACHE_FILE)) {
    try {
      const cache = JSON.parse(readFileSync(CACHE_FILE, 'utf-8'))
      const cacheMtime = statSync(CACHE_FILE).mtimeMs
      const regMtime = existsSync(REGISTRY_FILE) ? statSync(REGISTRY_FILE).mtimeMs : 0
      cacheStats = {
        size: statSync(CACHE_FILE).size,
        entries: cache.entries?.length ?? 0,
        outdated: cacheMtime < regMtime,
      }
    } catch { /* ignoré */ }
  }

  console.log('═══════════════════════════════════════════')
  console.log('  📊 Couverture des patterns')
  console.log('═══════════════════════════════════════════\n')

  console.log('── Patterns ──')
  console.log(`  Total           : ${totalPatterns}`)
  console.log(`  Matchés (logs)  : ${matchedCount}`)
  console.log(`  Non matchés     : ${totalPatterns - matchedCount}`)
  console.log(`  Taux couverture : ${percentMatched}%`)
  console.log('')

  if (cacheStats.entries > 0) {
    console.log('── Cache embeddings ──')
    console.log(`  Taille          : ${(cacheStats.size / 1024).toFixed(1)} KB`)
    console.log(`  Entrées         : ${cacheStats.entries}`)
    console.log(`  Obsolète        : ${cacheStats.outdated ? 'OUI (reconstruire)' : 'Non'}`)
    if (cacheStats.outdated) {
      console.log('  💡 Commande      : node -e "require(\'./dist/fuzzy-matcher.js\').rebuildCache().then(console.log)"')
    }
    console.log('')
  }

  // Scripts jamais matchés
  const unmatched = registry.scripts.filter(e => !matchedScripts.has(e.script))
  if (unmatched.length > 0) {
    console.log(`── Scripts jamais matchés (${unmatched.length}) ──`)
    for (const u of unmatched) {
      const name = (u.script.split('/').pop() || '?').padEnd(15)
      console.log(`  ${name}  ${u.description.slice(0, 45)}`)
    }
    console.log('')
    console.log('  💡 Ces scripts n\'ont jamais été appelés via le fuzzy matching.')
    console.log('     Soit leurs patterns sont trop spécifiques, soit ils ne sont pas utilisés.')
    console.log('')
  }
}

function testPattern(demande, entries) {
  const escaped = demande.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(escaped, 'i')

  console.log(`Test du pattern : "${demande}"`)
  console.log(`Regex générée   : /${escaped}/i`)
  console.log('')

  // Chercher dans les logs des entrées qui pourraient matcher
  const matching = entries.filter(e => regex.test(e.demande))
  if (matching.length > 0) {
    console.log(`✅ ${matching.length} entrée(s) dans les logs matchent :`)
    for (const m of matching) {
      const action = m.action === 'accepted' ? '✅' : '❌'
      console.log(`  ${action} ${m.timestamp.slice(11, 19)} "${m.demande.slice(0, 50)}"` +
        (m.matched_pattern ? ` → ${m.script?.split('/').pop()}'` : ''))
    }
  } else {
    console.log('❌ Aucune entrée dans les logs ne match ce pattern.')
  }
  console.log('')

  // Vérifier si le pattern existe déjà dans le registre
  const registry = loadRegistry()
  const existing = registry.scripts.filter(s => s.pattern && s.pattern.includes(escaped))
  if (existing.length > 0) {
    console.log(`⚠️  ${existing.length} pattern(s) similaire(s) dans le registre :`)
    for (const e of existing) {
      const name = e.script ? e.script.split('/').pop() : '?'
      console.log(`   ${name} — ${e.description}`)
    }
  }
}

function suggestForDemande(demande, registry) {
  const suggested = suggestPattern(demande)
  const allSubjects = [...new Set(registry.scripts.filter(s => s.subject).map(s => s.subject))]

  // Trouver le meilleur subject candidat
  const subjectScores = allSubjects.map(subject => {
    const related = registry.scripts.filter(s => s.subject === subject)
    const score = related.reduce((acc, r) => {
      const words = demande.toLowerCase().split(/\s+/)
      const descWords = r.description.toLowerCase()
      const matchCount = words.filter(w => descWords.includes(w)).length
      return acc + matchCount
    }, 0)
    return { subject, score }
  })
  subjectScores.sort((a, b) => b.score - a.score)
  const bestSubject = subjectScores[0]?.subject || 'project-request'

  // Trouver le meilleur script candidat
  const registryScript = registry.scripts.find(s => s.subject === bestSubject)
  const bestScript = registryScript?.script || 'scripts/projects/list.js'

  console.log('═══════════════════════════════════════════')
  console.log('  💡 Suggestion de pattern')
  console.log('═══════════════════════════════════════════\n')

  console.log(`  Demande    : "${demande}"`)
  console.log(`  Pattern    : "${suggested}"`)
  console.log(`  Subject    : ${bestSubject}`)
  console.log(`  Script     : ${bestScript}`)
  console.log('')
  console.log('  Ajouter dans data/scripts/registry.yaml :')
  console.log('')
  console.log(`    - pattern: "${suggested}"`)
  console.log(`      subject: "${bestSubject}"`)
  console.log(`      script: "${bestScript}"`)
  console.log(`      description: "Nouveau pattern pour: ${demande.slice(0, 30)}"`)
  console.log('')

  // Sauvegarder la suggestion
  saveSuggestion(demande, suggested, bestSubject, bestScript,
    `Suggestion automatique pour la demande "${demande}"`)
  console.log(`  ✅ Suggestion sauvegardée dans ${SUGGESTIONS_FILE}`)
}

// ── Main ────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2)
  const demande = process.env.SCRIPT_DEMANDE || ''

  const entries = loadLogFile()
  const registry = loadRegistry()

  // Créer les dossiers nécessaires
  const logDir = dirname(LOG_FILE)
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true })

  if (args.includes('--rejected')) {
    showRejectedReport(entries)
  } else if (args.includes('--coverage')) {
    showCoverage(registry, entries)
  } else if (args.includes('--suggest')) {
    // Prendre l'argument suivant ou SCRIPT_DEMANDE
    const idx = args.indexOf('--suggest')
    const suggestDemande = idx >= 0 && idx + 1 < args.length && !args[idx + 1].startsWith('--')
      ? args[idx + 1]
      : demande || ''
    if (!suggestDemande) {
      console.error('Utilisation : node scripts/telecom/analyze-patterns.js --suggest "<demande>"')
      console.error('       ou   : SCRIPT_DEMANDE="<demande>" node scripts/telecom/analyze-patterns.js --suggest')
      process.exit(1)
    }
    suggestForDemande(suggestDemande, registry)
  } else if (args.includes('--pattern')) {
    const idx = args.indexOf('--pattern')
    const testPatternStr = idx >= 0 && idx + 1 < args.length && !args[idx + 1].startsWith('--')
      ? args[idx + 1]
      : demande || ''
    if (!testPatternStr) {
      console.error('Utilisation : node scripts/telecom/analyze-patterns.js --pattern "<pattern>"')
      process.exit(1)
    }
    testPattern(testPatternStr, entries)
  } else {
    // Rapport complet
    showFullReport(entries, registry)
  }
}

main()
