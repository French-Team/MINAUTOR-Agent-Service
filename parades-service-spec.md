# Service Parades — Spécification fonctionnelle et technique

> **Statut :** ✅ Prêt pour implémentation  
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
┌───────────────────────────────────────────────────────────────┐
│                    Boucle principale CLI                       │
│  Action utilisateur ↓                                          │
│  ┌───────────────────────────────────┐                        │
│  │ Handler IPC conclusion            │                        │
│  │  → Lit telecom/.last-context.json │ ← Fichier contexte     │
│  │  → triggerParades(ctx)            │ ← Nouveau              │
│  │  → Affiche spinner ⟳             │                        │
│  │  → spawn-agent.js [agent-parades] │ ← Nouvel agent         │
│  │  → Polling suggestions.json       │ ← Synchro async        │
│  │  ← Si input utilisateur : stop    │ ← Annulation           │
│  │  → Cache spinner                  │                        │
│  │  → showSuggestionMenuRaw()        │ ← Existant             │
│  └──────────┬────────────────────────┘                        │
│             │                                                  │
│  ┌──────────▼────────────────────────┐                        │
│  │  agent-parades (via spawn-agent)   │                        │
│  │  1. Génère 3-5 parades            │                        │
│  │  2. Écrit dans suggestions.json    │                        │
│  │  3. Met à jour la fiche de suivi   │ ← NOUVEAU              │
│  │  4. Signale au reviewer (si Phase≥2)│ ← NOUVEAU              │
│  └──────────┬────────────────────────┘                        │
│             │                                                  │
│  ┌──────────▼────────────────────────┐                        │
│  │  agent-reviewer (validation)       │ ← NOUVEAU              │
│  │  Valide/certifie les parades       │                        │
│  │  Écrit dans la fiche de suivi      │                        │
│  └──────────┬────────────────────────┘                        │
│             │                                                  │
│  ┌──────────▼────────────────────────┐                        │
│  │  telecom/suggestions.json         │ ← Écrit parades validées│
│  │  telecom/agents/agent-parades/     │                        │
│  │    suivi.json (fiche de suivi)     │ ← NOUVEAU              │
│  │    par-dossier/ (logs, scripts)    │ ← Bureau de l'agent    │
│  └───────────────────────────────────┘                        │
└───────────────────────────────────────────────────────────────┘
```

### Flux détaillé

```
Étape 1 : Action utilisateur → boucle écrit telecom/.last-context.json
          (contient : action, demande, projectName, timestamp)

Étape 2 : Daemon envoie notification IPC 'conclusion'

Étape 3 : Handler IPC conclusion détecté
          → Lit telecom/.last-context.json pour obtenir le contexte
          → triggerParades(context) est appelé
          → Affiche spinner ⟳ "Génération des parades..."

Étape 4 : spawn-agent.js agent-parades <contexte JSON>

Étape 5 : CLI entre en mode polling :
          → Vérifie telecom/suggestions.json toutes les 500ms
          → SI utilisateur tape une touche → ANNULATION immédiate
            → Cache spinner, supprime .last-context.json, retour au prompt
          → SINON : continue le polling

Étape 6 : agent-parades (sous-processus) :
          a) Lit la fiche de suivi (telecom/agents/agent-parades/suivi.json)
             pour connaître les parades déjà proposées (évite les répétitions)
          b) Analyse le contexte selon evolutionPhase
          c) Génère 3-5 parades originales (non déjà proposées)
          d) Écrit dans telecom/suggestions.json
          e) Met à jour la fiche de suivi (proposed)

Étape 7 : (Phase 2+) agent-reviewer est invoqué en parallèle :
          a) Vérifie la cohérence et la pertinence des parades
          b) Valide ou rejette chaque parade
          c) Met à jour la fiche de suivi (validated/rejected)
          d) Les parades validées sont conservées dans suggestions.json

Étape 8 : Polling détecte suggestions.json → cache le spinner
          → showSuggestionMenuRaw() affiche le menu

Étape 9 : (Phase 3+) Quand l'utilisateur choisit une parade :
          → La fiche de suivi est mise à jour (certified/chosen)
          → L'action est enregistrée pour apprentissage futur
