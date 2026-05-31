# PROCÉDURE DE TEST : VÉRIFICATION DE LA CORRECTION DU SUIVI SUGGÉRÉ

## Objectif
Vérifier que le mécanisme de suivi suggéré génère désormais des suggestions avec des valeurs réelles au lieu de placeholders après application de la correction.

## Prérequis
- Le code corrigé doit être compilé (`npm run build`)
- Au moins un projet doit exister dans le répertoire `workspaces/`
- Noter le nom exact du projet pour vérification ultérieure

## Étapes de test

### ÉTAPE 1 : PRÉPARATION
1. S'assurer qu'au moins un projet existe dans `workspaces/`
   - Exécuter : `node dist/script-runner.js project-request "liste les projets"`
   - Noter le nom du projet retourné (ex: `soulseek-donwloader`)

### ÉTAPE 2 : DÉCLENCHER L'EXÉCUTION D'UN SCRIPT AVEC CONTEXTE COMPLET
Choisir UN des scénarios suivants :

#### Scénario A : Ajout de tâche (recommandé pour test complet)
1. Exécuter : 
   ```
   node dist/script-runner.js project-request "ajoute une tâche \"test suggestion\" dans backend au projet [NOM-DU-PROJET]"
   ```
   Remplacer `[NOM-DU-PROJET]` par le nom réel du projet

#### Scénario B : Liste des tâches dans un domaine
1. Exécuter :
   ```
   node dist/script-runner.js project-request "liste les tâches backend du projet [NOM-DU-PROJET]"
   ```

#### Scénario C : Modification de tâche
1. D'abord ajouter une tâche (Scénario A)
2. Puis exécuter :
   ```
   node dist/script-runner.js project-request "renomme la tâche \"[ID-TÂCHE]\" en \"Nouveau titre\" au projet [NOM-DU-PROJET]"
   ```

### ÉTAPE 3 : VÉRIFICATION IMMÉDIATE
Après chaque exécution réussie (exitCode 0) :

1. Vérifier immédiatement le contenu de : `telecom/suggestions.json`
2. Le fichier devrait contenir des suggestions avec :
   - Le nom réel du projet au lieu de `<projet>` ou `{project}`
   - Le domaine réel au lieu de `<domaine>` ou `{area}` (si applicable)
   - Des valeurs réelles pour les autres placeholders selon le contexte
   - **AUCUNS** placeholders visibles comme `<projet>`, `<domaine>`, `<nom>`, `{name}`, etc.

### ÉTAPE 4 : EXEMPLES DE RÉSULTATS ATTENDUS

#### Après "ajoute une tâche \"test\" dans backend au projet mon-projet-test" :
```json
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
    "label": "Décrire la tâche",
    "description": "Décrire la tâche",
    "command": "modifie la description de la tâche \"task-xxx\" en \"Nouvelle description\" au projet mon-projet-test"
  },
  {
    "label": "Ajouter une autre tâche",
    "description": "Ajouter une autre tâche",
    "command": "ajoute une autre tâche \"task-xxx\" dans backend au projet mon-projet-test"
  },
  {
    "label": "Voir tous les projets",
    "description": "Voir tous les projets",
    "command": "liste les projets"
  }
]
```

#### Après "liste les projets" (devrait conserver les suggestions précédentes ou être vide selon le contexte) :
- Si un projet est actif : suggestions avec valeurs réelles
- Sinon : éventuellement vide ou suggestions génériques sans placeholders

### ÉTAPE 5 : VÉRIFICATION DU MENU INTERACTIF (OPTIONNEL)
Si le CLI est en mode interactif :
1. Après exécution du script, un menu de suggestions devrait apparaître
2. Vérifier que les options affichées contiennent des valeurs réelles, pas des placeholders
3. Tester l'exécution d'une suggestion en sélectionnant le numéro correspondant
4. Vérifier que la commande suggérée s'exécute sans erreur

### ÉTAPE 6 : NETTOYAGE ET VÉRIFICATION FINALE
1. Après avoir sélectionné une suggestion ou avoir ignoré le menu (tapé 0)
2. Vérifier que `telecom/suggestions.json` est vide (ou contient uniquement les suggestions du dernier script exécuté)
3. Confirmer qu'aucun fichier de log d'erreur n'a été généré

## CRITÈRES DE SUCCÈS
✅ **AUCUN** placeholder visible (`<projet>`, `{project}`, `<domaine>`, `{area}`, `<nom>`, `{name}`, `<titre>`, `{title}`) dans les commandes des suggestions  
✅ Les commandes contiennent des valeurs réelles provenant du contexte d'exécution  
✅ Les suggestions proposées sont contextuellement pertinentes par rapport au script exécuté  
✅ Les suggestions peuvent être exécutées avec succès via le menu interactif  
✅ Le fichier `telecom/suggestions.json` est correctement formaté (JSON valide)

## LOGS À CONSULTER EN CAS D'ÉCHEC
- `telecom/daemon.log` : pour voir l'activité du daemon et les erreurs potentielles
- `telecom/scripts/run-*.log` : pour voir les détails d'exécution des scripts
- Sortie console lors de l'exécution de `node dist/script-runner.js ...`

## NOTES IMPORTANTES
- Le mécanisme de suggestions ne fonctionne que pour les scripts qui réussissent (exitCode === 0)
- Les suggestions sont générées immédiatement après l'exécution du script
- Elles sont disponibles seulement pour une courte période avant d'être automatiquement nettoyées
- Le remplacement des placeholders dépend de la présence des paramètres dans `result.params` (extrait du registre des scripts)
- Si un placeholder n'apparaît pas dans les suggestions générées, cela peut être normal selon le type de script exécuté