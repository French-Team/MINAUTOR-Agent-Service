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
  const logbookPath = join(cwd, 'agent-logbook.md')
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

  // 4. Provider
  const provPath = join(cwd, 'providers.json')
  if (existsSync(provPath)) {
    const prov = JSON.parse(readFileSync(provPath, 'utf-8'))
    const enabled = prov.providers.filter((p: any) => p.enabled)
    const withKeys = enabled.filter((p: any) => p.apiKeys?.length > 0 || ['kilo','ollama','lm-studio'].includes(p.provider))
    console.log(`  ${withKeys.length > 0 ? '✓' : '✗'} Provider : ${withKeys.length} fournisseur(s) actif(s) avec clé`)
    if (withKeys.length === 0) { exitCode = 1; console.log('     → Aucun provider actif configuré') }
  } else {
    console.log(`  ✗ Provider : providers.json introuvable`)
    exitCode = 1
  }

  // 5. Résultat
  if (exitCode === 0) {
    console.log(`\n✅ Agent "${agentId}" : VALIDE & CERTIFIÉ\n`)
  } else {
    console.log(`\n❌ Agent "${agentId}" : ÉCHEC — corrige les erreurs ci-dessus\n`)
  }

  process.exit(exitCode)
}

main().catch(err => {
  console.error(err.message)
  process.exit(1)
})
