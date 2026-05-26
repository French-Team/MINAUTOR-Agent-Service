import type { EngineConfig } from './engine-types.js'
import { createSessionManager } from './engine-sessions.js'
import { createRateLimiter } from './engine-rate-limit.js'
import { createHealthChecker } from './engine-health.js'
import { createCommandRunner } from './engine-guardian.js'
import { createToolExecutor } from './engine-executor.js'
import { createRunner } from './engine-runner.js'
import { getNextApiKey, markRateLimited, getKeyIdByKey, getKeyById } from './providers.js'

export { type LLMProvider } from './engine-types.js'
export {
  injectKits,
  injectKitsIntoCommand,
  scanCommandOutput,
  extractTargetFilePath,
  expandBrace,
  extractFindTargets,
  detectKitMarkers,
  findKit,
  getKitNames,
  getKitInfo,
  suggestKits,
  scanFile,
  loadRegistry,
  clearRegistryCache,
} from './kits-injector.js'

export function createEngine(config: EngineConfig) {
  const cwd = config.cwd || process.cwd()
  const agent = config.agent

  // Initialize sub-modules
  const { checkRateLimit } = createRateLimiter(agent)
  const sessionManager = createSessionManager()
  const healthChecker = createHealthChecker(agent)
  const { runTerminalCommand } = createCommandRunner(cwd, agent)
  const { executeTool, processTools } = createToolExecutor(
    runTerminalCommand,
    sessionManager.addMessage,
    sessionManager.setOutput,
    agent.toolConfig,
  )

  const {
    createSession,
    getCurrentSession,
    getSession,
    listSessions,
    addMessage,
  } = sessionManager

  const {
    startHealthCheck,
    stopHealthCheck,
  } = healthChecker

  const { runPrompt, callLLM } = createRunner({
    addMessage,
    runTerminalCommand,
    checkRateLimit,
    processTools,
    agent,
    getNextKey: getNextApiKey,
    markRateLimited,
    getKeyIdByKey,
    getKeyById,
  })

  return {
    runTerminalCommand,
    addMessage,
    setOutput: sessionManager.setOutput,
    createSession,
    getCurrentSession,
    getSession,
    listSessions,
    runPrompt,
    callLLM,
    processTools,
    executeTool,
    startHealthCheck,
    stopHealthCheck,
    agent,
    cwd,
  }
}

export type Engine = ReturnType<typeof createEngine>
