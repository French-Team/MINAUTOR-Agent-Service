/**
 * Test du mécanisme des suggestions — vérifie que le parsing fonctionne
 */
import { parseSuggestionsFromOutput, writeSuggestions, loadSuggestions, clearSuggestions } from './dist/cli-suggestions.js'

// Texte généré par getFollowUpSuggestions() (simulation)
const text = `
\u2501 Suivi sugg\u00e9r\u00e9 \u2501
  \u2192 renomme la t\u00e2che "..." en 'Nouveau titre' au projet mon-projet \u2014 Renommer
  \u2192 d\u00e9place la t\u00e2che "..." dans <domaine> au projet mon-projet \u2014 D\u00e9placer
  \u2192 modifie la description de la t\u00e2che "..." en '...' au projet mon-projet \u2014 D\u00e9crire
  \u2192 ajoute une autre t\u00e2che "..." dans <domaine> au projet <projet> \u2014 Ajouter
  \u2192 liste les projets \u2014 Voir tous les projets
`

console.log('=== TEXTE BRUT A PARSER ===')
console.log(text)
console.log('=== FIN TEXTE BRUT ===\n')

const suggestions = parseSuggestionsFromOutput(text)
console.log(`Suggestions parsées : ${suggestions.length}`)
for (const s of suggestions) {
  console.log(`  - [${s.label}] command: "${s.command}"`)
}

if (suggestions.length === 0) {
  console.log('\n⚠ AUCUNE suggestion parsée ! Le regex ne match pas.')
  console.log('Vérification caractère par caractère :')
  const lines = text.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    console.log(`  Ligne: "${line}"`)
    console.log(`    starts with 2 spaces: ${line.startsWith('  ')}`)
    const arrowIdx = line.indexOf('→')
    console.log(`    → at index: ${arrowIdx}`)
    if (arrowIdx >= 0) {
      const afterArrow = line.slice(arrowIdx + 1)
      const dashIdx = afterArrow.indexOf('—')
      console.log(`    — at index: ${arrowIdx + 1 + dashIdx}`)
      console.log(`    has arrow+space before dash: ${afterArrow.includes(' — ')}`)
    }
  }
} else {
  console.log(`\n✅ Parsing OK. Écriture du fichier...`)
  writeSuggestions(suggestions)
  
  const loaded = loadSuggestions()
  console.log(`Rechargé depuis fichier : ${loaded.length} suggestions`)
  for (const s of loaded) {
    console.log(`  - [${s.label}] "${s.command}"`)
  }
  
  clearSuggestions()
  const afterClear = loadSuggestions()
  console.log(`Après clearSuggestions : ${afterClear.length} suggestions (attendu: 0)`)
}
