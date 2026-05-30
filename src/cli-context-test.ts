/**
 * CLI Context Test
 *
 * Menu interactif (choix 11-15) pour tester les profils de compression
 * de contexte sans lancer une session LLM.
 *
 * Chaque choix affiche :
 *   - Le nom du profil, sa description, et les options de compression
 *   - Un modèle exemple qui déclenche ce profil
 *   - Le détail de la résolution (règle matchée)
 *   - L'optimiseur en action sur un texte verbeux (règles appliquées + ratio)
 *   - Les stats de compression du pipeline
 */

import { resolveProfileDetail, resolveContextOptions, PROFILES } from './telecom/service/context/index.js'
import { optimiserDetail, optimiser } from './telecom/service/context/telecom-context-optimiser.js'
import { RESET, CYAN, GREEN, YELLOW, RED, GRAY, BOLD } from './constants.js'
import { readFileSync } from 'fs'
import { join } from 'path'

// ── Échantillons de test ────────────────────────────────

interface TestCase {
  label: string
  model: string
  profileName: string
  displayTitle?: string  // surcharge l'affichage du titre (pour les routeurs)
}

const TEST_CASES: TestCase[] = [
  // ── Profils de compression (11-15) ──
  { label: 'tiny',   model: 'liquid/lfm2.5-1.2b',        profileName: 'tiny' },
  { label: 'small',  model: 'llama3.2-3b',                profileName: 'small' },
  { label: 'medium', model: 'mistral-7b',                 profileName: 'medium' },
  { label: 'large',  model: 'gpt-4',                      profileName: 'large' },
  { label: 'huge',   model: 'gemini-2.5-flash',           profileName: 'huge' },

  // ── Routeurs génériques (16-20) : destination inconnue → small conservateur ──
  { label: 'routeur', model: 'kilo-auto/free',            profileName: 'small',      displayTitle: 'Routeur Kilo Gateway' },
  { label: 'routeur', model: 'openrouter/free',           profileName: 'small',      displayTitle: 'Routeur OpenRouter' },
  { label: 'routeur', model: 'gpt-4:free',                profileName: 'small',      displayTitle: 'Routeur :free' },
  { label: 'routeur', model: 'opencode-zen/default',      profileName: 'small',      displayTitle: 'Routeur Opencode Zen' },
  { label: 'routeur', model: 'local-model',               profileName: 'small',      displayTitle: 'Routeur LM Studio fallback' },
  { label: 'routeur', model: 'custom/my-model',            profileName: 'small',      displayTitle: 'Routeur Custom provider' },

  // ── Règles additionnelles (23) ──
  { label: 'medium', model: 'llama-3.1-8b',                profileName: 'medium',     displayTitle: 'Llama3.1 8B (règle #20 spécifique)' },
]

/**
 * Petit échantillon pour démontrer les règles de l'optimiseur (politesses → compact).
 * Suffisamment court pour voir les règles appliquées une par une.
 */
const VERBOSE_SAMPLE =
  "Bonjour, est-ce que tu peux s'il te plaît analyser ce code pour moi ? " +
  "Merci beaucoup d'avance. Je pense que c'est un bug dans la fonction de login. " +
  "En fait, je voudrais savoir s'il te plaît comment on pourrait corriger ce problème. " +
  "Désolé du dérangement, et merci encore pour ton aide."

/**
 * Échantillon long (~5000 car) pour démontrer l'effet de la troncature
 * maxCharsPerMessage propre à chaque profil.
 * Chargé en répétitions, reformulations, détails superflus — exactement
 * ce que l'optimiseur + la troncature éliminent.
 */
