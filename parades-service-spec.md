# Service Parades — Spécification fonctionnelle et technique

> **Statut :** 🚧 Spécification initiale  
> **Dernière mise à jour :** 2026-05-31  
> **Remplace :** `scripts/suggestions/handle.js` (obsolète)

---

## 1. Résumé

Le système actuel de « Suggestions » / « Actions rapides » est un script Node.js
procédural (`scripts/suggestions/handle.js`) qui génère des suggestions figées
à partir de règles codées en dur (logbook, notifications, projets, tâches).
Le problème : les suggestions sont **statiques**, **redondantes avec les menus
existants**, et n'apportent pas une vraie valeur ajoutée.

**Le service Parades remplace ce système** par un **agent LLM autonome**
(`agent-parades`) qui :
1. Analyse le contexte projet (métadonnées d'abord, fichiers ensuite)
2. Génère des propositions intelligentes et variées
3. Propose des actions réellement utiles que l'utilisateur n'aurait pas
   nécessairement envisagées

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Boucle principale CLI                 │
│  Action utilisateur ↓                                    │
│  ┌──────────────────┐                                    │
│  │ triggerParades() │ ← Nouveau : remplace triggerSuggestions() │
│  └──────┬──────────┘                                    │
│         │ fork + IPC                                     │
│         ▼                                                │
│  ┌──────────────────┐                                    │
│  │  agent-parades   │ ← Nouvel agent .agents/agent-parades.ts │
│  │  (LLM LM Studio) │                                    │
│  └──────┬──────────┘                                    │
│         │ écrit dans                                     │
│         ▼                                                │
│  ┌──────────────────┐    ┌──────────────────┐           │
│  │ parades.json     │    │ suggestions.json │ ← existe    │
│  │ (analyse longue) │    │ (actions rapides)│             │
│  └──────────────────┘    └──────────────────┘           │
│         │ fusionné par                                    │
│         ▼                                                │
│  ┌──────────────────┐                                    │
│  │ Menu Actions      │ ← Existant : showSuggestionMenu() │
│  │ rapides           │                                    │
│  └──────────────────┘                                    │
└─────────────────────────────────────────────────────────┘
```

### Flux détaillé

```
Étape 1 : Action utilisateur (routage intercom, LLM, !project)
Étape 2 : triggerParades() est appelé (async, non-bloquant)
Étape 3 : spawn-agent.js lance agent-parades avec le contexte
Étape 4 : agent-parades analyse le contexte :
          a) Métadonnées immédiates (tâches, notifications, logbook)
          b) Si nécessaire : exploration fichiers projet
Étape 5 : agent-parades génère 3-5 propositions (format structuré)
Étape 6 : Écrit dans telecom/parades.json (analyse longue)
          + fusionne dans telecom/suggestions.json (actions rapides)
Étape 7 : Au prochain tour CLI, le menu Actions rapides affiche
          les parades via showSuggestionMenu()
```

---

## 3. L'agent Parades

### 3.1 Création

Nouvel agent dans `.agents/agent-parades.ts` :

| Champ | Valeur |
|-------|--------|
| id | `agent-parades` |
| displayName | `Agent Parades` |
| model | `qwen/qwen3.5-9b` (LM Studio local) |
| provider | `lm-studio` |
| toolNames | `['run_terminal_command', 'add_message', 'set_output', 'skill']` |
| template | `standard` |
| autoStart | `false` (spawné à la demande) |

### 3.2 SKILL.md

Fichier `skills/skill-agent-parades/SKILL.md` avec :

- **Mission :** Analyser le contexte projet et générer des propositions
  d'action intelligentes (« parades ») pour l'utilisateur
- **Comportement :** Ne jamais exécuter les actions soi-même. Proposer
  uniquement. Varier les propositions à chaque appel.
- **Compétences :**
  - Analyser les métadonnées (tâches, notifications, logbook, registres)
  - Explorer les fichiers projet (README, code source, structure)
  - Générer des suggestions structurées (format label + description + command)
  - Apprendre des choix précédents (stats d'apprentissage)
- **Règles :**
  - S'adapter au fil du temps (phase d'évolution : métadonnées → fichiers)
  - Privilégier 3-5 propositions maximum
  - Ne jamais proposer d'actions destructrices (rm, delete, drop)
  - Varier le style et les formulations pour éviter la monotonie

### 3.3 Prompt système

```
Tu es l'Agent Parades du système Minautor Agents.

## Mission
Analyse le contexte actuel du projet et génère des propositions
d'action intelligentes pour l'utilisateur. Tu remplaces l'ancien
système de suggestions statiques.

## Contexte reçu
{context}  — JSON avec : projet courant, tâches, notifications,
             logbook, agents disponibles, skills, profils

