/**
 * e2e-flow-test.ts — Test end-to-end du pipeline complet
 *
 * Simule le flux : user → intercom → orchestrateur → task-board → agent spécialisé
 * SANS avoir besoin d'appels LLM ni de daemons en arrière-plan.
 *
 * Ce qui est testé :
 *   1. Création de projet (workspaces/)
 *   2. Ajout de tâches dans différents domaines
 *   3. Règles de séquencement (séquentiel/même domaine, parallèle/domaines différents)
 *   4. Dépendances entre tâches
 *   5. Routage intercom (pattern matching + injection du projet)
 *   6. Cycle complet d'une tâche : todo → in_progress → done → next
 *
 * Usage : node dist/e2e-flow-test.js
 */

import { readFileSync, unlinkSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'
import { safeExit } from './constants.js'
import {
  ensureWorkspacesDir,
  createProject,
  getProjectInfo,
  deleteProject,
  listProjects,
} from './project/project-manager.js'
import {
  readTaskBoard,
  writeTaskBoard,
  addTask,
  updateTaskStatus,
  getNextTask,
  canAssignTask,
  countTasks,
  updateTask,
} from './project/task-board.js'
import { tryRouteIntercom, setCurrentProject } from './cli-intercom-router.js'
import type { TaskBoard } from './project/types.js'

// ── Constants ──────────────────────────────────────────

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

const TEST_PROJECT = `e2e-test-${Date.now()}`
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

function assertBoardCounts(
  label: string,
  board: TaskBoard,
  expected: { todo?: number; inProgress?: number; done?: number },
): void {
  const counts = countTasks(board)
  const checks: string[] = []
  let ok = true

  if (expected.todo !== undefined && counts.todo !== expected.todo) {
    ok = false
    checks.push(`todo: attendu ${expected.todo}, obtenu ${counts.todo}`)
  }
  if (expected.inProgress !== undefined && counts.inProgress !== expected.inProgress) {
    ok = false
    checks.push(`in_progress: attendu ${expected.inProgress}, obtenu ${counts.inProgress}`)
  }
  if (expected.done !== undefined && counts.done !== expected.done) {
    ok = false
    checks.push(`done: attendu ${expected.done}, obtenu ${counts.done}`)
  }

  assert(`${label} (todo=${counts.todo}, en_cours=${counts.inProgress}, done=${counts.done})`, ok, checks.join('; '))
}

// ── Cleanup ────────────────────────────────────────────

function cleanupTestFiles(): void {
  // Supprimer le projet de test
  try { deleteProject(TEST_PROJECT) } catch { /* déjà supprimé */ }

  // Nettoyer les fichiers intercom créés pendant le test
  if (existsSync(INTERCOM_DIR)) {
    const files = readdirSync(INTERCOM_DIR).filter(f => f.endsWith('.json'))
    for (const f of files) {
      try {
        const content = readFileSync(join(INTERCOM_DIR, f), 'utf-8')
        const msg = JSON.parse(content) as { payload?: { demande?: string }; subject?: string }
        // Nos messages de test contiennent le marqueur [E2E]
        if (msg.payload?.demande?.includes('[E2E]')) {
          unlinkSync(join(INTERCOM_DIR, f))
        }
      } catch { /* fichier verrouillé ou supprimé entre-temps */ }
    }
  }

  // Réinitialiser le projet courant
  setCurrentProject(undefined)
}

// ── Main ───────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`\n${BOLD}${CYAN}═══════════════════════════════════════════════${RESET}`)
  console.log(`${BOLD}${CYAN}  E2E : user → intercom → orchestrateur → task-board → agent${RESET}`)
  console.log(`${BOLD}${CYAN}═══════════════════════════════════════════════${RESET}\n`)

  try {
    // ════════════════════════════════════════════════════════
    // PHASE 1 — CRÉATION DU PROJET
    // ════════════════════════════════════════════════════════
    console.log(`${BOLD}── PHASE 1 : CREATION DU PROJET${RESET}`)

    ensureWorkspacesDir()
    const result = createProject(TEST_PROJECT, 'Application de test E2E', 'test-runner')
    assert('Projet créé avec succès', result.ok, result.error)

    const info = getProjectInfo(TEST_PROJECT)
    assert('Infos projet accessibles', info !== null)
    assert('Nom du projet correct', info?.name === TEST_PROJECT)
    assert('Statut initial actif', info?.status === 'active')

    const projects = listProjects()
    const found = projects.some(p => p.name === TEST_PROJECT)
    assert('Projet listé dans les projets', found)

    // ════════════════════════════════════════════════════════
    // PHASE 2 — AJOUT DE TÂCHES MULTI-DOMAINES
    // ════════════════════════════════════════════════════════
    console.log(`\n${BOLD}── PHASE 2 : AJOUT DE TACHES${RESET}`)

    let board = readTaskBoard(TEST_PROJECT)
    assertBoardCounts('Tableau vide après création', board, { todo: 0, inProgress: 0, done: 0 })

    // Tâche A : backend — aucune dépendance
    const { board: b1, task: taskA } = addTask(board, 'Implémenter API login', 'backend')
    writeTaskBoard(b1, TEST_PROJECT)
    assert('Tâche A (backend) créée', taskA.status === 'todo' && taskA.area === 'backend', taskA.id)
    board = b1

    // Tâche B : frontend — dépend de A
    const { board: b2, task: taskB } = addTask(board, 'Page de connexion frontend', 'frontend', [taskA.id])
    writeTaskBoard(b2, TEST_PROJECT)
    assert('Tâche B (frontend, dependsOn A) créée', taskB.status === 'todo' && taskB.area === 'frontend' && taskB.dependsOn?.[0] === taskA.id, taskB.id)
    board = b2

    // Tâche C : frontend — aucune dépendance (parallélisable avec A)
    const { board: b3, task: taskC } = addTask(board, 'Page tableau de bord', 'frontend')
    writeTaskBoard(b3, TEST_PROJECT)
    assert('Tâche C (frontend, sans dépendance) créée', taskC.status === 'todo' && taskC.area === 'frontend', taskC.id)
    board = b3

    // Tâche D : infra — aucune dépendance (parallélisable avec backend + frontend)
    const { board: b4, task: taskD } = addTask(board, 'Configurer CI/CD', 'infra')
    writeTaskBoard(b4, TEST_PROJECT)
    assert('Tâche D (infra) créée', taskD.status === 'todo' && taskD.area === 'infra', taskD.id)
    board = b4

    assertBoardCounts('4 tâches en todo', board, { todo: 4, inProgress: 0, done: 0 })

    // ════════════════════════════════════════════════════════
    // PHASE 3 — TEST DES RÈGLES DE SÉQUENCEMENT
    // ════════════════════════════════════════════════════════
    console.log(`\n${BOLD}── PHASE 3 : SEQUENCEMENT PAR DOMAINE${RESET}`)

    // 3a — Règle : tâches du même domaine → séquentielles
    // CanAssign backend → true (rien en cours)
    assert('Domaine backend disponible', canAssignTask(board, 'backend'))

    // Démarrer la tâche A (backend)
    const updatedA = updateTaskStatus(board, taskA.id, 'in_progress', 'agent-codeur-backend')
    assert('Tâche A démarrée', updatedA !== null)
    if (updatedA) {
      board = updatedA
      writeTaskBoard(board, TEST_PROJECT)
      assertBoardCounts('Backend en cours', board, { todo: 3, inProgress: 1, done: 0 })
    }

    // 3b — Règle : même domaine BACKEND maintenant OCCUPÉ
    assert('Domaine backend occupé', !canAssignTask(board, 'backend'))

    // 3c — Règle : domaines DIFFÉRENTS → parallélisables
    assert('Domaine frontend disponible (parallèle)', canAssignTask(board, 'frontend'))
    assert('Domaine infra disponible (parallèle)', canAssignTask(board, 'infra'))

    // 3d — Règle : dépendances — tâche B (dépend de A) PAS disponible tant que A pas terminée
    const nextFrontendBefore = getNextTask(board, 'frontend')
    assert('Tâche C (sans dépendance) est la prochaine frontend', nextFrontendBefore?.title === 'Page tableau de bord',
      `obtenu: ${nextFrontendBefore?.title ?? '(aucune)'}`)

    // Démarrer la tâche C (frontend) en parallèle de A
    const updatedC = updateTaskStatus(board, taskC.id, 'in_progress', 'agent-codeur-frontend')
    assert('Tâche C démarrée (parallèle backend)', updatedC !== null)
    if (updatedC) {
      board = updatedC
      writeTaskBoard(board, TEST_PROJECT)
      assertBoardCounts('Backend + Frontend en parallèle', board, { todo: 2, inProgress: 2, done: 0 })
    }

    // 3e — Les DEUX domaines sont maintenant occupés
    assert('Backend occupé (toujours)', !canAssignTask(board, 'backend'))
    assert('Frontend occupé (maintenant)', !canAssignTask(board, 'frontend'))
    // Infra toujours disponible
    assert('Infra disponible (parallèle aux deux)', canAssignTask(board, 'infra'))

    // Démarrer la tâche D (infra) — 3ème domaine parallèle
    const updatedD = updateTaskStatus(board, taskD.id, 'in_progress', 'agent-codeur-infra')
    assert('Tâche D démarrée (3ème domaine parallèle)', updatedD !== null)
    if (updatedD) {
      board = updatedD
      writeTaskBoard(board, TEST_PROJECT)
      assertBoardCounts('3 domaines en parallèle', board, { todo: 1, inProgress: 3, done: 0 })
    }

    // ════════════════════════════════════════════════════════
    // PHASE 4 — TERMINAISON DE TÂCHES ET DÉPENDANCES
    // ════════════════════════════════════════════════════════
    console.log(`\n${BOLD}── PHASE 4 : TERMINAISON + DEPENDANCES${RESET}`)

    // Terminer la tâche A (backend)
    const doneA = updateTaskStatus(board, taskA.id, 'done')
    assert('Tâche A terminée (backend)', doneA !== null)
    if (doneA) {
      board = doneA
      writeTaskBoard(board, TEST_PROJECT)
      assertBoardCounts('Backend terminé', board, { todo: 1, inProgress: 2, done: 1 })
    }

    // 4a — Backend redevient disponible
    assert('Backend disponible (terminé)', canAssignTask(board, 'backend'))
    // Mais plus de tâche backend en attente
    const nextBackend = getNextTask(board, 'backend')
    assert('Aucune tâche backend en attente', nextBackend === null)

    // 4b — Frontend toujours occupé (tâche C en cours)
    assert('Frontend toujours occupé', !canAssignTask(board, 'frontend'))

    // 4c — Maintenant que A est terminée, B (dépend de A) devient disponible
    // Mais C est en cours dans le même domaine → frontend occupé
    // On doit d'abord terminer C
    const doneC = updateTaskStatus(board, taskC.id, 'done')
    assert('Tâche C terminée (frontend)', doneC !== null)
    if (doneC) {
      board = doneC
      writeTaskBoard(board, TEST_PROJECT)
      assertBoardCounts('Frontend #1 terminé', board, { todo: 1, inProgress: 1, done: 2 })
    }

    // 4d — Frontend maintenant disponible, et B devrait être la prochaine (dépendance résolue)
    assert('Frontend disponible (après fin C)', canAssignTask(board, 'frontend'))
    const nextFrontendAfter = getNextTask(board, 'frontend')
    assert('Tâche B (dépend de A) disponible maintenant', nextFrontendAfter?.title === 'Page de connexion frontend',
      `obtenu: ${nextFrontendAfter?.title ?? '(aucune)'}`)

    // Démarrer B
    const updatedB = updateTaskStatus(board, taskB.id, 'in_progress', 'agent-codeur-frontend')
    assert('Tâche B démarrée (dépendance A résolue)', updatedB !== null)
    if (updatedB) {
      board = updatedB
      writeTaskBoard(board, TEST_PROJECT)
      assertBoardCounts('Frontend #2 en cours', board, { todo: 0, inProgress: 2, done: 2 })
    }

    // Terminer B
    const doneB = updateTaskStatus(board, taskB.id, 'done')
    assert('Tâche B terminée', doneB !== null)
    if (doneB) {
      board = doneB
      writeTaskBoard(board, TEST_PROJECT)
    }

    // Terminer D
    const doneD = updateTaskStatus(board, taskD.id, 'done')
    assert('Tâche D terminée (infra)', doneD !== null)
    if (doneD) {
      board = doneD
      writeTaskBoard(board, TEST_PROJECT)
      assertBoardCounts('Toutes les tâches terminées', board, { todo: 0, inProgress: 0, done: 4 })
    }

    // ════════════════════════════════════════════════════════
    // PHASE 5 — ROUTAGE INTERCOM
    // ════════════════════════════════════════════════════════
    console.log(`\n${BOLD}── PHASE 5 : ROUTAGE INTERCOM${RESET}`)

    // 5a — Pattern bug → debug-request
    const bugResult = tryRouteIntercom("j'ai un bug [E2E] dans le login")
    assert('"bug" route vers debug-request', bugResult?.subject === 'debug-request',
      `obtenu: ${bugResult?.subject ?? 'null'}`)

    // 5b — Pattern création → create-request
    const createResult = tryRouteIntercom('crée [E2E] une page de profil')
    assert('"crée" route vers create-request', createResult?.subject === 'create-request',
      `obtenu: ${createResult?.subject ?? 'null'}`)

    // 5c — Pattern review → review-request
    const reviewResult = tryRouteIntercom('relis [E2E] mon code stp')
    assert('"relis" route vers review-request', reviewResult?.subject === 'review-request',
      `obtenu: ${reviewResult?.subject ?? 'null'}`)

    // 5d — Pattern aide → help-request
    const helpResult = tryRouteIntercom("j'ai besoin d'aide [E2E] urgent")
    assert('"aide"+"besoin" route vers help-request', helpResult?.subject === 'help-request',
      `obtenu: ${helpResult?.subject ?? 'null'}`)

    // 5e — Aucun match → null
    const noMatch = tryRouteIntercom('bonjour [E2E] tout va bien')
    assert('Message neutre → null (pas de routage)', noMatch === null,
      `obtenu: ${noMatch?.subject ?? 'null'}`)

    // 5f — Liste agents (nécessite 2 mots-clés)
    const listResult = tryRouteIntercom('liste [E2E] les agents disponibles')
    assert('"liste"+"agent"+"disponible" route vers agent-list-request', listResult?.subject === 'agent-list-request',
      `obtenu: ${listResult?.subject ?? 'null'}`)

    // 5g — Test d'injection du projet dans le payload intercom
    // On définit le projet courant, puis on route un message
    setCurrentProject(TEST_PROJECT)
    const projResult = tryRouteIntercom('corrige [E2E] ce bug sur la page login')
    assert('Message routé avec projet courant', projResult !== null)
    // Vérifier que le fichier intercom contient bien le project name
    if (existsSync(INTERCOM_DIR)) {
      const files = readdirSync(INTERCOM_DIR).filter(f => f.endsWith('.json'))
      let foundProjectFile = false
      for (const f of files) {
        try {
          const content = readFileSync(join(INTERCOM_DIR, f), 'utf-8')
          const msg = JSON.parse(content) as { payload?: { demande?: string; project?: string } }
          if (msg.payload?.demande?.includes('[E2E]') && msg.payload?.demande?.includes('corrige')) {
            assert('Payload intercom contient le project name', msg.payload.project === TEST_PROJECT,
              `obtenu: ${msg.payload.project ?? '(absent)'}`)
            foundProjectFile = true
          }
        } catch { /* skip */ }
      }
      assert('Fichier intercom trouvé pour la vérification', foundProjectFile)
    } else {
      console.log(`    ${YELLOW}⚠ Dossier intercom introuvable — vérification payload ignorée${RESET}`)
    }

    // ════════════════════════════════════════════════════════
    // PHASE 6 — TEST D'IDENTITÉ (intégrité des données)
    // ════════════════════════════════════════════════════════
    console.log(`\n${BOLD}── PHASE 6 : VERIFICATION D'INTEGRITE${RESET}`)

    // Recharger le board depuis le fichier
    const reloadedBoard = readTaskBoard(TEST_PROJECT)
    const reloadCounts = countTasks(reloadedBoard)
    assert('4 tâches persistées dans .tasks.json', reloadedBoard.tasks.length === 4,
      `obtenu: ${reloadedBoard.tasks.length}`)
    assert('Toutes les tâches terminées après rechargement', reloadCounts.done === 4,
      `done: ${reloadCounts.done}, in_progress: ${reloadCounts.inProgress}, todo: ${reloadCounts.todo}`)

    // Vérifier les zones des tâches
    const areas = new Set(reloadedBoard.tasks.map(t => t.area))
    assert('Domaines préservés (backend, frontend, infra)',
      areas.has('backend') && areas.has('frontend') && areas.has('infra'),
      `obtenu: ${[...areas].join(', ')}`)

    // Vérifier les assignations
    const assignedTasks = reloadedBoard.tasks.filter(t => t.assignedTo)
    assert('Tâches assignées à des agents', assignedTasks.length === 4,
      `obtenu: ${assignedTasks.length}`)

    // Vérifier que le projet info est correct
    const finalInfo = getProjectInfo(TEST_PROJECT)
    assert('Infos projet persistées', finalInfo !== null)
    assert('Projet toujours actif', finalInfo?.status === 'active')

    // ════════════════════════════════════════════════════════
    // PHASE 7 — CAS D'ERREUR
    // ════════════════════════════════════════════════════════
    console.log(`\n${BOLD}── PHASE 7 : CAS D ERREUR${RESET}`)

    // ── 7a — Projet inexistant ──────────────────────────────

    const nullInfo = getProjectInfo('projet-qui-nexiste-pas')
    assert('getProjectInfo → null pour projet inexistant', nullInfo === null)

    const emptyBoard = readTaskBoard('projet-qui-nexiste-pas')
    assert('readTaskBoard → board vide pour projet inexistant', emptyBoard.tasks.length === 0)
    assert('board vide a un nom par défaut', emptyBoard.project === 'projet-qui-nexiste-pas')

    const delResult = deleteProject('projet-qui-nexiste-pas')
    assert('deleteProjet → echec pour projet inexistant', !delResult.ok)
    assert('deleteProjet message d erreur present', !!delResult.error)

    // ── 7b — Dépendance cyclique ────────────────────────────

    let cycleBoard = readTaskBoard(TEST_PROJECT)
    const cycleTasks: string[] = []

    // Créer 3 tâches : Implementation→Analyse, Tests→Implementation (chaîne linéaire)
    for (let i = 0; i < 3; i++) {
      const name = i === 0 ? 'Analyse' : i === 1 ? 'Implementation' : 'Tests'
      const dep = i > 0 ? [cycleTasks[i - 1]] : undefined
      const r = addTask(cycleBoard, name, 'qa', dep)
      cycleBoard = r.board
      cycleTasks.push(r.task.id)
    }

    // Créer le cycle : Analyse→Tests (ferme la boucle)
    // Graphe final : Analyse→Tests→Implementation→Analyse
    const cycled = updateTask(cycleBoard, cycleTasks[0], { dependsOn: [cycleTasks[2]] })
    assert('Cycle A→B→C→A créé (modification manuelle)', cycled !== null)
    if (cycled) {
      cycleBoard = cycled
      // Toutes les tâches sont bloquées par le cycle
      const next0 = getNextTask(cycleBoard, 'qa')
      assert('Cycle bloque toutes les taches du domaine', next0 === null)
    }

    // ── 7c — Dépendance inexistante ─────────────────────────

    const { board: bBadDep, task: tBadDep } = addTask(cycleBoard, 'Tache sans precedent', 'qa', ['id-qui-nexiste-pas'])
    cycleBoard = bBadDep
    assert('Tache creee avec dependance inexistante', tBadDep.status === 'todo' && tBadDep.dependsOn?.[0] === 'id-qui-nexiste-pas', tBadDep.id)

    const nextBad = getNextTask(cycleBoard, 'qa')
    // La dépendance n'existe pas, donc jamais satisfaite → tâche bloquée
    assert('getNextTask ignore dependance inexistante', nextBad === null)

    // ── 7d — Domaine inconnu ───────────────────────────────

    const { board: bUnknownArea, task: tUnknown } = addTask(cycleBoard, 'Mission data science', 'data-science')
    cycleBoard = bUnknownArea
    assert('Tache creee avec domaine inconnu', tUnknown.area === 'data-science')

    assert('Domaine inconnu disponible', canAssignTask(cycleBoard, 'data-science'))

    const nextUnknown = getNextTask(cycleBoard, 'data-science')
    assert('getNextTask retourne la tache inconnue', nextUnknown?.title === 'Mission data science',
      `obtenu: ${nextUnknown?.title ?? '(aucune)'}`)

    // Démarrer la tâche dans le domaine inconnu
    const startedUnknown = updateTaskStatus(cycleBoard, tUnknown.id, 'in_progress', 'agent-explorateur')
    assert('Tache domaine inconnu demarree', startedUnknown !== null)
    if (startedUnknown) {
      // Le domaine devient occupé
      assert('Domaine inconnu occupe', !canAssignTask(startedUnknown, 'data-science'))

      // Terminer la tâche
      const doneUnknown = updateTaskStatus(startedUnknown, tUnknown.id, 'done')
      assert('Tache domaine inconnu terminee', doneUnknown !== null)
      if (doneUnknown) {
        assert('Domaine inconnu a nouveau disponible', canAssignTask(doneUnknown, 'data-science'))
      }
    }

    // Nettoyer les tâches de test (les retirer du board principal)
    const cleanBoard = readTaskBoard(TEST_PROJECT)
    const cycleIds = new Set([...cycleTasks, tBadDep.id, tUnknown.id])
    cleanBoard.tasks = cleanBoard.tasks.filter(t => !cycleIds.has(t.id))
    writeTaskBoard(cleanBoard, TEST_PROJECT)

    // ════════════════════════════════════════════════════════
    // RÉSULTATS
    // ════════════════════════════════════════════════════════
    const total = passed + failed
    console.log(`\n${BOLD}${CYAN}═══════════════════════════════════════════════${RESET}`)
    console.log(`${BOLD}${CYAN}  RESULTATS : ${passed}/${total} tests OK${RESET}`)
    if (failed > 0) {
      console.log(`${BOLD}${RED}  ${failed} ECHEC(S) — voir ci-dessus${RESET}`)
      console.log(`${BOLD}${RED}  Nettoyage : ${TEST_PROJECT} dans workspaces/ peut être supprimé${RESET}`)
    } else {
      console.log(`${BOLD}${GREEN}  TOUS LES TESTS E2E SONT PASSES${RESET}`)
    }
    console.log(`${BOLD}${CYAN}═══════════════════════════════════════════════${RESET}\n`)

    safeExit(failed > 0 ? 1 : 0)

  } catch (err) {
    console.error(`\n${RED}${BOLD}CRASH : ${(err as Error).message}${RESET}`)
    console.error((err as Error).stack?.slice(0, 500) ?? '')
    safeExit(1)
  } finally {
    cleanupTestFiles()
  }
}

main()
