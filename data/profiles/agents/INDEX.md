# Index des Profils - Agents

Profils destinés aux interactions directes. **3 rôles distincts** : les **AGENT** (orchestrateurs, superviseurs, domaines), les **ASSISTANT** (subagents par préfixe), et les **profils métier** exécutants.

**Hiérarchie** : `AGENT > AGENT-ORCHESTRATOR > ASSISTANT > profils [PREFIX]-*` + bots/daemons

---

## 📚 Lexique des Profils

| Profil | Domaine | Rôle | Mission Atomique | Déclencheur | Intrant | Extrant | Statut |
|--------|---------|------|------------------|-------------|---------|---------|--------|
| **AGENT — DOMAINES** | | | | | | | |
| `AGENT-ANALYSTE-01` | ANALYSTE | analyste | Lancer des analyses complètes de projet via ASSISTANT-ANALYSTE-01 | Utilisateur | Projet à analyser | Rapports d'analyse | ✅ Complété |
| `AGENT-BACKEND-02` | BACKEND | backend | Responsable Rust/Python : stratégie technique, architecture, valide via ORCHESTRATOR-BACKEND-14 | Utilisateur | Mission backend | Stratégie, validation | ✅ Complété |
| `AGENT-DOCS-03` | DOCS | documentation | Produire et maintenir la documentation technique via ORCHESTRATOR-DOCS-15 | Utilisateur | Besoin doc | Documentation livrée | ✅ Complété |
| `AGENT-ENGINEER-04` | ENGI | engineer | Analyser le code existant via ORCHESTRATOR-ENGINEER-16 | Utilisateur | Codebase | Rapports d'analyse | ✅ Complété |
| `AGENT-FRONTEND-05` | FRONTEND | frontend | Responsable CSS/Next.js/React/Vanilla/Vite : stratégie, valide via ORCHESTRATOR-FRONTEND-17 | Utilisateur | Mission frontend | Stratégie, validation | ✅ Complété |
| `AGENT-GENERAL-06` | GENERAL | général | Point d'entrée unique : distribue aux AGENT domaines spécialisés | Utilisateur | Mission globale | Distribution, validation | ✅ Complété |
| `AGENT-GRAPH-07` | GRAPH | graphique | Générer diagrammes et visualisations via ORCHESTRATOR-GRAPH-19 | Utilisateur | Description | Diagrammes produits | ✅ Complété |
| `AGENT-INTERIM-08` | INTER | intérimaire | Créer des profils sur mesure via ORCHESTRATOR-INTERIM-20 | Utilisateur | Besoin profil | Profil créé et validé | ✅ Complété |
| `AGENT-PLAN-09` | PLAN | planification | Responsable stratégie/architecture/roadmap : valide via ORCHESTRATOR-PLAN-21 | Utilisateur | Mission plan | Stratégie, roadmap | ✅ Complété |
| `AGENT-RESEARCH-10` | RESEARCH | recherche | Responsable exploration/investigation : valide via ORCHESTRATOR-RESEARCH-22 | Utilisateur | Mission recherche | Rapports, exploration | ✅ Complété |
| `AGENT-REVIEW-11` | REVIEW | revue | Responsable audits/reviews : valide via ORCHESTRATOR-REVIEW-23 | Utilisateur | Mission revue | Rapports de revue | ✅ Complété |
| `AGENT-VALIDATION-12` | VALID | validation | Valider la conformité des livrables via ORCHESTRATOR-VALIDATION-24 | Utilisateur | Livrables | Rapport validation | ✅ Complété |
| `AGENT-INTRO-37` | INTRO | introspection | Responsable santé, conformité et auto-analyse via ORCHESTRATOR-INTRO-49 | Utilisateur | Mission intro | Rapport d'audit, santé | ✅ Complété |
| `AGENT-DEBUG-38` | DEBUG | débogage | Responsable résolution bugs et incidents techniques via ORCHESTRATOR-DEBUG-50 | Utilisateur | Mission debug | Analyse, correctif validé | ✅ Complété |
| `AGENT-REFONTE-39` | REFONTE | refonte | Responsable restructuration profonde et modernisation via ORCHESTRATOR-REFONTE-51 | Utilisateur | Mission refonte | Plan de migration, code refondu | ✅ Complété |
| **AGENT — ORCHESTRATEURS** | | | | | | | |
| `AGENT-ORCHESTRATOR-ANALYSTE-13` | ORCHESTRATOR | analyse | Coordonner missions d'analyse de projet via ASSISTANT-ANALYSTE-01 | AGENT-ANALYSTE | Mission analyse | Coordination, rapport | ✅ Complété |
| `AGENT-ORCHESTRATOR-BACKEND-14` | ORCHESTRATOR | backend | Coordonner missions Rust + Python via ASSISTANT-RUST-13 et ASSISTANT-PYTHON-09 | AGENT-BACKEND | Mission backend | Coordination, rapport | ✅ Complété |
| `AGENT-ORCHESTRATOR-DOCS-15` | ORCHESTRATOR | documentation | Coordonner missions de documentation via ASSISTANT-DOCS-03 | AGENT-DOCS | Mission doc | Coordination, rapport | ✅ Complété |
| `AGENT-ORCHESTRATOR-ENGINEER-16` | ORCHESTRATOR | ingénierie | Coordonner missions d'analyse via ASSISTANT-ENGINEER-04 | AGENT-ENGINEER | Mission analyse | Coordination, rapport | ✅ Complété |
| `AGENT-ORCHESTRATOR-FRONTEND-17` | ORCHESTRATOR | frontend | Coordonner missions CSS, Next.js, React, Vanilla, Vite via 5 ASSISTANT frontend | AGENT-FRONTEND | Mission frontend | Coordination, rapport | ✅ Complété |
| `AGENT-ORCHESTRATOR-GENERAL-18` | ORCHESTRATOR | général | Coordonner la distribution aux ORCHESTRATOR spécialisés | AGENT-GENERAL | Mission globale | Coordination, rapport | ✅ Complété |
| `AGENT-ORCHESTRATOR-GRAPH-19` | ORCHESTRATOR | graphique | Coordonner missions de diagrammes via ASSISTANT-GRAPH-05 | AGENT-GRAPH | Mission graph | Coordination, rapport | ✅ Complété |
| `AGENT-ORCHESTRATOR-INTERIM-20` | ORCHESTRATOR | intérimaire | Coordonner création de profils sur mesure via ASSISTANT-INTERIM-06 | AGENT-INTERIM | Besoin profil | Coordination, rapport | ✅ Complété |
| `AGENT-ORCHESTRATOR-PLAN-21` | ORCHESTRATOR | planification | Coordonner missions de planification via ASSISTANT-PLAN-08 | AGENT-PLAN | Mission plan | Coordination, rapport | ✅ Complété |
| `AGENT-ORCHESTRATOR-RESEARCH-22` | ORCHESTRATOR | recherche | Coordonner missions de recherche via ASSISTANT-RESEARCH-11 | AGENT-RESEARCH | Mission recherche | Coordination, rapport | ✅ Complété |
| `AGENT-ORCHESTRATOR-REVIEW-23` | ORCHESTRATOR | revue | Coordonner missions de revue via ASSISTANT-REVIEWER-12 | AGENT-REVIEW | Mission revue | Coordination, rapport | ✅ Complété |
| `AGENT-ORCHESTRATOR-VALIDATION-24` | ORCHESTRATOR | validation | Coordonner missions de validation via ASSISTANT-VALIDATION-14 | AGENT-VALIDATION | Mission validation | Coordination, rapport | ✅ Complété |
| `AGENT-ORCHESTRATOR-INTRO-49` | ORCHESTRATOR | intro | Coordonner missions d'introspection technique via ASSISTANT-INTRO-17 | AGENT-INTRO | Mission intro | Coordination, rapport | ✅ Complété |
| `AGENT-ORCHESTRATOR-DEBUG-50` | ORCHESTRATOR | debug | Coordonner missions de débogage technique via ASSISTANT-DEBUG-18 | AGENT-DEBUG | Mission debug | Coordination, rapport | ✅ Complété |
| `AGENT-ORCHESTRATOR-REFONTE-51` | ORCHESTRATOR | refonte | Coordonner missions de restructuration technique via ASSISTANT-REFONTE-19 | AGENT-REFONTE | Mission refonte | Coordination, rapport | ✅ Complété |
| **AGENT — SUPERVISEURS** | | | | | | | |
| `AGENT-SUPERVISOR-ANALYSTE-25` | SUPERVISOR | analyse | Surveiller AGENT-ORCHESTRATOR-ANALYSTE-13, détecter violations PACO | Timer, watchdog | Logs orkestr. | Alertes, suspension | ✅ Complété |
| `AGENT-SUPERVISOR-BACKEND-26` | SUPERVISOR | backend | Surveiller AGENT-ORCHESTRATOR-BACKEND-14, détecter violations PACO | Timer, watchdog | Logs orkestr. | Alertes, suspension | ✅ Complété |
| `AGENT-SUPERVISOR-DOCS-27` | SUPERVISOR | documentation | Surveiller AGENT-ORCHESTRATOR-DOCS-15, détecter violations PACO | Timer, watchdog | Logs orkestr. | Alertes, suspension | ✅ Complété |
| `AGENT-SUPERVISOR-ENGINEER-28` | SUPERVISOR | ingénierie | Surveiller AGENT-ORCHESTRATOR-ENGINEER-16, détecter violations PACO | Timer, watchdog | Logs orkestr. | Alertes, suspension | ✅ Complété |
| `AGENT-SUPERVISOR-FRONTEND-29` | SUPERVISOR | frontend | Surveiller AGENT-ORCHESTRATOR-FRONTEND-17, détecter violations PACO | Timer, watchdog | Logs orkestr. | Alertes, suspension | ✅ Complété |
| `AGENT-SUPERVISOR-GENERAL-30` | SUPERVISOR | général | Point ultime : surveiller AGENT-ORCHESTRATOR-GENERAL-18 | Timer, watchdog | Logs orkestr. | Alertes, suspension globale | ✅ Complété |
| `AGENT-SUPERVISOR-GRAPH-31` | SUPERVISOR | graphique | Surveiller AGENT-ORCHESTRATOR-GRAPH-19, détecter violations PACO | Timer, watchdog | Logs orkestr. | Alertes, suspension | ✅ Complété |
| `AGENT-SUPERVISOR-INTERIM-32` | SUPERVISOR | intérimaire | Surveiller AGENT-ORCHESTRATOR-INTERIM-20, détecter violations PACO | Timer, watchdog | Logs orkestr. | Alertes, suspension | ✅ Complété |
| `AGENT-SUPERVISOR-PLAN-33` | SUPERVISOR | planification | Surveiller AGENT-ORCHESTRATOR-PLAN-21, détecter violations PACO | Timer, watchdog | Logs orkestr. | Alertes, suspension | ✅ Complété |
| `AGENT-SUPERVISOR-RESEARCH-34` | SUPERVISOR | recherche | Surveiller AGENT-ORCHESTRATOR-RESEARCH-22, détecter violations PACO | Timer, watchdog | Logs orkestr. | Alertes, suspension | ✅ Complété |
| `AGENT-SUPERVISOR-REVIEW-35` | SUPERVISOR | revue | Surveiller AGENT-ORCHESTRATOR-REVIEW-23, détecter violations PACO | Timer, watchdog | Logs orkestr. | Alertes, suspension | ✅ Complété |
| `AGENT-SUPERVISOR-VALIDATION-36` | SUPERVISOR | validation | Surveiller AGENT-ORCHESTRATOR-VALIDATION-24, détecter violations PACO | Timer, watchdog | Logs orkestr. | Alertes, suspension | ✅ Complété |
| `AGENT-SUPERVISOR-INTRO-61` | SUPERVISOR | intro | Surveiller AGENT-ORCHESTRATOR-INTRO-49, détecter violations PACO | Timer, watchdog | Logs orkestr. | Alertes, suspension | ✅ Complété |
| `AGENT-SUPERVISOR-DEBUG-62` | SUPERVISOR | debug | Surveiller AGENT-ORCHESTRATOR-DEBUG-50, détecter violations PACO | Timer, watchdog | Logs orkestr. | Alertes, suspension | ✅ Complété |
| `AGENT-SUPERVISOR-REFONTE-63` | SUPERVISOR | refonte | Surveiller AGENT-ORCHESTRATOR-REFONTE-51, détecter violations PACO | Timer, watchdog | Logs orkestr. | Alertes, suspension | ✅ Complété |
| **ASSISTANTS (SUBAGENTS PAR PRÉFIXE)** | | | | | | | |
| `ASSISTANT-ANALYSTE-01` | ANALYSTE | subagent | Sélectionner/coordonner les 10 profils ANALYSTE pour une mission AGENT | AGENT/ORCHESTRATOR | Mission analyse | Résultat structuré | ✅ Complété |
| `ASSISTANT-CSS-02` | CSS | subagent | Sélectionner/coordonner les 17 profils CSS pour une mission AGENT | AGENT/ORCHESTRATOR | Mission CSS | Résultat structuré | ✅ Complété |
| `ASSISTANT-DOCS-03` | DOCS | subagent | Sélectionner/coordonner les 6 profils DOCS pour une mission AGENT | AGENT/ORCHESTRATOR | Mission doc | Résultat structuré | ✅ Complété |
| `ASSISTANT-ENGINEER-04` | ENGI | subagent | Sélectionner/coordonner les 5 profils ENGI pour une mission AGENT | AGENT/ORCHESTRATOR | Mission analyse | Résultat structuré | ✅ Complété |
| `ASSISTANT-GRAPH-05` | GRAPH | subagent | Sélectionner/coordonner les 5 profils GRAPH pour une mission AGENT | AGENT/ORCHESTRATOR | Mission diagramme | Résultat structuré | ✅ Complété |
| `ASSISTANT-INTERIM-06` | INTER | subagent | Sélectionner/coordonner les 4 profils INTER pour une mission AGENT | AGENT/ORCHESTRATOR | Mission création | Résultat structuré | ✅ Complété |
| `ASSISTANT-NEXTJS-07` | NEXTJS | subagent | Sélectionner/coordonner les 11 profils NEXTJS pour une mission AGENT | AGENT/ORCHESTRATOR | Mission Next.js | Résultat structuré | ✅ Complété |
| `ASSISTANT-PLAN-08` | PLAN | subagent | Sélectionner/coordonner les 9 profils PLAN pour une mission AGENT | AGENT/ORCHESTRATOR | Mission plan | Résultat structuré | ✅ Complété |
| `ASSISTANT-PYTHON-09` | PYTHON | subagent | Sélectionner/coordonner les 15 profils PYTHON pour une mission AGENT | AGENT/ORCHESTRATOR | Mission Python | Résultat structuré | ✅ Complété |
| `ASSISTANT-REACT-10` | REACT | subagent | Sélectionner/coordonner les 13 profils REACT pour une mission AGENT | AGENT/ORCHESTRATOR | Mission React | Résultat structuré | ✅ Complété |
| `ASSISTANT-RESEARCH-11` | RESEARCH | subagent | Sélectionner/coordonner les 13 profils RESEARCH pour une mission AGENT | AGENT/ORCHESTRATOR | Mission recherche | Résultat structuré | ✅ Complété |
| `ASSISTANT-REVIEWER-12` | REVIEWER | subagent | Sélectionner/coordonner les 11 profils REVIEWER pour une mission AGENT | AGENT/ORCHESTRATOR | Mission revue | Résultat structuré | ✅ Complété |
| `ASSISTANT-RUST-13` | RUST | subagent | Sélectionner/coordonner les 14 profils RUST pour une mission AGENT | AGENT/ORCHESTRATOR | Mission Rust | Résultat structuré | ✅ Complété |
| `ASSISTANT-VALIDATION-14` | VALID | subagent | Sélectionner/coordonner les 5 profils VALID pour une mission AGENT | AGENT/ORCHESTRATOR | Mission validation | Résultat structuré | ✅ Complété |
| `ASSISTANT-VANILLA-15` | VANILLA | subagent | Sélectionner/coordonner les 14 profils VANILLA pour une mission AGENT | AGENT/ORCHESTRATOR | Mission vanilla | Résultat structuré | ✅ Complété |
| `ASSISTANT-VITE-16` | VITE | subagent | Sélectionner/coordonner les 10 profils VITE pour une mission AGENT | AGENT/ORCHESTRATOR | Mission Vite | Résultat structuré | ✅ Complété |
| `ASSISTANT-INTRO-17` | INTRO | subagent | Sélectionner/coordonner les 10 profils INTRO pour une mission AGENT | AGENT/ORCHESTRATOR | Mission intro | Résultat structuré | ✅ Complété |
| `ASSISTANT-DEBUG-18` | DEBUG | subagent | Sélectionner/coordonner les 10 profils DEBUG pour une mission AGENT | AGENT/ORCHESTRATOR | Mission debug | Résultat structuré | ✅ Complété |
| `ASSISTANT-REFONTE-19` | REFONTE | subagent | Sélectionner/coordonner les 10 profils REFONTE pour une mission AGENT | AGENT/ORCHESTRATOR | Mission refonte | Résultat structuré | ✅ Complété |
| **DOCS — PROFILS DE DOCUMENTATION** | | | | | | | |
| `DOCS-markdown-01` | DOCS | markdown | Rédiger documentation technique en Markdown : JSDoc, guides, rapports | ASSISTANT-DOCS | Spécifications doc | Documentation Markdown | ✅ Complété |
| `DOCS-api-02` | DOCS | api | Documenter les APIs : Swagger/OpenAPI, endpoints, schémas | ASSISTANT-DOCS | Spécifications API | Documentation API | ✅ Complété |
| `DOCS-guide-03` | DOCS | guide | Créer guides et tutoriels : installation, how-to, troubleshooting | ASSISTANT-DOCS | Besoin guide | Guide utilisateur | ✅ Complété |
| `DOCS-readme-04` | DOCS | readme | Créer et maintenir les README : structure standard, badges | ASSISTANT-DOCS | Projet à documenter | README complet | ✅ Complété |
| `DOCS-changelog-05` | DOCS | changelog | Rédiger changelogs et release notes : Keep a Changelog, semver | ASSISTANT-DOCS | Versions | Changelog, release notes | ✅ Complété |
| `DOCS-schema-06` | DOCS | schema | Documenter schémas : JSON Schema, protobuf, graphes de données | ASSISTANT-DOCS | Schémas à documenter | Documentation schémas | ✅ Complété |
| **ENGI — PROFILS D'INGÉNIERIE** | | | | | | | |
| `ENGI-retro-01` | ENGI | rétro-ingénierie | Analyser le code existant : structure, dépendances, patterns | ASSISTANT-ENGINEER | Codebase | Rapport d'analyse | ✅ Complété |
| `ENGI-code-02` | ENGI | code-quality | Analyser qualité code : complexité, duplication, dette technique | ASSISTANT-ENGINEER | Code à analyser | Rapport qualité | ✅ Complété |
| `ENGI-dep-03` | ENGI | dependances | Analyser dépendances : graphe, circularités, mises à jour, CVE | ASSISTANT-ENGINEER | Dépendances | Rapport dépendances | ✅ Complété |
| `ENGI-perf-04` | ENGI | performance | Analyser performance : profiling, bottlenecks, optimisation | ASSISTANT-ENGINEER | Application | Rapport performance | ✅ Complété |
| `ENGI-sec-05` | ENGI | sécurité | Analyser sécurité : OWASP, CVE, injections, auth, XSS, CSRF | ASSISTANT-ENGINEER | Code à auditer | Rapport sécurité | ✅ Complété |
| **GRAPH — PROFILS DE DIAGRAMMES** | | | | | | | |
| `GRAPH-mermaid-01` | GRAPH | mermaid | Générer diagrammes Mermaid : flowchart, sequence, class, gantt | ASSISTANT-GRAPH | Description textuelle | Diagrammes Mermaid | ✅ Complété |
| `GRAPH-flowchart-02` | GRAPH | flowchart | Créer flowchart et organigrammes : processus, workflows | ASSISTANT-GRAPH | Processus | Flowchart | ✅ Complété |
| `GRAPH-uml-03` | GRAPH | uml | Créer diagrammes UML : classes, séquence, cas d'utilisation | ASSISTANT-GRAPH | Spécifications | Diagrammes UML | ✅ Complété |
| `GRAPH-chart-04` | GRAPH | chart | Créer charts et visualisations : barres, lignes, camemberts | ASSISTANT-GRAPH | Données | Chart, visualisation | ✅ Complété |
| `GRAPH-arch-05` | GRAPH | architecture | Créer diagrammes d'architecture : couches, composants, flux | ASSISTANT-GRAPH | Architecture système | Diagramme d'architecture | ✅ Complété |
| **INTER — PROFILS INTÉRIMAIRES** | | | | | | | |
| `INTER-scaffold-01` | INTER | scaffold | Créer des profils sur mesure (agent, bot, daemon, assistant) | ASSISTANT-INTERIM | Besoin profil | Profil créé et validé | ✅ Complété |
| `INTER-generator-02` | INTER | generator | Générer code boilerplate et templates de projets | ASSISTANT-INTERIM | Spécifications code | Code généré | ✅ Complété |
| `INTER-bridge-03` | INTER | bridge | Créer profils relais entre groupes existants, interopérabilité | ASSISTANT-INTERIM | Lacune inter-groupe | Profil pont créé | ✅ Complété |
| `INTER-template-04` | INTER | template | Créer et maintenir templates de profils réutilisables | ASSISTANT-INTERIM | Besoin template | Template profil | ✅ Complété |
| **ANALYSTE — PROFILS D'ANALYSE DE PROJET** | | | | | | | |
| `ANALYSTE-code-01` | ANALYSTE | code | Analyser le code : qualité, complexité, patterns, dette technique, duplication | ASSISTANT-ANALYSTE | Code source | Rapport analyse code | ✅ Complété |
| `ANALYSTE-archi-02` | ANALYSTE | architecture | Analyser l'architecture : composants, couches, flux, coupling, cohésion | ASSISTANT-ANALYSTE | Projet | Rapport analyse archi | ✅ Complété |
| `ANALYSTE-data-03` | ANALYSTE | données | Analyser les données : schémas, flux, stockage, transformations, pipelines | ASSISTANT-ANALYSTE | Schémas, flux | Rapport analyse données | ✅ Complété |
| `ANALYSTE-perf-04` | ANALYSTE | performance | Analyser la performance : métriques, profiling, bottlenecks, Web Vitals | ASSISTANT-ANALYSTE | Application | Rapport analyse perf | ✅ Complété |
| `ANALYSTE-secu-05` | ANALYSTE | sécurité | Analyser la sécurité : OWASP, CVE, auth, injections, secrets, config | ASSISTANT-ANALYSTE | Code, config | Rapport analyse secu | ✅ Complété |
| `ANALYSTE-deps-06` | ANALYSTE | dépendances | Analyser les dépendances : graphe, versions, licences, CVE, conflits | ASSISTANT-ANALYSTE | Dépendances | Rapport analyse deps | ✅ Complété |
| `ANALYSTE-tests-07` | ANALYSTE | tests | Analyser les tests : couverture, qualité, stratégie, gaps, fixtures | ASSISTANT-ANALYSTE | Tests | Rapport analyse tests | ✅ Complété |
| `ANALYSTE-ux-08` | ANALYSTE | ux | Analyser l'UX/UI : accessibilité WCAG, responsive, SEO, design system | ASSISTANT-ANALYSTE | Interface | Rapport analyse UX | ✅ Complété |
| `ANALYSTE-doc-09` | ANALYSTE | documentation | Analyser la documentation : complétude, fraîcheur, qualité, coverage | ASSISTANT-ANALYSTE | Documentation | Rapport analyse doc | ✅ Complété |
| `ANALYSTE-ci-10` | ANALYSTE | ci/cd | Analyser le CI/CD : pipelines, builds, déploiement, qualité gates | ASSISTANT-ANALYSTE | CI/CD | Rapport analyse CI | ✅ Complété |
| **VALID — PROFILS DE VALIDATION** | | | | | | | |
| `VALID-qa-01` | VALID | qa | Valider conformité globale : intégration, conventions, non-régression | ASSISTANT-VALIDATION | Livrables | Rapport QA, label Validé | ✅ Complété |
| `VALID-audit-02` | VALID | audit | Auditer le code : revue systématique, bonnes pratiques, standards | ASSISTANT-VALIDATION | Code à auditer | Rapport audit | ✅ Complété |
| `VALID-convention-03` | VALID | convention | Vérifier conventions : nommage, structure, style, formatage | ASSISTANT-VALIDATION | Code/fichiers | Rapport conventions | ✅ Complété |
| `VALID-integration-04` | VALID | integration | Valider intégration : API, interfaces, flux de données | ASSISTANT-VALIDATION | Composants | Rapport intégration | ✅ Complété |
| `VALID-regression-05` | VALID | regression | Valider non-régression : stratégie, exécution, analyse | ASSISTANT-VALIDATION | Tests | Rapport régression | ✅ Complété |
| **RECHERCHE & EXPLORATION** | | | | | | | |
| `RESEARCH-class-01` | RESEARCH | class-expert | Rechercher les classes, interfaces, types et structures avec relations | ASSISTANT-RESEARCH | Requête de classe | Index des types | ✅ Complété |
| `RESEARCH-code-02` | RESEARCH | code-expert | Analyser du code open-source et des bibliothèques existantes | ASSISTANT-RESEARCH | URL ou nom lib | Rapport d'analyse | ✅ Complété |
| `RESEARCH-config-03` | RESEARCH | config-expert | Rechercher et analyser les fichiers de configuration | ASSISTANT-RESEARCH | Requête config | Index des configs | ✅ Complété |
| `RESEARCH-dep-04` | RESEARCH | dep-expert | Analyser dépendances : graphe, circularités, inutilisés | ASSISTANT-RESEARCH | Requête dépendances | Graphe dépendances | ✅ Complété |
| `RESEARCH-dir-05` | RESEARCH | dir-expert | Analyser structure des dossiers : arborescence, anomalies | ASSISTANT-RESEARCH | Dossier à analyser | Cartographie dossiers | ✅ Complété |
| `RESEARCH-doc-06` | RESEARCH | doc-expert | Rechercher et indexer la documentation : commentaires, .md | ASSISTANT-RESEARCH | Requête doc | Index documentation | ✅ Complété |
| `RESEARCH-file-07` | RESEARCH | file-expert | Rechercher et indexer des fichiers par nom, extension, contenu | ASSISTANT-RESEARCH | Requête fichier | Index fichiers | ✅ Complété |
| `RESEARCH-func-08` | RESEARCH | func-expert | Rechercher fonctions : signatures, appelants, call graph | ASSISTANT-RESEARCH | Requête fonction | Index fonctions | ✅ Complété |
| `RESEARCH-pisteur-09` | RESEARCH | pisteur | Cartographier l'arborescence complète du projet | ASSISTANT-RESEARCH | Dossier racine | Rapport arborescence | ✅ Complété |
| `RESEARCH-pattern-10` | RESEARCH | pattern-expert | Rechercher patterns : motifs, anti-patterns, conventions | ASSISTANT-RESEARCH | Pattern | Rapport patterns | ✅ Complété |
| `RESEARCH-test-11` | RESEARCH | test-expert | Rechercher et analyser les tests : couverture, frameworks | ASSISTANT-RESEARCH | Requête tests | Rapport couverture | ✅ Complété |
| `RESEARCH-web-12` | RESEARCH | web-expert | Rechercher informations sur le web, documentation, forums | ASSISTANT-RESEARCH | Requête recherche | Rapport recherche | ✅ Complété |
| `RESEARCH-workflow-13` | RESEARCH | workflow-expert | Rechercher workflows : CI/CD, processus agents, tâches | ASSISTANT-RESEARCH | Requête workflow | Cartographie workflows | ✅ Complété |
| **PLANIFICATION** | | | | | | | |
| `PLAN-architecture-01` | PLAN | architect | Définir schémas, flux de données, choix technologiques | ASSISTANT-PLAN | Rapport stratégie | Plan d'architecture | ✅ Complété |
| `PLAN-dependency-02` | PLAN | analyst | Analyser et cartographier les dépendances entre composants | ASSISTANT-PLAN | Architecture, tâches | Carte dépendances | ✅ Complété |
| `PLAN-quality-03` | PLAN | qa-planner | Planifier stratégie qualité : tests, métriques, critères | ASSISTANT-PLAN | Architecture, specs | Plan qualité | ✅ Complété |
| `PLAN-resource-04` | PLAN | resource-planner | Estimer et allouer les ressources : effort, temps, compétences | ASSISTANT-PLAN | Tâches, architecture | Plan ressources | ✅ Complété |
| `PLAN-risk-05` | PLAN | risk-analyst | Analyser risques : identification, évaluation, mitigation | ASSISTANT-PLAN | Plans, dépendances | Analyse risques | ✅ Complété |
| `PLAN-roadmap-06` | PLAN | roadmap-planner | Créer roadmaps : jalons, phases, livrables, timeline | ASSISTANT-PLAN | Stratégie, architecture | Roadmap | ✅ Complété |
| `PLAN-spec-07` | PLAN | spec-writer | Rédiger spécifications fonctionnelles et techniques | ASSISTANT-PLAN | Stratégie, architecture | Spécifications | ✅ Complété |
| `PLAN-strategy-08` | PLAN | strategist | Définir la stratégie globale à partir d'un besoin | ASSISTANT-PLAN | Fiche de besoin | Rapport stratégie | ✅ Complété |
| `PLAN-task-09` | PLAN | task-manager | Découper en tâches atomiques, définir priorités | ASSISTANT-PLAN | Rapport architecture | Tâches, priorités | ✅ Complété |
| **DÉVELOPPEMENT** | | | | | | | |
| `CSS-a11y-01` à `CSS-typography-17` | CSS | css | 17 profils CSS : a11y, animations, cascade, colors, container, custom, filter, flex, grid, layout, nesting, pseudo, responsive, scroll, theming, transform, typography | ASSISTANT-CSS | Spécifications CSS | Code CSS | ✅ Complété |
| `NEXTJS-api-01` à `NEXTJS-test-11` | NEXTJS | nextjs | 11 profils Next.js : api, auth, data, deploy, form, image, middleware, perf, routing, seo, test | ASSISTANT-NEXTJS | Spécifications Next.js | Code Next.js | ✅ Complété |
| `PYTHON-async-01` à `PYTHON-web-15` | PYTHON | python | 15 profils Python : async, cli, data, db, debug, helper, net, oop, package, regex, sec, serial, type, unittest, web | ASSISTANT-PYTHON | Spécifications Python | Code Python | ✅ Complété |
| `REACT-a11y-01` à `REACT-testing-13` | REACT | react | 13 profils React : a11y, animation, components, context, data, error, forms, hooks, perf, portal, router, styling, testing | ASSISTANT-REACT | Spécifications React | Code React | ✅ Complété |
| `RUST-async-01` à `RUST-web-14` | RUST | rust | 14 profils Rust : async, cli, concurrency, data, embedded, error, ffi, macro, net, ownership, serde, test, wasm, web | ASSISTANT-RUST | Spécifications Rust | Code Rust | ✅ Complété |
| `VANILLA-api-01` à `VANILLA-utils-14` | VANILLA | vanilla | 14 profils Vanilla : a11y, api, build, components, css, dom, forms, js, performance, router, seo, state, test, utils | ASSISTANT-VANILLA | Besoins vanilla | HTML/CSS/JS | ✅ Complété |
| `VITE-api-01` à `VITE-typescript-10` | VITE | vite | 10 profils Vite : api, build, dev, env, lib, optimize, plugin, ssr, test, typescript | ASSISTANT-VITE | Configuration Vite | Config Vite | ✅ Complété |
| **REVUE & AUDIT** | | | | | | | |
| `REVIEWER-code-01` à `REVIEWER-workflow-main-11` | REVIEWER | auditeur | 11 profils Reviewer : code, convention, css, database, doc, implementation, integration, logic, protocol, workflow-alt, workflow-main | ASSISTANT-REVIEWER | Code à reviewer | Rapports de revue | ✅ Complété |