## Format de sortie
Tu dois écrire un JSON structuré dans telecom/parades.json :
{
  "analysis": "Résumé en 1-2 phrases du contexte et de ton analyse",
  "evolved": true/false,  // true si tu as exploré les fichiers
  "parades": [
    {
      "label": "Titre court de la proposition",
      "description": "Explication détaillée (pourquoi c'est pertinent)",
      "command": "Commande CLI à exécuter (commence par ! ou /)",
      "group": "Catégorie (Exploration, Développement, Gestion...)"
    }
  ]
}

## Règles
1. 3-5 propositions maximum. Qualité > quantité.
2. Ne JAMAIS exécuter les commandes toi-même.
3. Varier les propositions à chaque appel (ne pas répéter).
4. Phase d'évolution :
   - Premiers appels : métadonnées uniquement (tâches, notifications)
   - Appels suivants : explorer les fichiers du projet
5. Ne rien proposer de destructeur.
6. Si le projet est vide ou nouveau, proposer des actions de démarrage.
```

---

## 4. Implémentation

### 4.1 Module `src/parades.ts`

Nouveau module central. API publique :

```typescript
// Déclenché après chaque action utilisateur (non-bloquant)
export function triggerParades(context: ParadeContext): void

// Fusionne les parades avec les suggestions existantes
export function mergeParadesWithSuggestions(): Suggestion[]

