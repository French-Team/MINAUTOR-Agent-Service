import { createInterface } from 'readline/promises'
import { execSync } from 'child_process'
import {
  listProviders,
  getProvider,
  fetchModels,
  setProviderApiKey,
  setProviderDefaultModel,
  getProviderKeys,
  removeProviderKey,
  setProviderEnabled,
  getModelFetchGuidance,
  testConnection,
  checkLocalProvider,
  getProviderKeyStatuses,
} from './providers.js'
import type { ProviderConfig } from './providers.js'

import { RESET, CYAN, GREEN, YELLOW, RED, GRAY, BOLD, top15, KEY_REQUIRED } from './constants.js'

// ── Cache de validation in-memory ─────────────────────────
// Providers dont la connexion a été testée avec succès pendant cette session
const validatedProviders = new Set<string>()

// ── Provider Management UI ───────────────────────────────

export async function handleManageProvidersMenu(rl: ReturnType<typeof createInterface>): Promise<void> {
  console.log(`\n${BOLD}${CYAN}┌─ Gérer les providers ─────────────────────┐${RESET}`)
  console.log(`${BOLD}${CYAN}│  Configurer les clés API et modèles       │${RESET}`)
  console.log(`${BOLD}${CYAN}└───────────────────────────────────────────┘${RESET}\n`)
  console.log(`${GRAY}┌─ Alternateur multi-clés${RESET}`)
  console.log(`${GRAY}│  Ajoutez plusieurs clés API sur un même provider.${RESET}`)
  console.log(`${GRAY}│  En cas de limite de débit (HTTP 429), le système${RESET}`)
  console.log(`${GRAY}│  bascule automatiquement sur la clé suivante.${RESET}`)
  console.log(`${GRAY}│  Maximum 3 rotations avant d'abandonner.${RESET}`)
  console.log(`${GRAY}│  Cooldown de 60s par clé après un 429.${RESET}`)
  console.log(`${GRAY}└${RESET}\n`)

  const providers = listProviders()
  if (providers.length === 0) {
    console.log(`${YELLOW}Aucun fournisseur configuré.${RESET}\n`)
    return
  }

  let done = false
  while (!done) {
    // Ping des providers locaux en parallèle (timeout 3s chacun)
    const localResults = new Map<string, boolean>()
    const localChecks = providers
      .filter(p => p.provider === 'ollama-local' || p.provider === 'lm-studio')
      .map(async p => {
        try {
          const result = await checkLocalProvider(p.provider)
          localResults.set(p.name, result.alive)
        } catch {
          localResults.set(p.name, false)
        }
      })
    await Promise.allSettled(localChecks)

    // Les providers locaux répondant sont automatiquement validés et activés (pas de clé API nécessaire)
    for (const [name, alive] of localResults) {
      if (alive) {
        validatedProviders.add(name)
        const p = providers.find(x => x.name === name)
        if (p && !p.enabled) {
          setProviderEnabled(name, true)
          p.enabled = true
        }
      }
    }

    // Afficher la liste des providers
    console.log(`${BOLD}Fournisseurs disponibles :${RESET}`)
    for (let i = 0; i < providers.length; i++) {
      const p = providers[i]
      const enabledIcon = p.enabled ? `${GREEN}✓${RESET}` : `${GRAY}✗${RESET}`

      // Déterminer le badge de statut dynamique
      let badge: string
      const hasKeys = (p.apiKeys?.length || 0) > 0
      const needsKey = KEY_REQUIRED.includes(p.provider)
      const isValidated = validatedProviders.has(p.name)

      if (isValidated) {
        badge = `${GREEN}✓ validé${RESET}`
      } else if (p.provider === 'kilo') {
        badge = `${GREEN}✓ prêt${RESET}`
      } else if (p.provider === 'ollama-local' || p.provider === 'lm-studio') {
        const alive = localResults.get(p.name)
        if (alive === undefined) badge = `${GRAY}? inconnu${RESET}`
        else if (alive) badge = `${GREEN}✓ en ligne${RESET}`
        else badge = `${RED}✗ arrêté${RESET}`
      } else if (hasKeys) {
        badge = `${GREEN}✓ ${p.apiKeys!.length} clé(s)${RESET}`
      } else if (needsKey) {
        badge = `${RED}✗ clé manq${RESET}`
      } else {
        badge = `${GRAY}? config${RESET}`
      }

      console.log(`  ${CYAN}${i + 1}${RESET}. ${enabledIcon} ${p.name.padEnd(20)}  ${badge}  ${GRAY}${p.defaultModel}${RESET}`)
    }
    console.log(`  ${CYAN}0${RESET}. Retour au menu principal\n`)

    const provNum = (await rl.question(`${CYAN}Sélectionner un provider${RESET} (0-${providers.length}) ${GRAY}>${RESET} `)).trim()
    const idx = parseInt(provNum, 10) - 1

    if (provNum === '0') {
      done = true
      continue
    }

    if (isNaN(idx) || idx < 0 || idx >= providers.length) {
      console.log(`${RED}Choix invalide.${RESET}\n`)
      continue
    }

    const provider = providers[idx]
    await handleProviderActions(rl, provider)
    console.log() // Espacement après le sous-menu
  }
  console.log()
}

