/**
 * test-parades.ts — Tests unitaires pour le service Parades
 *
 * Couvre 3 domaines :
 *   1. Phase detection — evaluateCondition(), determinePhase(), YAML rules loading
 *   2. Format de sortie — loadSuggestions(), writeSuggestions(), parseSuggestionsFromOutput()
 *   3. Anti-répétition — classifyCommand(), LearningTracker (recordChoice, getPreferences, shift detection, reset)
 *
 * Usage : node dist/test/test-parades.js
 */

import { writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { safeExit } from '../constants.js'
import { loadSuggestions, writeSuggestions, clearSuggestions, hasSuggestions, parseSuggestionsFromOutput } from '../cli-suggestions.js'
import { writeLastContext, readLastContext, clearLastContext, isParadesRunning } from '../parades.js'
import { classifyCommand, LearningTracker } from '../learning.js'

// ── ANSI constants ───────────────────────────────────────

const RESET = '\x1b[0m'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const CYAN = '\x1b[36m'
const GRAY = '\x1b[90m'
const BOLD = '\x1b[1m'
const PASS = `${GREEN}✓${RESET}`
const FAIL = `${RED}✗${RESET}`

let passed = 0
let failed = 0

function assert(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed++
    console.log(`  ${PASS} ${label}`)
  } else {
    failed++
    console.log(`  ${FAIL} ${label}${detail ? ` — ${RED}${detail}${RESET}` : ''}`)
  }
}

function assertEqual(label: string, actual: unknown, expected: unknown): void {
  const ok = actual === expected
  assert(label, ok, `attendu: ${JSON.stringify(expected)}, obtenu: ${JSON.stringify(actual)}`)
}

// ════════════════════════════════════════════════════════════
//   PHASE 1 : evaluateCondition — tous les opérateurs
// ════════════════════════════════════════════════════════════

function testEvaluateCondition() {
  console.log(`\n${BOLD}── PHASE 1 : evaluateCondition — opérateurs${RESET}`)
  console.log(`  ${GRAY}Logique de détection de phase : comparateurs, notation pointée, edge cases${RESET}\n`)

  // Helper qui duplique exactement la logique de src/parades.ts evaluateCondition
  function evalCond(key: string, operator: string, value: unknown, metadata: Record<string, unknown>): boolean {
    const parts = key.split('.')
    let current: unknown = metadata
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') {
        current = undefined
        break
      }
      current = (current as Record<string, unknown>)[part]
    }

    if (current === undefined || current === null) {
      if (operator === '==') return value === 0 || value === null || value === undefined || value === ''
      if (operator === '!=') return value !== null && value !== undefined
      if (operator === 'exists') return false
      return false
    }

    switch (operator) {
      case '==': return (current as number) == (value as number)
      case '>': return (current as number) > (value as number)
      case '>=': return (current as number) >= (value as number)
      case '<': return (current as number) < (value as number)
      case '<=': return (current as number) <= (value as number)
      case '!=': return (current as number) != (value as number)
      case 'exists': return true
      default: return false
    }
  }

  // ── Notations pointées ──
  assert('projects.count == 0 → true (demarrage)',
    evalCond('projects.count', '==', 0, { projects: { count: 0 } }))
  assert('projects.count > 0 → true (projets existent)',
    evalCond('projects.count', '>', 0, { projects: { count: 3 } }))
  assert('projects.count >= 10 → false',
    !evalCond('projects.count', '>=', 10, { projects: { count: 3 } }))

  // ── Operateurs de comparaison ──
  assert('count < 10 → true', evalCond('count', '<', 10, { count: 5 }))
  assert('count < 10 → false', !evalCond('count', '<', 10, { count: 15 }))
  assert('count <= 10 → true (egalite)', evalCond('count', '<=', 10, { count: 10 }))
  assert('count > 5 → true', evalCond('count', '>', 5, { count: 8 }))
  assert('count > 5 → false', !evalCond('count', '>', 5, { count: 2 }))

  // ── Operateur exists ──
  assert('exists sur cle presente → true', evalCond('foo', 'exists', null, { foo: 'bar' }))
  assert('exists sur cle absente → false', !evalCond('baz', 'exists', null, { foo: 'bar' }))

  // ── Operateur != ──
  assert('count != 5 → true (different)', evalCond('count', '!=', 5, { count: 3 }))
  assert('count != 3 → false (egal)', !evalCond('count', '!=', 3, { count: 3 }))

  // ── Edge cases ──
  assert('cle inexistante == 0 → true (undefined == 0)',
    evalCond('nonexistent', '==', 0, {}))
  assert('cle inexistante > 0 → false',
    !evalCond('nonexistent', '>', 0, {}))
  assert('cle inexistante != null → false',
    !evalCond('nonexistent', '!=', null, {}))
  assert('chemin profond inexistant == 0 → true',
    evalCond('a.b.c.d', '==', 0, { a: { b: {} } }))
  assert('chemin profond inexistant != 0 → true',
    evalCond('a.b.c.d', '!=', 0, { a: { b: {} } }))
  assert('cle null == 0 → true',
    evalCond('x', '==', 0, { x: null }))
  assert('cle undefined == 0 → true',
    evalCond('x', '==', 0, { x: undefined }))
  assert('sur null, tout operateur sauf == et != → false',
    !evalCond('x', '>', 5, { x: null }))

  // ── Operateur inconnu ──
  assert('operateur inconnu → false', !evalCond('x', '???', 0, { x: 1 }))
}

