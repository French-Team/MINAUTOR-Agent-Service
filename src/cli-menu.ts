import type { Engine } from './engine.js'
import {
  RESET, CYAN, GREEN, YELLOW, GRAY, BOLD,
} from './constants.js'
import { runContextTest } from './cli-context-test.js'
import { createInterface } from 'readline/promises'
import {
  loadSuggestions,
  loadSuggestionStats,
  resetSuggestionStats,
  getSuggestionPrefs,
  setSuggestionPrefs,
  formatStatsForDisplay,
  formatCurrentSuggestionsForDisplay,
  formatTemplatesForDisplay,
} from './cli-suggestions.js'
import { getCurrentProject } from './cli-intercom-router.js'

export function showMenu(_engine: Engine): void {
  console.log(`${BOLD}${CYAN}╔ Menu principal${RESET}`)
  console.log(`${BOLD}${CYAN}║${RESET}`)
  console.log(`${BOLD}${CYAN}║  ${GRAY}── Configuration ──${RESET}`)
  console.log(`${BOLD}${CYAN}║  ${CYAN}101${RESET}. Providers & clés API`)
  console.log(`${BOLD}${CYAN}║  ${CYAN}102${RESET}. Mon profil`)
  console.log(`${BOLD}${CYAN}║${RESET}`)
  console.log(`${BOLD}${CYAN}║  ${GRAY}── Agents ──${RESET}`)
  console.log(`${BOLD}${CYAN}║  ${CYAN}201${RESET}. Créer un agent`)
  console.log(`${BOLD}${CYAN}║  ${CYAN}202${RESET}. Voir les agents`)
  console.log(`${BOLD}${CYAN}║  ${CYAN}203${RESET}. Éditer un agent`)
  console.log(`${BOLD}${CYAN}║  ${CYAN}204${RESET}. Skills & prompts`)
  console.log(`${BOLD}${CYAN}║${RESET}`)
  console.log(`${BOLD}${CYAN}║  ${GRAY}── Sessions ──${RESET}`)
  console.log(`${BOLD}${CYAN}║  ${CYAN}301${RESET}. Démarrer une session`)
  console.log(`${BOLD}${CYAN}║  ${CYAN}302${RESET}. Gérer les sessions`)
  console.log(`${BOLD}${CYAN}║${RESET}`)
  console.log(`${BOLD}${CYAN}║  ${GRAY}── Monitoring ──${RESET}`)
  console.log(`${BOLD}${CYAN}║  ${CYAN}401${RESET}. Status & notifications`)
  console.log(`${BOLD}${CYAN}║  ${CYAN}402${RESET}. Messages intercom`)
  console.log(`${BOLD}${CYAN}║  ${CYAN}403${RESET}. Analyse des patterns`)
  console.log(`${BOLD}${CYAN}║${RESET}`)
  console.log(`${BOLD}${CYAN}║  ${GRAY}── Banc de tests ──${RESET}`)
  console.log(`${BOLD}${CYAN}║  ${CYAN}501${RESET}. Banc de tests (contexte + routeurs)`)
  console.log(`${BOLD}${CYAN}║${RESET}`)
  console.log(`${BOLD}${CYAN}║  ${GRAY}── Suggestions ──${RESET}`)
  console.log(`${BOLD}${CYAN}║  ${CYAN}601${RESET}. Voir les suggestions actuelles`)
  console.log(`${BOLD}${CYAN}║  ${CYAN}602${RESET}. Statistiques d'apprentissage`)
  console.log(`${BOLD}${CYAN}║  ${CYAN}603${RESET}. Réinitialiser les stats`)
  console.log(`${BOLD}${CYAN}║  ${CYAN}604${RESET}. Voir les templates YAML`)
  console.log(`${BOLD}${CYAN}║  ${CYAN}605${RESET}. Activer/désactiver l'affichage auto`)
  console.log(`${BOLD}${CYAN}║${RESET}`)
  console.log(`${BOLD}${CYAN}║  ${GRAY}── Aide ──${RESET}`)
  console.log(`${BOLD}${CYAN}║  aide${RESET}`)
  console.log(`${BOLD}${CYAN}╚  fin${RESET}\n`)
  console.log(`${GRAY}Ou tapez /help, /create, /providers, un prompt, !cmd, @message...${RESET}`)
}

