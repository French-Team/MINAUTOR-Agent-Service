#!/usr/bin/env node
const demande = process.env.SCRIPT_DEMANDE || '(demande inconnue)'
console.log('📋 Demande de création reçue :')
console.log(`   "${demande}"`)
console.log('')
console.log('⚠️  Pas encore de script de création dédié.')
console.log('   Scripts disponibles : scripts/create/')
console.log('   Pour ajouter : data/scripts/registry.yaml')
