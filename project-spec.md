# Minautor Agent Service — Spécification du Projet

> **Date :** 2026-05-21
> **Statut :** Spécification v2 — reflète l'état réel du code au 21 mai 2026

---

## 1. Vision & Positionnement

### 1.1 Mission

**Minautor Agent Service** est un framework open-source multi-agent pour TypeScript/Node.js, inspiré de Codebuff. Il permet de définir, gérer et orchestrer des agents IA avec intégration LLM, gestion de sessions, exécution d'outils, et gouvernance via le protocole PACO.

### 1.2 Public cible

- Développeurs construisant des systèmes multi-agents automatisés
- Équipes techniques voulant orchestrer des agents spécialisés
- Toute personne souhaitant créer et déployer des assistants IA sur-mesure

### 1.3 Licence

Le projet n'a pas de licence explicite dans `package.json`. À définir.

---

## 2. Stack Technique

| Composant | Technologie |
|-----------|-------------|
| Langage | TypeScript 5.5+ (`^5.5.0`) |
| Runtime | Node.js (module ESM — `"type": "module"`) |
| Bundle | Aucun — compilation directe `tsc` vers `dist/` |
| Tests unitaires | `node dist/unit-tests.js` — 55 tests (runner, engine-runner, menus, sessions, etc.) |
| Tests E2E | `node dist/test.js` — 37 tests (workflow complet) |
| CI | `npm run test:ci` — build + unit-tests + E2E en séquence |
| Providers LLM | Kilo, Google Gemini, OpenRouter, Opencode Zen, Ollama (local & cloud), LM Studio, Custom |

### Évolution envisagée

Stack technique **indécise** — on explore les options au fur et à mesure. Pas de décision ferme sur l'ajout de frameworks ou de changements de langage.

---

## 3. Architecture du Projet

### 3.1 Structure actuelle

```
src/
├── cli.ts                    # 6 lignes — point d'entrée → cli-main.ts
├── cli-main.ts               # 333 lignes — boucle REPL, traitement des commandes
├── cli-menu.ts               # 59 lignes — menu principal & aide
├── cli-create.ts             # 682 lignes — workflow création d'agent
├── cli-edit.ts               # 275 lignes — édition d'agent
├── cli-providers.ts          # 302 lignes — menu interactif de gestion providers
├── cli-providers-advanced.ts # 328 lignes — commandes /providers avancées
├── cli-sessions.ts           # 107 lignes — affichage sessions & info
├── cli-agents.ts             # 50 lignes  — listage & changement d'agent
├── cli-runner.ts             # 83 lignes  — exécution !command et @message
├── cli-selector.ts           # 37 lignes  — sélecteur de commandes (/ + flèches)
├── cli-utils.ts              # 40 lignes  — DEFAULT_AGENT, helpers
├── constants.ts              # 48 lignes  — couleurs ANSI, URL providers, top15()
│
├── engine.ts                 # 67 lignes — façade assembleur de 9 sous-modules
├── engine-types.ts           # 20 lignes — types EngineConfig, LLMProvider
├── engine-runner.ts          # 111 lignes — runPrompt, callLLM
├── engine-sessions.ts        # 56 lignes — CRUD sessions
├── engine-rate-limit.ts      # 33 lignes — rate limiter
├── engine-health.ts          # 53 lignes — health checker
├── engine-guardian.ts        # 78 lignes — guardian, command runner
├── engine-executor.ts        # 69 lignes — tool executor
├── engine-llm.ts             # 118 lignes — appels LLM, streaming
├── engine-parser.ts          # 35 lignes — parsing tool calls
│
├── agents.ts                 # CRUD agents + 3 templates (standard, fast, daemon)
├── providers.ts              # Gestion providers LLM (multi-clés, failover)
├── skills.ts                 # Chargement et parsing des skills
├── generate-skill.ts         # Génération auto SKILL.md via LLM
├── spawn-agent.ts            # Lancement d'agents en sous-processus
├── validate-agent.ts         # Validation agents (structure, PACO, providers)
├── notify.ts                 # Notifications inter-processus
├── tmux.ts                   # Wrapper Tmux (Unix only)
├── test.ts                   # Tests E2E (37 tests)
├── unit-tests.ts             # Tests unitaires (55 tests)
└── types/
    ├── agent-definition.ts   # Types AgentDefinition, ToolCall, etc.
    └── tools.ts
```

