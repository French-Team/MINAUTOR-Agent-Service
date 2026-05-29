/**
 * Tests du module kits-injector
 *
 * Exécution : npx tsx src/kits-injector.test.ts
 */

// @kit tests
import { injectKits, injectKitsIntoCommand, scanCommandOutput, extractTargetFilePath, expandBrace, extractFindTargets, detectKitMarkers, findKit, clearRegistryCache, scanFile, computeRelativePath, generateImportLine, hasExistingImport, suggestKits, getKitNames, getKitInfo, loadRegistry } from '../kits-injector.js'
import { writeFileSync, unlinkSync, mkdirSync, rmdirSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

// ── Mini test runner ──────────────────────────────────────────────────

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

// ── Initialisation : pointer le registre réel ─────────────────────────

// Avant les tests, on vide le cache pour forcer le rechargement
clearRegistryCache()

// ── Tests ─────────────────────────────────────────────────────────────

function main(): void {
  console.log(`\n${BOLD}${CYAN}════════════════════════════════════════════${RESET}`)
  console.log(`${BOLD}${CYAN}  TESTS — kits-injector${RESET}`)
  console.log(`${BOLD}${CYAN}════════════════════════════════════════════${RESET}\n`)

  // ── Chargement du module ────────────────────────────────

  console.log(`${BOLD}── Chargement du module${RESET}`)

  // Vérification de compilation : toutes les fonctions exportées doivent exister
  const exports = [
    { name: 'injectKits', fn: injectKits },
    { name: 'injectKitsIntoCommand', fn: injectKitsIntoCommand },
    { name: 'scanCommandOutput', fn: scanCommandOutput },
    { name: 'extractTargetFilePath', fn: extractTargetFilePath },
    { name: 'expandBrace', fn: expandBrace },
    { name: 'extractFindTargets', fn: extractFindTargets },
    { name: 'detectKitMarkers', fn: detectKitMarkers },
    { name: 'findKit', fn: findKit },
    { name: 'clearRegistryCache', fn: clearRegistryCache },
    { name: 'scanFile', fn: scanFile },
    { name: 'computeRelativePath', fn: computeRelativePath },
    { name: 'generateImportLine', fn: generateImportLine },
    { name: 'hasExistingImport', fn: hasExistingImport },
    { name: 'suggestKits', fn: suggestKits },
    { name: 'getKitNames', fn: getKitNames },
    { name: 'getKitInfo', fn: getKitInfo },
    { name: 'loadRegistry', fn: loadRegistry },
  ]
  for (const exp of exports) {
    assert(`module exporte ${exp.name}`, typeof exp.fn === 'function',
      `attendu: function, reçu: ${typeof exp.fn}`)
  }
  assert('module chargé avec succès (17 exports valides)', exports.every(e => typeof e.fn === 'function'))

  // ── loadRegistry ──────────────────────────────────────

  console.log(`\n${BOLD}── loadRegistry${RESET}`)

  assertEqual(typeof loadRegistry, 'function', 'loadRegistry est une fonction')
  const reg = loadRegistry()
  assert('registre chargé avec succès', reg.kits.length > 0)
  assert('kit tests présent', reg.kits.some(k => k.name === 'tests'))
  assert('kit errors présent', reg.kits.some(k => k.name === 'errors'))
  assert('kit timeout présent', reg.kits.some(k => k.name === 'timeout'))
  assert('kit validation présent', reg.kits.some(k => k.name === 'validation'))
  assert('kit logging présent', reg.kits.some(k => k.name === 'logging'))
  assertEqual(reg.version, '1', 'version du registre correcte')

  // ── getKitNames ───────────────────────────────────────

  console.log(`\n${BOLD}── getKitNames / findKit / getKitInfo${RESET}`)

  const names = getKitNames()
  assert('getKitNames retourne un tableau', Array.isArray(names))
  assert('5 kits disponibles', names.length === 5)
  assertIncludes(names.join(','), 'tests', 'contient tests')
  assertIncludes(names.join(','), 'errors', 'contient errors')

  const testsKit = findKit('tests')
  assert('findKit("tests") trouve le kit', testsKit !== undefined)
  assertEqual(testsKit!.name, 'tests', 'nom correct')
  assert('exports non vide', testsKit!.exports.length > 0)

  const unknown = findKit('inexistant')
  assertEqual(unknown, undefined, 'findKit("inexistant") retourne undefined')

  const info = getKitInfo('tests')
  assert('getKitInfo retourne un objet', info !== undefined)
  assert('info a name', info!.name === 'tests')
  assert('info a description', info!.description.length > 0)
  assert('info a exports', info!.exports.length > 0)

  const infoUnknown = getKitInfo('inexistant')
  assertEqual(infoUnknown, undefined, 'getKitInfo("inexistant") retourne undefined')

  // ── detectKitMarkers ──────────────────────────────────

  console.log(`\n${BOLD}── detectKitMarkers${RESET}`)

  assertEqual(detectKitMarkers('').length, 0, 'contenu vide → []')
  assertEqual(detectKitMarkers('// normal comment').length, 0, 'sans @kit → []')

  const withOne = detectKitMarkers('// @kit tests\nimport { x } from "y"')
  assertEqual(withOne.length, 1, 'un marqueur détecté')
  assertEqual(withOne[0], 'tests', 'nom du kit correct')

  const withTwo = detectKitMarkers('// @kit tests\n// @kit timeout\nimport { x } from "y"')
  assertEqual(withTwo.length, 2, 'deux marqueurs détectés')
  assertIncludes(JSON.stringify(withTwo), 'tests', 'contient tests')
  assertIncludes(JSON.stringify(withTwo), 'timeout', 'contient timeout')

  const dedup = detectKitMarkers('// @kit tests\n// @kit tests')
  assertEqual(dedup.length, 1, 'déduplication : 1 seul marqueur')

  const withSpaces = detectKitMarkers('//  @kit   tests  ')
  assertEqual(withSpaces.length, 1, 'espaces multiples gérés')
  assertEqual(withSpaces[0], 'tests', 'nom extrait correctement')

  // ── computeRelativePath ───────────────────────────────

  console.log(`\n${BOLD}── computeRelativePath${RESET}`)

  // Même dossier
  const sameDir = computeRelativePath('kits/kit-tests/test.ts', 'kits/kit-tests/index.js')
  assertEqual(sameDir, './index.js', 'même dossier → ./index.js')

  // Sous-dossier src → kits
  const srcDir = computeRelativePath('src/test.ts', 'kits/kit-tests/index.js')
  assert('src → kits : chemin relatif', srcDir.startsWith('../'))
  assert('se termine par le chemin du kit', srcDir.endsWith('kit-tests/index.js'))

  // Dossier profond
  const deepDir = computeRelativePath('src/deep/folder/test.ts', 'kits/kit-tests/index.js')
  assert('sous-dossier profond : remonte assez', deepDir.startsWith('../../../'))
  assert('se termine par le chemin du kit', deepDir.endsWith('kit-tests/index.js'))

  // Chemin absolu Windows
  const winPath = computeRelativePath('C:/project/src/test.ts', 'C:/project/kits/kit-tests/index.js')
  assert('chemin Windows normalisé', winPath.startsWith('../'))
  assert('chemin Windows : fin correcte', winPath.endsWith('kit-tests/index.js'))

  // ── generateImportLine ────────────────────────────────

  console.log(`\n${BOLD}── generateImportLine${RESET}`)

  const kit = findKit('tests')!
  const importLine = generateImportLine(kit, '../kits/kit-tests/index.js')
  assert('commence par import {', importLine.startsWith('import {'))
  assert('contient un export', importLine.includes('stopTestOnError'))
  assert('contient from', importLine.includes('from'))
  assert('contient le chemin', importLine.includes('../kits/kit-tests/index.js'))
  assert('se termine correctement', importLine.endsWith('.js\'') || importLine.endsWith('\''),
    'fin: "' + importLine.slice(-20) + '"')

  // ── hasExistingImport ─────────────────────────────────

  console.log(`\n${BOLD}── hasExistingImport${RESET}`)

  const contentWithImport = `// @kit tests
import { stopTestOnError } from '../../kits/kit-tests/index.js'
import { describe } from 'vitest'
describe('test', () => {})`
  assert('détecte un import existant', hasExistingImport(contentWithImport, 'tests'))

  const contentWithout = `// @kit tests
import { describe } from 'vitest'
describe('test', () => {})`
  assert('aucun import trouvé', !hasExistingImport(contentWithout, 'tests'))

  // ── injectKits — cas de base ──────────────────────────

  console.log(`\n${BOLD}── injectKits — cas de base${RESET}`)

  // Cas : injection simple
  const simple = `// @kit tests
import { describe } from 'vitest'

describe('test', () => { console.log('ok') })`
  const injected = injectKits(simple, 'src/test.test.ts')
  assert('injection ajoute un import', injected.includes('import { '))
  assert('injection contient stopTestOnError', injected.includes('stopTestOnError'))
  assert('injection contient le chemin du kit', injected.includes('kit-tests/index.js'))
  assert('injection préserve le contenu original', injected.includes("console.log('ok')"))
  assert('injection préserve describe', injected.includes("import { describe } from 'vitest'"))

  // Cas : sans marqueur @kit — pas de modification
  const noMarker = `import { describe } from 'vitest'
describe('test', () => {})`
  const noChange = injectKits(noMarker, 'src/test.test.ts')
  assertEqual(noChange, noMarker, 'sans marqueur @kit → pas de modification')

  // Cas : contenu vide
  const empty = injectKits('', 'src/test.ts')
  assertEqual(empty, '', 'contenu vide → inchangé')

  // Cas : import déjà présent — pas de doublon
  const alreadyInjected = injectKits(injected, 'src/test.test.ts')
  // L'injection ne doit PAS ajouter une deuxième ligne d'import du kit
  const importLines = alreadyInjected.split('\n').filter(l => l.includes('kit-tests/index.js'))
  assert('pas de doublon d\'import du kit', importLines.length === 1,
    'trouvé ' + importLines.length + ' imports du kit')

  // Cas : fichier dans kits/ (même dossier)
  const sameDirContent = '// @kit tests\nconsole.log("hello")'
  const sameDirResult = injectKits(sameDirContent, 'kits/kit-tests/test.ts')
  assert('chemin relatif correct pour même dossier', sameDirResult.includes('./index.js'))

  // ── injectKits — plusieurs kits ────────────────────────

  console.log(`\n${BOLD}── injectKits — plusieurs kits${RESET}`)

  const multiKit = `// @kit tests
// @kit errors
console.log("multi")`
  const multiResult = injectKits(multiKit, 'src/test.ts')
  assert('deux imports ajoutés', multiResult.includes('stopTestOnError') && multiResult.includes('ErrorBoundary'))
  assert('chaque import est sur sa propre ligne', multiResult.match(/import \{/g)!.length === 2)

  // ── suggestKits ────────────────────────────────────────

  console.log(`\n${BOLD}── suggestKits${RESET}`)

  const testFileSuggest = suggestKits('my-component.test.ts')
  assert('fichier .test.ts → kit tests suggéré', testFileSuggest.some(k => k.name === 'tests'))

  const specFileSuggest = suggestKits('my-component.spec.ts')
  assert('fichier .spec.ts → kit tests suggéré', specFileSuggest.some(k => k.name === 'tests'))

  const tsFileSuggest = suggestKits('util.ts')
  assert('fichier .ts → plusieurs kits suggérés', tsFileSuggest.some(k =>
    ['errors', 'timeout', 'validation', 'logging'].includes(k.name)
  ))

  const unknownFileSuggest = suggestKits('readme.md')
  assert('fichier .md → aucun kit', unknownFileSuggest.length === 0)

  // ── scanFile ───────────────────────────────────────────

  console.log(`\n${BOLD}── scanFile${RESET}`)

  const scanContent = `// @kit tests
import { stopTestOnError } from '../kits/kit-tests/index.js'
console.log("ok")`
  const scanResult = scanFile(scanContent, 'src/my-component.test.ts')
  assert('scan : kits manquants vide', scanResult.missingKits.length === 0)
  assert('scan : kit présent', scanResult.presentKits.includes('tests'))

  const scanMissingContent = `// @kit tests
console.log("no import")`
  const scanMissing = scanFile(scanMissingContent, 'src/my-component.test.ts')
  assert('scan : détecte import manquant', scanMissing.missingKits.some(m => m.name === 'tests'))
  assert('scan : raison expliquée', scanMissing.missingKits.some(m => m.reason.length > 0))

  // ── injectKitsIntoCommand ─────────────────────────────

  console.log(`\n${BOLD}── injectKitsIntoCommand (interception heredoc)${RESET}`)

  // Utilise le cwd réel pour que resolve() fonctionne sur toutes les plateformes
  const testCwd = process.cwd()

  // Test 1 : heredoc simple avec @kit → injection
  const heredoc1 = [
    "cat > src/test.test.ts << 'EOF'",
    '// @kit tests',
    "import { describe } from 'vitest'",
    "describe('suite', () => {})",
    'EOF',
  ].join('\n')
  const result1 = injectKitsIntoCommand(heredoc1, testCwd)
  assert('heredoc : contenu modifié', result1 !== heredoc1)
  assert('heredoc : import de stopTestOnError ajouté', result1.includes('stopTestOnError'))
  assert('heredoc : ligne d\'import complète présente',
    /import \{ [^}]+ \} from '[^']+kit-tests\/index\.js'/.test(result1),
    'recherche import { X } from \'.../kit-tests/index.js\'')
  assert('heredoc : chemin relatif correct depuis src/',
    result1.includes('kit-tests/index.js') && !result1.includes('src/kit-tests'),
    'le chemin ne doit pas passer par src/')
  assert('heredoc : préserve le contenu original', result1.includes("describe('suite'"))
  assert('heredoc : ligne d\'ouverture conservée', result1.startsWith("cat > src/test.test.ts << 'EOF'"))
  assert('heredoc : marqueur de fermeture conservé', result1.trimEnd().endsWith('EOF'))

  // Test 2 : heredoc sans @kit → pas de changement
  const heredocNoMarker = [
    "cat > src/util.ts << 'EOF'",
    'const x = 42',
    'console.log(x)',
    'EOF',
  ].join('\n')
  const result2 = injectKitsIntoCommand(heredocNoMarker, testCwd)
  assertEqual(result2, heredocNoMarker, 'heredoc sans @kit → inchangé')

  // Test 3 : heredoc avec @kit et import déjà présent → pas de doublon
  const heredocAlready = [
    "cat > src/test.test.ts << 'EOF'",
    '// @kit tests',
    "import { stopTestOnError } from '../../kits/kit-tests/index.js'",
    'EOF',
  ].join('\n')
  const result3 = injectKitsIntoCommand(heredocAlready, testCwd)
  assertEqual(result3, heredocAlready, 'heredoc : import déjà présent → pas de doublon')

  // Test 4 : Pattern 2 (cat << 'MARKER' > path)
  const heredocPattern2 = [
    "cat << 'EOF' > src/test.test.ts",
    '// @kit tests',
    'const x = 1',
    'EOF',
  ].join('\n')
  const result4 = injectKitsIntoCommand(heredocPattern2, testCwd)
  assert('pattern 2 : contenu modifié', result4 !== heredocPattern2)
  assert('pattern 2 : import ajouté', result4.includes('stopTestOnError'))

  // Test 5 : commande simple (pas heredoc) → inchangée
  const simpleCmd = 'ls -la'
  assertEqual(injectKitsIntoCommand(simpleCmd, testCwd), simpleCmd, 'commande simple → inchangée')

  // Test 6 : heredoc avec @kit errors uniquement
  const heredocErrors = [
    "cat > src/util.ts << 'EOF'",
    '// @kit errors',
    'function process() { throw new Error("boom") }',
    'EOF',
  ].join('\n')
  const result6 = injectKitsIntoCommand(heredocErrors, testCwd)
  assert('heredoc errors : contenu modifié', result6 !== heredocErrors)
  assert('heredoc errors : import ErrorBoundary ajouté', result6.includes('ErrorBoundary'))
  assert('heredoc errors : import de tests pas présent', !result6.includes('stopTestOnError'))

  // Test 7 : deux marqueurs @kit dans le même heredoc
  const heredocMulti = [
    "cat > src/app.ts << 'EOF'",
    '// @kit errors',
    '// @kit timeout',
    'function process() {}',
    'EOF',
  ].join('\n')
  const result7 = injectKitsIntoCommand(heredocMulti, testCwd)
  assert('heredoc multi-kit : deux imports ajoutés',
    result7.includes('ErrorBoundary') && result7.includes('withTimeout'))

  // Test 8 : contenu vide → inchangé
  const heredocEmpty = [
    "cat > path << 'EOF'",
    'EOF',
  ].join('\n')
  assertEqual(injectKitsIntoCommand(heredocEmpty, testCwd), heredocEmpty, 'heredoc vide → inchangé')

  // Test 9 : heredoc avec marqueur non guillemeté
  const heredocUnquoted = [
    'cat > src/test.test.ts << EOF',
    '// @kit tests',
    'const x = 1',
    'EOF',
  ].join('\n')
  const result9 = injectKitsIntoCommand(heredocUnquoted, testCwd)
  assert('heredoc sans guillemets : import ajouté', result9.includes('stopTestOnError'))
  assert('heredoc sans guillemets : ligne ouverture conservée', result9.startsWith('cat > src/test.test.ts << EOF'))

  // Test 10 : heredoc avec chemin quoté (espaces dans le path)
  const heredocQuotedPath = [
    'cat > "src/my test file.ts" << \'EOF\'',
    '// @kit tests',
    'const x = 1',
    'EOF',
  ].join('\n')
  const result10 = injectKitsIntoCommand(heredocQuotedPath, testCwd)
  assert('heredoc chemin quoté : import ajouté', result10.includes('stopTestOnError'))
  assert('heredoc chemin quoté : ligne ouverture conservée', result10.startsWith('cat > "src/my test file.ts" << \'EOF\''))
  assert('heredoc chemin quoté : marqueur fermeture conservé', result10.trimEnd().endsWith('EOF'))

  // ── scanCommandOutput (scan post-écriture) ──────────────

  console.log(`\n${BOLD}── scanCommandOutput (scan post-écriture)${RESET}`)

  const scanDir = 'src/__kits_scan_test__'
  const scanDirAbs = join(process.cwd(), scanDir)
  mkdirSync(scanDirAbs, { recursive: true })

  function scanCmd(relPath: string, content: string): string {
    const cmd = `cat > ${relPath} << 'EOF'\n${content}\nEOF`
    return scanCommandOutput(cmd, process.cwd())
  }

  try {
    // Test 1 : @kit tests sans import → alerte import manquant
    const f1 = join(scanDirAbs, 'test.test.ts')
    writeFileSync(f1, '// @kit tests\nconst x = 1\n', 'utf-8')
    const w1 = scanCmd(`${scanDir}/test.test.ts`, '// @kit tests\nconst x = 1')
    assert('scan post : détecte @kit sans import', w1.includes('⚠️'))
    assert('scan post : mentionne le kit tests', w1.includes('tests'))
    assert('scan post : format alerte', w1.includes('📋 Scan des kits'))

    // Test 2 : @kit avec import OK → pas d'alerte ⚠️ (suggestions 💡 acceptées car .ts)
    const f2 = join(scanDirAbs, 'ok.test.ts')
    writeFileSync(f2, '// @kit tests\nimport { stopTestOnError } from "../../kits/kit-tests/index.js"\nconst x = 1\n', 'utf-8')
    const w2 = scanCmd(`${scanDir}/ok.test.ts`, '// @kit tests\nimport { stopTestOnError } from "../../kits/kit-tests/index.js"\nconst x = 1')
    assert('scan post : imports OK → pas d\'alerte ⚠️', !w2.includes('⚠️'),
      'w2 = ' + JSON.stringify(w2).slice(0, 80))

    // Test 3 : .ts sans @kit → suggestions de kits
    const f3 = join(scanDirAbs, 'util.ts')
    writeFileSync(f3, 'const x = 1\n', 'utf-8')
    const w3 = scanCmd(`${scanDir}/util.ts`, 'const x = 1')
    assert('scan post : .ts suggère des kits', w3.includes('💡'),
      'reçu: ' + JSON.stringify(w3).slice(0, 120))

    // Test 4 : fichier inexistant → silencieux
    const w4 = scanCommandOutput(`cat > ${scanDir}/nofile.ts << 'EOF'\nconst a = 1\nEOF`, process.cwd())
    assertEqual(w4, '', 'scan post : fichier inexistant → silencieux')

    // Test 5 : commande simple (pas heredoc) → pas d'alerte
    const w5 = scanCommandOutput('echo hello', process.cwd())
    assertEqual(w5, '', 'scan post : non heredoc → pas d\'alerte')

    // ── Tests echo redirect ───────────────────────────────

    // Test 6 : echo "..." > file avec @kit sans import → alerte
    const f6 = join(scanDirAbs, 'echo-test.test.ts')
    writeFileSync(f6, '// @kit tests\nconst y = 2\n', 'utf-8')
    const cmd6 = `echo "// @kit tests" > ${scanDir}/echo-test.test.ts`
    const w6 = scanCommandOutput(cmd6, process.cwd())
    assert('echo > : détecte @kit sans import', w6.includes('⚠️'),
      'w6 = ' + JSON.stringify(w6).slice(0, 80))

    // Test 7 : echo '...' > file avec @kit sans import → alerte
    const f7 = join(scanDirAbs, 'echo-single.test.ts')
    writeFileSync(f7, '// @kit tests\nconst z = 3\n', 'utf-8')
    const cmd7 = `echo '// @kit tests' > ${scanDir}/echo-single.test.ts`
    const w7 = scanCommandOutput(cmd7, process.cwd())
    assert('echo \'\' > : détecte @kit sans import', w7.includes('⚠️'),
      'w7 = ' + JSON.stringify(w7).slice(0, 80))

    // Test 8 : echo "..." >> file (append) avec @kit sans import → alerte
    const f8 = join(scanDirAbs, 'echo-append.test.ts')
    writeFileSync(f8, '// @kit tests\nconst a = 1\n', 'utf-8')
    const cmd8 = `echo "// @kit errors" >> ${scanDir}/echo-append.test.ts`
    const w8 = scanCommandOutput(cmd8, process.cwd())
    assert('echo >> : détecte @kit sans import', w8.includes('⚠️'),
      'w8 = ' + JSON.stringify(w8).slice(0, 80))

    // Test 9 : echo "..." > file avec imports OK → pas d'alerte ⚠️
    const f9 = join(scanDirAbs, 'echo-ok.test.ts')
    writeFileSync(f9, '// @kit tests\nimport { stopTestOnError } from "../../kits/kit-tests/index.js"\nconst b = 1\n', 'utf-8')
    const cmd9 = `echo "// @kit tests" > ${scanDir}/echo-ok.test.ts`
    const w9 = scanCommandOutput(cmd9, process.cwd())
    assert('echo > : imports OK → pas d\'alerte ⚠️', !w9.includes('⚠️'),
      'w9 = ' + JSON.stringify(w9).slice(0, 80))

    // ── Tests tee ────────────────────────────────────────

    // Test 10 : ... | tee file avec @kit sans import → alerte
    const f10 = join(scanDirAbs, 'tee-test.test.ts')
    writeFileSync(f10, '// @kit tests\nconst t = 1\n', 'utf-8')
    const cmd10 = `echo "// @kit tests" | tee ${scanDir}/tee-test.test.ts`
    const w10 = scanCommandOutput(cmd10, process.cwd())
    assert('tee : détecte @kit sans import', w10.includes('⚠️'),
      'w10 = ' + JSON.stringify(w10).slice(0, 80))

    // Test 11 : ... | tee -a file (append) avec @kit sans import → alerte
    const f11 = join(scanDirAbs, 'tee-append.test.ts')
    writeFileSync(f11, '// @kit errors\nconst u = 1\n', 'utf-8')
    const cmd11 = `echo "// @kit errors" | tee -a ${scanDir}/tee-append.test.ts`
    const w11 = scanCommandOutput(cmd11, process.cwd())
    assert('tee -a : détecte @kit sans import', w11.includes('⚠️'),
      'w11 = ' + JSON.stringify(w11).slice(0, 80))

    // Test 12 : | tee file inexistant → silencieux
    const cmd12 = `echo "// @kit tests" | tee ${scanDir}/tee-nofile.test.ts`
    const w12 = scanCommandOutput(cmd12, process.cwd())
    assertEqual(w12, '', 'tee : fichier inexistant → silencieux')

  } finally {
    // Nettoyage
    const cleanupFiles = [
      'test.test.ts', 'ok.test.ts', 'util.ts', 'nofile.ts',
      'echo-test.test.ts', 'echo-single.test.ts', 'echo-append.test.ts', 'echo-ok.test.ts',
      'tee-test.test.ts', 'tee-append.test.ts', 'tee-nofile.test.ts',
    ]
    for (const f of cleanupFiles) {
      try { unlinkSync(join(scanDirAbs, f)) } catch { /* ignore */ }
    }
    try { rmdirSync(scanDirAbs) } catch { /* ignore */ }
  }

  // ── extractTargetFilePath (tests unitaires) ────────────

  console.log(`\n${BOLD}── extractTargetFilePath (patterns extraction)${RESET}`)

  // Tests sans I/O fichier — pure extraction de chemin

  // Heredoc
  const h1 = extractTargetFilePath("cat > src/test.ts << 'EOF'\ncontent\nEOF")
  assertEqual(h1, 'src/test.ts', 'heredoc : cat > path << MARKER')

  const h2 = extractTargetFilePath("cat << 'EOF' > src/test.ts\ncontent\nEOF")
  assertEqual(h2, 'src/test.ts', 'heredoc : cat << MARKER > path')

  // Heredoc avec chemins quotés
  const h3 = extractTargetFilePath('cat > "src/my test.ts" << \'EOF\'\ncontent\nEOF')
  assertEqual(h3, 'src/my test.ts', 'heredoc : doubles quotes autour du chemin')

  const h4 = extractTargetFilePath("cat > 'src/my test.ts' << 'EOF'\ncontent\nEOF")
  assertEqual(h4, 'src/my test.ts', 'heredoc : simples quotes autour du chemin')

  const h5 = extractTargetFilePath('cat << \'EOF\' > "src/my test.ts"\ncontent\nEOF')
  assertEqual(h5, 'src/my test.ts', 'heredoc pattern 2 : doubles quotes autour du chemin')

  // Echo
  const e1 = extractTargetFilePath('echo "hello" > src/out.ts')
  assertEqual(e1, 'src/out.ts', 'echo > : doubles quotes')

  const e2 = extractTargetFilePath("echo 'hello' > src/out.ts")
  assertEqual(e2, 'src/out.ts', 'echo > : simples quotes')

  const e3 = extractTargetFilePath('echo hello > src/out.ts')
  assertEqual(e3, 'src/out.ts', 'echo > : mot simple non quoté')

  const e3b = extractTargetFilePath('echo hello world > src/out.ts')
  assertEqual(e3b, 'src/out.ts', 'echo > : plusieurs mots non quotés')

  const e4 = extractTargetFilePath('echo "hello" >> src/append.ts')
  assertEqual(e4, 'src/append.ts', 'echo >> : append')

  const e5 = extractTargetFilePath('echo -n "hello" > src/out.ts')
  assertEqual(e5, 'src/out.ts', 'echo -n > : avec option')

  // Echo avec chemins quotés
  const e6 = extractTargetFilePath('echo "hello" > "src/my path.ts"')
  assertEqual(e6, 'src/my path.ts', 'echo > : path avec doubles quotes')

  const e7 = extractTargetFilePath("echo 'hello' > 'src/my path.ts'")
  assertEqual(e7, 'src/my path.ts', "echo > : path avec simples quotes")

  const e8 = extractTargetFilePath('echo hello world > "src/my path.ts"')
  assertEqual(e8, 'src/my path.ts', 'echo > : plusieurs mots + path quoté')

  const e9 = extractTargetFilePath('echo -n "hello" >> "src/my path.ts"')
  assertEqual(e9, 'src/my path.ts', 'echo >> append : path avec doubles quotes')

  // Tee
  const t1 = extractTargetFilePath('echo "test" | tee src/out.ts')
  assertEqual(t1, 'src/out.ts', 'tee : pipe simple')

  const t2 = extractTargetFilePath('echo "test" | tee -a src/out.ts')
  assertEqual(t2, 'src/out.ts', 'tee -a : append flag')

  // Tee avec chemins quotés
  const t3 = extractTargetFilePath('echo "test" | tee "src/my path.ts"')
  assertEqual(t3, 'src/my path.ts', 'tee : path avec doubles quotes')

  const t4 = extractTargetFilePath("echo 'test' | tee 'src/my path.ts'")
  assertEqual(t4, 'src/my path.ts', "tee : path avec simples quotes")

  const t5 = extractTargetFilePath('echo "test" | tee -a "src/my path.ts"')
  assertEqual(t5, 'src/my path.ts', 'tee -a : path avec doubles quotes')

  // printf > file
  const p1 = extractTargetFilePath('printf "%s" "hello" > src/out.ts')
  assertEqual(p1, 'src/out.ts', 'printf "..." > path')

  const p2 = extractTargetFilePath("printf '%s' 'hello' > src/out.ts")
  assertEqual(p2, 'src/out.ts', "printf '...' > path")

  const p3 = extractTargetFilePath('printf "format with spaces" > src/out.ts')
  assertEqual(p3, 'src/out.ts', 'printf avec contenu multi-mot > path')

  // sed -i
  const s1 = extractTargetFilePath("sed -i 's/foo/bar/g' src/file.ts")
  assertEqual(s1, 'src/file.ts', "sed -i 'script' path")

  const s2 = extractTargetFilePath('sed -i.bak "s/foo/bar/g" src/file.ts')
  assertEqual(s2, 'src/file.ts', "sed -i.bak 'script' path (avec suffixe)")

  const s3 = extractTargetFilePath("sed -i 's/foo/bar/g' \"src/my file.ts\"")
  assertEqual(s3, 'src/my file.ts', 'sed -i avec chemin quoté')

  // cp source dest
  const c1 = extractTargetFilePath('cp src/file.ts src/copy.ts')
  assertEqual(c1, 'src/copy.ts', 'cp source dest (dernier argument)')

  const c2 = extractTargetFilePath('cp -r src/dir/ dest/dir/')
  assertEqual(c2, 'dest/dir/', 'cp -r recupère la destination')

  const c3 = extractTargetFilePath("cp 'src/my file.ts' 'src/copy.ts'")
  assertEqual(c3, 'src/copy.ts', 'cp avec chemins quotés (dernier = dest)')

  const c4 = extractTargetFilePath('cp src1.ts src2.ts dest/')
  assertEqual(c4, 'dest/', 'cp multi-sources capture dest')

  // Redirect simple : commande > file.ext
  const r1 = extractTargetFilePath('node build.js > dist/output.js')
  assertEqual(r1, 'dist/output.js', 'redirect simple : node > path.js')

  const r2 = extractTargetFilePath('npm run build > dist/bundle.js')
  assertEqual(r2, 'dist/bundle.js', 'redirect simple : npm > path.js')

  const r3 = extractTargetFilePath('tsc --noEmit > result.txt')
  assertEqual(r3, 'result.txt', 'redirect simple : tsc > path.txt')

  // Note: les commandes avec redirections multiples (2> + 1>) ne sont pas
  // supportées — le parsing shell est trop complexe pour un regex simple.
  const r4 = extractTargetFilePath('echo "test" 2> /dev/null 1> output.log')
  assertEqual(r4, null, 'redirect simple : redirections multiples → null')

  // Redirect simple : ne doit PAS matcher sans point (exclut fd>)
  const r5 = extractTargetFilePath('cat file 2>/dev/null')
  assertEqual(r5, null, 'redirect 2>/dev/null sans point → null')

  const r6 = extractTargetFilePath('command &>/tmp/out')
  assertEqual(r6, null, 'redirect &> sans point → null (exclu)')

  // Aucun match
  const n1 = extractTargetFilePath('echo hello')
  assertEqual(n1, null, 'echo sans redirect → null')

  const n2 = extractTargetFilePath('ls -la')
  assertEqual(n2, null, 'commande simple → null')

  // cat > dest.ts est maintenant supporté par le redirect pattern
  const n3 = extractTargetFilePath('cat file > dest.ts')
  assertEqual(n3, 'dest.ts', 'cat sans heredoc → redirect simple capture dest.ts')

  const n4 = extractTargetFilePath('echo "test" 2>&1')
  assertEqual(n4, null, 'redirect 2>&1 → null (pas de point + stderr)')

  const n5 = extractTargetFilePath('make all 2>> build.log')
  assertEqual(n5, null, 'redirect 2>> build.log → null (stderr exclu)')

  const n6 = extractTargetFilePath('command &> /dev/null')
  assertEqual(n6, null, 'redirect &> /dev/null → null (précédé de &)')

  // ── Guard find -exec ──────────────────────────────────

  // Tous ces cas doivent retourner null : le guard ignore les lignes
  // contenant find ... -exec pour éviter que sed/cp/echo ne capturent
  // des arguments de find -exec (ex: {}, +, \;, etc.)

  const fg1 = extractTargetFilePath('find . -iname "*.ts" -exec sed -i \'s/a/b/g\' {} \\;')
  assertEqual(fg1, null, 'find -iname : guard bloque les lignes find -exec')

  const fg2 = extractTargetFilePath('find . -exec rm {} \\;')
  assertEqual(fg2, null, 'find -exec rm : guard bloque')

  const fg3 = extractTargetFilePath('find . -type f -name "*.ts" -exec sed -i \'s/a/b/g\' {} \\;')
  assertEqual(fg3, null, 'find avec options (-type, -name) avant -exec : guard bloque')

  const fg4 = extractTargetFilePath('find . -name "*.ts" -exec echo hello > /dev/null \\;')
  assertEqual(fg4, null, 'find -exec sans guillemets : guard bloque')

  // ── Guard \b (word boundaries sur les commandes) ───────

  // Vérifie que \b devant sed/cp/tee empêche les faux positifs
  // quand la commande est dans un mot plus long.
  // Note : echo/printf/cat sont aussi protégés mais le redirect
  // regex (pattern 7) est un attrape-tout pour > path.ext — on
  // utilise donc des commandes SANS > pour tester \b.

  const wb1 = extractTargetFilePath('ased -i \'s/a/b/g\' src/file.ts')
  assertEqual(wb1, null, '\b : ased ne doit pas matcher sed (pas de >)')

  const wb2 = extractTargetFilePath('acp src/file.ts src/copy.ts')
  assertEqual(wb2, null, '\b : acp ne doit pas matcher cp (pas de >)')

  const wb3 = extractTargetFilePath('echo "test" | mytee src/out.ts')
  assertEqual(wb3, null, '\b : mytee ne doit pas matcher tee (| mytee)')

  // ── Guard fd redirect (echappe à 2> et 2> ) ────────────

  // Le nouveau regex (?:[^>\d]|\d(?!\s*>))* empêche les
  // redirections de fd (stderr) d'être confondues avec des
  // redirections stdout, même avec un espace entre 2 et >

  const fd1 = extractTargetFilePath('echo hello 2> /dev/null')
  assertEqual(fd1, null, 'fd guard : echo 2> /dev/null (espace avant >)')

  const fd2 = extractTargetFilePath('echo hello 2>/dev/null')
  assertEqual(fd2, null, 'fd guard : echo 2>/dev/null (sans espace avant >)')

  const fd3 = extractTargetFilePath('echo -n test 2> /dev/null')
  assertEqual(fd3, null, 'fd guard : echo -n 2> /dev/null (avec option)')

  const fd4 = extractTargetFilePath('printf "test" 2> /dev/null')
  assertEqual(fd4, null, 'fd guard : printf 2> /dev/null')

  // Echo avec contenu contenant un chiffre (doit marcher)
  const fd5 = extractTargetFilePath('echo "hello2" > src/out.ts')
  assertEqual(fd5, 'src/out.ts', 'fd guard : echo avec contenu quoté contenant un chiffre')

  const fd6 = extractTargetFilePath('echo version2 > src/out.ts')
  assertEqual(fd6, 'src/out.ts', 'fd guard : echo version2 > path (chiffre dans mot non quoté)')

  // ── expandBrace (brace expansion) ─────────────────────

  console.log(`\n${BOLD}── expandBrace (brace expansion)${RESET}`)

  assertEqual(expandBrace('src/simple.ts').length, 1, 'sans accolades → 1 élément')
  assertEqual(expandBrace('src/simple.ts')[0], 'src/simple.ts', 'sans accolades → inchangé')

  const b1 = expandBrace('src/{a,b,c}.ts')
  assertEqual(b1.length, 3, 'a,b,c → 3 éléments')
  assertEqual(b1[0], 'src/a.ts', 'premier élément')
  assertEqual(b1[1], 'src/b.ts', 'deuxième élément')
  assertEqual(b1[2], 'src/c.ts', 'troisième élément')

  const b2 = expandBrace('{x,y}/{1,2}.ts')
  assertEqual(b2.length, 4, 'double expansion → 4 éléments')
  assertEqual(b2[0], 'x/1.ts', 'x/1')
  assertEqual(b2[1], 'x/2.ts', 'x/2')
  assertEqual(b2[2], 'y/1.ts', 'y/1')
  assertEqual(b2[3], 'y/2.ts', 'y/2')

  const b3 = expandBrace('{a,b}')
  assertEqual(b3.length, 2, 'sans suffixe → 2')
  assertEqual(b3[0], 'a', 'juste a')
  assertEqual(b3[1], 'b', 'juste b')

  // Test scanCommandOutput avec brace expansion
  console.log(`\n${BOLD}── scanCommandOutput avec brace expansion${RESET}`)
  const multiDir = 'src/__kits_brace_test__'
  const multiDirAbs = join(process.cwd(), multiDir)
  mkdirSync(multiDirAbs, { recursive: true })

  try {
    // Créer les fichiers qui seront "écrits" par la commande brace
    writeFileSync(join(multiDirAbs, 'alpha.test.ts'), '// @kit tests\nconst a = 1\n', 'utf-8')
    writeFileSync(join(multiDirAbs, 'beta.test.ts'), '// @kit errors\nconst b = 2\n', 'utf-8')

    // Simuler une commande avec brace expansion
    const braceCmd = `echo "content" > ${multiDir}/{alpha,beta}.test.ts`
    const braceWarn = scanCommandOutput(braceCmd, process.cwd())

    // Doit détecter les deux fichiers
    assert('brace scan : alerte non vide', braceWarn.length > 0)
    assert('brace scan : mentionne alpha', braceWarn.includes('alpha.test.ts'),
      'reçu: ' + JSON.stringify(braceWarn).slice(0, 100))
    assert('brace scan : mentionne beta', braceWarn.includes('beta.test.ts'),
      'reçu: ' + JSON.stringify(braceWarn).slice(0, 100))
  } finally {
    for (const f of ['alpha.test.ts', 'beta.test.ts']) {
      try { unlinkSync(join(multiDirAbs, f)) } catch { /* ignore */ }
    }
    try { rmdirSync(multiDirAbs) } catch { /* ignore */ }
  }

  // ── extractFindTargets — test avec fichiers réels ──────

  console.log(`\n${BOLD}── extractFindTargets (glob fichier)${RESET}`)

  const findDir = 'src/__kits_find_test__'
  const findDirAbs = join(process.cwd(), findDir)
  mkdirSync(findDirAbs, { recursive: true })

  try {
    // Créer quelques fichiers de test
    writeFileSync(join(findDirAbs, 'foo.ts'), '// foo', 'utf-8')
    writeFileSync(join(findDirAbs, 'bar.test.ts'), '// @kit tests\nconst x = 1', 'utf-8')
    writeFileSync(join(findDirAbs, 'baz.ts'), '// baz', 'utf-8')
    writeFileSync(join(findDirAbs, 'readme.md'), '# readme', 'utf-8')

    // Sous-dossier
    const subDir = join(findDirAbs, 'sub')
    mkdirSync(subDir, { recursive: true })
    writeFileSync(join(subDir, 'nested.ts'), '// nested', 'utf-8')

    // Test : find avec pattern -name "*.ts"
    const cmd1 = `find ${findDir} -name "*.ts"`
    const targets1 = extractFindTargets(cmd1, process.cwd())
    assert('find *.ts : 4 fichiers (foo, bar, baz, nested)', targets1.length === 4,
      `trouvé ${targets1.length} fichiers: ${targets1.map(t => t.split(/[/\\]/).pop()).join(', ')}`)

    // Test : find avec -name "*.test.ts"
    const cmd2 = `find ${findDir} -name "*.test.ts"`
    const targets2 = extractFindTargets(cmd2, process.cwd())
    assert('find *.test.ts : 1 fichier', targets2.length === 1,
      `trouvé ${targets2.length}`)
    assert('find *.test.ts : contient bar.test.ts', targets2[0]!.endsWith('bar.test.ts'))

    // Test : find avec fichier inexistant
    const cmd3 = `find ${findDir} -name "*.xyz"`
    const targets3 = extractFindTargets(cmd3, process.cwd())
    assertEqual(targets3.length, 0, 'find *.xyz : aucun résultat')

    // Test : commande non-find retourne []
    const targets4 = extractFindTargets('echo hello', process.cwd())
    assertEqual(targets4.length, 0, 'commande non-find → []')

    // Test : scanCommandOutput avec commande find -exec
    const cmd5 = `find ${findDir} -name "*.ts" -exec sed -i 's/foo/bar/g' {} \\;`
    const scanResult = scanCommandOutput(cmd5, process.cwd())
    assert('find -exec scan : résultats non vides', scanResult.length > 0,
      'reçu: ' + JSON.stringify(scanResult).slice(0, 100))
    // Doit mentionner plusieurs fichiers du find
    assert('find -exec scan : scan multi-fichier',
      scanResult.includes('📄') || (scanResult.includes('⚠️') && scanResult.includes('💡')),
      'reçu: ' + JSON.stringify(scanResult).slice(0, 120))

  } finally {
    // Nettoyage récursif
    function removeRecursive(dir: string): void {
      let entries: string[]
      try { entries = readdirSync(dir) } catch { return }
      for (const entry of entries) {
        const full = join(dir, entry)
        try {
          const s = statSync(full)
          if (s.isDirectory()) removeRecursive(full)
          else unlinkSync(full)
        } catch { /* ignore */ }
      }
      try { rmdirSync(dir) } catch { /* ignore */ }
    }
    removeRecursive(findDirAbs)
  }

  // ── Résumé ─────────────────────────────────────────────

  const total = passed + failed
  console.log(`\n${BOLD}${CYAN}════════════════════════════════════════════${RESET}`)
  console.log(`${BOLD}${CYAN}  RÉSULTATS : ${passed}/${total} tests OK${RESET}`)
  if (failed > 0) {
    console.log(`${BOLD}${RED}  ${failed} ÉCHEC(S)${RESET}`)
    process.exit(1)
  } else {
    console.log(`${BOLD}${GREEN}  TOUS LES TESTS SONT PASSÉS${RESET}`)
  }
  console.log(`${BOLD}${CYAN}════════════════════════════════════════════${RESET}\n`)
}

main()