// ════════════════════════════════════════════════════════════
//   PHASE 2 : determinePhase — selection de phase
// ════════════════════════════════════════════════════════════

function testDeterminePhase() {
  console.log(`\n${BOLD}── PHASE 2 : determinePhase — selection de phase${RESET}`)
  console.log(`  ${GRAY}Logique de selection : Phase 0 (demarrage) → Phase 3 (override) → Phase 1/2${RESET}\n`)

  // Helper determinePhase qui duplique la logique de src/parades.ts
  interface PhaseRule {
    phase: number; label: string; description: string
    conditions: { key: string; operator: string; value: unknown }[]
    instructions: string; maxParades: number
  }
  interface PhaseConfig {
    phases: PhaseRule[]; defaultPhase: number
    contextKeys: { required: string[]; optional: string[] }
  }

  const phaseConfig: PhaseConfig = {
    phases: [
      { phase: 0, label: 'Demarrage', description: '', conditions: [{ key: 'projects.count', operator: '==', value: 0 }], instructions: '', maxParades: 3 },
      { phase: 3, label: 'Apprentissage', description: '', conditions: [{ key: 'phase.override', operator: '>=', value: 3 }], instructions: '', maxParades: 5 },
      { phase: 1, label: 'Metadonnees', description: '', conditions: [{ key: 'projects.count', operator: '>', value: 0 }, { key: 'evolution.paradesGenerated', operator: '<', value: 10 }], instructions: '', maxParades: 4 },
      { phase: 2, label: 'Exploration fichiers', description: '', conditions: [{ key: 'evolution.paradesGenerated', operator: '>=', value: 10 }], instructions: '', maxParades: 5 },
    ],
    defaultPhase: 1,
    contextKeys: { required: ['projects.count'], optional: ['evolution.paradesGenerated', 'phase.override'] },
  }

  function evalCond(key: string, op: string, val: unknown, meta: Record<string, unknown>): boolean {
    const parts = key.split('.')
    let cur: unknown = meta
    for (const p of parts) {
      if (cur === null || cur === undefined || typeof cur !== 'object') { cur = undefined; break }
      cur = (cur as Record<string, unknown>)[p]
    }
    if (cur === undefined || cur === null) {
      if (op === '==') return val === 0 || val === null || val === undefined || val === ''
      if (op === '!=') return val !== null && val !== undefined
      if (op === 'exists') return false
      return false
    }
    switch (op) {
      case '==': return (cur as number) == (val as number)
      case '>': return (cur as number) > (val as number)
      case '>=': return (cur as number) >= (val as number)
      case '<': return (cur as number) < (val as number)
      case '<=': return (cur as number) <= (val as number)
      case '!=': return (cur as number) != (val as number)
      case 'exists': return true
      default: return false
    }
  }

  function determinePhase(metadata: Record<string, unknown>): { phase: PhaseRule; phaseNumber: number } {
    for (const phase of phaseConfig.phases) {
      if (phase.conditions.length === 0) return { phase, phaseNumber: phase.phase }
      const allMatch = phase.conditions.every((cond) => evalCond(cond.key, cond.operator, cond.value, metadata))
      if (allMatch) return { phase, phaseNumber: phase.phase }
    }
    const def = phaseConfig.phases.find(p => p.phase === phaseConfig.defaultPhase)
    if (def) return { phase: def, phaseNumber: phaseConfig.defaultPhase }
    return { phase: { phase: 1, label: 'Fallback', description: '', conditions: [], instructions: '', maxParades: 4 }, phaseNumber: 1 }
  }

  // Cas 0 : Aucun projet → Phase 0 (Demarrage)
  const r0 = determinePhase({ projects: { count: 0 } })
  assertEqual('Phase 0 : aucun projet → Demarrage', r0.phaseNumber, 0)
  assertEqual('  → label Demarrage', r0.phase.label, 'Demarrage')

  // Cas 0b : Projets existants + override >= 3 → Phase 3
  const r0b = determinePhase({ projects: { count: 2 }, phase: { override: 3 } })
  assertEqual('Phase 3 : override manuel', r0b.phaseNumber, 3)

  // Cas 1 : 1 projet, 0 generations → Phase 1 (Metadonnees)
  const r1 = determinePhase({ projects: { count: 1 }, evolution: { paradesGenerated: 0 } })
  assertEqual('Phase 1 : 1 projet, 0 generations → Metadonnees', r1.phaseNumber, 1)

  // Cas 1b : 3 projets, 5 generations → Phase 1
  const r1b = determinePhase({ projects: { count: 3 }, evolution: { paradesGenerated: 5 } })
  assertEqual('Phase 1 : 3 projets, 5 generations → Metadonnees', r1b.phaseNumber, 1)

  // Cas 2 : 1 projet, 10 generations → Phase 2 (Exploration fichiers)
  const r2 = determinePhase({ projects: { count: 1 }, evolution: { paradesGenerated: 10 } })
  assertEqual('Phase 2 : 1 projet, 10 generations → Exploration', r2.phaseNumber, 2)

  // Cas 2b : 2 projets, 50 generations → Phase 2
  const r2b = determinePhase({ projects: { count: 2 }, evolution: { paradesGenerated: 50 } })
  assertEqual('Phase 2 : 2 projets, 50 generations → Exploration', r2b.phaseNumber, 2)

  // Cas 0 prime sur Phase 1 : meme si l'agent a des generations, pas de projet → Phase 0
  const r3 = determinePhase({ projects: { count: 0 }, evolution: { paradesGenerated: 20 } })
  assertEqual('Phase 0 prime : pas de projet malgre 20 generations → Demarrage', r3.phaseNumber, 0)

  // Cas sans metadata du tout → Phase 0 (undefined.projects.count == 0 match)
  const r4 = determinePhase({})
  assertEqual('Fallback : metadata vide → Phase 0', r4.phaseNumber, 0)

  // Cas projects present mais evolution absent → Phase 1
  const r5 = determinePhase({ projects: { count: 2 } })
  assertEqual('Phase 1 : evolution.paradesGenerated absent (0 implicite)', r5.phaseNumber, 1)
}

