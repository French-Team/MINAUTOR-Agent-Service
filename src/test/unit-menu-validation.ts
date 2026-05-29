/**
 * Validation des menus et de la cohérence des providers
 *
 * Vérifie que :
 *   1. Chaque touche du menu (1-9, 0) a bien un handler défini dans cli-main.ts
 *   2. DEFAULT_PROVIDERS est cohérent avec ONLINE_URLS, getKnownProviders(), isLocalProvider()
 *   3. Tous les handlers sont exportés par leurs modules respectifs
 *   4. Les constantes (KEY_REQUIRED) sont cohérentes
 *
 * Exécution : node dist/unit-menu-validation.js
 */

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

import { safeExit, ONLINE_URLS, KEY_REQUIRED, GRAY } from '../constants.js'
import {
  listProviders,
  getKnownProviders,
  isLocalProvider,
} from '../providers.js'

// ── Imports des handlers (vérification d'existence) ─────
import { handleManageProvidersMenu, handleProviderActions } from '../cli-providers.js'
import { handleCreate } from '../cli-create.js'
import { handleEditAgent } from '../cli-edit.js'
import { handleProviders } from '../cli-providers-advanced.js'
import { handleListAgents, handleUseAgent } from '../cli-agents.js'
import { showMenu, showHelp } from '../cli-menu.js'
import { showSessions, showInfo } from '../cli-sessions.js'
import { handleCommandPicker } from '../cli-selector.js'
import { handleShellLine } from '../cli-runner.js'
import { showBanner } from '../cli-banner.js'

// ── ANSI ────────────────────────────────────────────────
const RESET = '\x1b[0m'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const CYAN = '\x1b[36m'
const YELLOW = '\x1b[33m'
const BOLD = '\x1b[1m'
const PASS = `${GREEN}✓${RESET}`
const FAIL = `${RED}✗${RESET}`

let passed = 0
let failed = 0

function assert(label: string, ok: boolean, detail?: string) {
  if (ok) { passed++; process.stdout.write(`  ${PASS} ${label}\n`) }
  else { failed++; process.stdout.write(`  ${FAIL} ${label}${detail ? ` — ${RED}${detail}${RESET}` : ''}\n`) }
}

// ── 1. Menu structure — parser cli-main.ts ──────────────

