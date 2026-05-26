import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'readline/promises'
import {
  RESET, CYAN, GREEN, GRAY, BOLD,
} from './constants.js'

export interface UserProfile {
  prenom: string
  pseudo: string
  age: string
  description: string
}

const PROFILE_PATH = join(process.cwd(), 'data', 'user', 'profile.json')

export function loadUserProfile(): UserProfile {
  if (!existsSync(PROFILE_PATH)) {
    return { prenom: '', pseudo: '', age: '', description: '' }
  }
  try {
    const raw = readFileSync(PROFILE_PATH, 'utf-8')
    return JSON.parse(raw) as UserProfile
  } catch {
    return { prenom: '', pseudo: '', age: '', description: '' }
  }
}

export function saveUserProfile(profile: UserProfile): void {
  const dir = join(process.cwd(), 'data', 'user')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(PROFILE_PATH, JSON.stringify(profile, null, 2), 'utf-8')
}

export function getDisplayName(profile: UserProfile): string {
  return profile.prenom || profile.pseudo || 'user'
}

export async function editUserProfile(rl: ReturnType<typeof createInterface>): Promise<void> {
  const profile = loadUserProfile()

  console.log(`\n${BOLD}${CYAN}┌─ Mon profil ───────────────────────────┐${RESET}`)
  console.log(`${BOLD}${CYAN}│  Remplis ton profil utilisateur       │${RESET}`)
  console.log(`${BOLD}${CYAN}└─────────────────────────────────────────┘${RESET}\n`)

  const current = profile.prenom || profile.pseudo
  if (current) {
    console.log(`${GRAY}Actuel : ${current}${RESET}\n`)
  }

  const prenom = (await rl.question(`${CYAN}Prénom${RESET} ${GRAY}(${profile.prenom || '—'})${RESET} > `)).trim()
  if (prenom) profile.prenom = prenom

  const pseudo = (await rl.question(`${CYAN}Pseudo${RESET} ${GRAY}(${profile.pseudo || '—'})${RESET} > `)).trim()
  if (pseudo) profile.pseudo = pseudo

  const age = (await rl.question(`${CYAN}Âge${RESET} ${GRAY}(${profile.age || '—'})${RESET} > `)).trim()
  if (age) profile.age = age

  const description = (await rl.question(`${CYAN}Description${RESET} ${GRAY}(${profile.description || '—'})${RESET} > `)).trim()
  if (description) profile.description = description

  saveUserProfile(profile)
  const name = getDisplayName(profile)
  console.log(`\n${GREEN}✓ Profil mis à jour — ${name}${RESET}\n`)
}
