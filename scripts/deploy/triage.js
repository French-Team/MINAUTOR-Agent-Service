#!/usr/bin/env node
const demande = process.env.SCRIPT_DEMANDE || '(demande inconnue)'
console.log('📋 Demande de déploiement reçue :')
console.log(`   "${demande}"`)
console.log('')
console.log('⚠️  Pas encore de script de déploiement dédié.')
console.log('   Scripts disponibles : scripts/deploy/')
console.log('   Pour ajouter : data/scripts/registry.yaml')