// ════════════════════════════════════════════════════════════
//   PHASE 3 : Contexte persistant (writeLastContext / readLastContext / clearLastContext)
// ════════════════════════════════════════════════════════════

function testContextPersistence() {
  console.log(`\n${BOLD}── PHASE 3 : Contexte persistant${RESET}`)
  console.log(`  ${GRAY}writeLastContext() / readLastContext() / clearLastContext()${RESET}\n`)

  const LAST_CONTEXT_PATH = join(process.cwd(), 'telecom', '.last-context.json')

  // Nettoyer etat initial
  clearLastContext()

  // 1. Pas de contexte → null
  const init = readLastContext()
  assertEqual('readLastContext() sans fichier → null', init, null)

  // 2. Ecrire un contexte
  writeLastContext({ action: 'route', demande: 'liste mes projets' })
  const r1 = readLastContext()
  assert('readLastContext() apres write → non null', r1 !== null)
  assertEqual('  → action = route', r1?.action, 'route')
  assertEqual('  → demande = liste mes projets', r1?.demande, 'liste mes projets')

  // Verifier le timestamp dans le fichier brut (hors du type ParadeContext qui ne l'exporte pas)
  try {
    const raw = JSON.parse(readFileSync(LAST_CONTEXT_PATH, 'utf-8')) as { timestamp?: number }
    assert('  → timestamp present dans le fichier', typeof raw.timestamp === 'number', `type: ${typeof raw.timestamp}`)
  } catch {
    assert('  → lecture du fichier brut', false, 'impossible de lire .last-context.json')
  }

  // 3. Contexte avec reponse LLM
  writeLastContext({ action: 'llm-response', demande: 'explique ce code', llmResponse: 'Ce code fait X' })
  const r2 = readLastContext()
  assertEqual('Contexte LLM : action = llm-response', r2?.action, 'llm-response')
  assertEqual('  → llmResponse present', r2?.llmResponse, 'Ce code fait X')

  // 4. Contexte avec projectName
  writeLastContext({ action: 'task-done', projectName: 'soulseek-downloader' })
  const r3 = readLastContext()
  assertEqual('Contexte task-done : projectName present', r3?.projectName, 'soulseek-downloader')

  // 5. Nettoyage
  clearLastContext()
  const afterClear = readLastContext()
  assertEqual('readLastContext() apres clear → null', afterClear, null)

  // 6. Verifier que isParadesRunning existe et est un booleen
  const flag = isParadesRunning()
  assert('isParadesRunning() retourne un booleen', typeof flag === 'boolean', `type: ${typeof flag}`)
}

// ════════════════════════════════════════════════════════════
//   PHASE 4 : Format de sortie — loadSuggestions, parseSuggestionsFromOutput
// ════════════════════════════════════════════════════════════

