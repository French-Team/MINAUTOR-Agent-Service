import { createInterface } from 'readline/promises'
import { stdin, stdout, exit } from 'process'
import { readFileSync, existsSync, appendFileSync, unlinkSync, openSync, mkdirSync } from 'fs'
import { join } from 'path'
import { fork, ChildProcess } from 'child_process'

const backgroundAgents = new Map<string, ChildProcess>()
import { listSkills, loadSkill } from './skills.js'
import { testConnection } from './providers.js'
import { generateSkill, validateSkill, validateAgent as validateAgentIntegration, validateIntegration } from './generate-skill.js'
import { popAllNotifications } from './notify.js'
import { emitKeypressEvents } from 'readline'
import { createEngine, type Engine } from './engine.js'
import type { AgentDefinition } from './types/agent-definition.js'
import { listLocalAgents, readLocalAgent, scaffoldAgent, updateAgentFile, listProfiles, loadProfile, type AgentProfile } from './agents.js'
import {
  listProviders,
  getProvider,
  getProvidersByType,
  addProvider,
  removeProvider,
  setProviderEnabled,
  setProviderApiKey,
  setProviderDefaultModel,
  getProviderConfigPath,
  getProviderKeys,
  addProviderKey,
  removeProviderKey,
  getNextApiKey,
  markRateLimited,
  fetchModels,
  getModelFetchGuidance,
  getKnownProviders,
  isLocalProvider,
  checkLocalProvider,
  resolveProviderForModel,
  isApiKeyUsed,
} from './providers.js'

let cancelled = false

// ESC key → cancel current operation
if (stdin.isTTY) {
  emitKeypressEvents(stdin)
  stdin.setRawMode(true)
  stdin.on('keypress', (_str: string, key: { name: string }) => {
    if (key && key.name === 'escape') {
      cancelled = true
      stdout.write('\n')
    }
  })
}

