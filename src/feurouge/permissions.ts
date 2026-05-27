/**
 * Permissions Engine — Coeur du système FeuRouge.
 *
 * Responsabilités :
 * 1. Charger / parser le fichier YAML des permissions (data/permissions/permissions.yaml)
 * 2. Vérifier si une commande + chemin est autorisée pour un agent
 * 3. Gérer les enregistrements runtime (agent + PID + workspace)
 *
 * Le YAML parsé ici correspond au format défini dans la spec workspace-isolation-spec.md
 * Section 5 — avec la contrainte que le fichier est écrit en YAML mais
 * parsé par ce module (pas de dépendance externe).
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs'
import { join, resolve, normalize, sep } from 'path'
import type {
  PermissionConfig,
  PermissionDefaults,
  AgentPermission,
  AgentRegistration,
  PermissionLevel,
} from './types.js'

// ── Chemins ──────────────────────────────────────────────

const PERMISSIONS_DIR = join(process.cwd(), 'data', 'permissions')
const PERMISSIONS_FILE = join(PERMISSIONS_DIR, 'permissions.yaml')

// ── État runtime (en mémoire seulement) ──────────────────

/** Les agents actuellement enregistrés, indexés par PID */
const registrations = new Map<number, AgentRegistration>()

/** Les permissions parsées (rechargées via reload()) */
let permissionsCache: PermissionConfig | null = null

// ── YAML Parser minimal ──────────────────────────────────
// Gère le sous-ensemble YAML nécessaire pour notre format :
//   clés: valeurs
//   listes avec tiret
//   dictionnaires indentés
//   commentaires #

function parseYaml(yaml: string): Record<string, unknown> {
  const lines = yaml.split('\n')
  const root: Record<string, unknown> = {}
  const stack: { indent: number; obj: Record<string, unknown> }[] = [
    { indent: -1, obj: root },
  ]

  for (const raw of lines) {
    const stripped = raw.replace(/\r$/, '')
    // Commentaire ou vide
    if (/^\s*#/.test(stripped) || /^\s*$/.test(stripped)) continue

    const indent = stripped.search(/\S/)
    const content = stripped.slice(indent)

    // Dépiler les niveaux moins profonds
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop()
    }

    const currentObj = stack[stack.length - 1].obj

    // Liste : "- valeur"
    const listMatch = content.match(/^-\s+(.*)/)
    if (listMatch) {
      const value = parseYamlValue(listMatch[1])
      // Si la valeur est un objet, on ajoute à la dernière clé de l'objet courant
      if (typeof value === 'object' && value !== null) {
        // Trouver la clé la plus récente dans l'objet courant qui est une liste
        for (const key of Object.keys(currentObj)) {
          if (Array.isArray(currentObj[key])) {
            ;(currentObj[key] as Record<string, unknown>[]).push(value as Record<string, unknown>)
            break
          }
        }
      } else {
        // Ajouter à la dernière clé de type liste
        const keys = Object.keys(currentObj)
        if (keys.length > 0) {
          const lastKey = keys[keys.length - 1]
          if (Array.isArray(currentObj[lastKey])) {
            ;(currentObj[lastKey] as unknown[]).push(value)
          } else {
            // Créer une nouvelle liste implicite
            currentObj[lastKey] = [value]
          }
        }
      }
      continue
    }

    // Objet imbriqué : "key:" (sans valeur)
    const objMatch = content.match(/^(\w[\w-]*):\s*$/)
    if (objMatch) {
      const key = objMatch[1]
      const newObj: Record<string, unknown> = {}
      currentObj[key] = newObj
      stack.push({ indent, obj: newObj })
      continue
    }

    // Paire clé-valeur : "key: value"
    const kvMatch = content.match(/^(\w[\w-]*):\s+(.*)$/)
    if (kvMatch) {
      const [, key, rawValue] = kvMatch
      const value = parseYamlValue(rawValue)

      // Si on commence une liste (la valeur est un scalaire et la ligne suivante
      // avec même indentation commence par -), on crée un tableau
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        currentObj[key] = value
      } else {
        currentObj[key] = value
      }

      // Si la valeur est un objet, on empile
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        stack.push({ indent, obj: value as Record<string, unknown> })
      }
      continue
    }
  }

  return root
}

