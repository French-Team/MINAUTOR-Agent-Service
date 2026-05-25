import { createInterface } from 'readline/promises'
import { BOLD, CYAN, GRAY, YELLOW, RESET } from './constants.js'

export async function handleCommandPicker(rl: ReturnType<typeof createInterface>): Promise<string | null> {
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

  console.log(`\n${BOLD}${CYAN}╔ Sélecteur de commandes${RESET}`)
  for (const p of picker) {
    console.log(`${BOLD}${CYAN}║ ${CYAN}${String(p.num).padStart(2)}${RESET}. ${p.cmd}  ${GRAY}${p.label}${RESET}`)
  }
  console.log(`${BOLD}${CYAN}╚${RESET}`)

  const pick = (await rl.question(`\n${CYAN}Choix${RESET} ${GRAY}>${RESET} `)).trim()
  if (!pick) return null

  const picked = picker.find(p => p.num === parseInt(pick) || p.cmd === '/' + pick)
  if (picked) {
    return picked.cmd
  }

  console.log(`${YELLOW}Commande inconnue.${RESET}`)
  return null
}
