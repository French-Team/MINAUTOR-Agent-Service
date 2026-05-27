/**
 * permissions-cli.ts — Interface CLI pour éditer les permissions en runtime.
 *
 * Commandes :
 *   !permissions show [agent-id]       — Afficher les permissions
 *   !permissions edit <id> <field> <v> — Modifier une permission
 *   !permissions reload                — Recharger depuis le YAML
 *   !permissions agents                — Lister les agents enregistrés
 *   !permissions help                  — Aide
 */

import { getFeuRougeClient } from './feurouge-client.js'
import {
  getPermissionsConfig,
  getAgentPermission,
  listRegistrations,
  loadPermissions,
  editPermission as localEditPermission,
  grantTempAccess as localGrantTempAccess,
  listTempGrants,
  revokeTempGrant,
} from './permissions.js'
import { CYAN, GREEN, YELLOW, RED, GRAY, BOLD, RESET } from '../constants.js'

export function handlePermissionsCommand(args: string[]): Promise<boolean> {
  const sub = args[0]?.toLowerCase()

  switch (sub) {
    case 'show':
      return handleShow(args.slice(1))
    case 'edit':
      return handleEdit(args.slice(1))
    case 'reload':
      return handleReload()
    case 'grant':
      return handleGrant(args.slice(1))
    case 'revoke':
      return handleRevoke(args.slice(1))
    case 'grants':
      return handleListGrants(args.slice(1))
    case 'agents':
      return handleAgents()
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      return handleHelp()
    default:
      console.log(`${YELLOW}Commande inconnue: !permissions ${sub}. Tapez !permissions help.${RESET}`)
      return Promise.resolve(true)
  }
}

async function handleShow(args: string[]): Promise<boolean> {
  const config = getPermissionsConfig()
  if (!config) {
    console.log(`${YELLOW}Aucune permission chargée. Utilisez !permissions reload.${RESET}`)
    return true
  }

  const agentId = args[0]

  console.log(`\n${BOLD}${CYAN}┌─ Permissions ─────────────────────────────┐${RESET}`)
  console.log(`${BOLD}${CYAN}│  Fichier: data/permissions/permissions.yaml  │${RESET}`)
  console.log(`${BOLD}${CYAN}└──────────────────────────────────────────────┘${RESET}`)
  console.log(`  Version: ${config.version}`)
  console.log(`  Agents configurés: ${config.agents.length}\n`)

  if (agentId) {
    const perm = getAgentPermission(agentId)
    if (!perm) {
      console.log(`${YELLOW}Aucune permission pour "${agentId}"${RESET}`)
      return true
    }
    printAgentPermission(perm)
  } else {
    for (const perm of config.agents) {
      printAgentPermission(perm)
    }
  }

  console.log()
  return true
}

function printAgentPermission(perm: { id: string; level: string; workspace?: string; allowedCommands?: string[]; forbiddenCommands?: string[]; allowedPaths?: string[]; forbiddenPaths?: string[] }): void {
  const levelColor = perm.level === 'admin' ? `${GREEN}admin${RESET}`
    : perm.level === 'restricted' ? `${CYAN}restricted${RESET}`
    : perm.level === 'confined' ? `${YELLOW}confined${RESET}`
    : `${GRAY}readonly${RESET}`

  const isWildcard = perm.id === '*'
  console.log(`  ${isWildcard ? `${GRAY}*${RESET}  ` : ''}${BOLD}${CYAN}${isWildcard ? '(wildcard)' : perm.id}${RESET}  ${levelColor}${perm.workspace ? `  ${GRAY}→ ${perm.workspace}${RESET}` : ''}`)

  if (perm.allowedCommands && perm.allowedCommands.length > 0) {
    const cmds = perm.allowedCommands.includes('*') ? `${GREEN}* (tout)${RESET}` : perm.allowedCommands.join(', ')
    console.log(`    ${GRAY}Autorisé:${RESET} ${cmds}`)
  }
  if (perm.forbiddenCommands && perm.forbiddenCommands.length > 0) {
    console.log(`    ${GRAY}Interdit:${RESET} ${perm.forbiddenCommands.join(', ')}`)
  }
  if (perm.allowedPaths && perm.allowedPaths.length > 0) {
    console.log(`    ${GRAY}Chemins autorisés:${RESET} ${perm.allowedPaths.join(', ')}`)
  }
  if (perm.forbiddenPaths && perm.forbiddenPaths.length > 0) {
    console.log(`    ${GRAY}Chemins interdits:${RESET} ${perm.forbiddenPaths.join(', ')}`)
  }
  console.log()
}

