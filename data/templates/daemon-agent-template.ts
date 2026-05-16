/**
 * @fileoverview Template pour un agent de type "daemon".
 * Cet agent tourne en arrière-plan, effectue des tâches périodiques,
 * et communique via pushNotification.
 *
 * @lexicon
 * - daemon: Agent qui tourne en permanence en arrière-plan.
 * - pushNotification: Fonction pour envoyer une notification à Alice (fournie par le système à l'exécution).
 * - mission: Tâche principale de l'agent.
 */

// Fonction fournie par le système à l'exécution (declare pour satisfait TypeScript)
declare function pushNotification(from: string, message: string): void

export const agent = {
  /** Nom d'affichage de l'agent (ex: "timer-man") */
  displayName: "{{agent_name}}",
  /** Description de la fonction de l'agent */
  description: "{{agent_description}}",
  /** Provider LLM utilisé (même si pas directement appelé, pour la cohérence) */
  provider: "{{provider}}",
  /** Modèle LLM utilisé (même si pas directement appelé) */
  model: "{{model}}",

  /** Intervalle par défaut en millisecondes (ex: 1 minute = 60000) */
  defaultIntervalMs: 60000,
  /** Message de notification par défaut */
  defaultNotificationMessage: "⏰ N'oubliez pas de faire une pause !",
  /** Mission principale de l'agent */
  mission: "Envoyer une notification périodique pour rappeler une pause.",

  // Nouvelles config daemon
  healthCheck: {
    enabled: true,
    checkIntervalMs: 30000,
    maxConsecutiveFailures: 3,
    autoRestart: true,
    maxRestarts: 5,
  },
  guardian: {
    enabled: true,
    blockHarmful: true,
    requireConfirmation: true,  // Plus prudent pour daemon
    auditTrail: true,
  },

  /** Configuration du script daemon */
  scriptFile: "{{agent_name}}-script.js",
  logFileName: "{{agent_name}}.log",
  pidFileName: ".{{agent_name}}.pid",
};

/**
 * Initialise l'agent daemon.
 * Cette fonction est appelée une fois au démarrage du processus de l'agent.
 * Elle configure l'intervalle, le message, et démarre le timer.
 */
export async function initializeAgent() {
  console.log(`[${agent.displayName}] Initialisation du daemon...`);
  const instruction = "1m";
  const interval = parseInterval(instruction);

  console.log(`[${agent.displayName}] Daemon prêt. Intervalle: ${interval}ms`);
  return Promise.resolve();
}

/**
 * Tâche principale pour un agent daemon.
 * Lance le script JS autonome qui gère la boucle du timer.
 * @param {string} instruction - L'intervalle (ex: "1m").
 */
export async function runAgentTask(instruction?: string) {
  const interval = instruction ? parseInterval(instruction) : agent.defaultIntervalMs;
  console.log(`[${agent.displayName}] Lancement du script daemon avec intervalle: ${instruction || 'par défaut'}`);
  console.log(`[${agent.displayName}] Simulation : Envoi d'une notification.`);
  pushNotification(agent.displayName, agent.defaultNotificationMessage);
}

/** Parse un intervalle au format "1m", "5m", "1h" en millisecondes. */
function parseInterval(input: string): number {
  if (input.endsWith('m')) return parseInt(input.slice(0, -1)) * 60000;
  if (input.endsWith('h')) return parseInt(input.slice(0, -1)) * 3600000;
  return agent.defaultIntervalMs;
}