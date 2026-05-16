# Index des Profils - Bots

Profils spécialisés dans l'exécution rapide et atomique de tâches techniques, sans interaction utilisateur directe.

---

## 📚 Lexique des Profils

| Profil | Domaine | Rôle | Mission Atomique | Déclencheur | Intrant | Extrant | Statut |
|--------|---------|------|------------------|-------------|---------|---------|--------|
| **AUTOMATISATION GÉNÉRALE** | | | | | | | |
| `task-automator` | AUTO | automator | Automatiser des tâches techniques : scripts, fichiers, workflows via terminal | Orchestrateur, timer | Fiche de tâche | Scripts exécutés, logs, rapport | ✅ Complété |
| `AUTO-backup-01` | AUTO | backup | Créer des copies de sauvegarde avant toute modification destructive | Orchestrateur, watchdog | Fichier à modifier | Copie dans `backups/`, log | ✅ Complété |
| `AUTO-sync-01` | AUTO | sync | Synchroniser des dossiers (sandbox → projet, local → distant) via rsync | Orchestrateur | Source + destination | Dossier synchronisé, log | ✅ Complété |
| `AUTO-cleanup-01` | AUTO | cleanup | Nettoyer les fichiers temporaires, orphelins et caches | Timer (hebdo) | Liste des dossiers à nettoyer | Espace libéré, rapport | ✅ Complété |
| **RECHERCHE & PARSING** | | | | | | | |
| `SEARCH-grep-01` | SEARCH | grep-expert | Rechercher textuellement avec grep/ripgrep dans la codebase | Orchestrateur, agent | Pattern + dossier cible | Résultats dans `rapports/recherche/` | ✅ Complété |
| `SEARCH-crawl-01` | SEARCH | crawler | Parcourir et indexer l'arborescence des dossiers | Orchestrateur, timer | Dossier racine | Structure arborescente, rapport | ✅ Complété |
| `SEARCH-regex-01` | SEARCH | regex | Rechercher des patterns complexes (Regex) dans les fichiers | Orchestrateur, agent | Pattern regex + fichiers | Résultats matchés, rapport | ✅ Complété |
| **PLANIFICATION** | | | | | | | |
| `PLAN-task-gen-01` | PLAN | task-builder | Générer automatiquement les fichiers de tâches depuis un plan | Orchestrateur | Plan ou specs | `rapports/tâches/{tâche}.md` | ✅ Complété |
| `PLAN-map-gen-01` | PLAN | map-builder | Générer des cartes mentales et diagrammes d'architecture | Orchestrateur | Données structurées | Diagramme (Mermaid/ASCII) | ✅ Complété |
| **GIT & VERSIONING** | | | | | | | |
| `GIT-commit-01` | GIT | committer | Rédiger et exécuter des commits (Conventional Commits) | Orchestrateur | Fichiers modifiés + message | Commit Git, log | ✅ Complété |
| `GIT-pr-01` | GIT | pr-maker | Créer des Pull Requests avec description générée automatiquement | Orchestrateur | Branche + changements | PR GitHub, description | ✅ Complété |
| `GIT-log-01` | GIT | log-analyst | Analyser l'historique Git et générer des rapports de changements | Orchestrateur, utilisateur | Période + branche | `rapports/git/{période}.md` | ✅ Complété |
| **DOCKER & DÉPLOIEMENT** | | | | | | | |
| `DOCKER-build-01` | DOCKER | builder | Construire des images Docker optimisées (multi-stage) | Orchestrateur | Dockerfile + source | Image Docker, log | ✅ Complété |
| `DOCKER-compose-01` | DOCKER | compose | Générer et valider des fichiers docker-compose | Orchestrateur | Services à déployer | `docker-compose.yml`, tests | ✅ Complété |
| **FICHIERS & STRUCTURE** | | | | | | | |
| `FILE-create-01` | FILE | creator | Créer des fichiers/dossiers selon la hiérarchie définie | Orchestrateur | Plan de structure | Arborescence créée | ✅ Complété |
| `FILE-rename-01` | FILE | renamer | Renommer des fichiers en masse selon un pattern strict | Orchestrateur, agent | Pattern + mapping | Fichiers renommés, log | ✅ Complété |
| `FILE-organize-01` | FILE | organizer | Trier des fichiers dans des dossiers par extension, date ou convention | Orchestrateur, timer | Dossier source | Fichiers organisés, rapport | ✅ Complété |
| `FILE-validate-01` | FILE | validator | Valider les conventions de nommage et la structure des fichiers | Orchestrateur, agent | Dossier à valider | Rapport de conformité | ✅ Complété |
| **SCRIPTS & EXÉCUTION** | | | | | | | |
| `SCRIPT-runner-01` | SCRIPT | runner | Exécuter des scripts prédéfinis et capturer la sortie | Orchestrateur | Script + arguments | Sortie du script, log | ✅ Complété |
| `SCRIPT-linter-01` | SCRIPT | linter | Linter des fichiers (ESLint, PyLint, Stylelint) et formater le code | Orchestrateur, watchdog | Fichiers à linter | Code formaté, rapport d'erreurs | ✅ Complété |

---

## 🛠️ Convention de Nommage

- Format : `[DOMAINE]-[ROLE]-[INDEX]` (ex: `SEARCH-grep-01`, `AUTO-backup-01`)
- Fichier associé : `data/profiles/bots/{nom}.json`