export async function handleProviderActions(rl: ReturnType<typeof createInterface>, provider: ProviderConfig): Promise<void> {
  let done = false
  while (!done) {
    console.log(`\n${BOLD}${CYAN}Provider : ${provider.name}${RESET}`)
    const status = provider.enabled ? `${GREEN}✓ Activé${RESET}` : `${GRAY}✗ Désactivé${RESET}`
    const keyCount = provider.apiKeys?.length || 0
    console.log(`  Statut  : ${status}`)
    console.log(`  Modèle  : ${provider.defaultModel}`)
    console.log(`  Clés    : ${keyCount}\n`)

    console.log(`${BOLD}Actions :${RESET}`)
    console.log(`  ${CYAN}1${RESET}. Ajouter/modifier une clé API`)
    console.log(`  ${CYAN}2${RESET}. Configurer le modèle par défaut`)
    console.log(`  ${CYAN}3${RESET}. Voir les clés API`)
    console.log(`  ${CYAN}4${RESET}. Supprimer une clé API`)
    console.log(`  ${CYAN}5${RESET}. ${provider.enabled ? 'Désactiver' : 'Activer'} ce provider`)
    console.log(`  ${CYAN}6${RESET}. État des clés & alternateur`)
    console.log(`  ${CYAN}0${RESET}. Retour\n`)

    const choice = (await rl.question(`${CYAN}Choix${RESET} ${GRAY}>${RESET} `)).trim()

    if (choice === '0') {
      done = true
      continue
    }

    if (choice === '1') {
      // Ajouter/modifier une clé API
      const apiKey = (await rl.question(`${CYAN}Nouvelle clé API${RESET} ${GRAY}>${RESET} `)).trim()
      if (!apiKey) {
        console.log(`${YELLOW}Annulé.${RESET}`)
        continue
      }

      // Valider la clé API
      console.log(`\n${YELLOW}⟳ Validation de la clé API...${RESET}`)
      try {
        await fetchModels(provider.provider, apiKey, provider.baseUrl)
        console.log(`${GREEN}✓ Clé API valide${RESET}`)

        if (setProviderApiKey(provider.name, apiKey)) {
          console.log(`${GREEN}✓ Clé API mise à jour pour "${provider.name}".${RESET}`)
          validatedProviders.add(provider.name)
          // Recharger le provider pour afficher les infos à jour
          const updated = getProvider(provider.name)
          if (updated) Object.assign(provider, updated)
        } else {
          console.log(`${RED}Erreur lors de la mise à jour.${RESET}`)
        }
      } catch (err) {
        console.log(`${RED}✗ Clé API invalide${RESET}`)
        const guidance = getModelFetchGuidance(provider.provider, err as Error)
        for (const g of guidance) console.log(`  ${g}`)
        console.log(`${YELLOW}La clé API n'a pas pu être validée.${RESET}`)
      }
      continue
    }

    if (choice === '2') {
      // Configurer le modèle par défaut
      console.log(`\n${YELLOW}⟳ Récupération des modèles disponibles...${RESET}`)
      try {
        const models = await fetchModels(provider.provider, provider.apiKeys?.[0]?.key || '', provider.baseUrl)

        // Si aucun modèle et que c'est Ollama Local, proposer d'installer lfm2.5-thinking:latest
        if (models.length === 0 && provider.provider === 'ollama-local') {
          console.log(`${YELLOW}Aucun modèle installé sur Ollama Local.${RESET}`)
          console.log(`\n${BOLD}Suggestion :${RESET}`)
          console.log(`  ${CYAN}lfm2.5-thinking:latest${RESET} - Léger & très intelligent malgré son poids`)
          const install = (await rl.question(`\n${CYAN}Installer ce modèle ?${RESET} (o/N) ${GRAY}>${RESET} `)).trim().toLowerCase()

          if (install === 'o' || install === 'y') {
            console.log(`\n${YELLOW}⟳ Installation du modèle lfm2.5-thinking:latest...${RESET}`)
            console.log(`${GRAY}Cela peut prendre plusieurs minutes selon votre connexion.${RESET}`)
            console.log(`${GRAY}Commande : ollama pull lfm2.5-thinking:latest${RESET}\n`)

            const cmd = (await rl.question(`${CYAN}Lancer l'installation ?${RESET} (o/N) ${GRAY}>${RESET} `)).trim().toLowerCase()
            if (cmd === 'o' || cmd === 'y') {
              console.log(`${YELLOW}Exécution de la commande...${RESET}`)
              try {
                execSync('ollama pull lfm2.5-thinking:latest', { stdio: 'inherit' })
                console.log(`${GREEN}✓ Modèle installé avec succès${RESET}`)

                // Récupérer la liste mise à jour
                const updatedModels = await fetchModels(provider.provider, provider.apiKeys?.[0]?.key || '', provider.baseUrl)
                if (updatedModels.includes('lfm2.5-thinking:latest')) {
                  if (setProviderDefaultModel(provider.name, 'lfm2.5-thinking:latest')) {
                    console.log(`${GREEN}✓ Modèle par défaut mis à jour : lfm2.5-thinking:latest${RESET}`)
                    validatedProviders.add(provider.name)
                    const updated = getProvider(provider.name)
                    if (updated) Object.assign(provider, updated)
                  }
                }
              } catch (_err) {
                console.log(`${RED}✗ Erreur lors de l'installation${RESET}`)
                console.log(`${GRAY}Assure-toi que Ollama est installé et accessible via la commande 'ollama'${RESET}`)
              }
            }
          }
          continue
        }

        const display = top15(models)
        const hidden = models.length - display.length
        console.log(`${GREEN}✓ ${models.length} modèles disponibles${RESET}\n`)
        for (let i = 0; i < display.length; i++) {
          console.log(`  ${CYAN}${i + 1}${RESET}. ${display[i]}`)
        }
        if (hidden > 0) console.log(`  ${GRAY}... et ${hidden} autres${RESET}`)

        const choice = (await rl.question(`\n${CYAN}Choix du modèle${RESET} (numéro ou nom) ${GRAY}>${RESET} `)).trim()
        let model = ''
        const idx = parseInt(choice, 10)
        if (!isNaN(idx) && idx >= 1 && idx <= display.length) {
          model = display[idx - 1]
        } else if (choice) {
          model = choice
        }

        if (!model) {
          console.log(`${YELLOW}Annulé.${RESET}`)
          continue
        }

        // Test de connexion avec le nouveau modèle
        console.log(`\n${BOLD}${CYAN}┌─ Test de connexion ──────────────────────┐${RESET}`)
        process.stdout.write(`${YELLOW}⟳ Test de connexion à ${provider.provider} / ${model}...${RESET}`)
        const result = await testConnection(provider.provider, provider.apiKeys?.[0]?.key || '', provider.baseUrl, model)
        if (result.ok) {
          process.stdout.write(`\r${GREEN}✓ Connexion réussie !${RESET}\n\n`)
          console.log(`${BOLD}${CYAN}└────────────────────────────────────────────┘${RESET}\n`)

          if (setProviderDefaultModel(provider.name, model)) {
            console.log(`${GREEN}✓ Modèle par défaut mis à jour : ${model}${RESET}`)
            validatedProviders.add(provider.name)
            // Recharger le provider
            const updated = getProvider(provider.name)
            if (updated) Object.assign(provider, updated)
          } else {
            console.log(`${RED}Erreur lors de la mise à jour.${RESET}`)
          }
        } else {
          process.stdout.write(`\r${RED}✗ Échec de connexion${RESET}\n\n`)
          for (const d of result.diagnostics) console.log(`  ${d}`)
          console.log(`${BOLD}${CYAN}└────────────────────────────────────────────┘${RESET}\n`)
          console.log(`${YELLOW}Le modèle n'a pas pu être validé. Veuillez vérifier la configuration.${RESET}`)
        }
      } catch (err) {
        console.log(`${RED}✗ Impossible de récupérer les modèles${RESET}`)
        const guidance = getModelFetchGuidance(provider.provider, err as Error)
        for (const g of guidance) console.log(`  ${g}`)

        // Fallback: saisie manuelle
        const model = (await rl.question(`\n${CYAN}Saisir le modèle manuellement${RESET} ${GRAY}>${RESET} `)).trim()
        if (!model) {
          console.log(`${YELLOW}Annulé.${RESET}`)
          continue
        }

        // Test de connexion avec le modèle saisi manuellement
        console.log(`\n${BOLD}${CYAN}┌─ Test de connexion ──────────────────────┐${RESET}`)
        process.stdout.write(`${YELLOW}⟳ Test de connexion à ${provider.provider} / ${model}...${RESET}`)
        const result = await testConnection(provider.provider, provider.apiKeys?.[0]?.key || '', provider.baseUrl, model)
        if (result.ok) {
          process.stdout.write(`\r${GREEN}✓ Connexion réussie !${RESET}\n\n`)
          console.log(`${BOLD}${CYAN}└────────────────────────────────────────────┘${RESET}\n`)

          if (setProviderDefaultModel(provider.name, model)) {
            console.log(`${GREEN}✓ Modèle par défaut mis à jour : ${model}${RESET}`)
            validatedProviders.add(provider.name)
            const updated = getProvider(provider.name)
            if (updated) Object.assign(provider, updated)
          } else {
            console.log(`${RED}Erreur lors de la mise à jour.${RESET}`)
          }
        } else {
          process.stdout.write(`\r${RED}✗ Échec de connexion${RESET}\n\n`)
          for (const d of result.diagnostics) console.log(`  ${d}`)
          console.log(`${BOLD}${CYAN}└────────────────────────────────────────────┘${RESET}\n`)
          console.log(`${YELLOW}Le modèle n'a pas pu être validé. Veuillez vérifier la configuration.${RESET}`)
        }
      }
      continue
    }

    if (choice === '3') {
      // Voir les clés API
      const keys = getProviderKeys(provider.name)
      if (keys.length === 0) {
        console.log(`\n${YELLOW}Aucune clé API pour "${provider.name}".${RESET}`)
      } else {
        console.log(`\n${BOLD}Clés API pour ${provider.name} (${keys.length}) :${RESET}`)
        for (let i = 0; i < keys.length; i++) {
          console.log(`  ${CYAN}${i + 1}${RESET}. ${keys[i].label ? `${keys[i].label} ` : ''}****${keys[i].key.slice(-4)}`)
        }
        if (keys.length > 1) {
          console.log(`\n${GREEN}⚡ Alternateur actif : ${keys.length} clés en rotation${RESET}`)
          console.log(`${GRAY}   Rotation round-robin — bascule auto sur 429 (cooldown 60s)${RESET}`)
        } else {
          console.log(`\n${YELLOW}💡 Astuce : ajoutez une 2ᵉ clé pour activer l'alternateur automatique${RESET}`)
          console.log(`${GRAY}   En cas de 429, le système basculera sur l'autre clé.${RESET}`)
        }
      }
      continue
    }

    if (choice === '4') {
      // Supprimer une clé API
      const keys = getProviderKeys(provider.name)
      if (keys.length === 0) {
        console.log(`${YELLOW}Aucune clé à supprimer.${RESET}`)
        continue
      }
      console.log(`\n${BOLD}Clés disponibles :${RESET}`)
      for (let i = 0; i < keys.length; i++) {
        console.log(`  ${CYAN}${i + 1}${RESET}. ${keys[i].label ? `${keys[i].label} ` : ''}****${keys[i].key.slice(-4)}`)
      }
      const keyNum = (await rl.question(`\n${CYAN}Numéro de la clé à supprimer${RESET} ${GRAY}>${RESET} `)).trim()
      const keyIdx = parseInt(keyNum, 10) - 1
      if (isNaN(keyIdx) || keyIdx < 0 || keyIdx >= keys.length) {
        console.log(`${RED}Choix invalide.${RESET}`)
        continue
      }
      if (removeProviderKey(provider.name, keys[keyIdx].key)) {
        console.log(`${GREEN}✓ Clé ****${keys[keyIdx].key.slice(-4)} supprimée de "${provider.name}".${RESET}`)
        // Recharger le provider
        const updated = getProvider(provider.name)
        if (updated) Object.assign(provider, updated)
      } else {
        console.log(`${RED}Erreur lors de la suppression.${RESET}`)
      }
      continue
    }

    if (choice === '5') {
      // Activer/désactiver un provider
      const newStatus = !provider.enabled
      setProviderEnabled(provider.name, newStatus)
      const action = newStatus ? 'activé' : 'désactivé'
      console.log(`${GREEN}✓ "${provider.name}" ${action}.${RESET}`)
      // Recharger le provider
      const updated = getProvider(provider.name)
      if (updated) Object.assign(provider, updated)
      continue
    }

    if (choice === '6') {
      // Dashboard état des clés & alternateur
      const keys = getProviderKeys(provider.name)
      const statuses = getProviderKeyStatuses(provider.name)

      console.log(`\n${BOLD}${CYAN}┌─ État des clés API — ${provider.name}${RESET}`)

      if (keys.length === 0) {
        console.log(`${CYAN}│${RESET}`)
        console.log(`${CYAN}│${RESET}  ${YELLOW}Aucune clé configurée.${RESET}`)
        console.log(`${CYAN}│${RESET}  Ajoutez une clé avec l'option ${GREEN}1${RESET}.`)
      } else {
        const status = provider.enabled ? `${GREEN}✓ Activé${RESET}` : `${GRAY}✗ Désactivé${RESET}`
        console.log(`${CYAN}│${RESET}`)
        console.log(`${CYAN}│${RESET}  Statut   : ${status}`)
        console.log(`${CYAN}│${RESET}  Modèle   : ${GRAY}${provider.defaultModel}${RESET}`)
        console.log(`${CYAN}│${RESET}  Clés     : ${keys.length}`)

        if (keys.length > 1) {
          console.log(`${CYAN}│${RESET}`)
          console.log(`${CYAN}│${RESET}  ${GREEN}⚡ Alternateur : ${keys.length} clés en rotation${RESET}`)
          console.log(`${CYAN}│${RESET}  ${GRAY}   Round-robin — bascule auto sur 429${RESET}`)
          console.log(`${CYAN}│${RESET}  ${GRAY}   Cooldown 60s par clé — max 3 rotations/appel${RESET}`)
        }

        console.log(`${CYAN}│${RESET}`)
        for (const s of statuses) {
          const label = s.label ? `${CYAN}[${s.label}]${RESET} ` : ''
          const mask = `****${s.keySuffix}`

          let stateIcon: string
          let stateText: string
          if (s.rateLimited) {
            const secs = Math.ceil(s.remainingCooldownMs / 1000)
            stateIcon = `${RED}⏳${RESET}`
            stateText = `${RED}rate-limited${RESET} ${GRAY}(encore ${secs}s)${RESET}`
          } else if (s.isNextKey) {
            stateIcon = `${GREEN}→${RESET}`
            stateText = `${GREEN}prochaine clé sélectionnée${RESET}`
          } else {
            stateIcon = `${GREEN}✓${RESET}`
            stateText = `${GREEN}disponible${RESET}`
          }

          console.log(`${CYAN}│${RESET}  ${stateIcon} ${label}${mask}  ${stateText}`)
        }

        if (keys.length > 1) {
          const available = statuses.filter(s => !s.rateLimited).length
          const limited = statuses.filter(s => s.rateLimited).length
          console.log(`${CYAN}│${RESET}`)
          if (limited > 0) {
            console.log(`${CYAN}│${RESET}  ${GREEN}${available} disponible(s)${RESET}  ${RED}${limited} rate-limited${RESET}`)
          } else {
            console.log(`${CYAN}│${RESET}  ${GREEN}Toutes les clés sont disponibles${RESET}`)
          }
        }
      }

      console.log(`${BOLD}${CYAN}└${RESET}\n`)
      continue
    }

    console.log(`${YELLOW}Choix invalide.${RESET}`)
  }
}
