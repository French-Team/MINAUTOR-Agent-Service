/**
 * Test du cycle complet en conditions réelles :
 * - Fork le CLI
 * - Envoie 'je veux debugger un problème'
 * - Vérifie que le compteur [1] apparaît dans le prompt après notification
 *
 * Usage: npx tsx src/test-real-cycle.ts
 */

import { fork, ChildProcess } from 'child_process'
import { join } from 'path'
import { existsSync, unlinkSync, readdirSync, writeFileSync, readFileSync } from 'fs'

const CWD = process.cwd()
const TIMEOUT_MS = 120_000 // 2 minutes max

function cleanup(): void {
  // Nettoyer notifications
  const notifPath = join(CWD, 'telecom', 'notifications.json')
  if (existsSync(notifPath)) unlinkSync(notifPath)

  // Nettoyer intercom
  for (const dir of ['telecom/intercom', 'telecom/routed']) {
    const d = join(CWD, dir)
    if (existsSync(d)) {
      for (const f of readdirSync(d)) {
        if (f.endsWith('.json')) unlinkSync(join(d, f))
      }
    }
  }

  // Nettoyer PID et status du daemon
  for (const f of ['telecom/daemon.pid', 'telecom/daemon.status.json', 'telecom/daemon.reset', 'telecom/notification-filter', '.agent-output']) {
    const p = join(CWD, f)
    if (existsSync(p)) unlinkSync(p)
  }
}

function writeIndented(label: string, text: string, indent: number = 4): void {
  const prefix = ' '.repeat(indent)
  for (const line of text.split('\n')) {
    console.log(`${prefix}${line}`)
  }
}

async function waitForPattern(
  buffer: () => string,
  pattern: RegExp,
  timeoutMs: number,
  label: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now()
    const check = setInterval(() => {
      const elapsed = Date.now() - start
      if (pattern.test(buffer())) {
        clearInterval(check)
        console.log(`  ${' '.repeat(6)}✓ ${label} après ${elapsed}ms`)
        resolve(true)
        return
      }
      if (elapsed >= timeoutMs) {
        clearInterval(check)
        console.log(`  ${' '.repeat(6)}✗ ${label} — TIMEOUT après ${timeoutMs}ms`)
        resolve(false)
      }
    }, 200)
  })
}

