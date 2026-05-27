import { mkdirSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { createEngine, type LLMProvider } from './engine.js'

const SKILLS_DIR = join(process.cwd(), 'skills')

/**
 * Contexte workspace / permissions à injecter dans la skill générée.
 * Permet à l'agent généré de connaître son isolat et ses droits.
 */
export interface WorkspaceContext {
  /** Niveau de permission (défaut: confined pour les nouveaux agents) */
  level: 'admin' | 'restricted' | 'confined' | 'readonly'
  /** Workspace assigné (nom du projet ou '.sandbox' si sans projet) */
  workspace?: string
  /** Si vrai, l'agent est isolé dans le sandbox (aucun projet explicite) */
  isSandbox?: boolean
}

const GENERATION_PROMPT = (
  name: string,
  description: string,
  wsCtx?: WorkspaceContext,
) => {
  // Construire la section workspace avec des chaînes double-quotes pour les phrases
  // contenant des apostrophes (évite les problèmes d'échappement)
  const EMPTY = ''
  const noWorkspace = "Aucun workspace explicite — l'agent sera isolé dans le sandbox par défaut."
  const sandboxActive = "Sandbox actif : l'agent est confiné à workspaces/.sandbox/ et ne peut pas accéder aux autres projets."
  const adminAccess = "L'agent a un accès complet à tous les fichiers et dossiers."
  const confinedMsg = "L'agent est confiné à son workspace exclusivement. Chemins interdits : .agents/, data/, src/, providers.json, package.json. Commandes interdites : rm -rf, del /s."
  const readonlyMsg = "L'agent est en lecture seule. Seules les commandes cat, ls, dir, findstr, echo, type sont autorisées."
  const descLine = "La skill doit inclure une section ## Workspace qui décrit ces contraintes à l'agent, l'informe de son niveau de permission et lui rappelle les limites de son environnement."

  const wsSection = wsCtx
    ? `
## Contexte workspace

L'agent évolue dans un environnement isolé : niveau de permission "${wsCtx.level}".
${wsCtx.workspace ? `Workspace assigné : "${wsCtx.workspace}".` : noWorkspace}
${wsCtx.isSandbox ? sandboxActive : EMPTY}
${wsCtx.level === 'admin' ? adminAccess : EMPTY}
${wsCtx.level === 'confined' ? confinedMsg : EMPTY}
${wsCtx.level === 'readonly' ? readonlyMsg : EMPTY}

${descLine}
`
    : EMPTY

  const wsSectionTemplate = wsCtx
    ? `\n## Workspace\n\nDécris ici les contraintes de workspace : niveau de permission, dossier de travail, chemins interdits, commandes bloquées.\n`
    : EMPTY

  return `Tu es un expert en création de skills pour agents AI.

L'utilisateur veut créer un agent avec :
- Nom : ${name}
- Description : ${description}
${wsSection}Génère une skill complète au format SKILL.md pour cet agent.

IMPORTANT : Tu dois remplir TOUTES les sections avec du contenu concret et détaillé. NE PAS utiliser de placeholders comme {texte}. Chaque section doit contenir une description complète et utile.

Format attendu :
---
name: skill-${name}
description: ${description}
---

# Skill: ${name}

## Mission

Rédige ici la mission principale de l'agent en détail. Sois précis et concret.

## Comportement

Rédige ici le comportement attendu de l'agent en détail. Donne des exemples si nécessaire.

## Compétences

Liste les compétences de l'agent (utilise des "-" pour chaque compétence). Sois exhaustif.

## Règles

Liste les règles que l'agent doit suivre. Utilise des "-" pour chaque règle.
${wsSectionTemplate}Réponds UNIQUEMENT avec le contenu complet du SKILL.md, sans commentaires supplémentaires. Ne laisse aucun placeholder vide.`
}


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
  feedback?: string,
  workspaceContext?: WorkspaceContext,
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

  let prompt = GENERATION_PROMPT(agentName, description, workspaceContext)
  if (feedback) {
    prompt += `\n\n### FEEDBACK DE LA TENTATIVE PRÉCÉDENTE (À CORRIGER ABSOLUMENT) :\n${feedback}\n\nMerci de régénérer le SKILL.md en corrigeant TOUS les points mentionnés dans le feedback ci-dessus.`
  }

  const response = await engine.callLLM(
    prompt,
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

  // Vérification de qualité : placeholders non résolus
  const placeholderRegex = /\{[^}]{3,}\}/g
  const placeholders = skill.content.match(placeholderRegex)
  if (placeholders && placeholders.length > 0) {
    errors.push(`Placeholders non résolus détectés : ${placeholders.slice(0, 3).join(', ')}${placeholders.length > 3 ? '...' : ''}`)
  }

  // Vérification : sections trop courtes (moins de 10 caractères après le header)
  const sectionMinLength = 10
  const sections = ['## Mission', '## Comportement', '## Compétences', '## Règles']
  for (const section of sections) {
    if (skill.content.includes(section)) {
      const sectionIndex = skill.content.indexOf(section)
      const nextSectionIndex = sections.slice(sections.indexOf(section) + 1).find(s => skill.content.includes(s))
      const sectionEnd = nextSectionIndex ? skill.content.indexOf(nextSectionIndex) : skill.content.length
      const sectionContent = skill.content.slice(sectionIndex + section.length, sectionEnd).trim()
      
      if (sectionContent.length < sectionMinLength) {
        errors.push(`Section "${section}" trop courte ou vide`)
      }
    }
  }

  return { ok: errors.length === 0, errors }
}

export async function validateAgent(agentId: string): Promise<{ ok: boolean; errors: string[] }> {
  const errors: string[] = []
  const { readLocalAgent } = await import('./agents.js')
  const agent = readLocalAgent(`${agentId}.ts`)
  if (!agent) {
    errors.push(`Agent "${agentId}" introuvable ou illisible dans .agents/`)
    return { ok: false, errors }
  }
  if (!agent.displayName) errors.push('Agent : displayName manquant')
  if (!agent.model) errors.push('Agent : model manquant')
  if (!agent.toolNames || agent.toolNames.length === 0) errors.push('Agent : toolNames vide')
  if (!agent.instructionsPrompt) errors.push('Agent : instructionsPrompt vide')
  if (agent.selfCorrection && typeof agent.selfCorrection.enabled !== 'boolean') errors.push('Agent : selfCorrection.enabled doit être un booléen')
  if (agent.guardian && typeof agent.guardian.enabled !== 'boolean') errors.push('Agent : guardian.enabled doit être un booléen')
  if (agent.toolConfig && typeof agent.toolConfig.maxParallel !== 'number') errors.push('Agent : toolConfig.maxParallel doit être un nombre')
  return { ok: errors.length === 0, errors }
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
