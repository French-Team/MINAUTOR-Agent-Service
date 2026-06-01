/**
 * Tests unitaires pour les règles ESLint personnalisées
 *
 * Utilise RuleTester d'ESLint pour valider le comportement des règles
 * no-shallow-object-spread et no-useless-catch.
 *
 * Exécution : npx tsx src/test/test-eslint-rules.ts
 *
 * Note : Les tests utilisent le parser JavaScript standard (Espree).
 * Les cas spécifiques TypeScript (as const, satisfies) sont couverts
 * indirectement par le lint global du projet (`npm run lint`).
 */

/** @ts-expect-error — fichier .mjs, résolu par tsx */
import noShallowObjectSpread from '../../eslint-rules/no-shallow-object-spread.mjs'
/** @ts-expect-error — fichier .mjs, résolu par tsx */
import noUselessCatch from '../../eslint-rules/no-useless-catch.mjs'
/** @ts-expect-error — fichier .mjs, résolu par tsx */
import noUnusedExpressions from '../../eslint-rules/no-unused-expressions.mjs'

import { RuleTester } from 'eslint'

// ── ANSI ─────────────────────────────────────────────

const RESET = '\x1b[0m'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const CYAN = '\x1b[36m'
const BOLD = '\x1b[1m'
const PASS = `${GREEN}✓${RESET}`
const FAIL = `${RED}✗${RESET}`

let passed = 0
let failed = 0

function assert(label: string, ok: boolean, detail?: string) {
  if (ok) { passed++; process.stdout.write(`  ${PASS} ${label}\n`) }
  else { failed++; process.stdout.write(`  ${FAIL} ${label}${detail ? ` — ${RED}${detail}${RESET}` : ''}\n`) }
}

// ── LangOptions commune (parser JS standard) ─────────────────

const langOptions = {
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
}

function makeTester() {
  return new RuleTester(langOptions)
}

// ── Tests : no-shallow-object-spread ─────────────────

function testNoShallowObjectSpread() {
  console.log(`\n${BOLD}── no-shallow-object-spread${RESET}`)

  /**
   * Valides — ne doivent PAS être flagués
   *   ✅ Primitives only → safe
   *   ✅ Variable dynamique (paramètre) → non résolvable statiquement
   *   ✅ Pas d'objets/tableaux imbriqués
   *   ✅ Littéral non-objet (nombre, string)
   *   ✅ Spread de résultat d'appel de fonction
   */
  const valid = [
    { name: 'primitives only — safe', code: `const C = { color: 'red', size: 10 }; const x = { ...C }` },
    { name: 'dynamic variable — skip', code: `function f(obj) { return { ...obj } }` },
    { name: 'no nested — safe', code: `const C = { name: 'test', count: 0 }; const x = { ...C }` },
    { name: 'number literal — safe', code: `const C = 42; const x = { ...C }` },
    { name: 'string literal — skip', code: `const C = 'foo'; const x = { ...C }` },
    { name: 'function call — skip', code: `const x = { ...getDefaults() }` },
  ]

  /**
   * Invalides — DOIVENT être flagués
   *   ❌ Objet imbriqué (counts: {})
   *   ❌ Tableau imbriqué (items: [])
   *   ❌ Objet profond ({ a: { b: 'c' } })
   *   ❌ Tableau comme valeur racine avec éléments objets
   *   ❌ Objet avec tableau imbriqué plus complexe
   */
  const invalid = [
    { name: 'nested object {}', code: `const D = { counts: {} }; const x = { ...D }`, errors: [{ messageId: 'shallowSpread' }] },
    { name: 'nested array []', code: `const L = { items: [] }; const x = { ...L }`, errors: [{ messageId: 'shallowSpread' }] },
    { name: 'deeply nested', code: `const D = { a: { b: 'c' } }; const x = { ...D }`, errors: [{ messageId: 'shallowSpread' }] },
    { name: 'array root with objects', code: `const A = [{ a: 1 }]; const x = [...A]`, errors: [{ messageId: 'shallowSpread' }] },
    { name: 'nested in array', code: `const A = { items: [{ id: 1 }] }; const x = { ...A }`, errors: [{ messageId: 'shallowSpread' }] },
  ]

  try {
    makeTester().run('no-shallow-object-spread', noShallowObjectSpread, { valid, invalid })
    assert('no-shallow-object-spread — tous les tests passent', true)
  } catch (e) {
    const msg = (e as Error).message
    assert('no-shallow-object-spread — tous les tests passent', false, msg.split('\n').slice(0, 5).join('\n  '))
  }
}

// ── Tests : no-useless-catch ─────────────────────────

