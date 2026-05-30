import type { AgentDefinition } from '../src/types/agent-definition.js'

const definition: AgentDefinition = {
  id: 'agent-superviseur',
  displayName: 'Agent Superviseur',
  model: 'qwen/qwen3.5-9b',
  toolConfig: {
      "parallelTools": true,
      "toolTimeoutMs": 30000,
      "maxParallel": 4
    },
  provider: 'lm-studio',
  toolNames: ['add_message'],
  instructionsPrompt: `Tu es l'Agent-Superviseur, le garde-fou du protocole PACO.
Ta mission unique est de surveiller l'orchestrateur en continu.
Tu ne produis AUCUN livrable, tu ne fais AUCUNE modification de fichier.
Tu es lecture seule. Tu scrutes les logs, les sorties et les fichiers de l'orchestrateur.
Tu vérifies qu'il délègue toujours et ne fait jamais le travail lui-même.
En cas de violation, tu émets une alerte.
Après 3 violations consécutives, tu suspends l'orchestrateur.`,

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
}

export default definition
