/**
 * Test du pipeline Historien (étape 3.5)
 *
 * Simule des messages de session avec les 5 marqueurs standardisés,
 * puis appelle le module historien pour générer le fichier de suivi.
 * Vérifie que telecom/suivi/last-context.md est créé.
 */

import { existsSync, readFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import type { Message } from './types/agent-definition.js'
import {
  analyserHistorique,
  historienResumePourLLM,
  lireFichierSuivi,
  ajouterMarqueur,
  MARQUEURS,
} from './telecom/service/context/index.js'

const PASS = `${'\x1b[32m'}✓${'\x1b[0m'}`
const FAIL = `${'\x1b[31m'}✗${'\x1b[0m'}`
const BOLD = '\x1b[1m'
const RESET = '\x1b[0m'

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ${PASS} ${label}`)
  } else {
    console.log(`  ${FAIL} ${label}`)
    process.exit(1)
  }
}

function makeTextMessage(role: 'user' | 'assistant', text: string): Message {
  return {
    role,
    content: [{ type: 'text', text }],
  }
}

// ── 1. Test avec marqueurs explicites ──

console.log(`\n${BOLD}Test 1 : Messages avec marqueurs explicites${RESET}\n`)

const messagesAvecMarqueurs: Message[] = [
  makeTextMessage('user', 'On va créer un nouveau module de suivi.'),
  makeTextMessage('assistant', `${MARQUEURS.DECISION} On utilise TypeScript pour le module historien`),
  makeTextMessage('user', 'Ajoutons la persistance des données.'),
  makeTextMessage('assistant', `${MARQUEURS.ACTION} Mise en place de l'écriture du fichier de suivi`),
  makeTextMessage('user', 'Super, l\'équipe doit valider le format avant publication.'),
  makeTextMessage('assistant', `${MARQUEURS.ATTENTE} Retour de l'équipe sur le format du fichier de suivi`),
  makeTextMessage('assistant', `${MARQUEURS.FAIT} Module d'extraction de texte terminé`),
  makeTextMessage('user', 'Documentation des marqueurs dans le README à prévoir.'),
  makeTextMessage('assistant', `${MARQUEURS.TODO} Documenter les marqueurs dans le README du projet`),
]

const rapport1 = analyserHistorique(messagesAvecMarqueurs, {
  sessionName: 'test-historien',
  ecrireFichier: true,
  forceEcriture: true,
})

assert(rapport1.entrees.length === 5, `5 entrées extraites (trouvé: ${rapport1.entrees.length})`)
assert(rapport1.stats.decisions === 1, `1 décision (trouvé: ${rapport1.stats.decisions})`)
assert(rapport1.stats.actions === 1, `1 action (trouvé: ${rapport1.stats.actions})`)
assert(rapport1.stats.faits === 1, `1 réalisé (trouvé: ${rapport1.stats.faits})`)
assert(rapport1.stats.todos === 1, `1 todo (trouvé: ${rapport1.stats.todos})`)
assert(rapport1.stats.attentes === 1, `1 attente (trouvé: ${rapport1.stats.attentes})`)

// Vérifier que le résumé LLM contient le suivi
const resumeLLM = historienResumePourLLM(messagesAvecMarqueurs, {
  sessionName: 'test-historien',
  ecrireFichier: false,
})
assert(resumeLLM.includes('=== SUIVI DE SESSION ==='), 'Résumé LLM contient les délimiteurs')
assert(resumeLLM.includes('On utilise TypeScript'), 'Résumé LLM contient le texte DECISION')
assert(resumeLLM.includes('Mise en place'), 'Résumé LLM contient le texte ACTION')

// ── 2. Test sans marqueurs (heuristiques) ──

console.log(`\n${BOLD}Test 2 : Messages sans marqueurs (heuristiques)${RESET}\n`)

const messagesSansMarqueurs: Message[] = [
  makeTextMessage('assistant', 'On a choisi React pour le frontend.'),
  makeTextMessage('assistant', 'Je travaille sur la configuration du build.'),
  makeTextMessage('assistant', "L'API est terminée et déployée avec succès."),
  makeTextMessage('assistant', 'Il reste à implémenter les tests unitaires.'),
  makeTextMessage('assistant', "J'attends la validation du design pattern."),
]

const rapport2 = analyserHistorique(messagesSansMarqueurs, {
  sessionName: 'test-historien-heuristique',
  ecrireFichier: true,
  forceEcriture: true,
})

const categories = rapport2.entrees.map(e => e.categorie)
assert(categories.includes('decision'), 'Decision détectée par heuristique')
assert(categories.includes('action'), 'Action détectée par heuristique')
assert(categories.includes('fait'), 'Fait détecté par heuristique')
assert(categories.includes('todo'), 'Todo détecté par heuristique')
assert(categories.includes('attente'), 'Attente détectée par heuristique')

// ── 3. Test helper ajouterMarqueur ──

console.log(`\n${BOLD}Test 3 : Helper ajouterMarqueur${RESET}\n`)

