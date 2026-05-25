import type { AgentDefinition } from './types/agent-definition.js'

export function createRateLimiter(agent: AgentDefinition) {
  const lastRequestTimes: number[] = []

  async function checkRateLimit() {
    if (!agent.rateLimit?.enabled) return

    const now = Date.now()
    const oneMinuteAgo = now - 60000

    // Filter out old requests
    while (lastRequestTimes.length > 0 && lastRequestTimes[0] < oneMinuteAgo) {
      lastRequestTimes.shift()
    }

    const limit = agent.rateLimit.requestsPerMinute
    const burst = agent.rateLimit.burst || 0

    if (lastRequestTimes.length >= limit + burst) {
      const waitTime = Math.max(0, 60000 - (now - lastRequestTimes[0]))
      if (waitTime > 0) {
        console.log(`Rate limit reached (${limit} req/min + ${burst} burst). Waiting ${Math.round(waitTime / 1000)}s...`)
        await new Promise(resolve => setTimeout(resolve, waitTime))
      }
      return checkRateLimit() // Re-check after waiting
    }

    lastRequestTimes.push(now)
  }

  return { checkRateLimit }
}