async function handleEdit(args: string[]): Promise<boolean> {
  const [agentId, field, ...valueParts] = args
  const value = valueParts.join(' ')

  if (!agentId || !field || !value) {
    console.log(`${YELLOW}Usage: !permissions edit <agent-id> <field> <value>${RESET}`)
    console.log(`  ${GRAY}Ex: !permissions edit alice level admin${RESET}`)
    console.log(`  ${GRAY}Ex: !permissions edit mon-agent allowed_commands '["cat","ls","node"]'${RESET}`)
    return true
  }

  // Essayer d'abord via le daemon (si actif)
  const client = getFeuRougeClient()
  let parsedValue: unknown = value

  // Tenter de parser comme JSON (pour les listes)
  try {
    parsedValue = JSON.parse(value)
  } catch {
    // Garder la valeur en string
  }

  if (client.isAlive()) {
    const ok = await client.editPermission(agentId, field, parsedValue)
    if (ok) {
      console.log(`${GREEN}✓ Permission modifiée: ${agentId}.${field} = ${JSON.stringify(parsedValue)}${RESET}`)
    } else {
      console.log(`${RED}✗ Échec de la modification${RESET}`)
    }
    return true
  }

  // Fallback: modification directe
  const ok = localEditPermission(agentId, field, parsedValue)
  if (ok) {
    console.log(`${GREEN}✓ Permission modifiée (local): ${agentId}.${field}${RESET}`)
  } else {
    console.log(`${RED}✗ Échec de la modification${RESET}`)
  }
  return true
}

async function handleReload(): Promise<boolean> {
  const client = getFeuRougeClient()

  if (client.isAlive()) {
    const ok = await client.reloadPermissions()
    if (ok) {
      console.log(`${GREEN}✓ Permissions rechargées${RESET}`)
    } else {
      console.log(`${RED}✗ Échec du rechargement${RESET}`)
    }
    return true
  }

  // Fallback local
  const ok = loadPermissions()
  if (ok) {
    console.log(`${GREEN}✓ Permissions rechargées (local)${RESET}`)
  } else {
    console.log(`${YELLOW}⚠ Aucun fichier permissions.yaml trouvé${RESET}`)
  }
  return true
}

async function handleAgents(): Promise<boolean> {
  const registrations = listRegistrations()

  if (registrations.length === 0) {
    console.log(`${YELLOW}Aucun agent enregistré auprès du FeuRouge.${RESET}`)
    return true
  }

  console.log(`\n${BOLD}Agents enregistrés (${registrations.length}) :${RESET}`)
  for (const reg of registrations) {
    console.log(`  PID ${reg.pid}  ${CYAN}${reg.agentId}${RESET}  ${reg.level}${reg.workspace ? `  ${GRAY}→ ${reg.workspace}${RESET}` : ''}`)
  }
  console.log()
  return true
}

async function handleGrant(args: string[]): Promise<boolean> {
  const [agentId, type, value, minutesStr, ...reasonParts] = args
  const reason = reasonParts.join(' ')

  if (!agentId || !type || !value) {
    console.log(`${YELLOW}Usage: !permissions grant <agent-id> path|command <value> [minutes] [raison]${RESET}`)
    console.log(`  ${GRAY}Ex: !permissions grant mon-agent path workspaces/mon-projet/tmp/ 10 Export temporaire${RESET}`)
    console.log(`  ${GRAY}Ex: !permissions grant mon-agent command node 5 Bug fix${RESET}`)
    return true
  }

  if (type !== 'path' && type !== 'command') {
    console.log(`${YELLOW}Le type doit être "path" ou "command".${RESET}`)
    return true
  }

  const durationMinutes = parseInt(minutesStr, 10)
  const dur = isNaN(durationMinutes) || durationMinutes <= 0 ? 5 : durationMinutes

  // Essayer via le daemon d'abord
  const client = getFeuRougeClient()
  if (client.isAlive()) {
    const result = await client.grantTempAccess(agentId, type, value, 'CLI', dur, reason || undefined)
    if (result.ok) {
      console.log(`${GREEN}✓ ${result.message}${RESET}`)
    } else {
      console.log(`${RED}✗ ${result.message}${RESET}`)
    }
    return true
  }

  // Fallback local
  const result = localGrantTempAccess(agentId, type, value, 'CLI', dur, reason || undefined)
  if (result.ok) {
    console.log(`${GREEN}✓ ${result.message}${RESET}`)
  } else {
    console.log(`${RED}✗ ${result.message}${RESET}`)
  }
  return true
}

