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

import { readFileSync, existsSync, writeFileSync, mkdirSync, realpathSync } from 'fs'
import { join, resolve, normalize } from 'path'
import type {
  PermissionConfig,
  PermissionDefaults,
  AgentPermission,
  AgentRegistration,
  PermissionLevel,
  TempGrant,
} from './types.js'

// ── Chemins ──────────────────────────────────────────────

const PERMISSIONS_DIR = join(process.cwd(), 'data', 'permissions')
const PERMISSIONS_FILE = join(PERMISSIONS_DIR, 'permissions.yaml')

// ── État runtime (en mémoire seulement) ──────────────────

/** Les agents actuellement enregistrés, indexés par PID */
const registrations = new Map<number, AgentRegistration>()

/** Les permissions parsées (rechargées via reload()) */
let permissionsCache: PermissionConfig | null = null

/** Autorisations temporaires accordées par des admins (mémoire, non persisté) */
const tempGrants = new Map<string, TempGrant[]>()

// ── Intervalle de nettoyage des grants expirées ──────────

// Vérifie et nettoie les grants expirées toutes les 30 secondes
setInterval(() => {
  const now = Date.now()
  for (const [agentId, grants] of tempGrants.entries()) {
    const active = grants.filter((g) => g.expiresAt > now)
    if (active.length === 0) {
      tempGrants.delete(agentId)
    } else if (active.length < grants.length) {
      tempGrants.set(agentId, active)
    }
  }
}, 30000).unref()

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
 * Accorde une autorisation temporaire à un agent confiné.
 * La permission expire après durationMinutes (défaut: 5).
 * Retourne un message décrivant le grant accordé.
 */
export function grantTempAccess(
  agentId: string,
  type: 'path' | 'command',
  value: string,
  grantedBy: string,
  durationMinutes: number = 5,
  reason?: string,
): { ok: boolean; message: string } {
  const expiresAt = Date.now() + durationMinutes * 60 * 1000
  const grant: TempGrant = { agentId, type, value, expiresAt, grantedBy, reason }

  const existing = tempGrants.get(agentId) ?? []
  existing.push(grant)
  tempGrants.set(agentId, existing)

  const typeLabel = type === 'path' ? 'chemin' : 'commande'
  const durStr = durationMinutes >= 60
    ? `${(durationMinutes / 60).toFixed(1)}h`
    : `${durationMinutes}min`
  const reasonStr = reason ? ` (${reason})` : ''

  return {
    ok: true,
    message: `Accès temporaire accordé à "${agentId}" : ${typeLabel} "${value}" pour ${durStr}${reasonStr}`,
  }
}

/**
 * Liste les grants actifs pour un agent (ou tous si non spécifié).
 */
export function listTempGrants(agentId?: string): TempGrant[] {
  const now = Date.now()
  if (agentId) {
    return (tempGrants.get(agentId) ?? []).filter((g) => g.expiresAt > now)
  }
  const all: TempGrant[] = []
  for (const grants of tempGrants.values()) {
    all.push(...grants.filter((g) => g.expiresAt > now))
  }
  return all
}

/**
 * Révoque tous les grants pour un agent (ou un grant spécifique par type+valeur).
 */
export function revokeTempGrant(
  agentId: string,
  type?: 'path' | 'command',
  value?: string,
): boolean {
  if (!tempGrants.has(agentId)) return false

  const grants = tempGrants.get(agentId)!
  if (!type && !value) {
    tempGrants.delete(agentId)
    return true
  }

  const remaining = grants.filter(
    (g) => !(g.type === type && g.value === value),
  )
  if (remaining.length === grants.length) return false

  if (remaining.length === 0) {
    tempGrants.delete(agentId)
  } else {
    tempGrants.set(agentId, remaining)
  }
  return true
}


/**
 * Enregistre un agent dans la table runtime (PID → workspace).
 */
/**
 * Enregistre un agent dans la table runtime (PID → workspace).
 * Si le niveau est « confined » et qu'aucun workspace explicite n'est fourni,
 * l'agent est automatiquement isolé dans le sandbox (workspaces/.sandbox/).
 */
