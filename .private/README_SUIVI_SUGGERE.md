# RÉSUMÉ : CORRECTION DU SUIVI SUGGÉRÉ

## Fichiers créés pour l'agent

1. **PROBLEME_SUIVI_SUGGERE.md** - Description détaillée du problème
   - Localisation précise dans src/telecom/service/telecom-daemon.ts
   - Analyse de pourquoi seuls certains placeholders étaient remplacés
   - Preuves démontrant le problème

2. **SOLUTION_SUIVI_SUGGERE.md** - Solution technique complète
   - Modifications exactes à apporter à getFollowUpSuggestions()
   - Correction de l'appel dans tryScriptRunner() pour passer les paramètres
   - Explication des choix techniques (gestion des guillemets, ordre des remplacements)
   - Exemple de résultat attendu avant/après correction

3. **TEST_PROCEDURE_SUIVI_SUGGERE.md** - Procédure de vérification
   - Étapes préparatoires
   - Scénarios de test recommandés
   - Exemples de résultats attendus au format JSON
   - Critères de succès clairs et mesurables
   - Logs à consulter en cas d'échec

## Comment utiliser ces fichiers avec votre agent

1. **D'abord**, faites lire PROBLEME_SUIVI_SUGGERE.md à votre agent pour qu'il comprenne le problème
2. **Ensuite**, faites lire SOLUTION_SUIVI_SUGGERE.md pour qu'il sache exactement quoi modifier
3. **Enfin**, faites lire TEST_PROCEDURE_SUIVI_SUGGERE.md pour qu'il puisse vérifier que sa correction fonctionne

## Points critiques à vérifier lors de l'implémentation

### Dans src/telecom/service/telecom-daemon.ts :

**Fonction getFollowUpSuggestions() :**
- Le remplacement de tous les placeholders doit se faire AVEC les valeurs de `params`
- Faire attention à ne pas ajouter de guillemets supplémentaires si le script les fournit déjà
- Maintenir le remplacement de "..." par l'ID de tâche
- L'ordre des opérations : remplacer les placeholders → remplacer "..." (pour éviter les conflits)

**Fonction tryScriptRunner() :**
- S'assurer que `result.params` est passé comme dernier argument à `getFollowUpSuggestions()`
- Vérifier que les extraits du registre (project, area, title) sont bien présents dans result.params

### Vérification après implémentation
- Compiler le code : `npm run build`
- Tester avec un script qui génère du contexte complet (ex: add-task)
- Vérifier que telecom/suggestions.json contient bien des valeurs réelles
- Confirmer l'absence totale de placeholders dans les commandes

## Résultat attendu
Après correction réussie, lorsque l'utilisateur exécute une commande comme :
```
"ajoute une tâche \"test\" dans backend au projet mon-projet"
```

Le suivi suggéré affichera des suggestions utilisables comme :
```
→ renomme la tâche "task-123" en "Nouveau titre" au projet mon-projet — Renommer
→ déplace la tâche "task-123" dans frontend au projet mon-projet — Déplacer
```

AU LIEU de :
```
→ renomme la tâche "..." en "Nouveau titre" au projet <projet> — Renommer
→ déplace la tâche "..." dans <domaine> au projet <projet> — Déplacer
```

Cela restaurera complètement la fonctionnalité de suivi suggéré qui est essentielle pour améliorer l'expérience utilisateur en proposant des actions contextuelles rapides après l'exécution de scripts.