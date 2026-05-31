ISSUE: Suivi suggéré (follow-up suggestions) ne fonctionne pas correctement
=======================================================================

PROBLÈME IDENTIFIÉ
------------------
Les suggestions de suivi générées après l'exécution d'un script contiennent des placeholders non remplacés
(<projet>, <domaine>, "<nom>", etc.) au lieu des valeurs réelles, rendant les suggestions inutilisables.

EXEMPLE ACTUEL (telecom/suggestions.json) :
[
  {
    "label": "Voir le menu d'un projet",
    "description": "Voir le menu d'un projet",
    "command": "menu <projet>"
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

Ces suggestions génériques indiquent que soit :
1. Aucun script spécifique n'a été exécuté avec succès
2. Ou les suggestions générées contiennent des placeholders non remplacés

RACINE DU PROBLÈME
------------------
Dans `src/telecom/service/telecom-daemon.ts`, la fonction `getFollowUpSuggestions()` génère du texte avec des placeholders,
mais seule la replacement de `"..."` par l'ID de tâche est effectuée (lignes 688-692).

Les autres placeholders ne sont jamais remplacés :
- `<projet>` → devrait être remplacé par le nom du projet réel
- `<domaine>` → devrait être remplacé par le domaine réel  
- `"<nom>"` → devrait être remplacé par le nom/titre réel
- `"<titre>"` → devrait être remplacé par le titre réel

EXEMPLE DE SUGGESTION GÉNÉRÉE (non traitée) :
```
  → ajoute une tâche "..." dans <domaine> au projet <projet> — Renommer
```

DEVRAIT DEVENIR (après remplacement) :
```
  → ajoute une tâche "task-123" dans backend au projet mon-projet — Renommer
```

FICHIERS CONCERNÉS À MODIFIER
-----------------------------
1. `src/telecom/service/telecom-daemon.ts` - Fonction `getFollowUpSuggestions()` (ligne ~502)
   - Ajouter la logique de remplacement pour tous les placeholders après la génération du texte

2. Possiblement `src/script-runner.ts` - Fonction `matchAndExecute()` (ligne ~738)  
   - Où `getFollowUpSuggestions()` est appelée et où les variables sont disponibles

VARIABLES DISPONIBLES POUR LE REMPLACEMENT
------------------------------------------
Dans `getFollowUpSuggestions()` :
- `projectName`: string (nom du projet)
- `demande`: string (demande utilisateur originale) 
- `taskId`: string? (ID de la tâche si extrait)
- `taskStatus`: string? (status de la tâche)
- Depuis l'appel dans `tryScriptRunner()` (ligne 735):
  - `result.params`: Record<string, string> (paramètres extraits du pattern)

PLACEHOLDERS À REMPLACER
------------------------
- `<projet>` ou `{project}` → `projectName`
- `<domaine>` ou `{area}` → à extraire de `result.params.area` ou similaire
- `"<nom>"` ou `"{name}"` → à extraire de `result.params.name` ou similaire  
- `"<titre>"` ou `"{title}"` → à extraire de `result.params.title` ou similaire
- `"..."` → déjà partiellement géré (doit être complété pour tous les cas)

SOLUTION PROPOSÉE
-----------------
Dans `getFollowUpSuggestions()`, après la ligne 694 (return result), ajouter :

```typescript
// Remplacer tous les placeholders avec leurs valeurs réelles
if (hasProject) {
  result = result
    .replace(/<projet>/g, projectName)
    .replace(/\{project\}/g, projectName)
    .replace(/<nom>/g, '"' + (params?.name ?? '') + '"')
    .replace(/\{name\}/g, '"' + (params?.name ?? '') + '"')
    .replace(/<titre>/g, '"' + (params?.title ?? '') + '"')
    .replace(/\{title\}/g, '"' + (params?.title ?? '') + '"')
    .replace(/<domaine>/g, params?.area ?? '<domaine>')
    .replace(/\{area\}/g, params?.area ?? '<domaine>')
    // Gérer le cas spécial des ... pour taskId (déjà partiellement fait)
    .replace(/"\.\.\."/g, taskId ? `\"${taskId}\"` : '"..."');
}
```

OU MIEUX : Créer une fonction utilitaire de remplacement appelée après la génération.

TEST DE VALIDATION
------------------
Après la correction, exécuter une commande qui déclenche un script (ex: `!project list` ou via Alice),
vérifier que `telecom/suggestions.json` contient des commandes avec des valeurs réelles au lieu de placeholders.

EXEMPLE ATTENDU APRÈS CORRECTION :
[
  {
    "label": "Voir le menu du projet",
    "description": "Voir le menu du projet", 
    "command": "menu mon-projet-actuel"
  },
  {
    "label": "Ajouter une tâche backend",
    "description": "Ajouter une tâche backend",
    "command": "ajoute une tâche \"nouvelle fonctionnalité\" dans backend au projet mon-projet-actuel"
  }
]

NOTE SUR L'ARCHITECTURE
-----------------------
Le mécanisme de suivi suggéré est conçu pour :
1. Générer des suggestions contextuelles après l'exécution d'un script
2. Les parser en format structuré pour le menu interactif CLI
3. Permettre à l'utilisateur d'exécuter des actions rapides avec un numéro
4. Améliorer l'expérience utilisateur en réduisant la frappe

Cette fonctionnalité est particulièrement importante pour le workflow projet où
les utilisateurs doivent fréquemment enchainer des tâches liées.