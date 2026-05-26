import { createInterface } from 'readline/promises'
import { createEngine, type Engine } from './engine.js'
import type { ToolConfig } from './types/agent-definition.js'
import { listLocalAgents, readLocalAgent, updateAgentFile } from './agents.js'
import {
  listProviders,
  getKnownProviders,
  setProviderApiKey,
  setProviderEnabled,
  fetchModels,
  getModelFetchGuidance,
  resolveProviderForModel,
  testConnection,
} from './providers.js'
import { top15 } from './constants.js'
import { RESET, CYAN, GREEN, YELLOW, RED, GRAY, BOLD, ONLINE_URLS, KEY_REQUIRED } from './constants.js'

// ── Edit agent ───────────────────────────────────────────

export async function handleEditAgent(
  rl: ReturnType<typeof createInterface>,
  _engine: Engine
): Promise<Engine | null> {
  const local = listLocalAgents()
  if (local.length === 0) {
    console.log(`\n${YELLOW}Aucun agent à éditer. Créez-en un d'abord avec 1.${RESET}\n`)
    return null
  }

  console.log(`\n${BOLD}${CYAN}┌─ Éditer un agent ─────────────────────────┐${RESET}`)
  console.log(`${BOLD}${CYAN}│  Ctrl+C pour annuler                         │${RESET}`)
  console.log(`${BOLD}${CYAN}└────────────────────────────────────────────┘${RESET}\n`)

  console.log(`${BOLD}Agents disponibles :${RESET}`)
  for (let i = 0; i < local.length; i++) {
    const a = local[i]
    console.log(`  ${CYAN}${i + 1}${RESET}. ${a.name} ${GRAY}(${a.id})${RESET}`)
  }

  const choice = (await rl.question(`\n${CYAN}Choix${RESET} (numéro ou ID) ${GRAY}>${RESET} `)).trim()
  if (!choice) { console.log(`${YELLOW}Annulé.${RESET}\n`); return null }

  const num = parseInt(choice, 10)
  let match: { id: string; name: string; file: string } | undefined
  if (!isNaN(num) && num >= 1 && num <= local.length) {
    match = local[num - 1]
  } else {
    match = local.find(a => a.id === choice || a.id.startsWith(choice))
  }
  if (!match) { console.log(`${RED}Agent introuvable.${RESET}\n`); return null }

  const agent = readLocalAgent(match.file)
  if (!agent) { console.log(`${RED}Impossible de lire l'agent.${RESET}\n`); return null }

  console.log(`\n${BOLD}${CYAN}└─ Édition de : ${agent.displayName}${RESET}\n`)

  // ── Nom ──
  const newName = (await rl.question(`${CYAN}Nom${RESET} (${agent.displayName}) ${GRAY}>${RESET} `)).trim()

  // ── Instructions ──
  console.log(`\n${BOLD}Instructions actuelles :${RESET}\n${CYAN}${agent.instructionsPrompt || '(aucune)'}${RESET}\n`)
  const newInstructions = (await rl.question(`${CYAN}Nouvelles instructions${RESET} (laisser vide) ${GRAY}>${RESET} `)).trim()

  // ── Provider / modèle / clé API ──
  const providerInfo = resolveProviderForModel(agent.model, agent.provider)
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
    const existingProv = listProviders().find(p => p.provider === resolvedProviderType)
    if (KEY_REQUIRED.includes(resolvedProviderType)) {
      if (existingProv?.apiKeys?.length) {
        console.log(`${GRAY}   Clé existante : ****${existingProv.apiKeys[0].key.slice(-4)}${RESET}`)
        const reuse = (await rl.question(`${CYAN}Utiliser cette clé ?${RESET} (O/n) ${GRAY}>${RESET} `)).trim().toLowerCase()
        if (reuse === 'n') {
          while (!newApiKey) {
            newApiKey = (await rl.question(`${CYAN}Nouvelle clé API${RESET} ${GRAY}>${RESET} `)).trim()
            if (!newApiKey) console.log(`${RED}La clé API est requise.${RESET}`)
          }
        } else {
          newApiKey = existingProv.apiKeys[0].key
        }
      } else {
        while (!newApiKey) {
          newApiKey = (await rl.question(`${CYAN}Clé API${RESET} ${GRAY}>${RESET} `)).trim()
          if (!newApiKey) console.log(`${RED}La clé API est requise pour ${resolvedProviderType}.${RESET}`)
        }
      }
    }

    const baseUrl = ONLINE_URLS[resolvedProviderType] || 'https://api.openai.com/v1'
    
    let validationOk = false
    while (!validationOk) {
      // Validation de la clé API si nécessaire
      if (newApiKey) {
        process.stdout.write(`\n${YELLOW}⟳ Validation de la clé API pour ${resolvedProviderType}...${RESET}`)
        try {
          await fetchModels(resolvedProviderType, newApiKey, baseUrl)
          process.stdout.write(`\r${GREEN}✓ Clé API valide pour ${resolvedProviderType}        ${RESET}\n`)
        } catch (err) {
          process.stdout.write(`\r${RED}✗ Clé API invalide pour ${resolvedProviderType}${RESET}\n`)
          const guidance = getModelFetchGuidance(resolvedProviderType, err as Error)
          for (const g of guidance) console.log(`  ${g}`)
          
          const choice = (await rl.question(
            `\n${CYAN}[K]${RESET} Changer clé  ${CYAN}[A]${RESET} Annuler  ${GRAY}>${RESET} `
          )).trim().toLowerCase()
          
          if (choice === 'k') {
            newApiKey = ''
            newModel = ''
            continue
          }
          console.log(`${YELLOW}Annulé.${RESET}`); return null
        }
      }

      // --- Récupération des modèles ---
      process.stdout.write(`\n${YELLOW}⟳ Récupération des modèles...${RESET}`)
      let fetched: string[] = []
      try {
        fetched = await fetchModels(resolvedProviderType, newApiKey, baseUrl)
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
      } catch (err) {
        process.stdout.write(`\r${RED}✗ Récupération impossible${RESET}\n`)
        const guidance = getModelFetchGuidance(resolvedProviderType, err as Error)
        for (const g of guidance) console.log(`  ${g}`)
        
        const choice = (await rl.question(
          `\n${CYAN}[M]${RESET} Saisie manuelle  ${CYAN}[A]${RESET} Annuler  ${GRAY}>${RESET} `
        )).trim().toLowerCase()
        
        if (choice === 'm') {
          newModel = (await rl.question(`${CYAN}Modèle${RESET} ${GRAY}>${RESET} `)).trim() || agent.model
        } else {
          console.log(`${YELLOW}Annulé.${RESET}`); return null
        }
      }

      // --- Test de connexion complet ---
      if (newModel) {
        console.log(`\n${BOLD}${CYAN}┌─ Test de connexion ──────────────────────┐${RESET}`)
        let connectionOk = false
        while (!connectionOk) {
          process.stdout.write(`\n${YELLOW}⟳ Test de connexion à ${resolvedProviderType} / ${newModel}...${RESET}`)
          const result = await testConnection(resolvedProviderType, newApiKey, baseUrl, newModel)
          if (result.ok) {
            process.stdout.write(`\r${GREEN}✓ Connexion réussie !${RESET}\n\n`)
            connectionOk = true
            validationOk = true
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
            newModel = (await rl.question(`${CYAN}Nouveau modèle${RESET} ${GRAY}>${RESET} `)).trim()
            if (!newModel) continue
            break // Sortir de la boucle de connexion pour relancer la récupération des modèles
          }
          console.log(`${YELLOW}Annulé.${RESET}`); return null
        }
        console.log(`${BOLD}${CYAN}└────────────────────────────────────────────┘${RESET}\n`)
      } else {
        validationOk = true
      }
    }

    // sauvegarder la clé API si nouvelle
    if (newApiKey) {
      const provName = existingProv?.name || resolvedProviderType
      setProviderApiKey(provName, newApiKey)
    }

    // activer le provider (l'utilisateur vient de le choisir explicitement)
    const provName = existingProv?.name || resolvedProviderType
    if (!existingProv?.enabled) {
      setProviderEnabled(provName, true)
      console.log(`  ${GREEN}✓ Provider "${provName}" activé${RESET}`)
    }
  }

  // ── Appliquer ──
  const updates: { name?: string; instructionsPrompt?: string; model?: string; provider?: string; toolConfig?: ToolConfig } = {}
  if (newName) updates.name = newName
  if (newInstructions) updates.instructionsPrompt = newInstructions
  if (newModel) {
    updates.model = newModel
    // Also save the provider if we changed the model
    if (resolvedProviderType) updates.provider = resolvedProviderType
    
    // Update toolConfig based on provider
    if (resolvedProviderType === 'lm-studio') {
      updates.toolConfig = {
        parallelTools: true,
        toolTimeoutMs: 30000,
        maxParallel: 4,  // LM Studio supports up to 4 parallel slots
      }
    } else {
      // Default config for other providers
      updates.toolConfig = {
        parallelTools: true,
        toolTimeoutMs: 30000,
        maxParallel: 2,
      }
    }
  }

  if (Object.keys(updates).length === 0) {
    console.log(`${YELLOW}Aucune modification.${RESET}\n`)
    return null
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
      const newEngine = createEngine({ agent: reloaded })
      newEngine.createSession()
      console.log(`${GREEN}✓ Moteur rechargé avec les nouvelles valeurs${RESET}\n`)
      return newEngine
    }
  } else {
    console.log(`${RED}Erreur lors de la mise à jour.${RESET}\n`)
  }

  return null
}
