# Index des Profils - Bots

Profils spécialisés dans l'exécution rapide et atomique de tâches techniques, sans interaction utilisateur directe. **200 profils — tous complétés.**

Déclenchement : **sur demande** (orchestrateur/agent). Exécution → sortie → fin. Pas de `healthCheck`.

---

## 📚 Lexique des Profils

| Profil | Domaine | Rôle | Mission Atomique | Déclencheur | Intrant | Extrant | Statut |
|--------|---------|------|------------------|-------------|---------|---------|--------|
| **BACKUP — SAUVEGARDE** | | | | | | | |
| `BACKUP-backup-01` | BACKUP | backup | Créer des copies de sauvegarde avant toute modification destructive | Orchestrateur | Fichier à modifier | Copie dans `backups/`, log | ✅ Complété |
| `BACKUP-restore-02` | BACKUP | restore | Restaurer des fichiers/dossiers depuis les sauvegardes dans `backups/` | Orchestrateur | Fichier à restaurer | Fichier restauré, rapport | ✅ Complété |
| `BACKUP-list-03` | BACKUP | list | Lister et rechercher les sauvegardes disponibles (par nom, date, taille) | Orchestrateur | Filtre optionnel | Index des sauvegardes | ✅ Complété |
| `BACKUP-verify-04` | BACKUP | verify | Vérifier l'intégrité des sauvegardes (checksum, contenu, détection corruption) | Orchestrateur | Sauvegarde à vérifier | Rapport d'intégrité | ✅ Complété |
| **DOCKER — CONTENEURISATION** | | | | | | | |
| `DOCKER-build-01` | DOCKER | builder | Construire des images Docker optimisées (multi-stage) | Orchestrateur | Dockerfile + source | Image Docker, log | ✅ Complété |
| `DOCKER-compose-02` | DOCKER | compose | Générer et valider des fichiers docker-compose | Orchestrateur | Services à déployer | `docker-compose.yml`, tests | ✅ Complété |
| `DOCKER-push-03` | DOCKER | push | Pousser des images Docker vers un registry (Docker Hub, GHCR, privé) | Orchestrateur | Image locale | Image pushée, digest SHA256 | ✅ Complété |
| `DOCKER-pull-04` | DOCKER | pull | Tirer des images Docker depuis un registry | Orchestrateur | Nom d'image + tag | Image téléchargée, rapport | ✅ Complété |
| `DOCKER-clean-05` | DOCKER | clean | Nettoyer les ressources Docker inutilisées (images dangling, conteneurs, caches) | Orchestrateur | Dry-run d'abord | Espace libéré, rapport | ✅ Complété |
| `DOCKER-run-06` | DOCKER | run | Exécuter des conteneurs temporaires pour tests et debugging | Orchestrateur | Image + commande | Sortie, code sortie, rapport | ✅ Complété |
| **EXEC — EXÉCUTION** | | | | | | | |
| `EXEC-task-automator-01` | EXEC | automator | Automatiser des tâches techniques : scripts, fichiers, workflows via terminal | Orchestrateur | Fiche de tâche | Scripts exécutés, logs, rapport | ✅ Complété |
| `EXEC-shell-02` | EXEC | shell | Exécuter des commandes shell de façon sécurisée avec validation et rapport | Orchestrateur | Commande + args | Rapport exécution, code sortie | ✅ Complété |
| `EXEC-parallel-03` | EXEC | parallel | Exécuter des commandes multiples en parallèle avec agrégation des résultats | Orchestrateur | Liste de commandes | Rapport consolidé par commande | ✅ Complété |
| `EXEC-pipeline-04` | EXEC | pipeline | Exécuter un pipeline de commandes chaînées (sortie → entrée suivante) | Orchestrateur | Séquence de commandes | Rapport pipeline par étape | ✅ Complété |
| `EXEC-batch-05` | EXEC | batch | Traiter un lot de fichiers avec une commande répétée et suivi de progression | Orchestrateur | Fichiers + commande | Rapport lot : N/M réussis | ✅ Complété |
| `EXEC-retry-06` | EXEC | retry | Exécuter une commande avec tentatives automatiques (backoff exponentiel) | Orchestrateur | Commande + stratégie | Rapport par tentative | ✅ Complété |
| `EXEC-timeout-07` | EXEC | timeout | Exécuter une commande avec timeout garanti et capture partielle | Orchestrateur | Commande + timeout | Rapport statut (complété/timeout) | ✅ Complété |
| `EXEC-capture-08` | EXEC | capture | Capturer, filtrer et formater la sortie d'une commande (grep, head, JSON) | Orchestrateur | Commande + filtre | Sortie formatée, métriques | ✅ Complété |
| `EXEC-transform-09` | EXEC | transform | Transformer des données avec jq, sed, awk, perl (dry-run par défaut) | Orchestrateur | Fichier + transformation | Fichier transformé, rapport | ✅ Complété |
| `EXEC-env-10` | EXEC | env | Exécuter des commandes dans un environnement isolé (temp dir, vars contrôlées) | Orchestrateur | Commande + env config | Rapport environnement, sortie | ✅ Complété |
| `EXEC-schedule-11` | EXEC | schedule | Exécuter une commande différée (délai relatif ou absolu, max 1h) | Orchestrateur | Commande + moment | Rapport exécution différée | ✅ Complété |
| **FILE — FICHIERS & STRUCTURE** | | | | | | | |
| `FILE-create-01` | FILE | creator | Créer des fichiers/dossiers selon la hiérarchie définie | Orchestrateur | Plan de structure | Arborescence créée | ✅ Complété |
| `FILE-organize-02` | FILE | organizer | Trier des fichiers dans des dossiers par extension, date ou convention | Orchestrateur | Dossier source | Fichiers organisés, rapport | ✅ Complété |
| `FILE-rename-03` | FILE | renamer | Renommer des fichiers en masse selon un pattern strict | Orchestrateur, agent | Pattern + mapping | Fichiers renommés, log | ✅ Complété |
| `FILE-validate-04` | FILE | validator | Valider les conventions de nommage et la structure des fichiers | Orchestrateur, agent | Dossier à valider | Rapport de conformité | ✅ Complété |
| `FILE-copy-05` | FILE | copy | Copier des fichiers/dossiers avec conservation de la structure | Orchestrateur | Source + destination | Fichiers copiés, rapport | ✅ Complété |
| `FILE-move-06` | FILE | move | Déplacer ou renommer des fichiers/dossiers | Orchestrateur | Source + destination | Fichiers déplacés, rapport | ✅ Complété |
| `FILE-delete-07` | FILE | delete | Supprimer des fichiers/dossiers (backup auto, dry-run, confirmation) | Orchestrateur | Fichiers à supprimer | Fichiers supprimés, backup | ✅ Complété |
| `FILE-diff-08` | FILE | diff | Comparer fichiers/dossiers (diff unifié, récursif, résumé) | Orchestrateur | Fichier A + B | Rapport de différences | ✅ Complété |
| `FILE-info-09` | FILE | info | Extraire les métadonnées des fichiers (type, taille, perms, checksum) | Orchestrateur | Fichier/dossier | Rapport métadonnées | ✅ Complété |
| `FILE-archive-10` | FILE | archive | Créer et extraire des archives (zip, tar, tar.gz, tar.bz2) | Orchestrateur | Fichiers + format | Archive créée/extraite | ✅ Complété |
| `FILE-perm-11` | FILE | perm | Gérer les permissions (chmod) et la propriété (chown), dry-run par défaut | Orchestrateur | Cible + permissions | Permissions modifiées, rapport | ✅ Complété |
| `FILE-encode-12` | FILE | encode | Détecter et convertir l'encodage de fichiers texte (UTF-8, Latin1) | Orchestrateur | Fichier + encodage cible | Fichier converti, rapport | ✅ Complété |
| `FILE-tree-13` | FILE | tree | Générer l'arborescence des dossiers (format tree, export MD/JSON) | Orchestrateur | Dossier racine | Arborescence, rapport | ✅ Complété |
| **FOLDER — DOSSIERS** | | | | | | | |
| `FOLDER-create-01` | FOLDER | create | Créer une arborescence complète de dossiers à partir d'un plan structuré | Orchestrateur | Plan de dossiers | Arborescence créée | ✅ Complété |
| `FOLDER-list-02` | FOLDER | list | Lister le contenu d'un dossier avec filtres, tri et export (JSON/CSV/MD) | Orchestrateur | Dossier à lister | Liste structurée | ✅ Complété |
| `FOLDER-stats-03` | FOLDER | stats | Analyser un dossier : comptage, taille, répartition par type, fichiers dupliqués | Orchestrateur | Dossier cible | Rapport statistiques | ✅ Complété |
| `FOLDER-clean-04` | FOLDER | clean | Supprimer les dossiers vides récursivement (des feuilles vers la racine) | Orchestrateur | Dossier racine | Dossiers vides supprimés | ✅ Complété |
| `FOLDER-flatten-05` | FOLDER | flatten | Aplatir une arborescence (tous les fichiers remontés à la racine) | Orchestrateur | Dossier cible | Arborescence aplatie | ✅ Complété |
| `FOLDER-merge-06` | FOLDER | merge | Fusionner deux arborescences avec stratégie de conflit (skip/overwrite/rename) | Orchestrateur | Source + cible | Dossiers fusionnés | ✅ Complété |
| `FOLDER-split-07` | FOLDER | split | Partitionner des fichiers en sous-dossiers par critère (extension, date, taille) | Orchestrateur | Dossier source | Fichiers répartis | ✅ Complété |
| `FOLDER-normalize-08` | FOLDER | normalize | Normaliser les noms de dossiers (kebab-case, snake_case, sans accents) | Orchestrateur | Dossier cible | Dossiers renommés | ✅ Complété |
| `FOLDER-skeleton-09` | FOLDER | skeleton | Générer un squelette de dossiers vide depuis un template (projet, composant) | Orchestrateur | Template + destination | Squelette créé | ✅ Complété |
| `FOLDER-purge-10` | FOLDER | purge | Supprimer une arborescence complète (backup auto, dry-run, confirmation) | Orchestrateur | Dossier à purger | Dossier supprimé, backup | ✅ Complété |
| **GIT — VERSIONING** | | | | | | | |
| `GIT-commit-01` | GIT | committer | Rédiger et exécuter des commits (Conventional Commits) | Orchestrateur | Fichiers modifiés + message | Commit Git, log | ✅ Complété |
| `GIT-log-02` | GIT | log-analyst | Analyser l'historique Git et générer des rapports de changements | Orchestrateur | Période + branche | `rapports/git/{période}.md` | ✅ Complété |
| `GIT-pr-03` | GIT | pr-maker | Créer des Pull Requests avec description générée automatiquement | Orchestrateur | Branche + changements | PR GitHub, description | ✅ Complété |
| `GIT-branch-04` | GIT | branch | Gérer les branches : créer, lister, renommer, supprimer (validation noms) | Orchestrateur | Opération + nom | Branche gérée, rapport | ✅ Complété |
| `GIT-checkout-05` | GIT | checkout | Changer de branche ou restaurer des fichiers (stash auto si modifs) | Orchestrateur | Branche cible | Checkout effectué, rapport | ✅ Complété |
| `GIT-status-06` | GIT | status | Afficher le statut Git structuré (working tree, staging, untracked, conflits) | Orchestrateur | — | Résumé structuré | ✅ Complété |
| `GIT-diff-07` | GIT | diff | Afficher les différences (staged, unstaged, entre commits, word-diff) | Orchestrateur | Mode + fichier | Diff formaté, statistiques | ✅ Complété |
| `GIT-merge-08` | GIT | merge | Fusionner des branches avec détection de conflits et post-validation | Orchestrateur | Branche source | Merge effectué, rapport | ✅ Complété |
| `GIT-rebase-09` | GIT | rebase | Rebaser des branches (auto-abort en cas de conflit, validation) | Orchestrateur | Branche cible | Rebase effectué, rapport | ✅ Complété |
| `GIT-stash-10` | GIT | stash | Gérer le stash : sauvegarder, lister, restaurer, nettoyer | Orchestrateur | Opération + message | Stash géré, rapport | ✅ Complété |
| `GIT-reset-11` | GIT | reset | Reset sécurisé (soft/mixed/hard) avec backup branch avant hard reset | Orchestrateur | Mode + cible | Reset effectué, backup | ✅ Complété |
| `GIT-revert-12` | GIT | revert | Annuler des commits par revert (sûr pour branches partagées) | Orchestrateur | Commit(s) à annuler | Revert effectué, rapport | ✅ Complété |
| `GIT-push-13` | GIT | push | Push sécurisé (dry-run, protection branches, force-with-lease) | Orchestrateur | Remote + branche | Push effectué, rapport | ✅ Complété |
| `GIT-pull-14` | GIT | pull | Pull avec stratégie (rebase par défaut, validation des conflits) | Orchestrateur | Remote + branche | Pull effectué, rapport | ✅ Complété |
| `GIT-fetch-15` | GIT | fetch | Fetch des références distantes (prune, affiche ahead/behind) | Orchestrateur | Remote | Fetch effectué, rapport | ✅ Complété |
| `GIT-tag-16` | GIT | tag | Gérer les tags : créer (annotés), lister, supprimer, pusher | Orchestrateur | Opération + nom | Tag géré, rapport | ✅ Complété |
| `GIT-validate-17` | GIT | validate | Valider pré-commit (lint + tests + conventions + secrets detection) | Orchestrateur | — | Rapport validation, commit si OK | ✅ Complété |
| `GIT-cherry-18` | GIT | cherry | Cherry-pick de commits avec gestion de conflits et annulation | Orchestrateur | Commit(s) source | Cherry-pick effectué, rapport | ✅ Complété |
| `GIT-clean-19` | GIT | clean | Nettoyer fichiers non trackés (dry-run, backup avant suppression) | Orchestrateur | Dossier cible | Fichiers nettoyés, rapport | ✅ Complété |
| `GIT-clone-20` | GIT | clone | Cloner un dépôt (shallow, sous-modules, branche spécifique) | Orchestrateur | URL + options | Dépôt cloné, rapport | ✅ Complété |
| **PLAN — PLANIFICATION** | | | | | | | |
| `PLAN-map-gen-01` | PLAN | map-builder | Générer des cartes mentales et diagrammes d'architecture | Orchestrateur | Données structurées | Diagramme (Mermaid/ASCII) | ✅ Complété |
| `PLAN-report-gen-02` | PLAN | report-builder | Générer des rapports de planification : synthèses, tableaux de bord, résumés | Orchestrateur | Plans, métriques | `rapports/syntheses/planification/` | ✅ Complété |
| `PLAN-task-gen-03` | PLAN | task-builder | Générer automatiquement les fichiers de tâches depuis un plan | Orchestrateur | Plan ou specs | `rapports/tâches/{tâche}.md` | ✅ Complété |
| `PLAN-validate-04` | PLAN | validator | Valider la complétude et la cohérence des plans et spécifications | Orchestrateur | Plans, specs | `rapports/validation/plans/` | ✅ Complété |
| `PLAN-roadmap-05` | PLAN | roadmap | Créer des roadmaps temporelles (Gantt, timeline, phases, jalons) | Orchestrateur | Spécifications + dates | Roadmap (Mermaid) + résumé | ✅ Complété |
| `PLAN-estimate-06` | PLAN | estimate | Estimer charge/effort/durée (story points, heures, t-shirt sizing, PERT) | Orchestrateur | Spécifications | Rapport d'estimation | ✅ Complété |
| `PLAN-prioritize-07` | PLAN | prioritize | Prioriser tâches/features (MoSCoW, matrice impact/effort, CD3) | Orchestrateur | Tâches + critères | Matrice de priorisation | ✅ Complété |
| `PLAN-milestone-08` | PLAN | milestone | Définir et suivre des jalons (dates, livrables, chemin critique) | Orchestrateur | Projet + dates clés | Rapport jalons + timeline | ✅ Complété |
| `PLAN-resource-09` | PLAN | resource | Planifier et optimiser l'allocation des ressources (charge, compétences) | Orchestrateur | Tâches + ressources | Matrice allocation + taux | ✅ Complété |
| `PLAN-sprint-10` | PLAN | sprint | Planifier des sprints/iterations (Scrum : capacité, sélection, sprint backlog) | Orchestrateur | Backlog + vélocité | Sprint backlog + burn-down | ✅ Complété |
| `PLAN-risk-11` | PLAN | risk | Identifier, scorer et mitiger les risques (risk register, heat map, contingence) | Orchestrateur | Contexte projet | Risk register + heat map | ✅ Complété |
| `PLAN-budget-12` | PLAN | budget | Planifier et suivre le budget (coûts, CPI, EAC, détection dépassement) | Orchestrateur | Structure de coûts | Budget prévu/consommé/EAC | ✅ Complété |
| `PLAN-change-13` | PLAN | change | Gérer les changements de scope (CR, impact analysis, approval workflow) | Orchestrateur | Demande de changement | CR analysé, recommandation | ✅ Complété |
| `PLAN-okr-14` | PLAN | okr | Définir et suivre des OKRs stratégiques (objectifs, key results, progression) | Orchestrateur | Vision + objectifs | OKR tree + progression | ✅ Complété |
| `PLAN-retro-15` | PLAN | retro | Animer des rétrospectives et amélioration continue (Start/Stop/Continue, actions) | Orchestrateur | Période + retours | Synthèse rétro + action items | ✅ Complété |
| `PLAN-dependency-16` | PLAN | dependency | Cartographier les dépendances (DSM, chemin critique, float, blocages) | Orchestrateur | Tâches + liens | DSM + chemin critique | ✅ Complété |
| `PLAN-capacity-17` | PLAN | capacity | Prévoir la capacité long-terme (demand vs capacity, gap analysis, hiring) | Orchestrateur | Roadmap + ETP | Gap capacity + scénarios | ✅ Complété |
| `PLAN-communication-18` | PLAN | communication | Créer des plans de communication (stakeholders, RACI, fréquence, canaux) | Orchestrateur | Parties prenantes | Plan de com + RACI | ✅ Complété |
| `PLAN-scenario-19` | PLAN | scenario | Analyser des scénarios what-if et contingence (optimiste, pessimiste, plan B) | Orchestrateur | Baseline + variables | Scénarios comparés + reco | ✅ Complété |
| `PLAN-closeout-20` | PLAN | closeout | Clôturer un projet (documentation, handover, release notes, closure report) | Orchestrateur | Livrables + docs | Rapport de clôture + handover | ✅ Complété |
| **SCRIPT — SCRIPTS & EXÉCUTION** | | | | | | | |
| `SCRIPT-linter-01` | SCRIPT | linter | Linter des fichiers (ESLint, PyLint, Stylelint) et formater le code | Orchestrateur, watchdog | Fichiers à linter | Code formaté, rapport d'erreurs | ✅ Complété |
| `SCRIPT-runner-02` | SCRIPT | runner | Exécuter des scripts prédéfinis et capturer la sortie | Orchestrateur | Script + arguments | Sortie du script, log | ✅ Complété |
| `SCRIPT-formatter-03` | SCRIPT | formatter | Formater le code (Black, gofmt, rustfmt, biome, dprint) | Orchestrateur | Fichiers source | Fichiers formatés, rapport | ✅ Complété |
| `SCRIPT-typecheck-04` | SCRIPT | typecheck | Vérifier les types statiques (mypy, pyright, tsc --noEmit, flow) | Orchestrateur | Projet à analyser | Erreurs de type, rapport | ✅ Complété |
| `SCRIPT-static-analysis-05` | SCRIPT | static-analysis | Analyse statique avancée (SonarQube, CodeQL, Semgrep, Ruff) | Orchestrateur | Projet à analyser | Bugs, smells, vulns, dette tech | ✅ Complété |
| `SCRIPT-security-scan-06` | SCRIPT | security-scan | Scanner les vulnérabilités (Snyk, Trivy, Bandit, npm audit) | Orchestrateur | Projet à scanner | Vulns par sévérité, correctifs | ✅ Complété |
| `SCRIPT-secrets-07` | SCRIPT | secrets | Détecter les secrets exposés (gitleaks, truffleHog, patterns) | Orchestrateur | Code à scanner | Secrets détectés, recommandations | ✅ Complété |
| `SCRIPT-dep-audit-08` | SCRIPT | dep-audit | Auditer les dépendances (npm audit, cargo audit, pip audit) | Orchestrateur | Projet | Vulns dépendances, correctifs | ✅ Complété |
| `SCRIPT-complexity-09` | SCRIPT | complexity | Analyser la complexité (cyclomatique, cognitive, maintainability) | Orchestrateur | Projet à analyser | Métriques, seuils, top risques | ✅ Complété |
| `SCRIPT-dead-code-10` | SCRIPT | dead-code | Détecter le code mort (imports inutilisés, fonctions orphelines) | Orchestrateur | Projet à analyser | Code mort, lignes récupérables | ✅ Complété |
| `SCRIPT-codemod-11` | SCRIPT | codemod | Transformer le code automatiquement (jscodeshift, ts-migrate, sed) | Orchestrateur | Code + transformation | Fichiers transformés, diffs | ✅ Complété |
| `SCRIPT-scaffold-12` | SCRIPT | scaffold | Scaffolder des projets (cookiecutter, degit, create-*, cargo init) | Orchestrateur | Template + variables | Projet généré, prochaines étapes | ✅ Complété |
| `SCRIPT-doc-gen-13` | SCRIPT | doc-gen | Générer la documentation (TypeDoc, pydoc, rustdoc, godoc) | Orchestrateur | Code source | Documentation HTML/MD, couverture | ✅ Complété |
| `SCRIPT-shell-lint-14` | SCRIPT | shell-lint | Linter les scripts shell (shellcheck, shfmt, bashate) | Orchestrateur | Scripts .sh | Problèmes, formatage, score qualité | ✅ Complété |
| `SCRIPT-api-lint-15` | SCRIPT | api-lint | Valider les contrats API (OpenAPI Spectral, protolint, GraphQL) | Orchestrateur | Spécification API | Violations, breaking changes | ✅ Complété |
| `SCRIPT-iac-lint-16` | SCRIPT | iac-lint | Linter l'IaC (tfsec, checkov, cfn-lint, terrascan) | Orchestrateur | Code Terraform/CFN | Violations sécurité, compliance | ✅ Complété |
| `SCRIPT-docker-lint-17` | SCRIPT | docker-lint | Linter les Dockerfiles (hadolint, best practices, sécurité) | Orchestrateur | Dockerfile | Score qualité, optimisations | ✅ Complété |
| `SCRIPT-license-18` | SCRIPT | license | Vérifier les licences (license-checker, cargo-deny, pip-licenses) | Orchestrateur | Projet | Licences, incompatibilités | ✅ Complété |
| `SCRIPT-metrics-19` | SCRIPT | metrics | Calculer les métriques (cloc, tokei, git stats, taille fichiers) | Orchestrateur | Projet | SLOC, répartition, anomalies | ✅ Complété |
| `SCRIPT-ci-lint-20` | SCRIPT | ci-lint | Valider les configs CI/CD (actionlint, gitlab-ci-lint, CircleCI) | Orchestrateur | Fichiers .yml CI | Erreurs syntaxe, sécurité, perf | ✅ Complété |
| **SEARCH — RECHERCHE** | | | | | | | |
| `SEARCH-crawl-01` | SEARCH | crawler | Parcourir et indexer l'arborescence des dossiers | Orchestrateur | Dossier racine | Structure arborescente, rapport | ✅ Complété |
| `SEARCH-grep-02` | SEARCH | grep-expert | Rechercher textuellement avec grep/ripgrep dans la codebase | Orchestrateur, agent | Pattern + dossier cible | Résultats dans `rapports/recherche/` | ✅ Complété |
| `SEARCH-regex-03` | SEARCH | regex | Rechercher des patterns complexes (Regex) dans les fichiers | Orchestrateur, agent | Pattern regex + fichiers | Résultats matchés, rapport | ✅ Complété |
| `SEARCH-find-04` | SEARCH | find | Trouver des fichiers par nom/pattern (fd, find, locate, glob) | Orchestrateur | Pattern fichier | Fichiers trouvés, rapport | ✅ Complété |
| `SEARCH-ast-05` | SEARCH | ast | Recherche structurelle par AST (ast-grep, tree-sitter patterns) | Orchestrateur | Pattern AST | Correspondances, fichier, ligne | ✅ Complété |
| `SEARCH-semantic-06` | SEARCH | semantic | Recherche sémantique (grepai, meaning-based, langage naturel) | Orchestrateur | Requête naturelle | Résultats, score pertinence | ✅ Complété |
| `SEARCH-callgraph-07` | SEARCH | callgraph | Tracer les graphes d'appels (callers, callees, Mermaid graph) | Orchestrateur | Fonction cible | Graphe d'appels, cycles | ✅ Complété |
| `SEARCH-lsp-08` | SEARCH | lsp | Navigation LSP (go to def, find refs, workspace symbols) | Orchestrateur | Symbole à chercher | Définition, références, hover | ✅ Complété |
| `SEARCH-context-09` | SEARCH | context | Grep contextuel (grep-ast : matches dans leur fonction/classe) | Orchestrateur | Pattern + options | Matches contextualisés | ✅ Complété |
| `SEARCH-duplicate-10` | SEARCH | duplicate | Détecter fichiers et code dupliqués (fdupes, clone detection) | Orchestrateur | Dossier à analyser | Doublons, % duplicata | ✅ Complété |
| `SEARCH-instant-11` | SEARCH | instant | Recherche instantanée indexée (instantgrep, trigram index) | Orchestrateur | Pattern + dossier | Résultats rapides, temps | ✅ Complété |
| `SEARCH-replace-12` | SEARCH | replace | Rechercher et remplacer dans tout le projet (rg --replace, sd) | Orchestrateur | Pattern + remplacement | Diffs, occurrences changées | ✅ Complété |
| `SEARCH-large-13` | SEARCH | large | Trouver les fichiers volumineux (>1MB, top 10 lourds, dossiers) | Orchestrateur | Seuil de taille | Top fichiers, répartition | ✅ Complété |
| `SEARCH-recent-14` | SEARCH | recent | Trouver les fichiers par date (récents, intervalle, anciens) | Orchestrateur | Période | Fichiers par période | ✅ Complété |
| `SEARCH-empty-15` | SEARCH | empty | Trouver les fichiers/dossiers vides ou quasi-vides | Orchestrateur | Dossier cible | Vides, résiduels, candidats | ✅ Complété |
| `SEARCH-binary-16` | SEARCH | binary | Chercher dans les fichiers binaires/logs (strings, bgrep) | Orchestrateur | Pattern + dossier | Matches binaires, rapport | ✅ Complété |
| `SEARCH-todo-17` | SEARCH | todo | Trouver les marqueurs TODO/FIXME/HACK/XXX dans le code | Orchestrateur | Dossier cible | Marqueurs par type, priorité | ✅ Complété |
| `SEARCH-imports-18` | SEARCH | imports | Analyser les imports/dépendances (circulaires, orphelins, noyau) | Orchestrateur | Projet | Graphe imports, métriques | ✅ Complété |
| `SEARCH-type-19` | SEARCH | type | Chercher par type MIME/extension/langage de programmation | Orchestrateur | Type + dossier | Répartition, fichiers, anomalies | ✅ Complété |
| `SEARCH-compare-20` | SEARCH | compare | Comparer deux arborescences (fichiers communs, uniques, diffs) | Orchestrateur | Dossier A + B | Rapport comparaison | ✅ Complété |
| **SYNC — SYNCHRONISATION** | | | | | | | |
| `SYNC-sync-01` | SYNC | sync | Synchroniser des dossiers (sandbox → projet, local → distant) via rsync | Orchestrateur | Source + destination | Dossier synchronisé, log | ✅ Complété |
| `SYNC-cloud-02` | SYNC | cloud | Synchroniser avec le stockage cloud (S3, GCS, Azure, Drive, Dropbox) via rclone | Orchestrateur | Dossier local + remote cible | Fichiers cloud synchronisés, log | ✅ Complété |
| `SYNC-bidi-03` | SYNC | bidi | Synchronisation bidirectionnelle entre deux dossiers (Unison, résolution conflits) | Orchestrateur | Dossier A + B | Sync bidirectionnelle, rapport conflits | ✅ Complété |
| `SYNC-p2p-04` | SYNC | p2p | Synchronisation pair-à-pair décentralisée entre machines (Syncthing) | Orchestrateur | Device ID + dossier à partager | Cluster synchronisé, rapport état | ✅ Complété |
| `SYNC-realtime-05` | SYNC | realtime | Synchronisation temps réel déclenchée par événements fichier (lsyncd, inotifywait) | Orchestrateur | Dossier source + dest | Sync automatique, log continu | ✅ Complété |
| `SYNC-mirror-06` | SYNC | mirror | Mirroring exact de dossiers (copie conforme avec suppression rsync --delete) | Orchestrateur | Source + destination | Miroir exact, dry-run préalable | ✅ Complété |
| `SYNC-compare-07` | SYNC | compare | Comparaison entre deux dossiers (dry-run, diff, preview) sans transfert | Orchestrateur | Dossier A + B | Rapport différences, statistiques | ✅ Complété |
| `SYNC-filter-08` | SYNC | filter | Synchronisation filtrée (include/exclude par pattern, extension, taille, date) | Orchestrateur | Source + dest + filtres | Fichiers filtrés synchronisés, log | ✅ Complété |
| `SYNC-schedule-09` | SYNC | schedule | Synchronisation planifiée (cron, systemd timers, intervalle régulier) | Orchestrateur | Planification + config sync | Sync automatisée, rapports périodiques | ✅ Complété |
| `SYNC-verify-10` | SYNC | verify | Vérification d'intégrité post-sync (checksum SHA256, validation complète) | Orchestrateur | Source + destination | Rapport vérification, corrective si échec | ✅ Complété |
| **NET — RÉSEAU** | | | | | | | |
| `NET-fetch-01` | NET | fetch | Récupérer le contenu web d'URLs (pages, APIs, fichiers distants) en GET | Orchestrateur | URLs à récupérer | Contenu dans `rapports/web/` | ✅ Complété |
| `NET-api-02` | NET | api-tester | Tester des endpoints HTTP (GET, POST, PUT, DELETE) et valider les réponses | Orchestrateur | Endpoint + méthode + body | Rapport de test API | ✅ Complété |
| `NET-socket-03` | NET | socket | Connexion et test WebSocket (ws/wss, échange de messages, latence) | Orchestrateur | URL WebSocket | Rapport connexion, messages | ✅ Complété |
| `NET-dns-04` | NET | dns | Requêtes et diagnostics DNS (A, AAAA, MX, CNAME, TXT, NS, SOA) | Orchestrateur | Domaine + type | Rapport résolution DNS | ✅ Complété |
| `NET-download-05` | NET | download | Téléchargement de fichiers distants avec reprise (Range) et checksum SHA256 | Orchestrateur | URL + destination | Fichier téléchargé, rapport | ✅ Complété |
| `NET-graphql-06` | NET | graphql | Envoi de requêtes et mutations GraphQL avec introspection et validation | Orchestrateur | Endpoint + query | Rapport de test GraphQL | ✅ Complété |
| `NET-cert-07` | NET | cert | Inspection et validation de certificats SSL/TLS (expiration, chaîne, SAN) | Orchestrateur | Hôte + port | Rapport certificat SSL/TLS | ✅ Complété |
| `NET-ping-08` | NET | ping | Test de connectivité réseau (ping, traceroute, ports TCP) | Orchestrateur | Hôte + options | Rapport connectivité | ✅ Complété |
| `NET-header-09` | NET | header | Analyse des en-têtes HTTP (sécurité, cache, CORS) | Orchestrateur | URL | Rapport en-têtes HTTP | ✅ Complété |
| `NET-proxy-10` | NET | proxy | Validation et test de proxies HTTP/HTTPS/SOCKS (anonymat, pays, vitesse) | Orchestrateur | Proxy + options | Rapport validation proxy | ✅ Complété |
| **TEST — TESTS** | | | | | | | |
| `TEST-runner-01` | TEST | runner | Exécuter les suites de tests avec auto-détection du framework (jest, pytest, cargo) | Orchestrateur | Filtre optionnel | Rapport tests : pass/échec/ignorés | ✅ Complété |
| `TEST-coverage-02` | TEST | coverage | Générer et analyser la couverture de tests (istanbul, coverage.py, tarpaulin) | Orchestrateur | Projet à analyser | Rapport couverture % | ✅ Complété |
| `TEST-unit-03` | TEST | unit | Exécuter les tests unitaires (Vitest, Jest, pytest, cargo test, JUnit) avec filtrage | Orchestrateur | Filtre fichier/tag | Rapport structuré, stack traces | ✅ Complété |
| `TEST-e2e-04` | TEST | e2e | Tests end-to-end (Playwright, Cypress, Maestro) sur navigateurs réels | Orchestrateur | Specs E2E | Rapport HTML, traces, vidéos | ✅ Complété |
| `TEST-integration-05` | TEST | integration | Tests d'intégration avec dépendances (Testcontainers, Supertest, DB, Kafka) | Orchestrateur | Services + specs | Rapport composants, logs | ✅ Complété |
| `TEST-api-06` | TEST | api | Tests API REST/GraphQL/gRPC (validation endpoints, schémas, contrats) | Orchestrateur | Endpoint + spec | Rapport tests API, temps | ✅ Complété |
| `TEST-property-07` | TEST | property | Tests property-based et fuzzing (fast-check, hypothesis, cargo-fuzz) | Orchestrateur | Propriétés invariantes | Rapport itérations, seeds | ✅ Complété |
| `TEST-mutation-08` | TEST | mutation | Tests de mutation (Stryker, mutmut) — qualité réelle des tests | Orchestrateur | Projet à analyser | Score mutation, mutants survivants | ✅ Complété |
| `TEST-visual-09` | TEST | visual | Tests visuels/régression UI (Percy, Chromatic, Playwright screenshot) | Orchestrateur | Pages + viewports | Rapport différences visuelles | ✅ Complété |
| `TEST-a11y-10` | TEST | a11y | Tests accessibilité (axe-core, Lighthouse, Pa11y) conformité WCAG | Orchestrateur | Pages à auditer | Rapport accessibilité, recommandations | ✅ Complété |
| `TEST-security-12` | TEST | security | Tests sécurité applicative (OWASP ZAP, scanners dépendances) | Orchestrateur | URL cible | Rapport vulnérabilités SARIF | ✅ Complété |
| `TEST-contract-13` | TEST | contract | Tests de contrat entre services (Pact, Spring Cloud Contract) | Orchestrateur | Contrats consumer | Rapport compatibilité, breaking changes | ✅ Complété |
| `TEST-smoke-14` | TEST | smoke | Tests smoke/sanity — validation rapide post-déploiement (< 30s) | Orchestrateur | URL déployée | Rapport binaire opérationnel/dégradé | ✅ Complété |
| `TEST-snapshot-15` | TEST | snapshot | Tests snapshot et golden files (Vitest/Jest, fichiers de référence) | Orchestrateur | Mode vérif/update | Rapport snapshots créés/modifiés | ✅ Complété |
| `TEST-flaky-16` | TEST | flaky | Détection de tests flaky (exécution répétée N=10, quarantaine) | Orchestrateur | Suites suspectes | Taux flakyness, tests en quarantaine | ✅ Complété |
| `TEST-mock-17` | TEST | mock | Mocking et virtualisation de services (MSW, WireMock, nock) | Orchestrateur | Dépendances à mocker | Mocks configurés, assertions appels | ✅ Complété |
| `TEST-data-18` | TEST | data | Génération données de test synthétiques (Faker, factory_boy, fixtures) | Orchestrateur | Entités + format | Jeux de données, rapport variété | ✅ Complété |
| `TEST-parallel-19` | TEST | parallel | Exécution parallèle/distribuée (sharding, multi-workers, CI multi-job) | Orchestrateur | Config shards | Rapport consolidé, gain temps | ✅ Complété |
| `TEST-validate-20` | TEST | validate | Validation qualité des tests (linting, coverage gate, conventions) | Orchestrateur | Projet à auditer | Score qualité, recommandations | ✅ Complété |
| **FORMAT — FORMATAGE** | | | | | | | |
| `FORMAT-json-01` | FORMAT | json | Valider et formater des fichiers JSON (syntaxe, indentation, tri des clés) | Orchestrateur | Fichiers JSON | Fichiers formatés, rapport | ✅ Complété |
| `FORMAT-yaml-02` | FORMAT | yaml | Valider et formater des fichiers YAML (syntaxe, indentation, conversion JSON↔YAML) | Orchestrateur | Fichiers YAML | Fichiers formatés, rapport | ✅ Complété |
| `FORMAT-prettier-03` | FORMAT | prettier | Formater le code avec Prettier (JS, TS, CSS, JSON, MD, YAML) | Orchestrateur | Fichiers à formater | Code formaté, rapport | ✅ Complété |
| `FORMAT-xml-04` | FORMAT | xml | Valider et formater des fichiers XML (syntaxe, XSD/DTD, indentation) | Orchestrateur | Fichiers XML | Fichiers formatés, rapport | ✅ Complété |
| `FORMAT-toml-05` | FORMAT | toml | Valider et formater des fichiers TOML (Cargo.toml, pyproject.toml) | Orchestrateur | Fichiers TOML | Fichiers formatés, rapport | ✅ Complété |
| `FORMAT-csv-06` | FORMAT | csv | Valider, formater et nettoyer des fichiers CSV (délimiteurs, en-têtes) | Orchestrateur | Fichiers CSV | CSV nettoyé, rapport | ✅ Complété |
| `FORMAT-markdown-07` | FORMAT | markdown | Valider et formater du Markdown (liens, tableaux, structure, TOC) | Orchestrateur | Fichiers .md | Markdown formaté, rapport | ✅ Complété |
| `FORMAT-html-08` | FORMAT | html | Valider et formater du HTML (syntaxe, accessibilité, HTML5) | Orchestrateur | Fichiers HTML | HTML formaté, rapport | ✅ Complété |
| `FORMAT-sql-09` | FORMAT | sql | Formater et valider des requêtes SQL (mots-clés, indentation, anti-patterns) | Orchestrateur | Fichiers .sql | SQL formaté, rapport | ✅ Complété |
| `FORMAT-dotenv-10` | FORMAT | dotenv | Valider et formater des fichiers .env (clés dupliquées, synchro .env.example) | Orchestrateur | Fichiers .env | .env formaté, rapport | ✅ Complété |
| `FORMAT-ini-11` | FORMAT | ini | Valider et formater des fichiers INI/CFG (sections, clés-valeurs) | Orchestrateur | Fichiers .ini/.cfg | INI formaté, rapport | ✅ Complété |
| **PACKAGE — GESTION DE PAQUETS** | | | | | | | |
| `PACKAGE-npm-01` | PACKAGE | npm | Gérer les packages npm : install, update, audit, outdated | Orchestrateur | package.json | Paquets gérés, rapport | ✅ Complété |
| `PACKAGE-pip-02` | PACKAGE | pip | Gérer les packages pip : install, update, audit, list | Orchestrateur | requirements.txt/pyproject.toml | Paquets gérés, rapport | ✅ Complété |
| `PACKAGE-cargo-03` | PACKAGE | cargo | Gérer les crates Rust : add, update, outdated, audit | Orchestrateur | Cargo.toml | Crates gérés, rapport | ✅ Complété |
| `PACKAGE-go-04` | PACKAGE | go | Gérer les modules Go : go get, go mod tidy, go mod verify | Orchestrateur | go.mod | Modules gérés, rapport | ✅ Complété |
| `PACKAGE-nuget-05` | PACKAGE | nuget | Gérer les packages NuGet (.NET) : add, remove, restore, outdated | Orchestrateur | .csproj/.fsproj | Packages gérés, rapport | ✅ Complété |
| `PACKAGE-rubygems-06` | PACKAGE | rubygems | Gérer les gems Ruby : install, list, outdated, cleanup, Bundler | Orchestrateur | Gemfile | Gems gérés, rapport | ✅ Complété |
| `PACKAGE-composer-07` | PACKAGE | composer | Gérer les packages PHP : require, remove, install, update, outdated | Orchestrateur | composer.json | Dépendances gérées, rapport | ✅ Complété |
| `PACKAGE-yarn-08` | PACKAGE | yarn | Gérer les packages JS/TS avec Yarn : add, remove, upgrade, audit, dedupe | Orchestrateur | package.json | Packages gérés, rapport | ✅ Complété |
| `PACKAGE-brew-09` | PACKAGE | brew | Gérer les paquets Homebrew : install, uninstall, update, upgrade, cleanup | Orchestrateur | Formule à installer | Paquets système gérés, rapport | ✅ Complété |
| `PACKAGE-maven-10` | PACKAGE | maven | Gérer les dépendances Maven (Java) : dependency:tree, resolve, analyze | Orchestrateur | pom.xml | Dépendances gérées, rapport | ✅ Complété |
| **PERF — PERFORMANCE** | | | | | | | |
| `PERF-load-01` | PERF | load | Tests de charge et stress (k6, autocannon, Locust) — RPS, latences, seuils | Orchestrateur | Endpoint + charge | Métriques p50/p95/p99, graphiques | ✅ Complété |
| `PERF-audit-02` | PERF | audit | Audit de performance web (Lighthouse, PageSpeed, Core Web Vitals) | Orchestrateur | URL à auditer | Score LCP/INP/CLS, recommandations | ✅ Complété |
| `PERF-profile-03` | PERF | profile | Profilage CPU et mémoire (flamegraph, heap snapshot, chronologie allocation) | Orchestrateur | Process/application | Flamegraph SVG, hotspots mémoire | ✅ Complété |
| `PERF-bundle-04` | PERF | bundle | Analyse de bundle JS/CSS (taille, arbre dépendances, composition, duplicates) | Orchestrateur | Build output | Rapport composition, doublons, taille | ✅ Complété |
| `PERF-sql-05` | PERF | sql | Optimisation de requêtes SQL (EXPLAIN ANALYZE, index, plan exécution) | Orchestrateur | Requête SQL lente | Plan optimisé, index suggérés | ✅ Complété |
| `PERF-bench-06` | PERF | bench | Microbenchmarking (hyperfine, benchmark.js, criterion) — comparaison avant/après | Orchestrateur | Code à benchmarker | Temps d'exécution, écart-type, ratio | ✅ Complété |
| `PERF-network-07` | PERF | network | Analyse réseau applicatif (waterfall chargement, latences, connexions) | Orchestrateur | URL à analyser | Waterfall, temps par ressource, goulots | ✅ Complété |
| `PERF-compare-08` | PERF | compare | Comparaison performance avant/après (détection régression et amélioration) | Orchestrateur | Baseline + nouveau test | Delta, régressions, améliorations | ✅ Complété |
| **OPT — OPTIMISATION** | | | | | | | |
| `OPT-image-01` | OPT | image | Optimiser les images (compression, conversion WebP/AVIF, srcset responsive) | Orchestrateur | Images à optimiser | Images optimisées, rapport gain | ✅ Complété |
| `OPT-font-02` | OPT | font | Optimiser les polices (subset, WOFF2, preload, swap, self-hosting) | Orchestrateur | Polices à optimiser | Polices optimisées, déclarations @font-face | ✅ Complété |
| `OPT-css-03` | OPT | css | Optimiser le CSS (purge inutilisé, minification, critical CSS inline) | Orchestrateur | Feuilles CSS | CSS optimisé, critical CSS extrait | ✅ Complété |
| `OPT-js-04` | OPT | js | Optimiser le JavaScript (tree-shake, code-split, dead code elimination) | Orchestrateur | Bundle JS | Bundle optimisé, candidats split | ✅ Complété |
| `OPT-dep-05` | OPT | dep | Optimiser les dépendances (prune unused, dedupe, alternatives légères) | Orchestrateur | package.json | Dépendances optimisées, gain potentiel | ✅ Complété |
| `OPT-html-06` | OPT | html | Optimiser le HTML (minification, preconnect, preload, async/defer) | Orchestrateur | Pages HTML | HTML optimisé, hints de connectivité | ✅ Complété |
| `OPT-build-07` | OPT | build | Optimiser le build (caching, parallélisation, outils rapides esbuild/swc) | Orchestrateur | Config build | Build accéléré, durée gagnée | ✅ Complété |
| `OPT-media-08` | OPT | media | Optimiser les médias (vidéos, animations, lazy-loading, responsive) | Orchestrateur | Médias à optimiser | Médias optimisés, gain par format | ✅ Complété |
| **LOOP — BOUCLES DE TRAVAIL** | | | | | | | |
| `LOOP-creator-01` | LOOP | creator | Créer une nouvelle boucle de travail (étapes, déclencheurs, sources) | Orchestrateur | Spécifications | Définition de boucle (.json) | ✅ Complété |
| `LOOP-editor-02` | LOOP | editor | Modifier une boucle existante (ajout/suppression de tâches, paramètres) | Orchestrateur | ID boucle + modifs | Définition mise à jour | ✅ Complété |
| `LOOP-executor-03` | LOOP | executor | Lancer immédiatement une boucle en mode "one-shot" | Orchestrateur | ID boucle | Rapport exécution, logs | ✅ Complété |
| `LOOP-scheduler-04` | LOOP | scheduler | Configurer un planning dynamique pour les boucles | Orchestrateur | ID boucle + planning | Planning configuré, conflits gérés | ✅ Complété |
| `LOOP-input-05` | LOOP | input | Intégrer des entrées utilisateur ou dynamiques dans une boucle | Orchestrateur | Flux d'entrées | Données injectées, rapport | ✅ Complété |
| `LOOP-validator-06` | LOOP | validator | Vérifier la logique d'une boucle avant exécution | Orchestrateur | Définition boucle | Rapport validation, erreurs | ✅ Complété |
| `LOOP-document-07` | LOOP | document | Générer documentation ou diagramme (Mermaid/ASCII) du flux | Orchestrateur | Définition boucle | Fichier MD/PNG/JSON | ✅ Complété |
| `LOOP-plot-08` | LOOP | plot | Visualiser les métriques d'une boucle (ASCII/HTML) | Orchestrateur | Métriques boucle | Graphiques, rapports visuels | ✅ Complété |
| `LOOP-diagnoser-09` | LOOP | diagnoser | Diagnostiquer une boucle bloquée ou instable | Orchestrateur | ID boucle active | Rapport diagnostic, remédiation | ✅ Complété |
| `LOOP-secure-10` | LOOP | secure | Appliquer des vérifications de sécurité (RBAC, secrets) | Orchestrateur | Définition boucle | Rapport sécurité, blocage si vuln | ✅ Complété |
| `LOOP-optimize-11` | LOOP | optimize | Améliorer les performances d'une boucle sur demande | Orchestrateur | ID boucle | Rapport optimisation, gain estimé | ✅ Complété |
| `LOOP-test-12` | LOOP | test | Exécuter des tests unitaires ou de charge sur une boucle | Orchestrateur | ID boucle + tests | Rapport tests, couverture | ✅ Complété |
| `LOOP-merge-13` | LOOP | merge | Fusionner plusieurs boucles en une seule | Orchestrateur | IDs boucles | Boucle fusionnée, rapport | ✅ Complété |
| `LOOP-split-14` | LOOP | split | Découper une boucle complexe en sous-boucles parallèles | Orchestrateur | ID boucle | Sous-boucles créées, rapport | ✅ Complété |
| `LOOP-debug-15` | LOOP | debug | Exécuter une boucle en mode debug (pas à pas) | Orchestrateur | ID boucle | Trace détaillée, logs étendus | ✅ Complété |
| `LOOP-api-16` | LOOP | api | Exposer une API pour gérer les boucles | Orchestrateur | Requêtes API | Réponses JSON, statut webhooks | ✅ Complété |
| `LOOP-state-17` | LOOP | state | Suivre l'état détaillé d'une boucle (historique persistant) | Orchestrateur | ID boucle | Historique transitions, état courant | ✅ Complété |
| `LOOP-user-18` | LOOP | user | Gérer les interactions humaines (stop, pause, resume) | Orchestrateur | Commandes UI/CLI | Action effectuée, feedback | ✅ Complété |
| `LOOP-helena-19` | LOOP | helena | Interface hybride (CLI/UI/API) pour la gestion de boucles | Orchestrateur | Commandes multi-canal | État synchronisé, rapport | ✅ Complété |
| `LOOP-context-20` | LOOP | context | Adapter une boucle au contexte du projet (stack tech) | Orchestrateur | Environnement projet | Config auto-adaptée, rapport | ✅ Complété |
| `LOOP-pattern-21` | LOOP | pattern | Appliquer des patterns standardisés (ETL, CQRS) | Orchestrateur | ID boucle + pattern | Structure générée, conformité | ✅ Complété |
| **SIGNAL — COMMUNICATION & SIGNAUX** | | | | | | | |
| `SIGNAL-emitter-01` | SIGNAL | emitter | Émettre un signal spécifique vers une cible | Orchestrateur | Destinataire + Type | Signal émis, ID unique | ✅ Complété |
| `SIGNAL-broadcaster-02` | SIGNAL | broadcaster | Diffuser un signal à tout le système | Orchestrateur | Type signal | Diffusion effectuée, rapport | ✅ Complété |
| `SIGNAL-acknowledger-03` | SIGNAL | acknowledger | Envoyer un accusé de réception (ACK) | Orchestrateur | ID signal source | ACK envoyé, statut | ✅ Complété |
| `SIGNAL-payload-04` | SIGNAL | payload | Structurer les données complexes du signal | Orchestrateur | Données brutes | Payload validé et sérialisé | ✅ Complété |
| `SIGNAL-canceller-05` | SIGNAL | canceller | Annuler ou révoquer un signal émis | Orchestrateur | ID signal | Signal révoqué, notification | ✅ Complété |
| `SIGNAL-priority-06` | SIGNAL | priority | Gérer la priorité des signaux en file | Orchestrateur | ID signal + Priorité | File réordonnée, rapport | ✅ Complété |
| `SIGNAL-tester-07` | SIGNAL | tester | Simuler et tester des flux de signaux | Orchestrateur | Scénario test | Métriques réactivité, rapport | ✅ Complété |
| `SIGNAL-cleaner-08` | SIGNAL | cleaner | Purger les files de signaux obsolètes | Orchestrateur | — | Files nettoyées, espace libéré | ✅ Complété |
| `SIGNAL-mapper-09` | SIGNAL | mapper | Associer signaux à des actions/scripts | Orchestrateur | Table de mapping | Mappings mis à jour, validés | ✅ Complété |
| `SIGNAL-securizer-10` | SIGNAL | securizer | Sécuriser et signer les signaux | Orchestrateur | Signal brut | Signal signé, intégrité garantie | ✅ Complété |
| **RETRO — RÉTRO-ACTIONS & FEEDBACK** | | | | | | | |
| `RETRO-interview-01` | RETRO | interview | Mener une interview structurée avec l'utilisateur | Orchestrateur | Contexte rétro | Transcription, points clés | ✅ Complété |
| `RETRO-clarifier-02` | RETRO | clarifier | Poser des questions ciblées pour lever une ambiguïté | Orchestrateur | Point ambigu | Question précise, décision | ✅ Complété |
| `RETRO-trigger-03` | RETRO | trigger | Déclencher manuellement une boucle de rétro-action | Orchestrateur | ID cible + raison | Boucle initialisée, notification | ✅ Complété |
| `RETRO-suggest-04` | RETRO | suggest | Proposer des corrections basées sur l'historique | Orchestrateur | Échec actuel | Suggestions RCA, plan action | ✅ Complété |
| `RETRO-survey-05` | RETRO | survey | Collecter le feedback utilisateur post-étape | Orchestrateur | Résultat étape | Score satisfaction, commentaires | ✅ Complété |
| `RETRO-checkpoint-06` | RETRO | checkpoint | Arrêt de validation humaine critique | Orchestrateur | Point critique | Validation explicite, log | ✅ Complété |
| `RETRO-adjust-07` | RETRO | adjust | Ajuster les instructions des agents | Orchestrateur | Feedback rétro | Instructions modifiées, version | ✅ Complété |
| `RETRO-summarizer-08` | RETRO | summarizer | Synthèse des leçons apprises (Post-mortem) | Orchestrateur | Boucle terminée | Rapport MD, plan préventif | ✅ Complété |
| **INTRO — INTROSPECTION & SANTÉ** | | | | | | | |
| `INTRO-self-01` | INTRO | self | Analyser l'état interne de l'agent courant | Assistant | — | État interne, santé | ✅ Complété |
| `INTRO-compliance-02` | INTRO | compliance | Vérifier conformité PACO et Golden Rules | Assistant | Sorties agent | Score conformité, violations | ✅ Complété |
| `INTRO-performance-03` | INTRO | performance | Analyser temps de réponse et ressources | Assistant | Flux exécution | Métriques perf, hotspots | ✅ Complété |
| `INTRO-logic-04` | INTRO | logic | Audit de la logique de décision (CoT) | Assistant | Trace logique | Audit logique, ruptures | ✅ Complété |
| `INTRO-skill-05` | INTRO | skill | Inventaire et test de santé des skills | Assistant | — | Inventaire skills, santé | ✅ Complété |
| `INTRO-signal-06` | INTRO | signal | Introspection du bus de signaux | Assistant | Files SIGNAL | État bus, anomalies | ✅ Complété |
| `INTRO-history-07` | INTRO | history | Analyse critique de l'historique des sessions | Assistant | Archives sessions | Tendances, leçons apprises | ✅ Complété |
| `INTRO-security-08` | INTRO | security | Audit de la posture de sécurité interne | Assistant | Permissions/Secrets | Score sécurité, vuln | ✅ Complété |
| `INTRO-network-09` | INTRO | network | Introspection des flux et connexions externes | Assistant | Flux réseau | Inventaire flux, sécurité | ✅ Complété |
| `INTRO-state-10` | INTRO | state | Vérifier la cohérence de l'état persistant | Assistant | État disque/mémoire | Statut cohérence, conflits | ✅ Complété |
| **DEBUG — DÉBOGAGE TECHNIQUE** | | | | | | | |
| `DEBUG-repro-01` | DEBUG | repro | Reproduction systématique de bugs et PoC | Assistant | Bug signalé | Scénario repro, PoC | ✅ Complété |
| `DEBUG-trace-02` | DEBUG | trace | Analyse de stack traces et logs d'erreurs | Assistant | Traces/Logs | Point de rupture, call stack | ✅ Complété |
| `DEBUG-inspect-03` | DEBUG | inspect | Inspection d'état des variables et mémoire | Assistant | — | Instantané état, anomalies | ✅ Complété |
| `DEBUG-fix-04` | DEBUG | fix | Proposition de correctifs ciblés et impact | Assistant | Diagnostic | Code correctif, impact | ✅ Complété |
| `DEBUG-regression-05` | DEBUG | regression | Validation de non-régression post-correctif | Assistant | Correctif | Statut tests, validation | ✅ Complété |
| `DEBUG-memory-06` | DEBUG | memory | Débogage de fuites mémoire (leaks) | Assistant | Heap dump | Rapport fuite, correctif | ✅ Complété |
| `DEBUG-concurrency-07` | DEBUG | concurrency | Débogage de race conditions et deadlocks | Assistant | Trace asynchrone | Diagnostic conflit, correctif | ✅ Complété |
| `DEBUG-network-08` | DEBUG | network | Débogage d'erreurs réseau et API | Assistant | Requêtes/Payloads | Diagnostic réseau, trace | ✅ Complété |
| `DEBUG-performance-09` | DEBUG | performance | Débogage de lenteur et timeouts | Assistant | Profiling | Hotspots, optimisation | ✅ Complété |
| `DEBUG-config-10` | DEBUG | config | Débogage de configuration et environnement | Assistant | Config/Env | Diagnostic config, correctif | ✅ Complété |
| **REFONTE — RESTRUCTURATION & MODERNISATION** | | | | | | | |
| `REFONTE-analyzer-01` | REFONTE | analyzer | Analyser structure existante pour refonte | Assistant | Codebase | Score dette, priorité | ✅ Complété |
| `REFONTE-modernizer-02` | REFONTE | modernizer | Mise à jour syntaxe et patterns standards | Assistant | Code source | Code modernisé, statut | ✅ Complété |
| `REFONTE-decoupler-03` | REFONTE | decoupler | Découplage des blocs monolithiques | Assistant | Composant | Interfaces, isolation | ✅ Complété |
| `REFONTE-renamer-04` | REFONTE | renamer | Renommage massif pour la cohérence | Assistant | Liste noms | Code renommé, cohérence | ✅ Complété |
| `REFONTE-optimizer-05` | REFONTE | optimizer | Refonte pour optimisation des performances | Assistant | Code lent | Code optimisé, métriques | ✅ Complété |
| `REFONTE-dry-06` | REFONTE | dry | Élimination de la duplication (DRY) | Assistant | Duplications | Abstractions génériques | ✅ Complété |
| `REFONTE-types-07` | REFONTE | types | Renforcement du typage (TS/Rust) | Assistant | Code peu typé | Types stricts, interfaces | ✅ Complété |
| `REFONTE-bridge-08` | REFONTE | bridge | Création de couches de compatibilité | Assistant | Transition archi | Bridge, interopérabilité | ✅ Complété |
| `REFONTE-test-gen-09` | REFONTE | test-gen | Génération de tests pour code refactoré | Assistant | Code refactoré | Tests unitaires/inté | ✅ Complété |
| `REFONTE-validator-10` | REFONTE | validator | Validation finale de la refonte | Assistant | Projet refondu | Score qualité, validation | ✅ Complété |

---

## 🛠️ Convention de Nommage

- Format : `[DOMAINE]-[ROLE]-[NN]` (ex: `SEARCH-grep-02`, `BACKUP-backup-01`)
- NN est un numéro séquentiel par domaine (de 01 à N)
- Fichier associé : `data/profiles/bots/{nom}.json`

## 🔒 Distinction Bot vs Daemon

| Critère | Bot | Daemon |
|---------|-----|--------|
| Déclencheur | Sur demande (orchestrateur) | Timer, watchdog (autonome) |
| Cycle de vie | Exécute → sortie | Tourne en continu / réveil périodique |
| `healthCheck` | Aucun | Obligatoire |
