import type { ToolCall } from './types/agent-definition.js'

/**
 * Parse les appels d'outils depuis la réponse texte d'un LLM.
 * Supporte plusieurs formats pour être compatible avec différents modèles :
 *
 * 1. !command                  — Legacy CLI (run_terminal_command)
 * 2. ```json {tool, input}     — Bloc JSON avec langage tag
 * 3. ``` {tool, input}         — Bloc JSON sans tag (auto-détection)
 * 4. ```tool_call {tool,input} — Bloc JSON tag tool_call
 * 5. <tool_call>...</tool_call> — Format XML
 * 6. TOOL_CALL: toolName       — Format préfixe
 * 7. toolName(param=value)     — Format fonction inline
 * 8. {action, ...params} JSON  — Format action-based
 * 9. ```bash/sh/shell command  — Bloc de code bash
 */
export function parseToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = []

  // ── Helper anti-doublon ──────────────────────────────────
  const alreadyHas = (toolName: string, input: Record<string, unknown>) =>
    calls.some(c => c.toolName === toolName && JSON.stringify(c.input) === JSON.stringify(input))

  const addCall = (toolName: string, input: Record<string, unknown>) => {
    if (!alreadyHas(toolName, input)) {
      calls.push({ toolName, input })
    }
  }

  // ── Helper pour parser un bloc JSON ──────────────────────
  const tryParseJsonBlock = (jsonStr: string) => {
    try {
      const data = JSON.parse(jsonStr)
      // Format A: { "tool": "...", "input": { ... } }
      if (typeof data.tool === 'string' && data.input && typeof data.input === 'object') {
        addCall(data.tool, data.input as Record<string, unknown>)
        return true
      }
      // Format B: { "name": "...", "arguments": { ... } } (OpenAI function call)
      // Note: arguments peut être un objet OU une chaîne JSON stringifiée
      if (typeof data.name === 'string' && data.arguments) {
        let args: Record<string, unknown>
        if (typeof data.arguments === 'string') {
          try { args = JSON.parse(data.arguments) } catch { args = {} }
        } else if (typeof data.arguments === 'object') {
          args = data.arguments as Record<string, unknown>
        } else {
          args = {}
        }
        if (Object.keys(args).length > 0) {
          addCall(data.name, args)
          return true
        }
      }
      // Format C: { "function": "...", "params": { ... } } (variante)
      if (typeof data.function === 'string' && data.params && typeof data.params === 'object') {
        addCall(data.function, data.params as Record<string, unknown>)
        return true
      }
      // Format D: { "tool_call": "...", "input": { ... } } (variante)
      if (typeof data.tool_call === 'string' && data.input && typeof data.input === 'object') {
        addCall(data.tool_call, data.input as Record<string, unknown>)
        return true
      }
      // Format E: { "action": "...", "command": "...", ... } (action-based flat)
      //   { "action": "run_terminal_command", "command": "ls -la" }
      //   { "action": "add_message", "content": "message" }
      if (typeof data.action === 'string' && data.action.length > 0) {
        const toolName = data.action
        const input: Record<string, unknown> = { ...data }
        delete input.action
        if (Object.keys(input).length > 0) {
          addCall(toolName, input)
          return true
        }
      }
    } catch { /* ignore invalid JSON */ }
    return false
  }

  // ── Pattern 1 : !command (Legacy CLI) ────────────────────
  //   !cat file.txt  →  run_terminal_command({ command: 'cat file.txt' })
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('!') && trimmed.length > 1) {
      addCall('run_terminal_command', { command: trimmed.slice(1).trim() })
    }
  }

  // ── Pattern 2 : Blocs JSON dans les code blocks ──────────
  //   ```json { "tool": "...", "input": { ... } } ```
  //   ```tool_call { "tool": "...", "input": { ... } } ```
  //   ``` { "tool": "...", "input": { ... } } ```
  // Capture tout bloc ```...``` et tente de parser le JSON à l'intérieur
  const codeBlockRegex = /```(?:json|tool_call|tool)?\s*\n?\s*(\{[\s\S]*?\})\s*```/gi
  let cbMatch: RegExpExecArray | null
  while ((cbMatch = codeBlockRegex.exec(text)) !== null) {
    tryParseJsonBlock(cbMatch[1])
  }

  // ── Pattern 3 : XML-like tool calls ──────────────────────
  //   <tool_call>
  //   <run_terminal_command>
  //   <command>ls -la</command>
  //   </run_terminal_command>
  //   </tool_call>
  const toolCallXmlRegex = /<tool_call>([\s\S]*?)<\/tool_call>/gi
  let xmlMatch: RegExpExecArray | null
  while ((xmlMatch = toolCallXmlRegex.exec(text)) !== null) {
    const inner = xmlMatch[1].trim()
    // Extract tool name and its content from the inner XML tag: <toolName>content</toolName>
    const toolMatch = inner.match(/<\s*(\w+)[^>]*>([\s\S]*?)<\/\s*\1\s*>/)
    if (toolMatch) {
      const toolName = toolMatch[1]
      const paramsContent = toolMatch[2]
      // Extract parameters from child XML tags: <paramName>value</paramName>
      const input: Record<string, unknown> = {}
      const paramRegex = /<\s*(\w+)[^>]*>([\s\S]*?)<\/\s*\1\s*>/g
      let paramMatch: RegExpExecArray | null
      while ((paramMatch = paramRegex.exec(paramsContent)) !== null) {
        const value = paramMatch[2].trim()
        // Attempt numeric parsing for cleaner types
        input[paramMatch[1]] = /^\d+(\.\d+)?$/.test(value) ? (value.includes('.') ? parseFloat(value) : parseInt(value, 10)) : value
      }
      addCall(toolName, input)
    }
  }

  // ── Pattern 3b : Variante <tool_call>TOOL_NAME> (nom dans le contenu) ──
  //   <tool_call>run_terminal_command>
  //   <command>type telecom\routed\xxx.json</command>
  //   <command_type>shell</command>
  //
  //   <tool_call>run_terminal_command>
  //   <arg_key>command</arg_key>
  //   <arg_value>cat data/protocols/keyword-registry.yaml</arg_value>
  //   </parameter>
  //
  // Le LLM met le nom de l'outil DANS le contenu de <tool_call> avec un >
  // littéral, suivi de paires <param>value</param> sur les lignes suivantes.
  // Note : il n'y a PAS de </tool_call> fermant — le pattern s'arrête au
  // prochain bloc ou à la fin du texte.
  const toolCallInlineRegex = /<tool_call>(\w+)>([\s\S]*?)(?=<tool_call>|$)/gi
  let tciMatch: RegExpExecArray | null
  while ((tciMatch = toolCallInlineRegex.exec(text)) !== null) {
    const toolName = tciMatch[1]
    const content = tciMatch[2].trim()
    const input: Record<string, unknown> = {}

    // Supporte les paramètres comme <param>value</param> ou
    // <arg_key>key</arg_key>\n<arg_value>value</arg_value>
    const paramRegex = /<([a-zA-Z_]\w*)>([\s\S]*?)<\/\1\s*>/g
    let pMatch: RegExpExecArray | null
    while ((pMatch = paramRegex.exec(content)) !== null) {
      const pName = pMatch[1]
      const pValue = pMatch[2].trim()

      // <arg_key>/<arg_value> pairs → on garde la key/value comme input[key]=value
      if (pName === 'arg_key') {
        // La valeur sera sur la prochaine balise <arg_value>
        continue
      } else if (pName === 'arg_value') {
        // On récupère la clé depuis le dernier match
        // Cherche la dernière <arg_key> avant ce <arg_value>
        // Simple: on met dans input['command'] par défaut
        // Mais mieux: on cherche la clé dans le contenu avant ce match
        const beforeValue = content.slice(0, pMatch.index)
        const keyMatch = beforeValue.match(/<arg_key>([\s\S]*?)<\/arg_key>/g)
        if (keyMatch) {
          const lastKey = keyMatch[keyMatch.length - 1].replace(/<\/?arg_key>/g, '').trim()
          input[lastKey] = pValue
        } else {
          input.command = pValue
        }
      } else if (pName !== 'parameter') {
        // <parameter> est un wrapper ignoré
        // Autres balises : <command>, <content>, etc.
        input[pName] = pValue
      }
    }

    if (Object.keys(input).length > 0) {
      addCall(toolName, input)
    }
  }

  // ── Pattern 4 : XML Anthropic-style tool_use ─────────────
  //   <tool_use><tool_name>run_terminal_command</tool_name><command>ls</command></tool_use>
  //   <function_calls><invoke name="run_terminal_command"><parameter name="command">ls</parameter></invoke></function_calls>
  //   <function call><invoke name="run_terminal_command"><arg name="command">ls</arg></invoke></function call>
  const toolUseRegex = /<tool_use>([\s\S]*?)<\/tool_use>|<function_calls>([\s\S]*?)<\/function_calls>|<function\s+call>([\s\S]*?)<\/function\s+call>/gi
  let tuMatch: RegExpExecArray | null
  while ((tuMatch = toolUseRegex.exec(text)) !== null) {
    const content = (tuMatch[1] || tuMatch[2] || tuMatch[3] || '').trim()

    // Try <tool_name>name</tool_name> + <param>value</param>
    const nameMatch = content.match(/<tool_name[^>]*>([\s\S]*?)<\/tool_name>/i)
    if (nameMatch) {
      const toolName = nameMatch[1].trim()
      const input: Record<string, unknown> = {}
      const paramRegex = /<([a-zA-Z_]\w*)[^>]*>([\s\S]*?)<\/\1\s*>/g
      let pMatch: RegExpExecArray | null
      while ((pMatch = paramRegex.exec(content)) !== null) {
        if (pMatch[1] !== 'tool_name') {
          input[pMatch[1]] = pMatch[2].trim()
        }
      }
      addCall(toolName, input)
    }

    // Try <invoke name="..."><parameter name="...">...</parameter></invoke>
    // or <invoke name="..."><arg name="...">...</arg></invoke>
    const invokeMatch = content.match(/<invoke\s+name="([^"]+)">([\s\S]*?)<\/invoke>/i)
    if (invokeMatch) {
      const toolName = invokeMatch[1].trim()
      const input: Record<string, unknown> = {}
      // Supporte <parameter name="..."> et <arg name="...">
      const paramRegex = /<(?:parameter|arg)\s+name="([^"]+)">([\s\S]*?)<\/(?:parameter|arg)>/gi
      let pMatch2: RegExpExecArray | null
      while ((pMatch2 = paramRegex.exec(invokeMatch[2])) !== null) {
        input[pMatch2[1]] = pMatch2[2].trim()
      }
      addCall(toolName, input)
    }
  }

  // ── Pattern 5 : Préfixe TOOL_CALL: / TOOL: / FUNCTION: ───
  //   TOOL_CALL: run_terminal_command
  //   command: ls -la
  //
  //   TOOL: run_terminal_command
  //   PARAM command: ls -la
  const prefixLines = text.split('\n')
  let i = 0
  while (i < prefixLines.length) {
    const line = prefixLines[i].trim()
    const prefixMatch = line.match(/^(?:TOOL_CALL|TOOL|FUNCTION)\s*:\s*(\w+)/i)
    if (prefixMatch) {
      const toolName = prefixMatch[1]
      const input: Record<string, unknown> = {}
      // Collecter les paramètres sur les lignes suivantes (indentées ou format PARAM/ARG name: value)
      i++
      while (i < prefixLines.length) {
        const paramLine = prefixLines[i].trim()
        if (!paramLine || paramLine.match(/^(?:TOOL_CALL|TOOL|FUNCTION)\s*:/i)) break
        const paramMatch = paramLine.match(/^(?:PARAM\s+|ARG\s+)?([a-zA-Z_]\w*)\s*[=:]\s*(.+)/i)
        if (paramMatch) {
          input[paramMatch[1]] = paramMatch[2].trim()
        }
        i++
      }
      addCall(toolName, input)
    } else {
      i++
    }
  }

  // ── Pattern 6 : Format fonction inline ───────────────────
  //   run_terminal_command("ls -la")
  //   add_message("Message")
  //   skill("review")
  //
  // Reconnaît : toolName("valeur") — le nom du paramètre dépend du tool
  const simpleInlinePattern = /\b(run_terminal_command|add_message|set_output|skill)\s*\("([^"]+)"\)/gi
  let simpleMatch: RegExpExecArray | null
  while ((simpleMatch = simpleInlinePattern.exec(text)) !== null) {
    // Le paramètre par défaut dépend du tool
    const paramKey = simpleMatch[1] === 'run_terminal_command' ? 'command'
      : simpleMatch[1] === 'skill' ? 'name'
      : 'content'
    addCall(simpleMatch[1], { [paramKey]: simpleMatch[2] })
  }

  // Variante avec paramètres nommés : toolName(param="val", param2=val2)
  // Ce pattern ne matche PAS le format simple toolName("val") car il attend key=
  const namedParamPattern = /\b(run_terminal_command|add_message|set_output|skill)\s*\(([^)]+)\)/gi
  let namedMatch: RegExpExecArray | null
  while ((namedMatch = namedParamPattern.exec(text)) !== null) {
    const toolName = namedMatch[1]
    const paramsStr = namedMatch[2].trim()
    // Parse key="value" or key='value' pairs
    const input: Record<string, unknown> = {}
    const kvRegex = /([a-zA-Z_]\w*)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g
    let kvMatch: RegExpExecArray | null
    while ((kvMatch = kvRegex.exec(paramsStr)) !== null) {
      input[kvMatch[1]] = (kvMatch[2] ?? kvMatch[3] ?? kvMatch[4] ?? '').trim()
    }
    if (Object.keys(input).length > 0) {
      // Évite le doublon avec le pattern simple (le pattern simple matche toolName("val") sans key=,
      // donc ce bloc ne matchera pas le même appel car kvRegex ne trouvera pas de key= dans "val")
      addCall(toolName, input)
    }
  }  // ── Pattern 9 : Balise XML directe du nom d'outil ──────
  //   <run_terminal_command>
  //   node -e "..."
  //   </run_terminal_command>
  //
  //   <add_message>
  //   Voici le résultat
  //   </add_message>
  //
  //   <skill name="review">...</skill>  (variante avec attribut)
  //
  // Certains LLMs (ex: Opencode Zen mimo-v2.5) produisent directement
  // le nom de l'outil comme balise XML, sans wrapper <tool_call>.
  const KNOWN_TOOLS = ['run_terminal_command', 'add_message', 'set_output', 'skill']
  const toolTagPattern = new RegExp(
    `<(${KNOWN_TOOLS.join('|')})\\s*([^>]*)>` +
    `([\\s\\S]*?)` +
    `<\\/\\s*\\1\\s*>`,
    'gi'
  )
  let ttMatch: RegExpExecArray | null
  while ((ttMatch = toolTagPattern.exec(text)) !== null) {
    const toolName = ttMatch[1]
    const attrs = ttMatch[2].trim()
    const content = ttMatch[3].trim()
    const input: Record<string, unknown> = {}

    // Ignorer si ce tag est déjà à l'intérieur d'un wrapper <tool_call>
    // (Pattern 3 et 3b l'ont déjà traité, Pattern 9 créerait un doublon)
    const beforeTag = text.slice(0, ttMatch.index)
    const lastOpen = beforeTag.lastIndexOf('<tool_call>')
    const lastClose = beforeTag.lastIndexOf('</tool_call>')
    if (lastOpen > lastClose) continue

    if (toolName === 'run_terminal_command') {
      // La première ligne non-vide est la commande
      const cmdLine = content.split('\n').map(l => l.trim()).find(l => l.length > 0)
      if (cmdLine) {
        input.command = cmdLine
        addCall(toolName, input)
      }
    } else if (toolName === 'add_message' || toolName === 'set_output') {
      // Le contenu entier est le message
      if (content.length > 0) {
        input.content = content
        addCall(toolName, input)
      }
    } else if (toolName === 'skill') {
      // Extrait l'attribut name="..."
      const nameMatch = attrs.match(/name\s*=\s*"([^"]+)"/)
      if (nameMatch) {
        input.name = nameMatch[1]
        addCall(toolName, input)
      }
    }
  }

  // ── Pattern 10 : Blocs de code bash/sh/shell ────────────
  //   ```bash
  //   cat telecom/routed/xxx.json
  //   ```
  //
  //   ```sh
  //   node dist/intercom-manager.js send ...
  //   ```
  //
  //   ```shell
  //   ls -la
  //   ```
  //
  //   Extrait la première ligne de commande non-vide et non-commentaire
  const bashBlockRegex = /```(?:shell|bash|sh|powershell|cmd|ps)\s*\n?([\s\S]*?)```/gi
  let bashMatch: RegExpExecArray | null
  while ((bashMatch = bashBlockRegex.exec(text)) !== null) {
    const content = bashMatch[1].trim()
    // Prendre la première ligne non-vide qui n'est pas un commentaire
    const cmdLine = content.split('\n').map(l => l.trim()).find(l => l.length > 0 && !l.startsWith('#'))
    if (cmdLine) {
      addCall('run_terminal_command', { command: cmdLine })
    }
  }

  return calls
}

