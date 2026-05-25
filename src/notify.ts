/**
 * Système de notifications inter-processus.
 * Les agents en arrière-plan (timer, etc.) écrivent des notifications
 * dans un fichier JSON partagé. Le CLI les lit avant chaque prompt
 * pour les afficher à l'utilisateur.
 *
 * Niveaux : info | questions | tache | missions | mise-en-place | plan
 *           storyboard | todo-list | avertissement | warning | conclusion | urgent
 *
 * Le CLI peut filtrer via /notifications filter <niveau>
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs'
import { join } from 'path'

export type NotificationLevel =
  | 'info'
  | 'questions'
  | 'tache'
  | 'missions'
  | 'mise-en-place'
  | 'plan'
  | 'storyboard'
  | 'todo-list'
  | 'avertissement'
  | 'warning'
  | 'conclusion'
  | 'urgent'

export interface Notification {
  id: string
  from: string
  message: string
  level: NotificationLevel
  timestamp: string
}

const NOTIFY_PATH = join(process.cwd(), 'telecom', 'notifications.json')
const FILTER_PATH = join(process.cwd(), 'telecom', 'notification-filter')
const ARCHIVE_DIR = join(process.cwd(), 'telecom', 'notifications')
const MAX_ARCHIVE_DAYS = 30 // garder 30 jours d'historique

const LEVEL_ORDER: Record<NotificationLevel, number> = {
  info: 0,
  questions: 1,
  tache: 2,
  missions: 3,
  'mise-en-place': 4,
  plan: 5,
  storyboard: 6,
  'todo-list': 7,
  avertissement: 8,
  warning: 8,
  conclusion: 9,
  urgent: 10,
}

/** Liste complète des niveaux avec leur description courte */
export function listLevels(): { level: NotificationLevel; icon: string; description: string }[] {
  return [
    { level: 'info', icon: '🔔', description: 'Informations générales' },
    { level: 'questions', icon: '❓', description: 'Questions posées' },
    { level: 'tache', icon: '📋', description: 'Tâche' },
    { level: 'missions', icon: '🎯', description: 'Mission' },
    { level: 'mise-en-place', icon: '⚙️', description: 'Mise en place' },
    { level: 'plan', icon: '📐', description: 'Plan' },
    { level: 'storyboard', icon: '🎬', description: 'Storyboard' },
    { level: 'todo-list', icon: '✅', description: 'Todo list' },
    { level: 'avertissement', icon: '🟡', description: 'Avertissement' },
    { level: 'warning', icon: '🟡', description: 'Warning' },
    { level: 'conclusion', icon: '📊', description: 'Conclusion' },
    { level: 'urgent', icon: '🔴', description: 'Urgent' },
  ]
}

/** Liste des noms de niveaux valides (pour validation rapide) */
const VALID_LEVELS = new Set<NotificationLevel>([
  'info', 'questions', 'tache', 'missions', 'mise-en-place',
  'plan', 'storyboard', 'todo-list', 'avertissement', 'warning',
  'conclusion', 'urgent',
])

function load(): Notification[] {
  if (!existsSync(NOTIFY_PATH)) return []
  try {
    const raw = readFileSync(NOTIFY_PATH, 'utf-8').trim()
    if (!raw) return []
    return JSON.parse(raw) as Notification[]
  } catch {
    return []
  }
}

function save(notifications: Notification[]): void {
  const dir = join(NOTIFY_PATH, '..')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(NOTIFY_PATH, JSON.stringify(notifications, null, 2), 'utf-8')
}

/** Lire le filtre actif */
export function getNotificationFilter(): NotificationLevel | 'off' {
  try {
    if (existsSync(FILTER_PATH)) {
      const raw = readFileSync(FILTER_PATH, 'utf-8').trim()
      if (raw === 'off') return 'off'
      if (VALID_LEVELS.has(raw as NotificationLevel)) {
        return raw as NotificationLevel
      }
    }
  } catch { /* fallback */ }
  return 'info' // défaut : tout voir
}

/** Définir le filtre */
export function setNotificationFilter(level: NotificationLevel | 'off'): void {
  const dir = join(FILTER_PATH, '..')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(FILTER_PATH, level, 'utf-8')
}

/**
 * Nettoie le message d'une notification pour l'affichage utilisateur :
 * - Supprime les blocs de code markdown (```...```)
 * - Supprime le code inline (`code`)
 * - Supprime les lignes d'instructions bash/routing internes
 * - Supprime les tags HTML (<from>, <to>, etc.)
 * - Nettoie les lignes vides et l'espacement superflu
 */
