<div align="center">

<img src="assets/images/MINAUTOR_logo.png" alt="MINAUTOR Logo" width="800">

# ⚡ Le Projet "MINAUTOR" ⚡
 -- Projet entierement écris en Francais par un développeur français --

**L'orchestration multi-agents nouvelle génération pour TypeScript & Node.js**

[![Version](https://img.shields.io/badge/version-1.6.0-blue.svg?style=for-the-badge)](https://github.com/French-Team/MINAUTOR-Agent-Service)
[![License](https://img.shields.io/badge/license-MIT-green.svg?style=for-the-badge)](LICENSE)
[![Status](https://img.shields.io/badge/status-active-success.svg?style=for-the-badge)](https://github.com/French-Team/MINAUTOR-Agent-Service)
[![Node](https://img.shields.io/badge/node-%3E%3D22-black.svg?style=for-the-badge)](https://nodejs.org/)

*Framework d'orchestration multi-agents conçu pour l'ère de l'IA de 2026. Inspiré par Codebuff. Propulsé par l'intelligence collective.*

</div>

---

## ✨ Vue d'Ensemble

⚡ MINAUTOR ⚡ est un framework complet qui permet de **créer, gérer et orchestrer des agents IA spécialisés** dans un environnement sécurisé et structuré. Il combine un moteur LLM multi-fournisseurs, un système de permissions granulaire (FeuRouge), un pipeline de compression de contexte (Telecom), et un protocole de gouvernance par délégation (PACO) — le tout accessible via une interface CLI riche.

Tous les agents sont définis en TypeScript, persistent dans `.agents/`, et peuvent être exécutés en session interactive ou en arrière-plan. Le système supporte la rotation multi-clés, le rate-limiting, la validation automatique, et l'injection de kits de sécurité.

---

## 💎 Caractéristiques Clés

- **🤖 Multi-Agent Orchestration** — Définis, crée et exécute des agents spécialisés (3 templates : standard, fast-bot, daemon). Chaque agent possède son propre prompt, ses outils, et ses contraintes de permissions.
- **🔌 Multi-Provider LLM** — Connecte-toi à 7 fournisseurs (Kilo Gateway, Google Gemini, OpenRouter, OpenCode Zen, Ollama, LM Studio, Custom). Rotation automatique des clés API en cas de rate-limiting (429).
- **🛡️ FeuRouge Permissions** — 4 niveaux de sécurité (admin, restricted, confined, readonly) avec validation des commandes, des chemins, et isolement sandbox. Grants temporaires pour les agents confinés.
- **📡 Telecom Context Pipeline** — Compression déterministe du contexte en 3 étapes : Optimiser, Nettoyer, Resumer. Complété par un **Notification Viewer TUI** full-screen avec historique scrollable.
- **🪟 Windows Terminal Integration** — Détection automatique de `wt.exe`, ouverture combinée des fenêtres TUI en **onglets** dans une seule fenêtre WT. Installation automatique via `winget` si nécessaire (sans admin). Arrêt gracieux des onglets via flags de shutdown.
- **💉 Kits Injection** — Déclare `// @kit <nom>` dans tes fichiers, le moteur injecte automatiquement les imports. Guardian vérifie la conformité après chaque commande shell.
- **🤖 Protocole PACO** — Gouvernance par délégation avec Orchestrateur, Superviseur (read-only), et Daemon d'audit (surveillance continue toutes les 5 min).
- **🎯 598 Profils Préconfigurés** — 226 agents conversationnels, 269 bots d'automatisation, 103 daemons d'arrière-plan — prêts à l'emploi dans `data/profiles/`.
- **📋 Project Management** — Isole chaque agent dans un workspace dédié avec tableau de tâches, sandbox par défaut, et isolation stricte des fichiers (`.workspace` + `.tasks.json`).
- **🔔 Notifications Inter-Processus** — Les agents d'arrière-plan notifient le CLI en temps réel via IPC et fichier partagé. Filtrage par niveau (12 niveaux : info, urgent, conclusion…). Archive 30 jours.
- **✅ Validation Automatique** — `validate-agent` vérifie la structure, les permissions, les règles d'or (R1-R7). `validate-all` scanne tous les agents. `lint-regex` vérifie les regex via AST TypeScript.

---

## 🤖 Système d'Agents

### Création & Gestion

⚡ MINAUTOR ⚡ permet de créer des agents via un assistant interactif (`/create`) ou directement en écrivant un fichier `.ts` dans `.agents/`. Trois templates disponibles :

| Template | Usage | Particularités |
|----------|-------|----------------|
| **Standard** | Agents conversationnels | Tool loop basique, guardian activé |
| **Fast-Bot** | Bots de réponse rapide | Streaming, self-correction, rate limiting |
| **Daemon** | Agents d'arrière-plan | Health check, auto-restart, pushNotification |

Chaque agent possède :
- Un **ID** unique (kebab-case) et un **nom d'affichage**
- Un **modèle LLM** et un **provider** associé
- Un **instructionsPrompt** (system prompt complet)
- Une **liste d'outils** disponibles (`run_terminal_command`, `add_message`, `set_output`, `skill`)
- Une **configuration optionnelle** (self-correction, guardian, health check, streaming, rate limit, tool config)

### Sessions & Exécution

Les agents s'exécutent en **session interactive** (via le CLI, avec historique complet) ou en **arrière-plan** (via `spawn-agent.js`, avec logbook et notifications). Le tool loop permet aux agents d'utiliser les outils jusqu'à 10 tours de conversation, avec fallback pour les petits modèles locaux (analyse de texte narratif).

### Skills

Chaque agent reçoit automatiquement une **skill** (fichier `SKILL.md`) générée par LLM lors de sa création. Les skills sont organisées dans `skills/skill-<id>/` et incluent les sections : Mission, Comportement, Compétences, Règles. Les skills peuvent être listées et consultées via `/skills`.

---

## 🔌 Fournisseurs LLM

⚡ MINAUTOR ⚡ supporte **7 providers** avec une architecture de **rotation multi-clés** :

| Provider | Clé API | Local | Modèle par défaut |
|----------|---------|-------|-------------------|
| Kilo Gateway | Non | Non | kilo-auto/free |
| Google Gemini | Oui | Non | gemini-2.5-flash |
| OpenRouter | Oui | Non | openrouter/free |
| OpenCode Zen | Oui | Non | opencode-zen/default |
| Ollama | Non | Oui | llama3.2 |
| LM Studio | Non | Oui | local-model |
| Custom | Optionnel | Non | custom |

**Rotation multi-clés :** Chaque provider peut avoir plusieurs clés API. Le moteur tourne en round-robin, détecte les 429 (rate-limiting), bascule automatiquement sur la clé suivante, et applique un cooldown avant de réessayer. Maximum 3 rotations par appel avant abandon.

**Rate limiting :** Configurable en requêtes par minute, burst, et backoff exponentiel. Tracking de cooldown par clé API.

---

## ⚙️ Moteur d'Orchestration

### Tool Loop

Le cœur du moteur exécute un cycle appel LLM → parsing des appels d'outils (`!` ou blocs JSON) → exécution → retour des résultats → répétition (jusqu'à 10 boucles). Supporte l'exécution parallèle d'outils et le timeout configurable par outil.

### Guardian

Filtre intelligent des commandes shell bloquant les patterns dangereux :
- Suppressions récursives (`rm -rf`, `del /s`, `rmdir /s`)
- Altérations de base de données (`drop table`, `drop database`)
- Pipe vers shell (`curl | bash`, `wget | sh`)
- Accès aux fichiers système (`/etc/passwd`, `C:\Windows\System32`)
- Patterns personnalisables via `blockedPatterns`

### Self-Correction

En cas d'échec d'appel LLM, le moteur retente automatiquement (configurable : nombre de tentatives, backoff exponentiel). Valide la sortie selon des critères personnalisables.

### Streaming

Les réponses LLM peuvent être streamées en temps réel avec taille de chunk configurable et affichage optionnel du raisonnement.

---

## 🔒 Red Fire — Permissions & Sécurité

Système de permissions granulaire qui contrôle chaque commande exécutée par un agent. Configuration via `data/permissions/permissions.yaml`.

### 4 Niveaux

| Niveau | Accès | Usage |
|--------|-------|-------|
| **admin** | Accès complet (programme + workspaces) | Alice, Orchestrateur |
| **restricted** | Accès à workspaces/ racine | Agents techniques |
| **confined** | Accès à un seul projet dans workspaces/ | Agents utilisateur (défaut) |
| **readonly** | Lecture seule (cat, ls, dir uniquement) | Superviseur |

### Mécanismes de sécurité

- **Validation par commande :** Chaque commande est vérifiée (allowed_commands, forbidden_commands)
- **Validation par chemin :** Les chemins cibles sont vérifiés (allowed_paths, forbidden_paths)
- **Confinement workspace :** Les agents confined sont isolés dans `workspaces/<projet>/` — toute sortie est bloquée
- **Sandbox par défaut :** Les agents sans projet sont isolés dans `workspaces/.sandbox/`
- **Grants temporaires :** Un admin peut accorder un accès temporaire (chemin ou commande, durée configurable)
- **Détection de fuite contextuelle :** Les flags `git -C`, `--prefix` qui déplacent le CWD sont détectés et bloqués si hors workspace

### Daemon ⚡ Red Fire ⚡

Le démon de sécurité tourne en arrière-plan, enregistre les agents (PID → workspace), et vérifie chaque commande avant exécution.

---

## 📡 Telecom — Pipeline de Contexte

Système de compression de contexte en 3 étapes, conçu pour réduire la consommation de tokens sans perdre l'information essentielle :

1. **Optimiser** : Transforme le langage naturel verbeux en directives compactes. Exemple : *"Je pense qu'il faudrait peut-être envisager de..."* → *"Action requise :"*.
2. **Nettoyer** : Élimine les caractères de contrôle, espaces redondants, lignes vides multiples, et pollution textuelle.
3. **Resumer** : Synthétise l'historique ancien en préservant intacts les échanges récents. Utilise des modèles de profils (tiny, small, medium, large, huge) avec des seuils de tokens ajustés par modèle.

Complété par le **Conservateur** (gestion des patterns récurrents à préserver) et le **Composeur** (recomposition des prompts optimisés pour le LLM).

### 🖥️ Notification Viewer TUI

Le daemon ouvre **deux fenêtres dédiées** dans des onglets de terminal pour un suivi visuel en temps réel du système Telecom :

**1. Telecom Watcher Console** (`telecom-watcher-console.ts`)
- Affiche les logs en direct : routage des messages, spawns d'agents, blocages anti-boucle
- Barre d'état dynamique avec PID, uptime, compteurs
- Mise à jour toutes les 1 seconde

**2. Notification Viewer** (`telecom-notification-viewer.ts`)
- Interface **full-screen** avec terminal-kit (bibliothèque de rendu TUI)
- Liste scrollable des notifications : ↑↓ (ligne), PgUp/PgDn (page), Home (début), End (fin)
- Codage couleur par niveau : 🔴 urgent, 🟡 avertissement, 🔔 info, 📊 conclusion
- Auto-scroll : suit automatiquement les nouvelles notifications (désactivé si l'utilisateur scroll)
- Barre d'état en bas avec total, compteurs par criticité, indicateur de scroll, PID
- S'auto-ferme si le daemon parent meurt (vérification toutes les 5s)
- Jusqu'à 500 notifications en mémoire (triées par date, plus récentes en premier)
- Alternance de fond (zèbre) sur les lignes pour une meilleure lisibilité

### 🪟 Windows Terminal — Onglets Combinés

Sur Windows, le daemon détecte automatiquement `wt.exe` (Windows Terminal) via `where wt` et ouvre **les deux TUI dans UNE SEULE fenêtre** avec deux onglets :

```
wt -w -1 new-tab --title "Watcher" cmd /c "...watcher.js" ; new-tab --title "Notifications" cmd /c "...viewer.js"
```

- `-w -1` = nouvelle fenêtre (indépendante du terminal de l'utilisateur)
- `;` = séparateur de commandes Windows Terminal (obligatoire entre deux `new-tab`)
- **Fallback** : si `wt.exe` indisponible → lancement séparé via `start cmd /c` (conhost classique)
- **Détection fiable** : utilise `where wt` (pas `WT_SESSION`, qui n'existe pas dans VS Code)
- **Cache** : résultat mis en cache pour toute la session du daemon (`_wtAvailable`)

#### Installation automatique de Windows Terminal

Si `wt.exe` n'est pas trouvé sur un système Windows, le daemon lance **automatiquement l'installation en arrière-plan** :

```powershell
winget install --id Microsoft.WindowsTerminal --scope user --silent --accept-package-agreements --accept-source-agreements
```

- ✅ **Aucun droit admin requis** (grâce à `--scope user`)
- ✅ Winget pré-installé sur Windows 10 1809+ et Windows 11
- ✅ **100% asynchrone** : le daemon continue avec le fallback `start cmd /c` pendant l'installation
- ✅ Vérification préalable via `Get-AppxPackage -Name Microsoft.WindowsTerminal` (pas de double installation)
- ✅ Notification push à chaque étape (📦 Installation..., ✅ Installé!, ❌ Échec...)
- ✅ **1 seule tentative** par session du daemon (flag `_wtInstallAttempted`)

#### Arrêt gracieux des onglets Windows Terminal

Quand le daemon s'arrête (Ctrl+C, fermeture du projet), les onglets Windows Terminal se ferment proprement :

1. Le daemon écrit un **flag de shutdown** (fichier `watcher.shutdown` / `notification-viewer.shutdown`) dans `telecom/`
2. Watcher et viewer détectent le flag à leur prochain cycle de polling (< 2s) et appellent `process.exit(0)`
3. Windows Terminal voit un exit code **0** → **ferme l'onglet** (comportement par défaut `closeOnExit: "graceful"`)
4. **Force-kill de secours** : si les processus ne répondent pas après 4s, le daemon les tue avec `TerminateProcess`
5. **Garde-fou** : un flag `cleanupInProgress` empêche les doubles appels SIGTERM
6. **Nettoyage au démarrage** : `cleanupOldState()` efface tous les flags `.shutdown` résiduels

> **Sans ce mécanisme :** `process.kill(pid, 'SIGTERM')` sur Windows = `TerminateProcess` → tue node avec un code non-zéro → Windows Terminal ne ferme pas l'onglet.

---

## 💉 Kits — Injection Automatique & Sécurité

Les **Kits** sont des garde-fous que les agents déclarent via `// @kit <nom>` en haut de leurs fichiers :

```ts
// @kit tests          ← déclaration de sécurité
import { stopTestOnError } from '...'  ← injecté automatiquement

it('doit réussir', stopTestOnError(() => {
  if (result !== 4) throw new Error('Échec')
}))
```

### Fonctionnement

1. L'agent écrit un fichier avec le marqueur `// @kit <nom>`
2. Le **kits-injector** détecte le marqueur et injecte automatiquement l'import
3. Le **Guardian** scanne la commande shell après exécution pour vérifier la conformité
4. Les kits manquants ou les imports absents sont signalés comme alertes

### Kits disponibles

| Kit | Description |
|-----|-------------|
| `tests` | Fail-fast — arrête tout à la première erreur de test |
| `errors` | Gestion centralisée des erreurs avec contexte et stack |
| `timeout` | Timeout et garde-fous temporels pour opérations longues |
| `validation` | Validation d'entrées avec typage strict |
| `logging` | Logging structuré (DEBUG, INFO, WARN, ERROR) |

Le registre (`kits/registry.json`) référence tous les kits disponibles, leurs triggers (ex: `*.test.ts`) et leurs exports. Les kits peuvent être suggérés automatiquement selon le type de fichier.

---

## 📋 CLI & Interface Utilisateur

### Menu Principal

L'interface CLI interactive propose un menu complet (chiffres 1-9, commandes `/`) :

| # | Fonction | Description |
|---|----------|-------------|
| 1 | Providers & clés API | Gérer les fournisseurs LLM et leurs clés |
| 2 | Mon profil | Éditer son profil utilisateur (prénom, pseudo, âge, description) |
| 3 | Créer un agent | Assistant guidé avec certification PACO |
| 4 | Voir les agents | Lister tous les agents disponibles |
| 5 | Éditer un agent | Modifier nom, instructions, modèle, provider |
| 6 | Skills & prompts | Consulter les skills et prompts système |
| 7 | Démarrer une session | Lancer une session interactive avec un agent |
| 8 | Gérer les sessions | Lister, naviguer, créer des sessions |
| 9 | Status & notifications | État du système, intercom, daemon, logbook |
| 10 | Commandes & aide | Aide complète |

### Commandes rapides

- `!commande` — Exécuter une commande shell directement
- `@message` — Ajouter un message assistant
- `!spawn <id> <instruction>` — Lancer un agent en arrière-plan
- `/help`, `/menu`, `/create`, `/providers`, `/agents`, `/sessions` — Navigation rapide
- `/status` — État du système (daemon feurouge, telecom, intercom, logbook)
- `/notifications filter <niveau>` — Filtrer les notifications par niveau
- `/skills <nom>` — Afficher le contenu complet d'une skill
- `/ps` — Lister les agents en arrière-plan
- `/kill <nom>` — Arrêter un agent en arrière-plan

### Routeur Intercom

Le CLI analyse automatiquement les messages utilisateur par mots-clés. Si un pattern correspond à une action prédéfinie, le message est routé vers `agent-telecom` sans passer par le LLM — réponse instantanée. Les messages en texte libre sont envoyés au LLM pour traitement.

---

## 🏗️ Gestion de Projets

### Workspaces

Chaque projet est isolé dans `workspaces/<nom>/` avec :
- **Marqueur `.workspace`** : Fichier YAML contenant le nom, la date de création, le créateur, le statut (active/archived)
- **Tableau de tâches `.tasks.json`** : Tâches avec dépendances, domaines, statuts (todo, in_progress, done, blocked, cancelled)
- **Sandbox** : Les agents sans projet sont isolés dans `workspaces/.sandbox/`

### Règles de séquencement

- Tâches dans le **même domaine** → séquentielles (1 à la fois)
- Tâches dans des domaines **différents** → parallélisables
- Délégation séquentielle au fil de l'avancement

### Commandes projet

- `!project create <nom>` — Créer un projet
- `!project list` — Lister les projets
- `!project init <nom>` — Marquer un dossier existant comme projet
- `!project show <nom>` — Afficher les infos d'un projet
- `!project tasks <nom>` — Afficher les tâches
- `!project archive <nom>` — Archiver un projet

---

## 🔄 Notifications Inter-Processus

Les agents d'arrière-plan (daemons, timers, spawns) communiquent avec le CLI via un système de notifications asynchrone :

- **Fichier partagé :** `telecom/notifications.json` (persistant)
- **IPC temps réel :** Les notifications arrivent instantanément dans le CLI via `process.send()`
- **Archive :** Chaque notification est archivée dans `telecom/notifications/YYYY-MM-DD.json` (30 jours de rétention)
- **12 niveaux :** info, questions, tache, missions, mise-en-place, plan, storyboard, todo-list, avertissement, warning, conclusion, urgent
- **Filtrage :** `/notifications filter <niveau>` pour ne voir que certains niveaux
- **Historique :** `/notifications history <jours>` pour consulter l'archive
- **Nettoyage automatique :** Les notifications lues sont supprimées et les archives de plus de 30 jours sont purgées

---

## 🧪 Validation & Qualité

### Validation des agents

```bash
node dist/validate-agent.js <agent-id>
node dist/validate-all.js
```

Chaque agent est validé selon les **Règles d'Or** :
- **R1 :** Pas de payloads en guillemets simples — utilise echo + pipe + --stdin
- **R2 :** ID agent en ASCII pur
- **R3 :** Pas d'emojis dans les instructions
- **R4 :** Format kebab-case
- **R5 :** Pas de contournement de l'intercom (sauf Alice)
- **R7 :** Fichier AGENT_RULES.md présent (injection automatique dans le prompt)

Vérifie aussi : structure de la skill (4 sections obligatoires), présence de l'équipe PACO, configuration provider, permissions.yaml.

### Validation CI YAML

```bash
npm run validate:ci-yaml
```

Valide automatiquement **tous les workflows** `.github/workflows/*.yml` : structure des jobs, steps, uses, with, run, noms. Intégré en pré-build et dans la CI.

### Linting Regex (AST)

```bash
npm run lint:regex
```

Analyse statique des regex literals et `new RegExp()` via l'AST TypeScript (`ts.createSourceFile`). Détecte : flags invalides, doublons, patterns impossibles à compiler. Intégré en pré-build (`npm run build` l'exécute automatiquement).

### Tests

- `npm test` — Tests unitaires du moteur et des services
- `npm run test:load` — Tests de charge (rate limiting, montée en charge)
- `npm run e2e-flow` — Test de bout en bout du workflow complet
- `npm run validate:all` — Validation complète de tous les agents

---

## 👤 Profil Utilisateur

Chaque utilisateur dispose d'un profil persistant (`data/user/profile.json`) :
- **Prénom** : Nom d'affichage
- **Pseudo** : Surnom optionnel
- **Âge** : Pour la personnalisation
- **Description** : Présentation libre

Le profil est éditable via `2. Mon profil` ou `/profile`. Le nom d'affichage est présenté dans le prompt CLI. Un message de bienvenue personnalisé est affiché au démarrage selon le profil.

---

## 📦 Bibliothèque de Profils

598 profils d'agents préconfigurés dans `data/profiles/` :

- **226 Agents** — Profils conversationnels (Python, React, Next.js, Rust, CSS, planification, revue de code…)
- **269 Bots** — Profils d'automatisation (Git, Docker, tests, scripts, réseau, optimisation…)
- **103 Daemons** — Profils d'arrière-plan (logs, maintenance, surveillance, coordination, sécurité…)

Chaque profil peut être injecté lors de la création d'un agent, apportant instructions préconfigurées, contraintes, et configuration (self-correction, guardian, health check, streaming, rate limit, tool config).

---

## 🔧 Architecture

```
minautor-agents-service/
├── .agents/                  # Définitions des agents (.ts)
├── .github/workflows/        # CI/CD — build, test, validation
├── kits/                     # Registre des kits de sécurité
│   └── kit-tests/            # Kit test (fail-fast, timeout)
├── src/
│   ├── engine*.ts            # Moteur (LLM, sessions, tool loop, guardian, health)
│   ├── cli*.ts               # Interface utilisateur (menu, sessions, providers)
│   ├── agents.ts             # CRUD agents (création, édition, templates)
│   ├── providers.ts          # Gestion des fournisseurs LLM
│   ├── notify.ts             # Notifications inter-processus
│   ├── spawn-agent.ts        # Exécution d'agents en arrière-plan
│   ├── skills.ts             # Chargement des skills
│   ├── generate-skill.ts     # Génération de SKILL.md par LLM
│   ├── validate-*.ts         # Validation (agents, règles, CI YAML, regex)
│   ├── kits-injector.ts      # Injection automatique des imports de kits
│   ├── feurouge/             # Permissions & sécurité (FeuRouge)
│   ├── telecom/
│   │   ├── service/
│   │   │   ├── telecom-daemon.ts             # Daemon fond : routage intercom + TUI + WT
│   │   │   ├── telecom-watcher-console.ts     # Fenêtre de logs en direct
│   │   │   └── telecom-notification-viewer.ts # Fenêtre TUI notifications scrollables
│   │   ├── context/          # Pipeline de contexte (Optimiser, Nettoyer, Resumer)
│   │   └── ...
│   └── project/              # Gestion de projets (workspace, sandbox, tâches)
├── data/
│   ├── profiles/             # 598 profils préconfigurés
│   ├── golden-rules/         # Règles de validation JSON
│   ├── protocols/            # PACO protocol & keyword registry
│   └── permissions/          # Fichier maître des permissions YAML
├── workspaces/               # Projets utilisateur isolés
│   ├── .sandbox/             # Sandbox pour agents sans projet
│   └── <projet>/             # Projets avec .workspace + .tasks.json
└── telecom/                  # Données d'exécution (logbook, notifications, intercom)
```

---

## 🤖 Protocole PACO

MINAUTOR implémente un protocole de gouvernance strict par délégation pour garantir que chaque agent reste dans son rôle :

1. **Orchestrateur** — Chef d'orchestre, délègue aux experts via le keyword registry. Ne produit jamais de code, docs ou analyse directement. Consulte le registre de mots-clés avant chaque action. En l'absence de correspondance, signale « Tâche non couverte — intervention humaine requise ».
2. **Superviseur** — Gardien de la conformité en lecture seule. Surveille les actions de l'orchestrateur, alerte en cas de violation, et peut suspendre l'orchestrateur après 3 infractions.
3. **Audit Daemon** — Surveillance continue toutes les 5 minutes. Vérifie le fichier `tâches_en_cours.json` et les logs de coordination. Peut suspendre l'orchestrateur en cas de non-respect du protocole.

---

## 📦 Sécurité par Kits

Les **Kits** sont des garde-fous de sécurité que les agents déclarent via `// @kit <nom>` en haut de leurs fichiers. Le moteur **kits-injector** détecte ces marqueurs et injecte automatiquement les imports correspondants — garantissant que l'agent utilise bien les bonnes pratiques. Le **Guardian** scanne les commandes shell après exécution pour vérifier la conformité.

| Kit | Description |
|-----|-------------|
| `tests` | Fail-fast — arrête tout à la première erreur de test |
| `errors` | Gestion centralisée des erreurs avec contexte et stack |
| `timeout` | Timeout et garde-fous temporels pour opérations longues |
| `validation` | Validation d'entrées avec typage strict |
| `logging` | Logging structuré (DEBUG, INFO, WARN, ERROR) |

```ts
// @kit tests          ← l'agent déclare le kit
import { stopTestOnError } from '...'  ← injecté automatiquement

it('doit réussir', stopTestOnError(() => {
  if (result !== 4) throw new Error('Échec')
}))
```

---

## 🛡️ Qualité & Performance

MINAUTOR intègre des outils de validation et d'optimisation pour garantir la qualité et la performance du système :

- **Regex AST Linter** — Analyse statique des regex literals et `new RegExp()` via l'AST TypeScript (`ts.createSourceFile`). Intégré en pré-build et dans la CI. Détecte les flags invalides, les doublons, et les patterns impossibles à compiler.

- **Guardian** — Filtre intelligent des commandes shell bloquant les opérations dangereuses (suppressions récursives, altérations de base de données, pipe vers shell, accès aux fichiers système). Patterns personnalisables.

- **Self-Correction** — En cas d'échec d'appel LLM, le moteur retente automatiquement avec backoff exponentiel. Configurable : nombre de tentatives (défaut 2-3), validation de sortie, mode apprenant.

- **Rate Limiting** — Protection contre les dépassements de quotas API : requêtes par minute configurable, burst autorisé, backoff exponentiel. Tracker de cooldown par clé. Maximum 3 rotations par appel avant abandon.

- **Load Testing** — Scripts dédiés (`npm run test:load`) pour tester le comportement du moteur sous charge : montée en charge, rotation de clés, résilience aux timeouts.

- **Multi-Provider Failover** — Bascule automatique entre providers en cas d'échec : rotation multi-clés round-robin, détection des 429 (rate-limiting), cooldown automatique, fallback vers le provider suivant.

---

<div align="center">
  <br />
  <sub>Propulsé par <b>MINAUTOR</b> — L'excellence agentique par la structure.</sub>
</div>
