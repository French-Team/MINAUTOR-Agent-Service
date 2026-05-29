#!/usr/bin/env node
/**
 * scripts/alice/greeting.js — Réponse simple pour "bonjour" générique
 *
 * Usage:
 *   node scripts/alice/greeting.js
 *   node scripts/alice/greeting.js --json
 */

const isJson = process.argv.includes('--json')

const response = {
  message: "Bonjour ! Comment puis-je t'aider aujourd'hui ?",
  type: 'greeting',
  hint: 'Tu peux me demander de lister les projets, voir les agents disponibles, ou me poser une question technique — je transmettrai ta demande au bon service.',
}

if (isJson) {
  console.log(JSON.stringify(response, null, 2))
} else {
  console.log(response.message)
  console.log('')
  console.log(response.hint)
}
