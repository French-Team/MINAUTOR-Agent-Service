import { loadSkill } from './skills.js'
import { loadUserProfile, getDisplayName } from './cli-user.js'
import {
  RESET, CYAN, GREEN, GRAY,
} from './constants.js'

/**
 * Affiche le message de chargement de la skill au démarrage.
 */
export function logSkillLoaded(): void {
  const aliceSkill = loadSkill('skill-alice')
  if (aliceSkill) {
    console.log(`\n${GREEN}✓ Skill "${aliceSkill.meta.name}" chargée${RESET}`)
    console.log(`  ${GRAY}${aliceSkill.meta.description}${RESET}\n`)
  }
}

/**
 * Affiche le message de démarrage du daemon telecom.
 */
export function logDaemonStarted(): void {
  console.log(`${GREEN}✓ Daemon telecom démarré${RESET}`)
}

/**
 * Affiche le message de bienvenue personnalisé (prénom/pseudo du profil).
 */
export function logWelcomeMessage(): void {
  const profile = loadUserProfile()
  const name = getDisplayName(profile)

  if (name !== 'user') {
    console.log(`${GREEN}👋 Bonjour ${CYAN}${name}${GREEN} ! Bienvenue dans Minautor Agent Service.${RESET}\n`)
  } else {
    console.log(`${GREEN}👋 Bienvenue dans Minautor Agent Service.${RESET}`)
    console.log(`${GRAY}   Configure ton profil avec le menu ${CYAN}9${GRAY} ou la commande ${CYAN}/profile${GRAY}.${RESET}\n`)
  }
}
