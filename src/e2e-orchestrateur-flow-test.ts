/**
 * e2e-orchestrateur-flow-test.ts — Test du flux orchestrateur réel via subprocess.
 *
 * Simule le comportement de l'orchestrateur : il ajoute une tâche via
 * task-board-cli.js add, puis vérifie que next la retourne, start l'assigne,
 * done la termine, et next retourne null.
 *
 * Contrairement à e2e-flow-test.ts qui utilise l'API directe, ce test
 * exécute le CLI task-board-cli.js comme le ferait l'orchestrateur
 * via run_terminal_command.
 *
 * Usage : node dist/e2e-orchestrateur-flow-test.js
 */

import { execSync } from 'child_process'
import { join } from 'path'
import { safeExit } from './constants.js'
import { ensureWorkspacesDir, createProject, deleteProject, getProjectInfo } from './project/project-manager.js'
import { readTaskBoard } from './project/task-board.js'

// ── Constants ──────────────────────────────────────────

const RESET = '\x1b[0m'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const CYAN = '\x1b[36m'
const BOLD = '\x1b[1m'
const GRAY = '\x1b[90m'

const PASS = `${GREEN}✓${RESET}`
const FAIL = `${RED}✗${RESET}`
let passed = 0
let failed = 0

const TEST_PROJECT = `e2e-orch-${Date.now()}`
const CLI_SCRIPT = join(process.cwd(), 'dist', 'project', 'task-board-cli.js')

function cli(...args: string[]): { stdout: string; stderr: string } {
  try {
    const stdout = execSync(`node "${CLI_SCRIPT}" ${args.join(' ')}`, {
      encoding: 'utf-8',
      timeout: 10_000,
      windowsHide: true,
    })
    return { stdout: stdout.trim(), stderr: '' }
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string; message?: string }
    return {
      stdout: (error.stdout ?? '').toString().trim(),
      stderr: (error.stderr ?? '').toString().trim(),
    }
  }
}

function assert(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed++
    console.log(`  ${PASS} ${label}`)
  } else {
    failed++
    console.log(`  ${FAIL} ${label}${detail ? ` — ${RED}${detail}${RESET}` : ''}`)
  }
}

function assertContains(label: string, output: string, needle: string): void {
  assert(`${label} contient "${needle}"`, output.includes(needle),
    `introuvable dans: ${output.slice(0, 120).replace(/\n/g, ' | ')}`)
}

// ── Helpers ──────────────────────────────────────────────

/** Extrait l'ID d'une tâche depuis la sortie de "add" (format: "ID: task-xxx"). */
function extractTaskId(stdout: string): string | null {
  const match = stdout.match(/ID:\s*(\S+)/)
  return match ? match[1] : null
}

// ── Cleanup ────────────────────────────────────────────

function cleanup(): void {
  try { deleteProject(TEST_PROJECT) } catch { /* déjà supprimé */ }
}

// ── Main ───────────────────────────────────────────────

