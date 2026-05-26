/**
 * Tests du kit kit-tests.
 *
 * Exécution : npx tsx kits/kit-tests/test.ts
 *
 * Note : ce fichier s'auto-protège en utilisant runTests() + stopTestOnError().
 * Si un test échoue, tout s'arrête immédiatement.
 *
 * Les tests qui vérifient le comportement "process.exit(1)" ne peuvent pas
 * être exécutés in-process (car ils tueraient le processus). Ils sont remplacés
 * par des tests sur formatError() qui vérifient le formatage sans tuer le process.
 */

// @kit tests
import { stopTestOnError, stopTestOnErrorAsync, TestError, runTests, formatError } from './index.js'

// ── Mini framework de test (sans dépendance externe) ─────

const RESET = '\x1b[0m'
const RED = '\x1b[31m'
const GREEN = '\x1b[32m'
const CYAN = '\x1b[36m'
const BOLD = '\x1b[1m'

let passed = 0
let failed = 0

function assert(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed++
    console.log(`  ${GREEN}✓${RESET} ${label}`)
  } else {
    failed++
    console.log(`  ${RED}✗${RESET} ${label} ${detail ? `— ${RED}${detail}${RESET}` : ''}`)
    throw new TestError(`Assertion échouée : ${label}`, detail)
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  const ok = actual === expected
  assert(label, ok, `attendu: ${JSON.stringify(expected)}, reçu: ${JSON.stringify(actual)}`)
}

function assertIncludes(text: string, substring: string, label: string): void {
  const ok = text.includes(substring)
  assert(label, ok, `"${substring}" introuvable dans le texte`)
}

// ── Tests ────────────────────────────────────────────────

