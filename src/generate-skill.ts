import { mkdirSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { createEngine, type LLMProvider } from './engine.js'
import type { AgentDefinition } from './types/agent-definition.js'

const SKILLS_DIR = join(process.cwd(), 'skills')

const GENERATION_PROMPT = (name: string, description: string) => `Tu es un expert en création de skills pour agents AI.

L'utilisateur veut créer un agent avec :
- Nom : ${name}
- Description : ${description}

Génère une skill complète au format SKILL.md pour cet agent.

Format attendu :
---
name: skill-{id-du-agent}
description: {description courte de la skill}
---

# Skill: {Nom de l'agent}

## Mission

{mission principale de l'agent}

## Comportement

{comportement attendu}

## Compétences

{liste des compétences}

## Règles

{règles de l'agent}

Réponds UNIQUEMENT avec le contenu complet du SKILL.md, sans commentaires supplémentaires.`

export interface GenerateSkillResult {
  skillId: string
  fileName: string
  content: string
  path: string
}

export async function generateSkill(
  agentId: string,
  agentName: string,
  description: string,
  llm: LLMProvider,
): Promise<GenerateSkillResult> {
  const skillId = `skill-${agentId}`
  const skillDir = join(SKILLS_DIR, skillId)
  const skillPath = join(skillDir, 'SKILL.md')

  if (!existsSync(SKILLS_DIR)) mkdirSync(SKILLS_DIR, { recursive: true })
  if (!existsSync(skillDir)) mkdirSync(skillDir, { recursive: true })

  const engine = createEngine({
    agent: {
      id: 'skill-generator',
      displayName: 'Skill Generator',
      model: llm.model,
      instructionsPrompt: 'Tu génères des fichiers SKILL.md.',
      toolNames: [],
    },
  })
  engine.createSession()

  const response = await engine.callLLM(
    GENERATION_PROMPT(agentName, description),
    llm,
    'Tu es un expert en skills. Génère uniquement le contenu SKILL.md.',
  )

  // extract markdown content from response
  let content = response.trim()
  
  // 1. Remove any markdown code block wrapping
  const codeBlockMatch = content.match(/```(?:markdown)?\r?\n([\s\S]*?)```/)
  if (codeBlockMatch) {
    content = codeBlockMatch[1].trim()
  }

  // 2. Locate the first frontmatter block or ensure one exists
  const hasFrontmatter = /^---\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n/m.test(content)
  
  if (!hasFrontmatter) {
    // If no frontmatter, try to find the first '#' and prepend frontmatter
    const firstHeader = content.indexOf('#')
    if (firstHeader !== -1) {
      const body = content.slice(firstHeader)
      content = `---\nname: ${skillId}\ndescription: ${description}\n---\n\n${body}`
    } else {
      content = `---\nname: ${skillId}\ndescription: ${description}\n---\n\n${content}`
    }
  } else {
    // If frontmatter exists but there's text before it, strip the prefix
    const frontmatterStart = content.search(/^---\s*\r?\n/m)
    if (frontmatterStart > 0) {
      content = content.slice(frontmatterStart)
    }
  }

  writeFileSync(skillPath, content, 'utf-8')

  return { skillId, fileName: 'SKILL.md', content, path: skillPath }
}

export async function validateSkill(skillId: string): Promise<{ ok: boolean; errors: string[] }> {
  const skillDir = join(SKILLS_DIR, skillId)
  const skillPath = join(skillDir, 'SKILL.md')
  const errors: string[] = []

  if (!existsSync(skillPath)) {
    return { ok: false, errors: [`Fichier SKILL.md introuvable : ${skillPath}`] }
  }

  const { loadSkill } = await import('./skills.js')
  const skill = loadSkill(skillId)
  if (!skill) {
    errors.push('Impossible de parser le frontmatter YAML')
    return { ok: false, errors }
  }

  if (!skill.content.includes('## Mission')) errors.push('La skill doit avoir une section "## Mission"')
  if (!skill.content.includes('## Comportement')) errors.push('La skill doit avoir une section "## Comportement"')
  if (!skill.content.includes('## Compétences')) errors.push('La skill doit avoir une section "## Compétences"')
  if (!skill.content.includes('## Règles')) errors.push('La skill doit avoir une section "## Règles"')

  return { ok: errors.length === 0, errors }
}

export async function validateAgent(agentId: string): Promise<{ ok: boolean; errors: string[] }> {
  const errors: string[] = []
  const { listLocalAgents } = await import('./agents.js')
  const agents = listLocalAgents()
  const agent = agents.find(a => a.id === agentId)
  if (!agent) {
    errors.push(`Agent "${agentId}" introuvable dans .agents/`)
    return { ok: false, errors }
  }
  return { ok: true, errors: [] }
}

export async function validateIntegration(agentId: string, skillId: string): Promise<{ ok: boolean; errors: string[] }> {
  const errors: string[] = []
  const agentOk = await validateAgent(agentId)
  if (!agentOk.ok) {
    errors.push(...agentOk.errors.map(e => `Agent: ${e}`))
    return { ok: false, errors }
  }
  const skillOk = await validateSkill(skillId)
  if (!skillOk.ok) {
    errors.push(...skillOk.errors.map(e => `Skill: ${e}`))
    return { ok: false, errors }
  }
  return { ok: errors.length === 0, errors }
}
