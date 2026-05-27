import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import type { AgentDefinition, SelfCorrection, Guardian, DaemonHealth, Streaming, RateLimit, ToolConfig } from './types/agent-definition.js'

const AGENTS_DIR = join(process.cwd(), '.agents')
const PROFILES_DIR = join(process.cwd(), 'data', 'profiles')

export interface AgentProfile {
  profileName: string
  description: string
  instructionsPrefix: string
  constraints: string[]
  config?: {
    selfCorrection?: SelfCorrection
    guardian?: Guardian
    healthCheck?: DaemonHealth
    streaming?: Streaming
    rateLimit?: RateLimit
    toolConfig?: ToolConfig
  }
}

export function listProfiles(type: 'agents' | 'daemons' | 'bots'): string[] {
  const dir = join(PROFILES_DIR, type)
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''))
}

export function loadProfile(type: 'agents' | 'daemons' | 'bots', profileName: string): AgentProfile | null {
  const filePath = join(PROFILES_DIR, type, `${profileName}.json`)
  if (!existsSync(filePath)) return null
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as AgentProfile
  } catch {
    return null
  }
}

function ensureAgentsDir(): void {
  if (!existsSync(AGENTS_DIR)) {
    try {
      mkdirSync(AGENTS_DIR, { recursive: true })
    } catch (e) {
      const err = e as NodeJS.ErrnoException
      if (err.code === 'EPERM') {
        // Windows race condition : le dossier existe mais est verrouillé (anti-virus, indexation)
        // On ignore — les opérations suivantes confirmeront si le dossier est vraiment inaccessible
        return
      }
      throw e
    }
  }
}

export function listLocalAgents(): { id: string; name: string; file: string }[] {
  ensureAgentsDir()
  const agents: { id: string; name: string; file: string }[] = []
  try {
    const files = readdirSync(AGENTS_DIR).filter(f => (f.endsWith('.ts') || f.endsWith('.json')) && f !== 'tsconfig.json')
    for (const file of files) {
      const filePath = join(AGENTS_DIR, file)
      const content = readFileSync(filePath, 'utf-8')
      try {
        if (file.endsWith('.json')) {
          const def = JSON.parse(content) as AgentDefinition
          agents.push({ id: def.id, name: def.name || def.id, file })
        } else {
          const idMatch = content.match(/id:\s*['"]([^'"]+)['"]/)
          const nameMatch = content.match(/(?:displayName|name):\s*['"]([^'"]+)['"]/)
          agents.push({
            id: idMatch?.[1] || file.replace(/\.(ts|json)$/, ''),
            name: nameMatch?.[1] || idMatch?.[1] || file,
            file,
          })
        }
      } catch {
        agents.push({ id: file.replace(/\.(ts|json)$/, ''), name: file, file })
      }
    }
  } catch {
    /* empty */
  }
  return agents
}

