#!/usr/bin/env node
/**
 * scripts/parades/profiles.js — Bibliothèque de profils
 *
 * Usage: node scripts/parades/profiles.js <action> [filtre]
 *
 * Actions :
 *   list [catégorie]     Liste les profils (optionnellement par catégorie)
 *   info <nom>           Affiche les détails d'un profil spécifique
 *   search <terme>       Cherche des profils par mot-clé
 *   categories           Liste les catégories disponibles
 *
 * Catégories : agents, bots, daemons
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = join(fileURLToPath(import.meta.url), '..')
const PROJECT_ROOT = join(__dirname, '..', '..')
const PROFILES_DIR = join(PROJECT_ROOT, 'data', 'profiles')

const CATEGORIES = ['agents', 'bots', 'daemons']
const CATEGORY_LABELS = {
  agents: '🤖 Agents',
  bots: '⚙️ Bots',
  daemons: '👻 Daemons',
}
const CATEGORY_SUB = {
  agents: "Profils de conversation et d'assistance",
  bots: "Profils d'automatisation et de scripts",
  daemons: "Profils de surveillance et d'arrière-plan",
}

/** Parse un fichier JSON de profil et retourne un objet structuré */
function parseProfileFile(category, filename) {
  const filePath = join(PROFILES_DIR, category, filename)
  if (!existsSync(filePath)) return null
  try {
    const raw = readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw)
    const name = filename.replace(/\.json$/, '')
    return {
      id: name,
      category,
      name: data.profileName || data.name || name,
      description: data.description || '',
      model: data.model || (data.config && data.config.model) || '',
      tools: data.toolNames || [],
      tags: data.tags || [],
    }
  } catch {
    return null
  }
}

function loadProfiles() {
  const profiles = { agents: [], bots: [], daemons: [] }

  for (const cat of CATEGORIES) {
    const catDir = join(PROFILES_DIR, cat)
    if (!existsSync(catDir)) continue

    const files = readdirSync(catDir).filter(f => f.endsWith('.json') && f !== 'INDEX.md')
    for (const file of files) {
      const p = parseProfileFile(cat, file)
      if (p) profiles[cat].push(p)
    }
  }

  return profiles
}

function usage() {
  console.log('Usage: node scripts/parades/profiles.js <action> [filtre]')
  console.log('')
  console.log('Actions :')
  console.log('  list [catégorie]    Lister les profils')
  console.log('  info <nom>          Détails d\'un profil')
  console.log('  search <terme>      Rechercher par mot-clé')
  console.log('  categories          Lister les catégories')
  console.log('')
  console.log('Catégories : agents, bots, daemons')
}

function actionCategories() {
  const profiles = loadProfiles()

  console.log('═══════════════════════════════════════════')
  console.log('  📚 Catégories de profils')
  console.log('═══════════════════════════════════════════')
  console.log('')

  for (const cat of CATEGORIES) {
    const count = profiles[cat].length
    const label = CATEGORY_LABELS[cat] || cat
    const sub = CATEGORY_SUB[cat] || ''
    const pct = count > 0 ? `  ${count} profil(s)` : '  (vide)'
    console.log(`  ${label}`)
    console.log(`    ${sub}`)
    console.log(`    ${pct}`)
    console.log('')
  }

  const total = Object.values(profiles).reduce((s, arr) => s + arr.length, 0)
  console.log(`  📊 Total : ${total} profils dans la bibliothèque.`)
  console.log('')
  console.log('  Pour lister : !profiles list <catégorie>')
  console.log('  Pour chercher : !profiles search <mot-clé>')
  console.log('═══════════════════════════════════════════')
}