function parseYamlValue(raw: string): unknown {
  const v = raw.trim()
  if (v === 'true') return true
  if (v === 'false') return false
  if (/^\d+$/.test(v)) return parseInt(v, 10)
  if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1)
  if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1)
  return v
}

// ── Construction de l'objet PermissionConfig ─────────────

function buildPermissionConfig(parsed: Record<string, unknown>): PermissionConfig | null {
  try {
    const version = parsed.version as number ?? 1

    const defaultsRaw = parsed.defaults as Record<string, unknown> | undefined
    let defaults: PermissionDefaults | undefined
    if (defaultsRaw) {
      const confinedRaw = defaultsRaw.confined as Record<string, unknown> | undefined
      if (confinedRaw) {
        defaults = {
          confined: {
            allowedCommands: (confinedRaw.allowed_commands as string[]) ?? [],
            forbiddenCommands: (confinedRaw.forbidden_commands as string[]) ?? [],
            forbiddenPaths: (confinedRaw.forbidden_paths as string[]) ?? [],
          },
        }
      }
    }

    const agentsRaw = parsed.agents as unknown[]
    const agents: AgentPermission[] = (agentsRaw ?? []).map((a) => {
      const entry = a as Record<string, unknown>
      return {
        id: entry.id as string,
        level: (entry.level as PermissionLevel) ?? 'confined',
        allowedCommands: entry.allowed_commands as string[] | undefined,
        forbiddenCommands: entry.forbidden_commands as string[] | undefined,
        allowedPaths: entry.allowed_paths as string[] | undefined,
        forbiddenPaths: entry.forbidden_paths as string[] | undefined,
        workspace: entry.workspace as string | undefined,
      }
    })

    return { version, defaults, agents }
  } catch {
    return null
  }
}

// ── API publique ─────────────────────────────────────────

/**
 * Charge (ou recharge) le fichier permissions.yaml en mémoire.
 * Retourne true si le fichier a été chargé avec succès.
 */
export function loadPermissions(): boolean {
  if (!existsSync(PERMISSIONS_FILE)) {
    permissionsCache = null
    return false
  }

  try {
    const raw = readFileSync(PERMISSIONS_FILE, 'utf-8')
    const parsed = parseYaml(raw)
    const config = buildPermissionConfig(parsed)
    if (!config) {
      console.error(`[FeuRouge] Erreur: permissions.yaml mal formaté`)
      return false
    }
    permissionsCache = config
    return true
  } catch (err) {
    console.error(`[FeuRouge] Erreur chargement permissions.yaml: ${(err as Error).message}`)
    return false
  }
}

/**
 * Crée le fichier permissions.yaml par défaut s'il n'existe pas.
 * Inclut les agents du programme (alice, orchestrateur, etc.) + wildcard (*).
 */
