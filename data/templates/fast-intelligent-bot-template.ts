/**
 * @fileoverview Template pour un agent bot "Rapide & Intelligent".
 *
 * Un bot rapide et intelligent combine :
 * - Performance : exécution rapide, latence minimale
 * - Intelligence : prise de décision via LLM, adaptation contextuelle
 * - Autonomie : fonctionne sans intervention constante
 * - Outils : capacité d'agir sur son environnement (fichiers, APIs, shell)
 *
 * @lexicon
 * - Bot: Agent logiciel autonome (abrégé de "robot")
 * - LLM: Large Language Model pour l'intelligence
 * - Tool: Capacité d'action (shell, fichiers, messages)
 * - Session: Contexte de conversation actuel
 * - Prompt: Instructions guidant le comportement du bot
 */

export const agent = {
  /** Nom d'affichage du bot */
  displayName: "{{displayName}}",

  /** Modèle LLM utilisé (ex: "kilo-auto/free", "gemini-2.5-flash") */
  model: "{{model}}",

  /**
   * Outils disponibles pour ce bot.
   * Configure selon les besoins du bot :
   * - run_terminal_command : exécuter des commandes shell
   * - add_message : envoyer des messages (notification, log)
   * - set_output : produire un résultat structuré
   * - skill : invoquer une autre skill
   * - read_file : lire un fichier
   * - write_file : écrire un fichier
   * - http_request : faire des requêtes HTTP
   */
  toolNames: ["run_terminal_command", "add_message", "set_output", "skill"],

  /**
   * Prompt d'instructions - Le "cerveau" du bot.
   *
   * Structure recommandée :
   * 1. Identité : Qui es-tu, quel est ton rôle
   * 2. Mission : Qué fais-tu concrètement
   * 3. Comportement : Comment tu agis (vite, proprement, etc.)
   * 4. Contraintes : Règles à respecter
   * 5. Tools : Comment utiliser tes outils disponibles
   */
  instructionsPrompt: `Tu es {{displayName}}.

## Mission
{{mission}}

## Comportement
- Réponds rapidement et de manière concise
- Utilise les outils disponibles quand nécessaire
- Reste concentré sur ta mission principale
- Si tu ne sais pas, dis-le plutôt que deInventer

## Outils disponibles
{{tool_usage}}

## Contraintes
- Ne fais rien en dehors de ta mission
- Respecte les formats de sortie attendus
- Log tes actions importantes via add_message`,

  /**
   * Configuration de performance (optionnel).
   * Ces paramètres influencent le comportement du bot.
   */
  config: {
    /** Timeout en millisecondes pour les opérations longues */
    timeoutMs: 30000,
    /** Nombre max de retries en cas d'erreur */
    maxRetries: 3,
    /** Mode verbeux pour le debugging */
    verbose: false,
  },
}
