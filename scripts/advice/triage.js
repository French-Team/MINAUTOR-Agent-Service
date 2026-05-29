#!/usr/bin/env node
const demande = process.env.SCRIPT_DEMANDE || '(demande inconnue)'
console.log('📋 Demande de conseil reçue :')
console.log(`   "${demande}"`)
console.log('')
console.log('⚠️  Pas encore de script de conseil dédié.')
console.log('   Scripts disponibles : scripts/advice/')
console.log('   Pour ajouter : data/scripts/registry.yaml')
