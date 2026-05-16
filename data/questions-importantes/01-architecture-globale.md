# Architecture Globale

Questions sur le cadre général de la banque de profils agents.

---

## Domaines d'expertise — Réponse
| Domaine | Outils/Compétences Clés | Dossiers Associés |
|---------|------------------------|-------------------|
| Gestion de projet | Git, scripts de sync | /, Agent-docs/ |
| Développement | JS vanilla, Python, TDD, linters | composants/, utils/ |
| Rétro-ingénierie | Parsing, analyse statique, context7 | rapports/, scripts/ |
| Documentation | Markdown, Mermaid, JSON | rapports/, agent_configs/ |
| Automatisation | Scripts Python/JS, logs | scripts/, logs/ |
| Interface (optionnel) | HTML/CSS/JS, Mermaid.js | ui/, canvas/ |

## Opérations atomiques — Réponse (transverses)
| Opération | Description | Exemple Concret | Outils/Commandes |
|-----------|-------------|-----------------|------------------|
| Créer un dossier | Initialiser un dossier selon la hiérarchie définie | `mkdir Agent-docs/` | mkdir, os.makedirs |
| Créer un fichier | Générer un fichier vide avec un nom conforme aux conventions | `touch Agent-docs/agent_instructions.md` | touch, echo > |
| Vérifier la structure | Lister les dossiers/fichiers pour valider la hiérarchie | `tree Agent-docs/` | tree, ls -R |
| Synchroniser un dossier | Copier un dossier source vers une cible | `rsync -av source/ dest/` | rsync, shutil |
| Valider les conventions de nommage | Vérifier qu'un nom respecte les règles (ex: snake_case) | `re.match(r'^[a-z0-9_]+$', name)` | Regex, script custom |
| Supprimer un fichier/dossier orphelin | Nettoyer les fichiers non référencés ou inutiles | `rm old_temp.md` | rm, rmdir |

## Cycle de vie d'une tâche — Réponse

| # | Phase | Description | Critère de complétude |
|---|-------|-------------|----------------------|
| 1 | **Spécification** | Critères d'acceptation, priorité, dépendances identifiés | Fiche de tâche rédigée dans `rapports/tâches/` |
| 2 | **Conception** | Ossature définie sans implémentation (fichiers vides, signatures) | Fichiers vides créés avec commentaires d'ossature |
| 3 | **Tests (TDD)** | Tests écrits pour l'ossature, avant le code — doivent échouer (rouge) | Tests unitaires complétés, `npm test` échoue |
| 4 | **Implémentation** | Code minimal écrit pour faire passer les tests (vert) | `npm test` passe, linter OK |
| 5 | **Vérification** | Relecture manuelle + scripts auto (linter, anti-patterns) | Rapport de relecture dans `rapports/verifications/` |
| 6 | **Documentation** | Code commenté, rapport d'implémentation, mise à jour des conventions | `rapports/implementations/`, conventions à jour |
| 7 | **Intégration** | Fichiers placés au bon endroit, tests globaux passent, sync sandbox | `npm test` tout vert, structure validée |
| 8 | **Auto-Amélioration** | Analyse post-tâche, mise à jour base de connaissances, suggestions | Rapport de retour dans `rapports/retours/` |
| 9 | **Archivage** | Tâche marquée terminée, commit Git, nettoyage fichiers temporaires | Fiche déplacée dans `ARCHIVE/`, commit fait |

**Règles du cycle :**
- **TDD obligatoire** : aucun code avant les tests (phase 3 → 4)
- **Vérification systématique** : relecture + scripts automatiques
- **Documentation agent** : chaque phase produit un livrable exploitable par d'autres agents
- **Auto-amélioration intégrée** : phase 8 cruciale pour l'amélioration continue

## Hiérarchie et orchestration — Réponse

Deux niveaux distincts :

### 1. Niveau Stratégique : Orchestrateur Principal
- **Rôle** : décide quel agent travaille sur quoi, dans quel ordre, gère les dépendances, alloue les ressources, supervise les conflits
- **Nom** : Agent-Maître (Orchestrateur)
- **Emplacement** : `Agent-docs/orchestrateur/`
- **Fichiers clés** :
  - `config.yaml` : règles de priorité, dépendances entre agents, chemins des dossiers
  - `tâches_en_cours.json` : état des tâches (agent, statut, fichiers)
  - `logs/orchestrateur_<date>.log` : journal des décisions