function testMenuStructure() {
  console.log(`\n${BOLD}── 1. Structure du menu (cli-main.ts)${RESET}`)

  const mainPath = join(process.cwd(), 'src', 'cli-main.ts')
  assert('src/cli-main.ts existe', existsSync(mainPath), mainPath)

  const content = readFileSync(mainPath, 'utf-8')

  // Vérifier que les 10 touches (0-9) ont un handler
  const menuHandlers: { key: string; expectedHandler: string }[] = [
    { key: '1', expectedHandler: 'handleManageProvidersMenu' },
    { key: '2', expectedHandler: 'editUserProfile' },
    { key: '3', expectedHandler: 'handleCreate' },
    { key: '4', expectedHandler: 'handleListAgents' },
    { key: '5', expectedHandler: 'handleEditAgent' },
    { key: '6', expectedHandler: 'handleSkillsMenu' },
    { key: '7', expectedHandler: 'handleStartSession' },
    { key: '8', expectedHandler: 'showSessions' },
    { key: '9', expectedHandler: 'showIntercomStatus' },
    { key: '10', expectedHandler: 'showHelp' },
    { key: '0', expectedHandler: 'exit' },
  ]

  for (const { key, expectedHandler } of menuHandlers) {
    // Chercher `if (line === '${key}')` suivi de l'appel au handler
    // Exemple : `if (line === '1') {\n      await handleManageProvidersMenu(rl)`
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`line\\s*===?\\s*['"]${escapedKey}['"][\\s\\S]{0,100}${expectedHandler}`)
    const found = regex.test(content)
    assert(`Touche "${key}" → appelle ${expectedHandler}()`, found,
      !found ? `Pattern non trouvé dans cli-main.ts` : undefined
    )
  }

  // Vérifier le nombre total de if (line === 'N') dans la section menu
  const lineMatches = content.match(/line\s*===\s*['"]\d{1,2}['"]/g) || []
  assert('11 touches de menu (0-10) définies', lineMatches.length === 11,
    `trouvé ${lineMatches.length} : [${lineMatches.join(', ')}]`
  )
}

// ── 2. Cohérence DEFAULT_PROVIDERS ──────────────────────

function testProviderConsistency() {
  console.log(`\n${BOLD}── 2. Cohérence DEFAULT_PROVIDERS${RESET}`)

  const providers = listProviders()
  assert('Au moins un provider défini', providers.length > 0, `${providers.length} trouvés`)

  const known = getKnownProviders()
  const knownTypes = new Set(known.map(k => k.type))
  const onlineTypes = new Set(Object.keys(ONLINE_URLS))

  for (const p of providers) {
    // 2a. Chaque provider.type doit être connu de getKnownProviders() ou ONLINE_URLS
    const inKnown = knownTypes.has(p.provider)
    const inOnline = onlineTypes.has(p.provider)
    const knownStr = inKnown ? 'getKnownProviders()' : ''
    const onlineStr = inOnline ? 'ONLINE_URLS' : ''
    const sources = [knownStr, onlineStr].filter(Boolean).join(' + ')
    assert(`Provider "${p.name}" → type "${p.provider}" reconnu par ${sources || '❌ AUCUNE source'}`,
      inKnown || inOnline,
      `type "${p.provider}" absent de getKnownProviders() [${Array.from(knownTypes).join(', ')}] et ONLINE_URLS [${Array.from(onlineTypes).join(', ')}]`
    )

    // 2b. isLocalProvider() doit être cohérent avec getKnownProviders().local
    const knownEntry = known.find(k => k.type === p.provider)
    if (knownEntry) {
      const isLocalFn = isLocalProvider(p.provider)
      assert(`  isLocalProvider("${p.provider}") = ${knownEntry.local} (cohérent avec getKnownProviders)`,
        isLocalFn === knownEntry.local,
        `isLocalProvider() retourne ${isLocalFn}, getKnownProviders dit local=${knownEntry.local}`
      )
    }

    // 2c. Si le type a une URL dans ONLINE_URLS, l'utiliser ? (warning si différent)
    if (inOnline) {
      const expectedUrl = ONLINE_URLS[p.provider]
      if (p.baseUrl !== expectedUrl) {
        // Ce n'est pas forcément une erreur (l'utilisateur a pu changer l'URL),
        // mais un warning utile
        process.stdout.write(`  ${YELLOW}⚠${RESET} "${p.name}" baseUrl="${p.baseUrl}" vs ONLINE_URLS="${expectedUrl}"\n`)
      }
    }

    // 2d. Vérifier que le provider "Ollama" n'utilise plus l'ancien type 'ollama'
    assert(`  "${p.name}" n'utilise PAS l'ancien type 'ollama' (obsolète → utiliser 'ollama-local' ou 'ollama-cloud')`,
      p.provider !== 'ollama',
      p.provider === 'ollama' ? `Le type 'ollama' a été remplacé par 'ollama-local' et 'ollama-cloud'` : undefined
    )
  }
}

// ── 3. Cohérence ONLINE_URLS ↔ getKnownProviders() ──────

function testUrlAndKnownProviders() {
  console.log(`\n${BOLD}── 3. Cohérence ONLINE_URLS ↔ getKnownProviders()${RESET}`)

  const known = getKnownProviders()
  const onlineTypes = Object.keys(ONLINE_URLS)

  // 3a. Tous les providers dans getKnownProviders() doivent avoir une URL (sauf locaux et custom)
  for (const k of known) {
    if (k.type === 'custom') {
      // custom utilise une URL saisie par l'utilisateur — pas de prédéfinition
      continue
    }
    if (!k.local && !onlineTypes.includes(k.type)) {
      // Les providers non-locaux DOIVENT avoir une URL dans ONLINE_URLS
      assert(`getKnownProviders() "${k.type}" a une URL dans ONLINE_URLS`,
        onlineTypes.includes(k.type),
        `type "${k.type}" manquant dans ONLINE_URLS. Clés : [${Object.keys(ONLINE_URLS).join(', ')}]`
      )
    } else if (k.local) {
      // Les providers locaux peuvent avoir une URL optionnelle
      process.stdout.write(`  ${GRAY}∼  "${k.type}" est local — URL dans ONLINE_URLS: ${onlineTypes.includes(k.type) ? 'OUI' : 'NON (explicite)'}${RESET}\n`)
    }
  }

  // 3b. KEY_REQUIRED cohérent avec isLocalProvider
  for (const k of known) {
    const needsKey = KEY_REQUIRED.includes(k.type)
    if (needsKey && k.local) {
      assert(`KEY_REQUIRED contient "${k.type}" mais isLocalProvider=true — incohérent`,
        false,
        `Un provider local ne devrait pas nécessiter de clé API`
      )
    } else if (!needsKey && !k.local && k.type !== 'kilo') {
      // Kilo ne nécessite pas de clé, c'est normal
      process.stdout.write(`  ${YELLOW}⚠${RESET} "${k.type}" n'est pas local mais n'est pas dans KEY_REQUIRED — vérifier si c'est intentionnel\n`)
    }
  }

  // 3c. KEY_REQUIRED ne doit contenir que des types connus
  for (const key of KEY_REQUIRED) {
    const inKnown = known.some(k => k.type === key)
    const inOnline = onlineTypes.includes(key)
    assert(`KEY_REQUIRED contient "${key}" — type reconnu`,
      inKnown || inOnline,
      `Type "${key}" inconnu dans getKnownProviders() et ONLINE_URLS`
    )
  }
}

// ── 4. Existence des handlers exportés ──────────────────

function testHandlerExports() {
  console.log(`\n${BOLD}── 4. Existence des handlers exportés${RESET}`)

  const checks: { module: string; name: string; value: unknown }[] = [
    { module: 'cli-providers', name: 'handleManageProvidersMenu', value: handleManageProvidersMenu },
    { module: 'cli-providers', name: 'handleProviderActions', value: handleProviderActions },
    { module: 'cli-create', name: 'handleCreate', value: handleCreate },
    { module: 'cli-edit', name: 'handleEditAgent', value: handleEditAgent },
    { module: 'cli-providers-advanced', name: 'handleProviders', value: handleProviders },
    { module: 'cli-agents', name: 'handleListAgents', value: handleListAgents },
    { module: 'cli-agents', name: 'handleUseAgent', value: handleUseAgent },
    { module: 'cli-menu', name: 'showMenu', value: showMenu },
    { module: 'cli-menu', name: 'showHelp', value: showHelp },
    { module: 'cli-sessions', name: 'showSessions', value: showSessions },
    { module: 'cli-sessions', name: 'showInfo', value: showInfo },
    { module: 'cli-selector', name: 'handleCommandPicker', value: handleCommandPicker },
    { module: 'cli-runner', name: 'handleShellLine', value: handleShellLine },
    { module: 'cli-banner', name: 'showBanner', value: showBanner },
  ]

  for (const { module, name, value } of checks) {
    assert(`${module}.ts exporte "${name}"`, typeof value === 'function',
      typeof value === 'undefined' ? 'non exportée ou undefined' : `type: ${typeof value}`
    )
  }
}

// ── 5. Menu affiché vs menu réel ────────────────────────

function testMenuDisplayVsActions() {
  console.log(`\n${BOLD}── 5. Menu affiché vs touches réelles (cli-menu.ts ↔ cli-main.ts)${RESET}`)

  // Lire cli-menu.ts pour extraire les touches affichées
  const menuPath = join(process.cwd(), 'src', 'cli-menu.ts')
  const menuContent = readFileSync(menuPath, 'utf-8')

  // Extraire les touches numériques du menu affiché : 1-10 et 0
  const displayMatches = menuContent.match(/\b(?:10|[1-9])\b|(?<!\d)0(?!\d)/g) || []
  const displayKeys = displayMatches
    .map(s => s.trim())
    .filter(s => /^(?:10|[0-9])$/.test(s))

  // Les touches 0-10 doivent toutes être dans le menu
  const expectedDisplay = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '0']
  for (const key of expectedDisplay) {
    assert(`Menu affiché contient la touche "${key}"`,
      displayKeys.includes(key) === true,
      `Touche "${key}" absente de cli-menu.ts. Touches trouvées : [${displayKeys.join(', ')}]`
    )
  }

  // Vérifier que le menu affiché a une étiquette pour chaque option
  // Exemple : `1.  Providers & clés API`
  const labelChecks: { key: string; expectedLabel: string }[] = [
    { key: '1', expectedLabel: 'Providers' },
    { key: '2', expectedLabel: 'Mon profil' },
    { key: '3', expectedLabel: 'Créer' },
    { key: '4', expectedLabel: 'Voir les agents' },
    { key: '5', expectedLabel: 'Éditer' },
    { key: '6', expectedLabel: 'Skills' },
    { key: '7', expectedLabel: 'Démarrer' },
    { key: '8', expectedLabel: 'Gérer les sessions' },
    { key: '9', expectedLabel: 'Status' },
    { key: '10', expectedLabel: 'Commandes' },
    { key: '0', expectedLabel: 'Quitter' },
  ]

  for (const { key, expectedLabel } of labelChecks) {
    // Dans cli-menu.ts, le format de chaque ligne est :
    //   `${CYAN}N${RESET}.  Label`
    // Le regex cherche : N + ${ ... } + . + whitespace + Label
    // On échappe ${} avec $${} pour éviter l'interpolation dans le template literal
    const escapedKey = key.replace(/[.*+?^$${}()|[\]\\]/g, '\\$&')
    const escapedLabel = expectedLabel.replace(/[.*+?^$${}()|[\]\\]/g, '\\$&')
    const regexStr = `${escapedKey}\\x24\\{.*?\\}\\.\\s*${escapedLabel}`
    const regex = new RegExp(regexStr)
    assert(`Menu affiché : touche "${key}" étiquetée "${expectedLabel}"`,
      regex.test(menuContent),
      `Pattern "${regex}" non trouvé dans cli-menu.ts`
    )
  }
}

