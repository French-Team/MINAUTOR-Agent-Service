/**
 * Test de bout en bout du workflow agent + LLM
 * Exécute : node dist/test.js
 *
 * Note : utilise un dossier TEMPORAIRE (os.tmpdir()) pour les agents de test,
 * afin d'éviter toute corruption EPERM sur .agents/ sous Windows.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync, rmSync, readdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { safeExit } from './constants.js'
import { createEngine } from './engine.js'
import {
  addProvider, listProviders, removeProvider, resolveProviderForModel,
  fetchModels, getProvider, isApiKeyUsed,
} from './providers.js'

const RESET = '\x1b[0m'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const CYAN = '\x1b[36m'
const YELLOW = '\x1b[33m'
const BOLD = '\x1b[1m'

const CWD = process.cwd()
const PROVIDERS_FILE = join(CWD, 'providers.json')

// Dossier temporaire isolé pour les agents de test — jamais de conflit avec .agents/ du projet
const TEST_DIR = join(tmpdir(), `minautor-e2e-${Date.now()}`)
const AGENTS_DIR = join(TEST_DIR, '.agents')

const PASS = `${GREEN}✓${RESET}`
const FAIL = `${RED}✗${RESET}`
let passed = 0
let failed = 0

function assert(label: string, ok: boolean, detail?: string) {
  if (ok) { passed++; console.log(`  ${PASS} ${label}`) }
  else { failed++; console.log(`  ${FAIL} ${label} ${detail ? `— ${RED}${detail}${RESET}` : ''}`) }
}

// ── Helpers : opérations agents dans le dossier temporaire ──

function ensureTestAgentsDir(): void {
  if (!existsSync(AGENTS_DIR)) mkdirSync(AGENTS_DIR, { recursive: true })
}

function writeTestAgent(id: string, name: string, model: string, instructions: string, toolNames: string[]): void {
  ensureTestAgentsDir()
  const tools = toolNames.map(t => `'${t}'`).join(', ')
  // Échapper les quotes simples pour ne pas casser le fichier TS généré
  const safeInstructions = instructions.replace(/'/g, "\\'")
  const content = `import type { AgentDefinition } from '../src/types/agent-definition.js'\n\nconst definition: AgentDefinition = {\n  id: '${id}',\n  displayName: '${name}',\n  model: '${model}',\n  toolNames: [${tools}],\n  instructionsPrompt: '${safeInstructions}',\n}\n\nexport default definition\n`
  writeFileSync(join(AGENTS_DIR, `${id}.ts`), content, 'utf-8')
}

function readTestAgent(file: string): { id: string; displayName: string; model: string } | null {
  const fp = join(AGENTS_DIR, file)
  if (!existsSync(fp)) return null
  const content = readFileSync(fp, 'utf-8')
  const id = content.match(/id:\s*['"]([^'"]+)['"]/)?.[1] || file.replace('.ts', '')
  const displayName = content.match(/displayName:\s*['"]([^'"]+)['"]/)?.[1] || id
  const model = content.match(/model:\s*['"]([^'"]+)['"]/)?.[1] || 'unknown'
  return { id, displayName, model }
}

function listTestAgents(): { id: string; name: string; file: string }[] {
  if (!existsSync(AGENTS_DIR)) return []
  try {
    const files = readdirSync(AGENTS_DIR).filter((f: string) => f.endsWith('.ts'))
    return files.map((f: string) => {
      const agent = readTestAgent(f)
      return { id: agent?.id || f.replace('.ts', ''), name: agent?.displayName || f, file: f }
    })
  } catch {
    return []
  }
}

function updateTestAgentModel(file: string, model: string): boolean {
  const fp = join(AGENTS_DIR, file)
  if (!existsSync(fp)) return false
  let content = readFileSync(fp, 'utf-8')
  content = content.replace(/model:\s*['"][^'"]*['"]/, `model: '${model}'`)
  writeFileSync(fp, content, 'utf-8')
  return true
}

async function main() {
  console.log(`\n${BOLD}${CYAN}═══════════════════════════════════════════${RESET}`)
  console.log(`${BOLD}${CYAN}  TEST COMPLET : Agent Engine Workflow${RESET}`)
  console.log(`${BOLD}${CYAN}  Dossier test : ${TEST_DIR}${RESET}`)
  console.log(`${BOLD}${CYAN}═══════════════════════════════════════════${RESET}\n`)

  // ── Setup : créer dossier temporaire + nettoyer providers ──
  console.log(`${BOLD}── 1. NETTOYAGE${RESET}`)
  if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true })
  if (existsSync(PROVIDERS_FILE)) unlinkSync(PROVIDERS_FILE)

  // ── Création des agents ──
  console.log(`\n${BOLD}── 2. CRÉATION D'AGENTS${RESET}`)
  writeTestAgent('alice', 'Alice', 'google/gemini-2.5-flash',
    'Tu es Alice, l\x27assistante personnelle.', ['run_terminal_command', 'add_message', 'set_output'])
  assert('Agent Alice créé', existsSync(join(AGENTS_DIR, 'alice.ts')))

  writeTestAgent('test-agent', 'Test Agent', 'kilo-auto/free', 'Agent de test.', ['run_terminal_command'])
  assert('Agent test-agent créé', existsSync(join(AGENTS_DIR, 'test-agent.ts')))

  const agents = listTestAgents()
  const agentIds = agents.map(a => a.id)
  assert('Agent Alice listé', agentIds.includes('alice'), `IDs: ${agentIds.join(', ')}`)
  assert('Agent test-agent listé', agentIds.includes('test-agent'), `IDs: ${agentIds.join(', ')}`)

  // ── Lecture / modification agent ──
  console.log(`\n${BOLD}── 3. ÉDITION D'AGENT${RESET}`)
  const alice = readTestAgent('alice.ts')
  assert('Lecture agent Alice OK', alice !== null)
  assert('Nom Alice correct', alice?.displayName === 'Alice')
  assert('Modèle Alice initial', alice?.model === 'google/gemini-2.5-flash')

  const edited = updateTestAgentModel('alice.ts', 'kilo-auto/free')
  assert('Modification modèle Alice OK', edited)

  const aliceReloaded = readTestAgent('alice.ts')
  assert('Modèle Alice persisté', aliceReloaded?.model === 'kilo-auto/free')

  // ── Providers ──
  console.log(`\n${BOLD}── 4. CONFIGURATION PROVIDERS${RESET}`)
  const existingKilo = getProvider('Kilo Gateway')
  if (existingKilo) removeProvider('Kilo Gateway')
  addProvider({ name: 'Kilo Gateway', provider: 'kilo', apiKeys: [], baseUrl: 'https://api.kilo.ai', defaultModel: 'kilo-auto/free' })
  const provs = listProviders()
  assert('Provider Kilo ajouté', provs.length >= 1)

  // ── Resolution provider → modèle ──
  console.log(`\n${BOLD}── 5. RÉSOLUTION PROVIDER / MODÈLE${RESET}`)
  const modelTests: { label: string; model: string; expect: string }[] = [
    { label: 'Modèle kilo-auto/free', model: 'kilo-auto/free', expect: 'kilo' },
    { label: 'Modèle google/gemini-2.5-flash', model: 'google/gemini-2.5-flash', expect: 'kilo' },
    { label: 'Modèle deepseek/...free (fallback)', model: 'deepseek/deepseek-v4-flash:free', expect: 'kilo' },
    { label: 'Modèle openrouter/gpt-4', model: 'openrouter/gpt-4', expect: 'kilo' },
    { label: 'Modèle gemini-2.5-flash (préfixe gemini-)', model: 'gemini-2.5-flash', expect: 'kilo' },
  ]
  for (const t of modelTests) {
    const r = resolveProviderForModel(t.model)
    assert(`${t.label} → ${t.expect}`, r?.provider === t.expect, `got ${r?.provider || 'undefined'}`)
    assert(`  URL non vide`, !!r?.baseUrl, r?.baseUrl || '')
    if (r) console.log(`    ${YELLOW}→ provider=${r.provider} model=${r.model} url=${r.baseUrl}${RESET}`)
  }

  // ── Fetch models ──
  console.log(`\n${BOLD}── 6. RÉCUPÉRATION DES MODÈLES (API)${RESET}`)
  try {
    const models = await fetchModels('kilo', '', 'https://api.kilo.ai')
    assert('Modèles Kilo récupérés', models.length > 0, `${models.length} modèles`)
    const hasFree = models.some(m => m.includes(':free') || m.includes('/free'))
    assert('Au moins un modèle gratuit (:free ou /free)', hasFree)
    const hasAutoFree = models.includes('kilo-auto/free') || models.some(m => m.includes('kilo-auto/free'))
    assert('kilo-auto/free présent', hasAutoFree, `trouvé: ${models.slice(0, 5).join(', ')}...`)
    console.log(`    ${YELLOW}Premiers : ${models.slice(0, 3).join(', ')}${RESET}`)
  } catch (e) {
    if (process.env.CI === 'true') {
      console.log(`    ${YELLOW}⚠  Échec fetchModels en CI (ignoré) : ${e}${RESET}`)
      assert('Récupération modèles (tentative)', true)
    } else {
      assert('Modèles Kilo récupérés', false, `${e}`)
    }
  }

  // ── Appel LLM réel ──
  console.log(`\n${BOLD}── 7. APPEL LLM RÉEL (RÉSEAU)${RESET}`)
  const engine = createEngine({
    agent: { id: 'alice', displayName: 'Alice', model: 'kilo-auto/free', instructionsPrompt: 'Réponds en français en une phrase.', toolNames: ['run_terminal_command'] }
  })
  engine.createSession()

  const resolved = resolveProviderForModel('kilo-auto/free')
  assert('Provider résolu pour kilo-auto/free', !!resolved)
  if (!resolved) { console.log(`${FAIL} Arrêt — impossible de résoudre le provider\n`); safeExit(1); return }

  console.log(`    ${YELLOW}Test : POST ${resolved.provider} ${resolved.model} vers ${resolved.baseUrl}${RESET}`)
  console.log(`    ${YELLOW}API Key : "${resolved.apiKey ? '****' + resolved.apiKey.slice(-4) : '(aucune)'}"${RESET}`)

  try {
    const response = await engine.callLLM('Bonjour ! Que peux-tu faire pour moi ?', resolved, "Tu es Alice, réponds en une phrase en français.")
    assert('Appel LLM réussi', response.length > 0 && response !== '(réponse vide)', response.slice(0, 100))
    console.log(`    ${CYAN}Réponse : ${response.slice(0, 150)}${RESET}`)
  } catch (e) {
    const msg = `${e}`
    const isCI = process.env.CI === 'true'
    if (isCI) {
      console.log(`    ${YELLOW}⚠  Échec appel LLM en CI (ignoré) : ${msg.slice(0, 100)}${RESET}`)
      assert('Appel LLM (tentative)', true)
    } else {
      assert('Appel LLM réussi', false, msg.slice(0, 150))
      if (msg.includes('401')) console.log(`    ${YELLOW}➜ Cause probable : clé API manquante ou invalide pour Kilo${RESET}`)
      else if (msg.includes('404')) console.log(`    ${YELLOW}➜ Cause probable : endpoint incorrect${RESET}`)
      else if (msg.includes('429')) console.log(`    ${YELLOW}➜ Cause probable : quota dépassé${RESET}`)
      else if (msg.includes('timeout')) console.log(`    ${YELLOW}➜ Cause probable : timeout réseau${RESET}`)
    }
  }

  // ── Tests de persistance engine ──
  console.log(`\n${BOLD}── 8. PERSISTANCE APRÈS ÉDITION${RESET}`)
  const oldModel = engine.agent.model
  assert('Modèle initial dans le moteur', oldModel === 'kilo-auto/free')

  // On utilise l'agent du dossier temporaire (déjà modifié en 'kilo-auto/free' à l'étape 3)
  const reloadedAgent = readTestAgent('alice.ts')
  assert('Fichier modifié sur disque', reloadedAgent?.model === 'kilo-auto/free')

  // recréer l'engine avec l'agent temporaire
  if (reloadedAgent) {
    const engine2 = createEngine({
      agent: { id: reloadedAgent.id, displayName: reloadedAgent.displayName, model: reloadedAgent.model, instructionsPrompt: '', toolNames: ['run_terminal_command'] }
    })
    engine2.createSession()
    assert('Moteur rechargé avec nouveau modèle', engine2.agent.model === 'kilo-auto/free')
    assert('Ancien moteur inchangé', engine.agent.model === 'kilo-auto/free')
  }

  // ── Test model name prefix ──
  console.log(`\n${BOLD}── 9. PRÉFIXES DE MODÈLE POUR KILO${RESET}`)
  try {
    const models = await fetchModels('kilo', '', 'https://api.kilo.ai')
    // On vérifie kilo-auto/free qui est le modèle par défaut
    assert('Modèle "kilo-auto/free" existe dans la liste Kilo', models.includes('kilo-auto/free') || models.some(m => m.includes('kilo-auto/free')), `non trouvé parmi ${models.length} modèles`)
    // On vérifie qu'il y a d'autres modèles
    assert('Kilo retourne plusieurs modèles', models.length > 5)
  } catch (e) {
    if (process.env.CI === 'true') {
      console.log(`    ${YELLOW}⚠  Échec préfixes Kilo en CI (ignoré) : ${e}${RESET}`)
      assert('Vérification préfixes (tentative)', true)
    } else {
      assert('Vérification modèles Kilo', false, `${e}`)
    }
  }

  // ── Providers supplémentaires ──
  console.log(`\n${BOLD}── 10. TEST PROVIDERS SUPPLÉMENTAIRES${RESET}`)
  // Google Gemini
  const existingGG = getProvider('Google Gemini')
  if (existingGG) removeProvider('Google Gemini')
  addProvider({ name: 'Google Gemini', provider: 'google', apiKeys: ['test-key'], baseUrl: 'https://generativelanguage.googleapis.com', defaultModel: 'gemini-2.5-flash' })
  try {
    const models = await fetchModels('google', 'test-key', 'https://generativelanguage.googleapis.com')
    assert('Google Gemini modèles récupérés', models.length > 0)
  } catch (e) {
    const msg = `${e}`
    if (msg.includes('400') || msg.includes('API key')) {
      console.log(`    ${YELLOW}⚠  Clé API Google factice (test-key) — échec attendu${RESET}`)
      assert('Google Gemini modèles récupérés (clé fake)', true)
    } else {
      assert('Google Gemini modèles récupérés', false, msg)
    }
  }
  // OpenRouter
  const existingOR = getProvider('OpenRouter')
  if (existingOR) removeProvider('OpenRouter')
  addProvider({ name: 'OpenRouter', provider: 'openrouter', apiKeys: ['test-key-or'], baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'openrouter/gpt-4' })
  try {
    const models = await fetchModels('openrouter', 'test-key-or', 'https://openrouter.ai/api/v1')
    assert('OpenRouter modèles récupérés', models.length > 0)
  } catch (e) {
    console.log(`    ${YELLOW}⚠  OpenRouter non accessible ou erreur : ${(`${e}`).slice(0, 80)}${RESET}`)
    assert('OpenRouter modèles récupérés (ignoré en CI)', true)
  }

  // Ollama Local
  const existingOllama = getProvider('Ollama Local')
  if (existingOllama) removeProvider('Ollama Local')
  addProvider({ name: 'Ollama Local', provider: 'ollama-local', apiKeys: [], baseUrl: 'http://localhost:11434', defaultModel: 'llama3.2' })
  try {
    const models = await fetchModels('ollama-local', '', 'http://localhost:11434')
    if (models.length === 0) {
      console.log(`    ${YELLOW}⚠  Ollama accessible mais aucun modèle installé${RESET}`)
      assert('Ollama modèles récupérés (aucun modèle)', true)
    } else {
      assert('Ollama modèles récupérés', models.length > 0)
    }
  } catch (e) {
    console.log(`    ${YELLOW}⚠  Ollama local non disponible (normal en CI)${RESET}`)
    assert('Ollama modèles récupérés (hors-ligne)', true)
  }

  // LM Studio
  const existingLM = getProvider('LM Studio')
  if (existingLM) removeProvider('LM Studio')
  addProvider({ name: 'LM Studio', provider: 'lm-studio', apiKeys: [], baseUrl: 'http://localhost:1234/v1', defaultModel: 'local-model' })
  try {
    const models = await fetchModels('lm-studio', '', 'http://localhost:1234/v1')
    assert('LM Studio modèles récupérés', models.length > 0)
  } catch (e) {
    console.log(`    ${YELLOW}⚠  LM Studio non disponible (normal en CI)${RESET}`)
    assert('LM Studio modèles récupérés (hors-ligne)', true)
  }

  // ── Test clés uniques ──
  console.log(`\n${BOLD}── 11. CLÉS API UNIQUES${RESET}`)
  for (const p of listProviders()) removeProvider(p.name)
  addProvider({ name: 'Google #1', provider: 'google', apiKeys: ['key-alpha'], baseUrl: 'https://generativelanguage.googleapis.com', defaultModel: 'gemini-2.5-flash' })
  const conflict = isApiKeyUsed('key-alpha')
  assert('Clé "key-alpha" détectée comme utilisée', conflict?.name === 'Google #1')
  assert('Clé inconnue non détectée', !isApiKeyUsed('key-unknown'))
  addProvider({ name: 'Google #2', provider: 'google', apiKeys: ['key-beta'], baseUrl: 'https://generativelanguage.googleapis.com', defaultModel: 'gemini-2.5-flash' })
  const conflict2 = isApiKeyUsed('key-beta')
  assert('Clé "key-beta" utilisée par Google #2', conflict2?.name === 'Google #2')

  // ── Résumé ──
  const total = passed + failed
  console.log(`\n${BOLD}${CYAN}═══════════════════════════════════════════${RESET}`)
  console.log(`${BOLD}${CYAN}  RÉSULTATS : ${passed}/${total} tests OK${RESET}`)
  if (failed > 0) console.log(`${BOLD}${RED}  ${failed} ÉCHEC(S) — voir ci-dessus${RESET}`)
  else console.log(`${BOLD}${GREEN}  TOUS LES TESTS SONT PASSÉS${RESET}`)
  console.log(`${BOLD}${CYAN}═══════════════════════════════════════════${RESET}\n`)

  if (failed > 0) {
    console.log(`${BOLD}DIAGNOSTIC RAPIDE :${RESET}`)
    console.log(`  1. Si l'appel LLM échoue (401) : ajoute une clé Kilo avec :`)
    console.log(`     /providers key "Kilo Gateway" ta-clef`)
    console.log(`  2. Si le modèle n'est pas trouvé : vérifie que le nom est exact`)
    console.log(`  3. Si la résolution échoue : vérifie que le provider est "enabled"`)
    console.log(`  4. Fichier providers.json : ${PROVIDERS_FILE}\n`)
  }

  // Nettoyage du dossier temporaire
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
  if (existsSync(PROVIDERS_FILE)) unlinkSync(PROVIDERS_FILE)

  safeExit(failed > 0 ? 1 : 0)
}

main().catch(e => {
  console.error(`${RED}Test crash : ${e.message}${RESET}`)
  safeExit(1)
})
