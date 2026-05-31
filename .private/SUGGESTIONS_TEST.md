PROCÉDURE DE VÉRIFICATION DU FIX SUGGESTIONS
==============================================

OBJECTIF
--------
Vérifier que le mécanisme de suivi suggéré génère désormais des suggestions avec des valeurs réelles au lieu de placeholders.

ÉTAPES DE VÉRIFICATION
----------------------

1. PRÉPARATION
   - S'assurer qu'au moins un projet existe dans workspaces/
   - Noter le nom exact du projet pour vérification ultérieure

2. DÉCLENCHER L'EXÉCUTION D'UN SCRIPT
   Option A : Via Alice
      - Dire à Alice : "liste les projets"
      - Observer l'exécution du script scripts/projects/list.js
   Option B : Via ligne de commande directe
      - Exécuter : node dist/script-runner.js project-request "liste les projets"
   Option C : Déclencher un script plus complexe
      - Exécuter : node dist/script-runner.js project-request "ajoute une tâche \"test suggestion\" dans backend au projet [nom-du-projet]"

3. VÉRIFICATION IMMÉDIATE
   - Après exécution réussie (exitCode 0), vérifier immédiatement le contenu de :
     telecom/suggestions.json
   - Le fichier devrait contenir des suggestions avec :
     * Le nom réel du projet au lieu de <projet>
     * Des valeurs réelles pour les autres placeholders selon le contexte
     * Aucuns placeholders visibles comme <projet>, <domaine>, "<nom>", etc.

4. EXEMPLES DE RÉSULTATS ATTENDUS
   Après "liste les projets" sur un projet appelé "mon-projet-test" :
   [
     {
       "label": "Voir le menu du projet",
       "description": "Voir le menu du projet",
       "command": "menu mon-projet-test"
     },
     {
       "label": "Nouveau projet", 
       "description": "Nouveau projet",
       "command": "crée un projet \"<nom>\""
     },
     {
       "label": "Voir tous les projets",
       "description": "Voir tous les projets", 
       "command": "liste les projets"
     }
   ]
   
   Après "ajoute une tâche \"test\" dans backend au projet mon-projet-test" :
   [
     {
       "label": "Renommer la tâche",
       "description": "Renommer la tâche",
       "command": "renomme la tâche \"task-xxx\" en \"Nouveau titre\" au projet mon-projet-test"
     },
     {
       "label": "Déplacer la tâche",
       "description": "Déplacer la tâche",
       "command": "déplace la tâche \"task-xxx\" dans frontend au projet mon-projet-test"
     },
     {
       "label": "Modifier la description",
       "description": "Modifier la description",
       "command": "modifie la description de la tâche \"task-xxx\" en \"Nouvelle description\" au projet mon-projet-test"
     },
     ...
   ]

5. VÉRIFICATION DU MENU INTERACTIF
   - Dans le CLI, après l'exécution du script, un menu de suggestions devrait apparaître
   - Vérifier que les options affichées contiennent des valeurs réelles, pas des placeholders
   - Tester l'exécution d'une suggestion en appuyant sur le numéro correspondant
   - Vérifier que la commande suggérée s'exécute sans erreur

6. NETTOYAGE
   - Les suggestions sont automatiquement affichées puis supprimées lorsqu'utilisées
   - Vérifier que telecom/suggestions.json est vide après avoir ignoré le menu (tapé 0) ou après avoir sélectionné une option

CRITÈRES DE SUCCÈS
------------------
✅ Aucuns placeholders visibles (<projet>, <domaine>, "<nom>", "...") dans les commandes des suggestions
✅ Les commandes contiennent des valeurs réelles provenant du contexte d'exécution
✅ Les suggestions proposées sont contextuellement pertinentes par rapport au script exécuté
✅ Les suggestions peuvent être exécutées avec succès via le menu interactif

LOGS À CONSULTER EN CAS D'ÉCHEC
------------------------------
- telecom/daemon.log : pour voir l'activité du daemon
- telecom/scripts/run-*.log : pour voir les détails d'exécution des scripts
- Sortie console du daemon : pour voir les logs de traitement des suggestions

NOTES
-----
- Le mécanisme de suggestions ne fonctionne que pour les scripts qui réussissent (exitCode 0)
- Les suggestions sont générées immédiatement après l'exécution du script
- Elles sont disponibles seulement pour une courte période avant d'être automatiquement nettoyées
- Le menu interactif apparaît seulement si le CLI est en mode interactif avec un TTY disponible