```
.agents/                     # Définitions des agents (.ts)
  └── alice.ts               # Agent par défaut (créé automatiquement au démarrage)
    (les agents historiques ont été supprimés — cf. Section 3.3)

skills/
  ├── skill-welcome/         # Skill d'accueil chargée au démarrage CLI
  ├── skill-agent-reviewer/  # Revue qualitative des agents/skills
  ├── skill-engineering/
  │   ├── debug-mantra/      # Discipline de débogage en 4 mantras
  │   ├── post-mortem/       # Analyse post-mortem / RCA
  │   └── scrutinize/        # Revue extérieure end-to-end
  ├── skill-productivity/
  │   └── management-talk/   # Traduction technique → management
  └── skill-misc/            # Divers

data/
  ├── profiles/              # 601 profils pré-configurés
  │   ├── agents/            # 227 profils conversationnels
  │   ├── bots/              # 270 profils d'automatisation
  │   └── daemons/           # 104 profils de fond
  ├── golden-rules/          # Règles de validation (agent, skill, orchestration, script)
  ├── templates/             # Templates de scaffolding (standard, fast-bot, daemon, orchestration)
  ├── protocols/             # PACO (keyword-registry.yaml, paco-protocol.md)
  ├── agent-name/            # Noms de dieux grecs pour agents
  └── questions-importantes/ # Questions d'architecture

devtool/                     # Outils systèmes (Sysinternals suite)

.in_out/                     # Flux d'instructions utilisateur
```

### 3.2 Problèmes — État actuel

| Problème (v1 spec) | Statut |
|---|---|
| **CLI monolithique** (>100k chars) | ✅ **Résolu** — `cli.ts` = 6 lignes, 11 modules extraits (2 350 lignes total) |
| **Tests incomplets** (E2E only) | ✅ **Résolu** — 55 tests unitaires + 37 E2E, script `test:ci` |
| **Providers en refonte** | 🔄 En cours — séparation Ollama local/cloud faite, menu interactif codé mais non commité |
| **Code mort possible** | ⚠️ `tmux.ts` existe encore. `exemple-agent-codebuff/` supprimé du disque. |
| **Erreurs compilation** | ✅ **Résolu** — build = 0 erreur |

### 3.3 Problèmes actuels identifiés

1. **`.agents/` vidé** — les agents PACO (orchestrateur, superviseur, reviewer) ont été supprimés (cf. §5.6). Les 5 nouveaux agents d'auto-amélioration ne persistent pas sur disque
2. **Pas de licence** — `package.json` n'a pas de champ `license`
3. **Pas de script `"test"`** — `npm test` ne fonctionne pas (utiliser `npm run test:ci` ou `test:unit`)
4. **Profils inexploités** — 601 profils JSON dans `data/profiles/` mais pas d'interface pour les parcourir

---

## 4. Priorités de Développement — État d'avancement

### ✅ Phase 1 — Stabilisation & Fondations (terminée)

| # | Tâche | Statut |
|---|-------|--------|
| 1 | Compiler sans erreur | ✅ 0 erreur TypeScript |
| 2 | Tests qui passent | ✅ 55/55 unit + 37/37 E2E |
| 3 | Workflow CLI complet | ✅ Fonctionnel (création agent, session, conversation) |
| 4 | Provider config stable | ⚠️ Partiel — séparation Ollama local/cloud faite, menu interactif codé mais pas encore commité ni testé en bout en bout |
| 5 | Modulariser cli.ts | ✅ **Dépassé** — 11 modules extraits (vs 4 prévus) |

### 🟡 Phase 2 — Fonctionnalités Cœur

| # | Tâche | Statut |
|---|-------|--------|
| 6 | Système découverte profils | ❌ Pas commencé — 601 profils non exploités |
| 7 | Renforcement PACO | ❌ Agents PACO supprimés (orchestrateur, superviseur, reviewer) |
| 8 | UX interactive riche | ⚠️ Partiel — menu providers, sélecteur /commandes, ESC cancel |
| 9 | Optimisation workflow création | ❌ Pas commencé — `cli-create.ts` fait 682 lignes |