function actionList(category) {
  const profiles = loadProfiles()

  const catsToShow = category
    ? [category]
    : CATEGORIES

  console.log('═══════════════════════════════════════════')
  console.log(`  📚 Profils${category ? ` — ${CATEGORY_LABELS[category] || category}` : ' (tous)'}`)
  console.log('═══════════════════════════════════════════')
  console.log('')

  let totalShown = 0

  for (const cat of catsToShow) {
    if (!profiles[cat] || profiles[cat].length === 0) continue

    const label = CATEGORY_LABELS[cat] || cat
    console.log(`  ┌─ ${label} (${profiles[cat].length})`)

    // Afficher par groupes de premières lettres
    const grouped = {}
    for (const p of profiles[cat]) {
      const prefix = p.name.charAt(0).toUpperCase()
      if (!grouped[prefix]) grouped[prefix] = []
      grouped[prefix].push(p)
    }

    const sortedPrefixes = Object.keys(grouped).sort()
    for (const prefix of sortedPrefixes) {
      const items = grouped[prefix]
      const names = items.map(p => p.name).join(', ')
      // Tronquer si trop long
      const display = names.length > 100 ? names.slice(0, 97) + '...' : names
      console.log(`  │ ${prefix} — ${display}`)
    }
    console.log('')

    totalShown += profiles[cat].length
  }

  if (totalShown === 0) {
    console.log('  (aucun profil trouvé)')
    console.log('')
  }

  console.log('  Pour voir les détails : !profiles info <nom-du-profil>')
  console.log('═══════════════════════════════════════════')
}

function actionInfo(profileName) {
  if (!profileName) {
    console.log('❌ Nom du profil manquant.')
    console.log('Usage : !profiles info <nom-du-profil>')
    process.exit(1)
  }

  const cleanId = profileName.replace(/[^a-z0-9_-]/gi, '').toLowerCase()

  // Étape 1 : chercher par nom de fichier exact dans chaque catégorie
  // (ne lit que les noms de fichiers, pas leur contenu — O(1) fichier parsé)
  let foundCategory = ''
  let foundFilename = ''

  for (const cat of CATEGORIES) {
    const catDir = join(PROFILES_DIR, cat)
    if (!existsSync(catDir)) continue

    const files = readdirSync(catDir).filter(f => f.endsWith('.json') && f !== 'INDEX.md')
    const exact = files.find(f => f.replace(/\.json$/, '').toLowerCase() === cleanId)
    if (exact) {
      foundFilename = exact
      foundCategory = cat
      break
    }
  }

  // Étape 2 : si pas trouvé, chercher partiellement dans les noms de fichiers
  if (!foundFilename) {
    for (const cat of CATEGORIES) {
      const catDir = join(PROFILES_DIR, cat)
      if (!existsSync(catDir)) continue

      const files = readdirSync(catDir).filter(f => f.endsWith('.json') && f !== 'INDEX.md')
      const partial = files.find(f => f.replace(/\.json$/, '').toLowerCase().includes(cleanId))
      if (partial) {
        foundFilename = partial
        foundCategory = cat
        break
      }
    }
  }

  // Étape 3 : toujours pas trouvé ? chercher par .profileName dans les fichiers
  // (cas où le nom d'affichage est très différent du nom de fichier — rare mais possible)
  // Note : cette étape seule peut parser plusieurs fichiers, mais uniquement
  // dans les cas où les étapes 1 et 2 ont échoué.
  if (!foundFilename) {
    for (const cat of CATEGORIES) {
      const catDir = join(PROFILES_DIR, cat)
      if (!existsSync(catDir)) continue

      const files = readdirSync(catDir).filter(f => f.endsWith('.json') && f !== 'INDEX.md')
      for (const file of files) {
        try {
          const raw = readFileSync(join(catDir, file), 'utf-8')
          const data = JSON.parse(raw)
          const displayName = (data.profileName || data.name || '').toLowerCase()
          if (displayName === cleanId || displayName.includes(cleanId)) {
            foundFilename = file
            foundCategory = cat
            break
          }
        } catch { /* skip */ }
      }
      if (foundFilename) break
    }
  }

  // Charger le profil trouvé (1 seul fichier parsé, sauf étape 3)
  const found = foundFilename ? parseProfileFile(foundCategory, foundFilename) : null

  if (!found) {
    console.log('❌ Profil "' + profileName + '" introuvable.')
    console.log('')
    console.log('  Utilise !profiles list pour voir tous les profils')
    console.log('  ou !profiles search <terme> pour chercher.')
    process.exit(1)
  }

  const filePath = join(PROFILES_DIR, foundCategory, foundFilename)

  console.log('═══════════════════════════════════════════')
  console.log('  📄 ' + found.name)
  console.log('  ' + (CATEGORY_LABELS[found.category] || found.category))
  console.log('═══════════════════════════════════════════')
  console.log('')
  console.log('  ID          : ' + found.id)
  console.log('  Description : ' + (found.description || '\u2014'))
  if (found.model) console.log('  Modèle      : ' + found.model)
  if (found.tools && found.tools.length > 0) console.log('  Outils      : ' + found.tools.join(', '))
  if (found.tags && found.tags.length > 0) console.log('  Tags        : ' + found.tags.join(', '))
  console.log('  Fichier     : data/profiles/' + found.category + '/' + found.id + '.json')
  console.log('')

  // Afficher un extrait du contenu JSON
  try {
    const raw = readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw)
    const keys = Object.keys(data)
    console.log('  Structure :')
    for (const key of keys) {
      const val = data[key]
      if (typeof val === 'string' && val.length > 60) {
        console.log('    ' + key + ': "' + val.slice(0, 57) + '..."')
      } else if (Array.isArray(val)) {
        console.log('    ' + key + ': [' + val.length + ' élément(s)]')
      } else if (typeof val === 'object' && val !== null) {
        const subKeys = Object.keys(val)
        console.log('    ' + key + ': {' + subKeys.join(', ') + '}')
      } else {
        console.log('    ' + key + ': ' + JSON.stringify(val))
      }
    }
  } catch { /* skip */ }

  console.log('')
  console.log('  Pour créer un agent avec ce profil :')
  console.log('    Menu \u2192 1. Create agent \u2192 choisir ce profil')
  console.log('═══════════════════════════════════════════')
}

