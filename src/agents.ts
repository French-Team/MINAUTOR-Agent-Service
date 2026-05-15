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

export function scaffoldAgent(
  id: string,
  name: string,
  model: string,
  tools: string[],
  instructions: string,
  force = false,
): string {
  ensureAgentsDir()
  const filename = `${id}.ts`
  const filePath = join(AGENTS_DIR, filename)

  if (existsSync(filePath) && !force) {
    throw new Error(`Agent "${id}" already exists at ${filePath}`)
  }

  const toolsStr = tools.map(t => `'${t}'`).join(', ')
  const content = AGENT_TEMPLATE
    .replace(/\{\{id\}\}/g, id)
    .replace(/\{\{displayName\}\}/g, name)
    .replace(/\{\{model\}\}/g, model)
    .replace(/\{\{tools\}\}/g, toolsStr)
    .replace(/\{\{instructions\}\}/g, instructions)

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
