/**
 * Système de notifications inter-processus.
 * Les agents en arrière-plan (timer, etc.) écrivent des notifications
 * dans un fichier JSON partagé. Le CLI les lit avant chaque prompt
 * pour les afficher à l'utilisateur.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

export interface Notification {
  id: string
  from: string
  message: string
  timestamp: string
}

const NOTIFY_PATH = join(process.cwd(), '.notifications.json')

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
  writeFileSync(NOTIFY_PATH, JSON.stringify(notifications, null, 2), 'utf-8')
}

/** Ajouter une notification (utilisé par les agents enfants) */
export function pushNotification(from: string, message: string): void {
  const notifications = load()
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  notifications.push({
    id,
    from,
    message,
    timestamp: new Date().toISOString(),
  })
  save(notifications)
}

/** Lire et effacer toutes les notifications en attente (utilisé par le CLI) */
export function popAllNotifications(): Notification[] {
  const notifications = load()
  if (notifications.length > 0) {
    writeFileSync(NOTIFY_PATH, '[]', 'utf-8')
  }
  return notifications
}

/** Lire sans effacer */
export function peekNotifications(): Notification[] {
  return load()
}

export function getNotifyPath(): string {
  return NOTIFY_PATH
}
