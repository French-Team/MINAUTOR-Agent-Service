import { createInterface } from 'readline/promises'
import type { Engine } from './engine.js'
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
  fetchModels,
  getKnownProviders,
  isLocalProvider,
  checkLocalProvider,
  resolveProviderForModel,
} from './providers.js'
import { top15 } from './constants.js'
import { RESET, CYAN, GREEN, YELLOW, RED, GRAY, BOLD, ONLINE_URLS, KEY_REQUIRED } from './constants.js'

// ── Provider command handler (/providers) ────────────────

export async function handleProviders(
  rl: ReturnType<typeof createInterface>,
  args: string[],
  engine: Engine
): Promise<void> {
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
          const baseUrl = type === 'ollama' ? 'http://localhost:11434' : 'http://localhost:1234/v1'
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
    const needsProvider = !resolveProviderForModel(engine.agent.model, engine.agent.provider)
    const agentName = engine.agent.displayName

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


    // Clé API
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