/**
 * Sous-menu « Banc de tests » — accessible via 501 dans le menu principal.
 * Regroupe les tests de contexte (anciens 11-15, 23) et les routeurs
 * génériques (anciens 16-22) dans un seul sous-menu.
 *
 * Numérotation 3 chiffres extensible par section (ibid. menu principal) :
 *   Tests de contexte (100-199) :
 *     101 → '11'   (Profil tiny)
 *     102 → '12'   (Profil small)
 *     103 → '13'   (Profil medium)
 *     104 → '14'   (Profil large)
 *     105 → '15'   (Profil huge)
 *     106 → '23'   (Llama3 8B)
 *   Routeurs génériques (200-299) :
 *     201 → '16'   (Routeur Kilo)
 *     202 → '17'   (Routeur OpenRouter)
 *     203 → '18'   (Routeur :free)
 *     204 → '19'   (Routeur Opencode Zen)
 *     205 → '20'   (Routeur LM Studio)
 *     206 → '21'   (Routeur Custom)
 *     207 → '22'   (Résumé tous les routeurs)
 */
export async function handleTestSubmenu(rl: ReturnType<typeof createInterface>): Promise<void> {
  const SUB_CHOICES: Record<string, string> = {
    '101': '11', '102': '12', '103': '13', '104': '14', '105': '15',
    '106': '23',
    '201': '16', '202': '17', '203': '18', '204': '19', '205': '20', '206': '21', '207': '22',
  }

  while (true) {
    console.log(`\n${BOLD}${CYAN}╔ Banc de tests${RESET}`)
    console.log(`${BOLD}${CYAN}║${RESET}`)
    console.log(`${BOLD}${CYAN}║  ${GRAY}── Tests de contexte ──${RESET}`)
    console.log(`${BOLD}${CYAN}║  ${CYAN}101${RESET}.  Profil tiny     (LFM2.5-1.2B, ≤1.5B)`)
    console.log(`${BOLD}${CYAN}║  ${CYAN}102${RESET}.  Profil small    (Llama3.2-3B, 1.5–4B)`)
    console.log(`${BOLD}${CYAN}║  ${CYAN}103${RESET}.  Profil medium   (Mistral-7B, 4–15B)`)
    console.log(`${BOLD}${CYAN}║  ${CYAN}104${RESET}.  Profil large    (GPT-4, 15B–70B/cloud)`)
    console.log(`${BOLD}${CYAN}║  ${CYAN}105${RESET}.  Profil huge     (Gemini 2.5, 1M+ tokens)`)
    console.log(`${BOLD}${CYAN}║  ${CYAN}106${RESET}.  Llama3 8B        (règle #20 spécifique)`)
    console.log(`${BOLD}${CYAN}║${RESET}`)
    console.log(`${BOLD}${CYAN}║  ${GRAY}── Routeurs génériques ──${RESET}`)
    console.log(`${BOLD}${CYAN}║  ${CYAN}201${RESET}.  Routeur Kilo Gateway     (kilo-auto)`)
    console.log(`${BOLD}${CYAN}║  ${CYAN}202${RESET}.  Routeur OpenRouter       (openrouter/)`)
    console.log(`${BOLD}${CYAN}║  ${CYAN}203${RESET}.  Routeur :free            (modèles gratuits)`)
    console.log(`${BOLD}${CYAN}║  ${CYAN}204${RESET}.  Routeur Opencode Zen     (opencode-zen/)`)
    console.log(`${BOLD}${CYAN}║  ${CYAN}205${RESET}.  Routeur LM Studio        (local-model)`)
    console.log(`${BOLD}${CYAN}║  ${CYAN}206${RESET}.  Routeur Custom            (custom/)`)
    console.log(`${BOLD}${CYAN}║  ${CYAN}207${RESET}.  Résumé tous les routeurs  (tableau complet)`)
    console.log(`${BOLD}${CYAN}║${RESET}`)
    console.log(`${BOLD}${CYAN}║  ${GRAY}── Retour ──${RESET}`)
    console.log(`${BOLD}${CYAN}╚  ${CYAN}0${RESET}.   Retour au menu principal\n`)

    const answer = (await rl.question(`${CYAN}Choix${RESET} ${GRAY}>${RESET} `)).trim()
    if (!answer || answer === '0') break

    const mapped = SUB_CHOICES[answer]
    if (mapped) {
      runContextTest(mapped)
    } else {
      console.log(`${YELLOW}Choix invalide.${RESET}`)
    }
  }
}


/**
 * Sous-menu « Suggestions » — accessible via 601-605 dans le menu principal
 * ou via /suggestions dans la ligne de commande.
 */