- **Opérations** : analyser une tâche, assigner à un agent, vérifier les dépendances, lancer un agent, résoudre un conflit, mettre à jour l'état
- **Critères de décision** : priorité (config), spécialisation (agent correspondant), disponibilité (pas déjà occupé)

### 2. Niveau Tactique : Agents Spécialisés
- **Rôle** : exécuter des tâches atomiques dans leur domaine uniquement
- **Communication** : fichiers de statut (`statut.json` → disponible, tâche_actuelle) + rapports Markdown
- **Auto-amélioration** : scripts d'auto-correction dédiés

## Qualité et validation — Réponse

3 niveaux de contrôle, aucun validateur ne modifie les fichiers (rapports uniquement).

### Niveau 1 : Auto-Vérification (par l'agent lui-même)
- **Quand** : à la fin de chaque phase du cycle de vie
- **Action** : l'agent exécute ses scripts (linter, tests, anti-patterns), génère un rapport dans `rapports/auto-verif/agent_{nom}/{tâche}.md`
- **Si OK** : passe à la phase suivante ou notifie l'Orchestrateur
- **Si échec** : corrige via scripts d'auto-amélioration ou notifie l'Orchestrateur avec rapport de blocage

### Niveau 2 : Revue par les Pairs (Cross-Agent Review)
- **Qui** : un agent spécialisé dans le même domaine, choisi par l'Orchestrateur (disponibilité + spécialisation + expérience)
- **Toujours 1 réviseur par tâche**
- **Processus** : lit la fiche de tâche, le code, le rapport d'auto-vérification → vérifie conformité, couverture, intégration, documentation → ✅ validé ou ❌ rejeté avec rapport de revue
- **Si rejeté** : l'agent auteur corrige et relance Niveau 1

### Niveau 3 : Validation Finale (Agent-Validateur / Agent-QA)
- **Qui** : agent dédié `agents/validateur/`, spécialisé dans la qualité (pas de domaine technique), ne modifie jamais le code
- **Accès** à tous les dossiers
- **Vérifie** : intégration, conformité globale, documentation, régressions
- **Outils** : `scripts/validate_all.py`, `checklist.md`
- **Livrable** : rapport de validation finale dans `rapports/validations/{tâche}.md`
- **Archivage** : si ✅ VALIDÉ, marquage terminé + commit Git ; si ❌ REJETÉ, retour à l'agent auteur

### Règles transverses
- Aucune modification directe des fichiers par les validateurs (seulement rapports/retours)
- Automatisation maximale (scripts de vérification)
- Traçabilité totale (logs, rapports, historique)
- Intégration avec l'Orchestrateur (Agent-Maître)

## Gestion des erreurs et échecs — Réponse

### Détection
- **Par l'agent lui-même** : sortie non-nulle d'un script, test qui échoue
- **Par l'Orchestrateur** : fichier de statut non mis à jour, timeout (30 min sans mise à jour)

### Processus d'échec
| # | Étape | Action | Responsable | Livrable |
|---|-------|--------|-------------|----------|
| 1 | **1ère tentative** | L'agent relance automatiquement la tâche (1x) | Agent | Log dans `agents/{nom}/logs/échecs_{tâche}.log` |
| 2 | **2ème échec** | L'agent notifie l'Orchestrateur avec rapport d'erreur | Agent | `rapports/échecs/{tâche}_{agent}.md` (cause, logs, suggestions) |
| 3 | **Réassignment** | L'Orchestrateur réassigne la tâche à un autre agent du même domaine | Orchestrateur | Mise à jour `tâches_en_cours.json` → `"statut": "réassigné"` |
| 4 | **3ème échec** | Escalade humaine via notification | Orchestrateur | `rapports/à_traiter_manuellement/{tâche}.md` |

### Règles
- **2 tentatives par agent** (1 relance + 1 réassignment)
- **3 échecs totaux** → escalade humaine
- Tâches **critiques** escaladent après 1 échec, **mineures** après 3
- Tous les échecs journalisés dans `agents/{nom}/logs/` et `rapports/échecs/`

### Outils
- `scripts/detect_timeout.py` — détection agents bloqués
- `agents/{nom}/scripts/handle_failure.py` — relances et rapports
- `orchestrateur/scripts/reassign_task.py` — réassignment
- `orchestrateur/scripts/escalate_to_human.py` — alerte humaine

## Sécurité et permissions — Réponse

