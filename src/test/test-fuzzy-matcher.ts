/**
 * Tests unitaires pour fuzzy-matcher.ts
 */
import { existsSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const cwd = process.cwd()

function assert(label: string, ok: boolean): void {
  if (ok) {
    console.log(`  ✓ ${label}`)
  } else {
    console.log(`  ✗ ${label}`)
    process.exitCode = 1
  }
}

async function main(): Promise<void> {
  console.log('\n=== Test Module fuzzy-matcher.ts ===\n')

  // ── Nettoyage état avant test ──
  const cacheDir = join(cwd, 'telecom', 'cache')
  const logsDir = join(cwd, 'telecom', 'logs')
  try { rmSync(cacheDir, { recursive: true, force: true }) } catch {}
  try { rmSync(logsDir, { recursive: true, force: true }) } catch {}
  mkdirSync(cacheDir, { recursive: true })
  mkdirSync(logsDir, { recursive: true })

  // ── Importer le module ──
  const mod = await import('../fuzzy-matcher.js')

  // ── Test 1: cosineSimilarity ──
  console.log('Test 1: cosineSimilarity')
  const a = [1, 0]
  const b = [0, 1]
  assert('Vecteurs orthogonaux = 0', mod.cosineSimilarity(a, b) === 0)
  assert('Vecteur identique = 1', mod.cosineSimilarity(a, a) === 1)
  assert('Vecteur opposé = -1', mod.cosineSimilarity(a, [-1, 0]) === -1)
  assert('Tableaux vides = 0', mod.cosineSimilarity([], []) === 0)
  assert('Dimensions différentes = 0', mod.cosineSimilarity([1], [1, 0]) === 0)
  assert('Vecteur nul = 0', mod.cosineSimilarity([0, 0], [1, 0]) === 0)

  // ── Test 2: getCoverage (sans cache) ──
  console.log('\nTest 2: getCoverage (sans cache)')
  const cov1 = mod.getCoverage()
  assert('cached = 0 (pas de fichier)', cov1.cached === 0)
  assert('total > 0 (registry chargé)', cov1.total > 0)
  assert('outdated = false', cov1.outdated === false)

  // ── Test 3: clearEmbeddingCache (sans fichier) ──
  console.log('\nTest 3: clearEmbeddingCache (sans fichier)')
  try {
    mod.clearEmbeddingCache()
    assert('clear sans fichier ne lance pas', true)
  } catch (e) {
    assert('clear sans fichier ne lance pas', false)
  }

  // ── Test 4: rebuildCache (avec LM Studio) ──
  console.log('\nTest 4: rebuildCache (avec LM Studio)')
  const rebuildOk = await mod.rebuildCache()
  assert('rebuildCache retourne true', rebuildOk === true)

  // ── Test 5: getCoverage (après rebuild) ──
  console.log('\nTest 5: getCoverage (après rebuild)')
  const cov2 = mod.getCoverage()
  assert('cached > 0 (rebuild réussi)', cov2.cached > 0)
  assert('cached === total (100% coverage)', cov2.cached === cov2.total)
  assert('cacheSize > 0', cov2.cacheSize > 0)

  // ── Test 6: fuzzyMatch "liste mes projets" ──
  console.log('\nTest 6: fuzzyMatch "liste mes projets"')
  const r1 = await mod.fuzzyMatch('liste mes projets', 'project-request')
  assert('fuzzyMatch retourne matched=true', r1.matched === true)
  assert('similarity > 0.75 (seuil)', r1.similarity > 0.75)
  assert('entry.script = scripts/projects/list.js', r1.entry?.script === 'scripts/projects/list.js')

  // ── Test 7: fuzzyMatch "montre moi les projets" ──
  console.log('\nTest 7: fuzzyMatch "montre moi les projets"')
  const r2 = await mod.fuzzyMatch('montre moi les projets', 'project-request')
  assert('fuzzyMatch retourne matched=true', r2.matched === true)
  assert('similarity > 0.75', r2.similarity > 0.75)

  // ── Test 8: fuzzyMatch demande inconnue (faible similarité) ──
  console.log('\nTest 8: fuzzyMatch (demande sans rapport)')
  // LM Studio tourne, mais le cache n'a que des patterns de scripts
  // Une demande complètement différente devrait retourner matched=false
  // (pas assez de similarité avec les patterns systèmes)
  const r3 = await mod.fuzzyMatch('donne moi la météo à paris', 'project-request')
  // Cette demande très différente ne devrait pas matcher les patterns projets
  // Note : peut dépendre de la qualité du modèle d'embedding
  assert('Demande sans rapport = pas de match (attendu)', r3.matched === false)
  assert('similarity < 0.75', r3.similarity < 0.75)

  // ── Test 9: checkLmStudio ──
  console.log('\nTest 9: checkLmStudio')
  const lmStatus = await mod.checkLmStudio()
  assert('checkLmStudio alive=true', lmStatus.alive === true)
  assert('checkLmStudio contient des modèles', Array.isArray(lmStatus.models) && lmStatus.models.length > 0)
  assert('embedding model disponible', lmStatus.models?.some(m => m.includes('nomic')) === true)

  // ── Test 10: clearEmbeddingCache (avec fichier) ──
  console.log('\nTest 10: clearEmbeddingCache (avec fichier)')
  const covBefore = mod.getCoverage()
  assert('cache présent avant clear', covBefore.cached > 0)
  mod.clearEmbeddingCache()
  const covAfter = mod.getCoverage()
  assert('cache vidé après clear', covAfter.cached === 0)

  // ── Nettoyage ──
  console.log('\n=== Nettoyage ===')
  try { rmSync(cacheDir, { recursive: true, force: true }) } catch {}
  try { rmSync(logsDir, { recursive: true, force: true }) } catch {}
  assert('Fichiers de test nettoyés', !existsSync(cacheDir))

  // ── Résultat ──
  console.log('\n=== Résultat ===')
  if (process.exitCode) {
    console.log('❌ Certains tests ont ÉCHOUÉ.')
  } else {
    console.log('✅ Tous les tests ont RÉUSSI.')
  }
  process.exit(process.exitCode ?? 0)
}

main().catch((err) => {
  console.error('ERREUR:', err.message)
  process.exit(1)
})