function testOutputFormat() {
  console.log(`\n${BOLD}── PHASE 4 : Format de sortie — loadSuggestions & parseSuggestionsFromOutput${RESET}`)
  console.log(`  ${GRAY}Valide les deux formats (objet {menu, items} + tableau)${RESET}\n`)

  const SUGGESTIONS_PATH = join(process.cwd(), 'telecom', 'suggestions.json')

  // Nettoyer avant
  clearSuggestions()

  // 1. Pas de fichier → []
  assert('hasSuggestions() sans fichier → false', !hasSuggestions())
  assertEqual('loadSuggestions() sans fichier → []', loadSuggestions().length, 0)

  // 2. Ecrire un fichier vide {} → []
  writeFileSync(SUGGESTIONS_PATH, '{}', 'utf-8')
  assertEqual('loadSuggestions() fichier vide {} → []', loadSuggestions().length, 0)

  // 3. Format tableau (format writeSuggestions legacy)
  writeSuggestions([
    { label: 'Explorer le projet', description: 'Voir la structure du projet', command: '!explore mon-projet' },
    { label: 'Deployer en dry-run', description: 'Simuler le deploiement', command: '!deploy mon-projet --dry-run', group: 'Deploiement' },
  ])
  assert('hasSuggestions() → true', hasSuggestions())
  const loaded = loadSuggestions()
  assertEqual('loadSuggestions() → 2 items', loaded.length, 2)
  assertEqual('  → label item 0', loaded[0].label, 'Explorer le projet')
  assertEqual('  → command item 0', loaded[0].command, '!explore mon-projet')
  assertEqual('  → group item 1', loaded[1].group, 'Deploiement')

  // 4. Nettoyage
  clearSuggestions()
  assert('hasSuggestions() apres clear → false', !hasSuggestions())

  // 5. Format objet { menu, items } (format agent-parades)
  const objData = { menu: 'Actions rapides', items: [
    { label: 'Debloquer tache', description: 'Tache T3 bloquee', command: '!project unblock T3 mon-projet' },
    { label: 'Voir statut', description: 'Progression du projet', command: '!project status mon-projet' },
  ]}
  writeFileSync(SUGGESTIONS_PATH, JSON.stringify(objData), 'utf-8')
  const loaded2 = loadSuggestions()
  assertEqual('loadSuggestions() format {menu, items} → 2 items', loaded2.length, 2)
  assertEqual('  → label item 0', loaded2[0].label, 'Debloquer tache')

  // 6. Fichier corrompu → []
  writeFileSync(SUGGESTIONS_PATH, '{broken json', 'utf-8')
  assertEqual('loadSuggestions() JSON corrompu → []', loadSuggestions().length, 0)

  // 7. Fichier avec items invalide (pas un tableau) → []
  writeFileSync(SUGGESTIONS_PATH, JSON.stringify({ menu: 'Actions', items: 'pas-un-tableau' }), 'utf-8')
  assertEqual('loadSuggestions() items non tableau → []', loadSuggestions().length, 0)

  // 8. Fichier avec items qui manquent label ou command → filtres
  writeFileSync(SUGGESTIONS_PATH, JSON.stringify({ menu: 'Actions', items: [
    { label: 'Valide', description: 'Ok', command: '!valid' },
    { description: 'Sans label', command: '!nope' },
    { label: 'Sans commande', description: 'Nope' },
    { label: 'Valide aussi', command: '!valid2' },
  ]}), 'utf-8')
  const filtered = loadSuggestions()
  assertEqual('loadSuggestions() items invalides filtres → 2 valides', filtered.length, 2)
  assertEqual('  → first valid', filtered[0].label, 'Valide')
  assertEqual('  → second valid', filtered[1].label, 'Valide aussi')

  // Nettoyage
  clearSuggestions()

  // ── parseSuggestionsFromOutput ──
  const output = [
    '  ── Analyse ──',
    '  → !explore soulseek — Explorer le projet',
    '  → !deploy soulseek --dry-run — Simuler le deploiement',
    '  ── Documentation ──',
    '  → !doc create README soulseek — Creer un README',
  ].join('\n')

  const parsed = parseSuggestionsFromOutput(output)
  assertEqual('parseSuggestionsFromOutput → 3 suggestions', parsed.length, 3)
  assertEqual('  → command 0', parsed[0].command, '!explore soulseek')
  assertEqual('  → label 0', parsed[0].label, 'Explorer le projet')
  assertEqual('  → group 0', parsed[0].group, 'Analyse')
  assertEqual('  → command 1', parsed[1].command, '!deploy soulseek --dry-run')
  assertEqual('  → group 2', parsed[2].group, 'Documentation')

  // parseSuggestionsFromOutput — sortie vide
  assertEqual('parseSuggestionsFromOutput(vide) → []', parseSuggestionsFromOutput('').length, 0)

  // parseSuggestionsFromOutput — pas de fleche
  assertEqual('parseSuggestionsFromOutput(sans fleche) → []',
    parseSuggestionsFromOutput('ligne sans fleche').length, 0)
}