### Niveaux d'accès par profil
| Profil | Accès | Restrictions |
|--------|-------|-------------|
| **Agent-Maître** | Lecture/écriture sur tous les dossiers (sauf `rapports/à_traiter_manuellement/`) | Ne modifie pas les fichiers sources (orchestration uniquement) |
| **Agents Spécialisés** | Lecture/écriture uniquement dans leur domaine + `rapports/` | Modifier des fichiers hors domaine : interdit |
| **Agent-Validateur** | Lecture seule sur tout le projet + écriture dans `rapports/validations/` | Modifier du code ou des configs : interdit |
| **Agent-Rétro** | Lecture seule sur code existant + écriture dans `rapports/` | Modifier le code analysé : interdit |
| **Utilisateur (Fred)** | Accès complet | Aucune |

### Actions interdites (même sur demande utilisateur)
- Modifier un fichier hors de son domaine
- Exécuter des commandes dangereuses (`rm -rf`, `chmod 777`, etc.)
- Supprimer des fichiers sans backup (copie dans `backups/` obligatoire)
- Modifier `config.yaml` ou `tâches_en_cours.json` (seulement via Orchestrateur)
- Accéder à `rapports/à_traiter_manuellement/`
- Exécuter du code non validé

### Mécanismes de contrôle
- **Fichier de permissions** : `Agent-docs/permissions.yaml` définit les accès par agent
- **Vérification pré-exécution** : l'Orchestrateur bloque les actions non autorisées
- **Logs d'audit** : tous les accès journalisés dans `logs/audit/{agent}.log`
- **Sandbox isolée** : les agents travaillent dans `sandbox/` avant intégration
- **Validation des scripts** : scripts signés (hash SHA-256 dans `config.yaml`)

### Workflow sécurisé
1. Orchestrateur vérifie `permissions.yaml`
2. Création sandbox : `scripts/create_sandbox.py`
3. Agent travaille uniquement dans `sandbox/`
4. Validation : tests, linter, régressions via `validate_sandbox.py`
5. Intégration : `rsync` si ✅, rejet + rapport si ❌

### Gestion des exceptions
- **Demande interdite** : l'agent refuse et génère un rapport dans `rapports/alertes/{tâche}.md`
- **Mode Super Utilisateur** : seulement l'humain peut exécuter des actions critiques via scripts manuels

## Dépendances entre domaines — Réponse

### Graphe de dépendances
```
Rétro-Ingénierie → Développement → Tests → Documentation → Validation Finale
```

- **Rétro-Ingénierie → Développement** : impossible de développer sans comprendre le code existant
- **Développement → Tests** : TDD impose les tests avant le code (mais specs viennent du dev)
- **Développement → Documentation** : on ne documente pas ce qui n'existe pas
- **Tests/Documentation → Validation Finale** : tout doit exister avant validation

### Ordre de résolution strict
| Étape | Domaine | Agent | Prérequis | Livrable |
|-------|---------|-------|-----------|----------|
| 1 | Rétro-Ingénierie | Agent-Rétro | Aucun | `rapports/analyse_{projet}.md` |
| 2 | Développement | Agent-Novice | Rapport rétro | Code + tests |
| 3 | Tests | Agent-Novice | Code implémenté | Tests passants |
| 4 | Documentation | Agent-Markdown | Code + tests validés | Doc à jour |
| 5 | Validation Finale | Agent-Validateur | Tous livrables 1-4 | Rapport de validation |

### Cas particuliers
- **CSS/Tailwind** : dépend du Développement (si lié à des composants JS), indépendant de la Documentation
- **Mermaid** : dépend de la Documentation, peut être utilisé par Rétro-Ingénierie

### Règles
- L'Orchestrateur bloque une tâche si ses dépendances ne sont pas résolues
- `tâches_en_cours.json` contient le champ `"dépend_de": [...]`
- Rétro-ingénierie = priorité maximale, Documentation = priorité minimale

## Priorisation — Réponse

### Critères (par ordre d'importance)
1. **Urgence** — tâches bloquantes ou critiques (priorité 0)
2. **Dépendances** — tâches nécessaires pour débloquer d'autres tâches
3. **Domaine** — ordre fixe : Rétro > Dev > Tests > Doc
4. **FIFO** — uniquement si même priorité et même domaine

### Niveaux
| Niveau | Description | Exemples |
|--------|-------------|----------|
| **0** Critique | Bloque tout le projet | Bugs prod, conflits, sécurité |
| **1** Haute | Dépendances pour d'autres | Rétro-ingénierie, tâches parent |
| **2** Moyenne | Dev et tests | Implémentation, écriture tests |
| **3** Basse | Documentation, mineures | Docs, optimisations non critiques |