function main(): void {
  console.log(`\n${BOLD}${CYAN}═══════════════════════════════════════════════${RESET}`)
  console.log(`${BOLD}${CYAN}  E2E : orchestrateur reel via task-board-cli.js${RESET}`)
  console.log(`${BOLD}${CYAN}═══════════════════════════════════════════════${RESET}\n`)

  try {
    // ════════════════════════════════════════════════════════
    // PHASE 1 — CRÉATION DU PROJET
    // ════════════════════════════════════════════════════════
    console.log(`${BOLD}── PHASE 1 : CREATION DU PROJET${RESET}`)

    ensureWorkspacesDir()
    const result = createProject(TEST_PROJECT, 'Test flux orchestrateur', 'e2e-test')
    assert('Projet créé avec succès', result.ok, result.error)

    const info = getProjectInfo(TEST_PROJECT)
    assert('Infos projet accessibles', info !== null)
    assert('Statut actif', info?.status === 'active')

    // ════════════════════════════════════════════════════════
    // PHASE 2 — AJOUT DE TÂCHE VIA CLI ADD
    // ════════════════════════════════════════════════════════
    console.log(`\n${BOLD}── PHASE 2 : AJOUT DE TACHE VIA CLI${RESET}`)

    // Étape 2a — Ajouter une tâche backend
    const add1 = cli('add', TEST_PROJECT, 'backend', 'Construire API REST')
    assertContains('add retourne OK', add1.stdout, '✅ Tâche ajoutée')
    assertContains('add contient le titre', add1.stdout, 'Construire API REST')
    assertContains('add contient le domaine', add1.stdout, 'backend')
    assertContains('add contient le projet', add1.stdout, TEST_PROJECT)

    const task1Id = extractTaskId(add1.stdout)
    assert('ID de tâche extrait de add', task1Id !== null, `stdout: ${add1.stdout.slice(0, 100)}`)
    if (!task1Id) { throw new Error('Impossible d\'extraire task1Id') }
    console.log(`    ${GRAY}→ Tâche #1 ID: ${task1Id}${RESET}`)

    // Étape 2b — Ajouter une tâche frontend dans un autre domaine
    const add2 = cli('add', TEST_PROJECT, 'frontend', 'Page profil utilisateur')
    assertContains('add frontend OK', add2.stdout, '✅ Tâche ajoutée')

    const task2Id = extractTaskId(add2.stdout)
    assert('ID tâche frontend extrait', task2Id !== null)
    if (!task2Id) { throw new Error('Impossible d\'extraire task2Id') }
    console.log(`    ${GRAY}→ Tâche #2 ID: ${task2Id}${RESET}`)

    // Vérifier le board via l'API directe
    const boardAfterAdd = readTaskBoard(TEST_PROJECT)
    assert('2 tâches dans le board', boardAfterAdd.tasks.length === 2,
      `obtenu: ${boardAfterAdd.tasks.length}`)

    // ════════════════════════════════════════════════════════
    // PHASE 3 — NEXT VIA CLI
    // ════════════════════════════════════════════════════════
    console.log(`\n${BOLD}── PHASE 3 : VERIFICATION NEXT VIA CLI${RESET}`)

    // Étape 3a — next backend → retourne la tâche #1
    const nextBackend = cli('next', TEST_PROJECT, 'backend')
    assertContains('next backend contient "Prochaine tâche"', nextBackend.stdout, '📌 Prochaine tâche disponible')
    assertContains('next backend contient le titre', nextBackend.stdout, 'Construire API REST')
    assertContains('next backend contient le domaine', nextBackend.stdout, 'backend')
    assertContains('next backend contient l\'ID', nextBackend.stdout, task1Id)

    // Étape 3b — next frontend → retourne la tâche #2
    const nextFrontend = cli('next', TEST_PROJECT, 'frontend')
    assertContains('next frontend contient le titre', nextFrontend.stdout, 'Page profil utilisateur')
    assertContains('next frontend contient l\'ID', nextFrontend.stdout, task2Id)
    assertContains('next frontend contient start command', nextFrontend.stdout, 'task-board-cli.js start')

    // ════════════════════════════════════════════════════════
    // PHASE 4 — START VIA CLI (simule l'orchestrateur qui assigne)
    // ════════════════════════════════════════════════════════
    console.log(`\n${BOLD}── PHASE 4 : START VIA CLI${RESET}`)

    // Étape 4a — Démarrer la tâche #1 (backend) avec un agent
    const start1 = cli('start', TEST_PROJECT, task1Id, 'agent-codeur-01')
    assertContains('start retourne demarree', start1.stdout, '✅')
    assertContains('start contient le titre', start1.stdout, 'Construire API REST')
    assertContains('start mentionne l\'agent', start1.stdout, 'agent-codeur-01')

    // Étape 4b — Vérifier que backend est bloqué (séquentiel)
    const canAssignBackend = cli('can-assign', TEST_PROJECT, 'backend')
    assertContains('can-assign backend = occupe', canAssignBackend.stdout, '⛔')
    assertContains('can-assign backend = "occupé"', canAssignBackend.stdout, 'occupé')

    // Étape 4c — Vérifier que frontend est toujours disponible (parallèle)
    const canAssignFrontend = cli('can-assign', TEST_PROJECT, 'frontend')
    assertContains('can-assign frontend = disponible', canAssignFrontend.stdout, '✅')
    assertContains('can-assign frontend = "disponible"', canAssignFrontend.stdout, 'disponible')

    // Étape 4d — Démarrer une deuxième tentative sur backend → doit échouer
    const startDup = cli('start', TEST_PROJECT, task1Id, 'agent-codeur-02')
    assertContains('start deja en cours = avertissement', startDup.stdout, '⚠')
    assertContains('start deja en cours mentionne agent', startDup.stdout, 'agent-codeur-01')

    // ════════════════════════════════════════════════════════
    // PHASE 5 — DONE VIA CLI
    // ════════════════════════════════════════════════════════
    console.log(`\n${BOLD}── PHASE 5 : DONE VIA CLI${RESET}`)

    // Étape 5a — Terminer la tâche #1
    const done1 = cli('done', TEST_PROJECT, task1Id)
    assertContains('done retourne terminee', done1.stdout, '✅')
    assertContains('done contient le titre', done1.stdout, 'Construire API REST')
    assertContains('done mentionne le domaine', done1.stdout, 'backend')
    assertContains('done annonce domaine termine', done1.stdout, 'toutes les tâches sont terminées')

    // Étape 5b — Vérifier que next backend retourne "aucune tâche" maintenant
    const nextBackendDone = cli('next', TEST_PROJECT, 'backend')
    assertContains('next backend = aucune tache', nextBackendDone.stdout, '✅')
    assertContains('next backend = "Aucune tâche"', nextBackendDone.stdout, 'Aucune tâche en attente')

    // Étape 5c — Vérifier que frontend est toujours dispo
    const canAssignFrontendDone = cli('can-assign', TEST_PROJECT, 'frontend')
    assertContains('can-assign frontend = dispo (toujours)', canAssignFrontendDone.stdout, '✅')

    // ════════════════════════════════════════════════════════
    // PHASE 6 — CYCLE COMPLET (FRONTEND)
    // ════════════════════════════════════════════════════════
    console.log(`\n${BOLD}── PHASE 6 : CYCLE COMPLET FRONTEND${RESET}`)

    // start → done → next (aucune)
    const start2 = cli('start', TEST_PROJECT, task2Id, 'agent-front-01')
    assertContains('start frontend OK', start2.stdout, '✅')

    const done2 = cli('done', TEST_PROJECT, task2Id)
    assertContains('done frontend OK', done2.stdout, '✅')

    const nextFrontendDone = cli('next', TEST_PROJECT, 'frontend')
    assertContains('next frontend = aucune', nextFrontendDone.stdout, '✅')

    // ════════════════════════════════════════════════════════
    // PHASE 7 — VÉRIFICATION FINALE
    // ════════════════════════════════════════════════════════
    console.log(`\n${BOLD}── PHASE 7 : VERIFICATION FINALE${RESET}`)

    // Étape 7a — summary du projet
    const summary = cli('summary', TEST_PROJECT)
    assertContains('summary contient le projet', summary.stdout, TEST_PROJECT)
    assertContains('summary = 2 done', summary.stdout, '2 terminée')
    assertContains('summary = 0 en cours', summary.stdout, '0 en cours')
    assertContains('summary = 0 todo', summary.stdout, '0 todo')

    // Étape 7b — read du projet (vérifier la sortie complète)
    const read = cli('read', TEST_PROJECT)
    assertContains('read contient le nom du projet', read.stdout, TEST_PROJECT)
    assertContains('read mentionne 2 tâches', read.stdout, '2 terminée')

    // Étape 7c — pending → aucun
    const pending = cli('pending', TEST_PROJECT)
    assertContains('pending = aucune', pending.stdout, '✅')

    // ════════════════════════════════════════════════════════
    // RÉSULTATS
    // ════════════════════════════════════════════════════════
    const total = passed + failed
    console.log(`\n${BOLD}${CYAN}═══════════════════════════════════════════════${RESET}`)
    console.log(`${BOLD}${CYAN}  RESULTATS : ${passed}/${total} tests OK${RESET}`)
    if (failed > 0) {
      console.log(`${BOLD}${RED}  ${failed} ECHEC(S)${RESET}`)
    } else {
      console.log(`${BOLD}${GREEN}  TOUS LES TESTS ORCHESTRATEUR SONT PASSES${RESET}`)
    }
    console.log(`${BOLD}${CYAN}═══════════════════════════════════════════════${RESET}\n`)

    safeExit(failed > 0 ? 1 : 0)

  } catch (err) {
    console.error(`\n${RED}${BOLD}CRASH : ${(err as Error).message}${RESET}`)
    console.error((err as Error).stack?.slice(0, 500) ?? '')
    safeExit(1)
  } finally {
    cleanup()
  }
}

main()
