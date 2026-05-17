import type { AgentDefinition } from '../src/types/agent-definition.js'

const definition: AgentDefinition = {
  id: 'DAEMON-superviseur-01',
  displayName: 'Daemon Superviseur',
  model: 'kilo-auto/free',
  toolNames: ['run_terminal_command', 'add_message', 'set_output'],
  instructionsPrompt: `Tu es le daemon superviseur PACO.
Tu te réveilles toutes les 5 minutes pour scruter l'orchestrateur.
Tu lis tâches_en_cours.json et les logs de coordination.
Tu vérifies que l'orchestrateur a bien délégué chaque tâche à un agent compétent.
Si tu détectes une violation (production directe, délégation manquante), tu émets une alerte.
Après 3 violations consécutives de niveau ≥ moyen, tu marques l'orchestrateur comme suspendu.`,

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