function testNoUselessCatch() {
  console.log(`\n${BOLD}── no-useless-catch${RESET}`)

  /**
   * Valides — ne doivent PAS être flagués
   *   ✅ Side-effect (cleanup) avant rethrow
   *   ✅ Transformation de l'erreur (throw new Error)
   *   ✅ Catch sans paramètre
   *   ✅ Log puis rethrow (2 statements)
   *   ✅ Catch vide
   *   ✅ Déstructuration du paramètre
   */
  const valid = [
    { name: 'side-effect before rethrow', code: `try { foo() } catch (e) { cleanup(); throw e }` },
    { name: 'error transformation', code: `try { foo() } catch (e) { throw new Error(e.message) }` },
    { name: 'no param', code: `try { foo() } catch { throw new Error('oops') }` },
    { name: 'log and rethrow', code: `try { foo() } catch (e) { log(e); throw e }` },
    { name: 'empty catch', code: `try { foo() } catch (e) {}` },
    { name: 'destructured param', code: `try { foo() } catch ({ message }) { throw message }` },
  ]

  /**
   * Invalides — DOIVENT être flagués
   *   ❌ Direct rethrow (e)
   *   ❌ Direct rethrow (err) — autre nom
   *   ❌ Direct rethrow (_e) — même avec préfixe underscore
   */
  const invalid = [
    { name: 'rethrow e', code: `try { foo() } catch (e) { throw e }`, errors: [{ messageId: 'uselessCatch' }] },
    { name: 'rethrow err', code: `try { foo() } catch (err) { throw err }`, errors: [{ messageId: 'uselessCatch' }] },
    { name: 'rethrow _e', code: `try { foo() } catch (_e) { throw _e }`, errors: [{ messageId: 'uselessCatch' }] },
  ]

  try {
    makeTester().run('no-useless-catch', noUselessCatch, { valid, invalid })
    assert('no-useless-catch — tous les tests passent', true)
  } catch (e) {
    const msg = (e as Error).message
    assert('no-useless-catch — tous les tests passent', false, msg.split('\n').slice(0, 5).join('\n  '))
  }
}

// ── Tests : no-unused-expressions ────────────────────

function testNoUnusedExpressions() {
  console.log(`\n${BOLD}── no-unused-expressions${RESET}`)

  /**
   * Valides — expressions avec side-effect → ne PAS flaguer
   *   ✅ Appel de fonction
   *   ✅ Optional call
   *   ✅ Constructeur
   *   ✅ Assignment
   *   ✅ Incrémentation
   *   ✅ Tagged template
   *   ✅ Await/Yield (dans async/gen)
   *   ✅ TS assertion (pas un expression statement)
   */
  const valid = [
    { name: 'function call', code: `foo()` },
    { name: 'optional call', code: `foo?.()` },
    { name: 'constructor', code: `new Foo()` },
    { name: 'assignment', code: `x = 1` },
    { name: 'increment', code: `++i` },
    { name: 'decrement', code: `i--` },
    { name: 'tagged template', code: `html\`<div>\`` },
    { name: 'assignment member', code: `obj.prop = val` },
    { name: 'compound assignment', code: `x += 1` },
  ]

  /**
   * Invalides — expressions pures → DOIVENT être flagués
   *   ❌ Littéral
   *   ❌ Identifiant
   *   ❌ Accès membre
   *   ❌ Opération binaire
   *   ❌ Opération unaire (sans effet)
   *   ❌ Expression ternaire
   *   ❌ Accès par index
   */
  const invalid = [
    { name: 'literal', code: `1 + 1`, errors: [{ messageId: 'unusedExpression' }] },
    { name: 'string literal', code: `'hello'`, errors: [{ messageId: 'unusedExpression' }] },
    { name: 'identifier', code: `someVar`, errors: [{ messageId: 'unusedExpression' }] },
    { name: 'member access', code: `obj.prop`, errors: [{ messageId: 'unusedExpression' }] },
    { name: 'ternary', code: `a ? b : c`, errors: [{ messageId: 'unusedExpression' }] },
    { name: 'bracket access', code: `arr[0]`, errors: [{ messageId: 'unusedExpression' }] },
    { name: 'unary typeof', code: `typeof x`, errors: [{ messageId: 'unusedExpression' }] },
  ]

  try {
    makeTester().run('no-unused-expressions', noUnusedExpressions, { valid, invalid })
    assert('no-unused-expressions — tous les tests passent', true)
  } catch (e) {
    const msg = (e as Error).message
    assert('no-unused-expressions — tous les tests passent', false, msg.split('\n').slice(0, 5).join('\n  '))
  }
}

// ── Main ─────────────────────────────────────────────

async function main() {
  console.log(`\n${BOLD}${CYAN}═══════════════════════════════════════════${RESET}`)
  console.log(`${BOLD}${CYAN}  TESTS : Règles ESLint personnalisées${RESET}`)
  console.log(`${BOLD}${CYAN}═══════════════════════════════════════════${RESET}\n`)

  testNoShallowObjectSpread()
  testNoUselessCatch()
  testNoUnusedExpressions()

  const total = passed + failed
  console.log(`\n${BOLD}${CYAN}═══════════════════════════════════════════${RESET}`)
  console.log(`${BOLD}${CYAN}  RÉSULTATS : ${passed}/${total} tests OK${RESET}`)
  if (failed > 0) console.log(`${BOLD}${RED}  ${failed} ÉCHEC(S) — voir ci-dessus${RESET}`)
  else console.log(`${BOLD}${GREEN}  TOUS LES TESTS SONT PASSÉS${RESET}`)
  console.log(`${BOLD}${CYAN}═══════════════════════════════════════════${RESET}\n`)

  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err: Error) => {
  console.error(`${RED}Test crash : ${err.message}${RESET}`)
  process.exit(1)
})
