import type { Message, ToolCall, ContextProfile } from './types/agent-definition.js'
import type { LLMProvider } from './engine-types.js'
import { internalCallLLM, buildToolDefs, type StreamingConfig } from './engine-llm.js'
import { parseToolCalls } from './engine-parser.js'
import { resolveContextOptionsFor, historienResumePourLLM } from './telecom/service/context/index.js'
import { RESET, CYAN, YELLOW, RED, GRAY, BOLD } from './constants.js'

interface RunnerDependencies {
  addMessage: (role: 'user' | 'assistant', content: string) => void
  /** Snapshot non-mutant de l'historique de la session courante. */
  getHistory?: () => Message[]
  runTerminalCommand: (command: string, processType?: 'SYNC' | 'BACKGROUND', timeoutSeconds?: number) => Promise<string>
  checkRateLimit: () => Promise<void>
  processTools: (toolCalls: ToolCall[]) => Promise<string[]>
  agent: {
    id: string
    toolNames?: string[]
    selfCorrection?: { enabled?: boolean; maxRetries?: number; retryOnFailure?: boolean }
    streaming?: StreamingConfig
    rateLimit?: { backoffMultiplier?: number }
    toolConfig?: { contextProfile?: ContextProfile }
  }
  /** Key rotation functions — injected from engine.ts */
  getNextKey?: (providerType: string) => { keyId: string; key: string; providerName: string } | undefined
  markRateLimited?: (keyId: string, cooldownMs?: number) => void
  getKeyIdByKey?: (key: string) => string
  getKeyById?: (keyId: string) => string | undefined
}