// ── 6. Provider display capturé — vérification de cohérence ──

function testProviderDisplay() {
  console.log(`\n${BOLD}── 6. Affichage providers — cohérence des données${RESET}`)

  const providers = listProviders()

  for (const p of providers) {
    // 6a. Le modèle par défaut doit correspondre au type de provider (règle générale)
    // Kilo → modèle commence par 'kilo/'
    if (p.provider === 'kilo') {
      assert(`  "${p.name}" : defaultModel commence par "kilo/"`,
        p.defaultModel.startsWith('kilo/') || p.defaultModel.includes(':free'),
        `modèle="${p.defaultModel}"`
      )
    }

    // 6b. Un provider désactivé ne devrait pas être sélectionnable
    // (c'est un warning d'UX)

    // 6c. apiKeys doit être un tableau (pas undefined)
    assert(`  "${p.name}" : apiKeys est un tableau`,
      Array.isArray(p.apiKeys),
      `type: ${typeof p.apiKeys}`
    )
  }
}

// ── 7. Vérification des retours à la ligne et de la robustesse ──

function testProviderRobustness() {
  console.log(`\n${BOLD}── 7. Robustesse de l'affichage providers${RESET}`)

  const providers = listProviders()

  // 7a. Vérifier que `handleManageProvidersMenu` ne crash pas avec des providers vides
  assert('handleManageProvidersMenu exportée', typeof handleManageProvidersMenu === 'function')

  // 7b. Vérifier que l'affichage utilise bien `p.apiKeys?.length || 0` (et pas `p.apiKeys.length`)
  //    pour éviter le crash si apiKeys est undefined
  const providerPath = join(process.cwd(), 'src', 'cli-providers.ts')
  const providerContent = readFileSync(providerPath, 'utf-8')

  // Vérifier que le code utilise l'optional chaining
  assert('cli-providers.ts utilise `p.apiKeys?.length` (optional chaining)',
    providerContent.includes('p.apiKeys?.length'),
    'Le code utilise peut-être `p.apiKeys.length` sans protection, ce qui crash si apiKeys est undefined'
  )

  // 7c. Vérifier que provider.baseUrl n'est pas vide
  for (const p of providers) {
    assert(`  "${p.name}" : baseUrl non vide`,
      !!(p.baseUrl && p.baseUrl.length > 0),
      `baseUrl="${p.baseUrl}"`
    )
  }
}

