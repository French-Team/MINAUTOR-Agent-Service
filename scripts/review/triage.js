#!/usr/bin/env node
const demande = process.env.SCRIPT_DEMANDE || '(demande inconnue)'
console.log('📋 Demande de revue reçue :')
console.log(`   "${demande}"`)
console.log('')
console.log('⚠️  Pas encore de script de revue dédié.')
console.log('   Scripts disponibles : scripts/review/')
console.log('   Pour ajouter : data/scripts/registry.yaml')
