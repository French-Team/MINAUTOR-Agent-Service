/**
 * lint-regex.ts — Vérifie que tous les regex literals du projet sont valides
 *
 * Utilise l'API TypeScript (ts.createSourceFile) pour parser le code source
 * et extraire précisément les RegularExpressionLiteral, puis les compile
 * avec new RegExp() pour détecter les erreurs de syntaxe.
 *
 * Problème détecté : les regex literals contenant `\!` sont invalides en
 * JavaScript moderne (SyntaxError: Invalid regular expression).
 *
 * Exécution : npx tsx src/lint-regex.ts
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import { fileURLToPath } from 'url'
import ts from 'typescript'

const __dirname = join(fileURLToPath(import.meta.url), '..')
const ROOT = join(__dirname, '..')
const SRC_DIR = join(ROOT, 'src')

const RESET = '\x1b[0m'
const RED = '\x1b[31m'
const GREEN = '\x1b[32m'

const CYAN = '\x1b[36m'
const BOLD = '\x1b[1m'


const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'logo', 'telecom',
  '__kits_scan_test__', '__kits_brace_test__', '__kits_find_test__', '__kits_debug__',
])

let totalErrors = 0
let totalFiles = 0
let totalRegexes = 0
let totalNewRegExp = 0       // Total new RegExp() calls
let newRegExpStatic = 0     // Calls with static string/template args
let newRegExpDynamic = 0    // Calls with dynamic/partial args

// ── Extraction via TypeScript AST ─────────────────────────────────────

interface FoundRegex {
  pattern: string
  flags: string
  line: number
  col: number
}

/**
 * Extrait tous les regex literals d'un fichier TypeScript en utilisant
 * l'AST du compilateur TypeScript.
 */
