/**
 * @fileoverview Template pour un agent de type LLM classique.
 * Ce type d'agent utilise un modèle LLM pour répondre aux instructions de l'utilisateur.
 *
 * @lexicon
 * - LLM: Large Language Model (modèle de langage).
 * - mission: Tâche principale de l'agent, décrite en langage naturel.
 * - provider: Service fournissant l'accès au LLM (ex: Google, Kilo).
 * - model: Nom spécifique du modèle LLM utilisé.
 */

export const agent = {
  /** Nom d'affichage de l'agent (ex: "assistant-general") */
  displayName: "{{agent_name}}",
  /** Description concise de la fonction de l'agent */
  description: "{{agent_description}}",
  /** Provider LLM utilisé (ex: "kilo", "google") */
  provider: "{{provider}}",
  /** Modèle LLM spécifique (ex: "kilo-auto/free", "gemini-2.5-flash") */
  model: "{{model}}",

  /** Instructions système pour guider le LLM (Prompting) */
  instructionsPrompt: `Tu es {{agent_name}}, un agent IA spécialisé. ${"{{agent_description}}"}. Réponds en français de manière concise et utile.`,

  /** Compétences ou outils disponibles pour cet agent */
  toolNames: ["run_terminal_command", "add_message", "set_output"],

  /** Mission principale de l'agent */
  mission: "Répondre aux requêtes de l'utilisateur en utilisant le LLM.",

  /** Configuration spécifique au LLM (optionnel) */
  // llmConfig: { temperature: 0.7, maxTokens: 500 },
};

/**
 * Initialise l'agent LLM. Peut charger des configurations supplémentaires.
 */
export async function initializeAgent() {
  console.log(`[${agent.name}] Initialisation de l'agent LLM...`);
  // Exemple: charger des données spécifiques si nécessaire
  return Promise.resolve();
}

/**
 * Exécute la tâche principale de l'agent LLM.
 * Reçoit une instruction de l'utilisateur et retourne une réponse.
 * @param {string} instruction - L'instruction de l'utilisateur.
 * @param {object} context - Contexte incluant le LLM résolu.
 */
export async function runAgentTask(instruction: string, context: any) {
  console.log(`[${agent.name}] Traitement de l'instruction : "${instruction}"`);
  try {
    const response = await context.callLLM(instruction, context.resolvedProvider, agent.instructionsPrompt);
    console.log(`[${agent.name}] Réponse LLM reçue.`);
    return response;
  } catch (error) {
    console.error(`[${agent.name}] Erreur lors de l'appel LLM:`, error);
    throw error; // Propage l'erreur
  }
}