export function createRunner(deps: RunnerDependencies) {

  async function runPrompt(prompt: string): Promise<{ toolCalls: ToolCall[]; response: string }> {
    deps.addMessage('user', prompt)

    const toolCalls: ToolCall[] = []
    const textParts: string[] = []

    const lines = prompt.split('\n')
    for (const line of lines) {
      if (line.startsWith('!')) {
        const command = line.slice(1).trim()
        const output = await deps.runTerminalCommand(command)
        toolCalls.push({ toolName: 'run_terminal_command', input: { command } })
        textParts.push(`$ ${command}\n${output}`)
      } else if (line.startsWith('@')) {
        const message = line.slice(1).trim()
        deps.addMessage('assistant', message)
        toolCalls.push({ toolName: 'add_message', input: { role: 'assistant', content: message } })
      }
    }

    if (textParts.length === 0) {
      textParts.push(prompt)
    }

    return { toolCalls, response: textParts.join('\n') }
  }

  async function callLLM(
    userMessage: string,
    llm: LLMProvider,
    systemPrompt: string,
  ): Promise<string> {
    await deps.checkRateLimit()

    // CONTRAT : l'appelant ne doit PAS pré-ajouter le message utilisateur
    // à la session. callLLM s'en charge ici de façon centralisée.
    // Snapshot de l'historique AVANT d'ajouter le nouveau message utilisateur,
    // sinon il apparaîtrait deux fois (une fois dans l'historique, une fois
    // comme nouveau prompt).
    const history = deps.getHistory?.() ?? []

    // ── Injection automatique du suivi de session pour Alice ──
    // Le module historien (étape 3.5 du pipeline) analyse l'historique
    // pour en extraire les décisions, actions en cours, réalisations,
    // reste à faire, et éléments en attente. Ce résumé est injecté dans
    // le system prompt pour donner à Alice une mémoire contextuelle
    // sans dépendre de la compression de l'historique brut.
    let effectiveSystemPrompt = systemPrompt
    if (deps.agent.id === 'alice') {
      const suivi = historienResumePourLLM(history, { ecrireFichier: true })
      if (suivi) {
        effectiveSystemPrompt = systemPrompt + '\n\n' + suivi
      }
    }

    // Persister le message utilisateur dans la session pour les tours suivants
    // (c'était le bug racine de la perte de mémoire d'Alice).
    deps.addMessage('user', userMessage)

    let retries = 0
    const maxRetries = deps.agent.selfCorrection?.enabled ? (deps.agent.selfCorrection.maxRetries ?? 0) : 0
    const retryOnFailure = deps.agent.selfCorrection?.retryOnFailure || false

    let currentMessage = userMessage

    // Maximum de 3 rotations de clé sur 429 avant d'abandonner
    let keyRotationAttempts = 0
    const MAX_KEY_ROTATIONS = 3

    // Tuning du pipeline de compression selon la taille du modèle actif :
    // un 1.2B reçoit un historique très court ; un Gemini Flash garde large.
    // Un agent peut forcer un profil spécifique via toolConfig.contextProfile
    // (utile pour les daemons qui veulent toujours être légers).
    // Construire les définitions d'outils pour le tool calling natif
    const toolDefs = deps.agent.toolNames ? buildToolDefs(deps.agent.toolNames) : undefined

    const contextOptions = resolveContextOptionsFor({
      model: llm.model,
      override: deps.agent.toolConfig?.contextProfile,
    })

    while (retries <= maxRetries) {
      try {
        let result = await internalCallLLM(
          currentMessage,
          llm,
          effectiveSystemPrompt,
          deps.agent.streaming,
          history,
          contextOptions,
          toolDefs,
        )
        let response = result.content

        // Tool Loop : priorité aux tool_calls natifs, fallback parseToolCalls
        let toolCalls = result.rawToolCalls ?? parseToolCalls(response)
        let loopCount = 0
        const maxLoops = 10

        while (toolCalls.length > 0 && loopCount < maxLoops) {
          loopCount++
          console.log(`[Tool Loop] Executing ${toolCalls.length} tool(s)...`)

          const results = await deps.processTools(toolCalls)

          // ── SHORT-CIRCUIT : run_terminal_command = réponse finale ──
          // Quand tous les outils appelés sont run_terminal_command, le modèle
          // ne fait que DÉCLENCHER des scripts. Les scripts produisent la réponse
          // directement — pas de retour au modèle qui résumerait.
          // Ceci fonctionne même sans tool_call_id natif (modèles 1.2B
          // qui ne supportent pas OpenAI function calling de façon fiable).
          // On garde aussi hasNativeIds pour les autres agents qui utilisent
          // le tool calling natif OpenAI.
          // Architecture : model = entrée, script = sortie.
          const allAreScripts = toolCalls.length > 0 && toolCalls.every(tc => tc.toolName === 'run_terminal_command')
          const hasNativeIds = toolCalls.some(tc => tc.toolCallId)
          if (allAreScripts || hasNativeIds) {
            // Formater chaque résultat dans un bloc visuel
            // avec le nom du script, box-drawing et couleurs ANSI
            const formatted = results.map((r, i) => {
              const rawCmd = toolCalls[i]?.input?.command
              const cmd = typeof rawCmd === 'string' ? rawCmd : ''
              const scriptName = cmd.split(/[/\\]/).pop() || `Script ${i + 1}`
              const header = `${CYAN}╔${BOLD}══ ${scriptName}${RESET} ${GRAY}(${cmd})${RESET}`
              // Indenter chaque ligne du résultat
              const body = r
                .trim()
                .split('\n')
                .map(msgLine => `${CYAN}║${RESET} ${msgLine}`)
                .join('\n')
              const footer = `${CYAN}╚${'═'.repeat(50)}${RESET}`
              return `${header}\n${body}\n${footer}`
            }).join('\n\n')
            return formatted
          }

          // Fallback texte : tool_calls sans ID natif (parsés du texte généré)
          let toolResultsText = '\n\n### RÉSULTATS DES OUTILS :\n'
          for (let i = 0; i < toolCalls.length; i++) {
            toolResultsText += `- Outil: ${toolCalls[i].toolName}\n- Résultat: ${results[i]}\n\n`
          }
          currentMessage += `\n${response}${toolResultsText}`
          result = await internalCallLLM(
            currentMessage,
            llm,
            effectiveSystemPrompt,
            deps.agent.streaming,
            history,
            contextOptions,
            toolDefs,
          )
          response = result.content
          toolCalls = result.rawToolCalls ?? parseToolCalls(response)
        }

        return response
      } catch (err) {
        const msg = (err as Error).message

        // ── 429 Rate-limited : rotation de clé automatique ──
        if (msg.includes('429') && deps.markRateLimited && deps.getNextKey && keyRotationAttempts < MAX_KEY_ROTATIONS) {
          keyRotationAttempts++
          // On ne connaît pas le keyId de la clé actuelle on marque via l'injection
          // On utilise markRateLimited avec l'apiKey string comme fallback
          // Chercher le keyId via getKeyIdByKey
          const keyId = deps.getKeyIdByKey?.(llm.apiKey) || llm.apiKey
          deps.markRateLimited(keyId, 60000)

          // Tenter la rotation vers une autre clé
          const next = deps.getNextKey(llm.provider)
          if (next) {
            console.warn(`${YELLOW}⚠ 429 — rotation vers ${next.key.slice(-4)} (${next.providerName}, tentative ${keyRotationAttempts}/${MAX_KEY_ROTATIONS})${RESET}`)
            llm.apiKey = next.key
            // Ne pas compter comme un retry normal ; continuer immédiatement
            continue
          } else {
            console.warn(`${RED}✗ 429 — plus aucune clé disponible pour ${llm.provider}${RESET}`)
            // Toutes les clés sont rate-limited : on remet une cooldown et on lance l'erreur
            throw err
          }
        }

        if (!retryOnFailure || retries >= maxRetries) throw err
        retries++
        const backoff = (deps.agent.rateLimit?.backoffMultiplier || 1) * 1000 * retries
        console.warn(`LLM call failed (attempt ${retries}/${maxRetries}): ${(err as Error).message}. Retrying in ${backoff}ms...`)
        await new Promise(resolve => setTimeout(resolve, backoff))
      }
    }

    throw new Error('Maximum retries reached')
  }

  return { runPrompt, callLLM }
}
