import { createInterface } from 'readline/promises'
import { listSkills, loadSkill } from './skills.js'
import {
  RESET, CYAN, GREEN, YELLOW, RED, GRAY, BOLD,
} from './constants.js'

export async function handleSkillsMenu(rl: ReturnType<typeof createInterface>): Promise<void> {
  const all = listSkills()

  if (all.length === 0) {
    console.log(`${YELLOW}Aucune skill disponible.${RESET}`)
    return
  }

  while (true) {
    console.log(`\n${BOLD}${CYAN}┌─ Skills & prompts${RESET}`)
    console.log(`${BOLD}${CYAN}│${RESET}`)
    for (let i = 0; i < all.length; i++) {
      const s = all[i]
      console.log(`${BOLD}${CYAN}│  ${RESET}${CYAN}${i + 1}${RESET}. ${s.name}`)
      console.log(`${BOLD}${CYAN}│${RESET}     ${GRAY}${s.description}${RESET}`)
    }
    console.log(`${BOLD}${CYAN}│${RESET}`)
    console.log(`${BOLD}${CYAN}│  ${RESET}${CYAN}0${RESET}. Retour au menu principal`)
    console.log(`${BOLD}${CYAN}└${RESET}`)

    const choice = (await rl.question(`\n${CYAN}Choix${RESET} ${GRAY}>${RESET} `)).trim()

    if (choice === '0') return

    const idx = parseInt(choice, 10) - 1
    if (isNaN(idx) || idx < 0 || idx >= all.length) {
      console.log(`${YELLOW}Choix invalide.${RESET}`)
      continue
    }

    const selected = all[idx]
    const skill = loadSkill(selected.name)
    if (!skill) {
      console.log(`${RED}Impossible de charger \"${selected.name}\".${RESET}`)
      continue
    }

    // Afficher le contenu complet (sans le frontmatter YAML)
    const body = skill.content.replace(/---[\s\S]*?---\n/, '').trim()
    console.log(`\n${BOLD}${CYAN}════════════════════════════════════════════${RESET}`)
    console.log(`${BOLD}${CYAN}  ${skill.meta.name}${RESET}`)
    if (skill.meta.category) console.log(`  ${GRAY}${skill.meta.category}${RESET}`)
    console.log(`  ${GREEN}${skill.meta.description}${RESET}`)
    console.log(`${BOLD}${CYAN}════════════════════════════════════════════${RESET}\n`)
    console.log(`${body}\n`)
    console.log(`${GRAY}Appuyez sur Entrée pour revenir à la liste.${RESET}`)

    // Attendre que l'utilisateur confirme avoir lu
    await rl.question('')
  }
}

export function showSkillsList(): void {
  const all = listSkills()
  if (all.length === 0) {
    console.log(`${YELLOW}Aucune skill disponible.${RESET}`)
    return
  }
  console.log(`\n${BOLD}Skills disponibles (${all.length}) :${RESET}`)
  for (const s of all) {
    console.log(`  ${CYAN}${s.name}${RESET}  ${GRAY}${s.description}${RESET}`)
  }
  console.log(`\n${YELLOW}Utilisez /skills <nom> pour voir le contenu d'une skill.${RESET}`)
  console.log(`  ${GRAY}Entrée vide ou /menu pour revenir au menu principal.${RESET}\n`)
}