const LONG_SAMPLE =
  "Bonjour, est-ce que tu peux s'il te plaît analyser ce code pour moi ? " +
  "Merci beaucoup d'avance. Je pense que c'est un bug dans la fonction de login. " +
  "En fait, je voudrais savoir s'il te plaît comment on pourrait corriger ce problème. " +
  "Désolé du dérangement, et merci encore pour ton aide. Voici le code : " +
  "function login(username, password) { console.log('Connecting to database...'); " +
  "let user = db.query('SELECT * FROM users WHERE username = ?', [username]); " +
  "if (!user) { console.log('User not found'); return false; } " +
  "let hash = bcrypt.hash(password, 10); console.log('Password hashed successfully'); " +
  "if (bcrypt.compare(password, user.password)) { console.log('Password match!'); " +
  "let token = jwt.sign({ id: user.id, role: user.role }, 'secret-key', { expiresIn: '1h' }); " +
  "console.log('Token generated:', token); return token; } else { console.log('Password mismatch'); return false; } } " +
  "J'ai essayé plusieurs approches. D'abord, j'ai vérifié la connexion à la base de données. " +
  "Pourrais-tu s'il te plaît regarder cette partie du code ? " +
  "Je me demandais aussi si tu pouvais checker la fonction de hashage. " +
  "J'ai besoin de ton aide sur ce point précis s'il te plaît. " +
  "Merci d'avance pour ton retour. " +
  "Voilà, c'est tout ce que j'avais à te montrer. " +
  "En réalité, je pense que le problème vient de la gestion des tokens JWT. " +
  "J'aimerais vraiment avoir ton avis là-dessus. " +
  "S'il te plaît, est-ce que tu pourrais jeter un oeil à la fonction de vérification aussi ? " +
  "C'est juste une petite modification, mais je n'arrive pas à la faire marcher. " +
  "Je te remercie infiniment pour ton aide sur ce sujet. " +
  "Bon, je vais te laisser, à bientôt et encore merci ! " +
  "D'ailleurs, j'ai oublié de mentionner que j'utilise Express.js avec Sequelize comme ORM. " +
  "Je suis désolé de ne pas l'avoir précisé plus tôt. " +
  "La base de données est PostgreSQL, version 15. " +
  "J'ai déjà vérifié les logs PostgreSQL et je ne vois rien d'anormal. " +
  "Peut-être que le problème vient du middleware d'authentification ? " +
  "Je pourrais essayer de désactiver le middleware pour voir, " +
  "mais je préfère avoir ton avis avant de faire ce genre de modification. " +
  "Qu'est-ce que tu en penses ? Est-ce que ça te semble une bonne approche ? " +
  "Merci encore une fois, vraiment, pour toute l'aide que tu m'apportes."