const RESET = '\x1b[0m'
const CYAN = '\x1b[36m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const RED = '\x1b[31m'
const GRAY = '\x1b[90m'
const BOLD = '\x1b[1m'

async function wait(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}

async function pause(label = 'Suite'): Promise<void> {
  console.log(`\n${GRAY}⟳ ${label}...${RESET}`)
  await wait(500)
}

const DEFAULT_AGENT: AgentDefinition = {
  id: 'alice',
  displayName: 'Alice',
  model: 'kilo-auto/free',
  instructionsPrompt: `Tu es Alice, l'assistante personnelle de l'utilisateur.
Accueille-le chaleureusement et propose-lui de l'aider.
Tu peux exécuter des commandes shell avec !cmd, gérer des sessions, des agents et des providers.
Guide-le vers le menu principal ou réponds à ses questions simplement.`,
  toolNames: ['run_terminal_command', 'add_message', 'set_output', 'skill'],
}

const TOP_MODELS = [
  'gpt-5', 'gpt-5.5', 'gpt-5.5-pro', 'gpt-5.2', 'gpt-5-codex', 'gpt-5.1-codex',
  'claude-opus-4.7', 'claude-sonnet-4.6', 'claude-haiku-4.5',
  'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-3-flash-preview', 'gemini-3.1-pro-preview',
  'grok-4', 'grok-4-fast', 'grok-4.1-fast', 'grok-code-fast-1',
  'deepseek/deepseek-v4-pro', 'deepseek/deepseek-v4-flash',
  'qwen/qwen3-max', 'qwen/qwen3-coder-plus', 'qwen/qwen3.6-plus',
  'kilo-auto/free', 'kilo-auto/balanced', 'kilo-auto/frontier',
]

function top15(m: string[]): string[] {
  const free = m.filter(x => x.includes(':free'))
  const best = m.filter(x =>
    !x.includes(':free') &&
    TOP_MODELS.some(t => x.toLowerCase().includes(t.toLowerCase()))
  )
  const rest = m.filter(x => !free.includes(x) && !best.includes(x))
  const combined = [...free, ...best, ...rest]
  return combined.slice(0, 15)
}

function loadAgentFromFile(filePath: string): AgentDefinition {
  const resolved = join(process.cwd(), filePath)
  if (!existsSync(resolved)) {
    console.error(`${RED}File not found: ${resolved}${RESET}`)
    exit(1)
  }
  const content = readFileSync(resolved, 'utf-8')
  try {
    return JSON.parse(content) as AgentDefinition
  } catch {
    console.error(`${RED}Invalid agent file — expected JSON${RESET}`)
    exit(1)
  }
}

function getAgent(args: string[]): AgentDefinition {
  const loadIndex = args.indexOf('--agent')
  if (loadIndex !== -1 && args[loadIndex + 1]) {
    return loadAgentFromFile(args[loadIndex + 1])
  }
  const loadShortIndex = args.indexOf('-a')
  if (loadShortIndex !== -1 && args[loadShortIndex + 1]) {
    return loadAgentFromFile(args[loadShortIndex + 1])
  }
  return DEFAULT_AGENT
}

function showMenu(): void {
  const engine = currentEngine!
  const agent = engine.agent
  console.log(`\n${BOLD}${CYAN}╔══════════════════════════════════════╗${RESET}`)
  console.log(`${BOLD}${CYAN}║     MINAUTOR Agent Service — CLI     ║${RESET}`)
  console.log(`${BOLD}${CYAN}╚══════════════════════════════════════╝${RESET}`)
  console.log(`${GRAY}Agent: ${agent.displayName}  |  Session: ${engine.getCurrentSession()?.id.slice(0, 8) || '—'}${RESET}\n`)
  console.log(`${BOLD}Menu principal :${RESET}`)
  console.log(`  ${CYAN}1${RESET}.  Créer un agent`)
  console.log(`  ${CYAN}2${RESET}.  Démarrer une session`)
  console.log(`  ${CYAN}3${RESET}.  Voir les agents`)
  console.log(`  ${CYAN}4${RESET}.  Éditer un agent`)
  console.log(`  ${CYAN}5${RESET}.  Gérer les providers`)
  console.log(`  ${CYAN}6${RESET}.  Voir les sessions`)
  console.log(`  ${CYAN}7${RESET}.  Info session active`)
  console.log(`  ${CYAN}8${RESET}.  Commandes avancées`)
  console.log(`  ${CYAN}9${RESET}.  Quitter\n`)
  console.log(`${GRAY}Ou tapez /help, /create, /start, /providers, un prompt, !cmd, @message...${RESET}`)
}

function showHelp(): void {
  const engine = currentEngine!
  const agent = engine.agent
  console.log(`\n${BOLD}${CYAN}┌─────────────────────────────────────────────┐${RESET}`)
  console.log(`${BOLD}${CYAN}│  Hermes Agent Engine — Commandes              │${RESET}`)
  console.log(`${BOLD}${CYAN}└─────────────────────────────────────────────┘${RESET}`)
  console.log(`${GRAY}Agent: ${agent.displayName} (${agent.id})${RESET}`)
  console.log(`${GRAY}Model: ${agent.model}${RESET}`)
  console.log(`${GRAY}Tools: ${agent.toolNames.join(', ')}${RESET}\n`)
  console.log(`${BOLD}Menu :${RESET}`)
  console.log(`  ${GREEN}/menu${RESET}       Afficher le menu principal`)
  console.log(`  ${GREEN}1-9${RESET}         Raccourcis du menu\n`)
  console.log(`${BOLD}Agents :${RESET}`)
  console.log(`  ${GREEN}/start${RESET}      Démarrer une session avec un agent`)
  console.log(`  ${GREEN}/create${RESET}     Créer un agent`)
  console.log(`  ${GREEN}/edit${RESET}       Éditer un agent (nom, instructions)`)
  console.log(`  ${GREEN}/agents${RESET}     Lister tous les agents`)
  console.log(`  ${GREEN}/use <id>${RESET}   Charger un agent`)
  console.log(`  ${GREEN}/load <path>${RESET} Charger un agent depuis un fichier\n`)
  console.log(`${BOLD}Providers :${RESET}`)
  console.log(`  ${GREEN}/providers${RESET}  Voir la liste`)
  console.log(`  ${GREEN}/providers add${RESET}  Ajouter un fournisseur`)
  console.log(`  ${GREEN}/providers remove${RESET} <nom>  Supprimer`)
  console.log(`  ${GREEN}/providers key <nom> <clé>${RESET}  Définir clé API`)
  console.log(`  ${GREEN}/providers model <nom> <modèle>${RESET}  Définir modèle\n`)
  console.log(`${BOLD}Sessions :${RESET}`)
  console.log(`  ${GREEN}/sessions${RESET}   Lister les sessions`)
  console.log(`  ${GREEN}/session <id>${RESET} Changer de session`)
  console.log(`  ${GREEN}/new${RESET}       Nouvelle session`)
  console.log(`  ${GREEN}/info${RESET}      Infos session active\n`)
  console.log(`${BOLD}Prompt modes :${RESET}`)
  console.log(`  ${YELLOW}!commande${RESET}   Exécuter une commande shell`)
  console.log(`  ${YELLOW}@message${RESET}    Ajouter un message assistant`)
  console.log(`  ${YELLOW}texte${RESET}       Envoyer un prompt à l'agent`)
  console.log(`  ${YELLOW}/exit${RESET}       Quitter\n`)
}

function showSessions(): void {
  const engine = currentEngine!
  const all = engine.listSessions()
  if (all.length === 0) {
    console.log(`${YELLOW}No sessions${RESET}`)
    return
  }
  const current = engine.getCurrentSession()
  console.log(`\n${BOLD}Sessions (${all.length}):${RESET}`)
  for (const s of all) {
    const marker = s.id === current?.id ? `${GREEN} ◀ active${RESET}` : ''
    const msgCount = s.messages.length
    const shortId = s.id.slice(0, 8)
    console.log(`  ${shortId}  ${s.createdAt.toISOString().slice(0, 19)}  ${msgCount} messages${marker}`)
  }
  console.log()
}

function showInfo(): void {
  const engine = currentEngine!
  const session = engine.getCurrentSession()
  if (!session) {
    console.log(`${YELLOW}No active session. Type /new to create one.${RESET}`)
    return
  }
  console.log(`${BOLD}Session: ${session.id}${RESET}`)
  console.log(`  ${GRAY}Created: ${session.createdAt.toISOString()}${RESET}`)
  console.log(`  ${GRAY}Messages: ${session.messages.length}${RESET}`)
  console.log(`  ${GRAY}Output: ${session.output ? JSON.stringify(session.output) : '(none)'}${RESET}`)
  console.log(`  ${GRAY}Agent: ${engine.agent.displayName} (${engine.agent.id})${RESET}`)
  if (session.messages.length > 0) {
    console.log(`\n${BOLD}Last messages:${RESET}`)
    const last = session.messages.slice(-5)
    for (const msg of last) {
      const text = msg.content.map(p => (p as { text?: string }).text || '').join('').slice(0, 120)
      const roleLabel = msg.role === 'user' ? `${GREEN}user${RESET}` : msg.role === 'assistant' ? `${CYAN}assistant${RESET}` : `${GRAY}${msg.role}${RESET}`
      console.log(`  ${roleLabel}: ${text}${text.length >= 120 ? '…' : ''}`)
    }
  }
}

let currentEngine: Engine | null = null

async function handleEditAgent(rl: ReturnType<typeof createInterface>): Promise<void> {
  const local = listLocalAgents()
  if (local.length === 0) {
    console.log(`\n${YELLOW}Aucun agent à éditer. Créez-en un d'abord avec 1.${RESET}\n`)
    return
  }

  console.log(`\n${BOLD}${CYAN}┌─ Éditer un agent ─────────────────────────┐${RESET}`)
  console.log(`${BOLD}${CYAN}│  Ctrl+C pour annuler                       │${RESET}`)
  console.log(`${BOLD}${CYAN}└────────────────────────────────────────────┘${RESET}\n`)

  console.log(`${BOLD}Agents disponibles :${RESET}`)
  for (let i = 0; i < local.length; i++) {
    const a = local[i]
    console.log(`  ${CYAN}${i + 1}${RESET}. ${a.name} ${GRAY}(${a.id})${RESET}`)
  }

  const choice = (await rl.question(`\n${CYAN}Choix${RESET} (numéro ou ID) ${GRAY}>${RESET} `)).trim()
  if (!choice) { console.log(`${YELLOW}Annulé.${RESET}\n`); return }

  const num = parseInt(choice, 10)
  let match: { id: string; name: string; file: string } | undefined
  if (!isNaN(num) && num >= 1 && num <= local.length) {
    match = local[num - 1]
  } else {
    match = local.find(a => a.id === choice || a.id.startsWith(choice))
  }
  if (!match) { console.log(`${RED}Agent introuvable.${RESET}\n`); return }

  const agent = readLocalAgent(match.file)
  if (!agent) { console.log(`${RED}Impossible de lire l'agent.${RESET}\n`); return }

  console.log(`\n${BOLD}${CYAN}└─ Édition de : ${agent.displayName}${RESET}\n`)

  // ── Nom ──
  const newName = (await rl.question(`${CYAN}Nom${RESET} (${agent.displayName}) ${GRAY}>${RESET} `)).trim()

  // ── Instructions ──
  console.log(`\n${BOLD}Instructions actuelles :${RESET}\n${CYAN}${agent.instructionsPrompt || '(aucune)'}${RESET}\n`)
  const newInstructions = (await rl.question(`${CYAN}Nouvelles instructions${RESET} (laisser vide) ${GRAY}>${RESET} `)).trim()

  // ── Provider / modèle / clé API ──
  const providerInfo = resolveProviderForModel(agent.model)
  console.log(`\n${BOLD}Configuration actuelle :${RESET}`)
  console.log(`  Modèle   : ${CYAN}${agent.model}${RESET}`)
  console.log(`  Provider : ${providerInfo ? `${providerInfo.provider} (${providerInfo.baseUrl})` : `${YELLOW}aucun${RESET}`}`)
  console.log(`  Clé API  : ${providerInfo?.apiKey ? `****${providerInfo.apiKey.slice(-4)}` : `${YELLOW}non définie${RESET}`}`)

  const changeModel = (await rl.question(`\n${CYAN}Changer le modèle/provider ?${RESET} (o/N) ${GRAY}>${RESET} `)).trim().toLowerCase()
  let newModel = ''
  let newApiKey = ''
  let resolvedProviderType = ''

  if (changeModel === 'o' || changeModel === 'y') {
    const knownProvidersList = getKnownProviders()
    console.log(`\n${BOLD}Fournisseurs disponibles :${RESET}`)
    for (let i = 0; i < knownProvidersList.length; i++) {
      console.log(`  ${CYAN}${i + 1}${RESET}. ${knownProvidersList[i].label}`)
    }
    let providerRaw = ''
    while (!providerRaw) {
      const raw = (await rl.question(`\n${CYAN}Fournisseur${RESET} (numéro ou nom) ${GRAY}>${RESET} `)).trim().toLowerCase()
      const num = parseInt(raw, 10)
      if (!isNaN(num) && num >= 1 && num <= knownProvidersList.length) {
        providerRaw = knownProvidersList[num - 1].type
      } else if (raw && knownProvidersList.find(kp => kp.type === raw)) {
        providerRaw = raw
      } else if (raw) {
        providerRaw = raw
      }
      if (!providerRaw) console.log(`${RED}Choix invalide. Tape un numéro (1-${knownProvidersList.length}) ou un nom de type.${RESET}`)
    }
    const known = knownProvidersList.find(kp => kp.type === providerRaw)
    resolvedProviderType = known ? known.type : providerRaw

    // clé API si nécessaire
    const KEY_REQUIRED = ['google', 'openrouter', 'opencode-zen', 'custom']
    const existingProv = listProviders().find(p => p.provider === resolvedProviderType)
    if (KEY_REQUIRED.includes(resolvedProviderType)) {
      if (existingProv?.apiKeys?.length) {
        console.log(`${GRAY}   Clé existante : ****${existingProv.apiKeys[0].slice(-4)}${RESET}`)
        const reuse = (await rl.question(`${CYAN}Utiliser cette clé ?${RESET} (O/n) ${GRAY}>${RESET} `)).trim().toLowerCase()
        if (reuse === 'n') {
          while (!newApiKey) {
            newApiKey = (await rl.question(`${CYAN}Nouvelle clé API${RESET} ${GRAY}>${RESET} `)).trim()
            if (!newApiKey) console.log(`${RED}La clé API est requise.${RESET}`)
          }
        } else {
          newApiKey = existingProv.apiKeys[0]
        }
      } else {
        while (!newApiKey) {
          newApiKey = (await rl.question(`${CYAN}Clé API${RESET} ${GRAY}>${RESET} `)).trim()
          if (!newApiKey) console.log(`${RED}La clé API est requise pour ${resolvedProviderType}.${RESET}`)
        }
      }
    }

    // fetch models
    const ONLINE_URLS: Record<string, string> = {
      kilo: 'https://api.kilo.ai',
      google: 'https://generativelanguage.googleapis.com',
      openrouter: 'https://openrouter.ai/api/v1',
      'opencode-zen': 'https://zen.opencode.ai/v1',
    }
    const baseUrl = ONLINE_URLS[resolvedProviderType] || 'https://api.openai.com/v1'
    process.stdout.write(`\n${YELLOW}⟳ Récupération des modèles...${RESET}`)
    try {
      const fetched = await fetchModels(resolvedProviderType, newApiKey, baseUrl)
      const display = top15(fetched)
      const hidden = fetched.length - display.length
      process.stdout.write(`\r${GREEN}✓ ${fetched.length} modèles disponibles${RESET}\n\n`)
      for (let i = 0; i < display.length; i++) {
        console.log(`  ${CYAN}${i + 1}${RESET}. ${display[i]}`)
      }
      if (hidden > 0) console.log(`  ${GRAY}... et ${hidden} autres${RESET}`)
      const choice = (await rl.question(`\n${CYAN}Choix du modèle${RESET} (numéro ou nom) ${GRAY}>${RESET} `)).trim()
      const idx = parseInt(choice, 10)
      if (!isNaN(idx) && idx >= 1 && idx <= display.length) {
        newModel = display[idx - 1]
      } else if (choice) {
        newModel = choice
      }
      if (!newModel) { const fallback = existingProv?.defaultModel || display[0]; console.log(`${YELLOW}Utilisation de ${fallback}${RESET}`); newModel = fallback }
    } catch {
      process.stdout.write(`\r${YELLOW}⚠ Récupération impossible — saisie manuelle${RESET}\n`)
      newModel = (await rl.question(`${CYAN}Modèle${RESET} ${GRAY}>${RESET} `)).trim() || agent.model
    }

    // sauvegarder la clé API si nouvelle
    if (newApiKey) {
      const provName = existingProv?.name || resolvedProviderType
      setProviderApiKey(provName, newApiKey)
    }
  }

  // ── Appliquer ──
  const updates: { name?: string; instructionsPrompt?: string; model?: string } = {}
  if (newName) updates.name = newName
  if (newInstructions) updates.instructionsPrompt = newInstructions
  if (newModel) updates.model = newModel

  if (Object.keys(updates).length === 0) {
    console.log(`${YELLOW}Aucune modification.${RESET}\n`)
    return
  }

  if (updateAgentFile(match.file, updates)) {
    console.log(`\n${GREEN}✓ Agent mis à jour :${RESET}`)
    if (newName) console.log(`  Nom      : ${newName}`)
    if (newInstructions) console.log(`  Instructions mises à jour`)
    if (newModel) console.log(`  Modèle   : ${newModel}`)
    if (newApiKey) console.log(`  Clé API  : mise à jour`)
    console.log()

    // recharger l'agent dans le moteur
    const reloaded = readLocalAgent(match.file)
    if (reloaded) {
      currentEngine = createEngine({ agent: reloaded })
      currentEngine.createSession()
      console.log(`${GREEN}✓ Moteur rechargé avec les nouvelles valeurs${RESET}\n`)
    }
  } else {
    console.log(`${RED}Erreur lors de la mise à jour.${RESET}\n`)
  }
}

async function handleStartSession(rl: ReturnType<typeof createInterface>): Promise<void> {
  console.log(`\n${BOLD}${CYAN}┌─ Démarrer une session ───────────────────┐${RESET}`)
  console.log(`${BOLD}${CYAN}│  Ctrl+C pour annuler                       │${RESET}`)
  console.log(`${BOLD}${CYAN}└────────────────────────────────────────────┘${RESET}`)

  const local = listLocalAgents()
  if (local.length === 0) {
    console.log(`\n${YELLOW}Aucun agent local trouvé.${RESET}`)
    console.log(`${YELLOW}Utilisez 1 (Créer un agent) pour en créer un d'abord.${RESET}\n`)
    return
  }

  console.log(`\n${BOLD}Agents disponibles :${RESET}`)
  for (let i = 0; i < local.length; i++) {
    const a = local[i]
    const active = a.id === currentEngine?.agent.id ? ` ${GREEN}◀ actif${RESET}` : ''
    console.log(`  ${CYAN}${i + 1}${RESET}. ${a.name}${active}`)
    console.log(`  ${GRAY}     ID: ${a.id}  |  Fichier: ${a.file}${RESET}`)
  }

  const choice = (await rl.question(`\n${CYAN}Choix${RESET} (numéro ou ID) ${GRAY}>${RESET} `)).trim()
  if (!choice) { console.log(`${YELLOW}Annulé.${RESET}\n`); return }

  // try by number
  const num = parseInt(choice, 10)
  let match: { id: string; name: string; file: string } | undefined
  if (!isNaN(num) && num >= 1 && num <= local.length) {
    match = local[num - 1]
  } else {
    // match by ID prefix
    match = local.find(a => a.id === choice || a.id.startsWith(choice))
  }

  if (!match) {
    console.log(`${RED}Agent "${choice}" introuvable.${RESET}\n`)
    return
  }

  const agent = readLocalAgent(match.file)
  if (!agent) {
    console.log(`${RED}Impossible de charger "${match.file}".${RESET}\n`)
    return
  }

  currentEngine = createEngine({ agent })
  currentEngine.createSession()
  console.log(`\n${GREEN}✓ Session démarrée${RESET}`)
  console.log(`  ${BOLD}Agent${RESET}   : ${agent.displayName} ${GRAY}(${agent.id})${RESET}`)
  console.log(`  ${BOLD}Session${RESET} : ${currentEngine.getCurrentSession()?.id}${RESET}`)
  console.log(`  ${BOLD}Modèle${RESET}  : ${agent.model}${RESET}`)
  const toolList = agent.toolNames.join(', ')
  console.log(`  ${BOLD}Outils${RESET}  : ${toolList}${RESET}`)
  console.log(`\n${YELLOW}Vous pouvez maintenant envoyer des prompts !${RESET}`)
  console.log(`  Tapez !cmd pour exécuter une commande, @msg pour un message, /help pour l'aide.\n`)
}

async function handleCreate(rl: ReturnType<typeof createInterface>): Promise<void> {
  console.log(`\n${BOLD}${CYAN}┌─ Créer un agent ──────────────────────────┐${RESET}`)
  console.log(`${BOLD}${CYAN}│  Ctrl+C pour annuler                       │${RESET}`)
  console.log(`${BOLD}${CYAN}└────────────────────────────────────────────┘${RESET}\n`)

  // --- 0. Vérification de l'équipe d'orchestration PACO ---
  const ORCHESTRATION_FILES = [
    { path: 'data/profiles/agents/orchestrateur.json', name: 'Profil orchestrateur' },
    { path: 'data/profiles/agents/agent-superviseur.json', name: 'Profil superviseur' },
    { path: 'data/profiles/daemons/DAEMON-superviseur-01.json', name: 'Daemon superviseur' },
    { path: 'data/protocols/keyword-registry.yaml', name: 'Registre de mots-clés' },
    { path: 'data/protocols/paco-protocol.md', name: 'Protocole PACO' },
  ]
  const cwd = process.cwd()
  const missing: string[] = []
  for (const f of ORCHESTRATION_FILES) {
    if (!existsSync(join(cwd, f.path))) missing.push(f.name)
  }
  if (missing.length > 0) {
    console.log(`\n${RED}${BOLD}⚠ ÉQUIPE D'ORCHESTRATION MANQUANTE${RESET}`)
    console.log(`${YELLOW}Avant de créer un agent, l'équipe PACO est obligatoire :${RESET}`)
    for (const m of missing) console.log(`  ${RED}✗${RESET} ${m}`)
    console.log(`\n${CYAN}[S]${RESET} Créer l'équipe d'orchestration  ${CYAN}[A]${RESET} Annuler`)
    const choice = (await rl.question(`\n${GRAY}>${RESET} `)).trim().toLowerCase()
    if (choice === 's') {
      console.log(`\n${YELLOW}⟳ Création de l'équipe d'orchestration...${RESET}`)
      const teamConfig = [
        {
          id: 'orchestrateur',
          name: 'Orchestrateur',
          tools: ['run_terminal_command', 'add_message', 'set_output'],
          instructions: `Tu es l'Agent-Maître, l'orchestrateur central.
Ta mission unique est de coordonner les autres agents.
Tu ne produis JAMAIS de code, documentation, analyse, design ou tout autre livrable toi-même.
Ta seule production autorisée est :
1. mises à jour de tâches_en_cours.json
2. messages de délégation au format @agent-ID: mission
3. rapports de coordination

Le protocole PACO est obligatoire : avant chaque action, tu consultes le registre keyword-registry.yaml.
Si un mot-clé de la tâche match un agent, tu DOIS déléguer.
Si aucun agent ne correspond, tu réponds 'Tâche non couverte — intervention humaine requise'.
Tu es surveillé en continu par DAEMON-superviseur-01. Toute violation peut entraîner ta suspension.`,
        },
        {
          id: 'agent-superviseur',
          name: 'Agent Superviseur',
          tools: ['add_message'],
          instructions: `Tu es l'Agent-Superviseur, le garde-fou du protocole PACO.
Ta mission unique est de surveiller l'orchestrateur en continu.
Tu ne produis AUCUN livrable, tu ne fais AUCUNE modification de fichier.
Tu es lecture seule. Tu scrutes les logs, les sorties et les fichiers de l'orchestrateur.
Tu vérifies qu'il délègue toujours et ne fait jamais le travail lui-même.
En cas de violation, tu émets une alerte.
Après 3 violations consécutives, tu suspends l'orchestrateur.`,
        },
        {
          id: 'DAEMON-superviseur-01',
          name: 'Daemon Superviseur',
          tools: ['run_terminal_command', 'add_message', 'set_output'],
          instructions: `Tu es le daemon superviseur PACO.
Tu te réveilles toutes les 5 minutes pour scruter l'orchestrateur.
Tu lis tâches_en_cours.json et les logs de coordination.
Tu vérifies que l'orchestrateur a bien délégué chaque tâche à un agent compétent.
Si tu détectes une violation (production directe, délégation manquante), tu émets une alerte.
Après 3 violations consécutives de niveau ≥ moyen, tu marques l'orchestrateur comme suspendu.`,
        },
      ]
      for (const agent of teamConfig) {
        try {
          scaffoldAgent(agent.id, agent.name, 'kilo-auto/free', agent.tools, agent.instructions, true, 'standard')
          console.log(`  ${GREEN}✓${RESET} ${agent.name} créé`)
        } catch (e) {
          console.log(`  ${RED}✗${RESET} ${agent.name} : ${(e as Error).message}`)
        }
      }
      console.log(`\n${GREEN}✓ Équipe d'orchestration créée. Relance /create pour créer ton agent.${RESET}\n`)
      return
    }
    console.log(`${YELLOW}Opération annulée. L'équipe d'orchestration est requise.${RESET}\n`)
    return
  }
  console.log(`  ${GREEN}✓${RESET} Équipe d'orchestration PACO présente\n`)

  // --- 1. Choix du provider + apikey ---
  const knownProviders = getKnownProviders()
  console.log(`${BOLD}Étape 1 : Sélection du fournisseur LLM${RESET}`)
  console.log(`\n${BOLD}Fournisseurs disponibles :${RESET}`)
  for (let i = 0; i < knownProviders.length; i++) {
    console.log(`  ${CYAN}${i + 1}${RESET}. ${knownProviders[i].label}`)
  }
  let providerRaw = ''
  while (!providerRaw) {
    const raw = (await rl.question(`\n${CYAN}Fournisseur${RESET} (numéro ou nom) ${GRAY}>${RESET} `)).trim().toLowerCase()
    const num = parseInt(raw, 10)
    if (!isNaN(num) && num >= 1 && num <= knownProviders.length) {
      providerRaw = knownProviders[num - 1].type
    } else if (raw && knownProviders.find(kp => kp.type === raw)) {
      providerRaw = raw
    } else if (raw) {
      providerRaw = raw
    }
    if (!providerRaw) console.log(`${RED}Choix invalide. Tape un numéro (1-${knownProviders.length}) ou un nom de type.${RESET}`)
  }
  const known = knownProviders.find(kp => kp.type === providerRaw)
  const providerType = known ? known.type : providerRaw

  const ONLINE_URLS: Record<string, string> = {
    kilo: 'https://api.kilo.ai',
    google: 'https://generativelanguage.googleapis.com',
    openrouter: 'https://openrouter.ai/api/v1',
    'opencode-zen': 'https://zen.opencode.ai/v1',
  }
  const KEY_REQUIRED = ['google', 'openrouter', 'opencode-zen', 'custom']
  let configured = listProviders().find(p => p.provider === providerType)
  let apiKey = configured?.apiKeys?.[0] || ''

  while (true) {
    if (KEY_REQUIRED.includes(providerType) && !apiKey) {
      while (!apiKey) {
        apiKey = (await rl.question(`\n${CYAN}Clé API${RESET} pour ${providerType} ${GRAY}>${RESET} `)).trim()
        if (!apiKey) console.log(`${RED}La clé API est requise pour ${providerType}.${RESET}`)
        else {
          const conflict = isApiKeyUsed(apiKey)
          if (conflict) {
            console.log(`${RED}⚠ Cette clé est déjà utilisée par "${conflict.name}" (${conflict.provider}).${RESET}`)
            console.log(`${YELLOW}   Chaque agent doit avoir une clé unique pour le parallélisme.${RESET}`)
            apiKey = ''
          }
        }
      }
    }

    // --- 1.1 Test de la clé API (via fetchModels) ---
    const testBaseUrl = configured?.baseUrl || ONLINE_URLS[providerType] || 'https://api.openai.com/v1'
    process.stdout.write(`\n${YELLOW}⟳ Validation de la clé API pour ${providerType}...${RESET}`)
    try {
      await fetchModels(providerType, apiKey, testBaseUrl)
      process.stdout.write(`\r${GREEN}✓ Clé API valide pour ${providerType}        ${RESET}\n`)
      
      // Sauvegarde de la clé si valide
      if (apiKey && apiKey !== configured?.apiKeys?.[0]) {
        const label = providerType === 'opencode-zen' ? 'Opencode Zen'
          : providerType === 'google' ? 'Google Gemini'
          : providerType === 'custom' ? `Custom (${providerType})`
          : providerType
        if (configured) {
          setProviderApiKey(configured.name, apiKey)
        } else {
          addProvider({ name: label, provider: providerType, apiKeys: [apiKey], baseUrl: testBaseUrl, defaultModel: 'custom' })
          configured = listProviders().find(p => p.provider === providerType)
          console.log(`${GREEN}✓ Provider "${label}" configuré.${RESET}`)
        }
      }
      break // Clé OK, on passe à la suite
    } catch (err) {
      process.stdout.write(`\r${RED}✗ Clé API invalide pour ${providerType}${RESET}\n`)
      const guidance = getModelFetchGuidance(providerType, err as Error)
      for (const g of guidance) console.log(`  ${g}`)
      
      const choice = (await rl.question(
        `\n${CYAN}[K]${RESET} Changer clé  ${CYAN}[A]${RESET} Annuler  ${GRAY}>${RESET} `
      )).trim().toLowerCase()
      
      if (choice === 'k') {
        apiKey = '' // Pour forcer la redemande
        continue
      }
      console.log(`${YELLOW}Annulé.${RESET}`); return
    }
  }

  // Pause pour stabiliser entre les étapes
  await pause('Provider validé → Sélection du modèle')

  // --- 2. Choix du modèle ---
  let effectiveApiKey = apiKey || ''
  let effectiveBaseUrl = configured?.baseUrl || ONLINE_URLS[providerType] || 'https://api.openai.com/v1'
  let models: string[] = []
  let model = ''
  
  process.stdout.write(`\n${YELLOW}⟳ Récupération des modèles...${RESET}`)
  models = await fetchModels(providerType, effectiveApiKey, effectiveBaseUrl)
  process.stdout.write(`\r${GREEN}✓ ${models.length} modèles trouvés        ${RESET}\n`)
  
  const display = top15(models)
  const hidden = models.length - display.length
  console.log(`\n${BOLD}Modèles disponibles pour ${providerType} :${RESET}`)
  for (let i = 0; i < display.length; i++) {
    console.log(`  ${CYAN}${i + 1}${RESET}. ${display[i]}`)
  }
  if (hidden > 0) console.log(`  ${GRAY}... et ${hidden} autres${RESET}`)
  
  const modelChoice = (await rl.question(`\n${CYAN}Choix du modèle${RESET} (numéro ou nom) ${GRAY}>${RESET} `)).trim()
  const idx = parseInt(modelChoice, 10)
  if (!isNaN(idx) && idx >= 1 && idx <= display.length) { 
    model = display[idx - 1] 
  } else if (modelChoice) { 
    model = modelChoice 
  } else { 
    model = configured?.defaultModel || display[0] 
  }

  // --- 2.1 Test de connexion complet ---
  console.log(`\n${BOLD}${CYAN}┌─ Test de connexion ──────────────────────┐${RESET}`)
  while (true) {
    process.stdout.write(`\n${YELLOW}⟳ Test de connexion à ${providerType} / ${model}...${RESET}`)
    const result = await testConnection(providerType, effectiveApiKey, effectiveBaseUrl, model)
    if (result.ok) {
      process.stdout.write(`\r${GREEN}✓ Connexion réussie !${RESET}\n\n`)
      break
    }
    process.stdout.write(`\r${RED}✗ Échec de connexion${RESET}\n\n`)
    for (const d of result.diagnostics) console.log(`  ${d}`)
    console.log()
    const choice = (await rl.question(
      `${CYAN}[R]${RESET} Réessayer  ${CYAN}[M]${RESET} Changer modèle  ${CYAN}[A]${RESET} Annuler  ${GRAY}>${RESET} `
    )).trim().toLowerCase()
    if (choice === 'r') continue
    if (choice === 'm') {
      model = (await rl.question(`${CYAN}Nouveau modèle${RESET} ${GRAY}>${RESET} `)).trim()
      if (!model) continue
      continue
    }
    console.log(`${YELLOW}Annulé.${RESET}`); return
  }

  // Pause pour stabiliser entre les étapes
  await pause('Connexion validée → Identification de l\'agent')

  // --- Étape : Description de l'agent ---
  console.log(`\n${BOLD}Étape : Description de l'agent${RESET}`)
  
  let description = ''
  const LLM_PATTERNS = [
    /^{/,  // starts with placeholder
    /\{[^}]+\}/,  // contains placeholders
    /## Mission/i,
    /## Comportement/i,
    /## Compétences/i,
    /## Règles/i,
    /^tu es /i,
    /^voici /i,
    /^génère/i,
    /^réponds/i,
  ]

  async function readMultiline(promptLabel: string, minWords: number): Promise<string> {
    console.log(`\n${CYAN}${promptLabel}${RESET}`)
    console.log(`${GRAY}(Tape une ligne vide pour terminer)${RESET}\n`)
    const lines: string[] = []
    
    while (true) {
      const line = await rl.question(`${GRAY}|${RESET} `)
      
      if (line.trim() === '') {
        const fullText = lines.join(' ').trim()
        const wordCount = fullText.split(/\s+/).filter(Boolean).length
        
        if (wordCount < minWords) {
          console.log(`${RED}La description est trop courte (${wordCount}/${minWords} mots minimum).${RESET}`)
          console.log(`${GRAY}Continue ta saisie ou tape une ligne vide quand tu as fini.${RESET}\n`)
          continue
        }
        
        const hasSuspiciousPattern = LLM_PATTERNS.some(pattern => pattern.test(fullText))
        if (hasSuspiciousPattern) {
          console.log(`${RED}La description semble contenir du texte généré par l'IA (placeholders ou headers).${RESET}`)
          console.log(`${YELLOW}Merci de saisir uniquement ta description en tant qu'utilisateur.${RESET}`)
          console.log(`${GRAY}Recommence ou continue ta saisie.${RESET}\n`)
          lines.length = 0
          continue
        }
        
        return fullText
      }
      
      lines.push(line.trim())
    }
  }
  
  description = await readMultiline('Description de l\'agent (min. 10 mots)', 10)

  // --- 2. Phase d'Analyse Automatique par l'Agent ---
  console.log(`\n${YELLOW}⟳ Analyse de la mission et configuration automatique...${RESET}`)
  
  const llmDecisionProvider = { provider: providerType, apiKey: effectiveApiKey, baseUrl: effectiveBaseUrl, model }
  const decisionEngine = createEngine({
    agent: { id: 'decision-maker', displayName: 'Decision Maker', model, instructionsPrompt: 'Tu es un expert en configuration d\'agents.', toolNames: [] },
  })

  // A. Sélection du Nom (Dieu Grec)
  let assignedName = 'Athena'
  try {
    const greekGodsPath = join(process.cwd(), 'data', 'agent-name', 'greek-gods.json')
    if (existsSync(greekGodsPath)) {
      const godsData = JSON.parse(readFileSync(greekGodsPath, 'utf-8'))
      const gods = godsData.dieux || {}
      const godsList = Object.entries(gods).map(([name, desc]) => `- ${name}: ${desc}`).join('\n')
      
      const godMatchPrompt = `Liste de dieux grecs :
${godsList}

Mission de l'agent : "${description}"

Retourne UNIQUEMENT le nom du dieu grec le plus adapté (sans ponctuation). Retourne "Athena" si incertain.`

      const godResponse = await decisionEngine.callLLM(godMatchPrompt, llmDecisionProvider, "Tu es un expert en mythologie et matching de personnalité.")
      assignedName = godResponse.trim().replace(/[^a-zA-Zàâäéèêëïîôùûüÿœæç]/g, '').split('\n')[0] || 'Athena'
    }
  } catch (err) {
    console.log(`${YELLOW}⚠ Erreur lors du choix du nom : ${(err as Error).message}${RESET}`)
  }

  // B. Sélection du Template et du Profil
  let type: 'agents' | 'bots' | 'daemons' = 'agents'
  let template: 'standard' | 'fast' | 'daemon' = 'standard'
  let selectedProfile: AgentProfile | undefined = undefined

  try {
    const profilesAgents = listProfiles('agents')
    const profilesBots = listProfiles('bots')
    const profilesDaemons = listProfiles('daemons')

    const decisionPrompt = `Mission de l'agent : "${description}"

Analyse cette mission et choisis :
1. Le TYPE d'agent le plus adapté parmi : "standard" (assistant général), "fast" (bot rapide d'automatisation), "daemon" (tâche de fond périodique).
2. Le PROFIL le plus adapté parmi cette liste classée par type :
- agents: ${profilesAgents.join(', ')}
- bots: ${profilesBots.join(', ')}
- daemons: ${profilesDaemons.join(', ')}

Réponds UNIQUEMENT au format JSON suivant :
{
  "template": "standard|fast|daemon",
  "profileType": "agents|bots|daemons",
  "profileName": "nom_du_profil"
}`

    const decisionResponse = await decisionEngine.callLLM(decisionPrompt, llmDecisionProvider, "Tu es un architecte système spécialisé en agents IA.")
    const decision = JSON.parse(decisionResponse.match(/\{[\s\S]*\}/)?.[0] || '{}')
    
    if (decision.template) template = decision.template
    if (decision.profileType) type = decision.profileType
    if (decision.profileName) {
      selectedProfile = loadProfile(type, decision.profileName) || undefined
    }

    console.log(`${GREEN}✓ Choix automatiques :${RESET}`)
    console.log(`  ${BOLD}Nom      :${RESET} ${assignedName}`)
    console.log(`  ${BOLD}Template :${RESET} ${template}`)
    console.log(`  ${BOLD}Profil   :${RESET} ${decision.profileName || 'Aucun'}`)
  } catch (err) {
    console.log(`${YELLOW}⚠ Erreur lors de l'analyse automatique, utilisation des défauts.${RESET}`)
  }

  const assignedId = `agent-${assignedName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}`
  console.log(`${GRAY}  ID généré : ${assignedId}${RESET}\n`)

  await pause('Analyse terminée → Création et certification')

  // --- 3. Création, Skill, Scripts, Validation, Certification ---
  console.log(`${BOLD}${CYAN}┌─ Phase de création et certification ──────┐${RESET}`)
  console.log(`${GRAY}Utilisation du model ${model} pour créer l'agent ${assignedName}...${RESET}`)
  
  const tools = ['run_terminal_command', 'add_message', 'set_output', 'skill']
  const skillId = `skill-${assignedId}`
  let skillContent = ''
  let agentPath = ''

  const llmProvider = { provider: providerType, apiKey: effectiveApiKey, baseUrl: effectiveBaseUrl, model }

  async function performCreationCycle(attemptDescription: string) {
    process.stdout.write(`\n${YELLOW}⟳ ${attemptDescription}...${RESET}`)
    
    // A. Génération de la Skill
    try {
      const skill = await generateSkill(assignedId, assignedName, description, llmProvider)
      skillContent = skill.content
      process.stdout.write(`\r${GREEN}✓ Skill "${skillId}" générée${RESET}\n`)
    } catch (err) {
      process.stdout.write(`\r${RED}✗ Échec génération skill : ${(err as Error).message}${RESET}\n`)
    }

    // B. Enregistrement de l'Agent (Scaffold)
    let instructions = description
    if (skillContent) {
      instructions = skillContent.replace(/^---[\s\S]*?---\n/, '').trim()
    }
    try {
      agentPath = scaffoldAgent(assignedId, assignedName, model, tools, instructions, true, template, selectedProfile)
      console.log(`  ${GREEN}✓ Agent enregistré${RESET} ${GRAY}${agentPath}${RESET}`)
    } catch (err) {
      console.log(`  ${RED}✗ Échec enregistrement agent : ${(err as Error).message}${RESET}`)
    }

    // C. Validation via Scripts et Golden Rules
    console.log(`  ${YELLOW}⟳ Validation via scripts et golden-rules...${RESET}`)
    const vSkill = await validateSkill(skillId)
    const vAgent = await validateAgentIntegration(assignedId)
    const vInt = await validateIntegration(assignedId, skillId)

    return {
      ok: vSkill.ok && vAgent.ok && vInt.ok,
      vSkill,
      vAgent,
      vInt
    }
  }

  async function callAgentReviewer(agentId: string, skillId: string): Promise<{ suggestions: string[]; urgentCount: number; importantCount: number }> {
    try {
      const agentPath = join(process.cwd(), '.agents', `${agentId}.ts`)
      const skillPath = join(process.cwd(), 'skills', skillId, 'SKILL.md')

      const agentContent = existsSync(agentPath) ? readFileSync(agentPath, 'utf-8') : 'Fichier agent introuvable'
      const skillContent = existsSync(skillPath) ? readFileSync(skillPath, 'utf-8') : 'Fichier skill introuvable'

      const reviewPrompt = `Analyse les fichiers suivants et fournis un diagnostic avec classification par gravité.

## Fichier Agent (.agents/${agentId}.ts)
\`\`\`typescript
${agentContent}
\`\`\`

## Fichier Skill (skills/${skillId}/SKILL.md)
\`\`\`markdown
${skillContent}
\`\`\`

Fournis ta réponse dans ce format :
### 📊 Résumé
{nombre} problème(s)

### 🔴 Urgent (bloquant)
- {problème}

### 🟠 Important (à corriger)
- {problème}

### 🟡 Obligatoire
- {problème}

### 🔵 À voir
- {suggestion}

### ✅ Points positifs
- {ce qui est bien}`

      const llmProvider = { provider: providerType, apiKey: effectiveApiKey, baseUrl: effectiveBaseUrl, model: model }
      const reviewerEngine = createEngine({
        agent: {
          id: 'agent-reviewer',
          displayName: 'Reviewer',
          model: model,
          instructionsPrompt: `Tu es un expert en revue de code et analyse de qualité pour agents AI. Analyse les fichiers .ts et .md et fournis un diagnostic structuré.`,
          toolNames: ['run_terminal_command', 'add_message', 'set_output', 'skill'],
        },
      })

      const response = await reviewerEngine.callLLM(reviewPrompt, llmProvider, reviewerEngine.agent.instructionsPrompt)

      const suggestions: string[] = []
      const urgentCount = (response.match(/🔴 Urgent/gi) || []).length
      const importantCount = (response.match(/🟠 Important/gi) || []).length

      console.log(`\n${BOLD}${CYAN}┌─ Rapport du Reviewer ─────────────────────┐${RESET}`)
      console.log(response)
      console.log(`${CYAN}└────────────────────────────────────────────┘${RESET}\n`)

      return { suggestions, urgentCount, importantCount }
    } catch (err) {
      console.log(`  ${YELLOW}⚠ Impossible de appeler le reviewer : ${(err as Error).message}${RESET}`)
      return { suggestions: [], urgentCount: 0, importantCount: 0 }
    }
  }

  let finalStatus = { ok: false, vSkill: {ok:false, errors:[] as string[]}, vAgent: {ok:false, errors:[] as string[]}, vInt: {ok:false, errors:[] as string[]} }

  for (let attempt = 1; attempt <= 3; attempt++) {
    finalStatus = await performCreationCycle(attempt === 1 ? 'Création initiale' : `Tentative d'auto-correction ${attempt}/3`)

    console.log(`  ${finalStatus.vSkill.ok ? `${GREEN}✓` : `${RED}✗`}${RESET} Skill`)
    if (!finalStatus.vSkill.ok) finalStatus.vSkill.errors.forEach(e => console.log(`     ${RED}→ ${e}${RESET}`))

    console.log(`  ${finalStatus.vAgent.ok ? `${GREEN}✓` : `${RED}✗`}${RESET} Agent`)
    if (!finalStatus.vAgent.ok) finalStatus.vAgent.errors.forEach(e => console.log(`     ${RED}→ ${e}${RESET}`))

    console.log(`  ${finalStatus.vInt.ok ? `${GREEN}✓` : `${RED}✗`}${RESET} Intégration`)
    if (!finalStatus.vInt.ok) finalStatus.vInt.errors.forEach(e => console.log(`     ${RED}→ ${e}${RESET}`))

    if (finalStatus.ok) {
      // --- Phase Reviewer ---
      console.log(`\n${YELLOW}⟳ Phase de review par agent-reviewer...${RESET}`)
      const review = await callAgentReviewer(assignedId, skillId)

      if (review.urgentCount > 0 || review.importantCount > 0) {
        console.log(`${YELLOW}⚠ Le reviewer a identifié des problèmes importants.${RESET}`)
        console.log(`${GRAY}Auto-correction en cours...${RESET}`)

        if (attempt < 3) {
          continue // Va à la prochaine itération pour auto-correction
        } else {
          console.log(`${RED}⚠ Nombre maximum de tentatives atteint. Certification refusée.${RESET}`)
          finalStatus.ok = false
        }
      } else {
        // Pas de problème urgent/important, on peut certifier
        break
      }
    }
  }

  // --- Résultat final et Certification ---
  if (finalStatus.ok) {
    console.log(`\n${GREEN}${BOLD}╔══════════════════════════════════════════╗${RESET}`)
    console.log(`${GREEN}${BOLD}║   AGENT VALIDÉ & CERTIFIÉ ✓              ║${RESET}`)
    console.log(`${GREEN}${BOLD}╚══════════════════════════════════════════╝${RESET}`)
    console.log(`  ${BOLD}Agent${RESET}    : ${assignedName} (${assignedId})`)
    console.log(`  ${BOLD}Fichier${RESET}  : ${agentPath}`)
    console.log(`  ${BOLD}Skill${RESET}    : skills/${skillId}/SKILL.md`)
    console.log(`  ${BOLD}Model${RESET}    : ${model}`)
    console.log(`  ${BOLD}Provider${RESET} : ${providerType}`)
    console.log(`  ${BOLD}Status${RESET}   : ${GREEN}CERTIFIÉ${RESET}\n`)
    console.log(`${YELLOW}Utilise /use ${assignedId} pour charger ce nouvel agent.${RESET}\n`)
  } else {
    console.log(`\n${RED}${BOLD}╔══════════════════════════════════════════╗${RESET}`)
    console.log(`${RED}${BOLD}║   ÉCHEC — Certification impossible       ║${RESET}`)
    console.log(`${RED}${BOLD}╚══════════════════════════════════════════╝${RESET}`)
    console.log(`  ${YELLOW}L'agent n'a pas pu être certifié après 3 tentatives.${RESET}`)
    console.log(`  ${YELLOW}Vérifie les erreurs ci-dessus et les golden-rules.${RESET}\n`)
  }
}

function handleListAgents(): void {
  const engine = currentEngine!
  const local = listLocalAgents()

  console.log(`\n${BOLD}Agent actif :${RESET}`)
  console.log(`  ${GREEN}◀${RESET} ${engine.agent.displayName} ${GRAY}(${engine.agent.id})${RESET}`)

  if (local.length === 0) {
    console.log(`\n${YELLOW}Aucun agent local trouvé. Utilisez /create pour en créer un.${RESET}\n`)
    return
  }

  console.log(`\n${BOLD}Agents locaux (.agents/) :${RESET}`)
  for (const a of local) {
    const active = a.id === engine.agent.id ? ` ${GREEN}◀ actif${RESET}` : ''
    console.log(`  ${CYAN}${a.id}${RESET}  ${a.name}${active}`)
    console.log(`  ${GRAY}   └─ ${a.file}${RESET}`)
  }
  console.log(`\n${YELLOW}Utilisez /use <id> pour charger un agent.${RESET}\n`)
}

function handleUseAgent(args: string[]): void {
  const name = args[0]
  if (!name) {
    console.log(`${YELLOW}Usage: /use <agent-id>${RESET}`)
    return
  }
  const local = listLocalAgents()
  const match = local.find(a => a.id === name || a.file === name || a.id.startsWith(name))
  if (!match) {
    console.log(`${RED}Agent "${name}" introuvable. Utilisez /agents pour lister les agents disponibles.${RESET}`)
    return
  }
  const agent = readLocalAgent(match.file)
  if (!agent) {
    console.log(`${RED}Impossible de charger "${match.file}".${RESET}`)
    return
  }
  currentEngine = createEngine({ agent })
  currentEngine.createSession()
  console.log(`${GREEN}Agent chargé : ${agent.displayName} ${GRAY}(${agent.id})${RESET}`)
}

async function handleProviders(rl: ReturnType<typeof createInterface>, args: string[]): Promise<void> {
  const sub = args[0]?.toLowerCase()

  if (!sub || sub === 'list' || sub === 'ls') {
    const providers = listProviders()
    const online = providers.filter(p => !isLocalProvider(p.provider))
    const local = providers.filter(p => isLocalProvider(p.provider))

    if (providers.length === 0) {
      console.log(`${YELLOW}Aucun fournisseur configuré.${RESET}`)
      return
    }

    console.log(`\n${BOLD}Fournisseurs en ligne :${RESET}`)
    for (const p of online) {
      const status = p.enabled ? `${GREEN}✓ actif${RESET}` : `${GRAY}✗ inactif${RESET}`
      const keyInfo = p.apiKeys.length > 0
        ? `${p.apiKeys.length} clé(s)`
        : '(aucune clé)'
      console.log(`  ${CYAN}${p.name}${RESET}  ${status}  ${GRAY}${keyInfo}${RESET}`)
    }

    console.log(`\n${BOLD}Fournisseurs locaux :${RESET}`)
    for (const p of local) {
      const status = p.enabled ? `${GREEN}✓ actif${RESET}` : `${GRAY}✗ inactif${RESET}`
      console.log(`  ${CYAN}${p.name}${RESET}  ${status}`)
      console.log(`  ${GRAY}   URL   : ${p.baseUrl}${RESET}`)
    }

    const types = [...new Set(providers.map(p => p.provider))]
    const rotators = types.filter(t => getProvidersByType(t).some(p => p.apiKeys.length > 1))
    if (rotators.length > 0) {
      console.log(`\n${GREEN}⚡ Alternateur actif pour : ${rotators.join(', ')}${RESET}`)
    }
    console.log(`\n${YELLOW}Fichier de config : ${getProviderConfigPath()}${RESET}\n`)
    console.log(`${GRAY}Sous-commandes :${RESET}`)
    console.log(`${GRAY}  /providers add <nom>           Ajouter un provider en ligne${RESET}`)
    console.log(`${GRAY}  /providers local              Voir le statut des providers locaux${RESET}`)
    console.log(`${GRAY}  /providers scan               Détecter automatiquement Ollama / LM Studio${RESET}`)
    console.log(`${GRAY}  /providers remove <nom>        Supprimer un provider${RESET}`)
    console.log(`${GRAY}  /providers keys <nom>          Voir les clés d'un provider${RESET}`)
    console.log(`${GRAY}  /providers addkey <nom>        Ajouter une clé${RESET}`)
    console.log(`${GRAY}  /providers enable/disable <nom>${RESET}`)
    console.log(`${GRAY}  /providers key <nom> <clé>     Définir/changer la clé${RESET}`)
    console.log(`${GRAY}  /providers model <nom> <modèle>${RESET}\n`)
    return
  }

  if (sub === 'local') {
    console.log(`\n${BOLD}Statut des providers locaux :${RESET}`)
    for (const type of ['ollama', 'lm-studio']) {
      const label = type === 'ollama' ? 'Ollama' : 'LM Studio'
      try {
        const result = await checkLocalProvider(type)
        if (result.alive) {
          console.log(`  ${GREEN}✓${RESET} ${CYAN}${label}${RESET} — ${result.version || 'démarré'}`)
        } else {
          console.log(`  ${RED}✗${RESET} ${CYAN}${label}${RESET} — ${result.error || 'indisponible'}`)
        }
      } catch {
        console.log(`  ${RED}✗${RESET} ${CYAN}${label}${RESET} — erreur de détection`)
      }
    }
    console.log()
    return
  }

  if (sub === 'scan') {
    console.log(`\n${YELLOW}⟳ Scan des providers locaux...${RESET}`)
    for (const type of ['ollama', 'lm-studio']) {
      const label = type === 'ollama' ? 'Ollama' : 'LM Studio'
      const result = await checkLocalProvider(type)
      if (result.alive) {
        console.log(`  ${GREEN}✓ ${label} détecté${RESET}${result.version ? ` (${result.version})` : ''}`)
        const existing = getProvidersByType(type)
        if (existing.length === 0) {
          const name = type === 'ollama' ? 'Ollama' : 'LM Studio'
          const baseUrl = type === 'ollama' ? 'http://localhost:11434' : 'http://localhost:1234'
          addProvider({ name, provider: type, apiKeys: [], baseUrl, defaultModel: type === 'ollama' ? 'llama3.2' : 'local-model' })
          console.log(`  ${GREEN}✓ ${name} ajouté à la configuration${RESET}`)
        } else {
          setProviderEnabled(existing[0].name, true)
          console.log(`  ${GREEN}✓ ${existing[0].name} activé${RESET}`)
        }
      } else {
        console.log(`  ${RED}✗ ${label} — ${result.error}${RESET}`)
      }
    }
    console.log()
    return
  }

  if (sub === 'add') {
    const known = getKnownProviders().filter(k => !k.local)

    // Détection : l'agent courant n'a pas de provider configuré ?
    const eng = currentEngine!
    const needsProvider = !resolveProviderForModel(eng.agent.model)
    const agentName = eng.agent.displayName

    console.log(`\n${BOLD}Types de providers disponibles :${RESET}`)
    for (let i = 0; i < known.length; i++) {
      console.log(`  ${CYAN}${i + 1}${RESET}. ${known[i].label}`)
    }
    console.log()

    // Nom — pré-rempli si l'agent courant manque de provider
    let name = ''
    if (needsProvider) {
      console.log(`${YELLOW}ℹ ${agentName} n'a pas de provider configuré.${RESET}`)
      name = (await rl.question(`${CYAN}Nom${RESET} (Entrée pour "${agentName}") ${GRAY}>${RESET} `)).trim()
      if (!name) name = agentName
    } else {
      while (!name) {
        name = (await rl.question(`${CYAN}Nom${RESET} ${GRAY}>${RESET} `)).trim()
        if (!name) console.log(`${RED}Le nom ne peut pas être vide.${RESET}`)
      }
    }

    // Type (obligatoire) — numéro ou nom
    let provider = ''
    while (!provider) {
      const raw = (await rl.question(`${CYAN}Type${RESET} (numéro ou nom) ${GRAY}>${RESET} `)).trim().toLowerCase()
      const num = parseInt(raw, 10)
      if (!isNaN(num) && num >= 1 && num <= known.length) {
        provider = known[num - 1].type
      } else if (raw && known.find(k => k.type === raw)) {
        provider = raw
      } else if (raw) {
        provider = raw // custom type
      }
      if (!provider) console.log(`${RED}Choix invalide. Tape un numéro (1-${known.length}) ou un nom de type.${RESET}`)
    }

    const ONLINE_URLS: Record<string, string> = {
      kilo: 'https://api.kilo.ai',
      google: 'https://generativelanguage.googleapis.com',
      openrouter: 'https://openrouter.ai/api/v1',
      'opencode-zen': 'https://zen.opencode.ai/v1',
    }

    // Clé API (obligatoire pour google, openrouter, opencode-zen, custom)
    const KEY_REQUIRED = ['google', 'openrouter', 'opencode-zen', 'custom']
    let apiKey = ''
    if (KEY_REQUIRED.includes(provider)) {
      while (!apiKey) {
        apiKey = (await rl.question(`${CYAN}Clé API${RESET} ${GRAY}>${RESET} `)).trim()
        if (!apiKey) console.log(`${RED}La clé API est requise pour ${provider}.${RESET}`)
      }
    } else {
      apiKey = (await rl.question(`${CYAN}Clé API${RESET} (optionnelle pour ${provider}) ${GRAY}>${RESET} `)).trim()
    }

    // URL de base (uniquement pour custom et les providers locaux)
    let baseUrl: string
    if (ONLINE_URLS[provider]) {
      baseUrl = ONLINE_URLS[provider]
      console.log(`${GRAY}   URL : ${baseUrl} (automatique)${RESET}`)
    } else {
      const defaultUrl = provider === 'ollama' ? 'http://localhost:11434'
        : provider === 'lm-studio' ? 'http://localhost:1234/v1'
        : 'https://api.openai.com/v1'
      baseUrl = (await rl.question(`${CYAN}URL de base${RESET} ${GRAY}[${defaultUrl}]>${RESET} `)).trim()
      if (!baseUrl) baseUrl = defaultUrl
    }

    // Modèle par défaut — afficher les modèles disponibles
    let defaultModel = ''
    while (!defaultModel) {
      process.stdout.write(`\n${YELLOW}⟳ Récupération des modèles...${RESET}`)
      try {
        const models = await fetchModels(provider, apiKey, baseUrl)
        const display = top15(models)
        const hidden = models.length - display.length
        process.stdout.write(`\r${GREEN}✓ ${models.length} modèles disponibles${RESET}\n\n`)
        for (let i = 0; i < display.length; i++) {
          console.log(`  ${CYAN}${i + 1}${RESET}. ${display[i]}`)
        }
        if (hidden > 0) console.log(`  ${GRAY}... et ${hidden} autres${RESET}`)
        const choice = (await rl.question(`\n${CYAN}Modèle par défaut${RESET} (numéro ou nom personnalisé) ${GRAY}>${RESET} `)).trim()
        const idx = parseInt(choice, 10)
        if (!isNaN(idx) && idx >= 1 && idx <= display.length) {
          defaultModel = display[idx - 1]
        } else if (choice) {
          defaultModel = choice
        }
        if (!defaultModel) console.log(`${RED}Choix invalide. Choisis un numéro ou tape un nom.${RESET}`)
      } catch {
        process.stdout.write(`\r${YELLOW}⚠ Récupération impossible — saisie manuelle${RESET}\n`)
        defaultModel = (await rl.question(`${CYAN}Modèle par défaut${RESET} ${GRAY}>${RESET} `)).trim() || 'gpt-4'
      }
    }
    try {
      addProvider({ name, provider, baseUrl, defaultModel, apiKeys: apiKey ? [apiKey] : [] })
      console.log(`${GREEN}✓ Fournisseur "${name}" ajouté.${RESET}`)
    } catch (err) {
      console.log(`${RED}Erreur : ${(err as Error).message}${RESET}`)
    }
    return
  }

  if (sub === 'remove' || sub === 'rm') {
    const name = args.slice(1).join(' ')
    if (!name) { console.log(`${YELLOW}Usage: /providers remove <nom>${RESET}`); return }
    if (removeProvider(name)) {
      console.log(`${GREEN}✓ Fournisseur "${name}" supprimé.${RESET}`)
    } else {
      console.log(`${RED}Fournisseur "${name}" introuvable.${RESET}`)
    }
    return
  }

  if (sub === 'enable') {
    const name = args.slice(1).join(' ')
    if (!name) { console.log(`${YELLOW}Usage: /providers enable <nom>${RESET}`); return }
    if (setProviderEnabled(name, true)) {
      console.log(`${GREEN}✓ Fournisseur "${name}" activé.${RESET}`)
    } else {
      console.log(`${RED}Fournisseur "${name}" introuvable.${RESET}`)
    }
    return
  }

  if (sub === 'disable') {
    const name = args.slice(1).join(' ')
    if (!name) { console.log(`${YELLOW}Usage: /providers disable <nom>${RESET}`); return }
    if (setProviderEnabled(name, false)) {
      console.log(`${GRAY}✗ Fournisseur "${name}" désactivé.${RESET}`)
    } else {
      console.log(`${RED}Fournisseur "${name}" introuvable.${RESET}`)
    }
    return
  }

  if (sub === 'keys') {
    const name = args.slice(1).join(' ')
    if (!name) { console.log(`${YELLOW}Usage: /providers keys <nom>${RESET}`); return }
    const keys = getProviderKeys(name)
    if (keys.length === 0) {
      console.log(`${YELLOW}Aucune clé pour "${name}".${RESET}`)
    } else {
      console.log(`\n${BOLD}Clés API pour ${name} (${keys.length}) :${RESET}`)
      for (let i = 0; i < keys.length; i++) {
        console.log(`  ${CYAN}${i + 1}${RESET}. ****${keys[i].slice(-4)}`)
      }
      if (keys.length > 1) console.log(`\n${GREEN}⚡ Alternateur actif : ${keys.length} clés en rotation${RESET}`)
    }
    return
  }

  if (sub === 'addkey') {
    const name = args.slice(1).join(' ')
    if (!name) { console.log(`${YELLOW}Usage: /providers addkey <nom>${RESET}`); return }
    const provider = getProvider(name)
    if (!provider) { console.log(`${RED}Provider "${name}" introuvable.${RESET}`); return }
    const key = (await rl.question(`${CYAN}Nouvelle clé API${RESET} pour ${name} ${GRAY}>${RESET} `)).trim()
    if (!key) { console.log(`${YELLOW}Annulé.${RESET}`); return }
    if (addProviderKey(name, key)) {
      const total = getProviderKeys(name).length
      console.log(`${GREEN}✓ Clé ajoutée à "${name}" (${total} clés au total)${RESET}`)
      if (total >= 2) console.log(`${GREEN}⚡ Alternateur actif : ${total} clés en rotation pour ce provider${RESET}`)
    }
    return
  }

  if (sub === 'removekey') {
    const rest = args.slice(1)
    const name = rest.slice(0, -1).join(' ')
    const keySuffix = rest[rest.length - 1]
    if (!name || !keySuffix) { console.log(`${YELLOW}Usage: /providers removekey <nom> <suffixe>${RESET}`); return }
    const keys = getProviderKeys(name)
    const match = keys.filter(k => k.endsWith(keySuffix))
    if (match.length === 0) { console.log(`${RED}Aucune clé finissant par "${keySuffix}" pour "${name}"${RESET}`); return }
    const key = match[0]
    if (removeProviderKey(name, key)) {
      console.log(`${GREEN}✓ Clé ****${key.slice(-4)} supprimée de "${name}"${RESET}`)
    }
    return
  }

  if (sub === 'key') {
    const name = args[1]
    const key = args.slice(2).join(' ')
    if (!name || !key) { console.log(`${YELLOW}Usage: /providers key <nom> <clé_api>${RESET}`); return }
    if (setProviderApiKey(name, key)) {
      console.log(`${GREEN}✓ Clé API mise à jour pour "${name}".${RESET}`)
    } else {
      console.log(`${RED}Fournisseur "${name}" introuvable.${RESET}`)
    }
    return
  }

  if (sub === 'model') {
    const name = args[1]
    const model = args.slice(2).join(' ')
    if (!name || !model) { console.log(`${YELLOW}Usage: /providers model <nom> <modèle>${RESET}`); return }
    if (setProviderDefaultModel(name, model)) {
      console.log(`${GREEN}✓ Modèle par défaut mis à jour pour "${name}" : ${model}${RESET}`)
    } else {
      console.log(`${RED}Fournisseur "${name}" introuvable.${RESET}`)
    }
    return
  }

  console.log(`${YELLOW}Sous-commandes : list, add, remove, enable, disable, key, model${RESET}`)
}

async function main() {
  // ensure default agent Alice exists in .agents/
  const existing = listLocalAgents()
  if (!existing.find(a => a.id === 'alice')) {
    try {
      scaffoldAgent('alice', 'Alice', DEFAULT_AGENT.model, DEFAULT_AGENT.toolNames, DEFAULT_AGENT.instructionsPrompt)
    } catch { /* already exists */ }
  }

  // charger l'agent depuis le fichier .agents/ pour garder la persistance
  let agent = getAgent(process.argv.slice(2))
  const localAlice = readLocalAgent('alice.ts')
  if (agent.id === 'alice' && localAlice) {
    agent = localAlice
  }
  currentEngine = createEngine({ agent })
  currentEngine.createSession()

  const COMMANDS = [
    'help', 'menu', 'start', 'create', 'edit', 'agents',
    'use', 'load', 'providers', 'providers add', 'providers list',
    'providers local', 'providers scan', 'providers keys',
    'providers addkey', 'providers enable', 'providers disable',
    'providers key', 'providers model', 'providers remove',
    'sessions', 'session', 'new', 'info', 'exit', 'quit',
  ]

  const completer = (line: string): [string[], string] => {
    const hits = COMMANDS.filter(c => c.startsWith(line.toLowerCase().replace(/^\//, ''))).map(c => '/' + c)
    return [hits.length ? hits : COMMANDS.map(c => '/' + c), line]
  }

  const rl = createInterface({ input: stdin, output: stdout, completer })

  // wrap question to handle ESC cancel
  const origQuestion = rl.question.bind(rl)
  rl.question = async (prompt: string) => {
    const answer = await origQuestion(prompt)
    if (cancelled) {
      cancelled = false
      throw new Error('CANCELLED')
    }
    return answer
  }

  rl.on('SIGINT', () => {
    cancelled = true
  })

  showMenu()

  // load skill-welcome for Alice
  const welcomeSkill = loadSkill('skill-welcome')
  if (welcomeSkill) {
    console.log(`\n${GREEN}✓ Skill "${welcomeSkill.meta.name}" chargée${RESET}`)
    console.log(`  ${GRAY}${welcomeSkill.meta.description}${RESET}\n`)
  }

  while (true) {
    try {
    // vérifier les notifications des agents en arrière-plan
    const alerts = popAllNotifications()
    for (const n of alerts) {
      console.log(`\n${YELLOW}╔══════════════════════════════════════╗${RESET}`)
      console.log(`${YELLOW}║ 🔔 Notification de ${n.from.padEnd(18)}║${RESET}`)
      console.log(`${YELLOW}╚══════════════════════════════════════╝${RESET}`)
      console.log(`  ${n.message}\n`)
    }

    const session = currentEngine!.getCurrentSession()
    const name = currentEngine!.agent.displayName.slice(0, 15)
    const prefix = GRAY + name + RESET
    let line = (await rl.question(`${prefix}> `)).trim()

    if (!line) { showMenu(); continue }

    // / tout seul → affiche le sélecteur de commandes
    if (line === '/' || line === '/?') {
      const picker: { num: number; cmd: string; label: string }[] = [
        { num: 1, cmd: '/start', label: 'Démarrer une session' },
        { num: 2, cmd: '/create', label: 'Créer un agent' },
        { num: 3, cmd: '/edit', label: 'Éditer un agent' },
        { num: 4, cmd: '/agents', label: 'Voir les agents' },
        { num: 5, cmd: '/use', label: 'Charger un agent' },
        { num: 6, cmd: '/providers', label: 'Gérer les providers' },
        { num: 7, cmd: '/providers add', label: 'Ajouter un provider' },
        { num: 8, cmd: '/providers scan', label: 'Scanner les providers locaux' },
        { num: 9, cmd: '/sessions', label: 'Voir les sessions' },
        { num: 10, cmd: '/session', label: 'Changer de session' },
        { num: 11, cmd: '/new', label: 'Nouvelle session' },
        { num: 12, cmd: '/info', label: 'Info session active' },
        { num: 13, cmd: '/help', label: 'Aide / commandes' },
        { num: 14, cmd: '/exit', label: 'Quitter' },
      ]
      console.log(`\n${BOLD}Sélecteur de commandes :${RESET}`)
      for (const p of picker) {
        console.log(`  ${CYAN}${String(p.num).padStart(2)}${RESET}. ${p.cmd}  ${GRAY}${p.label}${RESET}`)
      }
      const pick = (await rl.question(`\n${CYAN}Choix${RESET} ${GRAY}>${RESET} `)).trim()
      if (!pick) continue
      const picked = picker.find(p => p.num === parseInt(pick) || p.cmd === '/' + pick)
      if (picked) {
        // remplace line par la commande choisie et laisse le switch la traiter
        line = picked.cmd
      } else {
        console.log(`${YELLOW}Commande inconnue.${RESET}`)
        continue
      }
    }

    if (line === '1') { await handleCreate(rl); continue }
    if (line === '2') { await handleStartSession(rl); continue }
    if (line === '3') { handleListAgents(); continue }
    if (line === '4') { await handleEditAgent(rl); continue }
    if (line === '5') {
      const providers = listProviders()
      if (providers.length === 0) { console.log(`${YELLOW}Aucun fournisseur.${RESET}`); continue }
      for (const p of providers) {
        const status = p.enabled ? `${GREEN}✓${RESET}` : `${GRAY}✗${RESET}`
        console.log(`  ${status} ${CYAN}${p.name}${RESET} ${GRAY}(${p.defaultModel})${RESET}`)
      }
      console.log()
      continue
    }
    if (line === '6') { showSessions(); continue }
    if (line === '7') { showInfo(); continue }
    if (line === '8') { showHelp(); continue }
    if (line === '9') { console.log(`${GRAY}Bye.${RESET}`); rl.close(); exit(0) }

    if (line.startsWith('/')) {
      const [cmd, ...args] = line.slice(1).split(/\s+/)
      const eng = currentEngine!

      switch (cmd) {
        case 'menu': { showMenu(); break }
        case 'help': { showHelp(); break }
        case 'start': { await handleStartSession(rl); break }
        case 'edit': { await handleEditAgent(rl); break }
        case 'create': { await handleCreate(rl); break }
        case 'agents': { handleListAgents(); break }
        case 'use': { handleUseAgent(args); break }
        case 'providers': { await handleProviders(rl, args); break }
        case 'sessions': { showSessions(); break }
        case 'session': {
          const id = args[0]
          if (!id) { console.log(`${YELLOW}Usage: /session <id>${RESET}`); break }
          const found = eng.getSession(id)
          if (found) {
            eng.addMessage('user', `[switched to session ${id}]`)
            console.log(`${GREEN}Session → ${id}${RESET}`)
          } else {
            const partial = eng.listSessions().find(s => s.id.startsWith(id))
            if (partial) {
              eng.addMessage('user', `[switched to session ${partial.id}]`)
              console.log(`${GREEN}Session → ${partial.id}${RESET}`)
            } else {
              console.log(`${RED}Session introuvable.${RESET}`)
            }
          }
          break
        }
        case 'new': {
          eng.createSession()
          console.log(`${GREEN}Session créée : ${eng.getCurrentSession()?.id}${RESET}`)
          break
        }
        case 'info': { showInfo(); break }
        case 'skills': {
          if (args[0] === 'load') {
            const skillName = args.slice(1).join(' ')
            if (!skillName) { console.log(`${YELLOW}Usage: /skills load <nom>${RESET}`); break }
            const skill = loadSkill(skillName)
            if (!skill) { console.log(`${RED}Skill "${skillName}" introuvable.${RESET}`); break }
            console.log(`\n${BOLD}${CYAN}┌─ Skill : ${skill.meta.name} ─────────────────────┐${RESET}`)
            console.log(`${GRAY}${skill.meta.description}${RESET}`)
            console.log(`${BOLD}${CYAN}└────────────────────────────────────────────┘${RESET}\n`)
            const body = skill.content.replace(/---[\s\S]*?---\n/, '').trim()
            console.log(`${body}\n`)
            eng.addMessage('assistant', `[Skill "${skillName}" loaded]`)
          } else {
            const all = listSkills()
            if (all.length === 0) {
              console.log(`${YELLOW}Aucune skill disponible.${RESET}`)
            } else {
              console.log(`\n${BOLD}Skills disponibles (${all.length}) :${RESET}`)
              for (const s of all) {
                console.log(`  ${CYAN}${s.name}${RESET}  ${GRAY}${s.description}${RESET}`)
              }
              console.log(`\n${YELLOW}Utilise /skills load <nom> pour charger une skill.${RESET}\n`)
            }
          }
          break
        }
        case 'ps': {
          if (backgroundAgents.size === 0) {
            console.log(`${YELLOW}Aucun agent en arrière-plan.${RESET}`)
          } else {
            console.log(`\n${BOLD}Agents en arrière-plan :${RESET}`)
            for (const [name, proc] of backgroundAgents) {
              const alive = proc.exitCode === null
              console.log(`  ${alive ? `${GREEN}▶` : `${RED}■`}${RESET} ${CYAN}${name}${RESET} ${alive ? `PID: ${proc.pid}` : 'terminé'}`)
            }
          }
          break
        }
        case 'kill': {
          const target = args[0]
          if (!target) {
            console.log(`${YELLOW}Usage: /kill <nom> (ex: /kill timer-man)${RESET}`)
            break
          }
          const proc = backgroundAgents.get(target)
          if (!proc) {
            console.log(`${RED}Aucun agent "${target}" en cours.${RESET}`)
            break
          }
          const pidFile = join(process.cwd(), '.timer-agent.pid')
          if (existsSync(pidFile)) unlinkSync(pidFile)
          proc.kill('SIGTERM')
          backgroundAgents.delete(target)
          console.log(`${GREEN}✓ "${target}" arrêté${RESET}`)
          break
        }
        case 'logbook': {
          const lbPath = join(process.cwd(), 'agent-logbook.md')
          if (!existsSync(lbPath)) {
            console.log(`${YELLOW}Aucune entrée dans le logbook.${RESET}`)
          } else {
            const content = readFileSync(lbPath, 'utf-8').trim()
            const entries = content.split('\n## ').filter(Boolean)
            const count = entries.length
            console.log(`\n${BOLD}Agent Logbook (${count} entrée(s)) :${RESET}\n`)
            // show last 3 entries
            const recent = entries.slice(-3)
            for (const e of recent) {
              const title = e.split('\n')[0]
              console.log(`  ${CYAN}▶${RESET} ${title}${GRAY}...${RESET}`)
            }
            if (count > 3) console.log(`  ${GRAY}... et ${count - 3} entrée(s) plus ancienne(s)${RESET}`)
            console.log(`\n${YELLOW}Fichier : ${lbPath}${RESET}\n`)
          }
          break
        }
        case 'load': {
          const path = args.join(' ')
          if (!path) { console.log(`${YELLOW}Usage: /load <path>${RESET}`); break }
          try {
            const newAgent = loadAgentFromFile(path)
            currentEngine = createEngine({ agent: newAgent })
            currentEngine.createSession()
            console.log(`${GREEN}Agent chargé : ${newAgent.name}${RESET}`)
          } catch (err) {
            console.log(`${RED}Erreur : ${(err as Error).message}${RESET}`)
          }
          break
        }
        case 'exit':
        case 'quit': {
          console.log(`${GRAY}Bye.${RESET}`)
          rl.close()
          exit(0)
        }
        default: {
          console.log(`${YELLOW}Commande inconnue : /${cmd}. Tapez /menu ou 1-7.${RESET}`)
        }
      }
      continue
    }

    // If user mentions "timer-man" in natural language, convert to !spawn command
    if (line.toLowerCase().includes('timer-man') && !line.startsWith('!')) {
      const match = line.match(/(\d+)\s*(min|m|minute|sec|s)/i)
      const interval = match ? match[1] + (match[2]?.startsWith('s') ? 's' : 'm') : '1h'
      line = `!spawn timer-man ${interval}`
    }

    const isCommand = line.startsWith('!')
    const isAssistantMsg = line.startsWith('@')

    // shell commands and assistant messages use the existing runPrompt
    if (isCommand || isAssistantMsg) {
      // special: !spawn <agent-id> <instruction>
      if (line.startsWith('!spawn ')) {
        const rest = line.slice(7).trim()
        const spaceIdx = rest.indexOf(' ')
        if (spaceIdx === -1) {
          console.log(`${YELLOW}Usage: !spawn <agent-id> <instruction>${RESET}`)
          continue
        }
        const targetAgent = rest.slice(0, spaceIdx)
        const instruction = rest.slice(spaceIdx + 1)

        // timer-man est un agent long-running (daemon)
        if (targetAgent === 'timer-man') {
          const logPath = join(process.cwd(), 'logs', 'timer-man.log')
          if (!existsSync(join(process.cwd(), 'logs'))) {
            const { mkdirSync } = await import('fs')
            mkdirSync(join(process.cwd(), 'logs'), { recursive: true })
          }
          const outFd = openSync(logPath, 'a')
          console.log(`\n${YELLOW}⟳ Démarrage de "${targetAgent}" en arrière-plan...${RESET}`)
const child = fork(join(import.meta.dirname, 'timer-agent.js'), [instruction || '1h'], {
             stdio: ['ignore', outFd, outFd, 'ipc'],
            detached: false,
          })
          backgroundAgents.set('timer-man', child)
          child.on('exit', (code) => {
            backgroundAgents.delete('timer-man')
            if (code !== 0) console.log(`\n${YELLOW}⏹ Timer arrêté (code: ${code})${RESET}\n`)
          })
          console.log(`${GREEN}✓ Timer lancé (PID: ${child.pid})${RESET}`)
          console.log(`${GRAY}   Intervalle : ${instruction || '1h'}${RESET}`)
          console.log(`${GRAY}   Logs : ${logPath}${RESET}`)
          console.log(`${GRAY}   /kill timer-man pour arrêter${RESET}\n`)
          continue
        }

        // agents standard (one-shot)
        console.log(`\n${YELLOW}⟳ Spawn de "${targetAgent}"...${RESET}`)
        const child = fork(join(import.meta.dirname, 'spawn-agent.js'), [targetAgent, instruction], { stdio: 'pipe' })
        let output = ''
        child.stdout?.on('data', (d: Buffer) => { output += d.toString() })
        child.stderr?.on('data', (d: Buffer) => { output += `${RED}${d.toString()}${RESET}` })
        await new Promise<void>(resolve => { child.on('exit', () => resolve()) })
        console.log(`${GREEN}✓ Agent "${targetAgent}" terminé${RESET}`)
        if (output.trim()) console.log(`\n${output.trim()}\n`)
        console.log(`${GRAY}   Voir agent-logbook.md pour tous les détails.${RESET}\n`)
        continue
      }

      const result = await currentEngine!.runPrompt(line)
      for (const tc of result.toolCalls) {
        switch (tc.toolName) {
          case 'run_terminal_command': {
            const inp = tc.input as { command: string }
            console.log(`${GRAY}$ ${inp.command}${RESET}`)
            break
          }
          case 'add_message': {
            const inp = tc.input as { role: string; content: string }
            console.log(`${CYAN}@ ${inp.content}${RESET}`)
            break
          }
        }
      }
      if (result.response) console.log(`${result.response}\n`)
      continue
    }

    // plain text → call the LLM
    const eng = currentEngine!
    const resolved = resolveProviderForModel(eng.agent.model)
    if (!resolved) {
      console.log(`\n${YELLOW}⚠ Alice n'est pas encore connectée à un fournisseur LLM.${RESET}`)
      console.log(`   ${CYAN}1.${RESET} Configure un provider avec ${GREEN}/providers add${RESET} ou ${GREEN}/providers scan${RESET}`)
      console.log(`   ${CYAN}2.${RESET} Assure-toi que le provider a une clé API valide`)
      console.log(`   ${CYAN}3.${RESET} Modèle actuel : ${GRAY}${eng.agent.model}${RESET}`)
      console.log(`   ${CYAN}4.${RESET} Utilise !cmd pour les commandes shell en attendant\n`)
      continue
    }

    const systemPrompt = eng.agent.instructionsPrompt || 'You are a helpful assistant.'
    process.stdout.write(`\n${YELLOW}⟳${RESET} ${GRAY}${resolved.provider} / ${resolved.model}${RESET} `)
    try {
      const llmResponse = await eng.callLLM(line, resolved, systemPrompt)
      process.stdout.write(`\r${GREEN}✓${RESET}\n`)
      eng.addMessage('assistant', llmResponse)
      console.log(`\n${llmResponse}\n`)
    } catch (err) {
      process.stdout.write(`\r${RED}✗${RESET}\n`)
      const msg = (err as Error).message
      console.log(`\n${RED}Erreur LLM :${RESET} ${msg.slice(0, 200)}\n`)
      if (msg.includes('401') || msg.includes('403') || msg.includes('API key')) {
        console.log(`   ${YELLOW}→ Vérifie la clé API avec /providers key <nom> <nouvelle_clé>${RESET}\n`)
      }
    }
  } catch (e) {
    if ((e as Error).message !== 'CANCELLED') throw e
    cancelled = false
  }
  }
}

main().catch(err => {
  console.error(`${RED}Fatal error: ${err.message}${RESET}`)
  exit(1)
})