async function handleRevoke(args: string[]): Promise<boolean> {
  const [agentId, type, ...valueParts] = args
  const value = valueParts.join(' ')

  if (!agentId) {
    console.log(`${YELLOW}Usage: !permissions revoke <agent-id> [path|command] [value]${RESET}`)
    return true
  }

  const ok = revokeTempGrant(
    agentId,
    (type === 'path' || type === 'command') ? type : undefined,
    (type === 'path' || type === 'command') ? value : undefined,
  )

  if (ok) {
    const detail = type && value ? ` (${type}: "${value}")` : ''
    console.log(`${GREEN}✓ Accès temporaire révoqué pour "${agentId}"${detail}${RESET}`)
  } else {
    console.log(`${YELLOW}Aucun grant trouvé pour "${agentId}"${type && value ? ` (${type}: "${value}")` : ''}${RESET}`)
  }
  return true
}

async function handleListGrants(args: string[]): Promise<boolean> {
  const [agentId] = args
  const grants = listTempGrants(agentId || undefined)

  if (grants.length === 0) {
    console.log(`${YELLOW}Aucun accès temporaire actif.${RESET}`)
    return true
  }

  console.log(`\n${BOLD}${CYAN}┌─ Accès temporaires actifs (${grants.length}) ─────────────┐${RESET}`)
  for (const g of grants) {
    const remaining = Math.max(0, Math.round((g.expiresAt - Date.now()) / 1000 / 60))
    const typeLabel = g.type === 'path' ? '📁 chemin' : '⚡ commande'
    const timeStr = remaining >= 60
      ? `${(remaining / 60).toFixed(1)}h`
      : `${remaining}min`
    console.log(`  ${CYAN}${g.agentId}${RESET}`)
    console.log(`    ${typeLabel}: "${g.value}"  ${GRAY}${timeStr} restant${RESET}`)
    console.log(`    Accordé par: ${g.grantedBy}${g.reason ? ` (${g.reason})` : ''}`)
  }
  console.log(`${BOLD}${CYAN}└──────────────────────────────────────────────────┘${RESET}\n`)
  return true
}

async function handleHelp(): Promise<boolean> {
  console.log(`\n${BOLD}${CYAN}┌─ Permissions — Commandes ──────────────────┐${RESET}`)
  console.log(`${BOLD}${CYAN}│  Gérer les permissions des agents          │${RESET}`)
  console.log(`${BOLD}${CYAN}└─────────────────────────────────────────────┘${RESET}\n`)
  console.log(`  ${BOLD}${CYAN}!permissions show${RESET}       Afficher toutes les permissions`)
  console.log(`  ${BOLD}${CYAN}!permissions show <id>${RESET}  Afficher les permissions d'un agent`)
  console.log(`  ${BOLD}${CYAN}!permissions edit <id> <field> <value>`)
  console.log(`                        Modifier une permission`)
  console.log(`  ${BOLD}${CYAN}!permissions reload${RESET}    Recharger depuis le YAML`)
  console.log(`  ${BOLD}${CYAN}!permissions agents${RESET}    Lister les agents enregistrés`)
  console.log(`  ${BOLD}${CYAN}!permissions grant <id> path|command <value> [minutes] [reason]`)
  console.log(`                        Accorder un accès temporaire`)
  console.log(`  ${BOLD}${CYAN}!permissions revoke <id> [path|command] [value]`)
  console.log(`                        Révoquer un accès temporaire`)
  console.log(`  ${BOLD}${CYAN}!permissions grants [agent-id]${RESET}`)
  console.log(`                        Lister les accès temporaires`)
  console.log(`  ${BOLD}${CYAN}!permissions help${RESET}      Cette aide\n`)
  console.log(`  ${GRAY}Exemples :${RESET}`)
  console.log(`    ${GRAY}!permissions grant mon-agent path workspaces/mon-projet/tmp/ 10 Export temporaire${RESET}`)
  console.log(`    ${GRAY}!permissions grant mon-agent command node 5 Bug fix${RESET}`)
  console.log(`    ${GRAY}!permissions revoke mon-agent command node${RESET}`)
  console.log(`    ${GRAY}!permissions edit alice level admin${RESET}`)
  console.log(`    ${GRAY}!permissions edit mon-agent allowed_commands '["cat","ls"]'${RESET}`)
  console.log(`    ${GRAY}!permissions edit mon-agent forbidden_paths '["src/","data/"]'${RESET}\n`)
  return true
}