async function main(): Promise<void> {
  console.log('')
  console.log('══════════════════════════════════════════════')
  console.log('  TEST CYCLE RÉEL — Badge [N] notifications')
  console.log('══════════════════════════════════════════════')
  console.log('')

  // ── 1. Nettoyage ──
  console.log('[1] Nettoyage des fichiers de test...')
  cleanup()
  console.log('     ✓ OK')
  console.log('')

  // ── 2. Fork du CLI ──
  console.log('[2] Fork du CLI (node dist/cli.js)...')
  const cliPath = join(CWD, 'dist', 'cli.js')
  if (!existsSync(cliPath)) {
    console.log(`     ${' '.repeat(2)}✗ ${cliPath} introuvable — as-tu compilé ?`)
    process.exit(1)
  }

  let output = ''
  let promptCount = 0
  let lastChunkTime = Date.now()

  const cli = fork(cliPath, [], {
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, FORCE_COLOR: '0' }, // Pas de couleurs pour faciliter le parsing
  })

  cli.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString()
    output += text
    lastChunkTime = Date.now()

    // Compter les prompts
    if (text.includes('> ')) promptCount++

    process.stdout.write(text)
  })

  cli.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString()
    output += text
    process.stderr.write(text)
  })

  cli.on('exit', (code) => {
    console.log(`\n[CLI] Processus terminé avec le code ${code}`)
  })

  // Timer global
  const globalTimeout = setTimeout(() => {
    console.log(`\n⚠ TIMEOUT GLOBAL (${TIMEOUT_MS / 1000}s) — Arrêt du test`)
    cli.kill()
    process.exit(1)
  }, TIMEOUT_MS)

  // ── 3. Attendre le prompt initial ──
  console.log('[3] Attente du prompt initial...')
  const promptReady = await waitForPattern(
    () => output,
    />\s*$/m,
    10_000,
    'Prompt initial reçu',
  )

  if (!promptReady) {
    console.log('     ✗ Prompt initial non détecté')
    console.log(`     Dernière sortie (200 derniers caractères):`)
    writeIndented('', output.slice(-200))
    cli.kill()
    clearTimeout(globalTimeout)
    process.exit(1)
  }

  // Petit délai pour laisser le daemon démarrer
  await new Promise(r => setTimeout(r, 1000))
  console.log('')

  // ── 4. Envoyer le message ──
  console.log('[4] Envoi: "je veux debugger un problème"')
  cli.stdin?.write('je veux debugger un problème\n')

  // Attendre la réponse du routeur (immédiate)
  const routeResponse = await waitForPattern(
    () => output,
    /Routé vers agent-telecom/,
    5_000,
    'Routeur a répondu',
  )
  console.log('')

  if (!routeResponse) {
    console.log('     ⚠ Routeur n\'a pas répondu — vérifie si le pattern a matché')
    console.log('     Dernière sortie:')
    writeIndented('', output.slice(-300))
  }

  // ── 5. Attendre que le daemon + spawn-agent + LLM répondent ──
  console.log('[5] Attente du daemon + spawn-agent (appel LLM ~30-60s)...')
  console.log('    Le daemon surveille telecom/intercom/ toutes les 2s')
  console.log('    Il va router le message, spawner agent-telecom,')
  console.log('    qui appelle le LLM puis pushNotification via IPC')
  console.log('')

  // Vérifier que le daemon a démarré (PID file)
  const daemonStarted = await waitForPattern(
    () => output,
    /Daemon.*Démarrage|Daemon.*PID/,
    5_000,
    'Daemon démarré',
  )

  // Attendre la notification IPC (le daemon relaye depuis spawn-agent)
  const notificationReceived = await waitForPattern(
    () => output,
    /intercom|Agent Télécom|notification/i,
    90_000, // 90s pour le LLM
    'Notification reçue via IPC',
  )

  if (notificationReceived) {
    console.log('\n    ✅ Notification reçue en TEMPS RÉEL !')
  } else {
    console.log('\n    ⚠ Notification non reçue en temps réel')
  }
  console.log('')

  // ── 6. Envoyer Enter pour voir le prochain prompt ──
  console.log('[6] Envoi Enter pour déclencher le prochain prompt...')
  cli.stdin?.write('\n')

  await new Promise(r => setTimeout(r, 2000))

  // ── 7. Vérifier le badge [1] ──
  console.log('[7] Vérification du badge [1] dans le prompt...')
  console.log('')

  // Chercher le pattern fred [1] > ou fred [2] > ou fred [N] > dans la sortie
  const badgePattern = /\w+\s+\[\d+\]\s*>\s*$/m
  const anyBadgePattern = /\[\d+\]\s*>/m
  
  const hasBadge = anyBadgePattern.test(output)
  const exactBadge = badgePattern.test(output)

  if (hasBadge) {
    // Extraire la ligne du badge
    const lines = output.split('\n')
    const badgeLines = lines.filter(l => /\[\d+\]\s*>/.test(l))
    console.log(`    ✅ Badge détecté dans la sortie !`)
    for (const bl of badgeLines) {
      console.log(`    ${' '.repeat(4)}→ "${bl.trim()}"`)
    }
    console.log('')
  } else {
    console.log(`    ⚠ Aucun badge [N] détecté`)
  }

  // ── 8. Vérifier le fichier telecom/notifications.json ──
  console.log('[8] Vérification du fichier telecom/notifications.json...')
  const notifPath = join(CWD, 'telecom', 'notifications.json')
  if (existsSync(notifPath)) {
    const content = readFileSync(notifPath, 'utf-8').trim()
    if (content && content !== '[]') {
      const notifications = JSON.parse(content)
      console.log(`    📁 ${notifications.length} notification(s) dans le fichier`)
      for (const n of notifications) {
        console.log(`       ${n.from}: ${(n.message ?? '').slice(0, 150)}`)
      }
    } else {
      console.log('    📁 Fichier vide')
    }
  } else {
    console.log('    📁 Fichier introuvable')
  }
  console.log('')

  // ── 9. Bilan ──
  console.log('══════════════════════════════════════════════')
  console.log('  BILAN')
  console.log('══════════════════════════════════════════════')
  console.log('')

  const checks = [
    ['Routeur a matché', routeResponse],
    ['Daemon démarré', daemonStarted],
    ['Notification IPC reçue', notificationReceived],
    ['Badge [N] dans le prompt', hasBadge],
  ]

  let allOk = true
  for (const [name, ok] of checks) {
    const icon = ok ? '✅' : '❌'
    console.log(`  ${icon} ${name}`)
    if (!ok) allOk = false
  }

  console.log('')
  console.log(allOk ? '  ✅ TOUS LES TESTS PASSENT' : '  ⚠ CERTAINS TESTS ONT ÉCHOUÉ')
  console.log('')

  // Nettoyage
  cli.kill()
  clearTimeout(globalTimeout)
  cleanup()

  process.exit(allOk ? 0 : 1)
}

main().catch(err => {
  console.error('Erreur:', err)
  process.exit(1)
})