export function registerAgent(
  agentId: string,
  pid: number,
  level: PermissionLevel,
  workspace?: string,
): void {
  // Les agents confined sans workspace explicite tombent dans le sandbox
  const resolvedWorkspace = workspace ?? (level === 'confined' ? '.sandbox' : undefined)
  registrations.set(pid, { agentId, pid, level, workspace: resolvedWorkspace })
}

/**
 * Désenregistre un agent à la fin de son processus.
 */
export function unregisterAgent(pid: number): void {
  registrations.delete(pid)
}

/**
 * Retourne le workspace d'un agent à partir de son ID.
 * Cherche la registration la plus récente. Utile pour la vérification
 * de confinement sandbox dans checkCommand().
 */
export function getRegistrationWorkspace(agentId: string): string | undefined {
  // Parcourir toutes les registrations et prendre la plus récente pour cet agent
  let latest: AgentRegistration | undefined
  for (const reg of registrations.values()) {
    if (reg.agentId === agentId) {
      if (!latest || reg.pid > latest.pid) {
        latest = reg
      }
    }
  }
  return latest?.workspace
}

/**
 * Résout un chemin en suivant les symlinks.
 * Si le chemin n'existe pas (realpathSync échoue), retombe sur normalize().
 */
function resolveRealPath(filePath: string): string {
  try {
    return realpathSync(filePath)
  } catch {
    // Le chemin peut ne pas exister (fichier à créer, etc.)
    return normalize(filePath)
  }
}

/**
 * Détermine le répertoire de travail effectif d'une commande,
 * en tenant compte des flags qui déplacent le contexte (git -C, npm --prefix, etc.).
 * Retourne le CWD résolu ou le CWD original si aucun flag de déplacement.
 */
