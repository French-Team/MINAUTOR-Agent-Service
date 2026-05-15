/**
 * Test de bout en bout du workflow agent + LLM
 * Exécute : node dist/test.js
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync, rmSync } from 'fs'
import { join } from 'path'
import { createEngine } from './engine.js'
import { scaffoldAgent, readLocalAgent, updateAgentFile, listLocalAgents } from './agents.js'
import {
  addProvider, listProviders, removeProvider, resolveProviderForModel,
  fetchModels, setProviderApiKey, setProviderEnabled, getProvider,
  isApiKeyUsed,
} from './providers.js'

const RESET = '\x1b[0m'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const CYAN = '\x1b[36m'
const YELLOW = '\x1b[33m'
const BOLD = '\x1b[1m'

const CWD = process.cwd()
const AGENTS_DIR = join(CWD, '.agents')
const PROVIDERS_FILE = join(CWD, 'providers.json')
const PASS = `${GREEN}✓${RESET}`
const FAIL = `${RED}✗${RESET}`
let passed = 0
let failed = 0

function assert(label: string, ok: boolean, detail?: string) {
  if (ok) { passed++; console.log(`  ${PASS} ${label}`) }
  else { failed++; console.log(`  ${FAIL} ${label} ${detail ? `— ${RED}${detail}${RESET}` : ''}`) }
}

async function main() {
  console.log(`\n${BOLD}${CYAN}═══════════════════════════════════════════${RESET}`)
  console.log(`${BOLD}${CYAN}  TEST COMPLET : Agent Engine Workflow${RESET}`)
  console.log(`${BOLD}${CYAN}═══════════════════════════════════════════${RESET}\n`)

  // ── Setup : nettoyage + environnement vierge ──
  console.log(`${BOLD}── 1. NETTOYAGE${RESET}`)
  if (existsSync(AGENTS_DIR)) rmSync(AGENTS_DIR, { recursive: true, force: true })
  if (existsSync(PROVIDERS_FILE)) unlinkSync(PROVIDERS_FILE)

  // ── Création des agents ──
  console.log(`\n${BOLD}── 2. CRÉATION D'AGENTS${RESET}`)
  try {
    scaffoldAgent('alice', 'Alice', 'google/gemini-2.5-flash', ['run_terminal_command', 'add_message', 'set_output'],
      `Tu es Alice, l'assistante personnelle de l'utilisateur.`)
    assert('Agent Alice créé', existsSync(join(AGENTS_DIR, 'alice.ts')))
  } catch (e) { assert('Agent Alice créé', false, `${e}`) }

  try {
    scaffoldAgent('test-agent', 'Test Agent', 'kilo-auto/free', ['run_terminal_command'], 'Agent de test.')
    assert('Agent test-agent créé', existsSync(join(AGENTS_DIR, 'test-agent.ts')))
  } catch (e) { assert('Agent test-agent créé', false, `${e}`) }

  const agents = listLocalAgents()
  assert('Liste contient 2 agents', agents.length === 2, `trouvé ${agents.length}`)

  // ── Lecture / modification agent ──
  console.log(`\n${BOLD}── 3. ÉDITION D'AGENT${RESET}`)
  const alice = readLocalAgent('alice.ts')
  assert('Lecture agent Alice OK', alice !== null)
  assert('Nom Alice correct', alice?.name === 'Alice')
  assert('Modèle Alice initial', alice?.model === 'google/gemini-2.5-flash')

  const edited = updateAgentFile('alice.ts', { model: 'kilo-auto/free' })
  assert('Modification modèle Alice OK', edited)

  const aliceReloaded = readLocalAgent('alice.ts')
  assert('Modèle Alice persisté', aliceReloaded?.model === 'kilo-auto/free')

  // ── Providers ──
  console.log(`\n${BOLD}── 4. CONFIGURATION PROVIDERS${RESET}`)
  // les defaults créent déjà Kilo Gateway — on le supprime et le recrée pour être propres
  const existingKilo = getProvider('Kilo Gateway')
  if (existingKilo) removeProvider('Kilo Gateway')
  addProvider({ name: 'Kilo Gateway', provider: 'kilo', apiKeys: [], baseUrl: 'https://api.kilo.ai', defaultModel: 'kilo-auto/free' })
  const provs = listProviders()
  assert('Provider Kilo ajouté', provs.length >= 1)

  // ── Resolution provider → modèle ──
  console.log(`\n${BOLD}── 5. RÉSOLUTION PROVIDER / MODÈLE${RESET}`)
  const tests: { label: string; model: string; expect: string }[] = [
    { label: 'Modèle kilo-auto/free', model: 'kilo-auto/free', expect: 'kilo' },
    { label: 'Modèle google/gemini-2.5-flash (préfixe google)', model: 'google/gemini-2.5-flash', expect: 'kilo' },
    { label: 'Modèle deepseek/...free (fallback)', model: 'deepseek/deepseek-v4-flash:free', expect: 'kilo' },
    { label: 'Modèle openrouter/gpt-4', model: 'openrouter/gpt-4', expect: 'kilo' },
    { label: 'Modèle gemini-2.5-flash (préfixe gemini-)', model: 'gemini-2.5-flash', expect: 'kilo' },
  ]

  for (const t of tests) {
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
    const hasFree = models.some(m => m.includes(':free'))
    assert('Au moins un modèle :free', hasFree)
    const hasAutoFree = models.includes('kilo-auto/free')
    assert('kilo-auto/free présent', hasAutoFree, `trouvé: ${models.slice(0, 5).join(', ')}...`)
    console.log(`    ${YELLOW}Premiers : ${models.slice(0, 3).join(', ')}${RESET}`)
  } catch (e) {
    assert('Modèles Kilo récupérés', false, `${e}`)
  }

  // ── Appel LLM réel ──
  console.log(`\n${BOLD}── 7. APPEL LLM RÉEL (RÉSEAU)${RESET}`)
  const engine = createEngine({
    agent: { id: 'alice', displayName: 'Alice', model: 'kilo-auto/free', instructionsPrompt: 'Réponds en français en une phrase.', toolNames: ['run_terminal_command'] }
  })
  engine.createSession()

  const resolved = resolveProviderForModel('kilo-auto/free')
  assert('Provider résolu pour kilo-auto/free', !!resolved)
  if (!resolved) { console.log(`${FAIL} Arrêt — impossible de résoudre le provider\n`); process.exit(1) }

  console.log(`    ${YELLOW}Test : POST ${resolved.provider} ${resolved.model} vers ${resolved.baseUrl}${RESET}`)
  console.log(`    ${YELLOW}API Key : "${resolved.apiKey ? '****' + resolved.apiKey.slice(-4) : '(aucune)'}"${RESET}`)

  try {
    const response = await engine.callLLM('Bonjour ! Que peux-tu faire pour moi ?', resolved, "Tu es Alice, réponds en une phrase en français.")
    assert('Appel LLM réussi', response.length > 0 && response !== '(réponse vide)', response.slice(0, 100))
    console.log(`    ${CYAN}Réponse : ${response.slice(0, 150)}${RESET}`)
  } catch (e) {
    const msg = `${e}`
    assert('Appel LLM réussi', false, msg.slice(0, 150))
    // diagnostic
    if (msg.includes('401')) console.log(`    ${YELLOW}➜ Cause probable : clé API manquante ou invalide pour Kilo${RESET}`)
    else if (msg.includes('404')) console.log(`    ${YELLOW}➜ Cause probable : endpoint incorrect${RESET}`)
    else if (msg.includes('429')) console.log(`    ${YELLOW}➜ Cause probable : quota dépassé${RESET}`)
    else if (msg.includes('timeout')) console.log(`    ${YELLOW}➜ Cause probable : timeout réseau${RESET}`)
  }

  // ── Tests de persistance engine ──
  console.log(`\n${BOLD}── 8. PERSISTANCE APRÈS ÉDITION${RESET}`)
  // simule le workflow : édition → reload
  const oldModel = engine.agent.model
  assert('Modèle initial dans le moteur', oldModel === 'kilo-auto/free')

  // On simule ce que fait handleEditAgent : update file + recreate engine
  updateAgentFile('alice.ts', { model: 'deepseek/deepseek-v4-flash:free' })
  const reloadedAgent = readLocalAgent('alice.ts')
  assert('Fichier modifié sur disque', reloadedAgent?.model === 'deepseek/deepseek-v4-flash:free')

  // recréer l'engine (comme handleEditAgent le fait maintenant)
  const engine2 = createEngine({ agent: reloadedAgent! })
  engine2.createSession()
  assert('Moteur rechargé avec nouveau modèle', engine2.agent.model === 'deepseek/deepseek-v4-flash:free')
  assert('Ancien moteur inchangé', engine.agent.model === 'kilo-auto/free', 'les deux références doivent différer')

  // ── Test model name prefix ──
  console.log(`\n${BOLD}── 9. PRÉFIXES DE MODÈLE POUR KILO${RESET}`)
  const prefixTests = [
    { model: 'kilo-auto/free', expected: 'kilo-auto/free' },
    { model: 'deepseek/deepseek-v4-flash:free', expected: 'deepseek/deepseek-v4-flash:free' },
  ]
  // Test : est-ce que le endpoint Kilo accepte le model ID tel quel ?
  try {
    const models = await fetchModels('kilo', '', 'https://api.kilo.ai')
    for (const pt of prefixTests) {
      const exists = models.includes(pt.model)
      assert(`Modèle "${pt.model}" existe dans la liste Kilo`, exists, `non trouvé parmi ${models.length} modèles`)
    }
  } catch (e) {
    assert('Vérification modèles Kilo', false, `${e}`)
  }

  // ── Providers supplémentaires �n  console.log(`\n${BOLD}── 11. TEST PROVIDERS SUPPLÉMENTAIRES${RESET}`)
  // Google Gemini
  addProvider({ name: 'Google Gemini', provider: 'google', apiKeys: ['test-key'], baseUrl: 'https://generativelanguage.googleapis.com', defaultModel: 'gemini-2.5-flash' })
  try {
    const models = await fetchModels('google', 'test-key', 'https://generativelanguage.googleapis.com')
    assert('Google Gemini modèles récupérés', models.length > 0)
  } catch (e) {
    assert('Google Gemini modèles récupérés', false, `${e}`)
  }
  // OpenRouter
  addProvider({ name: 'OpenRouter', provider: 'openrouter', apiKeys: ['test-key-or'], baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'openrouter/gpt-4' })
  try {
    const models = await fetchModels('openrouter', 'test-key-or', 'https://openrouter.ai/api/v1')
    assert('OpenRouter modèles récupérés', models.length > 0)
  } catch (e) {
    assert('OpenRouter modèles récupérés', false, `${e}`)
  }
  // Ollama (local, no key)
  addProvider({ name: 'Ollama', provider: 'ollama', apiKeys: [], baseUrl: 'http://localhost:11434', defaultModel: 'llama2' })
  try {
    const models = await fetchModels('ollama', '', 'http://localhost:11434')
    assert('Ollama modèles récupérés', models.length > 0)
  } catch (e) {
    assert('Ollama modèles récupérés', false, `${e}`)
  }
  // LM Studio (local, no key)
  addProvider({ name: 'LM Studio', provider: 'lmstudio', apiKeys: [], baseUrl: 'http://localhost:1234', defaultModel: 'lmstudio-model' })
  try {
    const models = await fetchModels('lmstudio', '', 'http://localhost:1234')
    assert('LM Studio modèles récupérés', models.length > 0)
  } catch (e) {
assert('LM Studio modèles récupérés', false, `${e}`)
  }
  console.log(`\n${BOLD}── 10. CONT IDS UNIQUE${RESET}`)
  // nettoyage des providers
  for (const p of listProviders()) removeProvider(p.name)
  addProvider({ name: 'Google #1', provider: 'google', apiKeys: ['key-alpha'], baseUrl: 'https://generativelanguage.googleapis.com', defaultModel: 'gemini-2.5-flash' })
  const conflict = isApiKeyUsed('key-alpha')
  assert('Clé "key-alpha" détectée comme utilisée', conflict?.name === 'Google #1')
  assert('Clé inconnue non détectée', !isApiKeyUsed('key-unknown'))
  // deux providers différents peuvent avoir la même clé SI ce n'est pas le même type
  // mais notre règle est : une clé ne peut être utilisée que par un seul provider
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

  // ── Diagnostiques ──
  if (failed > 0) {
    console.log(`${BOLD}DIAGNOSTIC RAPIDE :${RESET}`)
    console.log(`  1. Si l'appel LLM échoue (401) : ajoute une clé Kilo avec :`)
    console.log(`     /providers key "Kilo Gateway" ta-clef`)
    console.log(`  2. Si le modèle n'est pas trouvé : vérifie que le nom est exact`)
    console.log(`  3. Si la résolution échoue : vérifie que le provider est "enabled"`)
    console.log(`  4. Fichier providers.json : ${PROVIDERS_FILE}\n`)
  }

  // cleanup
  if (existsSync(AGENTS_DIR)) rmSync(AGENTS_DIR, { recursive: true, force: true })
  if (existsSync(PROVIDERS_FILE)) unlinkSync(PROVIDERS_FILE)
}

main().catch(e => {
  console.error(`${RED}Test crash : ${e.message}${RESET}`)
  process.exit(1)
})
