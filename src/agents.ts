import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'
import type { AgentDefinition } from './types/agent-definition.js'

const AGENTS_DIR = join(process.cwd(), '.agents')

function ensureAgentsDir(): void {
  if (!existsSync(AGENTS_DIR)) {
    mkdirSync(AGENTS_DIR, { recursive: true })
  }
}

export function listLocalAgents(): { id: string; name: string; file: string }[] {
  ensureAgentsDir()
  const agents: { id: string; name: string; file: string }[] = []
  try {
    const files = readdirSync(AGENTS_DIR).filter(f => f.endsWith('.ts') || f.endsWith('.json'))
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
          const modelMatch = content.match(/model:\s*['"]([^'"]+)['"]/)
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
  const toolsMatch = content.match(/toolNames:\s*\[([^\]]+)\]/)
  const toolNames = toolsMatch
    ? toolsMatch[1].split(',').map(t => t.trim().replace(/['"]/g, ''))
    : []
  const instructionsMatch = content.match(/instructionsPrompt:\s*`([^`]*)`/)
  const instructionsPrompt = instructionsMatch?.[1] || ''

  return { id, displayName, model, toolNames, instructionsPrompt }
}

const AGENT_TEMPLATE = `import type { AgentDefinition } from './types/agent-definition'

const definition: AgentDefinition = {
  id: '{{id}}',
  displayName: '{{displayName}}',
  model: '{{model}}',
  toolNames: [{{tools}}],
  instructionsPrompt: \`{{instructions}}\`,
}

export default definition
`

const FAST_BOT_TEMPLATE = `import type { AgentDefinition } from './types/agent-definition'

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
}

export default definition
`

const DAEMON_TEMPLATE = `import type { AgentDefinition } from './types/agent-definition'

declare function pushNotification(from: string, message: string): void

const definition: AgentDefinition = {
  id: '{{id}}',
  displayName: '{{displayName}}',
  model: '{{model}}',
  toolNames: ['run_terminal_command', 'add_message', 'set_output'],
  instructionsPrompt: \`Daemon background agent. Mission: {{mission}}\`,
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

  let content = templateContent
    .replace(/\{\{id\}\}/g, id)
    .replace(/\{\{displayName\}\}/g, name)
    .replace(/\{\{model\}\}/g, model)
    .replace(/\{\{tools\}\}/g, toolsStr)
    .replace(/\{\{instructions\}\}/g, instructions)

  if (template === 'fast') {
    content = content.replace(/\{\{mission\}\}/g, instructions.split('\n')[0] || instructions)
  }
  if (template === 'daemon') {
    content = content.replace(/\{\{mission\}\}/g, instructions.split('\n')[0] || instructions)
    content = content.replace(/\{\{notification_message\}\}/g, instructions.split('\n')[0] || 'Reminder notification')
  }

  writeFileSync(filePath, content, 'utf-8')
  return filePath
}

export function removeLocalAgent(filename: string): boolean {
  const filePath = join(AGENTS_DIR, filename)
  if (!existsSync(filePath)) return false
  try {
    const { unlinkSync } = require('fs')
    unlinkSync(filePath)
    return true
  } catch {
    return false
  }
}

export function updateAgentFile(
  filename: string,
  updates: { name?: string; instructionsPrompt?: string; model?: string },
): boolean {
  const filePath = join(AGENTS_DIR, filename)
  if (!existsSync(filePath)) return false
  let content = readFileSync(filePath, 'utf-8')

  if (updates.name !== undefined) {
    content = content.replace(/(name|displayName):\s*'[^']*'/, `name: '${updates.name}'`)
  }
  if (updates.model !== undefined) {
    content = content.replace(/model:\s*'[^']*'/, `model: '${updates.model}'`)
  }
  if (updates.instructionsPrompt !== undefined) {
    content = content.replace(/instructionsPrompt:\s*`[^`]*`/, `instructionsPrompt: \`${updates.instructionsPrompt}\``)
  }

  writeFileSync(filePath, content, 'utf-8')
  return true
}