/**
 * Fallback : analyse le texte narratif d'un LLM qui n'a pas produit d'appels d'outils,
 * et tente d'extraire les intentions pour créer des appels d'outils.
 *
 * Utile pour les petits modèles locaux (ex: LM Studio, Ollama) qui répondent
 * en texte narratif au lieu d'utiliser le format structuré attendu.
 */
export function fallbackParseToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = []
  const lower = text.toLowerCase()

  // Helper anti-doublon
  const alreadyHas = (toolName: string, command: string) =>
    calls.some(c => c.toolName === toolName && c.input.command === command)

  // ── Pattern F1: Chemins de fichiers explicites ──────────────
  // Détecte les chemins de type telecom/routed/xxx.json, telecom/intercom/xxx.json
  const filePathPattern = /(?:telecom[/\\]\w+[/\\][\w.-]+\.\w+)/gi
  let fMatch: RegExpExecArray | null
  while ((fMatch = filePathPattern.exec(text)) !== null) {
    const path = fMatch[0]
    if (!alreadyHas('run_terminal_command', `cat ${path}`)) {
      calls.push({ toolName: 'run_terminal_command', input: { command: `cat ${path}` } })
    }
  }

  // ── Pattern F2: Actions de listing ──────────────────────────
  // "lister", "liste", "list", "catalogue", "répertoire", "ressources"
  const wantsToList = /\b(list|liste?r?|catalogue|catalog|répertoire|ressources?|disponibles?)\b/i.test(lower)
  if (wantsToList) {
    // Si projets mentionné, lister les projets/routed
    if (/\b(projets?|project|routed|intercom)\b/i.test(lower)) {
      if (!alreadyHas('run_terminal_command', 'dir /b /o-d telecom\\routed\\')) {
        calls.push({ toolName: 'run_terminal_command', input: { command: 'dir /b /o-d telecom\\routed\\' } })
      }
    }
    // Lister les agents
    if (/\bagents?\b/i.test(lower) && !alreadyHas('run_terminal_command', 'dir /b .agents\\')) {
      calls.push({ toolName: 'run_terminal_command', input: { command: 'dir /b .agents\\' } })
    }
  }

  // ── Pattern F3: Actions de lecture ──────────────────────────
  // "vérifier", "consulter", "lire", "check", "read", "analyse"
  const wantsToRead = /\b(vérif|vérif|consult|analyse|ressources?|check|read|lire)\b/i.test(lower)
  if (wantsToRead) {
    // Si des fichiers routed existent, les lire
    if (/\b(routed|intercom|message)\b/i.test(lower)) {
      if (!alreadyHas('run_terminal_command', 'dir /b /o-d telecom\\routed\\')) {
        calls.push({ toolName: 'run_terminal_command', input: { command: 'dir /b /o-d telecom\\routed\\' } })
      }
    }
    // Lire le logbook
    if (/\b(log|logbook|journal|suivi)\b/i.test(lower)) {
      if (!alreadyHas('run_terminal_command', 'cat telecom/agent-logbook.md')) {
        calls.push({ toolName: 'run_terminal_command', input: { command: 'cat telecom/agent-logbook.md' } })
      }
    }
  }

  // ── Pattern F4: Actions Intercom ────────────────────────────
  // "intercom", "send", "envoyer", "transmettre", "router"
  const intercomAction = /\b(intercom|send|envoyer|transmettre|router|rout)\b/i.test(lower)
  if (intercomAction) {
    // Cherche une commande intercom-manager.js complète dans le texte
    const intercomCmd = text.match(/(?:node\s+)?dist[\/\\]telecom[\/\\]service[\/\\]intercom-manager\.js\s+\w+/i)
    if (intercomCmd) {
      const cmd = intercomCmd[0]
      if (!alreadyHas('run_terminal_command', cmd)) {
        calls.push({ toolName: 'run_terminal_command', input: { command: cmd } })
      }
    }
    // Cherche un pattern "send <from> <to> <type> <subject>" dans le texte
    const sendMatch = text.match(/send\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)/i)
    if (sendMatch) {
      const cmd = `node dist/telecom/service/intercom-manager.js send ${sendMatch[1]} ${sendMatch[2]} ${sendMatch[3]} "${sendMatch[4]}"`
      if (!alreadyHas('run_terminal_command', cmd)) {
        calls.push({ toolName: 'run_terminal_command', input: { command: cmd } })
      }
    }
  }

  // ── Pattern F5: Génération de commande à partir de mentions explicites ──
  // Si le texte mentionne "node dist/..." ou une commande longue, l'extraire
  const explicitCmdPattern = /(?:node\s+dist[/\\]\S+(?:\s+\S+){3,})/gi
  let ecMatch: RegExpExecArray | null
  while ((ecMatch = explicitCmdPattern.exec(text)) !== null) {
    const cmd = ecMatch[0]
    if (!alreadyHas('run_terminal_command', cmd)) {
      calls.push({ toolName: 'run_terminal_command', input: { command: cmd } })
    }
  }

  // ── Pattern F6: Détection de commande littérale dans le texte ──
  // Parfois le LLM écrit "cat telecom/routed/xxx.json" en texte libre
  // Capture seulement commande + 1 argument pour éviter les faux positifs longs
  // Note: 'type' est exclu car c'est un mot français courant ("type de demande")
  // Note: 'node' est exclu car trop polysémique en français ("node principal")
  // Note: si l'argument commence par telecom/, c'est déjà géré par F1 — on ignore car
  // F1 capture avec l'extension (.json) mais F6 s'arrête au point (.) donc:
  //   F1: cat telecom/routed/x.json  (correct)
  //   F6: cat telecom/routed/x        (tronqué sans extension, doublon inutile)
  const literalCmdPattern = /\b(cat|dir|ls)\s+([^\s,.!?]+)/gi
  let cmdMatch: RegExpExecArray | null
  while ((cmdMatch = literalCmdPattern.exec(text)) !== null) {
    const potentialCmd = cmdMatch[0].trim()
    // Ignore si l'argument ressemble à un chemin telecom/ (déjà géré par F1 avec extension)
    const arg = cmdMatch[2]
    if (arg.startsWith('telecom') || arg.startsWith('data')) continue
    // Filtre les faux positifs (très court, verbe uniquement)
    if (potentialCmd.length > 8 && /\s/.test(potentialCmd)) {
      if (!alreadyHas('run_terminal_command', potentialCmd)) {
        calls.push({ toolName: 'run_terminal_command', input: { command: potentialCmd } })
      }
    }
  }

  return calls
}