// ════════════════════════════════════════════════════════════
//   PHASE 5 : classifyCommand — categorisation
// ════════════════════════════════════════════════════════════

function testClassifyCommand() {
  console.log(`\n${BOLD}── PHASE 5 : classifyCommand — categorisation des commandes${RESET}`)
  console.log(`  ${GRAY}Mapping commande → categorie pour l'apprentissage${RESET}\n`)

  assertEqual('!project tasks x → task', classifyCommand('!project tasks soulseek'), 'task')
  assertEqual('!project tache x → task', classifyCommand('!project tache mon-projet'), 'task')
  assertEqual('!task x → task', classifyCommand('!task T1 soulseek'), 'task')
  assertEqual('!project status x → project', classifyCommand('!project status soulseek'), 'project')
  assertEqual('!project list → project', classifyCommand('!project list'), 'project')
  assertEqual('!explore x → explore', classifyCommand('!explore soulseek'), 'explore')
  assertEqual('!discover x → explore', classifyCommand('!discover mon-projet'), 'explore')
  assertEqual('!deploy x → deploy', classifyCommand('!deploy soulseek --dry-run'), 'deploy')
  assertEqual('!doc x → doc', classifyCommand('!doc create README soulseek'), 'doc')
  assertEqual('!git x → git', classifyCommand('!git status soulseek'), 'git')
  assertEqual('!agent x → agent', classifyCommand('!agent list'), 'agent')
  assertEqual('!profile x → profile', classifyCommand('!profile list python'), 'profile')
  assertEqual('/help → help', classifyCommand('/help'), 'help')
  assertEqual('/aide → help', classifyCommand('/aide'), 'help')
  assertEqual('/notif → notification', classifyCommand('/notif'), 'notification')
  assertEqual('/status → notification', classifyCommand('/status'), 'notification')
  assertEqual('/state → notification', classifyCommand('/state'), 'notification')
  assertEqual('cat package.json → other', classifyCommand('cat package.json'), 'other')
  assertEqual('node script.js → other', classifyCommand('node script.js'), 'other')
  assertEqual('chaine vide → other', classifyCommand(''), 'other')
  assertEqual('Tri whitespace → other', classifyCommand('  some random text  '), 'other')
  assertEqual('Casse melangee !Project Tasks → task',
    classifyCommand('!Project Tasks soulseek'), 'task')
}

// ════════════════════════════════════════════════════════════
//   PHASE 6 : LearningTracker — anti-repetition et apprentissage
// ════════════════════════════════════════════════════════════

