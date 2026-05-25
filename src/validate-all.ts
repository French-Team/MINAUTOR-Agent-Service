/**
 * Validation des Règles d'Or sur tous les agents.
 * Usage : node dist/validate-all.js
 * Retourne 0 si tous les agents respectent les Règles d'Or, 1 sinon.
 *
 * Valide R1 à R5 sur chaque fichier .agents/<id>.ts :
 *   R1 : pas de payloads en guillemets simples '...'
 *   R2 : ID agent en ASCII pur
 *   R3 : pas d'emojis dans les instructions
 *   R4 : format kebab-case
 *   R5 : pas de contournement de l'intercom (sauf Alice)
 *   R7 : fichier AGENT_RULES.md présent (injection automatique)
 */

import { readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'

const RESET = '\x1b[0m'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const CYAN = '\x1b[36m'
const YELLOW = '\x1b[33m'
const GRAY = '\x1b[90m'
const BOLD = '\x1b[1m'

interface RuleResult {
  label: string
  ok: boolean
  detail?: string
}

function checkAgentRules(agentId: string, content: string, _agentPath: string): RuleResult[] {
  const results: RuleResult[] = []

  // Extraire instructionsPrompt (identique a validate-agent.ts)
  const instructionsMatch = content.match(
    /instructionsPrompt:\s*`([\s\S]*?)`\s*,\r?\n\s*(?:toolConfig|spawnerPrompt|selfCorrection|guardian)/
  )
  const instructions = instructionsMatch ? instructionsMatch[1] : ''

  // R1 : pas de payloads en guillemets simples
  const hasOldPayload = /'\{[^}]*\}'/.test(instructions) || /'<[^>]+>'/.test(instructions)
  results.push({
    label: "R1 : pas de '...' autour des payloads",
    ok: !hasOldPayload,
    detail: hasOldPayload ? "Utilise echo + pipe + --stdin au lieu de '...'" : undefined,
  })

  // R2 : ID en ASCII pur
  const nonAsciiInId = /[^\x00-\x7F]/.test(agentId)
  results.push({
    label: 'R2 : ID agent en ASCII pur',
    ok: !nonAsciiInId,
    detail: nonAsciiInId ? "L'ID contient des caracteres non-ASCII" : undefined,
  })

  // R3 : pas d'emojis dans les instructions
  const emojiRegex = /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{FE00}-\u{FE0F}]/u
  const hasEmoji = emojiRegex.test(instructions)
  results.push({
    label: "R3 : pas d'emojis dans les instructions",
    ok: !hasEmoji,
    detail: hasEmoji ? 'Remplace les emojis par [OK] [ERR] [WARN]' : undefined,
  })

  // R4 : kebab-case
  const isKebabCase = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(agentId)
  results.push({
    label: 'R4 : format kebab-case',
    ok: isKebabCase,
    detail: isKebabCase ? undefined : 'ID doit etre en kebab-case (ex: mon-agent)',
  })

  // R5 : pas de contournement intercom (sauf Alice et agent-telecom, qui est l'intercom)
  if (agentId !== 'alice' && agentId !== 'agent-telecom') {
    const bypassesIntercom = /envoie.*(?:à|vers)\s+(?!.*intercom)/i.test(instructions)
    results.push({
      label: "R5 : pas de contournement de l'intercom",
      ok: !bypassesIntercom,
      detail: bypassesIntercom ? 'Tout passe par agent-telecom via intercom' : undefined,
    })
  } else {
    results.push({
      label: "R5 : pas de contournement de l'intercom",
      ok: true,
      detail: "(Alice/agent-telecom - exemptes de R5)",
    })
  }

  return results
}

interface AgentResult {
  id: string
  ok: boolean
  rules: RuleResult[]
}

function main(): void {
  const cwd = process.cwd()
  const agentsDir = join(cwd, '.agents')
  const rulesPath = join(cwd, 'data', 'rules', 'AGENT_RULES.md')

  // Verification prealable
  if (!existsSync(agentsDir)) {
    console.error(RED + 'X Dossier .agents/ introuvable' + RESET)
    process.exit(1)
  }

  // Liste des agents
  const agents = readdirSync(agentsDir)
    .filter(f => f.endsWith('.ts'))
    .map(f => f.replace(/\.ts$/, ''))
    .sort()

  if (agents.length === 0) {
    console.log('\n' + YELLOW + 'Aucun agent trouve dans .agents/' + RESET)
    process.exit(0)
  }

  // R7 : verification globale du fichier AGENT_RULES.md
  const rulesFileOk = existsSync(rulesPath)

  console.log('\n' + BOLD + CYAN + '════════════════════════════════════════════════════' + RESET)
  console.log(BOLD + CYAN + '  REGLES D\'OR - ' + agents.length + ' agent(s)' + RESET)
  console.log(BOLD + CYAN + '════════════════════════════════════════════════════' + RESET + '\n')

  const agentResults: AgentResult[] = []

  for (const agentId of agents) {
    const agentPath = join(agentsDir, agentId + '.ts')
    const content = readFileSync(agentPath, 'utf-8')
    const rules = checkAgentRules(agentId, content, agentPath)
    const ok = rules.every(r => r.ok)
    agentResults.push({ id: agentId, ok, rules })
  }

  // Affichage
  for (const ar of agentResults) {
    const status = ar.ok ? GREEN + 'V' + RESET : RED + 'X' + RESET
    console.log('  ' + status + ' ' + CYAN + ar.id + RESET)
    for (const r of ar.rules) {
      const bullet = r.ok ? GREEN + '.' + RESET : RED + '.' + RESET
      const detail = r.detail ? ' ' + GRAY + '(' + r.detail + ')' + RESET : ''
      console.log('    ' + bullet + ' ' + r.label + detail)
    }
    console.log()
  }

  // R7 global
  const r7Status = rulesFileOk ? GREEN + 'V' + RESET : RED + 'X' + RESET
  console.log('  ' + r7Status + ' R7 : fichier AGENT_RULES.md ' + (rulesFileOk ? 'present' : 'introuvable'))
  console.log('       ' + GRAY + 'Injection automatique dans le system prompt de tous les agents' + RESET + '\n')

  // Resultat final
  const passed = agentResults.filter(r => r.ok).length
  const total = agents.length
  const agentFailed = agentResults.filter(r => !r.ok).length
  const failed = agentFailed + (rulesFileOk ? 0 : 1)

  console.log(BOLD + CYAN + '════════════════════════════════════════════════════' + RESET)
  if (failed === 0) {
    console.log(BOLD + GREEN + '  [OK] ' + passed + '/' + total + ' agents - TOUTES LES REGLES D\'OR RESPECTEES' + RESET)
  } else {
    const detailParts: string[] = []
    if (agentFailed > 0) detailParts.push(agentFailed + '/' + total + ' agents en echec')
    if (!rulesFileOk) detailParts.push('AGENT_RULES.md manquant')
    console.log(BOLD + RED + '  [ERR] ' + detailParts.join(', ') + RESET)
    console.log(YELLOW + '  Corrige les points listes ci-dessus' + RESET)
  }
  console.log(BOLD + CYAN + '════════════════════════════════════════════════════' + RESET + '\n')

  process.exit(failed > 0 ? 1 : 0)
}

main()