function getDisplacedCwd(command: string, cwd: string): string {
  // git -C <path> — déplace le répertoire de travail de git
  const gitCMatch = command.match(/git\s+-C\s+(\S+)/)
  if (gitCMatch) {
    const dir = gitCMatch[1]
    if (dir && !dir.startsWith('-') && !dir.startsWith('http') && !dir.startsWith('--')) {
      return resolve(cwd, dir)
    }
  }

  // npm --prefix <path> — npm opère sur le répertoire prefix
  const npmPrefixMatch = command.match(/--prefix\s+(\S+)/)
  if (npmPrefixMatch) {
    const dir = npmPrefixMatch[1]
    if (dir && !dir.startsWith('-') && !dir.startsWith('http') && !dir.startsWith('--')) {
      return resolve(cwd, dir)
    }
  }

  return cwd
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
    // git flags qui déplacent le contexte : --git-dir, --work-tree
    /git\s+--git-dir[=\s]+(\S+)/,
    /git\s+--work-tree[=\s]+(\S+)/,
    // git clone <url> <target-dir>
    /git\s+clone\s+\S+\s+(\S+)/,
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
        return resolveRealPath(resolved)
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

  // 5. Extraire le chemin cible pour les vérifications suivantes
  const targetPath = extractTargetPath(command, cwd)

  // 5b. Vérifier le CWD effectif : les flags comme git -C, npm --prefix déplacent
  //     le répertoire de travail effectif de la commande. Un agent confiné ne doit
  //     pas pouvoir utiliser ces flags pour opérer hors de son workspace.
  const effectiveCwd = getDisplacedCwd(command, cwd)
  const agentWorkspace = getRegistrationWorkspace(agentId)
  if (agentWorkspace && effectiveCwd !== cwd) {
    // La commande utilise un flag qui déplace le contexte (git -C, --prefix, etc.)
    // Vérifier que le CWD effectif est bien dans le workspace
    const resolvedEffective = resolveRealPath(effectiveCwd).toLowerCase()
    const workspacePath = resolveRealPath(resolve(cwd, 'workspaces', agentWorkspace)).toLowerCase()
    if (!resolvedEffective.startsWith(workspacePath)) {
      return {
        allowed: false,
        reason: `CWD effectif "${effectiveCwd}" hors du workspace "${agentWorkspace}". L'agent ${agentId} utilise un flag de déplacement de contexte (git -C, --prefix) pour contourner son isolement.`,
      }
    }
  }

  // 5c. Vérification du CWD lui-même pour les agents confinés :
  //     le CWD passé doit être dans le workspace. Empêche les escapes où le
  //     caller aurait positionné un CWD hors du workspace avant l'appel.
  //     Pas de condition de garde — le check est inoffensif pour les CWD valides
  //     et bloque uniquement les CWD réellement hors limites.
  if (agentWorkspace) {
    const resolvedCwd = resolveRealPath(effectiveCwd).toLowerCase()
    const workspacePath = resolveRealPath(resolve(cwd, 'workspaces', agentWorkspace)).toLowerCase()
    // Le CWD doit être soit dans le workspace, soit dans telecom/ (logs autorisés)
    if (!resolvedCwd.startsWith(workspacePath) &&
        !resolvedCwd.startsWith(resolve(cwd, 'telecom').toLowerCase())) {
      return {
        allowed: false,
        reason: `CWD "${effectiveCwd}" hors du workspace "${agentWorkspace}" pour l'agent ${agentId}. Agent confiné dans son espace de travail.`,
      }
    }
  }

  // 6. Vérifier les grants temporaires AVANT les vérifications de blocage.
  //    Un admin qui accorde un accès temporaire doit pouvoir override les règles
  //    de forbidden paths, allowed paths, workspace confinement, etc.
  const activeGrants = (tempGrants.get(agentId) ?? []).filter((g) => g.expiresAt > Date.now())

  // 6a. Path grant : override forbidden paths, allowed paths, workspace confinement
  if (targetPath) {
    const pathGrant = activeGrants.find(
      (g) => g.type === 'path' && targetPath.toLowerCase().includes(g.value.toLowerCase()),
    )
    if (pathGrant) {
      return { allowed: true, reason: `Accès temporaire accordé par ${pathGrant.grantedBy} (chemin: "${pathGrant.value}")${pathGrant.reason ? ` — ${pathGrant.reason}` : ''}` }
    }
  }

  // 6b. Command grant : override forbidden commands, allowed commands
  const cmdGrant = activeGrants.find(
    (g) => g.type === 'command' && command.toLowerCase().startsWith(g.value.toLowerCase()),
  )
  if (cmdGrant) {
    return { allowed: true, reason: `Commande temporairement autorisée par ${cmdGrant.grantedBy} ("${cmdGrant.value}")${cmdGrant.reason ? ` — ${cmdGrant.reason}` : ''}` }
  }

  // 7. Vérifier les commandes interdites
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

  // 8. Vérifier les chemins interdits
  if (targetPath) {
    const normalizedTarget = resolveRealPath(targetPath).toLowerCase()
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

  // 9. Vérifier les chemins autorisés
  if (allowedPaths && allowedPaths.length > 0 && !allowedPaths.includes('.')) {
    if (targetPath) {
      const normalizedTarget = resolveRealPath(targetPath).toLowerCase()
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

  // 10. Vérifier le confinement sandbox : si l'agent a un workspace enregistré
  //     et que la commande cible un chemin hors de ce workspace, on bloque.
  //     (les agents 'admin' sont déjà exclus plus haut — ils retournent avant)
  //     Note: agentWorkspace est déjà déclaré dans la section 5b.
  if (targetPath && agentWorkspace) {
    const workspacePath = resolveRealPath(resolve(cwd, 'workspaces', agentWorkspace)).toLowerCase()
    const normalizedTarget = resolveRealPath(targetPath).toLowerCase()
    // Permettre les chemins dans le workspace, telecom/ (logs), et le CWD racine
    if (!normalizedTarget.startsWith(workspacePath) &&
        !normalizedTarget.includes(join('telecom', 'agents', agentId).toLowerCase().replace(/\\/g, '/')) &&
        !normalizedTarget.startsWith(resolve(cwd, 'telecom').toLowerCase())) {
      return {
        allowed: false,
        reason: `Chemin "${targetPath}" hors du workspace confiné "${agentWorkspace}" pour l'agent ${agentId}. Agent isolé dans le sandbox.`,
      }
    }
  }

  // 11. Vérifier les commandes autorisées
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