export async function handleSuggestionsMenu(rl: ReturnType<typeof createInterface>): Promise<void> {
  while (true) {
    const currentProject = getCurrentProject()
    const prefs = getSuggestionPrefs()
    const stats = loadSuggestionStats(currentProject)
    const currentSuggestions = loadSuggestions()

    const autoIcon = prefs.autoShow ? `${GREEN}✓${RESET}` : `${YELLOW}✗${RESET}`
    const autoLabel = prefs.autoShow ? `Activé ${GRAY}(affichage automatique)${RESET}` : `Désactivé ${GRAY}(menu silencieux)${RESET}`
    const statsSummary = stats.totalChoices > 0
      ? `${GREEN}${stats.totalChoices} choix${RESET} ${GRAY}· ${Object.keys(stats.counts).length} commandes${RESET}`
      : `${GRAY}Aucune donnée${RESET}`
    const suggestSummary = currentSuggestions.length > 0
      ? `${GREEN}${currentSuggestions.length} suggestion(s)${RESET}`
      : `${GRAY}Aucune suggestion active${RESET}`

    console.log(`\n${BOLD}${CYAN}╔ Gestion des suggestions${RESET}`)
    console.log(`${BOLD}${CYAN}║${RESET}`)
    console.log(`${BOLD}${CYAN}║  ${RESET}${GRAY}Résumé :${RESET}  Suggestions: ${suggestSummary}  |  Stats: ${statsSummary}  |  Auto: ${autoIcon} ${autoLabel}`)
    console.log(`${BOLD}${CYAN}║${RESET}`)
    console.log(`${BOLD}${CYAN}║  ${GRAY}── Consultation ──${RESET}`)
    console.log(`${BOLD}${CYAN}║  ${CYAN}601${RESET}. Voir les suggestions actuelles`)
    console.log(`${BOLD}${CYAN}║  ${CYAN}602${RESET}. Statistiques d'apprentissage`)
    console.log(`${BOLD}${CYAN}║  ${CYAN}604${RESET}. Voir les templates YAML`)
    console.log(`${BOLD}${CYAN}║${RESET}`)
    console.log(`${BOLD}${CYAN}║  ${GRAY}── Actions ──${RESET}`)
    console.log(`${BOLD}${CYAN}║  ${CYAN}603${RESET}. Réinitialiser les statistiques`)
    console.log(`${BOLD}${CYAN}║  ${CYAN}605${RESET}. ${prefs.autoShow ? 'Désactiver' : 'Activer'} l'affichage automatique`)
    console.log(`${BOLD}${CYAN}║${RESET}`)
    console.log(`${BOLD}${CYAN}║  ${GRAY}── Retour ──${RESET}`)
    console.log(`${BOLD}${CYAN}╚  ${CYAN}0${RESET}.   Retour au menu principal\n`)

    const answer = (await rl.question(`${CYAN}Choix${RESET} ${GRAY}>${RESET} `)).trim()
    if (!answer || answer === '0') break

    if (answer === '601') {
      const lines = formatCurrentSuggestionsForDisplay()
      console.log(`\n${BOLD}${CYAN}┌─ Suggestions actuelles ───────────────────┐${RESET}`)
      for (const l of lines) console.log(l)
      console.log(`${BOLD}${CYAN}└────────────────────────────────────────────┘${RESET}`)
      console.log(`${GRAY}Appuie sur Entrée pour continuer.${RESET}`)
      await rl.question('')
    } else if (answer === '602') {
      const lines = formatStatsForDisplay(currentProject)
      console.log(`\n${BOLD}${CYAN}┌─ Statistiques d'apprentissage ───────────┐${RESET}`)
      for (const l of lines) console.log(l)
      console.log(`${BOLD}${CYAN}└────────────────────────────────────────────┘${RESET}`)
      console.log(`${GRAY}Appuie sur Entrée pour continuer.${RESET}`)
      await rl.question('')
    } else if (answer === '603') {
      const confirm = (await rl.question(`\n${YELLOW}Supprimer toutes les statistiques d'apprentissage ?${RESET} (o/N) ${GRAY}>${RESET} `)).trim().toLowerCase()
      if (confirm === 'o' || confirm === 'y') {
        resetSuggestionStats(currentProject)
        console.log(`${GREEN}✓ Statistiques réinitialisées ${currentProject ? `pour "${currentProject}"` : '(globales)'}.${RESET}`)
      } else {
        console.log(`${YELLOW}Annulé.${RESET}`)
      }
    } else if (answer === '604') {
      const lines = formatTemplatesForDisplay()
      console.log(`\n${BOLD}${CYAN}┌─ Templates de suggestions ────────────────┐${RESET}`)
      for (const l of lines) console.log(l)
      console.log(`${BOLD}${CYAN}└────────────────────────────────────────────┘${RESET}`)
      console.log(`${GRAY}Appuie sur Entrée pour continuer.${RESET}`)
      await rl.question('')
    } else if (answer === '605') {
      const newPrefs = { autoShow: !prefs.autoShow }
      setSuggestionPrefs(newPrefs)
      console.log(`${GREEN}✓ Affichage automatique ${newPrefs.autoShow ? 'activé' : 'désactivé'}.${RESET}`)
    } else {
      console.log(`${YELLOW}Choix invalide.${RESET}`)
    }
  }
}