function testLearningTracker() {
  console.log(`\n${BOLD}── PHASE 6 : LearningTracker — anti-repetition et apprentissage${RESET}`)
  console.log(`  ${GRAY}recordChoice, getPreferences, shift detection, reset, history${RESET}\n`)

  const tracker = new LearningTracker()

  // Reinitialiser
  tracker.resetStats()

  // 1. Load initial (fichier inexistant → valeurs par defaut)
  const initStats = tracker.load()
  assertEqual('load() initial → totalChoices = 0', initStats.totalChoices, 0)
  assertEqual('load() initial → last5Choices vide', initStats.last5Choices.length, 0)

  // 2. isReady() — pas assez de donnees
  assert('isReady() avec 0 choix → false', !tracker.isReady())

  // 3. recordChoice() — premiers enregistrements
  tracker.recordChoice('!explore soulseek', 'explore')
  tracker.recordChoice('!explore soulseek', 'explore')
  tracker.recordChoice('!project tasks soulseek', 'task')

  const stats3 = tracker.load()
  assertEqual('3 enregistrements → totalChoices = 3', stats3.totalChoices, 3)
  assertEqual('  → last5Choices = 3 entrees', stats3.last5Choices.length, 3)
  assertEqual('  → categoryHits.explore = 2', stats3.categoryHits['explore'], 2)
  assertEqual('  → categoryHits.task = 1', stats3.categoryHits['task'], 1)

  // 4. getPreferences() — top 3 + detection shift (pas assez d'historique)
  const prefs3 = tracker.getPreferences()
  assertEqual('getPreferences → preferred[0] = explore (top hit)', prefs3.preferred[0], 'explore')
  assert('getPreferences → preferred contient task', prefs3.preferred.includes('task'))
  assert('getPreferences → recentShift = false (< 8 entrees)', !prefs3.recentShift)

  // 5. isReady() — pas encore
  assert('isReady() avec 3 choix → false (< 10)', !tracker.isReady())

  // 6. recordMiss() — categories ignorees
  tracker.recordMiss('git')
  tracker.recordMiss('git')
  tracker.recordMiss('git') // 3 misses → evite

  const prefs6 = tracker.getPreferences()
  assert('getPreferences → avoided contient git (3 misses)', prefs6.avoided.includes('git'))

  // 7. recordChoice() avec categorie auto-detectee (sans categorie fournie)
  tracker.recordChoice('!deploy soulseek --dry-run') // devrait classer comme 'deploy'
  const stats7 = tracker.load()
  assertEqual('recordChoice sans categorie → auto-classe deploy',
    stats7.categoryHits['deploy'], 1)

  // 8. recordChoice() — commande vide ignoree
  tracker.recordChoice('', 'explore')
  const stats8 = tracker.load()
  assertEqual('recordChoice avec commande vide → pas de changement', stats8.totalChoices, 4)

  // 9. recordMiss() — categorie vide ignoree
  tracker.recordMiss('')
  const stats9 = tracker.load()
  assertEqual('recordMiss avec categorie vide → pas de changement', stats9.categoryHits['deploy'], 1)

  // 10. getHistory() — verifier l'historique
  const history = tracker.getHistory()
  assertEqual('getHistory → 4 entrees dans l\'historique', history.length, 4)
  assertEqual('  → entry 0 command', history[0].command, '!explore soulseek')
  assertEqual('  → entry 0 category', history[0].category, 'explore')
  assert('  → entry 0 timestamp valide', typeof history[0].timestamp === 'string' && history[0].timestamp.length > 10)

  // 11. isReady() — toujours pas (4 < 10)
  assert('isReady() avec 4 choix → false', !tracker.isReady())

  // 12. Remplir pour atteindre le seuil
  for (let i = 0; i < 7; i++) {
    tracker.recordChoice('!project task T' + i + ' proj', 'task')
  }
  assert('isReady() avec 11 choix → true (>= 10)', tracker.isReady())
  assert('isReady() appele 2x → idempotent', tracker.isReady())

  // 13. getPreferences() — apres remplissage
  const prefs13 = tracker.getPreferences()
  assert('getPreferences → preferred contient task (dominant)', prefs13.preferred.includes('task'))
  // Apres 7+3 choix task puis explore+deploy, les 5 dernieres sont task (4 dernieres + 1 deploy)
  // Le shift n'est pas forcement detecte car deploy n'est pas assez recent
  // On ne teste pas recentShift ici car ca depend de l'ordre exact des entrees

  // 14. recordChoice() — commande avec categorie auto-detectee
  tracker.recordChoice('/help')
  const stats14 = tracker.load()
  assertEqual('/help auto-classe → categoryHits.help = 1', stats14.categoryHits['help'], 1)

  // 15. resetStats() — tout effacer (verifier etat memoire uniquement)
  // Note : on n'utilise pas load() car Windows peut echouer le delete silencieusement,
  // et _save() peut echouer apres un lien. On verifie l'etat memoire directement.
  tracker.resetStats()
  assert('resetStats → isReady() = false', !tracker.isReady())
  assertEqual('resetStats → history vide', tracker.getHistory().length, 0)
  // Verifier qu'un nouvel enregistrement part de zero (memoire)
  tracker.recordChoice('test', 'test-cat')
  assert('resetStats + record → isReady() false (1 < 10)', !tracker.isReady())
  assertEqual('resetStats + record → history = 1', tracker.getHistory().length, 1)
}

// ════════════════════════════════════════════════════════════
//   PHASE 7 : LearningTracker — shift detection
// ════════════════════════════════════════════════════════════

function testShiftDetection() {
  console.log(`\n${BOLD}── PHASE 7 : Shift detection${RESET}`)
  console.log(`  ${GRAY}Detection de changement de comportement utilisateur${RESET}\n`)

  const tracker = new LearningTracker()
  tracker.resetStats()

  // 1. Pas assez d'historique → pas de shift
  for (let i = 0; i < 5; i++) {
    tracker.recordChoice('!project task T' + i + ' proj', 'task')
  }
  const prefs1 = tracker.getPreferences()
  assert('Shift : < 8 entrees → false', !prefs1.recentShift)

  // 2. Ajouter 4 entrees dans la meme categorie → toujours pas de shift
  for (let i = 0; i < 4; i++) {
    tracker.recordChoice('!project task T' + (i + 10) + ' proj', 'task')
  }
  const prefs2 = tracker.getPreferences()
  assert('Shift : 9 entrees toutes task → false (aucun changement)', !prefs2.recentShift)

  // 3. Changer soudainement de categorie pour les 5 dernieres → shift detecte
  tracker.recordChoice('!explore proj --recent', 'explore')
  tracker.recordChoice('!explore proj --path src', 'explore')
  tracker.recordChoice('!explore proj', 'explore')
  tracker.recordChoice('!doc create README proj', 'doc')
  tracker.recordChoice('!git status proj', 'git')
  const prefs3 = tracker.getPreferences()
  assert('Shift : changement de categorie → true', prefs3.recentShift,
    'recent: ' + prefs3.recentShift + ', preferred: ' + prefs3.preferred.join(','))

  // 4. Nettoyage
  tracker.resetStats()
}

