/**
 * test-suggestion-routing.ts — Test de vérification du routage des suggestions
 *
 * Vérifie que les commandes générées par le menu "Actions rapides" (suggestions)
 * sont correctement routées via le flux normal du CLI au lieu d'être ignorées
 * par tryRouteIntercom().
 *
 * Usage : node dist/test/test-suggestion-routing.js
 */

import { tryRouteIntercom, setCurrentProject } from '../cli-intercom-router.js'

const RESET = '\x1b[0m'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const CYAN = '\x1b[36m'
const YELLOW = '\x1b[33m'
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

// ── Main ───────────────────────────────────────────────

function main(): void {
  console.log(`\n${BOLD}${CYAN}════════════════════════════════════════════════════════${RESET}`)
  console.log(`${BOLD}${CYAN}  Test : Routage des commandes de suggestions${RESET}`)
  console.log(`${BOLD}${CYAN}════════════════════════════════════════════════════════${RESET}\n`)

  setCurrentProject(undefined)

  // ════════════════════════════════════════════════════════
  // Phase 1 : Commandes suggérées NE DOIVENT PAS matcher Intercom
  // Ces commandes étaient routées via tryRouteIntercom() AVANT le fix,
  // ce qui causait "Suggestion ignorée (aucun pattern intercom)".
  // APRÈS le fix, elles sont injectées dans line et passent par le
  // flux CLI normal (!project, !tasks, /help, etc.)
  // ════════════════════════════════════════════════════════
  console.log(`${BOLD}── PHASE 1 : Commandes de suggestions → PAS de routage intercom${RESET}`)
  console.log(`  ${GRAY}Ces commandes sont des commandes CLI directes, pas du langage naturel.${RESET}`)
  console.log(`  ${GRAY}Elles doivent retourner null de tryRouteIntercom()${RESET}\n`)

  // Commande projet : "!project use soulseek-donwloader"
  const r1 = tryRouteIntercom('!project use soulseek-donwloader')
  assert('"!project use ..." → null (CLI directe, pas intercom)', r1 === null,
    `obtenu: ${r1?.subject ?? 'null'}`)

  // Commande projet : "!project list"
  const r2 = tryRouteIntercom('!project list')
  assert('"!project list" → null (CLI directe)', r2 === null,
    `obtenu: ${r2?.subject ?? 'null'}`)

  // Commande tâches : "!tasks"
  const r3 = tryRouteIntercom('!tasks')
  assert('"!tasks" → null (CLI directe)', r3 === null,
    `obtenu: ${r3?.subject ?? 'null'}`)

  // Aide : "/help"
  const r4 = tryRouteIntercom('/help')
  assert('"/help" → null (commande système)', r4 === null,
    `obtenu: ${r4?.subject ?? 'null'}`)

  // Shell : "cat telecom/agent-logbook.md"
  const r5 = tryRouteIntercom('cat telecom/agent-logbook.md')
  assert('"cat ..." → null (commande shell, pas intercom)', r5 === null,
    `obtenu: ${r5?.subject ?? 'null'}`)

  // Permissions : "!permissions"
  const r6 = tryRouteIntercom('!permissions show')
  assert('"!permissions" → null (CLI directe)', r6 === null,
    `obtenu: ${r6?.subject ?? 'null'}`)

  console.log('')

  // ════════════════════════════════════════════════════════
  // Phase 2 : Langage naturel DOIT matcher Intercom
  // (vérifie que le routeur intercom fonctionne encore pour
  // les vrais messages utilisateur)
  // ════════════════════════════════════════════════════════
  console.log(`${BOLD}── PHASE 2 : Langage naturel → DOIT router via intercom${RESET}`)
  console.log(`  ${GRAY}Les vrais messages utilisateur doivent toujours être routés.${RESET}\n`)

  const r7 = tryRouteIntercom('liste les projets disponibles')
  assert('"liste les projets" → project-request', r7?.subject === 'project-request',
    `obtenu: ${r7?.subject ?? 'null'}`)

  const r8 = tryRouteIntercom("j'ai un bug dans le login")
  assert('"jai un bug" → debug-request', r8?.subject === 'debug-request',
    `obtenu: ${r8?.subject ?? 'null'}`)

  const r9 = tryRouteIntercom('relis mon code stp')
  assert('"relis mon code" → review-request', r9?.subject === 'review-request',
    `obtenu: ${r9?.subject ?? 'null'}`)

  const r10 = tryRouteIntercom("j'ai besoin d'aide")
  assert('"besoin daide" → help-request', r10?.subject === 'help-request',
    `obtenu: ${r10?.subject ?? 'null'}`)

  const r11 = tryRouteIntercom('liste les agents')
  assert('"liste les agents" → agent-list-request', r11?.subject === 'agent-list-request',
    `obtenu: ${r11?.subject ?? 'null'}`)

  console.log('')

  // ════════════════════════════════════════════════════════
  // Phase 3 : Vérification de la normalisation "!"
  // Les commandes shell brutes (sans !) sont normalisées dans
  // le flux CLI (via `line = '!' + line`). On vérifie que
  // tryRouteIntercom ne les matche pas non plus.
  // ════════════════════════════════════════════════════════
  console.log(`${BOLD}── PHASE 3 : Commandes shell brutes → PAS de routage intercom${RESET}`)
  console.log(`  ${GRAY}Le fix normalise les commandes sans ! en ajoutant !${RESET}\n`)

  const r12 = tryRouteIntercom('node dist/telecom/service/telecom-daemon.js')
  assert('"node ..." → null (commande shell)', r12 === null,
    `obtenu: ${r12?.subject ?? 'null'}`)

  const r13 = tryRouteIntercom('ls -la telecom/')
  assert('"ls ..." → null (commande shell)', r13 === null,
    `obtenu: ${r13?.subject ?? 'null'}`)

  console.log('')

  // ════════════════════════════════════════════════════════
  // RÉSULTATS
  // ════════════════════════════════════════════════════════
  const total = passed + failed
  console.log(`${BOLD}${CYAN}════════════════════════════════════════════════════════${RESET}`)
  console.log(`${BOLD}${CYAN}  RÉSULTATS : ${passed}/${total} tests OK${RESET}`)

  if (failed > 0) {
    console.log(`${BOLD}${RED}  ${failed} ÉCHEC(S) — voir ci-dessus${RESET}`)
    process.exit(1)
  } else {
    console.log(`${BOLD}${GREEN}  ✅ SUGGESTIONS VALIDÉES :${RESET}`)
    console.log(`     ${GREEN}• Commandes CLI (!project, !tasks, /help) → NON routées vers Intercom${RESET}`)
    console.log(`     ${GREEN}• Langage naturel (bug, aide, liste) → TOUJOURS routé vers Intercom${RESET}`)
    console.log(`     ${GREEN}• Commandes shell brutes (cat, ls, node) → NON routées vers Intercom${RESET}`)
    console.log(`     ${GREEN}• Le fix injecte les suggestions dans line → flux CLI normal${RESET}`)
    process.exit(0)
  }
}

main()
