/**
 * intercom-routing-thresholds.ts — Test E2E des seuils minMatch=2
 *
 * Vérifie que les nouveaux seuils (Phase 8) réduisent les faux positifs
 * sans casser les vrais positifs.
 *
 * Usage : node dist/test/intercom-routing-thresholds.js
 *
 * Ce qui est testé :
 *   1. FAUX POSITIFS (minMatch=2) → 1 seul mot-clé → NE DOIT PAS router
 *   2. VRATS POSITIFS (minMatch=2) → 2+ mots-clés → DOIT router
 *   3. PATIENTS inchangés (minMatch=1) → toujours 1 mot-clé = route
 *   4. AUCUN MATCH → messages neutres → null
 */

import { existsSync, unlinkSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tryRouteIntercom, setCurrentProject } from '../cli-intercom-router.js'

// ── Constants ──────────────────────────────────────────

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

const INTERCOM_DIR = join(process.cwd(), 'telecom', 'intercom')

function assert(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed++
    console.log(`  ${PASS} ${label}`)
  } else {
    failed++
    console.log(`  ${FAIL} ${label}${detail ? ` — ${RED}${detail}${RESET}` : ''}`)
  }
}

function assertRoute(label: string, result: ReturnType<typeof tryRouteIntercom>, expectedSubject: string | null, message?: string): void {
  const actualSubject = result?.subject ?? null
  const ok = actualSubject === expectedSubject
  const detail = message || `attendu: ${expectedSubject ?? 'null'}, obtenu: ${actualSubject ?? 'null'}`
  assert(label, ok, detail)
}

// ── Nettoyage des fichiers intercom créés par le test ──

function cleanupIntercomFiles(): void {
  if (!existsSync(INTERCOM_DIR)) return
  const files = readdirSync(INTERCOM_DIR).filter(f => f.endsWith('.json'))
  for (const f of files) {
    try {
      const content = readFileSync(join(INTERCOM_DIR, f), 'utf-8')
      const msg = JSON.parse(content) as { payload?: { demande?: string }; subject?: string }
      if (msg.payload?.demande?.includes('[THRESHOLD]')) {
        unlinkSync(join(INTERCOM_DIR, f))
      }
    } catch { /* fichier verrouillé ou supprimé */ }
  }
}

// ── Main ───────────────────────────────────────────────

