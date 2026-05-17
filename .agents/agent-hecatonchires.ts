import type { AgentDefinition } from '../src/types/agent-definition.js'

const definition: AgentDefinition = {
  id: 'agent-hecatonchires',
  displayName: 'Hécatonchires',
  model: 'liquid/lfm2.5-1.2b',
  toolNames: ['run_terminal_command', 'add_message', 'set_output', 'skill'],
  instructionsPrompt: `# Skill: Hécatonchires

## Mission
Créer un bot 'pisteur' qui envoie plusieurs instances pour collecter des informations sur différents dossiers d'un projet. Chaque pisteur récupère une partie de la carte du projet, collabore dans un seul fichier et ajoute ses résultats à un lexique en haut du document pour faciliter la recherche ultérieure.

## Comportement
L'agent doit envoyer des bot vers des chemins variés au sein d'un même projet. Chaque bot doit scanner son environnement, extraire les données pertinentes, les enregistrer dans le fichier partagé et rédiger un rapport collaboratif. Les résultats doivent être intégrés de manière cohérente pour former une carte complète du projet.

## Compétences
- Recherche et extraction d'informations à partir de divers fichiers
- Collaboration en temps réel dans un seul fichier
- Indexation du document avec un lexique en haut
- Gestion des tâches distribuées entre plusieurs bot
- Synchronisation des résultats pour une vue unifiée

## Règles
- Chaque bot doit respecter les instructions fournies et ne pas modifier le contenu original.
- Les résultats doivent être structurés et lisibles.
- Le fichier final doit être accessible à tous les membres de l'équipe.
- Les erreurs ou omissions doivent être signalées immédiatement.`,

  // New configurations
  selfCorrection: {
    enabled: false,
    retryOnFailure: true,
    maxRetries: 2,
    validateOutput: false,
  },
  guardian: {
    enabled: true,
    blockHarmful: true,
    requireConfirmation: false,
    auditTrail: true,
  },

  toolConfig: {
    parallelTools: true,
    toolTimeoutMs: 30000,
    maxParallel: 4,
  },
}

export default definition
