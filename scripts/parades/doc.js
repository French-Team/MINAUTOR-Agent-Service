#!/usr/bin/env node
/**
 * scripts/parades/doc.js — Gère la documentation du projet
 *
 * Usage: node scripts/parades/doc.js <action> [type] [projet]
 *
 * Actions :
 *   create README <projet>   — Génère un README
 *   check <projet>           — Vérifie la couverture doc
 *   update <projet>          — Met à jour les docs existantes
 */
import { existsSync, readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const __dirname = join(fileURLToPath(import.meta.url), '..')
const PROJECT_ROOT = join(__dirname, '..', '..')
const WORKSPACES_DIR = join(PROJECT_ROOT, 'workspaces')

function usage() {
  console.log('Usage: node scripts/parades/doc.js <action> [type] [projet]')
  console.log('')
  console.log('  create README <projet>   Générer un README.md')
  console.log('  check <projet>           Vérifier la couverture doc')
  console.log('  update <projet>          Mettre à jour les docs existantes')
}

function findProject(projectName) {
  const cleanName = projectName.replace(/[^a-z0-9_-]/gi, '').toLowerCase()
  const projectPath = join(WORKSPACES_DIR, cleanName)
  if (!existsSync(projectPath)) {
    console.log(`❌ Projet "${cleanName}" introuvable dans workspaces/.`)
    process.exit(1)
  }
  if (!existsSync(join(projectPath, '.workspace'))) {
    console.log(`❌ "${cleanName}" n'est pas un projet initialisé.`)
    process.exit(1)
  }
  return { cleanName, projectPath }
}

function actionCheck(projectName) {
  const { cleanName, projectPath } = findProject(projectName)

  console.log('═══════════════════════════════════════════')
  console.log(`  🔍 Vérification doc : ${cleanName}`)
  console.log('═══════════════════════════════════════════')
  console.log('')

  const docs = []
  const mainDocs = ['README.md', 'CONTRIBUTING.md', 'CHANGELOG.md', 'LICENSE']

  for (const doc of mainDocs) {
    const docPath = join(projectPath, doc)
    if (existsSync(docPath)) {
      const content = readFileSync(docPath, 'utf-8')
      const lines = content.split('\n').length
      const hasContent = content.trim().length > 100
      docs.push({ name: doc, exists: true, lines, hasContent })
    } else {
      docs.push({ name: doc, exists: false })
    }
  }

  // Chercher des docs dans un dossier docs/
  const docsDir = join(projectPath, 'docs')
  if (existsSync(docsDir)) {
    const extraDocs = readdirSync(docsDir).filter(f => f.endsWith('.md') || f.endsWith('.txt'))
    for (const f of extraDocs) {
      const content = readFileSync(join(docsDir, f), 'utf-8')
      docs.push({ name: `docs/${f}`, exists: true, lines: content.split('\n').length, hasContent: content.trim().length > 50 })
    }
  }

  let score = 0
  let maxScore = 0

  for (const d of docs) {
    if (d.exists) {
      const icon = d.hasContent ? '✅' : '⚠️'
      const size = d.lines > 10 ? `${d.lines} lignes` : `${d.lines} lignes (court)`
      console.log(`  ${icon} ${d.name}  ${size}`)
      if (d.hasContent) score++
    } else {
      console.log(`  ❌ ${d.name}  (manquant)`)
    }
    maxScore++
  }

  console.log('')
  const pct = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0
  const grade = pct >= 80 ? 'A' : pct >= 50 ? 'B' : pct >= 30 ? 'C' : 'D'
  console.log(`  Score : ${score}/${maxScore} (${pct}%) — Niveau ${grade}`)
  console.log('')

  if (pct < 80) {
    const missing = docs.filter(d => !d.exists).map(d => d.name)
    if (missing.length > 0) {
      console.log(`  📝 Docs manquantes :`)
      for (const m of missing) console.log(`    • ${m}`)
      console.log('')
      console.log('  Pour générer : !doc create README <projet>')
    }
  }

  console.log('═══════════════════════════════════════════')
}

function actionCreateReadme(projectName) {
  const { cleanName, projectPath } = findProject(projectName)
  const readmePath = join(projectPath, 'README.md')

  if (existsSync(readmePath) && readFileSync(readmePath, 'utf-8').trim().length > 50) {
    console.log(`⚠ Un README.md existe déjà pour "${cleanName}".`)
    console.log('  Utilise !doc update pour le mettre à jour.')
    process.exit(1)
  }

  // Collecter des infos sur le projet pour le README
  const info = { name: cleanName, description: '', deps: [], scripts: [], tasks: [] }

  // Lire .workspace
  const wsPath = join(projectPath, '.workspace')
  if (existsSync(wsPath)) {
    const raw = readFileSync(wsPath, 'utf-8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^(\w[\w-]*):\s*(.*)/)
      if (m) info[m[1]] = m[2].replace(/^['"]|['"]$/g, '').trim()
    }
  }

  // Lire package.json
  const pkgPath = join(projectPath, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
      info.deps = Object.keys(pkg.dependencies || {})
      info.scripts = Object.entries(pkg.scripts || {}).map(([n, c]) => `${n}: ${c}`)
    } catch { /* skip */ }
  }

  // Lire les tâches
  const tasksPath = join(projectPath, '.tasks.json')
  if (existsSync(tasksPath)) {
    try {
      const board = JSON.parse(readFileSync(tasksPath, 'utf-8'))
      info.tasks = (board.tasks || []).slice(0, 10)
    } catch { /* skip */ }
  }

  const content = `# ${info.name || cleanName}

${info.description || `Projet ${cleanName} du système Minautor Agents.`}

## Description

Projet géré via Minautor Agents — assistant IA pour le développement agentique.

## Structure

\`\`\`
workspaces/${cleanName}/
├── .workspace          # Configuration du projet
├── .tasks.json         # Tableau des tâches
├── README.md           # Ce fichier
${info.deps.length > 0 ? '├── package.json        # Dépendances Node.js' : ''}
└── src/                # Code source
\`\`\`

## Tâches

${info.tasks.length > 0
  ? info.tasks.map(t => `- [${t.status === 'done' ? 'x' : ' '}] \`${t.id}\` ${t.title} ${t.status === 'in_progress' ? '(en cours)' : ''}`).join('\n')
  : 'Aucune tâche pour le moment.'}

## Démarrage

\`\`\`bash
# Installer les dépendances
${info.deps.length > 0 ? 'npm install' : '# Aucune dépendance — projet purement structurel'}
\`\`\`

## Commandes disponibles

${info.scripts.length > 0
  ? info.scripts.map(s => `- \`npm run ${s}\``).join('\n')
  : 'Aucun script npm configuré.'}