export function sanitizeNotificationMessage(raw: string): string {
  let msg = raw

  // 1. Supprimer les blocs de code markdown (```...```)
  msg = msg.replace(/```[\s\S]*?```/g, '')

  // 2. Supprimer le code inline (`code`)
  msg = msg.replace(/`[^`]+`/g, '')

  // 3. Supprimer les lignes d'instructions bash/routing internes
  const lines = msg.split('\n')
  const cleaned = lines.filter(line => {
    const trimmed = line.trim()

    // Lignes vides
    if (!trimmed) return false

    // Commandes shell internes uniquement (patterns spécifiques, pas de mots génériques)
    // - "node " / "npm " / "cd " : toujours des commandes en début de ligne
    // - "send <" : routage intercom (pas "send me")
    // - "!" / "$" / "> " : symboles shell
    if (/^(node |npm |cd |send <|!|\$|> )/.test(trimmed)) return false

    // Tags HTML internes (<from>, <to>, <type>, <subject>, <payload>)
    if (/^<\/?\w+>/.test(trimmed)) return false

    // Lignes ne contenant que des tags XML
    if (/^[<>\/\w\s-]+$/.test(trimmed) && /<\/?\w+>/.test(trimmed)) return false

    return true
  })

  // 4. Rejoindre et nettoyer l'espacement
  msg = cleaned.join('\n').replace(/\n{3,}/g, '\n\n').trim()

  return msg
}

/**
 * Ajouter une notification (utilisé par les agents enfants).
 * Le message est automatiquement nettoyé (code blocks, instructions bash).
 * @param from   Source de la notification
 * @param message Contenu
 * @param level  Niveau (défaut: info)
 */
export function pushNotification(from: string, message: string, level?: NotificationLevel): void {
  const cleanMessage = sanitizeNotificationMessage(message)
  if (!cleanMessage) return // rien à notifier

  const notifications = load()
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const notification: Notification = {
    id,
    from,
    message: cleanMessage,
    level: level ?? 'info',
    timestamp: new Date().toISOString(),
  }
  notifications.push(notification)
  save(notifications)

  // Archiver dans telecom/notifications/ pour historique persistant
  archiveNotification(notification)

  // Envoyer via IPC pour affichage temps réel dans le CLI
  try {
    if (typeof process.send === 'function') {
      process.send(
        {
          type: 'notification',
          id,
          from,
          message: cleanMessage,
          level: level ?? 'info',
          timestamp: new Date().toISOString(),
        },
        undefined,
        undefined,
        () => { /* ignoré — le fichier telecom/notifications.json sert de backup */ },
      )
    }
  } catch {
    // IPC indisponible — la notification est déjà dans le fichier
  }
}

/**
 * Lire et effacer les notifications en attente (utilisé par le CLI).
 * Filtre selon le niveau configuré via /notifications filter.
 */
export function popAllNotifications(): Notification[] {
  const notifications = load()
  if (notifications.length === 0) return []

  // Appliquer le filtre actif
  const filter = getNotificationFilter()
  let filtered: Notification[]
  if (filter === 'off') {
    filtered = []
  } else if (filter === 'info') {
    filtered = notifications // tout montrer
  } else {
    // Niveau spécifique : montrer ce niveau et au-dessus
    const minLevel = LEVEL_ORDER[filter]
    filtered = notifications.filter(n => (LEVEL_ORDER[n.level] ?? 0) >= minLevel)
  }

  // Effacer seulement les notifications filtrées (les autres restent)
  if (filtered.length > 0) {
    if (filter === 'info') {
      // tout effacer
      writeFileSync(NOTIFY_PATH, '[]', 'utf-8')
    } else {
      // garder celles qui sont en dessous du filtre
      const kept = notifications.filter(n => !filtered.includes(n))
      save(kept)
    }
  }

  return filtered
}

/** Compter les notifications en attente selon le filtre actif (sans effacer) */
export function countPendingNotifications(): number {
  const notifications = load()
  if (notifications.length === 0) return 0
  const filter = getNotificationFilter()
  if (filter === 'off') return 0
  if (filter === 'info') return notifications.length
  const minLevel = LEVEL_ORDER[filter]
  return notifications.filter(n => (LEVEL_ORDER[n.level] ?? 0) >= minLevel).length
}

/**
 * Supprimer une notification spécifique du fichier par son ID.
 * Utilisé par l'IPC handler pour éviter le double affichage :
 * la notification a déjà été affichée en temps réel, on la retire
 * du fichier pour que le loop ne l'affiche pas une seconde fois.
 */
/**
 * Supprimer une notification spécifique du fichier par son ID.
 * Retourne true si la notification a été trouvée et supprimée,
 * false si elle n'était pas dans le fichier (déjà consommée par le loop).
 */
export function removeNotification(id: string): boolean {
  const notifications = load()
  const filtered = notifications.filter(n => n.id !== id)
  if (filtered.length < notifications.length) {
    save(filtered)
    return true
  }
  return false
}

/**
 * Archive une notification dans telecom/notifications/YYYY-MM-DD.json
 * pour historique persistant. Crée le dossier si nécessaire.
 */
function archiveNotification(n: Notification): void {
  try {
    if (!existsSync(ARCHIVE_DIR)) {
      mkdirSync(ARCHIVE_DIR, { recursive: true })
    }
    const dateKey = n.timestamp.slice(0, 10) // YYYY-MM-DD
    const archivePath = join(ARCHIVE_DIR, `${dateKey}.json`)

    let entries: Notification[] = []
    if (existsSync(archivePath)) {
      try {
        const raw = readFileSync(archivePath, 'utf-8').trim()
        if (raw) entries = JSON.parse(raw)
      } catch { /* ignoré — fichier corrompu, on repart à zéro */ }
    }
    entries.push(n)
    writeFileSync(archivePath, JSON.stringify(entries, null, 2), 'utf-8')
  } catch {
    // Échec silencieux — l'archivage ne doit jamais bloquer une notification
  }
}

/**
 * Nettoie les archives plus vieilles que MAX_ARCHIVE_DAYS jours.
 * Appelé périodiquement.
 */
export function cleanNotificationArchive(): void {
  try {
    if (!existsSync(ARCHIVE_DIR)) return

    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - MAX_ARCHIVE_DAYS)
    const cutoffStr = cutoff.toISOString().slice(0, 10)

    const files = readdirSync(ARCHIVE_DIR).filter(f => f.endsWith('.json'))
    for (const f of files) {
      const dateStr = f.replace(/\.json$/, '')
      if (dateStr < cutoffStr) {
        unlinkSync(join(ARCHIVE_DIR, f))
      }
    }
  } catch { /* ignoré */ }
}

/**
 * Charge l'historique des notifications archivées.
 * @param days Nombre de jours en arrière (défaut: 7)
 */
export function loadNotificationHistory(days: number = 7): Notification[] {
  try {
    if (!existsSync(ARCHIVE_DIR)) return []

    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)
    const cutoffStr = cutoff.toISOString().slice(0, 10)

    const files = readdirSync(ARCHIVE_DIR)
      .filter(f => f.endsWith('.json') && f.replace(/\.json$/, '') >= cutoffStr)
      .sort()

    const all: Notification[] = []
    for (const f of files) {
      try {
        const raw = readFileSync(join(ARCHIVE_DIR, f), 'utf-8').trim()
        if (raw) {
          const entries = JSON.parse(raw) as Notification[]
          all.push(...entries)
        }
      } catch { /* fichier corrompu, on saute */ }
    }

    // Trier par timestamp décroissant (plus récent d'abord)
    all.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    return all
  } catch {
    return []
  }
}

/**
 * Vérifie si une notification doit être affichée selon le filtre actif.
 * Retourne true si le niveau de la notification passe le filtre.
 */
export function shouldShowNotification(level: NotificationLevel): boolean {
  const filter = getNotificationFilter()
  if (filter === 'off') return false
  if (filter === 'info') return true // info = tout montrer
  const minLevel = LEVEL_ORDER[filter]
  const notifOrder = LEVEL_ORDER[level]
  return notifOrder !== undefined && notifOrder >= minLevel
}

/** Lire sans effacer */
export function peekNotifications(): Notification[] {
  return load()
}

export function getNotifyPath(): string {
  return NOTIFY_PATH
}

/** Icône correspondant au niveau ou au mode off */
export function levelIcon(level: NotificationLevel | 'off'): string {
  switch (level) {
    case 'urgent': return '🔴'
    case 'conclusion': return '📊'
    case 'avertissement':
    case 'warning': return '🟡'
    case 'todo-list': return '✅'
    case 'storyboard': return '🎬'
    case 'plan': return '📐'
    case 'mise-en-place': return '⚙️'
    case 'missions': return '🎯'
    case 'tache': return '📋'
    case 'questions': return '❓'
    case 'info': return '🔔'
    case 'off': return '🔕'
    default: return '🔔'
  }
}
