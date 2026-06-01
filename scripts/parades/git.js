#!/usr/bin/env node
/**
 * scripts/parades/git.js — Opérations git courantes
 *
 * Usage: node scripts/parades/git.js <action> [projet] [options]
 *
 * Actions :
 *   status [projet]         Affiche le statut git
 *   log [projet] [-n <N>]   Affiche l'historique des commits
 *   diff [projet]           Affiche les modifications non commitées
 *   tag [projet] [nom]      Liste/crée un tag
 *   branches [projet]       Liste les branches
 *   config [projet]         Affiche la configuration git du projet
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const __dirname = join(fileURLToPath(import.meta.url), '..')
const PROJECT_ROOT = join(__dirname, '..', '..')
const WORKSPACES_DIR = join(PROJECT_ROOT, 'workspaces')

function usage() {
  console.log('Usage: node scripts/parades/git.js <action> [projet] [options]')
  console.log('')
  console.log('Actions :')
  console.log('  status [projet]         Statut du working tree')
  console.log('  log [projet] [-n <N>]   Historique des commits (défaut: 10)')
  console.log('  diff [projet]           Modifications non commitées')
  console.log('  tag [projet] [nom]      Liste les tags ou crée un tag')
  console.log('  branches [projet]       Liste les branches')
  console.log('  config [projet]         Configuration git')
  console.log('')
  console.log('Options :')
  console.log('  -n <N>     Nombre de commits (pour log)')
}

function findProjectPath(projectName) {
  if (!projectName) {
    const entries = readdirSync(WORKSPACES_DIR, { withFileTypes: true })
    const projects = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.') && existsSync(join(WORKSPACES_DIR, e.name, '.git')))
      .map(e => e.name)
    if (projects.length === 0) return null
    // Prendre le premier projet avec .git, ou celui nommé "minautor"
    const preferred = projects.find(p => p === 'minautor' || p === 'minautor-agents-service')
    return preferred ? join(WORKSPACES_DIR, preferred) : join(WORKSPACES_DIR, projects[0])
  }
  const cleanName = projectName.replace(/[^a-z0-9_-]/gi, '').toLowerCase()
  const projectPath = join(WORKSPACES_DIR, cleanName)
  if (!existsSync(projectPath)) {
    // Essayer le project root
    if (existsSync(join(PROJECT_ROOT, '.git'))) return PROJECT_ROOT
    return null
  }
  return projectPath
}

function ensureGit(path) {
  if (!existsSync(join(path, '.git'))) {
    console.log(`❌ "${path}" n'est pas un dépôt git.`)
    process.exit(1)
  }
}

function git(args, cwd, timeout = 10000) {
  try {
    return execSync(`git ${args}`, { cwd, encoding: 'utf-8', timeout }).trim()
  } catch {
    return ''
  }
}

function actionStatus(projectName) {
  const projectPath = findProjectPath(projectName)
  if (!projectPath) {
    console.log('❌ Aucun projet git trouvé dans workspaces/.')
    process.exit(1)
  }
  ensureGit(projectPath)

  const name = projectName || projectPath.split(/[/\\]/).pop()

  console.log('═══════════════════════════════════════════')
  console.log(`  🔖 Git Status : ${name}`)
  console.log('═══════════════════════════════════════════')
  console.log('')

  try {
    const status = git('status --short', projectPath)
    if (!status) {
      console.log('  ✅ Working tree propre. Rien à commiter.')
      console.log('')
      // Afficher la branche courante
      const branch = git('rev-parse --abbrev-ref HEAD', projectPath)
      const ahead = git('rev-list --count @{u}..HEAD 2>nul || echo 0', projectPath)
      console.log(`  🌿 Branche : ${branch}`)
      if (ahead && ahead !== '0') console.log(`  ⬆ ${ahead} commit(s) en avance sur remote`)
      console.log('')
    } else {
      const lines = status.split('\n')
      const staged = lines.filter(l => l[0] !== ' ').length
      const unstaged = lines.filter(l => l[0] === ' ').length
      const untracked = lines.filter(l => l.startsWith('??')).length

      console.log(`  📝 Modifications : ${lines.length} fichier(s)`)
      console.log(`  ✅ Stagés : ${staged}`)
      console.log(`  ✏️  Non stagés : ${unstaged}`)
      console.log(`  ➕ Non suivis : ${untracked}`)
      console.log('')

      for (const line of lines) {
        const flag = line.slice(0, 2).trim()
        const file = line.slice(3).trim()
        const icon = flag === 'M' ? '✏️' : flag === 'A' ? '➕' : flag === 'D' ? '🗑️' : flag === 'R' ? '🔀' : flag === '??' ? '➕' : '❓'
        console.log(`  ${icon} ${file}  (${flag.trim() || 'nouveau'})`)
      }
      console.log('')

      const branch = git('rev-parse --abbrev-ref HEAD', projectPath)
      console.log(`  🌿 Branche : ${branch}`)
    }
  } catch (err) {
    console.log(`❌ Erreur git : ${(err).message.slice(0, 150)}`)
    process.exit(1)
  }

  console.log('═══════════════════════════════════════════')
}

function actionLog(projectName, count) {
  const projectPath = findProjectPath(projectName)
  if (!projectPath) {
    console.log('❌ Aucun projet git trouvé dans workspaces/.')
    process.exit(1)
  }
  ensureGit(projectPath)

  const name = projectName || projectPath.split(/[/\\]/).pop()

  console.log('═══════════════════════════════════════════')
  console.log(`  🔖 Git Log : ${name} (${count} commits)` )
  console.log('═══════════════════════════════════════════')
  console.log('')

  const log = git(`log --oneline --graph --decorate -${count} --all`, projectPath, 15000)
  if (log) {
    console.log(log)
    console.log('')
  } else {
    console.log('  (aucun commit)')
    console.log('')
  }

  // Stats additionnelles
  const total = git('rev-list --count HEAD 2>nul || echo 0', projectPath)
  const authors = git('shortlog -sn --all', projectPath, 15000)
  if (authors) {
    const authorLines = authors.split('\n').filter(Boolean)
    console.log(`  📊 ${total} commit(s) total, ${authorLines.length} contributeur(s)`)
    console.log('')
  }

  console.log('═══════════════════════════════════════════')
}

function actionDiff(projectName) {
  const projectPath = findProjectPath(projectName)
  if (!projectPath) {
    console.log('❌ Aucun projet git trouvé dans workspaces/.')
    process.exit(1)
  }
  ensureGit(projectPath)

  const name = projectName || projectPath.split(/[/\\]/).pop()

  console.log('═══════════════════════════════════════════')
  console.log(`  🔖 Git Diff : ${name}`)
  console.log('═══════════════════════════════════════════')
  console.log('')

  const diff = git('diff --stat', projectPath)
  if (diff) {
    console.log('  Fichiers modifiés (stat) :')
    console.log('')
    for (const line of diff.split('\n')) {
      console.log(`  ${line}`)
    }
    console.log('')
  } else {
    console.log('  ✅ Aucune modification non commitée.')
    console.log('')
  }

  console.log('═══════════════════════════════════════════')
}

function actionTag(projectName, tagName) {
  const projectPath = findProjectPath(projectName)
  if (!projectPath) {
    console.log('❌ Aucun projet git trouvé dans workspaces/.')
    process.exit(1)
  }
  ensureGit(projectPath)

  const name = projectName || projectPath.split(/[/\\]/).pop()

  if (tagName) {
    // Créer un tag
    const now = new Date()
    const defaultMsg = `Version du ${now.toISOString().slice(0, 10)}`
    // Pas de interaction, on crée le tag directement
    const result = git(`tag -a "${tagName}" -m "${defaultMsg}"`, projectPath)
    if (result === '' || !result) {
      console.log(`✅ Tag "${tagName}" créé sur "${name}".`)
      console.log('')
      console.log(`  Pour pusher : git push origin "${tagName}"`)
    } else {
      console.log(`❌ Erreur : ${result}`)
      process.exit(1)
    }
  } else {
    // Lister les tags
    const tags = git('tag --sort=-creatordate', projectPath)
    const tagCount = tags ? tags.split('\n').filter(Boolean).length : 0

    console.log('═══════════════════════════════════════════')
    console.log(`  🔖 Git Tags : ${name} (${tagCount})`)
    console.log('═══════════════════════════════════════════')
    console.log('')

    if (tags) {
      for (const t of tags.split('\n').filter(Boolean)) {
        const date = git(`log -1 --format=%ci "${t}" 2>nul || echo ""`, projectPath)
        if (date) {
          console.log(`  🏷 ${t}  (${date.slice(0, 10)})`)
        } else {
          console.log(`  🏷 ${t}`)
        }
      }
    } else {
      console.log('  (aucun tag)')
    }
    console.log('')

    // Dernier tag
    const latest = git('describe --tags --abbrev=0 2>nul || echo ""', projectPath)
    if (latest) {
      console.log(`  Dernier tag : ${latest}`)
    }
    console.log('')
    console.log('  Pour créer un tag : !git tag <projet> <nom-du-tag>')
    console.log('═══════════════════════════════════════════')
  }
}

function actionBranches(projectName) {
  const projectPath = findProjectPath(projectName)
  if (!projectPath) {
    console.log('❌ Aucun projet git trouvé dans workspaces/.')
    process.exit(1)
  }
  ensureGit(projectPath)

  const name = projectName || projectPath.split(/[/\\]/).pop()

  console.log('═══════════════════════════════════════════')
  console.log(`  🔖 Git Branches : ${name}`)
  console.log('═══════════════════════════════════════════')
  console.log('')

  const branches = git('branch -a', projectPath)
  if (branches) {
    for (const line of branches.split('\n')) {
      const isCurrent = line.startsWith('*')
      const branchName = line.replace('*', '').trim()
      const icon = isCurrent ? '🌿' : '├'
      console.log(`  ${icon} ${branchName}`)
    }
  } else {
    console.log('  (aucune branche)')
  }
  console.log('')

  // Afficher la branche courante avec plus de détails
  const current = git('rev-parse --abbrev-ref HEAD', projectPath)
  const upstream = git('rev-parse --abbrev-ref --symbolic-full-name @{u} 2>nul || echo " (pas de remote)"', projectPath)
  console.log(`  Courante : ${current}`)
  console.log(`  Upstream : ${upstream}`)
  console.log('═══════════════════════════════════════════')
}

function actionConfig(projectName) {
  const projectPath = findProjectPath(projectName)
  if (!projectPath) {
    console.log('❌ Aucun projet git trouvé dans workspaces/.')
    process.exit(1)
  }
  ensureGit(projectPath)

  const name = projectName || projectPath.split(/[/\\]/).pop()

  console.log('═══════════════════════════════════════════')
  console.log(`  🔖 Git Config : ${name}`)
  console.log('═══════════════════════════════════════════')
  console.log('')

  const configItems = [
    ['user.name', '👤 Utilisateur'],
    ['user.email', '📧 Email'],
    ['core.editor', '✏️  Éditeur'],
    ['core.autocrlf', '📄 Autocrlf'],
    ['init.defaultBranch', '🌿 Branche par défaut'],
    ['remote.origin.url', '🔗 Remote origin'],
  ]

  for (const [key, label] of configItems) {
    const val = git(`config --get "${key}"`, projectPath)
    if (val) {
      console.log(`  ${label} : ${val}`)
    }
  }

  console.log('')
  const remotes = git('remote -v', projectPath)
  if (remotes) {
    console.log('  Remotes :')
    for (const line of remotes.split('\n').filter(Boolean)) {
      console.log(`    ${line}`)
    }
  }

  console.log('')
  console.log('═══════════════════════════════════════════')
}

function main() {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    usage()
    process.exit(1)
  }

  const action = args[0].toLowerCase()
  const rest = args.slice(1)

  // Parser les options
  let projectName = ''
  let count = 10
  let tagName = ''

  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '-n' && i + 1 < rest.length) {
      count = parseInt(rest[i + 1], 10) || 10
      i++
    } else if (!projectName && !rest[i].startsWith('-') && !tagName) {
      if (action === 'tag' && !tagName) {
        // Pour tag, le premier argument après l'action est le nom du tag
        // Si c'est un nom de projet connu, on le traite comme projet
        const clean = rest[i].replace(/[^a-z0-9_-]/gi, '').toLowerCase()
        if (existsSync(join(WORKSPACES_DIR, clean))) {
          projectName = rest[i]
        } else {
          tagName = rest[i]
        }
      } else {
        projectName = rest[i]
      }
    } else if (!tagName && !projectName && !rest[i].startsWith('-')) {
      tagName = rest[i]
    }
  }

  // Si pas de projet spécifié mais qu'il y a un tag, chercher automatiquement
  if (!projectName && action === 'tag') {
    // On cherche le projet automatiquement
  }

  switch (action) {
    case 'status':
      actionStatus(projectName)
      break
    case 'log':
      actionLog(projectName, count)
      break
    case 'diff':
      actionDiff(projectName)
      break
    case 'tag':
      actionTag(projectName, tagName)
      break
    case 'branches':
    case 'branch':
      actionBranches(projectName)
      break
    case 'config':
      actionConfig(projectName)
      break
    default:
      console.log(`❌ Action inconnue : "${action}".`)
      usage()
      process.exit(1)
  }
}

main()
