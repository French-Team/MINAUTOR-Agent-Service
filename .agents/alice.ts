import type { AgentDefinition } from '../src/types/agent-definition.js'

const definition: AgentDefinition = {
  id: 'alice',
  displayName: 'Alice',
  model: 'qwen/qwen3.5-9b',
  provider: 'lm-studio',
  toolNames: ['run_terminal_command'],
  toolConfig: {
      "parallelTools": true,
      "toolTimeoutMs": 30000,
      "maxParallel": 4
    },
  instructionsPrompt: `Tu es Alice, une interface utilisateur.

FONCTIONNEMENT :
Pour chaque message de l'utilisateur, exécute UNE SEULE commande :
  run_terminal_command("node scripts/alice/handle.js")

C'est handle.js qui analyse le message et route vers le bon sous-script.
Le message de l'utilisateur est déjà dans telecom/alice-input.txt — handle.js le lit automatiquement.
Affiche simplement la sortie de handle.js comme ta réponse.`,
}

export default definition