export function createDefaultPermissionsFile(): void {
  if (existsSync(PERMISSIONS_FILE)) return

  if (!existsSync(PERMISSIONS_DIR)) {
    mkdirSync(PERMISSIONS_DIR, { recursive: true })
  }

  const defaults = `# data/permissions/permissions.yaml
# Fichier maître des permissions — généré automatiquement.
# Éditable via !permissions edit <agent-id> <field> <value> ou directement.
#
# Niveaux :
#   admin       — Accès complet (programme + workspaces)
#   restricted  — Accès à workspaces/ racine seulement
#   confined    — Accès à un seul projet dans workspaces/
#   readonly    — Lecture seule

version: 1

# Défauts pour les agents de niveau "confined"
defaults:
  confined:
    allowed_commands:
      - "cat"
      - "ls"
      - "dir"
      - "findstr"
      - "node"
      - "npm"
      - "npx"
      - "mkdir"
      - "echo"
      - "type"
      - "copy"
      - "move"
      - "writefile"
    forbidden_commands:
      - "rm -rf"
      - "del /s"
      - "rmdir /s"
      - "format"
    forbidden_paths:
      - ".agents/"
      - "data/"
      - "src/"
      - "providers.json"
      - "package.json"
      - "tsconfig.json"

# Permissions par agent
agents:
  - id: alice
    level: admin
    allowed_commands:
      - "*"

  - id: orchestrateur
    level: admin
    allowed_commands:
      - "node dist/telecom/service/intercom-manager.js *"
      - "cat"
      - "ls"
      - "dir"
      - "findstr"
      - "echo"
      - "type"
    allowed_paths:
      - "data/protocols/"
      - "telecom/"
      - "workspaces/"

  - id: agent-superviseur
    level: readonly
    allowed_commands:
      - "cat"
      - "ls"
      - "dir"
      - "findstr"
      - "echo"

  - id: agent-reviewer
    level: admin
    allowed_paths:
      - "."

  - id: DAEMON-superviseur-01
    level: admin
    allowed_paths:
      - "."

  - id: DAEMON-feurouge-01
    level: admin
    allowed_paths:
      - "data/permissions/"
      - "telecom/"

  - id: agent-telecom
    level: admin
    allowed_commands:
      - "node dist/telecom/service/intercom-manager.js *"
      - "node dist/spawn-agent.js *"
      - "cat"
      - "ls"
      - "dir"
      - "findstr"
      - "echo"
      - "type"

  # Wildcard : tous les autres agents (créés par l'utilisateur)
  - id: "*"
    level: confined
`

  writeFileSync(PERMISSIONS_FILE, defaults, 'utf-8')
}

/**
 * Enregistre un agent dans la table runtime (PID → workspace).
 */
export function registerAgent(
  agentId: string,
  pid: number,
  level: PermissionLevel,
  workspace?: string,
): void {
  registrations.set(pid, { agentId, pid, level, workspace })
}

/**
 * Désenregistre un agent à la fin de son processus.
 */
export function unregisterAgent(pid: number): void {
  registrations.delete(pid)
}

/**
 * Résout le chemin absolu d'une cible de commande.
 * Extrait le premier chemin ressemblant à un fichier/dossier de la commande.
 */
function extractTargetPath(command: string, cwd: string): string | null {
  // Patterns de chemins dans la commande : cd, cat, node, npm run --prefix, etc.
  const pathPatterns = [
    // cd workspace/mon-projet
    /cd\s+(\S+)/,
    // cat/npm/node/... suivi d'un chemin
    /(?:cat|type|ls|dir|findstr)\s+(\S+)/,
    // node dist/spawn-agent.js -> chemin vers dist
    /node\s+(\S+)/,
    // --prefix ou --cwd
    /--(?:prefix|cwd)\s+(\S+)/,
    // Écriture dans un fichier
    /[>]>?\s+(\S+)/,
    // -o ou --out suivi d'un chemin
    /(?:-o|--out|--output)\s+(\S+)/,
  ]

  for (const pattern of pathPatterns) {
    const match = command.match(pattern)
    if (match) {
      const rawPath = match[1]
      // Ignorer les options, flags, protocoles
      if (rawPath.startsWith('-') || rawPath.startsWith('http') || rawPath.startsWith('--')) continue
      if (!rawPath.includes('/') && !rawPath.includes('\\') && !rawPath.includes('..')) continue
      try {
        const resolved = resolve(cwd, rawPath)
        return normalize(resolved)
      } catch {
        continue
      }
    }
  }

  return null
}

/**
 * Vérifie si une commande est autorisée pour un agent donné.
 * Appelée par le daemon ou directement par le guardian.
 */