export function runContextTest(choice: string): void {
  // ── Choix 22 : résumé de tous les routeurs actifs ──
  if (choice === '22') {
    showRouterSummary()
    return
  }

  // ── Choix 23 : Llama3 8B (dernier élément du tableau) ──
  const idx = choice === '23' ? TEST_CASES.length - 1 : parseInt(choice, 10) - 11
  if (idx < 0 || idx >= TEST_CASES.length) return

  const test = TEST_CASES[idx]

  // ── Résolution du profil ──
  const detail = resolveProfileDetail(test.model)
  const options = resolveContextOptions(test.model)

  console.log(`\n${BOLD}${CYAN}════════════════════════════════════════════${RESET}`)
  const testTitle = test.displayTitle ?? `Profil ${test.profileName}`
  console.log(`${BOLD}${CYAN}  Test : ${testTitle}${RESET}`)
  console.log(`${BOLD}${CYAN}════════════════════════════════════════════${RESET}\n`)

  // Description du profil
  const prof = PROFILES[test.profileName as keyof typeof PROFILES]
  console.log(`  ${BOLD}Description :${RESET}`)
  console.log(`  ${GRAY}${prof?.description ?? '—'}${RESET}\n`)

  // Résolution
  console.log(`  ${BOLD}Modèle exemple :${RESET} ${CYAN}${test.model}${RESET}`)
  console.log(`  ${BOLD}Profil résolu :${RESET} ${YELLOW}${detail.profile.name}${RESET}`)
  console.log(`  ${BOLD}Raison :${RESET} ${GRAY}${detail.reason}${RESET}\n`)

  // Options du profil
  console.log(`  ${BOLD}Options de compression :${RESET}`)
  console.log(`    ${GREEN}keepRecent${RESET}       : ${options.keepRecent} messages`)
  const maxTokensMsg = Math.ceil((options.maxCharsPerMessage ?? 0) / 4)
  console.log(`    ${GREEN}maxCharsPerMessage${RESET} : ${options.maxCharsPerMessage ?? '—'} car.  ${GRAY}(≈ ${maxTokensMsg} tokens)${RESET}`)
  const maxTokensSum = Math.ceil((options.maxCharsPerSummaryLine ?? 0) / 4)
  console.log(`    ${GREEN}maxCharsPerSummaryLine${RESET} : ${options.maxCharsPerSummaryLine ?? '—'} car.  ${GRAY}(≈ ${maxTokensSum} tokens)${RESET}\n`)

  // ── Test de l'optimiseur (échantillon court) ──
  console.log(`  ${BOLD}1. Règles de l'optimiseur (échantillon court) :${RESET}`)
  console.log(`  ${GRAY}Texte source (${VERBOSE_SAMPLE.length} car.) :${RESET}`)
  console.log(`  "${YELLOW}${VERBOSE_SAMPLE}${RESET}"\n`)

  const result = optimiserDetail(VERBOSE_SAMPLE, { trace: true })

  const inputChars = VERBOSE_SAMPLE.length
  const outputChars = result.text.length
  const ratio = inputChars > 0 ? ((1 - outputChars / inputChars) * 100).toFixed(1) : '0.0'
  const inputTokens = Math.ceil(inputChars / 4)
  const outputTokens = Math.ceil(outputChars / 4)
  const tokenRatio = inputTokens > 0 ? ((1 - outputTokens / inputTokens) * 100).toFixed(1) : '0.0'

  console.log(`  ${BOLD}Résultat :${RESET}`)
  console.log(`    ${GRAY}Caractères : ${inputChars} → ${outputChars}  (-${ratio}%)${RESET}`)
  console.log(`    ${GRAY}Tokens      : ${inputTokens} → ${outputTokens}  (-${tokenRatio}%)  ${YELLOW}(estimation à 4 car./token)${RESET}`)
  console.log(`  "${GREEN}${result.text}${RESET}"\n`)

  if (result.applied.length > 0) {
    console.log(`  ${BOLD}Règles appliquées :${RESET}`)
    for (const rule of result.applied) {
      console.log(`    ${CYAN}▸${RESET} ${rule}`)
    }
  } else {
    console.log(`  ${GRAY}Aucune règle appliquée (texte déjà compact).${RESET}`)
  }

  // ── Troncature par profil (échantillon long) ──
  const maxChars = options.maxCharsPerMessage ?? 1200
  const longOpt = optimiser(LONG_SAMPLE)
  const truncated = longOpt.length > maxChars
    ? longOpt.slice(0, maxChars - 1) + '…'
    : longOpt

  const sectionLabel = test.label === 'routeur'
    ? `Routeur « ${test.displayTitle ?? test.model} » (profil ${detail.profile.name})`
    : `Profil « ${test.profileName} »`

  console.log(`\n  ${BOLD}2. Troncature ${sectionLabel} (max ${maxChars} car.) :${RESET}`)
  console.log(`  ${GRAY}Résolution : ${detail.reason}${RESET}`)
  console.log(`  ${GRAY}Source long (${LONG_SAMPLE.length} car.) → optimisé (${longOpt.length} car.) → tronqué (${truncated.length} car.)${RESET}`)

  const longSaved = LONG_SAMPLE.length - truncated.length
  const longRatio = ((1 - truncated.length / LONG_SAMPLE.length) * 100).toFixed(1)
  console.log(`  ${GREEN}Compression totale (optim. + troncature) : ${longSaved} car.  (-${longRatio}%)${RESET}`)

  // Afficher les premiers et derniers caractères
  const preview = truncated.length > 120
    ? truncated.slice(0, 80) + '  …  ' + truncated.slice(-30)
    : truncated
  console.log(`  "${CYAN}${preview}${RESET}"\n`)

  // Barre de progression visuelle
  const barLen = 30
  const used = Math.min(1, longOpt.length / maxChars)
  const filled = Math.round(barLen * used)
  const empty = barLen - filled
  const barColor = used > 0.9 ? RED : used > 0.7 ? YELLOW : GREEN
  const bar = `${barColor}${'█'.repeat(filled)}${GRAY}${'░'.repeat(empty)}${RESET}`
  console.log(`  ${BOLD}Limite :${RESET} ${bar}  ${longOpt.length}/${maxChars} car.  ${used > 0.9 ? '⚠' : '✓'}`)

  console.log(`\n${BOLD}${CYAN}════════════════════════════════════════════${RESET}\n`)
}

