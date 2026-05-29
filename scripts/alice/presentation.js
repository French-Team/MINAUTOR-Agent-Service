#!/usr/bin/env node
/**
 * scripts/alice/presentation.js — Présentation complète d'Alice
 * Déclenché quand l'utilisateur dit "bonjour alice"
 *
 * Usage:
 *   node scripts/alice/presentation.js
 *   node scripts/alice/presentation.js --json
 */

const isJson = process.argv.includes('--json')

const response = {
  message: `Bonjour ! Je suis Alice, ton assistante IA.

Mon rôle est simple : je t'accueille, j'écoute ta demande, et je la transmets au service compétent. Je ne code pas, je ne modifie pas de fichiers, je ne fais pas d'analyse technique moi-même — je suis ton interface de confiance vers tout le système.

Voici ce que je peux faire pour toi :
  • Lister les projets disponibles
  • Voir les agents et leurs compétences
  • Transmettre une question technique
  • Afficher l'état du système
  • T'aider à naviguer dans l'interface

Quel est ton besoin ?`,
  type: 'presentation',
  capabilities: [
    'Lister les projets',
    'Voir les agents disponibles',
    'Transmettre une question technique',
    'Afficher l\'état du système (telecom)',
    'Aide et navigation',
  ],
}

if (isJson) {
  console.log(JSON.stringify(response, null, 2))
} else {
  console.log(response.message)
}