const msgDecision = ajouterMarqueur('decision', 'Utiliser React pour le frontend')
assert(msgDecision === '[DECISION] Utiliser React pour le frontend',
  `ajouterMarqueur formate correctement: "${msgDecision}"`)

const msgAction = ajouterMarqueur('action', 'Configurer le pipeline CI')
assert(msgAction === '[ACTION] Configurer le pipeline CI',
  `ajouterMarqueur pour action: "${msgAction}"`)

// ── 4. Test fichier de suivi persistant ──

console.log(`\n${BOLD}Test 4 : Fichier de suivi persistant${RESET}\n`)

const suiviPath = join(process.cwd(), 'telecom', 'suivi', 'test-historien.md')
const suiviPath2 = join(process.cwd(), 'telecom', 'suivi', 'test-historien-heuristique.md')

assert(existsSync(suiviPath), `Fichier de suivi créé: ${suiviPath}`)
assert(existsSync(suiviPath2), `Fichier de suivi heuristique créé: ${suiviPath2}`)

// Lire le contenu du fichier
const contenu = readFileSync(suiviPath, 'utf-8')
assert(contenu.includes('On utilise TypeScript'), 'Fichier contient le texte extrait')
assert(contenu.includes('Mise en place'), 'Fichier contient le texte extrait')
assert(contenu.includes('Module d\'extraction'), 'Fichier contient le texte extrait')
assert(contenu.includes('```json'), 'Fichier contient les données brutes JSON')
assert(contenu.includes('Suivi de session'), 'Fichier contient l\'en-tête')

// Tester lireFichierSuivi
const lu = lireFichierSuivi(undefined, 'test-historien')
assert(lu !== null, 'lireFichierSuivi retourne le contenu')
assert(lu!.includes('On utilise TypeScript'), 'Contenu lu contient le texte extrait')

// Tester avec un fichier inexistant
const inexistant = lireFichierSuivi(undefined, 'inexistant')
assert(inexistant === null, 'lireFichierSuivi retourne null pour fichier inexistant')

// ── 5. Test sessionName par défaut → last-context.md ──

console.log(`\n${BOLD}Test 5 : Session par défaut → last-context.md${RESET}\n`)

const messagesLastContext: Message[] = [
  makeTextMessage('user', 'Salut, commençons le projet.'),
  makeTextMessage('assistant', `${MARQUEURS.DECISION} On utilise une architecture modulaire`),
  makeTextMessage('assistant', `${MARQUEURS.ACTION} Création du squelette du projet`),
]

// Ne pas spécifier sessionName → utilise 'last-context' par défaut
const rapportLC = analyserHistorique(messagesLastContext, {
  ecrireFichier: true,
  forceEcriture: true,
})

const lastContextPath = join(process.cwd(), 'telecom', 'suivi', 'last-context.md')
assert(existsSync(lastContextPath), `Fichier last-context.md créé: ${lastContextPath}`)
assert(rapportLC.entrees.length === 2, '2 entrées extraites dans last-context')

// Lire et vérifier le contenu
const contenuLC = readFileSync(lastContextPath, 'utf-8')
assert(contenuLC.includes('architecture modulaire'), 'last-context.md contient le texte DECISION')
assert(contenuLC.includes('squelette du projet'), 'last-context.md contient le texte ACTION')
assert(contenuLC.includes('```json'), 'last-context.md contient les données JSON')

// Tester aussi historienResumePourLLM (sans sessionName → écrit last-context.md)
const resumeALaVolle = historienResumePourLLM(messagesLastContext, {
  ecrireFichier: true,
  forceEcriture: true,
})
assert(resumeALaVolle.includes('SUIVI DE SESSION'), 'Résumé LLM généré')

// ── 6. Test messages vides ──

console.log(`\n${BOLD}Test 6 : Messages vides${RESET}\n`)

const rapportVide = analyserHistorique([], {
  sessionName: 'test-vide',
  ecrireFichier: false,
})
assert(rapportVide.entrees.length === 0, 'Aucune entrée pour historique vide')
assert(rapportVide.messagesAnalyses === 0, '0 messages analysés')

const resumeVide = historienResumePourLLM([], { ecrireFichier: false })
assert(resumeVide === '', 'Résumé vide pour historique vide')

// ── Synthèse ──

console.log(`\n${BOLD}${'\x1b[32m'}═ Tous les tests passent ═${RESET}\n`)

// ── Nettoyage ──

console.log(`Nettoyage des fichiers de test...`)

const suiviDir = join(process.cwd(), 'telecom', 'suivi')
const filesToClean = ['test-historien.md', 'test-historien-heuristique.md']
for (const f of filesToClean) {
  const fp = join(suiviDir, f)
  if (existsSync(fp)) {
    unlinkSync(fp)
    console.log(`  Supprimé: ${f}`)
  }
}
// Ne pas supprimer .gitignore ni last-context.md s'ils existent

console.log(`\n${BOLD}${'\x1b[32m'}✓ Pipeline historien validé${RESET}`)