function main(): void {
  console.log(`\n${BOLD}${CYAN}══════════════════════════════════════════════════════════════${RESET}`)
  console.log(`${BOLD}${CYAN}  E2E : Seuils minMatch=2 — Vérification des faux positifs${RESET}`)
  console.log(`${BOLD}${CYAN}══════════════════════════════════════════════════════════════${RESET}\n`)

  try {
    // Réinitialiser le projet courant pour éviter les interférences
    setCurrentProject(undefined)

    // ════════════════════════════════════════════════════════
    // PHASE 1 : FAUX POSITIFS — minMatch=2 → 1 seul mot-clé
    // Ces messages NE DOIVENT PLUS router depuis le changement
    // de minMatch de 1 → 2 (Phase 8)
    // ════════════════════════════════════════════════════════
    console.log(`${BOLD}── PHASE 1 : FAUX POSITIFS (minMatch=2, 1 mot-clé seulement)${RESET}`)
    console.log(`  ${GRAY}Ces messages matchent 1 seul mot-clé : minMatch=2 → ne doivent PAS router${RESET}\n`)

    // P2 analysis-request : "vérifie l'heure" → seulement "vérifie" (1/2)
    const r1 = tryRouteIntercom("vérifie [THRESHOLD] l'heure qu'il est")
    assertRoute('"vérifie l\'heure" — analysis-request (1/2) → null', r1, null)

    // P2 analysis-request : "regarde ça" → seulement "regarde" (1/2)
    const r2 = tryRouteIntercom('regarde [THRESHOLD] ce truc')
    assertRoute('"regarde ça" — analysis-request (1/2) → null', r2, null)

    // P4 create-request : "fais le ménage" → seulement "fais" (1/12)
    const r3 = tryRouteIntercom('fais [THRESHOLD] le ménage')
    assertRoute('"fais le ménage" — create-request (1/12) → null', r3, null)

    // P4 create-request : "code la vie" → seulement "code" (1/12)
    const r4 = tryRouteIntercom('code [THRESHOLD] la vie en python')
    assertRoute('"code la vie" — create-request (1/12) → null', r4, null)

    // P6 advice-request : "j'ai une idée" → seulement "idée" (1/6)
    const r5 = tryRouteIntercom("j'ai une [THRESHOLD] idée pour le weekend")
    assertRoute('"j\'ai une idée" — advice-request (1/6) → null', r5, null)

    // P6 advice-request : "donne moi un conseil" → seulement "conseil" (1/6)
    const r6 = tryRouteIntercom('donne moi un [THRESHOLD] conseil')
    assertRoute('"donne moi un conseil" — advice-request (1/6) → null', r6, null)

    // P9 project-request : "ce projet est cool" → seulement "projet" (1/4)
    const r7 = tryRouteIntercom('ce [THRESHOLD] projet est intéressant')
    assertRoute('"ce projet est intéressant" — project-request (1/4) → null', r7, null)

    // P8 agent-list-request : "liste des agents" → seulement "liste" (1/9)
    // Note : P8 avait déjà minMatch=2 (inchangé)
    const r8 = tryRouteIntercom('donne moi la [THRESHOLD] liste')
    assertRoute('"donne moi la liste" — agent-list (1/9) → null', r8, null)

    console.log('')

    // ════════════════════════════════════════════════════════
    // PHASE 2 : VRATS POSITIFS — minMatch=2 → 2+ mots-clés
    // Ces messages DOIVENT router car ils matchent assez de mots-clés
    // ════════════════════════════════════════════════════════
    console.log(`${BOLD}── PHASE 2 : VRATS POSITIFS (minMatch=2, 2+ mots-clés)${RESET}`)
    console.log(`  ${GRAY}Ces messages matchent ≥ 2 mots-clés : minMatch=2 → DOIVENT router${RESET}\n`)

    // P2 analysis-request : "vérifie et analyse" → "vérifie"+"analyse" (2/2)
    const r9 = tryRouteIntercom('vérifie et [THRESHOLD] analyse ce code')
    assertRoute('"vérifie et analyse" — 2/2 → analysis-request', r9, 'analysis-request')

    // P2 analysis-request : "diagnostic inspecte" → "diagnostic"+"inspecte" (2/2)
    const r10 = tryRouteIntercom('fais un [THRESHOLD] diagnostic et inspecte le système')
    assertRoute('"diagnostic inspecte" — 2/2 → analysis-request', r10, 'analysis-request')

    // P4 create-request : "crée et implémente" → "crée"+"implémente" (2/12)
    const r11 = tryRouteIntercom('[THRESHOLD] crée et implémente une nouvelle fonctionnalité')
    assertRoute('"crée et implémente" — 2/2 → create-request', r11, 'create-request')

    // P4 create-request : "code et génère" → "code"+"génère" (2/12)
    const r12 = tryRouteIntercom('[THRESHOLD] code et génère un module')
    assertRoute('"code et génère" — 2/2 → create-request', r12, 'create-request')

    // P4 create-request : "développe et fabrique" → "développe"+"fabrique" (2/12)
    const r13 = tryRouteIntercom('[THRESHOLD] développe et fabrique un prototype')
    assertRoute('"développe et fabrique" — 2/2 → create-request', r13, 'create-request')

    // P6 advice-request : "idée suggestion" → "idée"+"suggestion" (2/6)
    const r14 = tryRouteIntercom("j'ai une [THRESHOLD] idée et une suggestion")
    assertRoute('"idée suggestion" — 2/2 → advice-request', r14, 'advice-request')

    // P6 advice-request : "avis meilleur" → "avis"+"meilleur" (2/6)
    const r15 = tryRouteIntercom("donne moi ton [THRESHOLD] avis sur la meilleure approche")
    assertRoute('"avis meilleur" — 2/2 → advice-request', r15, 'advice-request')

    // P9 project-request : "projet workspace" → "projet"+"workspace" (2/4)
    const r16 = tryRouteIntercom("j'ai un nouveau [THRESHOLD] projet dans le workspace")
    assertRoute('"projet workspace" — 2/2 → project-request', r16, 'project-request')

    // P8 agent-list-request : "liste agents disponibles" → "liste"+"agent"+"disponible" (3/10)
    // Note : P8 avait déjà minMatch=2 (inchangé) — vérifie que le seuil est respecté
    const r17 = tryRouteIntercom('[THRESHOLD] liste des agents disponibles')
    assertRoute('"liste des agents disponibles" — 3/2 → agent-list-request', r17, 'agent-list-request')

    console.log('')

    // ════════════════════════════════════════════════════════
    // PHASE 3 : PATIENTS INCHANGÉS — minMatch=1 inchangé
    // Ces patterns ont toujours minMatch=1 → 1 mot-clé suffit
    // ════════════════════════════════════════════════════════
    console.log(`${BOLD}── PHASE 3 : PATIENTS INCHANGÉS (minMatch=1 inchangé)${RESET}`)
    console.log(`  ${GRAY}Toujours 1 mot-clé = route (debug, review, deploy, help)${RESET}\n`)

    // P1 debug-request : "j'ai un bug" → "bug" (1/1)
    const r18 = tryRouteIntercom("j'ai un [THRESHOLD] bug dans le login")
    assertRoute('"j\'ai un bug" — debug-request → debug-request', r18, 'debug-request')

    // P1 debug-request : "ça plante" → "plante" (1/1)
    const r19 = tryRouteIntercom('[THRESHOLD] ça plante quand je clique')
    assertRoute('"ça plante" — debug-request → debug-request', r19, 'debug-request')

    // P3 review-request : "relis mon code" → "relis" (1/1)
    const r20 = tryRouteIntercom('[THRESHOLD] relis mon code stp')
    assertRoute('"relis mon code" — review-request → review-request', r20, 'review-request')

    // P3 review-request : "audit qualité" → "audit"+"qualité" (mais 1 suffit)
    const r21 = tryRouteIntercom('fais un [THRESHOLD] audit qualité du projet')
    // "audit" match review-request (1/8), "qualité" aussi (1/8), "projet" match project-request (1/4)
    // Attendu : review-request (premier pattern dans la boucle qui atteint minMatch)
    assertRoute('"audit qualité" → review-request', r21, 'review-request')

    // P5 deploy-request : "configure le serveur" → "configure" (1/1)
    const r22 = tryRouteIntercom('[THRESHOLD] configure le serveur')
    assertRoute('"configure le serveur" — deploy-request → deploy-request', r22, 'deploy-request')

    // P5 deploy-request : "installe Docker" → "installe" (1/1)
    const r23 = tryRouteIntercom('[THRESHOLD] installe docker')
    assertRoute('"installe Docker" — deploy-request → deploy-request', r23, 'deploy-request')

    // P7 help-request : "j'ai besoin d'aide" → "besoin"+"aide" (mais 1 suffit)
    const r24 = tryRouteIntercom("[THRESHOLD] j'ai besoin d'aide c'est urgent")
    assertRoute('"besoin d\'aide urgent" — help-request → help-request', r24, 'help-request')

    // P7 help-request : "je suis bloqué" → "bloqué" (1/1)
    const r25 = tryRouteIntercom('[THRESHOLD] je suis bloqué sur une tâche')
    assertRoute('"je suis bloqué" — help-request → help-request', r25, 'help-request')

    console.log('')

    // ════════════════════════════════════════════════════════
    // PHASE 4 : AUCUN MATCH — messages neutres
    // ════════════════════════════════════════════════════════
    console.log(`${BOLD}── PHASE 4 : AUCUN MATCH (messages sans mot-clé)${RESET}\n`)

    const r26 = tryRouteIntercom('bonjour [THRESHOLD] tout le monde')
    assertRoute('"bonjour tout le monde" → null', r26, null)

    const r27 = tryRouteIntercom('[THRESHOLD] quel temps fait-il aujourd hui')
    assertRoute('"quel temps fait-il" → null', r27, null)

    const r28 = tryRouteIntercom('[THRESHOLD] merci beaucoup à tous')
    assertRoute('"merci beaucoup" → null', r28, null)

    console.log('')

    // ════════════════════════════════════════════════════════
    // PHASE 5 : SCÉNARIOS MIXTES — plusieurs patterns potentiels
    // Vérifie le premier pattern qui atteint minMatch dans l'ordre
    // ════════════════════════════════════════════════════════
    console.log(`${BOLD}── PHASE 5 : SCÉNARIOS MIXTES (plusieurs patterns potentiels)${RESET}\n`)

    // "bug de configuration" → "bug" match debug-request (P1, minMatch=1), "configure" match deploy-request (P5, minMatch=1)
    // P1 est avant P5 dans le registre → debug-request
    const r29 = tryRouteIntercom("[THRESHOLD] bug de configuration du serveur")
    assertRoute('"bug de configuration" — P1 avant P5 → debug-request', r29, 'debug-request')

    // "vérifie le bug" → "vérifie" match analysis-request (P2, minMatch=2 mais 1/2), "bug" match debug-request (P1, minMatch=1)
    // P1 atteint minMatch=1 → debug-request
    const r30 = tryRouteIntercom("[THRESHOLD] vérifie le bug dans le login")
    assertRoute('"vérifie le bug" — "bug" seul match → debug-request', r30, 'debug-request')

    // "vérifie et analyse le bug" → "vérifie"+"analyse" → analysis-request (P2, 2/2), "bug" → debug-request (P1, 1/1)
    // P1 est avant P2 dans le registre et atteint minMatch=1 → debug-request
    const r31 = tryRouteIntercom("[THRESHOLD] vérifie et analyse le bug")
    assertRoute('"vérifie et analyse le bug" — P1 avant P2 → debug-request', r31, 'debug-request')

    // "j'ai une idée pour améliorer la qualité du projet"
    // "idée" → advice-request (P6, 1/2), "améliorer" → review-request (P3, 1/1), "qualité" → review-request (P3, 1/1), "projet" → project-request (P9, 1/4)
    // P3 atteint minMatch=1 avec "qualité" → review-request
    const r32 = tryRouteIntercom("[THRESHOLD] j'ai une idée pour améliorer la qualité du projet")
    assertRoute('"idée améliorer qualité projet" — P3 premier match → review-request', r32, 'review-request')

    console.log('')

    // ════════════════════════════════════════════════════════
    // RÉSULTATS
    // ════════════════════════════════════════════════════════
    const total = passed + failed
    console.log(`${BOLD}${CYAN}══════════════════════════════════════════════════════════════${RESET}`)
    console.log(`${BOLD}${CYAN}  RÉSULTATS : ${passed}/${total} tests OK${RESET}`)

    if (failed > 0) {
      console.log(`${BOLD}${RED}  ${failed} ÉCHEC(S) — voir ci-dessus${RESET}`)
      console.log(`${BOLD}${RED}  Les nouveaux seuils minMatch=2 ne sont pas correctement appliqués.${RESET}`)
      process.exit(1)
    } else {
      console.log(`${BOLD}${GREEN}  ✅ SEUILS MINMATCH VALIDÉS :${RESET}`)
      console.log(`     ${GREEN}• Faux positifs évités avec 1 seul mot-clé${RESET}`)
      console.log(`     ${GREEN}• Vrais positifs fonctionnels avec 2+ mots-clés${RESET}`)
      console.log(`     ${GREEN}• Patterns inchangés (minMatch=1) toujours opérationnels${RESET}`)
      console.log(`     ${GREEN}• Priorité des patterns respectée (ordre du registre)${RESET}`)
      process.exit(0)
    }

  } catch (err) {
    console.error(`\n${RED}${BOLD}CRASH : ${(err as Error).message}${RESET}`)
    console.error((err as Error).stack?.slice(0, 500) ?? '')
    process.exit(1)
  }
}

main()
