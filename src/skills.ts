import { readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'

export interface SkillMeta {
  name: string
  description: string
  category?: string
}

export interface Skill {
  meta: SkillMeta
  content: string
  path: string
}

const SKILLS_DIR = join(process.cwd(), 'skills')

export function listSkills(): SkillMeta[] {
  if (!existsSync(SKILLS_DIR)) return []
  try {
    return readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(dir => {
        const skillPath = join(SKILLS_DIR, dir.name, 'SKILL.md')
        if (!existsSync(skillPath)) return null
        const content = readFileSync(skillPath, 'utf-8')
        const meta = parseFrontmatter(content)
        return meta ? { ...meta, name: dir.name } : null
      })
      .filter((s): s is SkillMeta => s !== null)
  } catch {
    return []
  }
}

export function loadSkill(name: string): Skill | null {
  const skillDir = join(SKILLS_DIR, name)
  const skillPath = join(skillDir, 'SKILL.md')
  if (!existsSync(skillPath)) return null
  const content = readFileSync(skillPath, 'utf-8')
  const meta = parseFrontmatter(content)
  if (!meta) return null
  return { meta, content, path: skillPath }
}

function parseFrontmatter(content: string): SkillMeta | null {
  // Regex plus flexible : supporte \r\n, les espaces après les tirets, et ignore le texte avant le premier ---
  const match = content.match(/[\s\S]*?^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n([\s\S]*)$/m)
  if (!match) return null
  const yaml = match[1]
  const _body = match[2].trim()
  
  // Extraction plus souple des champs YAML
  const name = yaml.match(/^name:\s*(.+)$/m)?.[1]?.trim()
  const description = yaml.match(/^description:\s*(.+)$/m)?.[1]?.trim()
  const category = yaml.match(/^metadata:\n\s+category:\s*(.+)$/m)?.[1]?.trim()
  
  if (!name || !description) return null
  return { name, description, category }
}

export function getSkillsDir(): string {
  return SKILLS_DIR
}