```

---

## 3. L'agent Parades

### 3.1 Bureau de l'agent

Chaque agent dans le système a son propre espace de travail dans
`telecom/agents/<agent-id>/`. Pour l'agent-parades :

| Chemin | Usage |
|--------|-------|
| `telecom/agents/agent-parades/suivi.json` | Fiche de suivi : historique des parades (proposed, validated, rejected, certified) |
| `telecom/agents/agent-parades/logs/` | Logs des appels, erreurs, temps de génération |
| `telecom/agents/agent-parades/scripts/` | Scripts de maintenance, utilitaires |
| `telecom/agents/agent-parades/stats.json` | Stats d'apprentissage (Phase 3+) |

### 3.2 Fiche de suivi (suivi.json)

La fiche de suivi est le cœur du système d'anti-répétition et d'apprentissage.
Chaque parade proposée est enregistrée avec son statut de validation.

```json
{
  "agent": "agent-parades",
  "phase": 1,
  "entries": [
    {
      "id": "p-20260531-001",
      "date": "2026-05-31T14:30:00Z",
      "action": "route",
      "demande": "lister mes projets",
      "parades": [
        {
          "label": "Débloquer la tâche réseau",
          "command": "!project tasks soulseek-downloader --area network",
          "status": "validated",
          "reviewer": "agent-reviewer",
          "validatedAt": "2026-05-31T14:30:15Z"
        },
        {
          "label": "Continuer le filtre recherche",
          "command": "!project task T1 status soulseek-downloader",
          "status": "certified",
          "reviewer": "agent-reviewer",
          "chosenAt": "2026-05-31T14:31:00Z"
        },
        {
          "label": "Découvrir mon-autre-projet",
          "command": "!explore mon-autre-projet",
          "status": "rejected",
          "reviewer": "agent-reviewer",
          "reason": "Projet inactif depuis 30 jours — proposer plus tard"
        }
      ]
    }
  ]
}
```

**Cycle de vie d'une parade :**
```
proposed (par agent-parades)
    │
    ▼