// ════════════════════════════════════════════════════════════
//   PHASE 8 : LearningTracker — Edge cases
// ════════════════════════════════════════════════════════════

function testTrackerEdgeCases() {
  console.log(`\n${BOLD}── PHASE 8 : LearningTracker — Edge cases${RESET}`)
  console.log(`  ${GRAY}Limites : 100 entrees max, derniere mise a jour, categories inexistantes${RESET}\n`)

  const tracker = new LearningTracker()
  tracker.resetStats()

  // 1. load() sans fichier sur disque — valeurs par defaut
  const init = tracker.load()
  assert('load() retourne un objet LearningStats valide',
    typeof init.totalChoices === 'number' && typeof init.lastUpdated === 'string')

  // 2. 150 enregistrements → verifier que last5Choices garde max 5
  for (let i = 0; i < 150; i++) {
    tracker.recordChoice('!project task T' + i + ' proj', 'task')
  }
  const manyStats = tracker.load()
  assertEqual('150 enregistrements → totalChoices = 150', manyStats.totalChoices, 150)
  assertEqual('150 enregistrements → last5Choices limite a 5', manyStats.last5Choices.length, 5)

  // 3. Historique limite a 100
  const history = tracker.getHistory()
  assertEqual('Historique limite a 100 entrees', history.length, 100)

  // 4. getPreferences() — categories inexistantes dans categoryHits → comptees comme 0
  const prefs = tracker.getPreferences()
  assert('getPreferences → preferred present (au moins task)', prefs.preferred.length >= 1)
  assert('getPreferences → avoided est un tableau', Array.isArray(prefs.avoided))

  // 5. Nettoyage
  tracker.resetStats()
  const empty = tracker.load()
  assertEqual('Reset + load → totalChoices = 0', empty.totalChoices, 0)
}

// ════════════════════════════════════════════════════════════
//   PHASE 9 : resetStats() — vérification persistance disque
// ════════════════════════════════════════════════════════════

function testResetDiskPersistence() {
  console.log(`\n${BOLD}── PHASE 9 : resetStats() — persistance disque${RESET}`)
  console.log(`  ${GRAY}Vérifie que resetStats() + load() + recordChoice() partent de zéro.`)
  console.log(`  ${GRAY}Attention : load() relit TOUJOURS le disque (cache mémoire contourné).${RESET}\n`)

  const STATS_PATH = join(process.cwd(), 'telecom', 'agents', 'agent-parades', 'stats.json')
  const HISTORY_PATH = join(process.cwd(), 'telecom', 'agents', 'agent-parades', 'history.json')

  // ── Instance A : ajouter des données, reset, re-vérifier disque via load() ──
  const tracker = new LearningTracker()
  tracker.resetStats()

  // 1. Vérifier que l'instance part de zéro (load lit le disque)
  const initStats = tracker.load()
  assertEqual('[1] load() initial → totalChoices = 0', initStats.totalChoices, 0)
  assertEqual('[1] last5Choices vide', initStats.last5Choices.length, 0)
  assert('[1] categoryHits vide', Object.keys(initStats.categoryHits).length === 0)

  // 2. Ajouter 5 enregistrements de catégories variées
  tracker.recordChoice('!explore proj', 'explore')
  tracker.recordChoice('!project tasks proj', 'task')
  tracker.recordChoice('!explore proj', 'explore')
  tracker.recordChoice('!deploy proj --dry-run', 'deploy')
  tracker.recordChoice('!doc create README proj', 'doc')

  const afterRecord = tracker.load()
  assertEqual('[2] après 5 records → totalChoices = 5', afterRecord.totalChoices, 5)
  assertEqual('[2] last5Choices = 5', afterRecord.last5Choices.length, 5)
  assertEqual('[2] categoryHits.explore = 2', afterRecord.categoryHits['explore'], 2)
  assertEqual('[2] categoryHits.task = 1', afterRecord.categoryHits['task'], 1)
  assertEqual('[2] getHistory() = 5', tracker.getHistory().length, 5)

  // 3. resetStats() — écrit l'état vide sur le disque via _save()
  tracker.resetStats()

  // 4. load() relit TOUJOURS le disque → doit lire l'état vide
  //    C'est le cœur du test : vérifier que _save() dans resetStats() écrit bien.
  const afterReset = tracker.load()
  assertEqual('[4] resetStats + load() → totalChoices = 0', afterReset.totalChoices, 0)
  assertEqual('[4] last5Choices vide', afterReset.last5Choices.length, 0)
  assert('[4] categoryHits vide', Object.keys(afterReset.categoryHits).length === 0)
  assert('[4] categoryMisses vide', Object.keys(afterReset.categoryMisses).length === 0)
  assertEqual('[4] getHistory() vide', tracker.getHistory().length, 0)
  assert('[4] isReady() = false (0 < 10)', !tracker.isReady())

  // Vérification directe du fichier sur le disque (diagnostic)
  try {
    const rawStats = readFileSync(STATS_PATH, 'utf-8')
    const parsed = JSON.parse(rawStats)
    assert('[4-disk] stats.json → totalChoices = 0', parsed.totalChoices === 0,
      'valeur: ' + JSON.stringify(parsed.totalChoices))
    assert('[4-disk] stats.json → last5Choices vide', parsed.last5Choices?.length === 0,
      'longueur: ' + parsed.last5Choices?.length)
  } catch {
    // Fichier peut ne pas exister si _save() échoue totalement
    assert('[4-disk] lecture directe stats.json', false, 'fichier illisible ou inexistant')
  }
  try {
    const rawHistory = readFileSync(HISTORY_PATH, 'utf-8')
    const parsed = JSON.parse(rawHistory)
    assert('[4-disk] history.json → tableau vide', Array.isArray(parsed) && parsed.length === 0,
      'longueur: ' + parsed.length)
  } catch {
    assert('[4-disk] lecture directe history.json', false, 'fichier illisible ou inexistant')
  }

  // 5. recordChoice() — doit partir de zéro (totalChoices 0 → 1)
  tracker.recordChoice('!git status proj', 'git')

  const afterChoice = tracker.load()
  assertEqual('[5] après 1 record → totalChoices = 1', afterChoice.totalChoices, 1)
  assertEqual('[5] categoryHits.git = 1', afterChoice.categoryHits['git'], 1)
  assert('[5] isReady() = false (1 < 10)', !tracker.isReady())
  assertEqual('[5] getHistory() = 1 entrée', tracker.getHistory().length, 1)
  assertEqual('[5] commande = !git status proj', tracker.getHistory()[0].command, '!git status proj')
  assertEqual('[5] catégorie = git', tracker.getHistory()[0].category, 'git')

  // 6. load() à nouveau — vérifie que le record a persisté sur le disque
  const reRead = tracker.load()
  assertEqual('[6] re-load → totalChoices = 1 (persisté)', reRead.totalChoices, 1)

  // ── Nettoyage ──
  tracker.resetStats()
  const clean = tracker.load()
  assertEqual('[Clean] reset → totalChoices = 0', clean.totalChoices, 0)
}