### Algorithme
1. Tri par priorité numérique (0 > 1 > 2 > 3)
2. Si même priorité : tri par domaine (Rétro > Dev > Tests > Doc > Mermaid)
3. Si même priorité ET même domaine : FIFO

### Gestion dynamique
- Recalcul automatique à chaque nouvel event (tâche ajoutée, terminée, changement priorité)
- Override manuel possible via `Agent-docs/override_priorities.yaml`

## Versioning et historique — Réponse

### Suivi des versions
| Élément | Méthode | Emplacement | Responsable |
|---------|---------|-------------|-------------|
| Code | Git (commits + branches) | `.git/` | Agent-Maître |
| Rapports | Dossiers datés `{tâche}_{date}_{version}.md` | `rapports/` | Agents + Orchestrateur |
| Configs | Git + backup auto avant modif | `Agent-docs/configs/` | Orchestrateur |
| État tâches | Historique dans `tâches_en_cours.json` versionné via Git | `Agent-docs/orchestrateur/` | Orchestrateur |

### Rollback
| Scénario | Détection | Méthode |
|----------|-----------|---------|
| Erreur rapport | Agent-Validateur | Restauration depuis `rapports/{type}/archive/` |
| Code corrompu | Tests ou Validateur | `git checkout {commit_précédent}` + relance tests |
| Config erronée | Orchestrateur | Restauration depuis `configs/backups/config_{date}.yaml` |
| Tâche mal assignée | Orchestrateur | Retour état précédent via Git |

### Conservation
- Rapports : archive illimitée dans `rapports/{type}/archive/`
- Code : Git (illimité)
- Configs : 30 jours dans `configs/backups/` (nettoyage auto)
- Logs audit : 90 jours dans `logs/audit/`

### Processus type
1. Agent-Validateur détecte incohérence → rapport dans `rapports/alertes/`
2. Orchestrateur restaure dernière version valide depuis archive
3. Met à jour `tâches_en_cours.json` avec `"statut": "en_rollback"` + version restaurée
4. Réassigne à l'agent pour correction → nouvelle version générée

## Communication inter-agents — Réponse

### Canaux
| Type | Méthode | Format | Garanties |
|------|---------|--------|-----------|
| Tâches | `rapports/tâches/{tâche}.md` | Markdown + YAML frontmatter | Atomicité (1 fichier = 1 tâche) |
| Statuts | `tâches_en_cours.json` | JSON | Centralisé (Orchestrateur) |
| Rapports | `rapports/{type}/{tâche}.md` | Markdown | Immuable (versionné) |
| Retours | `rapports/retours/{tâche}_{agent}.md` | Markdown | Traçable (lien vers tâche) |
| Alertes | `rapports/alertes/{tâche}.md` | Markdown | Prioritaire (escalade auto) |
| Logs | `logs/{agent}/{tâche}_{date}.log` | Texte | Horodaté + signé (hash) |

### Format standard (Markdown + YAML frontmatter)
```yaml
---
tâche: "valider_input"
domaine: "développement"
priorité: 2
agent_assigné: "Novice"
dépend_de: ["analyser_projet_X"]
statut: "en_cours"
date_création: "2026-05-16"
version: 1
---
```

### Garanties de complétude
- **Atomicité** : 1 fichier = 1 tâche/rapport, pas de fusion
- **Traçabilité** : liens entre tâches, rapports et livrables
- **Immuabilité** : rapports versionnés (datés + numérotés)
- **Validation** : chaque communication passe par 3 niveaux de contrôle
- **Synchronisation** : `tâches_en_cours.json` est le seul fichier central
- **Backup automatique** : copie avant modification

### Flux type
1. Agent met à jour `statut.json` + génère rapport dans `rapports/auto-verif/`
2. Orchestrateur détecte via watchdog → met à jour `tâches_en_cours.json`
3. Orchestrateur assigne réviseur → fichier dans `rapports/tâches/à_revoir/`
4. Réviseur lit fiche + rapport + code → génère rapport de revue
5. Selon résultat : validation finale ou retour à l'agent auteur

### Outils
- `watchdog` — surveillance des dossiers `rapports/`, `logs/`
- `scripts/generate_report.py` — génération rapports standardisés
- `scripts/notify_agent.py` — notification via `agents/{nom}/inbox/`
- `scripts/check_completeness.py` — vérification des livrables

---

*Document généré le 2026-05-16 — Toutes les questions ont reçu une réponse.*
