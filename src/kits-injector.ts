/**
 * kits-injector — Injection automatique des imports de kits
 *
 * Détecte les marqueurs // @kit <nom> dans le contenu d'un fichier
 * et injecte les imports correspondants depuis kits/registry.json.
 *
 * ## Utilisation
 *
 * ```ts
 * import { injectKits, getKitInfo, suggestKits } from './kits-injector.js'
 *
 * // L'agent écrit un fichier avec le marqueur
 * const content = `// @kit tests
 * import { describe } from 'vitest'
 * describe('test', () => { ... })`
 *
 * // Le moteur injecte automatiquement l'import du kit
 * const result = injectKits(content, '/path/to/my-component.test.ts')
 * ```
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { relative, dirname, sep, resolve } from 'path'

// ── Types ─────────────────────────────────────────────────────────────

interface KitEntry {
  name: string
  path: string
  description: string
  triggers: string[]
  exports: string[]
}

interface Registry {
  version: string
  kits: KitEntry[]
}

// ── Cache du registre ─────────────────────────────────────────────────

let registryCache: Registry | null = null
let registryPath = ''

/**
 * Définit le chemin vers le fichier registry.json.
 * Appelé une fois à l'initialisation du moteur.
 */
export function setRegistryPath(filePath: string): void {
  registryPath = filePath
  registryCache = null // Invalide le cache
}

/**
 * Charge et retourne le registre des kits depuis le disque.
 * Le résultat est mis en cache pour les appels suivants.
 */
export function loadRegistry(): Registry {
  if (registryCache) return registryCache

  const path = registryPath || resolve(process.cwd(), 'kits/registry.json')

  try {
    const raw = readFileSync(path, 'utf-8')
    registryCache = JSON.parse(raw) as Registry
    return registryCache
  } catch (err) {
    console.warn(`[kits-injector] Impossible de charger le registre (${path}): ${(err as Error).message}`)
    return { version: '1', kits: [] }
  }
}

/**
 * Vide le cache du registre. Utile pour les tests.
 */
export function clearRegistryCache(): void {
  registryCache = null
}

// ── Recherche dans le registre ────────────────────────────────────────

/**
 * Trouve un kit par son nom (tel qu'utilisé dans le marqueur @kit).
 */
export function findKit(name: string): KitEntry | undefined {
  const reg = loadRegistry()
  return reg.kits.find(k => k.name === name)
}

/**
 * Retourne la liste complète des noms de kits disponibles.
 */
export function getKitNames(): string[] {
  const reg = loadRegistry()
  return reg.kits.map(k => k.name)
}

/**
 * Retourne les informations détaillées d'un kit par son nom.
 */
export function getKitInfo(name: string): { name: string; description: string; exports: string[] } | undefined {
  const kit = findKit(name)
  if (!kit) return undefined
  return {
    name: kit.name,
    description: kit.description,
    exports: kit.exports,
  }
}

// ── Détection des marqueurs ───────────────────────────────────────────

const KIT_MARKER_PATTERN = /\/\/\s*@kit\s+(\S+)/

/**
 * Détecte tous les marqueurs // @kit <nom> dans le contenu.
 * Retourne la liste des noms de kits trouvés (dédupliquée).
 */
export function detectKitMarkers(content: string): string[] {
  const names = new Set<string>()
  const regex = new RegExp(KIT_MARKER_PATTERN.source, 'g')
  let match: RegExpExecArray | null
  while ((match = regex.exec(content)) !== null) {
    names.add(match[1]!.trim())
  }
  return Array.from(names)
}

/**
 * Vérifie si un nom de fichier correspond à un trigger glob.
 * Support basique : *.test.ts, *.spec.ts, *.ts
 */
function matchesTrigger(filename: string, trigger: string): boolean {
  // Trigger simple comme "*.ts" — vérifie l'extension
  if (trigger.startsWith('*.')) {
    const ext = trigger.slice(1) // e.g. ".test.ts"
    return filename.endsWith(ext)
  }
  // Trigger exact
  return filename === trigger
}

/**
 * Suggère des kits appropriés pour un fichier, basé sur son nom et les triggers du registre.
 */