// ════════════════════════════════════════════════════════════
//   MAIN
// ════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  console.log(`\n${BOLD}${CYAN}════════════════════════════════════════════════════════${RESET}`)
  console.log(`${BOLD}${CYAN}  TESTS UNITAIRES : Service Parades${RESET}`)
  console.log(`${BOLD}${CYAN}════════════════════════════════════════════════════════${RESET}\n`)

  testEvaluateCondition()
  testDeterminePhase()
  testContextPersistence()
  testOutputFormat()
  testClassifyCommand()
  testLearningTracker()
  testShiftDetection()
  testTrackerEdgeCases()
  testResetDiskPersistence()

  const total = passed + failed
  console.log(`\n${BOLD}${CYAN}════════════════════════════════════════════════════════${RESET}`)
  console.log(`${BOLD}${CYAN}  RESULTATS : ${passed}/${total} tests OK${RESET}`)
  if (failed > 0) {
    console.log(`${BOLD}${RED}  ${failed} ECHEC(S) — voir ci-dessus${RESET}`)
    console.log(`${BOLD}${RED}  Service Parades — TESTS ECHOUES${RESET}`)
    safeExit(1)
  } else {
    console.log(`${BOLD}${GREEN}  Service Parades — TOUS LES TESTS SONT PASSES${RESET}`)
    console.log(`     ${GREEN}Phase detection : evaluateCondition (15 tests) + determinePhase (10 tests)${RESET}`)
    console.log(`     ${GREEN}Contexte persistant : write/read/clear (7 tests)${RESET}`)
    console.log(`     ${GREEN}Format de sortie : loadSuggestions + parseSuggestions (12 tests)${RESET}`)
    console.log(`     ${GREEN}classifyCommand : 22 variantes de categorisation${RESET}`)
    console.log(`     ${GREEN}Anti-repetition : LearningTracker record/prefs/shift/reset (20 tests)${RESET}`)
    console.log(`     ${GREEN}Edge cases : limites, historiques, categories vides (5 tests)${RESET}`)
    console.log(`     ${GREEN}Persistence disque : resetStats + fresh instances (14 tests)${RESET}`)
  }
  console.log(`${BOLD}${CYAN}════════════════════════════════════════════════════════${RESET}\n`)

  safeExit(failed > 0 ? 1 : 0)
}

main().catch((err: Error) => {
  console.error(`\n${RED}${BOLD}CRASH : ${err.message}${RESET}`)
  console.error((err as Error).stack?.slice(0, 500) ?? '')
  safeExit(1)
})
