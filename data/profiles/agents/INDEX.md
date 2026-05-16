# Index des Profils - Agents

Profils destinés aux interactions directes avec l'utilisateur. Chaque agent exécute une mission atomique unique dans son domaine strict.

---

## 📚 Lexique des Profils

| Profil | Domaine | Rôle | Mission Atomique | Déclencheur | Intrant | Extrant | Statut |
|--------|---------|------|------------------|-------------|---------|---------|--------|
| **ORCHESTRATION** | | | | | | | |
| `orchestrateur` | MANAGEMENT | orchestrateur | Coordonner les agents via le protocole PACO : assigner, vérifier les dépendances, gérer les conflits, ne JAMAIS produire de livrable direct | Watchdog, timer, utilisateur | `tâches_en_cours.json`, `keyword-registry.yaml` | `tâches_en_cours.json` mis à jour, délégations `@agent`, rapports coordination | ✅ Complété |
| **RECHERCHE & RÉTRO-INGÉNIERIE** | | | | | | | |
| `agent-retro` | SEARCH | retro-engineer | Analyser le code existant (structure, dépendances, patterns) et produire un rapport d'analyse exploitable par les agents de dev | Orchestrateur, fichier dans `inbox/` | Code source du projet, dossier cible | `rapports/analyse/{projet}.md` | ✅ Complété |
| `RESEARCH-web-01` | SEARCH | web-expert | Rechercher des informations exhaustives sur le web, documentation et forums | Orchestrateur | Requête de recherche | `rapports/recherche/{tâche}.md` | ✅ Complété |
| `RESEARCH-code-01` | SEARCH | code-expert | Analyser du code open-source et des bibliothèques existantes | Orchestrateur | URL ou nom de librairie | `rapports/analyse/{lib}.md` | ✅ Complété |
| **PLANIFICATION** | | | | | | | |
| `PLAN-strategy-01` | PLAN | strategist | Définir la stratégie globale à partir d'une idée ou d'un besoin | Orchestrateur, utilisateur | Fiche de besoin | `rapports/strategie/{tâche}.md` | ✅ Complété |
| `PLAN-architecture-01` | PLAN | architect | Définir les schémas, flux de données et choix technologiques | Orchestrateur | Rapport stratégie | `rapports/architecture/{tâche}.md` | ✅ Complété |
| `PLAN-task-01` | PLAN | task-manager | Découper en tâches atomiques et définir les priorités | Orchestrateur | Rapport architecture | `rapports/tâches/{tâche}.md`, `tâches_en_cours.json` | ✅ Complété |
| **DÉVELOPPEMENT** | | | | | | | |
| `agent-novice` | DEV | developpeur | Implémenter du code (JS/Python) avec TDD : écrire les tests d'abord, puis le code minimal pour les passer | Orchestrateur | Fiche de tâche, rapport rétro | Code, tests, `rapports/auto-verif/` | ✅ Complété |
| `PYTHON-async-01` | PYTHON | async | Gérer exclusivement les boucles asyncio et coroutines Python | Orchestrateur | Fiche de tâche Python | Code asyncio, tests | ✅ Complété |
| `PYTHON-unittest-01` | PYTHON | tester | Rédiger des tests unitaires PyTest (zéro logique métier) | Orchestrateur | Spécifications fonction | Tests unitaires complets | ✅ Complété |
| `PYTHON-helper-01` | PYTHON | helper | Écrire des scripts Python généralistes : data, fichiers, CLI, regex, bibliothèque standard | Orchestrateur | Spécifications tâche Python | Scripts Python, documentation | ✅ Complété |
| `CSS-flex-01` | CSS | flex | Aligner et distribuer l'espace via Flexbox uniquement | Orchestrateur | Maquette ou spécifications | Code CSS Flexbox, tests visuels | ✅ Complété |
| `CSS-grid-01` | CSS | grid | Créer des grilles complexes via CSS Grid | Orchestrateur | Maquette ou spécifications | Code CSS Grid, tests visuels | ✅ Complété |
| `CSS-layout-01` | CSS | layout | Gérer le layout général : position, display, z-index, overflow, box model | Orchestrateur | Spécifications mise en page | Code CSS layout, tests | ✅ Complété |
| `CSS-colors-01` | CSS | colors | Gérer les palettes, variables CSS et thèmes | Orchestrateur | Cahier des couleurs | Variables CSS, thèmes, palette | ✅ Complété |
| `CSS-responsive-01` | CSS | responsive | Adapter le rendu à toutes les tailles d'écran (media queries, breakpoints) | Orchestrateur | Composant à rendre responsive | CSS responsive, tests | ✅ Complété |
| `CSS-animations-01` | CSS | animations | Créer des animations et transitions CSS | Orchestrateur | Spécifications animation | Code animations, keyframes | ✅ Complété |
| `REACT-hooks-01` | REACT | hooks | Implémenter des hooks personnalisés et gérer l'état React | Orchestrateur | Spécifications composant | Hooks, tests | ✅ Complété |
| `NEXTJS-routing-01` | NEXTJS | routing | Configurer l'App Router et les layouts dynamiques Next.js | Orchestrateur | Plan d'architecture | Routes, layouts, tests | ✅ Complété |
| `RUST-ownership-01` | RUST | ownership | Gérer le borrow checker et les lifetimes Rust | Orchestrateur | Spécifications Rust | Code Rust, tests | ✅ Complété |
| **DOCUMENTATION** | | | | | | | |
| `agent-markdown` | DOC | redacteur | Rédiger la documentation technique (Markdown) : JSDoc, README, rapports | Orchestrateur | Code + tests terminés | `Agent-docs/fonctions/{nom}.md`, rapports | ✅ Complété |
| `agent-mermaid` | DOC | diagrammes | Générer des diagrammes Mermaid (architecture, flux, dépendances) à partir de rapports | Orchestrateur | Rapports d'analyse ou d'architecture | Diagrammes `.md` avec Mermaid | ✅ Complété |
| **VALIDATION** | | | | | | | |
| `agent-validateur` | QA | validateur | Valider la conformité globale : intégration, conventions, documentation, non-régression | Orchestrateur | Tous les livrables d'une tâche | `rapports/validations/{tâche}.md`, label "Validé" | ✅ Complété |
| `agent-superviseur` | QA | superviseur | Surveiller l'orchestrateur en continu, détecter les violations PACO (production directe, délégation manquante), alerter et suspendre après 3 violations | Watchdog, timer | Logs orchestrateur, `tâches_en_cours.json` | `rapports/supervision/{date}.md`, alertes | ✅ Complété |
| `REVIEWER-code-01` | REVIEW | auditeur | Review critique du code (sécurité, conventions, edge cases) | Orchestrateur | Code à reviewer | `rapports/revues/{tâche}_{agent}.md` | ✅ Complété |
| `REVIEWER-css-01` | REVIEW | auditeur | Audit de la performance CSS et respect du design system | Orchestrateur | Code CSS à auditer | `rapports/revues/{tâche}_css.md` | ✅ Complété |
| `REVIEWER-logic-01` | REVIEW | auditeur | Vérifier la cohérence logique et les cas d'erreur | Orchestrateur | Code à analyser | `rapports/revues/{tâche}_logique.md` | ✅ Complété |
| **GÉNÉRAL** | | | | | | | |
| `assistant-general` | GENERAL | assistant | Assistance polyvalente, courtoise et professionnelle pour tâches quotidiennes | Utilisateur | Message utilisateur | Réponse directe | ✅ Complété |

---

## 🛠️ Convention de Nommage

- Profils génériques : `kebab-case` (ex: `agent-novice`, `assistant-general`)
- Profils micro-spécialisés : `[DOMAINE]-[ROLE]-[INDEX]` (ex: `CSS-flex-01`, `PYTHON-async-01`)
- Fichier associé : `data/profiles/agents/{nom}.json`