### 🔵 Phase 3 — Maturité

| # | Tâche | Statut |
|---|-------|--------|
| 10 | Tests unitaires | ✅ **Fait** — 55 tests (engine-runner, menus, sessions, exports) |
| 11 | Documentation | ❌ Pas commencé |
| 12 | CLI → API serveur | ❌ Pas commencé |

---

## 5. Composants Détaillés

### 5.1 Moteur (engine)

**Rôle :** Gère les sessions LLM, l'exécution d'outils, le streaming, le rate limiting, le guardian et l'auto-correction.

**Architecture :** Le moteur a été refactoré en **9 sous-modules** assemblés par une façade `engine.ts` (67 lignes) :

```
engine.ts (façade)
├── engine-types.ts       →  Config & types
├── engine-runner.ts      →  runPrompt(), callLLM()
├── engine-sessions.ts    →  CRUD sessions
├── engine-rate-limit.ts  →  Rate limiter
├── engine-health.ts      →  Health checker
├── engine-guardian.ts    →  Guardian + command runner
├── engine-executor.ts    →  Tool executor
├── engine-llm.ts         →  Appels LLM + streaming
└── engine-parser.ts      →  Parsing des tool calls
```

**État actuel :**
- ✅ Tool loop fonctionnel par parsing de lignes (`!`, `@`)
- ✅ Streaming implémenté avec affichage temps réel
- ✅ Guardian bloque les commandes dangereuses (patterns configurables)
- ❌ Pas de persistance des sessions sur disque
- ❌ Parsing des tool calls par regex (fragile — amélioration possible)

### 5.2 CLI

**Rôle :** Interface utilisateur principale, interactive et riche.

**Architecture :** Refactoré en **11 modules** + 1 fichier de constantes :

```
cli.ts (6 lignes — point d'entrée)
├── cli-main.ts           →  Boucle REPL, routage commandes
├── cli-menu.ts           →  Menu principal (1-9), aide
├── cli-create.ts         →  Workflow création d'agent
├── cli-edit.ts           →  Édition d'agent
├── cli-providers.ts      →  Menu interactif gestion providers
├── cli-providers-advanced.ts → Commandes /provances
├── cli-sessions.ts       →  Affichage sessions & info
├── cli-agents.ts         →  Listage & changement d'agent
├── cli-runner.ts         →  Exécution !command et @message
├── cli-selector.ts       →  Sélecteur de commandes (/ + flèches)
├── cli-utils.ts          →  Helpers, DEFAULT_AGENT
└── constants.ts          →  Couleurs ANSI, URLs, top15()
```

**Fonctionnalités actuelles :**
- Menu principal 1-9 avec couleurs
- Commandes slash (/create, /start, /agents, /providers, /sessions, /skills, etc.)
- Auto-complétion des commandes (Tab)
- Sélecteur de commandes (/ + flèches directionnelles)
- Annulation par ESC
- Notifications inter-processus
- Support des modes : `!command`, `@message`, texte libre
- Raccourci naturel "timer-man X min" → conversion en `!spawn`

**Ce qui manque :**
- Recherche plein texte dans les commandes
- Statistiques d'utilisation

### 5.3 Providers (providers.ts)

**Rôle :** Gère la configuration des fournisseurs LLM, la rotation multi-clés, le failover.

**État actuel :**
- ✅ Séparation Ollama → `ollama-local` / `ollama-cloud`
- ✅ Menu interactif de gestion providers (dans `cli-providers.ts`)
- ✅ Validation des clés API en temps réel
- ✅ Fetch automatique des modèles disponibles (top 15)
- ✅ Test de connexion avant validation
- ✅ Alternateur multi-clés avec cooldown et failover
- ✅ Suggestions d'installation locale (ex: lfm2.5-thinking sur Ollama)
- ✅ Fallback saisie manuelle si la récupération échoue