function extractRegexLiterals(source: string, sourcePath: string): FoundRegex[] {
  const results: FoundRegex[] = []

  const sourceFile = ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.Latest,
    true, // setParentNodes
    ts.ScriptKind.TS
  )

  function visit(node: ts.Node): void {
    if (ts.isRegularExpressionLiteral(node)) {
      // Récupérer le texte complet du regex literal : /pattern/flags
      const fullText = node.getText(sourceFile)

      // Extraire le pattern (entre les /) et les flags (après le dernier /)
      // Format : /pattern/gimsuy
      if (fullText.startsWith('/')) {
        // Trouver le dernier '/' non-échappé
        const lastSlash = fullText.lastIndexOf('/')
        if (lastSlash > 0) {
          const pattern = fullText.slice(1, lastSlash)
          const flags = fullText.slice(lastSlash + 1)

          const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
          results.push({
            pattern,
            flags,
            line: pos.line + 1,
            col: pos.character + 1,
          })
        }
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return results
}

/**
 * Extrait les appels new RegExp('pattern', 'flags') / RegExp('pattern', 'flags')
 * via l'AST TypeScript.
 *
 * Retourne les regex dont le pattern peut être déterminé statiquement
 * (string literal ou template literal sans substitution).
 */
function extractNewRegExpCalls(source: string, sourcePath: string): FoundRegex[] {
  const results: FoundRegex[] = []

  const sourceFile = ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  )

  /**
   * Tente d'extraire le contenu textuel d'un nœud AST :
   * - StringLiteral → son .text (ex: '\d+' → \d+)
   * - NoSubstitutionTemplateLiteral → son .text
   * - TemplateExpression (avec substitutions) → null (parts dynamiques)
   * - RegularExpressionLiteral → null (déjà vérifié par extractRegexLiterals)
   * - Autres → null (variable, appel foncton, etc.)
   */
  function extractStringFromNode(node: ts.Node): { text: string; isDynamic: boolean } | null {
    if (ts.isStringLiteral(node)) {
      return { text: node.text, isDynamic: false }
    }
    if (ts.isNoSubstitutionTemplateLiteral(node)) {
      return { text: node.text, isDynamic: false }
    }
    if (ts.isTemplateExpression(node)) {
      // Contient des parties dynamiques ${...} — impossible à vérifier statiquement
      return null
    }
    if (ts.isRegularExpressionLiteral(node)) {
      // Déjà vérifié par l'autre extracteur
      return null
    }
    return null // Autre expression (variable, appel, etc.)
  }

  function visit(node: ts.Node): void {
    // new RegExp(pattern, flags)
    if (ts.isNewExpression(node) || ts.isCallExpression(node)) {
      const expression = ts.isNewExpression(node) ? node.expression : node.expression

      // Vérifier que c'est bien un appel à RegExp (pas à RegExpPouet ou autre)
      if (ts.isIdentifier(expression) && expression.text === 'RegExp') {
        totalNewRegExp++

        if (node.arguments && node.arguments.length >= 1) {
          const patternNode = node.arguments[0]
          const flagsNode = node.arguments.length >= 2 ? node.arguments[1] : undefined

          const patternInfo = extractStringFromNode(patternNode)
          const flagsInfo = flagsNode ? extractStringFromNode(flagsNode) : null

          if (patternInfo && !patternInfo.isDynamic && flagsInfo && !flagsInfo.isDynamic) {
            // Pattern et flags statiques — validation complète
            newRegExpStatic++
            const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
            results.push({
              pattern: patternInfo.text,
              flags: flagsInfo.text,
              line: pos.line + 1,
              col: pos.character + 1,
            })
          } else if (patternInfo && !patternInfo.isDynamic && !flagsInfo) {
            // Pattern statique sans flags (ou flags dynamiques)
            newRegExpStatic++
            const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
            results.push({
              pattern: patternInfo.text,
              flags: '',
              line: pos.line + 1,
              col: pos.character + 1,
            })
          } else {
            // Pattern dynamique (template avec substitution, variable, etc.)
            newRegExpDynamic++
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return results
}

// ── Validation ────────────────────────────────────────────────────────

const VALID_FLAGS = new Set(['d', 'g', 'i', 'm', 's', 'u', 'v', 'y'])

function validateRegex(regex: FoundRegex, fileRel: string): string | null {
  // Vérifier les flags (ordre, doublons, caractères invalides)
  for (const f of regex.flags) {
    if (!VALID_FLAGS.has(f)) {
      return `${fileRel}:${regex.line}:${regex.col} — ${RED}Flag invalide '${f}'${RESET}`
    }
  }
  // Vérifier les doublons
  if (new Set(regex.flags).size !== regex.flags.length) {
    return `${fileRel}:${regex.line}:${regex.col} — ${RED}Flags dupliqués${RESET}`
  }
  // Vérifier que u et v ne sont pas ensemble
  if (regex.flags.includes('u') && regex.flags.includes('v')) {
    return `${fileRel}:${regex.line}:${regex.col} — ${RED}Flags u et v incompatibles${RESET}`
  }

  // Tenter de compiler le regex
  try {
    new RegExp(regex.pattern, regex.flags)
    return null // OK
  } catch (err) {
    const msg = (err as Error).message || String(err)
    // Nettoyer le message pour le rendre lisible
    const clean = msg.replace(/^Invalid regular expression: \/.+\/: /, '')
      .replace(/^Invalid flags supplied to RegExp constructor /, '')
    return `${fileRel}:${regex.line}:${regex.col} — ${RED}${clean}${RESET}`
  }
}

// ── Parcours récursif ─────────────────────────────────────────────────

function walkDir(dir: string): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }

  for (const entry of entries) {
    const full = join(dir, entry)
    let stat: ReturnType<typeof statSync>
    try {
      stat = statSync(full)
    } catch {
      continue
    }

    if (stat.isDirectory()) {
      if (!IGNORE_DIRS.has(entry) && !entry.startsWith('__')) {
        walkDir(full)
      }
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.d.ts')) {
      processFile(full)
    }
  }
}

function processFile(filePath: string): void {
  const fileRel = relative(ROOT, filePath)
  const source = readFileSync(filePath, 'utf-8')
  totalFiles++

  // 1. Regex literals (/pattern/flags)
  const regexes = extractRegexLiterals(source, filePath)
  totalRegexes += regexes.length

  for (const regex of regexes) {
    const error = validateRegex(regex, fileRel)
    if (error) {
      console.log(`  ${RED}✗${RESET} ${error}`)
      totalErrors++
    } else {
      console.log(`  ${GREEN}✓${RESET} ${fileRel}:${regex.line}:${regex.col} /${regex.pattern}/${regex.flags}`)
    }
  }

  // 2. new RegExp('string', 'flags') calls
  const newRegExpCalls = extractNewRegExpCalls(source, filePath)
  for (const regex of newRegExpCalls) {
    const error = validateRegex(regex, fileRel)
    if (error) {
      console.log(`  ${RED}✗${RESET} ${error}`)
      totalErrors++
    } else {
      console.log(`  ${GREEN}✓${RESET} ${fileRel}:${regex.line}:${regex.col} new RegExp(${regex.pattern.length > 60 ? `'${regex.pattern.slice(0, 60)}...'` : `'${regex.pattern}'`}${regex.flags ? `, '${regex.flags}'` : ''})`)
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────

function main(): void {
  console.log(`\n${BOLD}${CYAN}════════════════════════════════════════════${RESET}`)
  console.log(`${BOLD}${CYAN}  LINT REGEX — Validation des regex literals${RESET}`)
  console.log(`${BOLD}${CYAN}  Utilise l'AST TypeScript (ts.createSourceFile)${RESET}`)
  console.log(`${BOLD}${CYAN}════════════════════════════════════════════${RESET}\n`)

  walkDir(SRC_DIR)

  console.log(`\n${BOLD}${CYAN}════════════════════════════════════════════${RESET}`)
  console.log(`${BOLD}Résumé :${RESET} ${totalFiles} fichiers, ${totalRegexes} regex literals`)
  if (totalNewRegExp > 0) {
    console.log(`${BOLD}  new RegExp() :${RESET} ${newRegExpStatic} vérifiés, ${newRegExpDynamic} dynamiques (${totalNewRegExp} total)`)
  }
  if (totalErrors === 0) {
    console.log(`${BOLD}${GREEN}  ✅ TOUS LES REGEX SONT VALIDES${RESET}`)
  } else {
    console.log(`${BOLD}${RED}  ❌ ${totalErrors} REGEX INVALIDE(S)${RESET}`)
    process.exitCode = 1
  }
  console.log(`${CYAN}════════════════════════════════════════════${RESET}\n`)
}

main()