---

## 🛠️ Convention de Nommage

- **AGENT** : `AGENT-{ROLE}-{DOMAINE}-{NN}` (ex: `AGENT-ORCHESTRATOR-FRONTEND-17`, `AGENT-SUPERVISOR-GENERAL-30`)
- **ASSISTANT** : `ASSISTANT-{PREFIX}-{NN}` (ex: `ASSISTANT-RUST-13`, `ASSISTANT-GRAPH-05`)
- **Profils métier** : `{PREFIX}-{NAME}-{NN}` (ex: `CSS-grid-09`, `DOCS-readme-04`, `ENGI-retro-01`)
- NN est un numéro séquentiel par préfixe, ordre alphabétique du nom complet
- Fichier associé : `data/profiles/agents/{nom}.json`

## 🧠 Hiérarchie d'Exécution

```
Utilisateur → AGENT-GENERAL-06
                   ↓
       AGENT domaines spécialisés
  (ANALYSTE, BACKEND, DOCS, ENGINEER,
   FRONTEND, GRAPH, INTERIM, PLAN,
   RESEARCH, REVIEW, VALIDATION)
                   ↓
             AGENT-ORCHESTRATOR-{DOMAINE}
              (coordonne l'exécution)
                   ↓
             ASSISTANT-{PREFIX}
              (sélectionne le bon profil)
                   ↓
            Profil {PREFIX}-{NAME}-{NN}
              (exécute la mission atomique)
                   ↓
            Bots (FILE, GIT, SCRIPT, etc.)
            Daemons (WATCH, DAEMON, MAINT)
                   ↓
             Résultat → ORCHESTRATOR → AGENT domaine → Utilisateur
```

Chaque AGENT domaine a son ORCHESTRATOR dédié, surveillé par son SUPERVISOR.