`

  try {
    writeFileSync(readmePath, content, 'utf-8')
    console.log(`✅ README.md généré pour "${cleanName}"`)
    console.log(`   ${readmePath}`)
  } catch (err) {
    console.log(`❌ Erreur d'écriture : ${(err as Error).message}`)
    process.exit(1)
  }
}

function actionUpdate(projectName) {
  const { cleanName, projectPath } = findProject(projectName)
  const readmePath = join(projectPath, 'README.md')

  if (!existsSync(readmePath)) {
    console.log(`⚠ Aucun README.md trouvé pour "${cleanName}".`)
    console.log('  Utilise d\'abord !doc create README <projet>')
    process.exit(1)
  }

  const oldContent = readFileSync(readmePath, 'utf-8')
  const oldLines = oldContent.split('\n')

  // Mettre à jour la section des tâches
  const tasksPath = join(projectPath, '.tasks.json')
  if (existsSync(tasksPath)) {
    try {
      const board = JSON.parse(readFileSync(tasksPath, 'utf-8'))
      const tasks = (board.tasks || []).slice(0, 10)
      const taskSection = tasks.length > 0
        ? tasks.map(t => `- [${t.status === 'done' ? 'x' : ' '}] \`${t.id}\` ${t.title} ${t.status === 'in_progress' ? '(en cours)' : ''}`).join('\n')
        : 'Aucune tâche pour le moment.'

      // Remplacer la section "## Tâches" dans le contenu
      const taskRegex = /## Tâches[\s\S]*?(?=## |$)/m
      if (taskRegex.test(oldContent)) {
        const newContent = oldContent.replace(taskRegex, `## Tâches\n\n${taskSection}\n\n`)
        writeFileSync(readmePath, newContent, 'utf-8')
        console.log(`✅ README.md mis à jour pour "${cleanName}" (section tâches)`)
      } else {
        // Ajouter la section tâches à la fin
        const newContent = oldContent.trim() + `\n\n## Tâches\n\n${taskSection}\n`
        writeFileSync(readmePath, newContent, 'utf-8')
        console.log(`✅ README.md mis à jour pour "${cleanName}" (section tâches ajoutée)`)
      }
    } catch (err) {
      console.log(`⚠ Erreur lors de la mise à jour des tâches : ${(err as Error).message}`)
    }
  } else {
    console.log(`⚠ Aucune tâche à synchroniser.`)
  }
}

function main() {
  const args = process.argv.slice(2)
  if (args.length < 2) {
    usage()
    process.exit(1)
  }

  const action = args[0].toLowerCase()

  if (action === 'check') {
    actionCheck(args[1])
  } else if (action === 'create') {
    if (args[1]?.toLowerCase() === 'readme') {
      if (args[2]) {
        actionCreateReadme(args[2])
      } else {
        console.log('❌ Nom du projet manquant pour create README.')
        usage()
        process.exit(1)
      }
    } else {
      console.log(`❌ Type de document inconnu : "${args[1]}".`)
      console.log('  Types supportés : README')
      process.exit(1)
    }
  } else if (action === 'update') {
    actionUpdate(args[1])
  } else {
    console.log(`❌ Action inconnue : "${action}".`)
    usage()
    process.exit(1)
  }
}

main()
