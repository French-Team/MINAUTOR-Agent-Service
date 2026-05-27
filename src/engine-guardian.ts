import { exec } from 'child_process'
import { promisify } from 'util'
import { injectKitsIntoCommand, scanCommandOutput } from './kits-injector.js'
import { getFeuRougeClient } from './feurouge/feurouge-client.js'
import type { AgentDefinition } from './types/agent-definition.js'

const execAsync = promisify(exec)

export function createCommandRunner(cwd: string, agent: AgentDefinition) {

  async function runTerminalCommand(command: string, processType: 'SYNC' | 'BACKGROUND' = 'SYNC', timeoutSeconds = 60): Promise<string> {
    // ── FeuRouge check — vérifier les permissions AVANT l'exécution ──
    const feurouge = getFeuRougeClient()
    if (feurouge.isAlive()) {
      const check = await feurouge.checkCommand(agent.id, command, cwd)
      if (!check.allowed) {
        const msg = `FeuRouge: Commande bloquée — ${check.reason || 'Permission non accordée'} pour l'agent ${agent.id}`
        if (agent.guardian?.auditTrail) console.warn(`[FeuRouge Audit] ${msg}`)
        return msg
      }
    }

    // ── Injection automatique des imports de kits ──────────────
    let augmentedCommand: string
    try {
      augmentedCommand = injectKitsIntoCommand(command, cwd)
    } catch {
      augmentedCommand = command // Fallback : commande originale
    }

    // Increase default timeout for complex tasks like "pisteur"
    const timeout = timeoutSeconds * 1000

    // Guardian check
    if (agent.guardian?.enabled) {
      const harmfulPatterns = [
        /\brm\s+-[rf]+\b/i, /\brmdir\b/i, /\bdel\s+\/s\b/i, /\bunlink\b/i, /\bformat\b/i,
        /\bdrop\s+table\b/i, /\bdrop\s+database\b/i,
        /\bdelete\s+from\s+\w+(?!\s+where)\b/i,
        /\/etc\/(passwd|shadow|group)\b/i,
        /C:\\Windows\\System32\b/i,
        /\bcurl\s+.*\s*\|\s*(bash|sh|python|node)\b/i,
        /\bwget\s+.*\s*\|\s*(bash|sh|python|node)\b/i,
        /\bnc\s+-e\b/i, /\bnetcat\s+-e\b/i
      ]

      const customPatterns = (agent.guardian.blockedPatterns || []).map(p => new RegExp(p, 'i'))
      const allPatterns = [...harmfulPatterns, ...customPatterns]

      if (agent.guardian.blockHarmful && allPatterns.some(p => p.test(augmentedCommand))) {
        const msg = `Guardian: Blocked potentially harmful command: ${augmentedCommand}`
        if (agent.guardian.auditTrail) console.warn(`[Guardian Audit] ${msg}`)
        return msg
      }

      if (agent.guardian.requireConfirmation) {
        const msg = `Guardian: Command requires confirmation: ${augmentedCommand}`
        if (agent.guardian.auditTrail) console.warn(`[Guardian Audit] ${msg}`)
        return msg
      }

      if (agent.guardian.auditTrail) {
        console.log(`[Guardian Audit] Executing command: ${augmentedCommand}`)
      }
    }

    try {
      if (processType === 'BACKGROUND') {
        exec(augmentedCommand, { cwd, windowsHide: true }, (error) => {
          if (error && agent.guardian?.auditTrail) {
            console.error(`[Background Error] ${augmentedCommand}: ${error.message}`)
          }
        })
        return `Command started in background: ${augmentedCommand}`
      }

      const { stdout, stderr } = await execAsync(augmentedCommand, {
        cwd,
        maxBuffer: 50 * 1024 * 1024, // Increased to 50MB for large project mapping
        timeout,
        windowsHide: true,
      })

      // ── Scan post-écriture : vérifie la conformité des imports de kits ──
      const output = stdout?.trim() || stderr?.trim() || ''
      const scanWarning = scanCommandOutput(augmentedCommand, cwd)
      return scanWarning ? `${output}\n${scanWarning}` : output
    } catch (err: unknown) {
      const error = err as { stdout?: string; stderr?: string; message?: string; code?: string | number }

      // Handle timeout specifically
      if (error.code === 'ETIMEDOUT' || error.message?.includes('timeout')) {
        return `Error: Command timed out after ${timeoutSeconds}s`
      }

      if (error.stdout) return error.stdout.trim()
      if (error.stderr) return error.stderr.trim()
      return `Error: ${error.message || 'Command failed'}`
    }
  }

  return { runTerminalCommand }
}
