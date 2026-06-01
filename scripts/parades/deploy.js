#!/usr/bin/env node
/**
 * scripts/parades/deploy.js — Prépare et exécute un déploiement
 *
 * Usage: node scripts/parades/deploy.js <projet> [--dry-run]
 *
 * Flags :
 *   --dry-run  : Affiche ce qui serait déployé sans agir
 *
 * Vérifie : git status, dépendances, propose un tag et une description.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const __dirname = join(fileURLToPath(import.meta.url), '..')
const PROJECT_ROOT = join(__dirname, '..', '..')
const WORKSPACES_DIR = join(PROJECT_ROOT, 'workspaces')

function usage() {
  console.log('Usage: node scripts/parades/deploy.js <projet> [--dry-run]')
  console.log('')
  console.log('  --dry-run  Simuler le déploiement (ne rien modifier)')
}

function main() {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    usage()
    process.exit(1)
  }

  let projectName = ''
  let dryRun = false
  let i = 0

  while (i < args.length) {
    if (args[i] === '--dry-run') {
      dryRun = true
      i++
    } else {
      projectName = args[i]
      i++
    }
  }

  if (!projectName) {
    console.log('❌ Nom du projet manquant.')
    usage()
    process.exit(1)
  }

  const cleanName = projectName.replace(/[^a-z0-9_-]/gi, '').toLowerCase()
  const projectPath = join(WORKSPACES_DIR, cleanName)

  if (!existsSync(projectPath)) {
    console.log(`❌ Projet "${cleanName}" introuvable dans workspaces/.`)
    process.exit(1)
  }

  if (!existsSync(join(projectPath, '.git'))) {
    console.log(`❌ "${cleanName}" n'est pas un dépôt git. Initialise-le d'abord avec !git init ${cleanName}.`)
    process.exit(1)
  }

  console.log('═══════════════════════════════════════════')
  console.log(`  🚀 Déploiement : ${cleanName}`)
  if (dryRun) console.log(`  Mode : 🔬 Dry-run (prévisualisation seulement)`)
  console.log('═══════════════════════════════════════════')
  console.log('')

  // ── Étape 1 : Vérifier git status ──
  console.log(`📋 Étape 1/4 — Vérification git status`)
  console.log('')
  try {
    const status = execSync(`git -C "${projectPath}" status --short`, {
      encoding: 'utf-8',
      timeout: 5000,
    })
    if (status.trim()) {
      console.log(`  ⚠ Fichiers non commités :`)
      for (const line of status.trim().split('\n')) {
        const flag = line.slice(0, 2).trim()
        const file = line.slice(3)
        console.log(`    ${flag === 'M' ? '📝' : flag === '??' ? '➕' : '🔧'} ${file}`)
      }
      console.log('')
    } else {
      console.log(`  ✅ Working tree propre.`)
      console.log('')
    }
  } catch (err) {
    console.log(`  ❌ Erreur git : ${(err as Error).message.slice(0, 100)}`)
    console.log('')
    process.exit(1)
  }

  // ── Étape 2 : Vérifier les dépendances ──
  console.log(`📋 Étape 2/4 — Vérification des dépendances`)
  console.log('')
  const pkgPath = join(projectPath, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
      const deps = { ...pkg.dependencies }
      const devDeps = { ...pkg.devDependencies }
      const totalDeps = Object.keys(deps).length + Object.keys(devDeps).length
      console.log(`  📦 ${totalDeps} dépendances (${Object.keys(deps).length} prod, ${Object.keys(devDeps).length} dev)`)

      if (existsSync(join(projectPath, 'node_modules'))) {
        console.log(`  ✅ node_modules/ présent`)
      } else {
        console.log(`  ⚠ node_modules/ manquant — lance \`npm install\``)
      }
      console.log('')
    } catch { /* skip */ }
  }

  // ── Étape 3 : Branche et commits ──
  console.log(`📋 Étape 3/4 — Branche et historique`)
  console.log('')
  try {
    const branch = execSync(`git -C "${projectPath}" rev-parse --abbrev-ref HEAD`, {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim()
    const ahead = execSync(`git -C "${projectPath}" rev-list --count @{u}..HEAD 2>nul || echo 0`, {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim()
    console.log(`  🌿 Branche : ${branch}`)
    console.log(`  ⬆ Commits en avance : ${ahead}`)
    console.log('')
  } catch { /* skip */ }

  // ── Étape 4 : Résumé et proposition ──
  console.log(`📋 Étape 4/4 — Résumé`)
  console.log('')

  // Générer un tag basé sur la date
  const now = new Date()
  const tag = `v${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}-${now.getTime().toString(36).slice(-4)}`

  console.log(`  🏷 Tag proposé : ${tag}`)
  console.log(`  📝 Description : Déploiement de ${cleanName} le ${now.toISOString().slice(0, 10)}`)
  console.log('')

  if (dryRun) {
    console.log('═══════════════════════════════════════════')
    console.log('  🔬 DRY-RUN — Aucune action effectuée.')
    console.log('  Pour déployer : retire le flag --dry-run')
    console.log('═══════════════════════════════════════════')
    process.exit(0)
  }

  console.log(`  ⏳ Création du tag git...`)
  try {
    execSync(`git -C "${projectPath}" tag -a "${tag}" -m "Déploiement de ${cleanName} le ${now.toISOString().slice(0, 10)}"`, {
      encoding: 'utf-8',
      timeout: 10000,
    })
    console.log(`  ✅ Tag "${tag}" créé.`)
    console.log('')
    console.log('═══════════════════════════════════════════')
    console.log('  ✅ Déploiement préparé avec succès.')
    console.log(`  🏷 Tag : ${tag}`)
    console.log('  Pour pusher : git push origin --tags')
    console.log('═══════════════════════════════════════════')
  } catch (err) {
    console.log(`  ❌ Erreur : ${(err as Error).message.slice(0, 200)}`)
    console.log('')
    process.exit(1)
  }
}

main()