// Interface contexte
interface ParadeContext {
  projectName?: string
  action: 'route' | 'llm-response' | 'project-use' | 'task-done'
  demande?: string
  llmResponse?: string
}
```

Fonctionnement :
1. `triggerParades()` collecte le contexte actuel
2. Forke `spawn-agent.js agent-parades` avec le contexte en JSON
3. `agent-parades` analyse, génère les parades, écrit `telecom/parades.json`
4. Au prochain tour CLI, `mergeParadesWithSuggestions()` fusionne les
   parades dans `telecom/suggestions.json`
5. Le menu Actions rapides s'affiche normalement

### 4.2 Remplacement de handle.js

- Le fichier `scripts/suggestions/handle.js` **n'est plus appelé**
- La fonction `triggerSuggestions()` dans `cli-main.ts` est remplacée
  par `triggerParades()`
- Supprimer : `scripts/suggestions/handle.js`
- Conserver : `data/suggestions/templates.yaml` pour référence ou archives

### 4.3 Dashboard de suivi

Optionnel (phase 2) : un fichier `telecom/parades-dashboard.json` qui
stocke l'historique des parades générées pour analyse.

---

## 5. Déclenchement

| Action | Déclenche triggerParades ? | Contexte fourni |
|--------|---------------------------|-----------------|
| Routage intercom (tryRouteIntercom) | ✅ Oui | `{ action: 'route', demande }` |
| Réponse LLM | ✅ Oui | `{ action: 'llm-response', demande, llmResponse }` |
| !project use <nom> | ✅ Oui | `{ action: 'project-use', projectName }` |
| !project task <nom> done | ✅ Oui | `{ action: 'task-done', projectName }` |
| Menu suggestions ignoré | ❌ Non | — |
| Commande inconnue | ❌ Non | — |

**Anti-boucle :** Ne pas déclencher si `agent-parades` est déjà en cours
(flag `_paradesRunning`). Timeout de 60s, silence en cas d'échec.

---

## 6. Format des parades (parades.json)

```json
{
  "generatedAt": "2026-05-31T14:30:00.000Z",
  "analysis": "Le projet soulseek-downloader a 3 tâches en cours et 2 fichiers récents modifiés dans le dossier backend.",
  "evolved": false,
  "context": {
    "projectName": "soulseek-downloader",
    "action": "route",
    "demande": "lister mes projets"
  },
  "parades": [
    {
      "label": "Voir les tâches en cours",
      "description": "3 tâches sont actives sur soulseek-downloader. La plus récente concerne l'ajout d'un filtre de recherche. Veux-tu voir le détail ?",
      "command": "!project tasks soulseek-downloader",
      "group": "Gestion"
    },
    {
      "label": "Explorer les modifications récentes",
      "description": "Deux fichiers ont été modifiés ce matin dans src/services/. Un coup d'oeil ?",
      "command": "!explore soulseek-downloader --recent",
      "group": "Exploration"
    },
    {
      "label": "Démarrer le débogage",
      "description": "Une notification d'avertissement concerne une erreur de connexion — analyser les logs ?",
      "command": "!debug soulseek-downloader",
      "group": "Maintenance"
    }
  ]
}
```

### Fusion avec suggestions.json

Le module `mergeParadesWithSuggestions()` :
1. Charge `telecom/parades.json` (si existe)
2. Transforme chaque parade en `Suggestion` (format actuel)
3. Ajoute : `label` = parade.label, `description` = parade.description,
   `command` = parade.command, `group` = parade.group
4. Écrit dans `telecom/suggestions.json`
5. Les templates YAML (post-script) ne sont **pas** supprimés immédiatement
   mais deviennent optionnels — les parades les remplacent progressivement

---

## 7. Évolution progressive

### Phase 1 — Métadonnées (jour 1)

- `agent-parades` reçoit uniquement le contexte structuré (JSON)
- Pas d'exploration fichier
- Génération rapide (< 5 secondes via LM Studio local)
- Les parades sont basées sur :
  - Tâches du projet actif (statuts, domaines)
  - Notifications récentes
  - Logbook (dernières actions réussies/échouées)
  - Projets disponibles
  - Agents et skills

### Phase 2 — Exploration fichiers (jour 3+)

- `agent-parades` peut utiliser `run_terminal_command` pour :
  - `ls -la workspaces/<projet>/` — structure du projet
  - `cat workspaces/<projet>/README.md` — documentation
  - `tree /F workspaces/<projet>/src` — arborescence détaillée
  - `git log --oneline -10` — historique git récent
- Analyse des tendances et patterns dans le projet
- Propositions basées sur le code réel

### Phase 3 — Apprentissage (jour 7+)

- Intégration des **stats d'apprentissage** existantes
  (`suggestion_stats.json`) pour prioriser les types de parades
- Détection des préférences utilisateur :
  - Si l'utilisateur choisit souvent « Voir les tâches » → proposer plus
    de parades liées aux tâches
  - Si l'utilisateur ignore les parades de « Découverte » → les espacer
- Éviter la monotonie : un pool de 20+ types de parades

---

## 8. Questions résolues

| Question | Réponse |
|----------|---------|
| Stack technique | Mix : agent LLM + sous-scripts |
| Déclenchement | Après chaque action auto |
| Analyse | Métadonnées → fichiers (progressif) |
| Canal de sortie | Menu suggestions existant (suggestions.json) |
| Modèle LLM | LM Studio local (qwen/qwen3.5-9b) |
| Temps max | Pas de limite (async non-bloquant) |
| Évolution | Progressive (3 phases) |
| handle.js | Remplacé |
| Agent dédié | Oui : .agents/agent-parades.ts |

---

## 9. Fichiers modifiés / créés

| Fichier | Action |
|---------|--------|
| `.agents/agent-parades.ts` | ✨ Nouvel agent |
| `skills/skill-agent-parades/SKILL.md` | ✨ Nouvelle skill |
| `src/parades.ts` | ✨ Nouveau module central |
| `src/cli-main.ts` | 🔧 Remplacer `triggerSuggestions()` par `triggerParades()` |
| `src/cli-suggestions.ts` | 🔧 Ajouter `mergeParadesWithSuggestions()` |
| `telecom/parades.json` | ✨ Fichier de sortie (gitignored) |
| `scripts/suggestions/handle.js` | 🔥 Supprimé |
| `data/suggestions/templates.yaml` | 📦 Archivé (plus utilisé) |

---

## 10. Tests

### Tests unitaires
- `src/test/test-parades.ts` — Vérifier le format de sortie de
  `agent-parades` : JSON valide, 3-5 parades, champs requis
- Tester `mergeParadesWithSuggestions()` : fusion correcte,
  déduplication
- Tester le timeout / non-blocage : `triggerParades()` ne bloque pas

### Tests d'intégration
- Scénario A : Routage "lister mes projets" → parades générées →
  menu Actions rapides affiché (simuler avec tmux-cli)
- Scénario B : Projet vide → parades de démarrage proposées
- Scénario C : Après `!project task X done` → parade propose
  « Voir la prochaine tâche »

---

## 11. Points d'attention

1. **Performance LM Studio :** Le modèle qwen/qwen3.5-9b local peut
   prendre 10-30 secondes pour la première inférence (chargement).
   `triggerParades()` doit être **non-bloquant** (fire-and-forget).
2. **Cache des embeddings :** Si LM Studio est indisponible, le
   service doit échouer silencieusement (pas de crash CLI).
3. **Anti-répétition :** L'agent doit varier ses propositions. Prévoir
   un mécanisme (seed aléatoire, historique des 5 dernières parades).
4. **Sécurité :** L'agent a accès à `run_terminal_command` — le
   Guardian doit rester actif pour éviter les commandes destructrices.
5. **Compatibilité IPC :** `agent-parades` doit envoyer une notification
   IPC de type `conclusion` quand il a fini d'écrire les parades,
   pour que le daemon déclenche `showSuggestionMenuRaw()`.