export function checkCommand(
  agentId: string,
  command: string,
  cwd: string,
): { allowed: boolean; reason?: string } {
  const config = permissionsCache
  if (!config) {
    return { allowed: true, reason: 'Permissions non chargées — autorisé par défaut' }
  }

  // 1. Trouver la permission pour cet agent (ou wildcard *)
  const agentPerm =
    config.agents.find((a) => a.id === agentId) ??
    config.agents.find((a) => a.id === '*')

  if (!agentPerm) {
    return { allowed: true, reason: 'Aucune règle trouvée — autorisé par défaut' }
  }

  const level = agentPerm.level

  // 2. Niveau admin → tout autorisé (sauf si forbidden explicite)
  if (level === 'admin') {
    if (agentPerm.forbiddenCommands?.some((f) => command.includes(f))) {
      return {
        allowed: false,
        reason: `Commande bloquée : "${command}" est dans forbidden_commands de ${agentId}`,
      }
    }
    return { allowed: true }
  }

  // 3. Niveau readonly → tout bloqué sauf les commandes en readonly
  if (level === 'readonly') {
    const readOnlyCommands = agentPerm.allowedCommands ?? ['cat', 'ls', 'dir', 'findstr', 'echo', 'type']
    const cmdName = command.split(/\s+/)[0]
    if (!readOnlyCommands.includes(cmdName) && !readOnlyCommands.includes('*')) {
      return {
        allowed: false,
        reason: `Agent ${agentId} (readonly) : seules les commandes de lecture sont autorisées. "${cmdName}" n'est pas dans la liste autorisée.`,
      }
    }
  }

  // 4. Récupérer allowed/forbidden lists (spécifiques ou défauts)
  const defaults = config.defaults?.confined
  const allowedCommands = agentPerm.allowedCommands ?? defaults?.allowedCommands ?? []
  const forbiddenCommands = agentPerm.forbiddenCommands ?? defaults?.forbiddenCommands ?? []
  const allowedPaths = agentPerm.allowedPaths
  const forbiddenPaths = agentPerm.forbiddenPaths ?? defaults?.forbiddenPaths ?? []

  // 5. Vérifier les commandes interdites
  const cmdLower = command.toLowerCase()
  for (const fCmd of forbiddenCommands) {
    if (fCmd.endsWith('*')) {
      const prefix = fCmd.slice(0, -1).toLowerCase()
      if (cmdLower.startsWith(prefix)) {
        return {
          allowed: false,
          reason: `Commande "${command}" interdite par la règle "${fCmd}" pour l'agent ${agentId}`,
        }
      }
    } else if (cmdLower.includes(fCmd.toLowerCase())) {
      return {
        allowed: false,
        reason: `Commande "${command}" contient le pattern interdit "${fCmd}" pour l'agent ${agentId}`,
      }
    }
  }

  // 6. Vérifier les chemins interdits
  const targetPath = extractTargetPath(command, cwd)
  if (targetPath) {
    const normalizedTarget = normalize(targetPath).toLowerCase()
    for (const fPath of forbiddenPaths) {
      if (fPath === '*') {
        return {
          allowed: false,
          reason: `Chemin "${targetPath}" interdit par la règle "${fPath}" pour l'agent ${agentId}`,
        }
      }
      const resolvedForbidden = resolve(cwd, fPath).toLowerCase()
      if (normalizedTarget.startsWith(resolvedForbidden)) {
        return {
          allowed: false,
          reason: `Chemin "${targetPath}" interdit (règle: "${fPath}"). Agent ${agentId} confiné à son workspace.`,
        }
      }
    }
  }

  // 7. Vérifier les chemins autorisés
  if (allowedPaths && allowedPaths.length > 0 && !allowedPaths.includes('.')) {
    if (targetPath) {
      const normalizedTarget = normalize(targetPath).toLowerCase()
      const isAllowed = allowedPaths.some((aPath) => {
        if (aPath === '*') return true
        const resolved = resolve(cwd, aPath).toLowerCase()
        return normalizedTarget.startsWith(resolved)
      })
      if (!isAllowed) {
        return {
          allowed: false,
          reason: `Chemin "${targetPath}" pas dans les chemins autorisés pour ${agentId}. Zones autorisées : ${allowedPaths.join(', ')}`,
        }
      }
    }
  }

  // 8. Vérifier les commandes autorisées
  if (allowedCommands.length > 0 && !allowedCommands.includes('*')) {
    const cmdName = command.split(/\s+/)[0]
    const isAllowed = allowedCommands.some((aCmd) => {
      if (aCmd.endsWith('*')) {
        return cmdName.startsWith(aCmd.slice(0, -1))
      }
      return cmdName === aCmd || command.startsWith(aCmd)
    })
    if (!isAllowed) {
      return {
        allowed: false,
        reason: `Commande "${cmdName}" non autorisée pour ${agentId}. Commandes autorisées : ${allowedCommands.join(', ')}`,
      }
    }
  }

  return { allowed: true }
}

