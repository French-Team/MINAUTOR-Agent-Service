# SOLUTION : CORRECTION DU REMPLACEMENT DE PLACEHOLDERS DANS LE SUIVI SUGGÉRÉ

## Fichier à modifier
`src/telecom/service/telecom-daemon.ts`

## Modifications à apporter

### 1. Dans la fonction `getFollowUpSuggestions()` (ligne ~502)
Remplacer le bloc de remplacement actuel (lignes 695-726) par :

```typescript
// Remplacer tous les placeholders avec leurs valeurs réelles
// Ne remplace que si la valeur réelle est disponible (non vide).
// Si le placeholder est absent du paramètre, on le conserve tel quel
// pour servir d'indication à l'utilisateur (ex: "menu <projet>" quand
// aucun projet n'est encore sélectionné).
if (params) {
  const realProject = params.project || (projectName || '')
  const realArea = params.area || ''
  const realName = params.name || ''
  const realTitle = params.title || ''

  if (realProject) {
    result = result
      .replace(/<projet>/g, realProject)
      .replace(/\{project\}/g, realProject)
  }
  if (realArea) {
    result = result
      .replace(/<domaine>/g, realArea)
      .replace(/\{area\}/g, realArea)
  }
  if (realName) {
    result = result
      .replace(/<nom>/g, realName)  // Note: pas de guillemets ici car le script les ajoute si nécessaire
      .replace(/\{name\}/g, realName)
  }
  if (realTitle) {
    result = result
      .replace(/<titre>/g, realTitle)  // Note: pas de guillemets ici
      .replace(/\{title\}/g, realTitle)
  }
}

// Injecter l'ID de tâche si disponible : remplacer le premier "..." de chaque ligne
// Cette logique doit rester pour gérer les cas où l'ID de tâche est dans les guillemets
if (taskId) {
  const idLabel = `\"${taskId}\"`
  result = result.replace(/"\.\.\."/g, idLabel)
}
```

### 2. Dans la fonction `tryScriptRunner()` (ligne ~736)
Modifier l'appel à `getFollowUpSuggestions()` pour passer explicitement les paramètres :

```typescript
// Notifier le résultat
const scriptName = result.script?.split(/[/\\]/).pop()?.replace(/\.\w+$/, '') ?? 'script'
let message = result.stdout
  ? `✅ [${scriptName}]\n${result.stdout.slice(0, 500)}`
  : `✅ [${scriptName}] — (sortie vide)`

// Ajouter les suggestions de suivi si le script a réussi
if (result.exitCode === 0) {
  const projectName = result.params?.project ?? extraEnv.SCRIPT_PROJECT ?? ''
  const taskId = extractTaskIdFromStdout(result.stdout ?? '')
  const taskStatus = taskId ? readTaskStatus(projectName, taskId) : null
  
  // PASSER LES PARAMÈTRES EXPLICITEMENT
  const suggestionsText = getFollowUpSuggestions(
    result.script, 
    projectName, 
    demande, 
    taskId ?? undefined, 
    taskStatus ?? undefined,
    result.params  // C'est crucial - on passe les paramètres extraits
  )
  
  if (suggestionsText) {
    message += `\n${suggestionsText}`
    // Écrire les suggestions structurées pour le menu interactif
    const structured = parseSuggestionsFromOutput(suggestionsText)
    if (structured.length > 0) {
      writeSuggestions(structured)
    }
  }
}
```

## Explication des changements

1. **Remplacement complet des placeholders** : Au lieu de ne remplacer que `"..."`, nous remplaçons maintenant tous les placeholders (`<projet>`, `{project}`, `<domaine>`, `{area}`, `<nom>`, `{name}`, `<titre>`, `{title}`) avec leurs valeurs réelles provenant de `params`.

2. **Gestion des guillemets** : Note que pour `<nom>` et `<titre>`, nous ne plaçons pas de guillemets dans le remplacement car certains scripts peuvent déjà les ajouter dans le texte de suggestion. Consultez les lignes du daemon pour voir comment les placeholders sont utilisés.

3. **Passage explicite des paramètres** : Dans `tryScriptRunner()`, nous nous assurons que `result.params` est passé à `getFollowUpSuggestions()`, ce qui contient les valeurs extraites du pattern du registre (project, area, title, etc.).

4. **Maintien du remplacement de "..."** : Nous conservons le remplacement de l'ID de tâche dans les guillemets, mais nous le faisons après le remplacement des autres placeholders pour éviter les conflits.

## Exemple de résultat attendu

Après correction, pour une demande comme :
```
"ajoute une tâche \"corriger bug\" dans backend au projet mon-app"
```

Les suggestions devraient être :

```
[
  {
    "label": "Renommer la tâche",
    "description": "Renommer la tâche",
    "command": "renomme la tâche \"task-789\" en \"Nouveau titre\" au projet mon-app"
  },
  {
    "label": "Déplacer la tâche",
    "description": "Déplacer la tâche", 
    "command": "déplace la tâche \"task-789\" dans frontend au projet mon-app"
  },
  {
    "label": "Décrire la tâche",
    "description": "Décrire la tâche",
    "command": "modifie la description de la tâche \"task-789\" en \"Nouvelle description\" au projet mon-app"
  },
  ...
]
```

AU LIEU DE :
```
[
  {
    "label": "Renommer la tâche", 
    "description": "Renommer la tâche",
    "command": "renomme la tâche \"...\" en \"Nouveau titre\" au projet <projet>"
  },
  ...
]
```