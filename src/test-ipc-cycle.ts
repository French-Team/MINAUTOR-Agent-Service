/**
 * Test du cycle IPC temps réel
 * Vérifie que spawn-agent émet bien une notification IPC
 * et que le message arrive chez l'écouteur (simule le CLI).
 *
 * Usage: npx tsx src/test-ipc-cycle.ts
 */

import { fork, ChildProcess } from 'child_process'
import { join } from 'path'
import { unlinkSync, existsSync, writeFileSync, readFileSync, readdirSync } from 'fs'
import { tryRouteIntercom } from './cli-intercom-router.js'

const CWD = process.cwd()

function cleanup(): void {
  const notifPath = join(CWD, 'telecom', 'notifications.json')
  if (existsSync(notifPath)) unlinkSync(notifPath)
  for (const dir of ['telecom/intercom', 'telecom/routed']) {
    const d = join(CWD, dir)
    if (existsSync(d)) {
      for (const f of ['*.json']) {
        try {
          const files = readdirSync(d).filter((x: string) => x.endsWith('.json'))
          for (const file of files) {
            unlinkSync(join(d, file))
          }
        } catch { /* empty dir */ }
      }
    }
  }
}

function writeIntercomMessage(): void {
  // Simuler ce que le routeur fait
  const result = tryRouteIntercom('je veux debugger un probleme')
  console.log(`[ROUTEUR] → ${result?.subject ?? 'PASSE'}`)
}

async function testCycle(): Promise<void> {
  console.log('=== TEST CYCLE IPC TEMPS RÉEL ===\n')
  cleanup()

  // 1. Écrire le message intercom
  writeIntercomMessage()
  console.log('[1] Message intercom écrit dans telecom/intercom/\n')

  // 2. Lancer le daemon --once pour router et spawn
  console.log('[2] Lancement du daemon --once pour routage...')
  const daemonPath = join(CWD, 'dist', 'telecom', 'service', 'telecom-daemon.js')
  const daemon = fork(daemonPath, ['--once'], {
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  })

  let daemonOutput = ''
  daemon.stdout?.on('data', (d: Buffer) => { daemonOutput += d.toString() })
  daemon.stderr?.on('data', (d: Buffer) => { daemonOutput += d.toString() })

  daemon.on('message', (msg: unknown) => {
    const data = msg as { type?: string; from?: string; message?: string }
    if (data?.type === 'notification') {
      console.log(`[IPC ← DAEMON] Notification reçue !`)
      console.log(`  From   : ${data.from}`)
      console.log(`  Message: ${(data.message ?? '').slice(0, 150)}\n`)
    }
  })

  // Attendre que le daemon finisse
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      console.log('[TIMEOUT] Daemon --once a pris trop de temps')
      daemon.kill()
      resolve()
    }, 15000)

    daemon.on('exit', () => {
      clearTimeout(timeout)
      resolve()
    })
  })

  console.log('[2] Daemon terminé\n')

  // 3. Vérifier que spawn-agent a été lancé (le daemon le fork)
  //    Le spawn-agent tourne encore, le daemon --once est déjà parti
  console.log('[3] Attente de spawn-agent (appel LLM ~30-60s)...')
  console.log('    Notification IPC devrait arriver automatiquement\n')

  // 4. Attendre la notification IPC de spawn-agent
  //    spawn-agent a été forké par le daemon avec ['ignore', 'pipe', 'pipe', 'ipc']
  //    Donc spawn-agent peut utiliser process.send()
  //    Mais le daemon --once est parti ! Le message IPC n'a pas de parent pour le recevoir.
  //    On doit donc vérifier le fichier .notifications.json à la place.

  // Attendre un peu que spawn-agent ait le temps d'écrire
  await new Promise<void>((resolve) => {
    let attempts = 0
    const check = setInterval(() => {
      attempts++
      if (existsSync(join(CWD, 'telecom', 'notifications.json'))) {
        const content = readFileSync(join(CWD, 'telecom', 'notifications.json'), 'utf-8').trim()
        if (content && content !== '[]') {
          clearInterval(check)
          console.log(`[3] Fichier telecom/notifications.json détecté après ~${attempts}s\n`)
          resolve()
          return
        }
      }
      if (attempts >= 90) { // 90s timeout
        clearInterval(check)
        console.log('[3] TIMEOUT - spawn-agent trop long\n')
        resolve()
      }
    }, 1000)
  })

  // 5. Afficher les résultats
  console.log('=== RÉSULTATS ===\n')

  // Vérifier les notifications fichier
  const notifPath = join(CWD, 'telecom', 'notifications.json')
  if (existsSync(notifPath)) {
    const content = readFileSync(notifPath, 'utf-8').trim()
    if (content && content !== '[]') {
      const notifications = JSON.parse(content)
      console.log(`📁 telecom/notifications.json : ${notifications.length} notification(s)`)
      for (const n of notifications) {
        console.log(`   ${n.from}: ${(n.message ?? '').slice(0, 200)}`)
      }
    } else {
      console.log('📁 telecom/notifications.json : vide')
    }
  } else {
    console.log('📁 telecom/notifications.json : fichier introuvable')
  }

  // Vérifier les messages IPC reçus via le daemon
  console.log(`\n📡 IPC reçu du daemon: (vérifier ci-dessus [IPC ← DAEMON])`)

  // Vérifier les fichiers intercom/routed
  const intercomDir = join(CWD, 'telecom', 'intercom')
  const routedDir = join(CWD, 'telecom', 'routed')
  console.log(`\n📂 telecom/intercom/ : ${existsSync(intercomDir) ? readdirSync(intercomDir).filter((x: string) => x.endsWith('.json')).length : 0} fichier(s)`)
  console.log(`📂 telecom/routed/   : ${existsSync(routedDir) ? readdirSync(routedDir).filter((x: string) => x.endsWith('.json')).length : 0} fichier(s)`) 

  console.log(`\n=== TEST TERMINÉ ===`)

  // Nettoyer
  cleanup()
}

testCycle().catch(err => {
  console.error('Erreur:', err)
  process.exit(1)
})