export function readLocalAgent(filename: string): AgentDefinition | null {
  const filePath = join(AGENTS_DIR, filename)
  if (!existsSync(filePath)) return null
  const content = readFileSync(filePath, 'utf-8')
  if (filename.endsWith('.json')) {
    return JSON.parse(content) as AgentDefinition
  }
  const id = content.match(/id:\s*['"]([^'"]+)['"]/)?.[1] || filename.replace('.ts', '')
  const displayName = content.match(/displayName:\s*['"]([^'"]+)['"]/)?.[1] || content.match(/(?:displayName|name):\s*['"]([^'"]+)['"]/)?.[1] || id
  const model = content.match(/model:\s*['"]([^'"]+)['"]/)?.[1] || 'unknown'
  const provider = content.match(/provider:\s*['"]([^'"]+)['"]/)?.[1] || undefined
  const spawnerPrompt = content.match(/spawnerPrompt:\s*['"`]([^'"`]*)['"` ]/)?.[1] || undefined
  const toolsMatch = content.match(/toolNames:\s*\[([^\]]+)\]/)
  const toolNames = toolsMatch
    ? toolsMatch[1].split(',').map(t => t.trim().replace(/['"]/g, ''))
    : []
  const instructionsMatch = content.match(/instructionsPrompt:\s*`([^`]*)`/)
  const instructionsPrompt = instructionsMatch?.[1] || ''

  // Extract spawnableAgents array
  const spawnableAgentsMatch = content.match(/spawnableAgents:\s*\[([^\]]*)\]/)
  const spawnableAgents = spawnableAgentsMatch
    ? spawnableAgentsMatch[1].split(',').map(a => a.trim().replace(/['"]/g, '')).filter(a => a)
    : undefined

  // Helper to parse simple config objects from TS file
  const parseConfig = (key: string) => {
    // Match the config object, handling nested braces and comments
    const regex = new RegExp(`${key}:\\s*({[^{}]*(?:{[^{}]*}[^{}]*)*})`, 's')
    const match = content.match(regex)
    if (!match) return undefined
    try {
      // Very basic "JS object string to JSON" conversion
      const jsonStr = match[1]
        .replace(/\/\/.*$/gm, '') // Remove comments first
        .replace(/(\w+):/g, '"$1":') // Quote keys
        .replace(/'/g, '"') // Replace single quotes with double quotes
        .replace(/,\s*([\]}])/g, '$1') // Remove trailing commas
      return JSON.parse(jsonStr)
    } catch {
      return undefined
    }
  }

  const selfCorrection = parseConfig('selfCorrection')
  const guardian = parseConfig('guardian')
  const healthCheck = parseConfig('healthCheck')
  const streaming = parseConfig('streaming')
  const rateLimit = parseConfig('rateLimit')
  const toolConfig = parseConfig('toolConfig')

  return { 
    id, 
    displayName, 
    model,
    ...(provider && { provider }),
    toolNames, 
    instructionsPrompt,
    ...(spawnerPrompt && { spawnerPrompt }),
    ...(spawnableAgents && { spawnableAgents }),
    selfCorrection,
    guardian,
    healthCheck,
    streaming,
    rateLimit,
    toolConfig
  }
}

const AGENT_TEMPLATE = `import type { AgentDefinition } from '../src/types/agent-definition.js'

const definition: AgentDefinition = {
  id: '{{id}}',
  displayName: '{{displayName}}',
  model: '{{model}}',
{{providerLine}}
  toolNames: [{{tools}}],
  instructionsPrompt: \`{{instructions}}\`,

  // New configurations
  toolConfig: {
    parallelTools: true,
    toolTimeoutMs: 30000,
    maxParallel: 4,
  },
  selfCorrection: {
    enabled: false,
    retryOnFailure: true,
    maxRetries: 2,
    validateOutput: false,
  },
  guardian: {
    enabled: true,
    blockHarmful: true,
    requireConfirmation: false,
    auditTrail: true,
  },
}

export default definition
`

const FAST_BOT_TEMPLATE = `import type { AgentDefinition } from '../src/types/agent-definition.js'

const definition: AgentDefinition = {
  id: '{{id}}',
  displayName: '{{displayName}}',
  model: '{{model}}',
  toolNames: [{{tools}}],
  instructionsPrompt: \`Tu es {{displayName}}.

## Mission
{{mission}}

## Comportement
- Réponds rapidement et de manière concise
- Utilise les outils disponibles quand nécessaire
- Reste concentré sur ta mission principale
- Si tu ne sais pas, dis-le plutôt que d'inventer

## Outils disponibles
- run_terminal_command : exécuter des commandes shell
- add_message : envoyer des notifications
- set_output : produire un résultat structuré
- skill : invoquer une autre skill

## Contraintes
- Ne fais rien en dehors de ta mission
- Respecte les formats de sortie attendus
- Log tes actions importantes via add_message\`,

  // New configurations
  selfCorrection: {
    enabled: true,
    retryOnFailure: true,
    maxRetries: 3,
    validateOutput: true,
  },
  guardian: {
    enabled: true,
    blockHarmful: true,
    requireConfirmation: false,
    auditTrail: true,
  },
  streaming: {
    enabled: true,
    chunkSize: 50,
    showThinking: true,
  },
  toolConfig: {
    parallelTools: true,
    toolTimeoutMs: 30000,
    maxParallel: 5,
  },
  rateLimit: {
    enabled: true,
    requestsPerMinute: 60,
    burst: 10,
    backoffMultiplier: 1.5,
  },
}

export default definition
`

const DAEMON_TEMPLATE = `import type { AgentDefinition } from '../src/types/agent-definition.js'

declare function pushNotification(from: string, message: string): void

const definition: AgentDefinition = {
  id: '{{id}}',
  displayName: '{{displayName}}',
  model: '{{model}}',
  toolNames: ['run_terminal_command', 'add_message', 'set_output'],
  instructionsPrompt: \`Daemon background agent. Mission: {{mission}}\`,

  // New configurations
  healthCheck: {
    enabled: true,
    checkIntervalMs: 30000,
    maxConsecutiveFailures: 3,
    autoRestart: true,
    maxRestarts: 5,
  },
  guardian: {
    enabled: true,
    blockHarmful: true,
    requireConfirmation: true,
    auditTrail: true,
  },
}

export default definition

export const daemonConfig = {
  defaultIntervalMs: 60000,
  defaultNotificationMessage: "{{notification_message}}",
}

export async function initializeAgent() {
  console.log(\`[\${definition.displayName}] Daemon initialization...\`);
  return Promise.resolve();
}

export async function runAgentTask(instruction?: string) {
  const interval = instruction ? parseInterval(instruction) : daemonConfig.defaultIntervalMs;
  console.log(\`[\${definition.displayName}] Running task every \${interval}ms\`);
  pushNotification(definition.displayName, daemonConfig.defaultNotificationMessage);
}

function parseInterval(input: string): number {
  if (input.endsWith('m')) return parseInt(input.slice(0, -1)) * 60000;
  if (input.endsWith('h')) return parseInt(input.slice(0, -1)) * 3600000;
  return daemonConfig.defaultIntervalMs;
}
`

export function scaffoldAgent(
  id: string,
  name: string,
  model: string,
  tools: string[],
  instructions: string,
  force = false,
  template: 'standard' | 'fast' | 'daemon' = 'standard',
  profile?: AgentProfile,
  maxParallel?: number,
  provider?: string,
): string {
  ensureAgentsDir()
  const filename = `${id}.ts`
  const filePath = join(AGENTS_DIR, filename)

  if (existsSync(filePath) && !force) {
    throw new Error(`Agent "${id}" already exists at ${filePath}`)
  }

  const toolsStr = tools.map(t => `'${t}'`).join(', ')
  let templateContent = AGENT_TEMPLATE
  if (template === 'fast') templateContent = FAST_BOT_TEMPLATE
  if (template === 'daemon') templateContent = DAEMON_TEMPLATE

  // Merge profile if provided
  let finalInstructions = instructions
  if (profile) {
    const constraintsStr = profile.constraints.map(c => `- ${c}`).join('\n')
    finalInstructions = `${profile.instructionsPrefix}\n\n## Mission\n${instructions}\n\n## Contraintes\n${constraintsStr}`
  }

  let content = templateContent
    .replace(/\{\{id\}\}/g, id)
    .replace(/\{\{displayName\}\}/g, name)
    .replace(/\{\{model\}\}/g, model)
    // Remplacer la ligne provider (conditionnelle : omise si pas de provider)
    const providerLine = provider ? `  provider: '${provider}',` : ''
    content = content.replace('{{providerLine}}', providerLine)
    .replace(/\{\{tools\}\}/g, toolsStr)
    .replace(/\{\{instructions\}\}/g, finalInstructions)

  if (template === 'fast') {
    content = content.replace(/\{\{mission\}\}/g, instructions.split('\n')[0] || instructions)
  }
  if (template === 'daemon') {
    content = content.replace(/\{\{mission\}\}/g, instructions.split('\n')[0] || instructions)
    content = content.replace(/\{\{notification_message\}\}/g, instructions.split('\n')[0] || 'Reminder notification')
  }

  // Inject profile config if available (strip template defaults first)
  if (profile?.config) {
    const configKeys = ['selfCorrection', 'guardian', 'healthCheck', 'streaming', 'rateLimit', 'toolConfig']
    for (const key of configKeys) {
      const profileVal = (profile.config as Record<string, unknown>)[key]
      if (profileVal) {
        const regex = new RegExp(`  ${key}:\\s*\\{[^}]*\\},?\\s*`, 'g')
        content = content.replace(regex, '')
      }
    }
    const configLines: string[] = []
    if (profile.config.selfCorrection) configLines.push(`  selfCorrection: ${JSON.stringify(profile.config.selfCorrection, null, 2).replace(/\n/g, '\n  ')},`)
    if (profile.config.guardian) configLines.push(`  guardian: ${JSON.stringify(profile.config.guardian, null, 2).replace(/\n/g, '\n  ')},`)
    if (profile.config.healthCheck) configLines.push(`  healthCheck: ${JSON.stringify(profile.config.healthCheck, null, 2).replace(/\n/g, '\n  ')},`)
    if (profile.config.streaming) configLines.push(`  streaming: ${JSON.stringify(profile.config.streaming, null, 2).replace(/\n/g, '\n  ')},`)
    if (profile.config.rateLimit) configLines.push(`  rateLimit: ${JSON.stringify(profile.config.rateLimit, null, 2).replace(/\n/g, '\n  ')},`)
    if (profile.config.toolConfig) configLines.push(`  toolConfig: ${JSON.stringify(profile.config.toolConfig, null, 2).replace(/\n/g, '\n  ')},`)

    if (configLines.length > 0) {
      const lastBraceIndex = content.lastIndexOf('}')
      content = content.slice(0, lastBraceIndex) + '\n  // Profile Config\n' + configLines.join('\n') + '\n}' + content.slice(lastBraceIndex + 1)
    }
  }

  // Ensure toolConfig has all required fields (parallelTools, toolTimeoutMs, maxParallel)
  if (maxParallel && maxParallel > 1) {
    const toolConfigRegex = /toolConfig:\s*\{([^}]*)\}/
    const match = content.match(toolConfigRegex)
    const requiredFields = [
      { key: 'parallelTools', value: 'true' },
      { key: 'toolTimeoutMs', value: '30000' },
      { key: 'maxParallel', value: String(maxParallel) },
    ]
    if (match) {
      let existing = match[1]
      for (const field of requiredFields) {
        const regex = new RegExp(`${field.key}:\\s*[^,\\}]+`)
        if (regex.test(existing)) {
          existing = existing.replace(regex, `${field.key}: ${field.value}`)
        } else {
          existing = existing.trimEnd() + (existing.endsWith(',') || existing.trim().endsWith(',') ? '' : ',') + `\n    ${field.key}: ${field.value}`
        }
      }
      content = content.replace(toolConfigRegex, `toolConfig: {${existing}}`)
    } else {
      const lastBraceIndex = content.lastIndexOf('}')
      content = content.slice(0, lastBraceIndex) + `\n  toolConfig: {
    parallelTools: true,
    toolTimeoutMs: 30000,
    maxParallel: ${maxParallel},
  },\n` + content.slice(lastBraceIndex)
    }
  }

  writeFileSync(filePath, content, 'utf-8')
  return filePath
}

export function removeLocalAgent(filename: string): boolean {
  const filePath = join(AGENTS_DIR, filename)
  if (!existsSync(filePath)) return false
  try {
    unlinkSync(filePath)
    return true
  } catch {
    return false
  }
}

export function updateAgentFile(
  filename: string,
  updates: { name?: string; instructionsPrompt?: string; model?: string; provider?: string; toolConfig?: ToolConfig },
): boolean {
  const filePath = join(AGENTS_DIR, filename)
  if (!existsSync(filePath)) return false
  let content = readFileSync(filePath, 'utf-8')

  if (updates.name !== undefined) {
    content = content.replace(/displayName:\s*['"][^'"]*['"]/, `displayName: '${updates.name}'`)
  }
  if (updates.model !== undefined) {
    content = content.replace(/model:\s*['"][^'"]*['"]/, `model: '${updates.model}'`)
  }
  if (updates.provider !== undefined) {
    // Check if provider field already exists
    if (content.includes('provider:')) {
      content = content.replace(/provider:\s*['"][^'"]*['"]/, `provider: '${updates.provider}'`)
    } else {
      // Add provider field after model line
      content = content.replace(/(model:\s*['"][^'"]*['"],?)/, `$1\n  provider: '${updates.provider}',`)
    }
  }
  if (updates.toolConfig !== undefined) {
    // Update or add toolConfig
    const toolConfigStr = JSON.stringify(updates.toolConfig, null, 2)
      .split('\n')
      .map((line, i) => i === 0 ? line : '    ' + line)
      .join('\n')
    
    if (content.includes('toolConfig:')) {
      // Replace existing toolConfig
      content = content.replace(/toolConfig:\s*{[^}]*}/, `toolConfig: ${toolConfigStr}`)
    } else {
      // Add toolConfig after model/provider
      content = content.replace(/(provider:\s*['"][^'"]*['"],?|model:\s*['"][^'"]*['"],?)/, `$1\n  toolConfig: ${toolConfigStr},`)
    }
  }
  if (updates.instructionsPrompt !== undefined) {
    content = content.replace(/instructionsPrompt:\s*`[^`]*`/, `instructionsPrompt: \`${updates.instructionsPrompt}\``)
  }

  writeFileSync(filePath, content, 'utf-8')
  return true
}