function actionSearch(term) {
  if (!term) {
    console.log('❌ Terme de recherche manquant.')
    console.log('Usage : !profiles search <mot-clé>')
    process.exit(1)
  }

  const profiles = loadProfiles()
  const searchTerm = term.toLowerCase()

  const results = []
  for (const cat of CATEGORIES) {
    for (const p of profiles[cat]) {
      const searchable = [
        p.name, p.id, p.description,
        ...p.tags,
        ...(p.tools || []),
      ].map(s => s.toLowerCase()).join(' ')

      if (searchable.includes(searchTerm)) {
        results.push(p)
      }
    }
  }

  console.log('═══════════════════════════════════════════')
  console.log('  🔍 Recherche : "' + term + '" (' + results.length + ' résultat(s))')
  console.log('═══════════════════════════════════════════')
  console.log('')

  if (results.length === 0) {
    console.log('  Aucun résultat.')
    console.log('')
    console.log('  💡 Essaye avec un autre terme ou consulte')
    console.log('     la liste complète : !profiles list')
    console.log('═══════════════════════════════════════════')
    return
  }

  // Grouper par catégorie
  const grouped = { agents: [], bots: [], daemons: [] }
  for (const r of results) {
    grouped[r.category].push(r)
  }

  for (const cat of CATEGORIES) {
    if (grouped[cat].length === 0) continue
    console.log('  ' + (CATEGORY_LABELS[cat] || cat) + ' (' + grouped[cat].length + ') :')
    console.log('')
    for (const p of grouped[cat]) {
      const desc = p.description ? ' \u2014 ' + p.description.slice(0, 80) : ''
      console.log('    \u2022 ' + p.name + desc)
    }
    console.log('')
  }

  console.log('  Pour voir les détails : !profiles info <nom>')
  console.log('═══════════════════════════════════════════')
}

function main() {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    usage()
    process.exit(1)
  }

  const action = args[0].toLowerCase()
  const filter = args[1] || ''

  switch (action) {
    case 'list':
      actionList(filter)
      break
    case 'info':
      actionInfo(filter)
      break
    case 'search':
      actionSearch(filter)
      break
    case 'categories':
    case 'cats':
      actionCategories()
      break
    default:
      console.log('❌ Action inconnue : "' + action + '".')
      usage()
      process.exit(1)
  }
}

main()
