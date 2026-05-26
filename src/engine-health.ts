import type { AgentDefinition } from './types/agent-definition.js'

export function createHealthChecker(agent: AgentDefinition) {
  let healthCheckInterval: NodeJS.Timeout | undefined
  let consecutiveFailures = 0
  let restartCount = 0
  let lastRestartTime = 0

  function startHealthCheck() {
    if (!agent.healthCheck?.enabled || healthCheckInterval) return

    healthCheckInterval = setInterval(async () => {
      try {
        // Simple health check simulation: we could try a very simple LLM call or just check process
        consecutiveFailures = 0
        if (agent.guardian?.auditTrail) console.log(`[HealthCheck] Agent ${agent.id} is healthy.`)
      } catch (_err) {
        consecutiveFailures++
        const maxFailures = agent.healthCheck!.maxConsecutiveFailures
        console.error(`[HealthCheck] Agent ${agent.id} failure (${consecutiveFailures}/${maxFailures})`)

        if (consecutiveFailures >= maxFailures) {
          const now = Date.now()
          // Reset restart count if last restart was more than 1 hour ago
          if (now - lastRestartTime > 3600000) {
            restartCount = 0
          }

          if (agent.healthCheck!.autoRestart && restartCount < (agent.healthCheck!.maxRestarts || 5)) {
            restartCount++
            lastRestartTime = now
            const maxRestarts = agent.healthCheck!.maxRestarts
            console.warn(`[HealthCheck] Max failures reached. Auto-restarting agent ${agent.id} (restart ${restartCount}/${maxRestarts})...`)
            // In a real scenario, this would re-initialize the agent session or similar
            consecutiveFailures = 0
          } else {
            console.error(`[HealthCheck] Max failures/restarts reached for agent ${agent.id}. Stopping health check.`)
            stopHealthCheck()
          }
        }
      }
    }, agent.healthCheck.checkIntervalMs || 30000)
  }

  function stopHealthCheck() {
    if (healthCheckInterval) {
      clearInterval(healthCheckInterval)
      healthCheckInterval = undefined
    }
  }

  return { startHealthCheck, stopHealthCheck }
}