// ── Résumé des routeurs actifs ─────────────────────────

interface JsonRouterEntry {
  pattern: string
  flags: string
  reason?: string
}

function showRouterSummary(): void {
  const jsonPath = join(process.cwd(), 'data', 'model-profiles.json')
  let raw: string
  try {
    raw = readFileSync(jsonPath, 'utf-8')
  } catch {
    console.log(`\n${RED}✗ Fichier introuvable : ${jsonPath}${RESET}\n`)
    return
  }

  let data: { routerPatterns: JsonRouterEntry[] }
  try {
    data = JSON.parse(raw) as { routerPatterns: JsonRouterEntry[] }
  } catch {
    console.log(`\n${RED}✗ Fichier JSON invalide${RESET}\n`)
    return
  }

  const routeurs = data.routerPatterns
  if (!routeurs || routeurs.length === 0) {
    console.log(`\n${YELLOW}Aucun routeur configuré.${RESET}\n`)
    return
  }

  // Titre
  console.log(`\n${BOLD}${CYAN}════════════════════════════════════════════${RESET}`)
  console.log(`${BOLD}${CYAN}  Résumé : Routeurs génériques actifs${RESET}`)
  console.log(`${BOLD}${CYAN}════════════════════════════════════════════${RESET}\n`)

  // En-tête
  const hdr = `${BOLD}${GRAY}#   Pattern                          → Profil   Flags   Raison${RESET}`
  console.log(`  ${hdr}`)
  console.log(`  ${GRAY}──  ${'─'.repeat(70)}${RESET}`)

  // Lignes
  for (let i = 0; i < routeurs.length; i++) {
    const r = routeurs[i]
    const num = `${i + 1}`.padStart(2)
    const pattern = r.pattern.padEnd(33).slice(0, 33)
    const flags = r.flags.padEnd(5)
    const reason = r.reason ?? '—'

    // Tester chaque routeur avec un modèle exemple
    console.log(`  ${CYAN}${num}${RESET}  ${GREEN}/${pattern}${RESET}  ${YELLOW}small${RESET}  ${flags}  ${GRAY}${reason}${RESET}`)
  }

  // Pied de tableau
  console.log(`  ${GRAY}──  ${'─'.repeat(70)}${RESET}`)
  console.log(`  ${BOLD}${routeurs.length} routeur(s) actif(s)${RESET}  →  ${YELLOW}tous → profil small (conservateur)${RESET}`)
  console.log(`  ${GRAY}Pour tester un routeur individuellement : ${BOLD}16-21${RESET}`)
  console.log(`  ${GRAY}Pour tester les profils de compression : ${BOLD}11-15${RESET}\n`)
  console.log(`${BOLD}${CYAN}════════════════════════════════════════════${RESET}\n`)
}