/**
 * Retourne les permissions pour un agent donné.
 */
export function getAgentPermission(agentId: string): AgentPermission | null {
  const config = permissionsCache
  if (!config) return null
  return config.agents.find((a) => a.id === agentId) ?? config.agents.find((a) => a.id === '*') ?? null
}

/**
 * Édite une permission dans le fichier YAML et recharge.
 * Retourne true si succès.
 */
export function editPermission(
  agentId: string,
  field: string,
  value: unknown,
): boolean {
  if (!existsSync(PERMISSIONS_FILE)) return false

  try {
    const raw = readFileSync(PERMISSIONS_FILE, 'utf-8')
    const lines = raw.split('\n')
    const result: string[] = []
    let inTargetAgent = false
    let edited = false
    let agentFound = false
    let bracketDepth = 0

    for (const line of lines) {
      const stripped = line.replace(/\r$/, '')

      // Détecter le début d'un bloc agent
      const agentMatch = stripped.match(/^\s*-\s+id:\s*['"]?([^'"]+)['"]?\s*$/)
      if (agentMatch) {
        if (inTargetAgent && !edited) {
          // L'agent cible n'avait pas ce champ, on l'ajoute
          result.push(formatYamlField(field, value, 4))
          edited = true
        }
        inTargetAgent = agentMatch[1] === agentId
        agentFound = agentFound || inTargetAgent
        result.push(line)
        continue
      }

      if (inTargetAgent) {
        // Détecter le prochain agent (fin de l'agent courant)
        if (/^\s*-\s+id:/.test(stripped)) {
          if (!edited) {
            result.push(formatYamlField(field, value, 4))
            edited = true
          }
          inTargetAgent = false
          result.push(line)
          continue
        }

        // Détecter: "  field:" (même niveau que id, level, etc.)
        const fieldMatch = stripped.match(/^(\s{4})(\w[\w-]*):/)
        if (fieldMatch && fieldMatch[2] === field) {
          // Remplacer la valeur
          result.push(formatYamlField(field, value, 4))
          edited = true
          continue
        }

        // Si on tombe sur une ligne avec moins d'indentation que 4, on quitte l'agent
        const indent = stripped.search(/\S/)
        if (indent < 4 && stripped.trim()) {
          if (!edited) {
            result.push(formatYamlField(field, value, 4))
            edited = true
          }
          inTargetAgent = false
          result.push(line)
          continue
        }
      }

      result.push(line)
    }

    // Si l'agent n'a pas été trouvé, ou si on était dedans jusqu'à la fin sans éditer
    if (inTargetAgent && !edited) {
      result.push(formatYamlField(field, value, 4))
      edited = true
    }

    if (!edited) {
      return false
    }

    writeFileSync(PERMISSIONS_FILE, result.join('\n'), 'utf-8')
    // Recharger le cache
    loadPermissions()
    return true
  } catch {
    return false
  }
}

function formatYamlField(field: string, value: unknown, indent: number): string {
  const prefix = ' '.repeat(indent)
  if (Array.isArray(value)) {
    const items = value.map((v) => `${prefix}  - "${v}"`).join('\n')
    return `${prefix}${field}:\n${items}`
  }
  return `${prefix}${field}: "${String(value)}"`
}

/**
 * Retourne la liste des enregistrements actifs.
 */
export function listRegistrations(): AgentRegistration[] {
  return Array.from(registrations.values())
}

/**
 * Retourne le chemin du fichier permissions.yaml.
 */
export function getPermissionsFilePath(): string {
  return PERMISSIONS_FILE
}

/**
 * Retourne les permissions parsées (pour affichage / debug).
 */
export function getPermissionsConfig(): PermissionConfig | null {
  return permissionsCache
}