validated (par agent-reviewer)
    │
    ├── chosen (par l'utilisateur) → certified
    └── rejected (par agent-reviewer) → archived
```

### 3.3 Création

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

### 3.4 SKILL.md

Fichier `skills/skill-agent-parades/SKILL.md` avec :

- **Mission :** Analyser le contexte projet et générer des propositions
  d'action intelligentes (« parades ») pour l'utilisateur
- **Comportement :** Ne jamais exécuter les actions soi-même. Proposer
  uniquement. Varier les propositions à chaque appel.
- **Compétences :**
  - Lire et écrire la fiche de suivi (`telecom/agents/agent-parades/suivi.json`)
  - Analyser les métadonnées (tâches, notifications, logbook, registres)
  - Explorer les fichiers projet (README, code source, structure)
  - Générer des suggestions structurées (format label + description + command)
  - Composer des parades multi-agents (Phase 2+)
  - Apprendre des choix précédents (stats d'apprentissage, Phase 3+)
- **Règles :**
  - Consulter la fiche de suivi AVANT de générer les parades (éviter les répétitions)
  - S'adapter au fil du temps (phase d'évolution : métadonnées → fichiers)
  - Privilégier 3-5 propositions maximum
  - Ne jamais proposer de parades déjà rejetées
  - Si une parade implique plusieurs agents, le spécifier dans la description
  - Ne jamais proposer d'actions destructrices (rm, delete, drop)

### 3.5 Prompt système

```
Tu es l'Agent Parades du système Minautor Agents.

## Mission
Analyse le contexte actuel du projet et génère des propositions
d'action intelligentes pour l'utilisateur. Tu remplaces l'ancien
système de suggestions statiques.

## Contexte reçu
{context}  — JSON avec : evolutionPhase, action, demande, metadata

## Format de sortie

Tu dois écrire ta sortie dans telecom/suggestions.json au format suivant :

{
  "menu": "Actions rapides",
  "items": [
    {
      "label": "Titre court de la proposition",
      "description": "Explication détaillée de pourquoi c'est pertinent",
      "command": "!project tasks mon-projet"
    }
  ]
}

IMPORTANT : Écris UNIQUEMENT dans telecom/suggestions.json.
N'écris PAS dans un autre fichier.

## Règles
1. 3-5 propositions maximum. Qualité > quantité.
2. Ne JAMAIS exécuter les commandes toi-même.
3. Varier les propositions à chaque appel (ne pas répéter).
4. Respecter la phase d'évolution (evolutionPhase dans le contexte) :
   - Phase 0-1 : Métadonnées uniquement (tâches, notifications)
   - Phase 2 : Explorer les fichiers du projet avec run_terminal_command
   - Phase 3 : Adapter aux stats d'apprentissage si fournies
5. Ne rien proposer de destructeur.
6. Si le projet est vide ou nouveau, proposer des actions de démarrage.
```

---

## 4. Implémentation

### 4.1 Module `src/parades.ts`

Nouveau module central. API publique :

```typescript
export function triggerParades(context: ParadeContext): void

interface ParadeContext {
  projectName?: string
  action: 'route' | 'llm-response' | 'project-use' | 'task-done'
  demande?: string
  llmResponse?: string
}
```

Fonctionnement :
1. Collecte le contexte actuel (projet, tâches, notifications, logbook)
2. Lit `data/rules/parades-phases.yaml` pour déterminer la phase d'évolution
3. Construit le prompt final avec la phase + contexte JSON
4. Forke `spawn-agent.js agent-parades` avec le prompt
5. Lance le polling sur `telecom/suggestions.json`
6. Quand le fichier est trouvé → cache le spinner → déclenche le menu

### 4.2 Gestion du contexte IPC

Le fichier `telecom/.last-context.json` fait le pont entre la boucle
principale et le handler IPC. Écrit par la boucle, lu par le handler.

```typescript
// Écrit par la boucle principale APRÈS chaque action
function writeLastContext(context: ParadeContext): void {
  writeFileSync(join(process.cwd(), 'telecom', '.last-context.json'),
    JSON.stringify({ ...context, timestamp: Date.now() }))
}

// Lu par le handler IPC notification 'conclusion'
function readLastContext(): ParadeContext | null {
  const path = join(process.cwd(), 'telecom', '.last-context.json')
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf-8'))
}
```

**Points d'appel :**
- Après `tryRouteIntercom()` → écrire le contexte
- Après réponse LLM → écrire le contexte
- Dans le dispatch IPC (après une commande `!project use`, etc.) → écrire
- Quand le polling est annulé → supprimer le fichier (nettoyage)

### 4.3 Validation et reviewer

En Phase 1, l'agent-parades écrit directement les parades validées.
En Phase 2+, un deuxième spawn invoque `agent-reviewer` pour valider :

```
Étape 1 : agent-parades écrit suggestions.json + suivi.json (proposed)
Étape 2 : spawn-agent.js agent-reviewer "Valide les parades dans suggestions.json"
Étape 3 : agent-reviewer lit les parades, applique les règles, valide/rejette
Étape 4 : Si validé → statut 'validated' dans suivi.json
Étape 5 : Si rejeté → statut 'rejected' + raison, parade retirée de suggestions.json
Étape 6 : Si l'utilisateur choisit → statut 'certified' (tracké dans learning.ts)
```

**Cas multi-agent :** Si une parade implique plusieurs agents (ex:
« Analyser le projet avec l'agent-hecatonchires puis reviewer le résultat »),
agent-parades le spécifie dans la description. L'exécution de la parade
est déléguée au système intercom (pas à agent-parades).

### 4.4 Fichier de règles de phase

Fichier : `data/rules/parades-phases.yaml`

```yaml
# Règles de phase pour l'Agent Parades
# Lues par src/parades.ts pour déterminer evolutionPhase avant de spawner l'agent

phases:
  - phase: 0  # Démarrage — aucun projet
    label: "Démarrage"
    conditions:
      - key: "projects.count"
        operator: "=="
        value: 0
    instructions: |
      Aucun projet existant. Proposer uniquement :
      - Créer un premier projet
      - Explorer les profils disponibles
      - Voir l'aide du système
      - Découvrir les agents disponibles

  - phase: 1  # Métadonnées — projet(s) existant(s)
    label: "Métadonnées"
    conditions:
      - key: "projects.count"
        operator: ">"
        value: 0
      - key: "evolution.paradesGenerated"
        operator: "<"
        value: 10
    instructions: |
      Métadonnées uniquement. Baser les parades sur :
      - Tâches (statuts, domaines, progression)
      - Notifications (urgentes, avertissements)
      - Logbook (dernières actions)
      - Projets disponibles
      Ne PAS explorer les fichiers (pas de run_terminal_command).

  - phase: 2  # Exploration fichiers — agent mature
    label: "Exploration fichiers"
    conditions:
      - key: "evolution.paradesGenerated"
        operator: ">="
        value: 10
    instructions: |
      Exploration fichiers autorisée. Utiliser run_terminal_command pour :
      - ls -la workspaces/<projet>/
      - cat workspaces/<projet>/README.md
      - git log --oneline -10 (depuis le dossier du projet)
      Analyser les résultats et baser les parades sur le code réel.

  - phase: 3  # Apprentissage actif (réservé, non implémenté en V1)
    label: "Apprentissage"
    conditions:
      - key: "phase.override"
        operator: ">="
        value: 3
    instructions: |
      Adapter les parades aux stats d'apprentissage :
      - Privilégier les catégories populaires
      - Espacer (voire supprimer) les catégories ignorées
      - Détecter les changements de comportement
```

### 4.5 Module `src/learning.ts` (Phase 3)

Module dédié au tracking des choix utilisateur et à l'apprentissage.
Les données sont stockées dans `telecom/agents/agent-parades/stats.json`
(bureau de l'agent) plutôt que dans un emplacement central.

```typescript
export class LearningTracker {
  load(): LearningStats
  recordChoice(command: string, category: string): void
  getPreferences(): CategoryPreferences
  isReady(): boolean  // true quand assez de données pour l'apprentissage
}

interface LearningStats {
  totalChoices: number
  last5Choices: string[]
  categoryHits: Record<string, number>
  categoryMisses: Record<string, number>
  lastUpdated: string
}

interface CategoryPreferences {
  preferred: string[]      // Catégories les plus choisies
  avoided: string[]        // Catégories systématiquement ignorées
  recentShift: boolean     // Changement de comportement détecté
}
```

Stockage : `telecom/agents/agent-parades/stats.json`

> **Note :** Section 11 liste `data/learning/choices.json` — **obsolète**.
> Le chemin canonique est `telecom/agents/agent-parades/stats.json`.

### 4.6 Remplacement de handle.js

**Décision : supprimer dans le même commit.** Pas de transition progressive,
pas de flag. handle.js est supprimé avec ses appels dans le premier commit
du service Parades.

- Le fichier `scripts/suggestions/handle.js` **n'est plus appelé**
- La fonction `triggerSuggestions()` dans `cli-main.ts` est remplacée
  par `triggerParades()`
- Supprimer : `scripts/suggestions/handle.js`
- Conserver : `data/suggestions/templates.yaml` pour référence

---

## 5. Déclenchement

| Action | Déclenche triggerParades ? | Contexte fourni | Note |
|--------|---------------------------|-----------------|------|
| Notification IPC `conclusion` | ✅ Oui | `{ action: 'route', demande }` | Déclenché par le handler IPC |
| Réponse LLM | ✅ Oui | `{ action: 'llm-response', demande, llmResponse }` | Si triggerSuggestions est appelé, le remplacer |
| `!project use <nom>` | ✅ Oui | `{ action: 'project-use', projectName }` | Dans le dispatch IPC |
| `!project task <id> done` | ✅ Oui | `{ action: 'task-done', projectName }` | Dans le dispatch IPC |
| Menu suggestions ignoré | ❌ Non | — | Pas de génération inutile |
| Commande inconnue | ❌ Non | — | Pas de génération inutile |

**Anti-boucle :** Flag `_paradesRunning` dans le handler IPC. Si déjà en cours,
on ne relance pas. Le polling en cours continue.

**Anti-répétition :** Basé sur la fiche de suivi (`suivi.json`). L'agent
consulte les 10 dernières entrées AVANT de générer. Toute parade déjà
proposée (même commande) dans les 5 dernières générations est exclue.
Les parades rejetées (rejected) sont exclues définitivement.

---

## 6. Format de sortie (suggestions.json)

L'agent écrit directement dans `telecom/suggestions.json` :

```json
{
  "menu": "Actions rapides",
  "items": [
    {
      "label": "Débloquer la tâche réseau",
      "description": "La tâche 'Corriger timeout connexion' (network) est bloquée. C'est la seule tâche en statut bloqué.",
      "command": "!project tasks soulseek-downloader --area network"
    },
    {
      "label": "Continuer le filtre recherche",
      "description": "La tâche 'Ajouter filtre recherche' est en cours dans backend.",
      "command": "!project task T1 status soulseek-downloader"
    },
    {
      "label": "Explorer les modifications récentes",
      "description": "Deux fichiers ont été modifiés ce matin dans src/services/.",
      "command": "!explore soulseek-downloader --recent"
    }
  ]
}
```

Le format est compatible avec `showSuggestionMenu()` qui attend un menu avec
`menu` (titre) et `items[]` (label, description, command).

**Aucun merge nécessaire** — l'agent écrit directement le bon format.

---

## 7. Évolution progressive (Cahier des charges)

Chaque phase est un **jalon** avec son propre cahier des charges.
On passe à la phase suivante quand la phase en cours est complètement
implémentée, stable, et validée.

### Phase 0 — Démarrage

**Objectif :** Aider l'utilisateur à démarrer (aucun projet existant).

Déclenchée quand : `projects.count === 0`
- Agent reçoit `evolutionPhase: 0`
- Parades basées uniquement sur : profils disponibles, agents, skills, aide
- Propositions : créer projet, explorer profils, voir aide, lister agents
- **Pas de fiche de suivi** (trop tôt)
- **Pas de reviewer**

### Phase 1 — Métadonnées

**Objectif :** Proposer des actions pertinentes basées sur les données structurées.

Déclenchée quand : `projects.count > 0`
- Agent reçoit `evolutionPhase: 1`
- Parades basées sur : tâches, notifications, logbook, projets, agents, skills
- **Fiche de suivi active** : chaque parade est enregistrée dans suivi.json
- **Consultation de la fiche** : les 10 dernières entrées sont fournies dans
  le contexte pour éviter les répétitions
- **Pas d'exploration fichiers**
- **Pas de reviewer** (les parades sont proposées directement)

### Phase 2 — Exploration fichiers + Reviewer

**Objectif :** Parades basées sur le code réel, validées par un reviewer.

Déclenchée quand : la Phase 1 est **terminée et validée** (planification manuelle)
- Agent reçoit `evolutionPhase: 2`
- Peut utiliser `run_terminal_command` pour explorer les fichiers projet
- **Reviewer actif** : agent-reviewer valide chaque parade avant publication
- **Fiche de suivi** : status 'proposed' → 'validated'/'rejected'
- **Multi-agent** : les parades peuvent impliquer plusieurs agents
- **Stats tracking** : les choix utilisateur sont enregistrés

### Phase 3 — Apprentissage

**Objectif :** Parades adaptatives qui apprennent des préférences utilisateur.

Déclenchée quand : la Phase 2 est **terminée et validée**
- La planification manuelle (humaine) écrit un flag dans
  `telecom/agents/agent-parades/phase.json` → `{ "phase": 3 }`
- Le YAML de règles (4.4) est mis à jour pour refléter la nouvelle phase
- Module `src/learning.ts` actif
- Stats stockées dans `telecom/agents/agent-parades/stats.json`
- Détection des préférences utilisateur
- Changement de comportement détecté (shift)
- Anti-répétition renforcée par l'apprentissage

---

## 8. Guide de formatage des prompts de l'agent-parades

### Structure d'un prompt complet

Chaque invocation de l'agent-parades reçoit un prompt construit dynamiquement
par `triggerParades()`. Le prompt final est composé de 3 couches :

```
┌─────────────────────────────────────────────────────┐
│  Couche 1 : Prompt système (fixe)                   │
│  "Tu es l'Agent Parades..." + règles générales      │
├─────────────────────────────────────────────────────┤
│  Couche 2 : Règles de phase (lues depuis le YAML)   │
│  Phase X → instructions spécifiques à la phase      │
├─────────────────────────────────────────────────────┤
│  Couche 3 : Contexte JSON (dynamique)               │
│  { evolutionPhase, action, metadata, learningStats }│
└─────────────────────────────────────────────────────┘
```

### Règles pour l'écriture des prompts

1. **Précis mais ouvert** — Donner des instructions claires sans trop
   contraindre la créativité de l'agent.
2. **Exemples concrets** — Inclure 1-2 exemples dans les règles de phase.
3. **Instructions négatives** — Privilégier « Ne propose pas X » à « Propose Y ».
4. **Marqueurs de phase** — `evolutionPhase: 0|1|2|3` dans le contexte pour
   que l'agent sache où il en est.

---

## 9. Nouvelles commandes CLI (à créer en parallèle)

### Point d'entrée

Les nouvelles commandes sont enregistrées **à deux endroits** :
1. **`data/scripts/registry.yaml`** (routing regex) — pour que le script-runner
   puisse les reconnaître automatiquement
2. **`src/cli-main.ts`** (dispatch central) — ajout d'un `else if` dans la chaîne
   de dispatch existante (comme `!project`, `!agents`, `!tasks`)

### 9.1 `!explore <projet> [--recent|--path <dossier>]`

**Script :** `scripts/parades/explore.js`

Explore la structure d'un projet et affiche des informations utiles :
- Arborescence des fichiers (`ls -la`, `tree`)
- Documentation (`README.md`, si existe)
- Derniers commits git
- Dépendances (package.json, requirements.txt)

**Flags :**
- `--recent` : seulement les fichiers modifiés dans les dernières 24h
- `--path <dossier>` : explorer uniquement un sous-dossier

### 9.2 `!deploy <projet> [--dry-run]`

**Script :** `scripts/parades/deploy.js`

Prépare et exécute un déploiement du projet :
- Vérifie l'état actuel (git status, dépendances)
- `--dry-run` : affiche ce qui serait déployé sans agir
- Propose un tag git et une description

### 9.3 `!doc <action> <args>`

**Script :** `scripts/parades/doc.js`

Gère la documentation du projet :
- `!doc create README <projet>` — génère un README
- `!doc check <projet>` — vérifie la couverture doc
- `!doc update <projet>` — met à jour les docs existantes

### 9.4 `!git <action> <projet> [args]`

**Script :** `scripts/parades/git.js`

Opérations git simplifiées :
- `!git init <projet>` — initialise git dans le projet
- `!git log <projet>` — affiche l'historique
- `!git status <projet>` — état courant

### 9.5 `!profiles <action> <query>`

**Script :** `scripts/parades/profiles.js`

Recherche dans la bibliothèque de profils :
- `!profiles search <query>` — cherche des profils par mot-clé
- `!profiles list [category]` — liste les profils (agents, bots, daemons)

---

## 10. Questions résolues

| Question | Réponse |
|----------|---------|
| Stack technique | Mix : agent LLM + sous-scripts |
| Déclenchement | Handler IPC conclusion (comme actuel) |
| Analyse | Métadonnées → fichiers (progressif via règles YAML) |
| Canal de sortie | Direct dans suggestions.json — pas de merge |
| Modèle LLM | LM Studio local (qwen/qwen3.5-9b) |
| Sync | Spinner + polling (pas de timeout dur) |
| Règles de phase | Fichier YAML lu par le CLI |
| Stats tracking | Module dédié src/learning.ts |
| handle.js | Remplacé |
| Agent dédié | Oui : .agents/agent-parades.ts |
| Nouvelles commandes | !explore, !deploy, !doc, !git, !profiles |

---

## 11. Fichiers modifiés / créés

| Fichier | Action |
|---------|--------|
| `.agents/agent-parades.ts` | ✨ Nouvel agent |
| `skills/skill-agent-parades/SKILL.md` | ✨ Nouvelle skill |
| `src/parades.ts` | ✨ Nouveau module central |
| `src/learning.ts` | ✨ Nouveau module tracking |
| `data/rules/parades-phases.yaml` | ✨ Règles de phase |
| `src/cli-main.ts` | 🔧 Remplacer `triggerSuggestions()` par `triggerParades()` |
| `scripts/parades/explore.js` | ✨ Nouveau script `!explore` |
| `scripts/parades/deploy.js` | ✨ Nouveau script `!deploy` |
| `scripts/parades/doc.js` | ✨ Nouveau script `!doc` |
| `scripts/parades/git.js` | ✨ Nouveau script `!git` |
| `scripts/parades/profiles.js` | ✨ Nouveau script `!profiles` |
| `telecom/suggestions.json` | 📝 Écrit par l'agent (format existant) |
| `telecom/agents/agent-parades/stats.json` | ✨ Stats d'apprentissage (bureau de l'agent) |
| `scripts/suggestions/handle.js` | 🔥 Supprimé |
| `data/suggestions/templates.yaml` | 📦 Archivé (si supprimé, mettre à jour `src/suggestion-templates.ts`) |

---

## 12. Tests

### Tests unitaires
- `src/test/test-parades.ts` — Vérifier le format de sortie : JSON valide,
  `menu` + `items[]`, 3-5 items, champs requis
- `src/test/test-phases.ts` — Tester la lecture du YAML de règles : chaque
  condition est correctement évaluée, la bonne phase est retournée
- `src/test/test-learning.ts` — Tester `LearningTracker` : enregistrement,
  chargement, stats correctes

### Tests d'intégration
- Scénario A : Routage « lister mes projets » → notification IPC conclusion →
  `triggerParades()` → spinner → suggestions.json écrit → menu affiché
- Scénario B : Aucun projet → Phase 0 → parades de démarrage
- Scénario C : Projet avec tâches → Phase 1 → parades basées métadonnées
- Scénario D : Utilisateur choisit une parade → `LearningTracker.recordChoice()`

---

## Annexe A : Exemples concrets de prompts LLM

Cette annexe montre le prompt COMPLET reçu par l'agent-parades
(contexte JSON + instructions de phase) et la parade générée attendue.

Chaque exemple suit le même format :
1. **Contexte** — Situation réelle dans le CLI
2. **Prompt** — Ce que l'agent reçoit (contexte JSON tronqué + instructions)
3. **Raisonnement** — Comment l'agent analyse (interne)
4. **Sortie** — Le contenu de suggestions.json

---

### Exemple A1 — Phase 1 : Projet avec tâches en cours

**Contexte :** L'utilisateur vient de taper « lister mes projets ».
Le projet `soulseek-downloader` est actif avec 5 tâches (2 en cours,
1 bloquée, 2 done). Aucune notification urgente. Dernière action il y a 3h.

**Prompt reçu (tronqué) :**

```
Tu es l'Agent Parades du système Minautor Agents.

## Mission
[... prompt système complet ...]

## Règles de phase
Phase d'évolution : 1 (MÉTADONNÉES UNIQUEMENT)
Tu NE dois PAS explorer les fichiers du projet.
Utilise UNIQUEMENT les données structurées fournies ci-dessous.
Baser les parades sur les tâches, notifications, logbook.

## Contexte JSON reçu
{
  "evolutionPhase": 1,
  "action": "route",
  "demande": "lister mes projets",
  "projectName": "soulseek-downloader",
  "metadata": {
    "projects": ["soulseek-downloader", "mon-autre-projet"],
    "currentProject": "soulseek-downloader",
    "tasks": [
      { "id": "T1", "title": "Ajouter filtre recherche",
        "area": "backend", "status": "in_progress" },
      { "id": "T2", "title": "Tests unitaires",
        "area": "backend", "status": "in_progress" },
      { "id": "T3", "title": "Corriger timeout connexion",
        "area": "network", "status": "blocked" },
      { "id": "T4", "title": "Refactor logging",
        "area": "core", "status": "done" },
      { "id": "T5", "title": "Doc API",
        "area": "docs", "status": "done" }
    ],
    "notifications": {
      "active": [{ "level": "info", "message": "Agent Télécom a terminé" }],
      "recentUrgent": 0
    },
    "logbook": [
      { "agent": "script-runner", "type": "success",
        "date": "2026-05-31 11:00",
        "instruction": "Listé le projet soulseek-downloader" }
    ],
    "agents": [ ... ],
    "skills": [ ... ],
    "profiles": { "agents": 226, "bots": 269, "daemons": 103 }
  }
}
```

**Raisonnement de l'agent (interne) :**

> 5 tâches : 2 en cours (backend), 1 bloquée (network). La tâche bloquée
> « Corriger timeout connexion » est critique. Les 2 tâches en cours sont
> dans backend. Aucune notification urgente. Je vais proposer :
> 1. Débloquer la tâche réseau (urgent)
> 2. Continuer sur le filtre recherche (en cours)
> 3. Découvrir l'autre projet (variété)
> 4. Vue d'ensemble des tâches (gestion)

**Sortie (suggestions.json) :**

```json
{
  "menu": "Actions rapides",
  "items": [
    {
      "label": "Débloquer la tâche réseau",
      "description": "La tâche 'Corriger timeout connexion' (network) est bloquée. C'est la seule tâche en statut bloqué.",
      "command": "!project tasks soulseek-downloader --area network"
    },
    {
      "label": "Continuer le filtre recherche",
      "description": "La tâche 'Ajouter filtre recherche' est en cours dans backend. La plus récente activité du projet.",
      "command": "!project task T1 status soulseek-downloader"
    },
    {
      "label": "Découvrir mon-autre-projet",
      "description": "Tu as un second projet qui n'a pas été exploré récemment.",
      "command": "!explore mon-autre-projet"
    },
    {
      "label": "Vue d'ensemble des tâches",
      "description": "5 tâches sur 4 domaines (backend, network, core, docs). 40% terminées.",
      "command": "!project tasks soulseek-downloader"
    }
  ]
}
```

---

### Exemple A2 — Phase 0 : Projet vide (première utilisation)

**Contexte :** Aucun projet existant, premier lancement, aucune donnée.

**Sortie (suggestions.json) :**

```json
{
  "menu": "Actions rapides",
  "items": [
    {
      "label": "Créer ton premier projet",
      "description": "Commence par créer un projet pour structurer ton travail.",
      "command": "!project create mon-projet \"Ma description\""
    },
    {
      "label": "Explorer les profils disponibles",
      "description": "598 profils sont pré-configurés (agents, bots, daemons).",
      "command": "!profiles list agents"
    },
    {
      "label": "Voir l'aide du système",
      "description": "Toutes les commandes disponibles et la documentation.",
      "command": "/help"
    }
  ]
}
```

---

### Exemple A3 — Phase 1 : Urgence (notifications critiques)

**Contexte :** 3 notifications urgentes, une tâche bloquée depuis 2 jours.

**Sortie (suggestions.json) :**

```json
{
  "menu": "Actions rapides",
  "items": [
    {
      "label": "⚠ Consulter les 3 alertes urgentes",
      "description": "3 notifications urgentes : 'Erreur connexion API (2x)' et 'Timeout dépassé'.",
      "command": "/notifications"
    },
    {
      "label": "Forcer le déblocage de la tâche réseau",
      "description": "La tâche 'Corriger timeout connexion' est bloquée depuis 2 jours.",
      "command": "!project unblock T3 soulseek-downloader"
    }
  ]
}
```

---

### Anti-exemples : Erreurs fréquentes à éviter

#### ❌ Anti-exemple 1 : Parade générique inutile

```json
{ "label": "Voir les tâches", "description": "Il y a des tâches.", "command": "!project tasks" }
```
**Problème :** Trop vague. Pas de nombre, pas de contexte, pas de raison de cliquer.

#### ❌ Anti-exemple 2 : Trop de parades

```json
{ "items": [ /* 12 items */ ] }
```
**Règle :** Maximum 5. Priorité : Urgent > Préféré > Nouveau.

#### ❌ Anti-exemple 3 : Commande inexistante

```json
{ "command": "!magic-fix-all" }
```
**Règle :** Commandes autorisées seulement : `!project`, `!tasks`, `!agents`,
`/help`, `/menu`, `/notifications`, `!explore`, `!doc`, `!git`, `!deploy`,
`!profiles`, ou commandes shell (cat, node, ls, grep).

#### ❌ Anti-exemple 4 : Description auto-référente

```json
{ "label": "Découvrir", "description": "Découvrir" }
```
**Règle :** Label et description doivent être différents. La description
doit donner une raison concrète de cliquer.

---

## 13. Points d'attention

1. **Performance LM Studio :** Le modèle qwen/qwen3.5-9b local peut prendre
   10-30 secondes pour la première inférence. Comme on attend avec le spinner
   (pas de timeout), l'utilisateur verra le spinner tourner. C'est voulu.

2. **LM Studio indisponible :** Si spawn-agent.js échoue (process exit non zero),
   `triggerParades()` doit échouer silencieusement → cacher le spinner →
   continuer sans parades. Pas de crash CLI.

3. **Anti-répétition :** Passer un seed aléatoire dans le contexte JSON
   (`randomSeed: Date.now()`) pour que l'agent LLM génère des parades
   différentes à chaque appel.

4. **Sécurité :** L'agent a accès à `run_terminal_command` → le Guardian
   doit rester actif. Les commandes destructrices sont bloquées par le
   Guardian et la règle « Ne rien proposer de destructeur ».

5. **Compatibilité :** L'agent écrit dans `telecom/suggestions.json`.
   Le CLI existe déjà et lit ce fichier via `showSuggestionMenu()`.
   Pas de changement côté affichage — seulement côté génération.

6. **Conflit avec l'ancien handle.js :** Pendant la transition, si handle.js
   est appelé APRÈS agent-parades, il écrase suggestions.json. Solution :
   supprimer l'appel à handle.js dans le premier commit, ou le garder
   désactivé avec un flag `_paradesEnabled`.
