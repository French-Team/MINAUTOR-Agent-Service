# Questions par Profil

Sept questions à se poser systématiquement avant de créer un nouveau profil agent.

---

1. **Mission unique** — Quelle est son unique mission ? (une phrase, pas plus)

   **Réponse générique** : *"Chaque agent a pour mission unique d'exécuter des tâches atomiques dans son domaine strict, en respectant les contraintes du système (TDD, auto-vérification, documentation obligatoire), sans jamais modifier directement des fichiers hors de son périmètre."*

2. **Intrant** — Quel intrant reçoit-il ? (fichier, message, notification, event)

   **Réponse générique** : *"Chaque agent reçoit uniquement des fichiers structurés (Markdown, JSON, YAML) dans son dossier dédié (`agents/{nom}/inbox/` ou `rapports/`), des notifications via l'Orchestrateur (fichiers de statut), ou des événements système (watchdog détectant un nouveau fichier)."*

   **Détails** :
   - Fichiers : `rapports/tâches/{tâche}.md`, `Agent-docs/configs/{nom}.yaml`, `tâches_en_cours.json`
   - Notifications : statut dans `agents/{nom}/statut.json`, inbox surveillé
   - Événements : watchdog sur `rapports/auto-verif/`

3. **Extrant** — Quel extrant produit-il ? (fichier modifié, rapport, décision, pushNotification)

   **Réponse générique** : *"Chaque agent produit uniquement des fichiers structurés (Markdown, JSON, code) dans son périmètre autorisé, des rapports de travail (succès/échec), et des mises à jour de statut. Aucun extrant n'est une action directe sur des fichiers hors de son domaine."*

   | Type | Exemples | Emplacement | Format |
   |------|----------|-------------|--------|
   | Code/modifications | Fichiers source (JS, CSS...) | `utils/`, `sandbox/` | Code source |
   | Rapports | Auto-vérification, revue, échec | `rapports/{type}/{tâche}.md` | Markdown + YAML |
   | Statuts | Disponible, en_cours, etc. | `agents/{nom}/statut.json` | JSON |
   | Logs | Succès, échecs, blocages | `logs/{agent}/{tâche}.log` | Texte |
   | Notifications | Pour Orchestrateur ou autres agents | `agents/{nom}/inbox/` ou `rapports/alertes/` | Markdown/JSON |