function main(): void {
  console.log(`\n${BOLD}${CYAN}═══════════════════════════════════════════${RESET}`)
  console.log(`${BOLD}${CYAN}  TESTS — kit-tests (fail-fast)${RESET}`)
  console.log(`${BOLD}${CYAN}═══════════════════════════════════════════${RESET}\n`)

  // ── TestError ──────────────────────────────────────────

  console.log(`${BOLD}── TestError${RESET}`)

  stopTestOnError(() => {
    const err = new TestError('quelque chose a échoué')
    assertEqual(err.name, 'TestError', 'name = TestError')
    assert('message conservé', err.message === 'quelque chose a échoué')
    assert('timestamp présent', err.timestamp.length > 0)
    assert('timestamp ISO', err.timestamp.includes('T'))
    assert('context undefined par défaut', err.context === undefined)
  })

  stopTestOnError(() => {
    const err = new TestError('erreur', 'module: validation')
    assertEqual(err.context, 'module: validation', 'context conservé')
  })

  stopTestOnError(() => {
    const err = new TestError('test', 'ctx')
    const report = err.format()
    assertIncludes(report, 'TestError', 'format() contient TestError')
    assertIncludes(report, 'test', 'format() contient le message')
    assertIncludes(report, 'T', 'format() contient le timestamp')
    assertIncludes(report, 'ctx', 'format() contient le contexte')
    assertIncludes(report, 'Stack:', 'format() contient Stack:')
  })

  // ── formatError — formatage sans kill ──────────────────

  console.log(`\n${BOLD}── formatError() — formatage sans process.exit${RESET}`)

  stopTestOnError(() => {
    const msg = formatError(new TestError('erreur test', 'ctx-test'))
    assertIncludes(msg, 'TestError', 'formatError(TestError) contient TestError')
    assertIncludes(msg, 'erreur test', 'formatError(TestError) contient le message')
    assertIncludes(msg, 'ctx-test', 'formatError(TestError) contient le contexte')
  })

  stopTestOnError(() => {
    const msg = formatError(new Error('boum'))
    assertIncludes(msg, 'boum', 'formatError(Error) contient le message')
  })

  stopTestOnError(() => {
    const msg = formatError('simple string')
    assertIncludes(msg, 'simple string', 'formatError(string) contient la valeur')
  })

  stopTestOnError(() => {
    const msg = formatError(42)
    assertIncludes(msg, '42', 'formatError(number) contient le nombre')
  })

  stopTestOnError(() => {
    const err = new Error('')
    const msg = formatError(err)
    assert('formatError(Error vide) ne crash pas', msg.length > 0)
  })

  // ── stopTestOnError — succès ───────────────────────────

  console.log(`\n${BOLD}── stopTestOnError — succès${RESET}`)

  stopTestOnError(() => {
    const result = stopTestOnError(() => 42)
    assertEqual(result, 42, 'retourne la valeur numérique')
  })

  stopTestOnError(() => {
    const result = stopTestOnError(() => 'hello')
    assertEqual(result, 'hello', 'retourne une string')
  })

  stopTestOnError(() => {
    const obj = { a: 1, b: 'test' }
    const result = stopTestOnError(() => obj)
    assert('retourne le même objet référentiellement', result === obj)
  })

  stopTestOnError(() => {
    let sideEffect = 0
    stopTestOnError(() => { sideEffect = 1 })
    assertEqual(sideEffect, 1, 'exécute les effets de bord')
  })

  stopTestOnError(() => {
    const result = stopTestOnError(() => null)
    assertEqual(result, null, 'retourne null')
  })

  stopTestOnError(() => {
    const result = stopTestOnError(() => undefined)
    assertEqual(result, undefined, 'retourne undefined')
  })

  // ── stopTestOnError — fonction vide ────────────────────

  console.log(`\n${BOLD}── stopTestOnError — cas limites${RESET}`)

  stopTestOnError(() => {
    const result = stopTestOnError(() => { /* fonction vide sans return */ })
    assertEqual(result, undefined, 'fonction sans return → undefined')
  })

  // ── stopTestOnErrorAsync — succès ──────────────────────

  console.log(`\n${BOLD}── stopTestOnErrorAsync — succès${RESET}`)

  stopTestOnError(async () => {
    const result = await stopTestOnErrorAsync(async () => 99)
    assertEqual(result, 99, 'async retourne la valeur numérique')
  })

  stopTestOnError(async () => {
    const result = await stopTestOnErrorAsync(async () => 'async result')
    assertEqual(result, 'async result', 'async retourne une string')
  })

  stopTestOnError(async () => {
    let sideEffect = ''
    await stopTestOnErrorAsync(async () => { sideEffect = 'fait' })
    assertEqual(sideEffect, 'fait', 'async exécute les effets de bord')
  })

  // ── runTests — succès ──────────────────────────────────

  console.log(`\n${BOLD}── runTests — succès${RESET}`)

  stopTestOnError(() => {
    let executed = false
    runTests(() => {
      executed = true
    })
    assert('runTests exécute la fonction fournie', executed)
  })

  stopTestOnError(() => {
    const results: number[] = []
    runTests(() => {
      results.push(1)
      results.push(2)
      results.push(3)
    })
    assertEqual(results.length, 3, 'runTests exécute toutes les instructions')
    assertEqual(results[0], 1, 'ordre des instructions conservé')
    assertEqual(results[2], 3, 'dernière instruction exécutée')
  })

  // ── runTests avec nested stopTestOnError ────────────────

  console.log(`\n${BOLD}── runTests + stopTestOnError imbriqués${RESET}`)

  stopTestOnError(() => {
    const values: number[] = []
    runTests(() => {
      stopTestOnError(() => { values.push('a') })
      stopTestOnError(() => { values.push('b') })
      stopTestOnError(() => { values.push('c') })
    })
    assertEqual(values.length, 3, 'stopTestOnError imbriqués dans runTests')
    assertEqual(values.join(''), 'abc', 'exécutés dans le bon ordre')
  })

  // ── stopTestOnError — valeurs retournées complexes ─────

  console.log(`\n${BOLD}── stopTestOnError — valeurs complexes${RESET}`)

  stopTestOnError(() => {
    const arr = stopTestOnError(() => [1, 2, 3])
    assertEqual(arr.length, 3, 'retourne un tableau')
    assertEqual(arr[0], 1, 'valeurs du tableau correctes')
  })

  stopTestOnError(() => {
    const fn = stopTestOnError(() => (x: number) => x * 2)
    assertEqual(fn(5), 10, 'retourne une fonction qui fonctionne')
  })

  // ── Résumé ─────────────────────────────────────────────

  const total = passed + failed
  console.log(`\n${BOLD}${CYAN}═══════════════════════════════════════════${RESET}`)
  console.log(`${BOLD}${CYAN}  RÉSULTATS : ${passed}/${total} tests OK${RESET}`)
  if (failed > 0) {
    console.log(`${BOLD}${RED}  ${failed} ÉCHEC(S) — arrêt immédiat (fail-fast)${RESET}`)
  } else {
    console.log(`${BOLD}${GREEN}  TOUS LES TESTS SONT PASSÉS${RESET}`)
  }
  console.log(`${BOLD}${CYAN}═══════════════════════════════════════════${RESET}\n`)
}

// Auto-application du kit : toute la suite est protégée par runTests
runTests(() => main())
