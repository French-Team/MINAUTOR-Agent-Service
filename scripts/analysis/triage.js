#!/usr/bin/env node
/**
 * scripts/analysis/triage.js — Triage des demandes d'analyse non couvertes
 *
 * Usage :
 *   node scripts/analysis/triage.js
 */
function main() {
  const demande = process.env.SCRIPT_DEMANDE || '(demande inconnue)'
  console.log('📋 Demande d\'analyse reçue :')
  console.log(`   "${demande}"`)
  console.log('')
  console.log('⚠️  Cette analyse n\'a pas encore de script dédié.')
  console.log('   Pour créer un script :')
  console.log('   1. Identifie le pattern dans la demande')
  console.log('   2. Ajoute une entrée dans data/scripts/registry.yaml')
  console.log('   3. Crée le script correspondant dans scripts/')
  console.log('')
  console.log('   En attendant, un agent LLM peut être utilisé.')
}

main()
