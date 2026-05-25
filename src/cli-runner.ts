import { fork, ChildProcess } from 'child_process'
import { join } from 'path'
import { openSync, existsSync } from 'fs'
import { RED, GREEN, GRAY, YELLOW, RESET, CYAN, LIME, BOLD } from './constants.js'
import { levelIcon, shouldShowNotification, removeNotification, type NotificationLevel } from './notify.js'
import type { Engine } from './engine.js'

/**
 * Process a shell command or assistant message line (!cmd, !spawn, @message).
 * Returns true if the line was handled (the caller should continue), false otherwise.
 */
export async function handleShellLine(
  line: string,
  engine: Engine,
  backgroundAgents: Map<string, ChildProcess>,
): Promise<boolean> {
  // special: !spawn <agent-id> <instruction>
  if (line.startsWith('!spawn ')) {
    const rest = line.slice(7).trim()
    const spaceIdx = rest.indexOf(' ')
    if (spaceIdx === -1) {
      console.log(`${YELLOW}Usage: !spawn <agent-id> <instruction>${RESET}`)
      return true
    }
    const targetAgent = rest.slice(0, spaceIdx)
    const instruction = rest.slice(spaceIdx + 1)

    // timer-man est un agent long-running (daemon)
    if (targetAgent === 'timer-man') {
      const logPath = join(process.cwd(), 'logs', 'timer-man.log')
      if (!existsSync(join(process.cwd(), 'logs'))) {
        const { mkdirSync } = await import('fs')
        mkdirSync(join(process.cwd(), 'logs'), { recursive: true })
      }
      const outFd = openSync(logPath, 'a')
      console.log(`\n${YELLOW}⟳ Démarrage de "${targetAgent}" en arrière-plan...${RESET}`)
      const child = fork(join(import.meta.dirname, 'timer-agent.js'), [instruction || '1h'], {
        stdio: ['ignore', outFd, outFd, 'ipc'],
        detached: false,
      })
      backgroundAgents.set('timer-man', child)
      child.on('exit', (code) => {
        backgroundAgents.delete('timer-man')
        if (code !== 0) console.log(`\n${YELLOW}⏹ Timer arrêté (code: ${code})${RESET}\n`)
      })
      console.log(`${GREEN}✓ Timer lancé (PID: ${child.pid})${RESET}`)
      console.log(`${GRAY}   Intervalle : ${instruction || '1h'}${RESET}`)
      console.log(`${GRAY}   Logs : ${logPath}${RESET}`)
      console.log(`${GRAY}   /kill timer-man pour arrêter${RESET}\n`)
      return true
    }

    // agents standard (one-shot)
    console.log(`\n${YELLOW}⟳ Spawn de "${targetAgent}"...${RESET}`)
    const child = fork(join(import.meta.dirname, 'spawn-agent.js'), [targetAgent, instruction], { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] })
    let output = ''
    child.stdout?.on('data', (d: Buffer) => { output += d.toString() })
    child.stderr?.on('data', (d: Buffer) => { output += `${RED}${d.toString()}${RESET}` })

    // Recevoir les notifications IPC en temps réel pendant l'exécution
    child.on('message', (msg: unknown) => {
      const data = msg as { type?: string; id?: string; from?: string; message?: string; level?: string }
      if (data?.type === 'notification' && data.message && data.id) {
        // Vérifier le filtre actif avant d'afficher
        const notifLevel = (data.level ?? 'info') as NotificationLevel
        if (!shouldShowNotification(notifLevel)) return

        // Supprimer la notification du fichier pour éviter
        // le double-affichage par popAllNotifications() au prochain prompt
        removeNotification(data.id)

        const icon = levelIcon(notifLevel)
        const msgLines = data.message.split('\n')
        process.stdout.write(`\n${BOLD}${LIME}╔ Notification${RESET}\n`)
        process.stdout.write(`${BOLD}${LIME}║  ${RESET}${icon} ${YELLOW}${data.from}${RESET}\n`)
        for (const line of msgLines) {
          if (line) {
            process.stdout.write(`${BOLD}${LIME}║${RESET}    ${line}\n`)
          } else {
            process.stdout.write(`${BOLD}${LIME}║${RESET}\n`)
          }
        }
        process.stdout.write(`${BOLD}${LIME}╚${RESET}\n`)
      }
    })

    await new Promise<void>(resolve => { child.on('exit', () => resolve()) })
    console.log(`${GREEN}✓ Agent "${targetAgent}" terminé${RESET}`)
    if (output.trim()) console.log(`\n${output.trim()}\n`)
    console.log(`${GRAY}   Voir telecom/agent-logbook.md pour tous les détails.${RESET}\n`)
    return true
  }

  // regular !command or @message → runPrompt
  const result = await engine.runPrompt(line)
  for (const tc of result.toolCalls) {
    switch (tc.toolName) {
      case 'run_terminal_command': {
        const inp = tc.input as { command: string }
        console.log(`${GRAY}$ ${inp.command}${RESET}`)
        break
      }
      case 'add_message': {
        const inp = tc.input as { role: string; content: string }
        console.log(`${CYAN}@ ${inp.content}${RESET}`)
        break
      }
    }
  }
  if (result.response) console.log(`${result.response}\n`)
  return true
}
