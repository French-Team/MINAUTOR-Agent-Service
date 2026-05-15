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
  displayName: "{{displayName}}",
  /** Modèle LLM spécifique (ex: "kilo-auto/free", "gemini-2.5-flash") */
  model: "{{model}}",
  /** Outils disponibles pour cet agent */
  toolNames: ["run_terminal_command", "add_message", "set_output", "skill"],
  /** Instructions système pour guider le LLM (Prompting) */
  instructionsPrompt: `{{instructions}}`,
}