export function suggestKits(filename: string): KitEntry[] {
  const reg = loadRegistry()
  const basename = filename.split(sep).pop() || filename
  return reg.kits.filter(kit =>
    kit.triggers.some(trigger => matchesTrigger(basename, trigger))
  )
}

// ── Calcul du chemin d'import relatif ─────────────────────────────────

/**
 * Calcule le chemin d'import relatif entre un fichier et un kit,
 * en utilisant des séparateurs POSIX (/).
 *
 * Exemples :
 *   - fichier: src/test.ts → ../../kits/kit-tests/index.js  →  ../kits/kit-tests/index.js
 *   - fichier: kits/kit-tests/test.ts → ./index.js
 */
export function computeRelativePath(filePath: string, kitPath: string): string {
  const fileDir = dirname(filePath).replace(/\\/g, '/')
  const kitAbsolute = kitPath.replace(/\\/g, '/')

  let rel = relative(fileDir, kitAbsolute).replace(/\\/g, '/')

  // Si le chemin relatif ne commence pas par . ou .., on ajoute ./
  if (!rel.startsWith('.') && !rel.startsWith('/')) {
    rel = './' + rel
  }

  // Normaliser les séparateurs
  return rel.split('/').filter(Boolean).join('/')
}

// ── Génération de la ligne d'import ───────────────────────────────────

/**
 * Génère la ligne d'import pour un kit donné.
 *
 * Exemple :
 *   import { stopTestOnError } from '../../kits/kit-tests/index.js'
 */
export function generateImportLine(kit: KitEntry, relativePath: string): string {
  const exports = kit.exports.map(e => e.trim()).filter(Boolean)
  if (exports.length === 0) return ''

  const namedImports = exports.join(', ')
  return `import { ${namedImports} } from '${relativePath}'`
}

/**
 * Vérifie si un import pour un kit donné existe déjà dans le contenu.
 * Cherche une ligne avec 'from' et le nom du kit dans le chemin.
 */
export function hasExistingImport(content: string, kitName: string): boolean {
  const lines = content.split('\n')
  const kitPathPattern = `kit-${kitName}/index.js`
  return lines.some(line => {
    const trimmed = line.trim()
    return trimmed.startsWith('import ') && trimmed.includes(kitPathPattern)
  })
}

// ── Injection principale ──────────────────────────────────────────────

/**
 * Injecte les imports de kits dans le contenu d'un fichier.
 *
 * 1. Détecte les marqueurs // @kit <nom> dans le contenu
 * 2. Pour chaque kit trouvé, vérifie s'il n'est pas déjà importé
 * 3. Calcule le chemin relatif du fichier vers le kit
 * 4. Ajoute la ligne d'import après les marqueurs @kit, avant tout autre code
 *
 * @param content   Contenu du fichier à traiter
 * @param filePath  Chemin absolu ou relatif du fichier (pour le calcul des chemins d'import)
 * @returns         Le contenu modifié avec les imports ajoutés
 */
export function injectKits(content: string, filePath: string): string {
  const kitNames = detectKitMarkers(content)
  if (kitNames.length === 0) return content

  const importsToAdd: string[] = []

  for (const name of kitNames) {
    const kit = findKit(name)
    if (!kit) {
      console.warn(`[kits-injector] Kit "${name}" inconnu dans le registre — ignoré`)
      continue
    }

    // Vérifier si l'import existe déjà
    if (hasExistingImport(content, name)) continue

    const relativePath = computeRelativePath(filePath, kit.path)
    const importLine = generateImportLine(kit, relativePath)
    if (importLine) {
      importsToAdd.push(importLine)
    }
  }

  if (importsToAdd.length === 0) return content

  // Ajouter les imports après le dernier marqueur @kit, avant les autres imports ou le code
  const lines = content.split('\n')
  let insertionIndex = -1

  for (let i = lines.length - 1; i >= 0; i--) {
    if (/\/\/\s*@kit\s+\S+/.test(lines[i]!)) {
      insertionIndex = i + 1
      break
    }
  }

  // Si aucun marqueur trouvé (ne devrait pas arriver), insérer après la première ligne de commentaire
  if (insertionIndex === -1) {
    return content
  }

  // Construire le nouveau contenu
  const before = lines.slice(0, insertionIndex)
  const after = lines.slice(insertionIndex)

  // Ajouter une ligne vide si la ligne suivante n'est pas déjà vide
  const needsLeadingBlank = after.length > 0 && after[0]!.trim().length > 0

  const importBlock = needsLeadingBlank
    ? ['', ...importsToAdd, '']
    : [...importsToAdd, '']

  return [...before, ...importBlock, ...after].join('\n')
}

