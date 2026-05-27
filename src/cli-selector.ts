import { createInterface } from 'readline/promises'
import { BOLD, CYAN, GRAY, YELLOW, RESET } from './constants.js'

interface PickerSection {
  title: string
  items: { cmd: string; label: string }[]
}

const SECTIONS: PickerSection[] = [
  {
    title: '🔧 Configuration',
    items: [
      { cmd: '/providers', label: 'Gérer les providers' },
      { cmd: '/providers add', label: 'Ajouter un provider' },
      { cmd: '/providers key <nom> <clé>', label: 'Définir une clé API' },
      { cmd: '/providers model <nom> <modèle>', label: 'Changer le modèle' },
      { cmd: '/providers scan', label: 'Scanner les providers locaux' },
      { cmd: '/providers enable <nom>', label: 'Activer un provider' },
      { cmd: '/providers disable <nom>', label: 'Désactiver un provider' },
      { cmd: '/providers keys <nom>', label: 'Voir les clés' },
      { cmd: '/providers addkey <nom>', label: 'Ajouter une clé' },
      { cmd: '/providers removekey <nom>', label: 'Supprimer une clé' },
      { cmd: '/providers remove <nom>', label: 'Supprimer un provider' },
      { cmd: '/providers local', label: 'Statut des providers locaux' },
      { cmd: '/profile', label: 'Mon profil utilisateur' },
    ],
  },
  {
    title: '🤖 Agents',
    items: [
      { cmd: '/create', label: 'Créer un agent' },
      { cmd: '/edit', label: 'Éditer un agent' },
      { cmd: '/agents', label: 'Voir les agents' },
      { cmd: '/use <id>', label: 'Charger un agent' },
      { cmd: '/load <path>', label: 'Charger depuis un fichier' },
    ],
  },
  {
    title: '💬 Sessions',
    items: [
      { cmd: '/start', label: 'Démarrer une session' },
      { cmd: '/new', label: 'Nouvelle session' },
      { cmd: '/session <id>', label: 'Changer de session' },
      { cmd: '/sessions', label: 'Voir les sessions' },
      { cmd: '/info', label: 'Info session active' },
    ],
  },
  {
    title: '📊 Monitoring',
    items: [
      { cmd: '/status', label: 'Status système (intercom, daemon)' },
      { cmd: '/notifications', label: 'Voir le filtre notifications' },
      { cmd: '/notifications filter <niveau>', label: 'Changer le filtre' },
      { cmd: '/notifications history <jours>', label: 'Historique notifications' },
      { cmd: '/logbook', label: 'Voir le logbook' },
      { cmd: '/ps', label: 'Agents en arrière-plan' },
      { cmd: '/kill <nom>', label: 'Tuer un agent' },
    ],
  },
  {
    title: '🧠 Skills',
    items: [
      { cmd: '/skills', label: 'Lister les skills' },
      { cmd: '/skills <nom>', label: 'Voir le contenu d\'une skill' },
    ],
  },
  {
    title: '📁 Projets',
    items: [
      { cmd: '/project', label: 'Menu projets interactif' },
      { cmd: '!project create <nom> [description]', label: 'Créer un projet' },
      { cmd: '!project list', label: 'Lister les projets' },
      { cmd: '!project use <nom>', label: 'Définir le projet courant (injecté dans intercom)' },
      { cmd: '!project use', label: 'Désélectionner le projet courant' },
      { cmd: '!project show <nom>', label: 'Détails d\'un projet' },
      { cmd: '!project init <nom>', label: 'Initialiser un dossier existant' },
      { cmd: '!project tasks <nom> [area]', label: 'Tâches d\'un projet' },
      { cmd: '!project task <nom> add <area> <titre>', label: 'Ajouter une tâche' },
      { cmd: '!project archive <nom>', label: 'Archiver un projet' },
      { cmd: '!project delete <nom>', label: 'Supprimer un projet' },
      { cmd: '/tasks <project>', label: 'Raccourci : tâches d\'un projet' },
    ],
  },
  {
    title: '❓ Aide & Navigation',
    items: [
      { cmd: '/help', label: 'Aide / commandes' },
      { cmd: '/menu', label: 'Afficher le menu principal' },
      { cmd: '/exit', label: 'Quitter' },
    ],
  },
]

// Aplatir pour la recherche par numéro ou commande
function flatten(): { num: number; section: string; cmd: string; label: string }[] {
  let num = 0
  const flat: { num: number; section: string; cmd: string; label: string }[] = []
  for (const section of SECTIONS) {
    for (const item of section.items) {
      num++
      flat.push({ num, section: section.title, ...item })
    }
  }
  return flat
}

const ALL_ITEMS = flatten()

export async function handleCommandPicker(rl: ReturnType<typeof createInterface>): Promise<string | null> {
  console.log(`\n${BOLD}${CYAN}╔ Sélecteur de commandes${RESET}`)
  console.log(`${BOLD}${CYAN}║  Tape un numéro ou une commande (/...)   ${RESET}`)
  console.log(`${BOLD}${CYAN}╚${RESET}`)

  for (const section of SECTIONS) {
    console.log(`\n  ${BOLD}${section.title}${RESET}`)
    for (const item of section.items) {
      const entry = ALL_ITEMS.find(e => e.cmd === item.cmd)!
      console.log(`  ${CYAN}${String(entry.num).padStart(2)}${RESET}. ${item.cmd}  ${GRAY}${item.label}${RESET}`)
    }
  }

  console.log(`\n  ${CYAN}0${RESET}. Retour\n`)

  const pick = (await rl.question(`${CYAN}Choix${RESET} ${GRAY}>${RESET} `)).trim()
  if (!pick || pick === '0') return null

  // Recherche par numéro
  const byNum = ALL_ITEMS.find(e => e.num === parseInt(pick))
  if (byNum) return byNum.cmd

  // Recherche par commande (avec ou sans /)
  const byCmd = ALL_ITEMS.find(e => pick.startsWith('/') ? e.cmd === pick : e.cmd === '/' + pick)
  if (byCmd) return byCmd.cmd

  console.log(`${YELLOW}Commande inconnue. Tape un numéro ou /commande.${RESET}`)
  return null
}