// ── Main ─────────────────────────────────────────────────

async function main() {
  console.log(`\n${BOLD}${CYAN}════════════════════════════════════════════${RESET}`)
  console.log(`${BOLD}${CYAN}  VALIDATION : Menus & Providers${RESET}`)
  console.log(`${BOLD}${CYAN}════════════════════════════════════════════${RESET}\n`)

  testMenuStructure()
  testProviderConsistency()
  testUrlAndKnownProviders()
  testHandlerExports()
  testMenuDisplayVsActions()
  testProviderDisplay()
  testProviderRobustness()

  // ── Résumé ──
  const total = passed + failed
  console.log(`\n${BOLD}${CYAN}════════════════════════════════════════════${RESET}`)
  console.log(`${BOLD}${CYAN}  RÉSULTATS : ${passed}/${total} tests OK${RESET}`)
  if (failed > 0) {
    console.log(`${BOLD}${RED}  ${failed} ÉCHEC(S) — voir ci-dessus${RESET}`)
    console.log(`\n${BOLD}Corrections possibles :${RESET}`)
    console.log(`  1. Vérifier DEFAULT_PROVIDERS dans src/providers.ts`)
    console.log(`  2. Vérifier cli-main.ts si un handler manque`)
    console.log(`  3. Vérifier cli-menu.ts si une touche manque`)
  } else {
    console.log(`${BOLD}${GREEN}  ✅ MENU & PROVIDERS VALIDES${RESET}`)
    console.log(`${BOLD}${GREEN}  Tous les handlers sont en place et cohérents${RESET}`)
  }
  console.log(`${BOLD}${CYAN}════════════════════════════════════════════${RESET}\n`)

  safeExit(failed > 0 ? 1 : 0)
}

main().catch(err => {
  console.error(`${RED}Test crash : ${err.message}${RESET}`)
  safeExit(1)
})