**Providers supportés :**
| Provider | Clé API | Local | URL |
|----------|---------|-------|-----|
| Kilo Gateway | Non | Non | `https://api.kilo.ai` |
| Google Gemini | Oui | Non | `https://generativelanguage.googleapis.com` |
| OpenRouter | Oui | Non | `https://openrouter.ai/api/v1` |
| Opencode Zen | Oui | Non | `https://zen.opencode.ai/v1` |
| Ollama Local | Non | Oui | `http://localhost:11434` |
| Ollama Cloud | Oui | Non | `https://ollama.com` |
| LM Studio | Non | Oui | `http://localhost:1234/v1` |
| Custom | Optionnel | Non | Configurable |

### 5.4 Agents (agents.ts)

**Rôle :** CRUD des agents, scaffolding, sélection de profils.

**Templates disponibles :**
- **Standard** — Assistant général avec `toolConfig`, `selfCorrection`, `guardian`
- **Fast (bot)** — Bot rapide avec streaming, rate limit, validation de sortie
- **Daemon** — Agent de fond avec health check, auto-restart, notifications

**Fonctionnalités :**
- Création depuis un template avec injection des instructions
- Fusion des profils (instructions + contraintes + configuration)
- Relecture d'agents depuis le disque (`readLocalAgent`)
- Extraction des champs par regex (id, displayName, model, provider, tools, configs)
- Mise à jour des champs individuels (`updateAgentFile`)
- Nettoyage automatique en cas d'échec de création

### 5.5 Profils (601)

**Répartition réelle :**
- **227 Agents** — Conversationnels (Python, React, Rust, CSS, planning, etc.)
- **270 Bots** — Automation (Git, Docker, tests, scripts, réseau, etc.)
- **103 Daemons** — Background (logs, maintenance, surveillance, coordination)

**État :** Fichiers JSON complets mais **non exploités par l'interface**. La fonction `loadProfile()` existe dans `agents.ts` mais seule la création d'agent y fait appel.

**Améliorations souhaitées :**
- Interface interactive de découverte (parcourir, filtrer, prévisualiser)
- Catégorisation par domaine d'expertise
- Recherche plein texte
- Statistiques d'utilisation

### 5.6 Protocole PACO

**Concept :** Orchestration avec gouvernance — un orchestrateur coordonne, un superviseur vérifie, un daemon audite.

**État actuel :**
- ✅ `keyword-registry.yaml` et `paco-protocol.md` existent dans `data/protocols/`
- ❌ Les agents PACO (orchestrateur, superviseur, reviewer) ont été supprimés du dossier `.agents/`
- ❌ Le cycle de délégation n'est plus opérationnel

**Améliorations souhaitées :**
- Recréer les agents PACO dans `.agents/`
- Rendre le cycle de délégation réellement opérationnel
- Automatiser la mise à jour du registre de mots-clés
- Tableau de bord de supervision
- Alertes et notifications en temps réel

### 5.7 Skills

**Rôle :** Instructions spécialisées chargeables dynamiquement.

**Skills existantes (6) :**
| Skill | Chemin | Rôle |
|---|---|---|
| `skill-welcome` | `skills/skill-welcome/SKILL.md` | Accueil Alice au démarrage |
| `skill-agent-reviewer` | `skills/skill-agent-reviewer/SKILL.md` | Revue qualitative des agents/skills |
| `skill-engineering/debug-mantra` | `skills/skill-engineering/debug-mantra/SKILL.md` | Discipline de débogage en 4 mantras |
| `skill-engineering/post-mortem` | `skills/skill-engineering/post-mortem/SKILL.md` | Analyse post-mortem / RCA |
| `skill-engineering/scrutinize` | `skills/skill-engineering/scrutinize/SKILL.md` | Revue extérieure end-to-end |
| `skill-productivity/management-talk` | `skills/skill-productivity/management-talk/SKILL.md` | Traduction technique → management |

**Génération :** Auto-générée par LLM via `generateSkill()` dans `generate-skill.ts`, avec validation structurelle. Les instructions de chaque skill sont au format frontmatter YAML + corps Markdown.

**Commandes CLI :**
- `/skills` — Liste toutes les skills disponibles
- `/skills load <nom>` — Charge et affiche le contenu d'une skill

---

## 6. Décisions UX & Design

### 6.1 Gestion des providers

**Approche retenue :** Interface interactive riche (implémentée dans `cli-providers.ts`)