// ── Parsing heredoc (partagé) ─────────────────────────────────────────

interface HeredocInfo {
  /** Chemin du fichier cible (relatif ou absolu selon la commande) */
  filePath: string
  /** Contenu entre les marqueurs heredoc */
  content: string
  /** Nom du marqueur de fermeture */
  marker: string
  /** Index de la ligne d'ouverture dans la commande */
  heredocStart: number
  /** Index du marqueur de fermeture */
  closingIndex: number
}

/**
 * Supprime les guillemets simples ou doubles autour d'un chemin shell.
 *
 * Exemples :
 *   "path with spaces.ts" → path with spaces.ts
 *   'path with spaces.ts'  → path with spaces.ts
 *   simple.ts             → simple.ts
 */
function stripShellQuotes(s: string): string {
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1)
  if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1)
  return s
}

/**
 * Extrait les informations d'une commande shell heredoc.
 *
 * Patterns supportés :
 *   cat > <path> << '<MARKER>'\n<content>\n<MARKER>
 *   cat << '<MARKER>' > <path>\n<content>\n<MARKER>
 *
 * Les chemins peuvent être quotés ("path.ts", 'path.ts') ou non (path.ts).
 *
 * TODO: Support des espaces échappés (backslash-space) dans les chemins
 */
function extractHeredocInfo(command: string): HeredocInfo | null {
  const lines = command.split('\n')
  if (lines.length < 3) return null

  // Cherche la première occurrence de cat > ou cat << dans la commande
  const heredocStart = lines.findIndex(line =>
    /\bcat\s+>\s+(?:"[^"]*"|'[^']*'|\S+)\s+<</.test(line) || /\bcat\s+<<\s*['"]?\w+['"]?\s+>/.test(line)
  )
  if (heredocStart === -1) return null

  const firstLine = lines[heredocStart]!.trimEnd()

  // Pattern 1 : cat > <path> << ['"]?MARKER['"]?
  const match1 = firstLine.match(/\bcat\s+>\s+((?:"[^"]*"|'[^']*'|\S+))\s+<<\s*'?"?(\w+)'?"?/)
  // Pattern 2 : cat << ['"]?MARKER['"]? > <path>
  const match2 = firstLine.match(/\bcat\s+<<\s*'?"?(\w+)'?"?\s+>\s+((?:"[^"]*"|'[^']*'|\S+))/)

  const marker = match1?.[2] || match2?.[1]
  const rawPath = match1?.[1] || match2?.[2]
  if (!marker || !rawPath) return null
  const filePath = stripShellQuotes(rawPath)

  // Trouver la ligne de fermeture du heredoc (après la ligne de départ)
  const closingIndex = lines.findIndex((line, i) => i > heredocStart && line.trim() === marker)
  if (closingIndex === -1) return null

  // Extraire le contenu entre la première ligne et le marqueur de fermeture
  const contentLines = lines.slice(heredocStart + 1, closingIndex)
  const content = contentLines.join('\n')

  return { filePath, content, marker, heredocStart, closingIndex }
}

// ── Interception heredoc ──────────────────────────────────────────────

/**
 * Intercepte les commandes shell heredoc pour injecter les imports de kits
 * avant l'écriture sur disque.
 *
 * @param command      Commande shell à analyser
 * @param commandCwd   Répertoire de travail pour résoudre les chemins relatifs
 * @returns            La commande modifiée avec les imports injectés, ou la commande originale
 */
export function injectKitsIntoCommand(command: string, commandCwd: string): string {
  const info = extractHeredocInfo(command)
  if (!info) return command

  const { filePath, content, heredocStart, closingIndex } = info
  const lines = command.split('\n')

  // Résoudre le chemin absolu du fichier pour un calcul correct des imports relatifs
  const absolutePath = resolve(commandCwd, filePath)

  // Injecter les imports de kits
  const injected = injectKits(content, absolutePath)

  if (injected === content) return command // Aucun changement

  // Reconstruire la commande avec le contenu modifié
  return [
    ...lines.slice(0, heredocStart),
    lines[heredocStart]!,
    ...injected.split('\n'),
    ...lines.slice(closingIndex),
  ].join('\n')
}

// ── Extraction de chemin fichier (multi-pattern) ─────────────────────

/**
 * Extrait le chemin du fichier cible d'une commande shell,
 * quel que soit le mode d'écriture utilisé.
 *
 * Patterns supportés :
 *   - Heredoc  : cat > <path> << 'MARKER'  /  cat << 'MARKER' > <path>
 *   - Echo     : echo "..." > <path> / echo '...' >> <path>  (guillemets simple, double ou sans)
 *   - Printf   : printf 'format' > <path> / printf "format" arg > <path>
 *   - sed -i   : sed -i 's/.../.../g' <path> / sed -i.bak 's/.../' <path>
 *   - cp       : cp <src> <dest> / cp -r <src> <dest> (capture le dernier argument)
 *   - Tee      : ... | tee <path>  /  ... | tee -a <path>
 *   - Redirect : <commande> > <path.ext> (nécessite un point dans le chemin)
 *
 * Les chemins peuvent être quotés ("path.ts", 'path.ts') ou non (path.ts).
 *
 * TODO: Support des espaces échappés (backslash-space) dans les chemins
 */
export function extractTargetFilePath(command: string): string | null {
  // 1. Essayer le pattern heredoc d'abord (le plus spécifique)
  const heredocInfo = extractHeredocInfo(command)
  if (heredocInfo) return heredocInfo.filePath

  const lines = command.split('\n')

  for (const line of lines) {
    // Ignorer les lignes contenant find ... -exec (les patterns sed/cp/echo/etc.
    // pourraient correspondre à des arguments de -exec, pas à la commande elle-même)
    if (/\bfind\b.*-exec\b/.test(line)) continue

    // 2. echo "content" > path  ou  echo 'content' > path  ou  echo content > path
    //    Options echo supportées : -e, -E, -n (optionnelles)
    //    Contenu : simple quote, double quote, ou mots non quotés
    //    Attention : ne pas confondre avec 2> (stderr redirect) ou 2>&1
    //    On utilise (?<!\d) pour rejeter les redirections de fd (ex: "echo test 2> /dev/null")
    const echoMatch = line.match(
      /\becho\s+(?:-(?:e|E|n)\s+)?(?:'[^']*'|"[^"]*"|[^>]*)(?<!\d)\s*(>{1,2})\s*((?:"[^"]*"|'[^']*'|\S+))/
    )
    if (echoMatch) return stripShellQuotes(echoMatch[2])

    // 3. printf 'format' > path  ou  printf "format" arg > path
    const printfMatch = line.match(
      /\bprintf\s+(?:'[^']*'|"[^"]*"|[^>]*)(?<!\d)\s*(>{1,2})\s*((?:"[^"]*"|'[^']*'|\S+))/
    )
    if (printfMatch) return stripShellQuotes(printfMatch[2])

    // 4. sed -i [SUFFIX] 'SCRIPT' file  →  in-place edit
    const sedMatch = line.match(
      /\bsed\s+-i(?:\S*)\s+(?:'[^']*'|"[^"]*"|\S+)\s+((?:"[^"]*"|'[^']*'|\S+))/
    )
    if (sedMatch) return stripShellQuotes(sedMatch[1])

    // 5. cp source dest  — capture le dernier argument (destination)
    //    Supporte les flags optionnels et plusieurs sources
    const cpMatch = line.match(
      /\bcp\s+(?:-\S+\s+)*(?:'[^']*'|"[^"]*"|\S+)(?:\s+(?:'[^']*'|"[^"]*"|\S+))*\s+((?:"[^"]*"|'[^']*'|\S+))/    )
    if (cpMatch) return stripShellQuotes(cpMatch[1])

    // 6. ... | tee path  ou  ... | tee -a path
    const teeMatch = line.match(/\|\s*\btee\s+(?:-a\s+)?((?:"[^"]*"|'[^']*'|\S+))/)
    if (teeMatch) return stripShellQuotes(teeMatch[1])

    // 7. Redirect simple : <commande> > <path.ext>
    //    Nécessite un point dans le chemin (extension fichier).
    //    Exclut les redirections de fd (N>, &>) en utilisant un lookbehind
    //    combiné à un lookbehind pour > suivie d'un autre >.
    const redirectMatch = line.match(
      /(?<![\d&>])(?:>{2}|>(?!>))\s+((?:"[^"]*"|'[^']*'|\S*\.\S+))/
    )
    if (redirectMatch) return stripShellQuotes(redirectMatch[1])
  }

  return null
}

// ── Brace expansion ───────────────────────────────────────────────────

/**
 * Expandit les accolades shell ({a,b,c}) dans un pattern de chemin.
 *
 * Exemples :
 *   src/{a,b,c}.ts  → ['src/a.ts', 'src/b.ts', 'src/c.ts']
 *   {a,b}/{c,d}.ts  → ['a/c.ts', 'a/d.ts', 'b/c.ts', 'b/d.ts']
 *   src/simple.ts   → ['src/simple.ts']
 *
 * Note : ne supporte que les accolades simples (non imbriquées).
 */
export function expandBrace(pattern: string): string[] {
  const braceRegex = /\{([^{}]+)\}/
  const match = pattern.match(braceRegex)
  if (!match) return [pattern]

  const [full, inner] = match
  const parts = inner!.split(',').map(p => p.trim())
  const results: string[] = []

  for (const part of parts) {
    const expanded = pattern.replace(full, part)
    results.push(...expandBrace(expanded))
  }

  return results
}

// ── Glob récursif simple ──────────────────────────────────────────────

/**
 * Parcourt récursivement un répertoire et retourne les chemins absolus
 * des fichiers dont le nom correspond au pattern (ex: *.ts, *.test.ts).
 * Ignore les dossiers cachés (.git, .cache, etc.) et node_modules.
 */
function recursiveGlob(dir: string, namePattern: string): string[] {
  const results: string[] = []
  // Pour les patterns simples comme *.ts, on extrait l'extension
  const ext = namePattern.startsWith('*.') ? namePattern.slice(1) : null

  const ignoredDirs = new Set(['.git', '.cache', '.temp', 'node_modules', 'dist', 'build', 'coverage', '.nyc_output'])

  function walk(currentDir: string): void {
    let entries: string[]
    try {
      entries = readdirSync(currentDir)
    } catch {
      return
    }

    for (const entry of entries) {
      const fullPath = resolve(currentDir, entry)
      let stat
      try {
        stat = statSync(fullPath)
      } catch {
        continue
      }

      if (stat.isDirectory()) {
        if (!entry.startsWith('.') && !ignoredDirs.has(entry)) {
          walk(fullPath)
        }
      } else if (stat.isFile()) {
        if (ext ? entry.endsWith(ext) : entry === namePattern) {
          results.push(fullPath)
        }
      }
    }
  }

  walk(dir)
  return results
}

// ── Extraction de chemins multi-fichiers ──────────────────────────────

/**
 * Extrait les chemins cibles d'une commande shell qui crée/modifie
 * plusieurs fichiers. Patterns supportés :
 *
 *   - find -exec : find <dir> -name "<glob>" -exec <cmd> {} \\;
 *
 * @param command  Commande shell à analyser
 * @param cwd      Répertoire de travail pour résoudre les chemins
 * @returns        Liste des chemins absolus des fichiers cibles, ou [] si aucun
 */
export function extractFindTargets(command: string, cwd: string): string[] {
  // Pattern : find <dir> -name|-iname "<pattern>" ...
  const findMatch = command.match(
    /^find\s+((?:"[^"]*"|'[^']*'|\S+))\s+(?:-name|-iname)\s+((?:"[^"]*"|'[^']*'|\S+))/
  )
  if (!findMatch) return []

  const rawDir = stripShellQuotes(findMatch[1]!)
  const rawPattern = stripShellQuotes(findMatch[2]!)
  if (!rawDir || !rawPattern) return []

  const dir = resolve(cwd, rawDir)
  return recursiveGlob(dir, rawPattern)
}

// ── Scan post-écriture (multi-fichier) ────────────────────────────────

/**
 * Scanne les fichiers écrits par une commande shell après exécution
 * et retourne les alertes de conformité des kits.
 *
 * Supporte les patterns d'écriture suivants :
 *   - Heredoc  : cat > <path> << 'MARKER' / cat << 'MARKER' > <path>
 *   - Echo     : echo "..." > <path> / echo '...' >> <path>
 *   - Tee      : ... | tee <path> / ... | tee -a <path>
 *   - find     : find <dir> -name "<glob>" -exec ...
 *   - Brace    : echo "..." > src/{a,b,c}.ts (expansion automatique)
 *
 * Lit chaque fichier depuis le disque et appelle scanFile() pour détecter :
 * - Les marqueurs @kit sans import correspondant
 * - Les kits recommandés (basés sur les triggers) non marqués
 *
 * @param command    Commande shell exécutée
 * @param commandCwd Répertoire de travail pour résoudre les chemins
 * @returns          Chaîne vide si tout est OK, ou un message formaté avec les alertes
 */
export function scanCommandOutput(command: string, commandCwd: string): string {
  // Étape 1 : essayer l'extraction mono-fichier
  const singlePath = extractTargetFilePath(command)
  let targetPaths: string[] = []

  if (singlePath) {
    // Étendre les accolades shell ({a,b,c} → [a, b, c])
    targetPaths = expandBrace(singlePath)
  } else {
    // Étape 2 : essayer le pattern find -exec
    targetPaths = extractFindTargets(command, commandCwd)
  }

  if (targetPaths.length === 0) return ''

  // Scanner chaque fichier cible
  const warnings: string[] = []

  for (const relativePath of targetPaths) {
    const absolutePath = resolve(commandCwd, relativePath)

    let content: string
    try {
      content = readFileSync(absolutePath, 'utf-8')
    } catch {
      continue // Fichier non trouvé — silencieux
    }

    const result = scanFile(content, absolutePath)

    if (result.missingKits.length === 0 && result.suggestions.length === 0) continue

    // Ajouter un en-tête par fichier si plusieurs fichiers
    if (targetPaths.length > 1) {
      warnings.push(`\n📄 ${relativePath}:`)
    }

    if (result.missingKits.length > 0) {
      warnings.push('⚠️  [kits-injector] Marqueurs @kit sans import dans le fichier :')
      for (const mk of result.missingKits) {
        warnings.push(`    - ${mk.name} : ${mk.reason}`)
      }
    }

    if (result.suggestions.length > 0) {
      warnings.push('💡 [kits-injector] Kits recommandés (non marqués) :')
      for (const s of result.suggestions) {
        warnings.push(`    - ${s.kitName} : ${s.reason}`)
      }
    }
  }

  if (warnings.length === 0) return ''

  return `\n📋 Scan des kits :${warnings.join('\n')}`
}

// ── Scan post-création ────────────────────────────────────────────────

interface ScanResult {
  filePath: string
  missingKits: { name: string; reason: string }[]
  presentKits: string[]
  suggestions: { kitName: string; reason: string }[]
}

/**
 * Scanne le contenu d'un fichier pour vérifier que tous les kits
 * marqués sont bien importés. Émet des suggestions si des kits
 * applicables (basés sur les triggers) ne sont pas marqués.
 */
export function scanFile(content: string, filePath: string): ScanResult {
  const markedKits = detectKitMarkers(content)
  const present: string[] = []
  const missing: { name: string; reason: string }[] = []

  for (const name of markedKits) {
    const kit = findKit(name)
    if (!kit) {
      missing.push({ name, reason: `Kit "${name}" inconnu dans le registre` })
      continue
    }
    if (!hasExistingImport(content, name)) {
      missing.push({ name, reason: `Import manquant pour le kit "${name}"` })
    } else {
      present.push(name)
    }
  }

  const suggestions: { kitName: string; reason: string }[] = []
  const suggestedKits = suggestKits(filePath)
  for (const kit of suggestedKits) {
    if (!markedKits.includes(kit.name)) {
      suggestions.push({
        kitName: kit.name,
        reason: `Fichier "${filePath}" correspond au trigger "${kit.triggers.join(', ')}"`,
      })
    }
  }

  return {
    filePath,
    missingKits: missing,
    presentKits: present,
    suggestions,
  }
}
