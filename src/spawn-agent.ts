/**
 * Spawn runner — exécute un agent en sous-processus.
 * Appelé par le CLI via child_process.fork().
 *
 * Usage : node dist/spawn-agent.js <agent-id> <instruction>
 */

import { existsSync, readFileSync, appendFileSync } from 'fs'
import { join } from 'path'
import { createEngine } from './engine.js'
import { readLocalAgent } from './agents.js'
import { resolveProviderForModel } from './providers.js'

const [, , agentId, ...rest] = process.argv
const instruction = rest.join(' ')

if (!agentId || !instruction) {
  console.error('Usage: spawn-agent <agent-id> "<instruction>"')
  process.exit(1)
}

const agentsDir = join(process.cwd(), '.agents')
const logbookPath = join(process.cwd(), 'agent-logbook.md')

// ensure logbook exists
if (!existsSync(logbookPath)) {
  appendFileSync(logbookPath, '# Agent Logbook\n\n', 'utf-8')
}

async function main() {
  // find agent file
  const files = [ `${agentId}.ts`, `${agentId}.json` ]
  let agentFile: string | undefined
  for (const f of files) {
    if (existsSync(join(agentsDir, f))) { agentFile = f; break }
  }
  if (!agentFile) {
    // try listing agents
    const { listLocalAgents } = await import('./agents.js')
    const agents = listLocalAgents()
    const match = agents.find(a => a.id === agentId || a.id.startsWith(agentId))
    if (!match) {
      console.error(`Agent "${agentId}" introuvable.`)
      process.exit(1)
    }
    agentFile = match.file
  }

  const agentDef = readLocalAgent(agentFile)
  if (!agentDef) {
    console.error(`Impossible de charger "${agentFile}".`)
    process.exit(1)
  }

  const engine = createEngine({ agent: agentDef })
  engine.createSession()
  engine.addMessage('user', instruction)

  const resolved = resolveProviderForModel(agentDef.model)
  if (!resolved) {
    appendFileSync(logbookPath, `\n## ${agentDef.name} (${agentDef.id})\n\n**Erreur :** Aucun provider configuré pour le modèle ${agentDef.model}\n\n`, 'utf-8')
    process.exit(0)
  }

  const systemPrompt = agentDef.instructionsPrompt || 'You are a helpful assistant.'
  try {
    const response = await engine.callLLM(instruction, resolved, systemPrompt)
    engine.addMessage('assistant', response)

    const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ')
    const entry = [
      `\n## ${agentDef.name} (${agentDef.id})\n`,
      `**Date :** ${timestamp}`,
      `**Instruction :** ${instruction}`,
      `**Provider :** ${resolved.provider} / ${resolved.model}`,
      `**Réponse :**\n${response}\n`,
    ].join('\n')

    appendFileSync(logbookPath, entry, 'utf-8')
    console.log(response)
  } catch (err) {
    const msg = (err as Error).message
    const errorEntry = `\n## ${agentDef.name} (${agentDef.id})\n\n**Erreur :** ${msg.slice(0, 200)}\n\n`
    appendFileSync(logbookPath, errorEntry, 'utf-8')
    console.error(`Erreur: ${msg}`)
  }

  process.exitCode = 0
}

main().catch(err => {
  console.error(err.message)
  process.exitCode = 1
})