4. **Contraintes absolues** — Quelles sont ses contraintes absolues ?
   (ne pas inventer, ne pas supposer, vérifier avant d'agir, suivre le plan à la lettre)

   **Réponse générique** : *"Un agent ne peut jamais :"*
   - Modifier un fichier hors de son domaine
   - Exécuter une action non validée (tests échoués, linter non passé, validation manquante)
   - Supprimer ou écraser un fichier sans backup
   - Ignorer les dépendances (ex: documenter avant le code)
   - Communiquer en dehors des canaux autorisés (fichiers Markdown/JSON uniquement)
   - Dépasser son périmètre de permissions (`permissions.yaml`)
   - Ne pas documenter son travail (rapport obligatoire pour chaque tâche)
   - Ne pas respecter le cycle de vie (auto-vérif → pairs → validation finale)

5. **Complétude** — Quand sa mission est-elle "terminée" ?
   (critère de complétude objectif et vérifiable)

   **Réponse générique** : *"La mission d'un agent est terminée uniquement quand :"*
   - Tous les extrants sont produits et validés (3 niveaux)
   - Aucune contrainte absolue n'a été violée
   - Tous les livrables sont archivés (versionnés)
   - L'Orchestrateur a mis à jour `tâches_en_cours.json` avec `"statut": "terminé"`
   - Un rapport de clôture a été généré dans `rapports/terminé/{tâche}_{agent}.md`

   **Checklist de terminaison** :
   | Critère | Vérification | Preuve |
   |---------|-------------|--------|
   | Extrants produits | Tous les fichiers attendus existent | `ls` |
   | Auto-vérification passée | Rapport dans `rapports/auto-verif/` ✅ | `cat` du rapport |
   | Revue pairs passée | Rapport dans `rapports/revues/` ✅ | `cat` du rapport |
   | Validation finale passée | Rapport dans `rapports/validations/` ✅ | `cat` du rapport |
   | Contraintes respectées | Script `check_constraints.py` ✅ | Sortie du script |
   | Livrables archivés | `rapports/archive/` ou commit Git | `git log` |
   | Statut mis à jour | `tâches_en_cours.json` → `"terminé"` | `cat` du fichier |
   | Rapport de clôture | Fichier dans `rapports/terminé/` | `cat` du rapport |

6. **Rapport** — Où écrit-il son rapport de suivi ?

   **Réponse générique** :
   - Rapports structurés : `rapports/{type}/{nom_agent}/{tâche}_{date}.md` (Markdown + YAML)
   - Logs techniques : `agents/{nom}/logs/{tâche}_{date}.log`
   - Statuts : `tâches_en_cours.json` (via Orchestrateur)

   **Règles** :
   - Un seul rapport par phase
   - Versionnage auto : `{tâche}_{date}_{version}.md`
   - Lien obligatoire vers la tâche parente dans le YAML frontmatter

   **Arborescence `rapports/`** :
   ```
   rapports/
   ├── tâches/                    # Fiches de tâche (intrants)
   ├── auto-verif/                # Niveau 1
   │   └── {nom_agent}/
   ├── revues/                    # Niveau 2
   ├── validations/               # Niveau 3
   ├── échecs/                    # Rapports d'échec
   ├── terminé/                   # Rapports de clôture
   └── archive/                   # Anciennes versions
   ```

7. **Déclencheur** — Qui peut le déclencher ?
   (utilisateur, autre agent, timer, event système)

   **Réponse générique** :
   - **Orchestrateur** : via `tâches_en_cours.json` (statut → `"assigné"`) après validation des dépendances
   - **Autre agent** : fichier dans `agents/{nom}/inbox/` ou mise à jour de statut
   - **Événement système** : watchdog (nouveau fichier dans `rapports/`), timer (tâches périodiques)
   - **Utilisateur** : fiche de tâche dans `rapports/tâches/{tâche}.md` ou override via `Agent-docs/override.yaml`

   **Règles** :
   - Pas de déclenchement direct par un agent hors de son domaine
   - Toujours passer par l'Orchestrateur pour les tâches critiques
   - Priorité : watchdog > Orchestrateur > utilisateur

8. **Modèle et provider** — Quel modèle LLM et quel provider sont optimaux pour cette mission ?
   (un agent CSS n'a pas besoin d'un modèle de 200B paramètres, coût, latence, qualité)

   **Réponse générique** : *"Privilégier les providers gratuits ou à faible coût : OpenRouter, Opencode, Kilo, Google Gemini. Le modèle doit être adapté à la complexité de la mission (un agent CSS n'a pas besoin d'un modèle de 200B, un agent de rétro-ingénierie peut nécessiter un modèle plus puissant)."*

   **Règle** : coût minimal pour le niveau de qualité requis par la mission.

9. **Outils et compétences** — De quels outils (skills) cet agent a-t-il besoin dans son environnement ?
   (lecture fichiers, terminal, navigation web, accès base de données)

   **Réponse générique** : *"Chaque agent a les outils strictement limités à son domaine :"*
   - **Fichiers** : lecture domaine + `rapports/` + `Agent-docs/` ; écriture domaine + `rapports/{type}/` + `logs/`
   - **Commandes** : linters, tests, scripts internes ; **interdit** : `rm -rf`, `chmod`, `sudo`
   - **Git** : uniquement `status`, `diff`, `log` — pas de commit/push
   - **Parsing** : acorn, ast, BeautifulSoup, PyYAML, json, regex
   - **Rapports** : Markdown, Jinja2 templates
   - **Watchdog** : détection fichiers dans `inbox/` ou `rapports/`
   - **Communication** : JSON/YAML fichiers uniquement — pas de sockets/HTTP
   - **Réseau** : interdit par défaut (sauf proxy contrôlé pour Agent-Rétro)
   - **BDD** : pas d'accès direct — fichiers locaux uniquement (JSON, SQLite)
   - **Sandbox** : exécution obligatoire dans environnement isolé (Docker / `sandbox/`)

   **Règle** : chaque outil est explicitement autorisé ou interdit dans `permissions.yaml`

10. **Dépendances amont** — Quel travail doit être fait AVANT que cet agent puisse commencer sa mission ?

    **Réponse générique** : *"Les dépendances amont sont définies par le graphe de dépendances (Rétro → Dev → Tests → Doc → Validation) et vérifiées par l'Orchestrateur avant d'assigner une tâche. Un agent ne reçoit sa mission que si toutes ses dépendances sont résolues (`"statut": "terminé"` dans `tâches_en_cours.json`)."*

    **Exemples** :
    - Agent-Novice attend le rapport de Agent-Rétro
    - Agent-Markdown attend les tests verts de Agent-Novice
    - Agent-Validateur attend tous les livrables des étapes précédentes

11. **Dépendances aval** — Quel profil attend le résultat de cet agent pour commencer sa propre mission ?

    **Réponse générique** : *"Les dépendances aval sont le miroir du graphe : chaque agent sait quel(s) profil(s) attendent son résultat. L'Orchestrateur utilise cette info pour prioriser et notifier les agents en aval dès qu'un livrable est prêt."*

    **Exemples** :
    - Agent-Rétro → Agent-Novice attend son rapport d'analyse
    - Agent-Novice → Agent-Markdown + Agent-Mermaid attendent code + tests
    - Agent-Markdown → Agent-Validateur attend la documentation

12. **Critères de refus** — Qu'est-ce qui déclenche un refus de mission de la part de cet agent ?
     (domaine hors périmètre, informations insuffisantes, prérequis non remplis)

    **Réponse générique** : *"Un agent refuse une mission si :"*
    1. La tâche sort de son domaine (`permissions.yaml`)
    2. Informations insuffisantes dans la fiche de tâche
    3. Dépendances amont non résolues
    4. Action interdite (modification hors périmètre, commande dangereuse)
    5. Aucun backup avant opération destructive
    6. Conflit avec une tâche en cours sur les mêmes fichiers
    7. Permissions insuffisantes

13. **Budget / limite** — L'agent a-t-il une limite de temps, de tokens ou d'itérations pour sa mission ?

    **Réponse générique** : *"Temps max par tâche : 30 min sans mise à jour de statut → timeout. Max 2 tentatives par agent, 3 échecs totaux avant escalade humaine. Pas de limite de tokens explicite — le cycle de vie en 9 phases avec ses contrôles intermédiaires fait office de garde-fou naturel."*

14. **Exemple concret** — Peut-on donner un exemple de mission réelle pour ce profil ?
     (permet de comprendre le périmètre exact et sert de cas de test)

    **Réponse générique** : *"Chaque profil est défini avec son fil rouge — une tâche atomique réutilisable comme cas de test et d'illustration. Exemple commun à tous : `valider_input` (implémenter une fonction `validateInput` avec TDD, documentation, et validation en 3 niveaux)."*

---

*Document généré le 2026-05-16 — Toutes les questions ont reçu une réponse.*