export function showHelp(engine: Engine): void {
  const agent = engine.agent
  console.log(`\n${BOLD}${CYAN}╔${RESET}`)
  console.log(`${BOLD}${CYAN}║  Minautor Agent Service — Commandes${RESET}`)
  console.log(`${BOLD}${CYAN}╚${RESET}`)
  console.log(`${GRAY}Agent: ${agent.displayName} (${agent.id})${RESET}`)
  console.log(`${GRAY}Model: ${agent.model}${RESET}`)
  console.log(`${GRAY}Tools: ${agent.toolNames.join(', ')}${RESET}\n`)
  console.log(`${BOLD}Menu :${RESET}`)
  console.log(`  ${GREEN}/menu${RESET}       Afficher le menu principal`)
  console.log(`  ${GREEN}/help${RESET}       Cette aide`)
  console.log(`  ${GREEN}/ ou /?${RESET}     Sélecteur de commandes complet`)
  console.log(`  ${GREEN}101-501${RESET}     Raccourcis du menu`)
  console.log(`  ${GREEN}aide${RESET}        Afficher cette aide`)
  console.log(`  ${GREEN}fin${RESET}         Quitter\n`)
  console.log(`${BOLD}Configuration :${RESET}`)
  console.log(`  ${GREEN}/profile${RESET}              Modifier ton profil (prénom, pseudo)`)
  console.log(`  ${GREEN}/providers${RESET}            Voir la liste des providers`)
  console.log(`  ${GREEN}/providers add${RESET}        Ajouter un fournisseur`)
  console.log(`  ${GREEN}/providers remove <nom>${RESET} Supprimer un fournisseur`)
  console.log(`  ${GREEN}/providers enable <nom>${RESET} Activer un fournisseur`)
  console.log(`  ${GREEN}/providers disable <nom>${RESET} Désactiver un fournisseur`)
  console.log(`  ${GREEN}/providers key <nom> <clé>${RESET} Définir/changer la clé API`)
  console.log(`  ${GREEN}/providers keys <nom>${RESET} Voir les clés API`)
  console.log(`  ${GREEN}/providers addkey <nom>${RESET} Ajouter une clé`)
  console.log(`  ${GREEN}/providers removekey <nom>${RESET} Supprimer une clé`)
  console.log(`  ${GREEN}/providers model <nom> <m>${RESET} Changer le modèle par défaut`)
  console.log(`  ${GREEN}/providers scan${RESET}        Scanner les providers locaux`)
  console.log(`  ${GREEN}/providers local${RESET}       Statut des providers locaux`)
  console.log(`\n${GRAY}── Rotation multi-clés ──${RESET}`)
  console.log(`  ${GREEN}1${RESET} → Provider > ${GREEN}Ajouter${RESET} une clé   Activer l'alternateur`)
  console.log(`  ${GRAY}   Bascule automatique sur une autre clé en cas de 429 (cooldown 60s)${RESET}`)
  console.log(`  ${GRAY}   Maximum 3 rotations par appel avant abandon${RESET}\n`)
  console.log(`${BOLD}Agents :${RESET}`)
  console.log(`  ${GREEN}/create${RESET}     Créer un agent (guidé avec certification PACO)`)
  console.log(`  ${GREEN}/edit${RESET}       Éditer un agent (nom, instructions, modèle)`)
  console.log(`  ${GREEN}/agents${RESET}     Lister tous les agents`)
  console.log(`  ${GREEN}/use <id>${RESET}   Charger un agent par son ID`)
  console.log(`  ${GREEN}/load <path>${RESET} Charger un agent depuis un fichier JSON\n`)
  console.log(`${BOLD}Sessions :${RESET}`)
  console.log(`  ${GREEN}/start${RESET}      Démarrer une session avec un agent`)
  console.log(`  ${GREEN}/session <id>${RESET} Changer de session`)
  console.log(`  ${GREEN}/sessions${RESET}   Lister les sessions`)
  console.log(`  ${GREEN}/new${RESET}       Nouvelle session`)
  console.log(`  ${GREEN}/info${RESET}      Infos de la session active\n`)
  console.log(`${BOLD}Monitoring :${RESET}`)
  console.log(`  ${GREEN}/status${RESET}              Status système (intercom, daemon, logbook)`)
  console.log(`  ${GREEN}/notifications${RESET}       Voir le filtre actif`)
  console.log(`  ${GREEN}/notifications filter <lvl>${RESET} Changer le niveau de filtre`)
  console.log(`${GREEN}/notifications history <j>${RESET} Historique des notifications`)
  console.log(`${GREEN}/logbook${RESET}              Voir les dernières entrées du logbook`)
  console.log(`${GREEN}/ps${RESET}                   Lister les agents en arrière-plan`)
  console.log(`${GREEN}/kill <nom>${RESET}           Tuer un agent en arrière-plan`)
  console.log(`${GREEN}/skills${RESET}               Lister les skills disponibles`)
  console.log(`${GREEN}/skills <nom>${RESET}          Afficher le contenu complet d'une skill\n`)
  console.log(`${BOLD}Permissions :${RESET}`)
  console.log(`  ${GREEN}/permissions${RESET}           Voir l\'état des permissions`)
  console.log(`  ${GREEN}/permissions show <agent>${RESET} Voir les règles d\'un agent`)
  console.log(`  ${GREEN}/permissions edit <agent>${RESET} Modifier les règles`)
  console.log(`  ${GREEN}/permissions reload${RESET}    Recharger la configuration`)
  console.log(`  ${YELLOW}!permissions${RESET}           Commandes permissions depuis le prompt`)
  console.log(`  ${YELLOW}!permissions agents${RESET}        Lister les agents enregistrés`)
  console.log(`  ${YELLOW}!permissions grant <id> path|cmd <value> [min] [raison]${RESET} Accès temporaire`)
  console.log(`  ${YELLOW}!permissions revoke <id> [path|cmd] [value]${RESET} Révoquer accès`)
  console.log(`  ${YELLOW}!permissions grants [id]${RESET}     Voir les accès temporaires\n`)
  console.log(`${BOLD}Banc de tests :${RESET}`)
  console.log(`  ${GREEN}501${RESET}         Menu principal — Banc de tests`)
  console.log(`  ${GREEN}/test${RESET}       Ouvrir le banc de tests (contexte + routeurs)\n`)
  console.log(`${BOLD}Projets :${RESET}`)
  console.log(`  ${GREEN}/project${RESET}               Menu projets interactif`)
  console.log(`  ${GREEN}/tasks <projet>${RESET}        Raccourci : tâches d\'un projet`)
  console.log(`  ${YELLOW}!project create <nom>${RESET}  Créer un projet`)
  console.log(`  ${YELLOW}!project list${RESET}          Lister les projets`)
  console.log(`  ${YELLOW}!project use <nom>${RESET}     Définir le projet courant`)
  console.log(`  ${YELLOW}!project show <nom>${RESET}    Détails d\'un projet`)
  console.log(`  ${YELLOW}!project tasks <nom>${RESET}   Tâches d\'un projet`)
  console.log(`  ${YELLOW}!project archive <nom>${RESET} Archiver`)
  console.log(`  ${YELLOW}!project delete <nom>${RESET}  Supprimer`)
  console.log(`  ${YELLOW}!project init <nom>${RESET}       Initialiser un dossier existant`)
  console.log(`  ${YELLOW}!project task <nom> add <area> <titre>${RESET} Ajouter une tâche`)
  console.log(`  ${YELLOW}!project task <nom> done|start <id>${RESET} Màj statut tâche\n`)
  console.log(`${BOLD}Prompt modes :${RESET}`)
  console.log(`  ${YELLOW}!commande${RESET}            Exécuter une commande shell`)
  console.log(`  ${YELLOW}@message${RESET}             Ajouter un message assistant`)
  console.log(`  ${YELLOW}!spawn <id> <instruction>${RESET} Lancer un agent en arrière-plan`)
  console.log(`  ${YELLOW}!spawn timer-man <interval>${RESET} Daemon timer longue durée`)
  console.log(`  ${YELLOW}!suggestions${RESET}          Suggestions contextuelles dynamiques`)
  console.log(`  ${YELLOW}texte${RESET}                Envoyer un prompt à l'agent LLM`)
  console.log(`  ${YELLOW}/exit${RESET}                Quitter\n`)
}
