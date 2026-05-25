import type { Engine } from './engine.js'
import {
  RESET, CYAN, GREEN, YELLOW, RED, GRAY, BOLD,
} from './constants.js'

export function showMenu(engine: Engine): void {
  console.log(`${BOLD}${CYAN}╔ Menu principal${RESET}`)
  console.log(`${BOLD}${CYAN}║  ${CYAN}1${RESET}.  Créer un agent`)
  console.log(`${BOLD}${CYAN}║  ${CYAN}2${RESET}.  Démarrer une session`)
  console.log(`${BOLD}${CYAN}║  ${CYAN}3${RESET}.  Voir les agents`)
  console.log(`${BOLD}${CYAN}║  ${CYAN}4${RESET}.  Éditer un agent`)
  console.log(`${BOLD}${CYAN}║  ${CYAN}5${RESET}.  Gérer les providers`)
  console.log(`${BOLD}${CYAN}║  ${CYAN}6${RESET}.  Voir les sessions`)
  console.log(`${BOLD}${CYAN}║  ${CYAN}7${RESET}.  Info session active`)
  console.log(`${BOLD}${CYAN}║  ${CYAN}8${RESET}.  Commandes avancées`)
  console.log(`${BOLD}${CYAN}║  ${CYAN}9${RESET}.  Mon profil`)
  console.log(`${BOLD}${CYAN}╚  ${CYAN}0${RESET}.  Quitter\n`)
  console.log(`${GRAY}Ou tapez /help, /create, /start, /providers, un prompt, !cmd, @message...${RESET}`)
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
  console.log(`  ${GREEN}/info${RESET}      Infos session active`)
  console.log(`  ${GREEN}/status${RESET}    Status systeme (intercom, daemon)`)
  console.log(`  ${GREEN}/notifications${RESET}  Filtre notifications (info/questions/tache/missions/...)`)
  console.log(`  ${GREEN}/notifications filter${RESET}  Choisir le niveau à afficher\n`)
  console.log(`${BOLD}Prompt modes :${RESET}`)
  console.log(`  ${YELLOW}!commande${RESET}   Exécuter une commande shell`)
  console.log(`  ${YELLOW}@message${RESET}    Ajouter un message assistant`)
  console.log(`  ${YELLOW}texte${RESET}       Envoyer un prompt à l'agent`)
  console.log(`  ${YELLOW}/exit${RESET}       Quitter\n`)
}
