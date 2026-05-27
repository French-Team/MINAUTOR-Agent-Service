/**
 * Script de validation autonome pour un agent.
 * Usage : node dist/validate-agent.js <agent-id>
 * Retourne 0 si tout est OK, 1 sinon.
 */

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

async function main() {
  const agentId = process.argv[2]
  if (!agentId) {
    console.error('Usage: validate-agent <agent-id>')
    process.exit(1)
  }

  const cwd = process.cwd()
  const agentPath = join(cwd, '.agents', agentId + '.ts')
  const skillPath = join(cwd, 'skills', 'skill-' + agentId, 'SKILL.md')
  let exitCode = 0

  console.log(`\n🔍 Validation de l'agent "${agentId}"\n`)

  // 1. Agent file
  const agentOk = existsSync(agentPath)
  console.log(`  ${agentOk ? '✓' : '✗'} Agent : ${agentPath}`)
  if (!agentOk) { exitCode = 1; console.log('     → Fichier agent manquant') }

  // 2. Skill file
  const skillOk = existsSync(skillPath)
  console.log(`  ${skillOk ? '✓' : '✗'} Skill : ${skillPath}`)
  if (!skillOk) { exitCode = 1; console.log('     → Fichier SKILL.md manquant') }

  // 3. Skill structure
  if (skillOk) {
    const content = readFileSync(skillPath, 'utf-8')
    const sections = ['## Mission', '## Comportement', '## Compétences', '## Règles']
    let missing = 0
    for (const sec of sections) {
      if (!content.includes(sec)) {
        console.log(`  ✗ Section manquante : ${sec}`)
        missing++
      }
    }
    if (missing > 0) exitCode = 1
  }

  // 4. Équipe d'orchestration PACO
  const orchFiles = [
    ['data/profiles/agents/AGENT-orchestrateur-04.json', 'Profil orchestrateur'],
    ['data/profiles/agents/AGENT-superviseur-06.json', 'Profil superviseur'],
    ['data/profiles/daemons/DAEMON-superviseur-01.json', 'Daemon superviseur'],
    ['data/protocols/keyword-registry.yaml', 'Registre mots-clés'],
    ['data/protocols/paco-protocol.md', 'Protocole PACO'],
  ]
  let orchOk = true
  for (const [p, name] of orchFiles) {
    const ok = existsSync(join(cwd, p))
    console.log(`  ${ok ? '✓' : '✗'} PACO : ${name}`)
    if (!ok) { orchOk = false; exitCode = 1; console.log(`     → Composant orchestration manquant : ${p}`) }
  }
  if (orchOk) console.log(`  ✓ PACO : Équipe d'orchestration complète`)

  // 5. Provider
  const provPath = join(cwd, 'providers.json')
  if (existsSync(provPath)) {
    const prov = JSON.parse(readFileSync(provPath, 'utf-8'))
    const enabled = prov.providers.filter((p: { enabled?: boolean }) => p.enabled)
    const withKeys = enabled.filter((p: { apiKeys?: string[]; provider?: string }) => (p.apiKeys?.length ?? 0) > 0 || ['kilo','ollama','lm-studio','ollama-local'].includes(p.provider ?? ''))
    console.log(`  ${withKeys.length > 0 ? '✓' : '✗'} Provider : ${withKeys.length} fournisseur(s) actif(s) avec clé`)
    if (withKeys.length === 0) { exitCode = 1; console.log('     → Aucun provider actif configuré') }
  } else {
    console.log(`  ✗ Provider : providers.json introuvable`)
    exitCode = 1
  }

  // 6. Règles d'Or — vérifications depuis AGENT_RULES.md
  console.log()
  const rulesPath = join(cwd, 'data', 'rules', 'AGENT_RULES.md')
  const rulesAvailable = existsSync(rulesPath)
  console.log(`  ${rulesAvailable ? '✓' : '✗'} Règles d\'Or : fichier AGENT_RULES.md`)
  if (!rulesAvailable) { exitCode = 1; console.log('     → data/rules/AGENT_RULES.md introuvable') }    // R1 — Pas de payloads en guillemets simples dans les instructions
  if (agentOk) {
    const agentContent = readFileSync(agentPath, 'utf-8')
    // Extraction robuste : la backtick de fermeture du template literal
    // est toujours suivie de ",\n  toolConfig" ou "spawnerPrompt" ou "selfCorrection"
    // Le \r? permet la compatibilité cross-platform (Windows \r\n vs Unix \n)
    const instructionsMatch = agentContent.match(
      /instructionsPrompt:\s*`([\s\S]*?)`\s*,\r?\n\s*(?:toolConfig|spawnerPrompt|selfCorrection|guardian)/
    )
    const instructions = instructionsMatch ? instructionsMatch[1] : ''

    // R1 : pas de '...' autour d'un payload (JSON ou placeholder <...>)
    const hasOldPayload = /'\{[^}]*\}'/.test(instructions) || /'<[^>]+>'/.test(instructions)
    console.log(`  ${!hasOldPayload ? '✓' : '✗'} R1 : pas de payloads en guillemets simples '...'`)
    if (hasOldPayload) { exitCode = 1; console.log('     → Utilise echo + pipe + --stdin au lieu de \'...\'') }

    // R2 : pas de caractères non-ASCII dans l'ID ou les chemins
    const nonAsciiInId = /[^\x00-\x7F]/.test(agentId)
    console.log(`  ${!nonAsciiInId ? '✓' : '✗'} R2 : ID agent en ASCII pur`)
    if (nonAsciiInId) { exitCode = 1; console.log('     → L\'ID contient des caractères non-ASCII') }

    // R3 : pas d'emojis dans les instructions
    const emojiRegex = /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{FE00}-\u{FE0F}]/u
    const hasEmoji = emojiRegex.test(instructions)
    console.log(`  ${!hasEmoji ? '✓' : '✗'} R3 : pas d\'emojis dans les instructions`)
    if (hasEmoji) { exitCode = 1; console.log('     → Remplace les emojis par [OK] [ERR] [WARN]') }

    // R4 : agent ID en kebab-case
    const isKebabCase = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(agentId)
    console.log(`  ${isKebabCase ? '✓' : '✗'} R4 : format kebab-case`)
    if (!isKebabCase) { exitCode = 1; console.log('     → ID doit être en kebab-case (ex: mon-agent)') }

    // R5 : pas de communication directe sans intercom (sauf Alice)
    if (agentId !== 'alice') {
      // Cherche les mentions d'envoi direct à un agent sans mention d'intercom
      const bypassesIntercom = /envoie.*(?:à|vers)\s+(?!.*intercom)/i.test(instructions)
      console.log(`  ${!bypassesIntercom ? '✓' : '✗'} R5 : pas de contournement de l\'intercom`)
      if (bypassesIntercom) { exitCode = 1; console.log('     → Tout passe par agent-telecom via intercom') }
    } else {
      console.log(`  ✓ R5 : (Alice — point d\'entrée, naturel)`)
    }

    // R7 : vérifié par l'injection automatique du fichier AGENT_RULES.md
    // Les règles R6-R7 sont dans le fichier, injectées par le moteur au démarrage
    console.log(`  ✓ R7 : via injection AGENT_RULES.md (automatique)`)
  }

  // 7. Permissions (FeuRouge)
  console.log()
  const permYamlPath = join(cwd, 'data', 'permissions', 'permissions.yaml')
  const permYamlExists = existsSync(permYamlPath)
  console.log(`  ${permYamlExists ? '\u2713' : '\u2717'} Permissions : permissions.yaml`)
  if (!permYamlExists) { exitCode = 1; console.log('     \u2192 data/permissions/permissions.yaml introuvable') }

  if (permYamlExists) {
    const permRaw = readFileSync(permYamlPath, 'utf-8')
    // \u00c9chapper les caract\u00e8res sp\u00e9ciaux regex dans l'ID (kebab-case)
    const escapedId = agentId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // Ancrage fin de ligne (avec flag m) pour \u00e9viter les faux positifs sur des pr\u00e9fixes d'ID
    const hasAgentEntry = new RegExp(`id:\\s*['"]?${escapedId}['"]?\\s*$`, 'm').test(permRaw)
    const hasWildcard =
      permRaw.includes("id: '*'")
      || permRaw.includes('id: "*"')
      || /id:\s*['"]?\*['"]?\s*$/.test(permRaw)

    if (hasAgentEntry) {
      console.log(`  \u2713 Permissions : entr\u00e9e explicite pour "${agentId}"`)
    } else if (hasWildcard) {
      console.log(`  \u2713 Permissions : couvert par wildcard * (niveau confined par d\u00e9faut)`)
    } else {
      console.log(`  \u2717 Permissions : aucune entr\u00e9e pour "${agentId}" ni wildcard *`)
      exitCode = 1
      console.log('     \u2192 Ajoute une entr\u00e9e dans data/permissions/permissions.yaml ou un wildcard *')
    }

    // Extraire le niveau de permission depuis le YAML — ancrage fin de ligne comme hasAgentEntry
    const entryRegex = new RegExp(
      `id:\\s*['"]?${escapedId}['"]?\\s*$[\\s\\S]*?level:\\s*(\\S+)`,
      'm',
    )
    const levelMatch = permRaw.match(entryRegex)
    const yamlLevel = levelMatch
      ? levelMatch[1].replace(/['"]/g, '')
      : hasWildcard
        ? 'confined'
        : ''

    if (yamlLevel) {
      const validLevels = ['admin', 'restricted', 'confined', 'readonly']
      const levelOk = validLevels.includes(yamlLevel)
      console.log(`  ${levelOk ? '\u2713' : '\u2717'} Permissions : niveau "${yamlLevel}"`)
      if (!levelOk) {
        exitCode = 1
        console.log(`     \u2192 Niveau invalide. Valeurs accept\u00e9es : ${validLevels.join(', ')}`)
      }

      // Pour confined : v\u00e9rifier workspace — ancrage fin de ligne comme hasAgentEntry
      if (yamlLevel === 'confined') {
        const wsRegex = new RegExp(
          `id:\\s*['"]?${escapedId}['"]?\\s*$[\\s\\S]*?workspace:\\s*(\\S+)`,
          'm',
        )
        const wsMatch = permRaw.match(wsRegex)
        console.log(`  ${wsMatch ? '\u2713' : '\u26a0'} Permissions : workspace${!wsMatch ? ' (sandbox par d\u00e9faut)' : ''}`)
        // Pas bloquant — le sandbox sert de fallback automatique
      }
    }

    // V\u00e9rifier la pr\u00e9sence du champ permissions dans la d\u00e9finition .ts
    if (agentOk) {
      const agentContent = readFileSync(agentPath, 'utf-8')
      const hasPermissionsField = /permissions:\s*\{/.test(agentContent)
      console.log(`  ${hasPermissionsField ? '\u2713' : '\u26a0'} Permissions : champ d\u00e9fini dans le .ts${!hasPermissionsField ? ' (utilise permissions.yaml comme source de v\u00e9rit\u00e9)' : ''}`)
      // Pas bloquant — le YAML est la source de v\u00e9rit\u00e9, le champ .ts est redondant
    }
  }

  // 8. R\u00e9sultat
  if (exitCode === 0) {
    console.log(`\n${'='.repeat(50)}\n${' '.repeat(12)}✅ Agent "${agentId}" : VALIDE & CERTIFIÉ\n${'='.repeat(50)}\n`)
  } else {
    console.log(`\n${'='.repeat(50)}\n${' '.repeat(10)}❌ Agent "${agentId}" : ÉCHEC — corrige les erreurs ci-dessus\n${'='.repeat(50)}\n`)
  }

  process.exit(exitCode)
}

main().catch(err => {
  console.error(err.message)
  process.exit(1)
})