Caractéristiques :
- Menu de sélection des providers avec statut (✓/✗)
- Validation des clés API en temps réel
- Fetch automatique des modèles disponibles (top 15 priorisé)
- Test de connexion complet avant validation
- Suggestions d'installation (ex: Ollama → lfm2.5-thinking)
- Alternateur multi-clés visible
- Menu de sous-actions par provider (ajouter clé, changer modèle, activer/désactiver)
- Fallback saisie manuelle si API indisponible

### 6.2 Interface utilisateur

**Focus :** CLI d'abord, web ensuite.

Le CLI offre :
- Menu principal clair avec numérotation (1-9) et couleurs ANSI
- Commandes slash (/create, /start, /providers, /skills, etc.)
- Auto-complétion Tab
- Sélecteur de commandes (/ + flèches directionnelles)
- Annulation par ESC
- Notifications inter-processus
- Codes couleurs (CYAN, GREEN, YELLOW, RED, GRAY, BOLD)

### 6.3 Workflow de création d'agent

Le workflow dans `cli-create.ts` (682 lignes) :

1. ✅ Vérification équipe PACO
2. ✅ Sélection provider avec validation clé
3. ✅ Récupération et sélection des modèles (top 15, triés)
4. ✅ Test de connexion
5. ✅ Description libre (min 10 mots)
6. ✅ Analyse automatique (nom grec, template, profil via LLM)
7. ✅ Génération skill + scaffold agent
8. ✅ Validation (skill, agent, intégration, TypeScript)
9. ✅ Revue par Reviewer
10. ✅ Certification PACO
11. ✅ Nettoyage auto en cas d'échec

**Améliorations :** Rendre ce workflow plus rapide et robuste (actuellement ~2 minutes complet).

---

## 7. Contraintes & Règles

### 7.1 IDs d'agents
- Format **kebab-case** obligatoire (minuscules, tirets)
- Exemple : `mon-agent`, `agent-hecatonchires`

### 7.2 Descriptions
- Minimum 10 mots
- Clair et spécifique — décrit la mission primaire

### 7.3 Noms d'outils standards
`['run_terminal_command', 'add_message', 'set_output', 'skill']`

### 7.4 Persistance
- Agents : `.agents/<id>.ts`
- Skills : `skills/skill-<id>/SKILL.md`
- Providers : `providers.json` (gitignored)
- Notifications : `.notifications.json`
- Logbook : `telecom/agent-logbook.md`

### 7.5 Sécurité
- Guardian bloque les commandes dangereuses (`rm -rf`, `drop table`, pipe to shell, etc.)
- Patterns customisables via `blockedPatterns`
- Audit trail optionnel
- `.env` et `providers.json` gitignorés pour les clés API

---

## 8. Prochaines Étapes Immédiates

| Priorité | Tâche | Description |
|----------|-------|-------------|
| 🔴 | **Commiter les modifs** | Les 20+ nouveaux fichiers et les modifications sont non commités |
| 🔴 | **Recréer les agents** | Restaurer `.agents/` avec les 4 agents PACO + 5 agents d'auto-amélioration |
| 🟠 | **Système découverte profils** | Interface interactive pour parcourir les 601 profils |
| 🟠 | **Licence & scripts** | Ajouter licence MIT + script `"test"` dans `package.json` |
| 🟡 | **Modulariser cli-create.ts** | Extraire les sous-étapes du workflow de création (682 lignes) |
| 🟡 | **Tests unitaires supplémentaires** | engine-llm, providers, agents, skills |

---

## 9. Métriques de Succès

| Métrique | Mesure actuelle | Cible |
|----------|----------------|-------|
| Compilation TypeScript | **0 erreurs** | 0 erreurs |
| Tests unitaires | **55/55** (100%) | 100% |
| Tests E2E | **37/37** (100%) | 100% |
| Temps création agent CLI | ~2 min | < 2 min |
| Temps réponse LLM | Variable (selon provider) | < 10s |
| Temps démarrage CLI | < 1s | < 1s |
| Temps build (`tsc`) | < 3s | < 5s |

---

*Document mis à jour le 2026-05-21 — v2 (reflète l'état réel du code après modularisation engine + CLI, tests unitaires, et analyse des écarts).*
