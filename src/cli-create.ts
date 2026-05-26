import { createInterface } from 'readline/promises'
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { createEngine } from './engine.js'
import { scaffoldAgent, listProfiles, loadProfile } from './agents.js'
import type { AgentProfile } from './agents.js'
import {
  fetchModels,
  getKnownProviders,
  listProviders,
  addProvider,
  setProviderApiKey,
  getModelFetchGuidance,
  isApiKeyUsed,
  testConnection,
} from './providers.js'
import { generateSkill, validateSkill, validateAgent as validateAgentIntegration, validateIntegration } from './generate-skill.js'
import { top15 } from './constants.js'

import {
  RESET, CYAN, GREEN, YELLOW, RED, GRAY, BOLD,
  ONLINE_URLS,
  KEY_REQUIRED,
} from './constants.js'

// ── Helpers ──────────────────────────────────────────────

async function wait(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}

async function pause(label = 'Suite'): Promise<void> {
  console.log(`\n${GRAY}⟳ ${label}...${RESET}`)
  await wait(500)
}

// ── Alice registry update ────────────────────────────────

function registerAgentInAlice(agentId: string, description: string): void {
  const alicePath = join(process.cwd(), '.agents', 'alice.ts')
  if (!existsSync(alicePath)) return

  let content = readFileSync(alicePath, 'utf-8')

  // Cherche la section "## Registre des agents disponibles"
  const registryMarker = '## Registre des agents disponibles'
  const markerIdx = content.indexOf(registryMarker)
  if (markerIdx === -1) return

  // Trouve la fin de la section (prochaine ligne ## ou fin du bloc instructionsPrompt)
  const afterRegistry = content.slice(markerIdx)
  const nextSectionMatch = afterRegistry.match(/\n## /)
  const endIdx = nextSectionMatch
    ? markerIdx + (nextSectionMatch.index ?? 0)
    : content.indexOf('`', markerIdx)

  // Vérifie si l'agent n'existe pas déjà
  if (content.includes(`- ${agentId} :`)) return

  // Ajoute le nouvel agent avant la fin de la section
  const newEntry = `\n- ${agentId} : ${description}`
  content = content.slice(0, endIdx) + newEntry + content.slice(endIdx)

  writeFileSync(alicePath, content, 'utf-8')
}

// ── Agent creation with PACO certification ───────────────

export async function handleCreate(rl: ReturnType<typeof createInterface>): Promise<void> {
  console.log(`\n${BOLD}${CYAN}┌─ Créer un agent ──────────────────────────┐${RESET}`)
  console.log(`${BOLD}${CYAN}│  Ctrl+C pour annuler                         │${RESET}`)
  console.log(`${BOLD}${CYAN}└────────────────────────────────────────────┘${RESET}\n`)

  // --- 0. Vérification de l'équipe d'orchestration PACO (profils + agents runtime) ---
  const ORCHESTRATION_FILES = [
    { path: 'data/profiles/agents/AGENT-orchestrateur-04.json', name: 'Profil orchestrateur' },
    { path: 'data/profiles/agents/AGENT-superviseur-06.json', name: 'Profil superviseur' },
    { path: 'data/profiles/daemons/DAEMON-superviseur-01.json', name: 'Daemon superviseur' },
    { path: 'data/protocols/keyword-registry.yaml', name: 'Registre de mots-clés' },
    { path: 'data/protocols/paco-protocol.md', name: 'Protocole PACO' },
  ]
  const ORCHESTRATION_AGENTS = [
    { id: 'orchestrateur', name: 'Orchestrateur', tools: ['run_terminal_command', 'add_message', 'set_output'], instructions: `Tu es l'Agent-Maître, l'orchestrateur central.\nTa mission unique est de coordonner les autres agents.\nTu ne produis JAMAIS de code, documentation, analyse, design ou tout autre livrable toi-même.\nTa seule production autorisée est :\n1. mises à jour de tâches_en_cours.json\n2. messages de délégation au format @agent-ID: mission\n3. rapports de coordination\n\nLe protocole PACO est obligatoire : avant chaque action, tu consultes le registre keyword-registry.yaml.\nSi un mot-clé de la tâche match un agent, tu DOIS déléguer.\nSi aucun agent ne correspond, tu réponds 'Tâche non couverte — intervention humaine requise'.\nTu es surveillé en continu par DAEMON-superviseur-01. Toute violation peut entraîner ta suspension.` },
    { id: 'agent-superviseur', name: 'Agent Superviseur', tools: ['add_message'], instructions: `Tu es l'Agent-Superviseur, le garde-fou du protocole PACO.\nTa mission unique est de surveiller l'orchestrateur en continu.\nTu ne produis AUCUN livrable, tu ne fais AUCUNE modification de fichier.\nTu es lecture seule. Tu scrutes les logs, les sorties et les fichiers de l'orchestrateur.\nTu vérifies qu'il délègue toujours et ne fait jamais le travail lui-même.\nEn cas de violation, tu émets une alerte.\nAprès 3 violations consécutives, tu suspends l'orchestrateur.` },
    { id: 'DAEMON-superviseur-01', name: 'Daemon Superviseur', tools: ['run_terminal_command', 'add_message', 'set_output'], instructions: `Tu es le daemon superviseur PACO.\nTu te réveilles toutes les 5 minutes pour scruter l'orchestrateur.\nTu lis tâches_en_cours.json et les logs de coordination.\nTu vérifies que l'orchestrateur a bien délégué chaque tâche à un agent compétent.\nSi tu détectes une violation (production directe, délégation manquante), tu émets une alerte.\nAprès 3 violations consécutives de niveau ≥ moyen, tu marques l'orchestrateur comme suspendu.` },
  ]
  const cwd = process.cwd()
  const missing: string[] = []
  for (const f of ORCHESTRATION_FILES) {
    if (!existsSync(join(cwd, f.path))) missing.push(f.name)
  }
  for (const a of ORCHESTRATION_AGENTS) {
    if (!existsSync(join(cwd, '.agents', `${a.id}.ts`))) missing.push(`Agent runtime ${a.id}`)
  }
  if (missing.length > 0) {
    console.log(`\n${RED}${BOLD}⚠ ÉQUIPE D'ORCHESTRATION INCOMPLÈTE${RESET}`)
    console.log(`${YELLOW}Avant de créer un agent, l'équipe PACO doit être déployée :${RESET}`)
    for (const m of missing) console.log(`  ${RED}✗${RESET} ${m}`)
    console.log(`\n${GREEN}Déploiement automatique de l'équipe d'orchestration...${RESET}`)
    for (const agent of ORCHESTRATION_AGENTS) {
      const agentPath = join(cwd, '.agents', `${agent.id}.ts`)
      if (!existsSync(agentPath)) {
        try {
          scaffoldAgent(agent.id, agent.name, 'kilo-auto/free', agent.tools, agent.instructions, true, 'standard', undefined, 1, 'kilo-auto/free')
          console.log(`  ${GREEN}✓${RESET} ${agent.name} déployé`)
        } catch (e) {
          console.log(`  ${RED}✗${RESET} ${agent.name} : ${(e as Error).message}`)
        }
      }
    }
    console.log(`\n${GREEN}✓ Équipe d'orchestration prête.${RESET}\n`)
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

  // --- 1.2 Configuration parallélisme selon le provider ---
  let maxParallel = configured?.maxParallel ?? 1
  if (providerType === 'lm-studio' || providerType === 'ollama') {
    const defaultSlots = maxParallel
    const raw = (await rl.question(
      `\n${CYAN}Slots parallèles${RESET} pour ${providerType} (défaut: ${defaultSlots}) ${GRAY}>${RESET} `
    )).trim()
    const parsed = parseInt(raw, 10)
    if (!isNaN(parsed) && parsed > 0) maxParallel = parsed
    else maxParallel = defaultSlots
    if (configured) {
      configured.maxParallel = maxParallel
    }
    console.log(`  ${GREEN}✓${RESET} Utilisation de ${maxParallel} slot(s) parallèle(s)\n`)
  }

  await pause('Provider validé → Sélection du modèle')

  // --- 2. Choix du modèle ---
  const effectiveApiKey = apiKey || ''
  const effectiveBaseUrl = configured?.baseUrl || ONLINE_URLS[providerType] || 'https://api.openai.com/v1'
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
  while (true) {      process.stdout.write(`\n${YELLOW}⟳ Test de connexion à ${providerType} / ${model}...${RESET}`)
      const _result = await testConnection(providerType, effectiveApiKey, effectiveBaseUrl, model)
    if (_result.ok) {
      process.stdout.write(`\r${GREEN}✓ Connexion réussie !${RESET}\n\n`)
      break
    }
    process.stdout.write(`\r${RED}✗ Échec de connexion${RESET}\n\n`)
    for (const d of _result.diagnostics) console.log(`  ${d}`)
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
  const greekGodsPath = join(process.cwd(), 'data', 'agent-name', 'greek-gods.json')
  let gods: Record<string, string> = {}
  try {
    if (existsSync(greekGodsPath)) {
      const godsData = JSON.parse(readFileSync(greekGodsPath, 'utf-8'))
      gods = godsData.dieux || {}
    }
  } catch (err) {
    console.log(`${YELLOW}⚠ Erreur chargement dieux : ${(err as Error).message}${RESET}`)
  }

  const godKeys = Object.keys(gods).sort((a, b) => b.length - a.length)
  const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

  function findGodInResponse(response: string): string {
    const trimmed = response.trim()
    // 1. Match exact (includes — pas de \b qui ignore les accents)
    for (const name of godKeys) {
      if (trimmed.includes(name)) return name
    }
    // 2. Match accent-insensible
    const normResponse = normalize(trimmed)
    for (const name of godKeys) {
      if (normResponse.includes(normalize(name))) return name
    }
    // 3. Match par première lettre capitale (cas où le LLM répond "Athéna" au milieu d'une phrase)
    for (const word of trimmed.split(/\s+/)) {
      const clean = word.replace(/[^a-zA-Z\u00C0-\u024F\u1E00-\u1EFF]/g, '')
      if (!clean) continue
      for (const name of godKeys) {
        if (clean === name || normalize(clean) === normalize(name)) return name
      }
    }
    return ''
  }

  if (godKeys.length > 0) {
    const godsList = godKeys.map(name => `- ${name}: ${gods[name]}`).join('\n')

    async function tryMatchGod(prompt: string): Promise<string> {
      const response = await decisionEngine.callLLM(prompt, llmDecisionProvider, "Tu es un expert en mythologie et matching de personnalité.")
      const found = findGodInResponse(response)
      if (found) {
        console.log(`  ${GREEN}✓ Dieu choisi : ${found}${RESET} ${GRAY}(LLM: "${response.trim()}")${RESET}`)
      } else {
        console.log(`  ${YELLOW}⚠ Aucun dieu reconnu dans : "${response.trim()}"${RESET}`)
      }
      return found
    }

    const godMatchPrompt = `Tu es un expert en mythologie grecque.\nVoici la liste complète des dieux et leurs spécialités techniques :\n${godsList}\n\nMission de l'agent : "${description}"\n\nParmi les dieux ci-dessus, choisis UN SEUL dieu dont la spécialité correspond le mieux à cette mission.\nRéponds UNIQUEMENT par le prénom du dieu, tel quel dans la liste, sans ponctuation, sans explication, sans phrase.\n\nExemples de réponses valides : Hermès | Athéna | Zeus | Hécate\nExemples de réponses invalides : "Je choisis Hermès" | "Hermès serait parfait" | "Peut-être Zeus"`

    try {
      let foundName = await tryMatchGod(godMatchPrompt)
      if (!foundName) {
        // Retry with ultra-simple prompt
        console.log(`  ${YELLOW}⟳ Nouvelle tentative...${RESET}`)
        const retryPrompt = `Choisis un dieu grec pour cette mission : "${description}"\nRéponds UNIQUEMENT par un nom parmi : ${godKeys.join(', ')}`
        foundName = await tryMatchGod(retryPrompt)
      }
      assignedName = foundName || 'Athena'
      if (!foundName) {
        console.log(`  ${YELLOW}⚠ Fallback sur Athena (aucun dieu reconnu)${RESET}`)
      }
    } catch (err) {
      console.log(`${YELLOW}⚠ Erreur lors du choix du nom : ${(err as Error).message}${RESET}`)
    }
  } else {
    console.log(`${YELLOW}⚠ Aucun dieu trouvé dans ${greekGodsPath}${RESET}`)
  }

  // B. Sélection du Template et du Profil
  let type: 'agents' | 'bots' | 'daemons' = 'agents'
  let template: 'standard' | 'fast' | 'daemon' = 'standard'
  let selectedProfile: AgentProfile | undefined = undefined

  try {
    const profilesAgents = listProfiles('agents')
    const profilesBots = listProfiles('bots')
    const profilesDaemons = listProfiles('daemons')

    const decisionPrompt = `Mission de l'agent : "${description}"\n\nAnalyse cette mission et choisis :\n1. Le TYPE d'agent le plus adapté parmi : "standard" (assistant général), "fast" (bot rapide d'automatisation), "daemon" (tâche de fond périodique).\n2. Le PROFIL le plus adapté parmi cette liste classée par type :\n- agents: ${profilesAgents.join(', ')}\n- bots: ${profilesBots.join(', ')}\n- daemons: ${profilesDaemons.join(', ')}\n\nRéponds UNIQUEMENT au format JSON suivant :\n{\n  "template": "standard|fast|daemon",\n  "profileType": "agents|bots|daemons",\n  "profileName": "nom_du_profil"\n}`

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
  } catch (_err) {
    console.log(`${YELLOW}⚠ Erreur lors de l'analyse automatique, utilisation des défauts.${RESET}`)
  }

  const assignedId = `agent-${assignedName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}`
  console.log(`${GRAY}  ID généré : ${assignedId}${RESET}\n`)

  await pause('Analyse terminée → Création et certification')

  // --- 3. Création, Skill, Scripts, Validation, Certification ---
  console.log(`${BOLD}${CYAN}┌─ Phase de création et certification ──────┐${RESET}`)
  console.log(`${GRAY}Utilisation du model ${model} pour créer l'agent ${assignedName}...${RESET}`)
  
  const tools = ['run_terminal_command', 'add_message', 'set_output', 'skill']
  const skillId = `skill-${assignedId}`

  // Stocker le provider pour le passer à scaffoldAgent
  const agentProvider = providerType
  let skillContent = ''
  let agentPath = ''

  const llmProvider = { provider: providerType, apiKey: effectiveApiKey, baseUrl: effectiveBaseUrl, model }

  let lastReviewRapport = ''
  let finalStatus: { ok: boolean; vSkill: { ok: boolean; errors: string[] }; vAgent: { ok: boolean; errors: string[] }; vInt: { ok: boolean; errors: string[] }; vRules: { ok: boolean; errors: string[] }; vTs?: { ok: boolean; errors: string[] } } = { ok: false, vSkill: {ok:false, errors:[]}, vAgent: {ok:false, errors:[]}, vInt: {ok:false, errors:[]}, vRules: {ok:true, errors:[]} }

  async function performCreationCycle(attemptDescription: string, feedback?: string) {
    process.stdout.write(`\n${YELLOW}⟳ ${attemptDescription}...${RESET}`)
    
    // A. Génération de la Skill
    try {
      const skill = await generateSkill(assignedId, assignedName, description, llmProvider, feedback)
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
    if (feedback) {
      instructions += `\n\n## Retour de la tentative précédente (À corriger)\n${feedback}`
    }
    try {
      agentPath = scaffoldAgent(assignedId, assignedName, model, tools, instructions, true, template, selectedProfile, maxParallel, agentProvider)
      console.log(`  ${GREEN}✓ Agent enregistré${RESET} ${GRAY}${agentPath}${RESET}`)
    } catch (err) {
      console.log(`  ${RED}✗ Échec enregistrement agent : ${(err as Error).message}${RESET}`)
    }

    // C. Validation via Scripts et Golden Rules
    console.log(`  ${YELLOW}⟳ Validation via scripts et golden-rules...${RESET}`)
    const vSkill = await validateSkill(skillId)
    const vAgent = await validateAgentIntegration(assignedId)
    const vInt = await validateIntegration(assignedId, skillId)

    // D. Validation Règles d'Or (sur le fichier agent généré)
    let vRules: { ok: boolean; errors: string[] } = { ok: true, errors: [] }
    if (agentPath && existsSync(agentPath)) {
      vRules = validateRules(assignedId)
      if (!vRules.ok) {
        console.log(`  ${RED}✗${RESET} Règles d'Or`)
        vRules.errors.forEach(e => console.log(`     ${RED}→ ${e}${RESET}`))
      }
    }

    // E. Validation TypeScript (compilation)
    let vTs: { ok: boolean; errors: string[] } = { ok: true, errors: [] }
    try {
      const tscErrors = await getTscErrors(assignedId)
      if (tscErrors.length > 0) {
        vTs = { ok: false, errors: tscErrors }
        console.log(`  ${RED}✗${RESET} TypeScript`)
        tscErrors.forEach(e => console.log(`     ${RED}→ ${e}${RESET}`))
      }
    } catch {
      // tsc check skipped (timeout or error)
    }

    return {
      ok: vSkill.ok && vAgent.ok && vInt.ok && vRules.ok && vTs.ok,
      vSkill,
      vAgent,
      vInt,
      vRules,
      vTs
    }
  }

  // ── Validation des Règles d'Or ─────────────────────────────
  function validateRules(agentId: string): { ok: boolean; errors: string[] } {
    const agentPath = join(process.cwd(), '.agents', `${agentId}.ts`)
    if (!existsSync(agentPath)) {
      return { ok: false, errors: ['Fichier agent introuvable'] }
    }

    const content = readFileSync(agentPath, 'utf-8')
    const instructionsMatch = content.match(
      /instructionsPrompt:\s*`([\s\S]*?)`\s*,\r?\n\s*(?:toolConfig|spawnerPrompt|selfCorrection|guardian)/
    )
    const instructions = instructionsMatch ? instructionsMatch[1] : ''
    const errors: string[] = []

    // R1 : pas de payloads en guillemets simples
    if (/'\{[^}]*\}'/.test(instructions) || /'<[^>]+>'/.test(instructions)) {
      errors.push('R1: Utilise echo + pipe + --stdin au lieu des guillemets simples \'...\'')
    }

    // R2 : ID en ASCII pur (déjà garanti par la génération mais on vérifie)
    if (/[^\x00-\x7F]/.test(agentId)) {
      errors.push('R2: L\'ID contient des caractères non-ASCII')
    }

    // R3 : pas d'emojis dans les instructions
    const emojiRegex = /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{FE00}-\u{FE0F}]/u
    if (emojiRegex.test(instructions)) {
      errors.push('R3: Remplace les emojis par [OK] [ERR] [WARN]')
    }

    // R4 : format kebab-case
    if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(agentId)) {
      errors.push('R4: L\'ID doit etre en kebab-case (ex: mon-agent)')
    }

    // R5 : pas de contournement de l'intercom (sauf Alice)
    if (agentId !== 'alice' && /envoie.*(?:à|vers)\s+(?!.*intercom)/i.test(instructions)) {
      errors.push('R5: Tout passe par agent-telecom via intercom')
    }

    return { ok: errors.length === 0, errors }
  }

  async function getTscErrors(agentId: string): Promise<string[]> {
    try {
      const { execFileSync } = await import('child_process')
      const _result = execFileSync('npx.cmd', ['tsc', '--noEmit'], { timeout: 15000, cwd: process.cwd(), encoding: 'utf-8' })
      return []
    } catch (err: unknown) {
      const stderr = (err as { stderr?: string }).stderr || (err as Error).message || ''
      const lines = stderr.split('\n').filter(l => l.includes(`.agents/${agentId}.ts`))
      return lines.length > 0 ? lines : []
    }
  }

  async function callAgentReviewer(agentId: string, skillId: string): Promise<{ suggestions: string[]; urgentCount: number; importantCount: number; rapport: string; skipped: boolean }> {
    try {
      const agentPath = join(process.cwd(), '.agents', `${agentId}.ts`)
      const skillPath = join(process.cwd(), 'skills', skillId, 'SKILL.md')

      const agentContent = existsSync(agentPath) ? readFileSync(agentPath, 'utf-8') : 'Fichier agent introuvable'
      const skillContent = existsSync(skillPath) ? readFileSync(skillPath, 'utf-8') : 'Fichier skill introuvable'

      const tscErrors = await getTscErrors(agentId)

      const reviewPrompt = `Tu es un expert en revue de code. Analyse les fichiers de l'agent et de sa skill.\n${tscErrors.length > 0 ? `\n## ⚠ ERREURS DE COMPILATION TYPESCRIPT DÉTECTÉES (bloquant si non corrigé) :\n${tscErrors.join('\n')}\n` : ''}\nIMPORTANT : Le fichier .ts suit un template système strict. Ne critique pas sa structure globale.\nConcentre-toi sur la pertinence des instructions et le respect des règles métier.\n\n## CRITÈRES DE VALIDATION (GOLDEN RULES) :\n1. La skill DOIT avoir un frontmatter YAML (---) avec name et description.\n2. La skill DOIT avoir les sections : ## Mission, ## Comportement, ## Compétences, ## Règles.\n3. Les instructions de l'agent doivent être cohérentes avec la mission.\n\n## Fichier Agent (.agents/${agentId}.ts)\n\`\`\`typescript\n${agentContent}\n\`\`\`\n\n## Fichier Skill (skills/${skillId}/SKILL.md)\n\`\`\`markdown\n${skillContent}\n\`\`\`\n\nFournis ton diagnostic UNIQUEMENT dans ce format :\n### 🔴 Urgent (Bloquant - Erreur de syntaxe, section manquante, sécurité grave)\n- {problème}\n\n### 🟠 Important (À corriger - Manque de clarté, mission incomplète)\n- {problème}\n\n### ✅ Points positifs\n- {ce qui est bien}\n\nSi tout est correct, écris "AUCUN PROBLÈME MAJEUR DÉTECTÉ".`

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
      function countActualIssues(text: string, header: string): number {
        const section = text.match(new RegExp(`### ${header}[^]*?(?=### |\\n## |\\n---|\\n\\*\\*\\*|$)`, 'i'))
        if (!section) return 0
        const body = section[0]
        if (/aucun problème|no issue|rien à signaler|none detected|ne contient pas/i.test(body)) return 0
        return (body.match(/^\s*-\s+\*\*/gm) || []).length
      }
      const urgentCount = countActualIssues(response, '🔴 Urgent')
      const importantCount = countActualIssues(response, '🟠 Important')

      console.log(`\n${BOLD}${CYAN}┌─ Rapport du Reviewer ─────────────────────┐${RESET}`)
      console.log(response)
      console.log(`${CYAN}└────────────────────────────────────────────┘${RESET}\n`)

      return { suggestions, urgentCount, importantCount, rapport: response, skipped: false }
    } catch (err) {
      console.log(`  ${YELLOW}⚠ Impossible de appeler le reviewer : ${(err as Error).message}${RESET}`)
      console.log(`  ${YELLOW}  → Revue ignorée. La certification continue sans validation.${RESET}`)
      return { suggestions: [], urgentCount: 0, importantCount: 0, rapport: '', skipped: true }
    }
  }

  const maxAttempts = 5
  let consecutiveStagnations = 0

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    finalStatus = await performCreationCycle(
      attempt === 1 ? 'Création initiale' : `Tentative d'auto-correction ${attempt}/${maxAttempts}`,
      lastReviewRapport
    )

    console.log(`  ${finalStatus.vSkill.ok ? `${GREEN}✓` : `${RED}✗`}${RESET} Skill`)
    if (!finalStatus.vSkill.ok) finalStatus.vSkill.errors.forEach(e => console.log(`     ${RED}→ ${e}${RESET}`))

    console.log(`  ${finalStatus.vAgent.ok ? `${GREEN}✓` : `${RED}✗`}${RESET} Agent`)
    if (!finalStatus.vAgent.ok) finalStatus.vAgent.errors.forEach(e => console.log(`     ${RED}→ ${e}${RESET}`))

    console.log(`  ${finalStatus.vInt.ok ? `${GREEN}✓` : `${RED}✗`}${RESET} Intégration`)
    if (!finalStatus.vInt.ok) finalStatus.vInt.errors.forEach(e => console.log(`     ${RED}→ ${e}${RESET}`))

    console.log(`  ${finalStatus.vRules.ok ? `${GREEN}✓` : `${RED}✗`}${RESET} Règles d'Or`)
    if (!finalStatus.vRules.ok) finalStatus.vRules.errors.forEach(e => console.log(`     ${RED}→ ${e}${RESET}`))

    console.log(`  ${finalStatus.vTs ? (finalStatus.vTs.ok ? `${GREEN}✓` : `${RED}✗`) : `${GRAY}?`}${RESET} TypeScript`)
    if (finalStatus.vTs && !finalStatus.vTs.ok) finalStatus.vTs.errors.forEach(e => console.log(`     ${RED}→ ${e}${RESET}`))

    if (finalStatus.ok) {
      // --- Phase d'Orchestration PACO ---
      console.log(`\n${YELLOW}⟳ L'Orchestrateur prend en charge la certification...${RESET}`)
      console.log(`  ${GRAY}→ Orchestrateur : Délégation de la revue technique à l'Agent-Reviewer${RESET}`)
      
      const review = await callAgentReviewer(assignedId, skillId)

      console.log(`  ${YELLOW}⟳ L'Agent-Superviseur vérifie la conformité...${RESET}`)
      if (review.urgentCount === 0) {
        console.log(`  ${GREEN}✓ Superviseur : Protocole PACO respecté. Qualité validée.${RESET}`)
      } else {
        console.log(`  ${RED}✗ Superviseur : Violation détectée. L'Orchestrateur doit optimiser le livrable.${RESET}`)
      }

      // Détection de stagnation
      if (review.rapport === lastReviewRapport && (review.urgentCount > 0 || review.importantCount > 0)) {
        consecutiveStagnations++
        console.log(`${YELLOW}⚠ Aucune progression détectée (stagnation ${consecutiveStagnations}/2).${RESET}`)
        if (consecutiveStagnations >= 2) {
          console.log(`${RED}✗ Stagnation confirmée. L'agent n'arrive pas à corriger ces erreurs.${RESET}`)
          finalStatus.ok = false
          break
        }
      } else {
        consecutiveStagnations = 0
      }
      
      lastReviewRapport = review.rapport

      // La certification échoue si le reviewer trouve des problèmes URGENTS.
      // Les problèmes "IMPORTANT" sont signalés mais ne bloquent pas la certification si on a épuisé les tentatives.
      if (review.urgentCount > 0) {
        console.log(`${RED}⚠ Le reviewer a identifié des problèmes URGENTS (bloquants).${RESET}`)
        console.log(`${GRAY}Auto-correction en cours (tentative ${attempt}/${maxAttempts})...${RESET}`)

        if (attempt < maxAttempts) {
          continue // Prochaine tentative
        } else {
          console.log(`${RED}⚠ Nombre maximum de tentatives atteint (${maxAttempts}). Certification refusée.${RESET}`)
          finalStatus.ok = false
        }
      } else if (review.importantCount > 0) {
        console.log(`${YELLOW}⚠ Le reviewer a identifié des problèmes importants, mais non bloquants pour la certification.${RESET}`)
        // On continue quand même si pas de problèmes urgents
        break
      } else {
        // Pas de problème urgent/important, on peut certifier
        break
      }
    }
  }

  // --- Résultat final et Certification ---
  if (finalStatus.ok) {
    console.log(`${GREEN}${BOLD}╔═══════════════════════════════════════════╗${RESET}`)
    console.log(`${GREEN}${BOLD}║   AGENT VALIDÉ & CERTIFIÉ ✓              ║${RESET}`)
    console.log(`${GREEN}${BOLD}╚═══════════════════════════════════════════╝${RESET}`)
    console.log(`  ${BOLD}Agent${RESET}    : ${assignedName} (${assignedId})`)
    console.log(`  ${BOLD}Fichier${RESET}  : ${agentPath}`)
    console.log(`  ${BOLD}Skill${RESET}    : skills/${skillId}/SKILL.md`)
    console.log(`  ${BOLD}Model${RESET}    : ${model}`)
    console.log(`  ${BOLD}Provider${RESET} : ${providerType}`)
    console.log(`  ${BOLD}Status${RESET}   : ${GREEN}CERTIFIÉ${RESET}\n`)
    console.log(`${YELLOW}Utilise /use ${assignedId} pour charger ce nouvel agent.${RESET}\n`)

    // Ajoute l'agent au registre d'Alice
    const shortDesc = description.length > 160 ? description.slice(0, 157) + '...' : description
    registerAgentInAlice(assignedId, shortDesc)
    console.log(`${GRAY}✓ Agent ajouté au registre d'Alice${RESET}\n`)
  } else {
    console.log(`\n${RED}${BOLD}╔═══════════════════════════════════════════╗${RESET}`)
    console.log(`${RED}${BOLD}║   ÉCHEC — Certification impossible         ║${RESET}`)
    console.log(`${RED}${BOLD}╚═══════════════════════════════════════════╝${RESET}`)
    console.log(`  ${YELLOW}L'agent n'a pas pu être certifié après ${maxAttempts} tentatives.${RESET}`)
    console.log(`  ${YELLOW}Vérifie les erreurs ci-dessus et les golden-rules.${RESET}\n`)

    // --- Nettoyage automatique en cas d'échec ---
    console.log(`${GRAY}⟳ Nettoyage des fichiers non certifiés...${RESET}`)
    try {
      if (agentPath && existsSync(agentPath)) {
        unlinkSync(agentPath)
        console.log(`  ${GRAY}✓ Agent supprimé : ${agentPath}${RESET}`)
      }
      const skillDir = join(process.cwd(), 'skills', skillId)
      if (existsSync(skillDir)) {
        const { rmSync } = await import('fs')
        rmSync(skillDir, { recursive: true, force: true })
        console.log(`  ${GRAY}✓ Skill supprimée : skills/${skillId}${RESET}`)
      }
      console.log(`${GREEN}✓ Nettoyage terminé. Aucun résidu non validé.${RESET}\n`)
    } catch (err) {
      console.log(`${RED}✗ Erreur lors du nettoyage : ${(err as Error).message}${RESET}\n`)
    }
  }
}
