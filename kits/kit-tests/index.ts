/**
 * kit-tests — Fail-fast pour les tests
 *
 * Arrête immédiatement les tests à la première erreur.
 * Empêche les tests de rester figés après un échec.
 *
 * ## Utilisation
 *
 * ```ts
 * // @kit tests
 * import { stopTestOnError } from '../../kits/kit-tests/index.js'
 *
 * describe('MonModule', () => {
 *   it('cas normal', stopTestOnError(() => {
 *     assert(true, 'passe')
 *   }))
 * })
 * ```
 *
 * ## Principe
 *
 * Chaque appel de test individuel est enveloppé dans stopTestOnError().
 * Si le test lance une erreur :
 *   1. L'erreur est loggée clairement (message, contexte, stack)
 *   2. Le processus est immédiatement arrêté (process.exit(1))
 *   3. L'agent qui a lancé les tests reçoit le signal d'erreur
 *
 * Résultat : plus de suite de tests qui continue en silence après un échec,
 * plus d'agent qui attend indéfiniment qu'un test figé se termine.
 */

// ── Aucune dépendance externe — seulement des modules natifs Node.js ──

// ── Constantes ANSI (locales, pas d'import depuis le projet) ──────────
const RED = '\x1b[31m'
const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'

/**
 * Erreur structurée pour les tests, avec timestamp et contexte.
 */
export class TestError extends Error {
  /** Timestamp ISO de la création de l'erreur */
  public readonly timestamp: string

  /**
   * @param message   Description de l'erreur
   * @param context   Contexte optionnel (nom du test, module, etc.)
   */
  constructor(
    message: string,
    public readonly context?: string,
  ) {
    super(message)
    this.name = 'TestError'
    this.timestamp = new Date().toISOString()

    // Assure la capture de la pile d'appels (V8 standard)
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor)
    }
  }

  /** Retourne un rapport formaté de l'erreur */
  format(): string {
    const lines: string[] = [
      `❌ TestError [${this.timestamp}]`,
      `   Message : ${this.message}`,
    ]
    if (this.context) lines.push(`   Contexte : ${this.context}`)
    if (this.stack) {
      const stackLines = this.stack.split('\n').slice(1, 4)
      lines.push(`   Stack: ${stackLines.join('\n           ')}`)
    }
    return lines.join('\n')
  }
}

// ── Helper interne : log d'erreur + arrêt immédiat ────────────────────

/**
 * Log une erreur de test formatée et stoppe le processus.
 * Point unique de sortie pour tous les wrappers du kit.
 */
function failAndExit(label: string, err: unknown, testName?: string): never {
  console.error(`\n${RED}${BOLD}❌ [kit-tests] ${label}${RESET}`)

  if (testName) {
    console.error(`${RED}   Test : ${testName}${RESET}`)
  }

  if (err instanceof TestError) {
    console.error(`${RED}   Raison : ${err.message}${RESET}`)
    if (err.context) console.error(`${RED}   Contexte : ${err.context}${RESET}`)
  } else if (err instanceof Error) {
    console.error(`${RED}   Erreur : ${err.message}${RESET}`)
    const stackLines = err.stack?.split('\n').slice(1, 4) ?? []
    for (const line of stackLines) {
      console.error(`${RED}   ${line.trim()}${RESET}`)
    }
  } else {
    console.error(`${RED}   Valeur : ${String(err)}${RESET}`)
  }

  console.error(`${RED}   Timestamp : ${new Date().toISOString()}${RESET}\n`)
  process.exit(1)
}

// ── API publique ──────────────────────────────────────────────────────

/**
 * Wrapper fail-fast pour un test synchrone.
 *
 * Capture toute erreur lancée par `fn`, affiche un diagnostic
 * clair, puis stoppe immédiatement le processus avec process.exit(1).
 *
 * @param fn   Fonction de test à exécuter
 * @returns    La valeur retournée par fn si elle réussit
 *
 * @example
 * ```ts
 * it('devrait fonctionner', stopTestOnError(() => {
 *   const result = maFonction()
 *   if (result !== 'attendu') throw new Error('échec')
 * }))
 * ```
 */
export function stopTestOnError<T>(fn: () => T): T {
  try {
    return fn()
  } catch (err: unknown) {
    const testName = extractTestName()
    failAndExit('Test échoué — arrêt immédiat', err, testName)
  }
}

/**
 * Version asynchrone de stopTestOnError.
 *
 * @param fn   Fonction de test asynchrone à exécuter
 * @returns    La valeur retournée par fn si elle réussit
 *
 * @example
 * ```ts
 * it('requête API', stopTestOnErrorAsync(async () => {
 *   const data = await fetch('/api/data')
 *   if (!data.ok) throw new Error('échec')
 * }))
 * ```
 */
export async function stopTestOnErrorAsync<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err: unknown) {
    const testName = extractTestName()
    failAndExit('Test async échoué — arrêt immédiat', err, testName)
  }
}

/**
 * Crée un runner de tests avec arrêt automatique à la première erreur.
 * Englobe toute une suite de tests dans un seul wrapper.
 *
 * @param suiteFn   Fonction contenant tous les tests à exécuter
 *
 * @example
 * ```ts
 * runTests(() => {
 *   describe('Module A', () => {
 *     it('test 1', () => { ... })
 *     it('test 2', () => { ... })
 *   })
 * })
 * ```
 */
export function runTests(suiteFn: () => void): void {
  try {
    suiteFn()
  } catch (err: unknown) {
    failAndExit('Suite de tests interrompue', err)
  }
}

/**
 * Construit un message d'erreur formaté sans arrêter le processus.
 * Utile pour les tests qui veulent vérifier le formatage des erreurs
 * sans déclencher le process.exit.
 *
 * @param err  L'erreur à formater
 * @returns    Le message formaté (sans ANSI codes)
 *
 * @example
 * ```ts
 * const msg = formatError(new TestError('boum'))
 * assert(msg.includes('boum'), 'message contient l\'erreur')
 * ```
 */
export function formatError(err: unknown): string {
  if (err instanceof TestError) {
    return err.format()
  }
  if (err instanceof Error) {
    return `Erreur : ${err.message}`
  }
  return `Valeur : ${String(err)}`
}

// ── Helpers internes ─────────────────────────────────────

/**
 * Extrait le nom du test depuis la pile d'appels.
 * Remonte pour trouver l'appelant du wrapper (la fonction de test).
 */
function extractTestName(): string {
  try {
    const stack = new Error().stack?.split('\n') ?? []
    // stack[0] = "Error"
    // stack[1] = extractTestName
    // stack[2] = stopTestOnError (ou failAndExit)
    // stack[3…] = appelant
    const callerLine = stack.find((line, i) => i >= 3 && line.includes('at '))
    if (!callerLine) return 'inconnu'

    const match = callerLine.trim().match(/at\s+(.+?)\s+\(/)
    return match?.[1] ?? callerLine.trim().split(' ').pop()?.replace(/.*\//, '') ?? 'inconnu'
  } catch {
    return 'inconnu'
  }
}
