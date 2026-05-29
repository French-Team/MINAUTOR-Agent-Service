# Architecture Model → Script (modèle = entrée, script = sortie)

> **Le pattern fondamental pour utiliser des petits modèles (1.2B-8B) comme déclencheurs de scripts fiables.**
> Date : 29 mai 2026

---

## Sommaire

1. [Principe fondamental](#1-principe-fondamental)
2. [Problème résolu](#2-problème-résolu)
3. [Pipeline complet](#3-pipeline-complet)
4. [Fichiers clés](#4-fichiers-clés)
5. [Configuration d'un agent model→script](#5-configuration-dun-agent-modelscript)
6. [Ajouter un pattern dans handle.js](#6-ajouter-un-pattern-dans-handlejs)
7. [Règles d'or](#7-règles-dor)
8. [Dépannage](#8-dépannage)
9. [Annexe : évolution de l'architecture](#9-annexe-évolution-de-larchitecture)

---

## 1. Principe fondamental

```
┌─────────┐     ┌──────────┐     ┌──────────────────┐
│ UTILISATEUR │─▶│ CLI      │─▶│ telecom/          │
│ (frederic)  │  │ cli-main │  │ alice-input.txt   │
└─────────┘    │ .ts      │  │ (message écrit)    │
               └──────────┘     └──────────────────┘
                     │
               ┌─────▼──────┐
               │ MODÈLE LLM │ ← 1.2B, outil unique : run_terminal_command
               │ (entrée)    │
               └─────┬──────┘
                     │ tool_calls natif (OpenAI format)
                     ▼
               ┌──────────────┐
               │ handle.js    │ ← dispatcher patterns
               │ (script)     │
               └──────┬───────┘
                      │ réponse directe
                      ▼
               ┌──────────────┐
               │ UTILISATEUR  │ ← voit la réponse du script
               └──────────────┘
```

**Le modèle ne fait jamais que déclencher le script.** Il ne traite pas le résultat, ne l'interprète pas, ne le reformule pas. Le script répond **directement** à l'utilisateur.

---

## 2. Problème résolu

### Le bug racine

Avant cette architecture, le pipeline était :

```
User → LLM → LLM génère "run_terminal_command(...)" en texte
           → parseToolCalls extrait la commande
           → exécution → résultat formaté en texte
           → renvoyé au LLM → LLM répond (mal ou boucle)
```

**Pourquoi ça ne marchait pas avec un modèle 1.2B :**

| Problème | Cause | Solution |
|----------|-------|----------|
| Modèle ne passait pas l'argument | Substitution `"<message>"` impossible pour 1.2B | Écrire le message dans un fichier AVANT l'appel LLM |
| Boucle infinie d'outils | Modèle ne voyait pas les résultats (bug `currentMessage`) | Passer `currentMessage` au LLM dans la boucle |
| "Message added" au lieu du script | Modèle appelait `add_message` en parallèle | Limiter `toolNames` à `['run_terminal_command']` |
| Modèle répondait n'importe quoi | Résultat formaté en texte, pas en `tool` natif | Short-circuit : résultat du script = réponse finale |

### La solution en 3 changements

1. **CLI écrit le message dans un fichier** avant l'appel LLM → plus de substitution par le modèle
2. **Tool calling natif OpenAI** → le modèle voit `run_terminal_command` comme un vrai outil, pas du texte
3. **Short-circuit** → dès que le modèle appelle un outil avec ID natif, le résultat est retourné directement

---

## 3. Pipeline complet

### Étape 1 : CLI écrit le message utilisateur

**Fichier :** `src/cli-main.ts` (lignes ~540-545)

```typescript
// Écrire le message utilisateur pour les scripts d'Alice
const aliceInputPath = join(process.cwd(), 'telecom', 'alice-input.txt')
try {
  mkdirSync(dirname(aliceInputPath), { recursive: true })
  writeFileSync(aliceInputPath, line, 'utf-8')
} catch { /* ignoré — fichier non bloquant */ }
```

Le fichier `telecom/alice-input.txt` contient **exactement** ce que l'utilisateur a tapé.

### Étape 2 : Appel LLM avec tool calling natif

**Fichier :** `src/engine-llm.ts`

La requête API contient maintenant le paramètre `tools` :

```json
{
  "model": "liquid/lfm2.5-1.2b",
  "messages": [
    { "role": "system", "content": "Tu es Alice... Exécute run_terminal_command(\"node scripts/alice/handle.js\")" },
    { "role": "user", "content": "bonjour" }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "run_terminal_command",
        "description": "Exécute une commande terminal et retourne le résultat",
        "parameters": {
          "type": "object",
          "properties": {
            "command": { "type": "string", "description": "La commande à exécuter" }
          },
          "required": ["command"]
        }
      }
    }
  ]
}
```

### Étape 3 : Modèle retourne tool_calls natif

Le modèle 1.2B compatible OpenAI retourne :

```json
{
  "choices": [{
    "message": {
      "content": null,
      "tool_calls": [{
        "id": "call_xxx",
        "type": "function",
        "function": {
          "name": "run_terminal_command",
          "arguments": "{\"command\":\"node scripts/alice/handle.js\"}"
        }
      }]
    }
  }]
}
```

### Étape 4 : Le moteur parse les tool_calls natifs

**Fichier :** `src/engine-llm.ts` — fonction `parseRawToolCalls()`

```typescript
function parseRawToolCalls(data: unknown): ToolCall[] | undefined {
  const choices = (data as any)?.choices
  if (!Array.isArray(choices) || choices.length === 0) return undefined

  const msg = choices[0]?.message
  if (!msg?.tool_calls || !Array.isArray(msg.tool_calls)) return undefined

  const calls: ToolCall[] = []
  for (const tc of msg.tool_calls) {
    if (tc.type !== 'function') continue
    const name = tc.function?.name
    const argsRaw = tc.function?.arguments
    const id = tc.id              // ← toolCallId natif !
    if (!name || !argsRaw) continue
    try {
      const args = JSON.parse(argsRaw)
      calls.push({ toolName: name, input: args, toolCallId: id })
    } catch { /* arguments invalides */ }
  }
  return calls.length > 0 ? calls : undefined
}
```

**Clé** : le `id` (ex: `call_xxx`) est conservé dans `toolCallId`. C'est ce qui distingue un appel natif d'un appel parsé du texte.

### Étape 5 : SHORT-CIRCUIT — le résultat du script = réponse finale

**Fichier :** `src/engine-runner.ts` (lignes ~102-108)

```typescript
// ── SHORT-CIRCUIT : résultat du script = réponse finale ──
// Le modèle ne fait que DÉCLENCHER le script via tool calling natif.
// Le script produit la réponse directement — pas de retour au modèle.
const hasNativeIds = toolCalls.some(tc => tc.toolCallId)
if (hasNativeIds) {
  return results.join('\n')
}
```

Dès qu'on détecte des `toolCallId` natifs, on exécute la commande et on retourne le résultat **sans jamais rappeler le LLM**.

### Étape 6 : handle.js dispatche selon le message

**Fichier :** `scripts/alice/handle.js`

Lit le message depuis `telecom/alice-input.txt`, match des patterns, et répond avec le sous-script approprié :

```
Message "bonjour"
  → isSimpleGreeting → greeting.js
  → "Bonjour ! Comment puis-je t'aider ?"

Message "bonjour alice"
  → isGreetingWithName → presentation.js
  → "Bonjour ! Je suis Alice..."

Message "j'ai un bug dans le login"
  → matchPattern → intercom.js
  → écrit dans telecom/intercom/ + réponse
```

---

## 4. Fichiers clés

### 4.1 Définition de l'agent Alice

**`.agents/alice.ts`**

```typescript
const definition: AgentDefinition = {
  id: 'alice',
  displayName: 'Alice',
  model: 'liquid/lfm2.5-1.2b',
  provider: 'lm-studio',
  toolNames: ['run_terminal_command'],     // ← UN SEUL outil
  toolConfig: {
    parallelTools: false,                   // ← pas de parallélisme
    toolTimeoutMs: 30000,
    maxParallel: 1
  },
  instructionsPrompt: `Tu es Alice, une interface utilisateur.

INSTRUCTION :
1. Exécute run_terminal_command("node scripts/alice/handle.js")
2. Affiche la sortie du script comme ta réponse.

Tu n'as rien d'autre à faire. Un seul appel suffit.
Le message de l'utilisateur est déjà dans telecom/alice-input.txt
— handle.js le lit automatiquement.`,
}
```

**Règles impératives :**
- `toolNames` ne doit contenir **que** `run_terminal_command` — sinon le modèle appelle `add_message`
- `parallelTools: false` — pas besoin de parallélisme pour un seul outil
- Le prompt est clair : une seule instruction, pas de choix

### 4.2 Le dispatcher handle.js

**`scripts/alice/handle.js`**

Points clés du code :

| Fonction | Rôle |
|----------|------|
| `readUserMessage()` | Lit depuis l'argument CLI ou `telecom/alice-input.txt` |
| `isSimpleGreeting()` | Détecte "bonjour", "salut", "hello"... |
| `isGreetingWithName()` | Détecte "bonjour alice", "salut toi"... |
| `matchPattern()` | Match patterns Intercom depuis `intercom-patterns.json` |
| `runScript()` | Exécute un sous-script Node.js avec timeout |
| `runIntercom()` | Appelle `scripts/alice/intercom.js` avec le message |

Architecture du dispatcher :
```
readUserMessage()
  │
  ├─ isGreetingWithName → presentation.js
  ├─ isSimpleGreeting   → greeting.js
  ├─ matchPattern       → intercom.js
  └─ fallback           → message générique
```

### 4.3 Le short-circuit (moteur)

**`src/engine-runner.ts`**

Le short-circuit est dans la boucle d'outils :

```typescript
while (toolCalls.length > 0 && loopCount < maxLoops) {
  const results = await deps.processTools(toolCalls)

  const hasNativeIds = toolCalls.some(tc => tc.toolCallId)
  if (hasNativeIds) {
    return results.join('\n')   // ← SORTIE DIRECTE
  }

  // Fallback texte (ancien comportement)...
}
```

### 4.4 Le fichier de passage de message

**`telecom/alice-input.txt`**

Fichier texte contenant exactement le message de l'utilisateur. Écrit par `cli-main.ts` avant l'appel LLM, lu par `handle.js` au démarrage.

**Important :** ce fichier est écrit **à chaque message**, donc toujours à jour.

### 4.5 Définitions d'outils

**`src/engine-llm.ts` — fonction `buildToolDefs()`**

Génère les définitions d'outils au format OpenAI. Pour `run_terminal_command` :

```typescript
{
  type: 'function',
  function: {
    name: 'run_terminal_command',
    description: 'Exécute une commande terminal et retourne le résultat',
    // ... parameters avec command: string
  }
}
```

---

## 5. Configuration d'un agent model→script

### 5.1 Créer un nouvel agent

```bash
npm run final
# Menu → 3. Create agent
# Provider: lm-studio
# Model: liquid/lfm2.5-1.2b (ou autre modèle local)
# ID: mon-agent
# Template: standard
# Pas de profile
```

### 5.2 Éditer le fichier agent

**`.agents/mon-agent.ts`**

```typescript
const definition: AgentDefinition = {
  id: 'mon-agent',
  displayName: 'Mon Agent',
  model: 'liquid/lfm2.5-1.2b',
  provider: 'lm-studio',
  toolNames: ['run_terminal_command'],         // ← seulement ça
  toolConfig: {
    parallelTools: false,
    toolTimeoutMs: 30000,
    maxParallel: 1
  },
  instructionsPrompt: `INSTRUCTION :
Exécute run_terminal_command("node scripts/mon-agent/handle.js")
Affiche la sortie. C'est tout.`,
}
```

### 5.3 Créer le script

**`scripts/mon-agent/handle.js`**

```javascript
#!/usr/bin/env node
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

const CWD = process.cwd()
const INPUT_FILE = join(CWD, 'telecom', 'alice-input.txt')

function readUserMessage() {
  const fromArg = process.argv.slice(2).join(' ').trim()
  if (fromArg) return fromArg
  try {
    if (existsSync(INPUT_FILE)) {
      const content = readFileSync(INPUT_FILE, 'utf-8').trim()
      if (content) return content
    }
  } catch {}
  return ''
}

function main() {
  const message = readUserMessage()
  if (!message) { console.log('Bonjour !'); process.exit(0) }

  // Ta logique ici...
  console.log(`Tu as dit : ${message}`)
  process.exit(0)
}

main()
```

### 5.4 L'écriture du fichier est déjà en place

Le code dans `src/cli-main.ts` écrit déjà le message utilisateur dans `telecom/alice-input.txt` **pour tous les agents**, pas seulement Alice. C'est une écriture unique, sans condition :

```typescript
const aliceInputPath = join(process.cwd(), 'telecom', 'alice-input.txt')
try {
  mkdirSync(dirname(aliceInputPath), { recursive: true })
  writeFileSync(aliceInputPath, line, 'utf-8')
} catch { /* ignoré — fichier non bloquant */ }
```

**Important :** actuellement un seul fichier (`telecom/alice-input.txt`) est utilisé pour tous les agents. Si plusieurs agents model→script doivent coexister, il faudra utiliser un fichier par agent (ex: `telecom/mon-agent-input.txt`).

---

## 6. Ajouter un pattern dans handle.js

### 6.1 Pattern simple (hardcodé)

```javascript
// 1. Ajouter une fonction de détection
function isMyPattern(text) {
  return /^(quoi|hein|pardon)/i.test(text)
}

// 2. Ajouter une fonction de réponse
function myResponse() {
  return 'Je n\'ai pas compris, peux-tu reformuler ?'
}

// 3. Ajouter dans le main(), AVANT le fallback
if (isMyPattern(userMessage)) {
  console.log(myResponse())
  process.exit(0)
}
```

### 6.2 Pattern via intercom.json

Ajoute dans `data/cahier-aides-alice/intercom-patterns.json` :

```json
{
  "patterns": [
    {
      "subject": "mon-service",
      "keywords": ["mot-clé-1", "mot-clé-2"],
      "minMatch": 1,
      "target": "agent-specialise",
      "priority": 5
    }
  ]
}
```

### 6.3 Pattern complexe (appel API)

```javascript
import { execSync } from 'child_process'

function runMyService(message) {
  try {
    return execSync(`node scripts/mon-service/handle.js "${message.replace(/"/g, '\\"')}"`, {
      cwd: CWD, encoding: 'utf-8', timeout: 10000
    }).trim()
  } catch { return null }
}

// Dans main() :
if (isMyPattern(userMessage)) {
  const response = runMyService(userMessage) ?? 'Service indisponible'
  console.log(response)
  process.exit(0)
}
```

---

## 7. Règles d'or

### 7.1 Le modèle ne doit JAMAIS traiter le résultat

- Le modèle déclenche le script → le script répond → fini
- Pas de continuation, pas de "laisse-moi vérifier", pas de reformulation
- Si le résultat n'est pas bon, c'est le script qu'il faut corriger, pas le prompt

### 7.2 Un seul outil par agent

- `toolNames: ['run_terminal_command']` — **uniquement ça**
- Si le modèle voit `add_message`, il l'appellera (description trop attractive)
- Si besoin de multiples actions, le dispatcher handle.js les gère

### 7.3 Le message passe toujours par fichier

- Le CLI écrit dans `telecom/alice-input.txt` AVANT l'appel LLM
- Le script lit depuis ce fichier
- **Jamais** de substitution `"<message>"` dans le prompt — un modèle 1.2B ne peut pas le faire

### 7.4 Toujours `parallelTools: false`

- Avec un seul outil, le parallélisme est inutile
- Évite les appels multiples inattendus

### 7.5 Toujours `toolTimeoutMs: 30000`

- Les scripts ne doivent jamais bloquer indéfiniment
- 30 secondes est un bon équilibre

### 7.6 Le short-circuit est obligatoire

- Sans lui, le résultat du script repasse par le LLM
- Le LLM le reformule mal, ou boucle, ou répond n'importe quoi
- `return results.join('\n')` directement

---

## 8. Dépannage

### Symptôme : "Message added" au lieu du résultat

**Cause :** Le modèle appelle `add_message` au lieu de `run_terminal_command`.

**Solutions :**
1. Vérifier `toolNames: ['run_terminal_command']` — retirer `add_message`
2. Vérifier `parallelTools: false`

### Symptôme : Boucle infinie (10 tours)

**Cause :** Le short-circuit ne s'active pas, ou le modèle rappelle l'outil.

**Solutions :**
1. Vérifier que `toolCallId` est bien présent dans les tool_calls
2. Vérifier que `hasNativeIds` est bien `true`
3. Vérifier que le prompt est clair : "Un seul appel suffit"

### Symptôme : Le script reçoit un message vide

**Cause :** Le fichier `telecom/alice-input.txt` n'est pas écrit, ou pas lu correctement.

**Solutions :**
1. Vérifier que `cli-main.ts` écrit bien dans `telecom/alice-input.txt`
2. Vérifier que `handle.js` lit bien depuis `CWD/telecom/alice-input.txt`
3. Tester manuellement : `echo "bonjour" > telecom/alice-input.txt && node scripts/alice/handle.js`

### Symptôme : Le modèle n'appelle aucun outil (pas de `[Tool Loop]`)

**Cause :** Le modèle ou le serveur LLM ne supporte pas le tool calling natif.

**Solutions :**
1. Vérifier que LM Studio a l'API "OpenAI" activée dans les paramètres serveur
2. Vérifier que le modèle supporte les function calls (tous les modèles via LM Studio oui, via Ollama non)
3. Si le provider ne supporte pas les tools, le `toolNames` est ignoré et le modèle ne voit que du texte
4. Vérifier les logs de la requête API : le paramètre `tools` doit être présent dans le body

### Symptôme : Le modèle ignore l'instruction et génère sa propre réponse

**Cause :** Le prompt n'est pas assez clair, ou le modèle ne voit pas les outils.

**Solutions :**
1. Vérifier que `tools` est bien dans la requête API (regarder les logs)
2. Raccourcir le prompt : moins de texte = plus de chances d'obéissance
3. Vérifier que le modèle supporte le tool calling natif (LM Studio oui, Ollama non)

### Symptôme : Le modèle appelle le bon outil mais avec le mauvais argument

**Cause :** Le prompt contient une instruction avec argument à substituer que le modèle modifie.

**Solutions :**
1. Le prompt doit être fixe : `run_terminal_command("node scripts/alice/handle.js")` — pas de `"<message>"`
2. Le message passe par le fichier, pas par l'argument

---

## 9. Annexe : évolution de l'architecture

### Version 1 (échec) : Substitution dans le prompt

```
Prompt: "Exécute run_terminal_command(\"node scripts/alice/handle.js \"<message>\"\")"
→ Modèle 1.2B ne fait PAS la substitution → appelle avec chaîne vide
```

### Version 2 (échec) : Fichier + retour au modèle

```
CLI écrit message → LLM appelle handle.js → résultat retourné au LLM
→ LLM reformule mal ou boucle
```

### Version 3 (succès) : Fichier + tool calling natif + short-circuit

```
CLI écrit message → LLM appelle handle.js via tool_calls natif
→ SHORT-CIRCUIT → résultat retourné directement à l'utilisateur
```

### Modifications clés

| Date | Fichier | Changement |
|------|---------|------------|
| 29 mai | `src/cli-main.ts` | Ajout écriture `telecom/alice-input.txt` avant appel LLM |
| 29 mai | `scripts/alice/handle.js` | Lecture depuis fichier + fallback |
| 29 mai | `.agents/alice.ts` | Prompt simplifié, plus de substitution |
| 29 mai | `src/engine-runner.ts` | Bugfix : passage de `currentMessage` au LLM |
| 29 mai | `src/engine-llm.ts` | Ajout `buildToolDefs()` + `parseRawToolCalls()` |
| 29 mai | `src/engine-llm.ts` | Ajout paramètre `tools` dans requête API |
| 29 mai | `src/engine-runner.ts` | Short-circuit : retour direct du résultat du script |
| 29 mai | `.agents/alice.ts` | `toolNames: ['run_terminal_command']` seulement |
| 29 mai | `src/types/agent-definition.ts` | Ajout `toolCallId` à `ToolCall` |

---

*Document créé le 29 mai 2026 — à mettre à jour à chaque modification de l'architecture.*
