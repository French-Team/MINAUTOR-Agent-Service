PROBLÈME DU SUIVI SUGGÉRÉ (FOLLOW-UP SUGGESTIONS)
====================================================

SYMPTÔME
--------
Les suggestions de suivi affichées dans le menu interactif du CLI contiennent des placeholders non remplacés :
- `menu <projet>` au lieu de `menu nom-du-projet-actual`
- `crée un projet "<nom>"` au lieu de `crée un projet "nom réel"`
- etc.

Cela rend les suggestions inutilisables car l'utilisateur ne peut pas exécuter des commandes contenant des placeholders non résolus.

EMPLACEMENT DU PROBLÈME
-----------------------
Fichier : `src/telecom/service/telecom-daemon.ts`
Fonction : `getFollowUpSuggestions()` (à partir de la ligne 502)

ANALYSE DÉTAILLÉE
-----------------
La fonction `getFollowUpSuggestions()` génère du texte de suggestions contenant divers placeholders :
- `<projet>` / `{project}` → devrait être remplacé par le nom du projet réel
- `<domaine>` / `{area}` → devrait être remplacé par le domaine réel
- `"<nom>"` / `"{name}"` → devrait être remplacé par le nom/titre réel
- `"<titre>"` / `"{title}"` → devrait être remplacé par le titre réel
- `"..."` → partiellement géré (remplacé par l'ID de tâche si disponible)

Cependant, seule la replacement de `"..."` est actuellement effectuée (lignes 688-692) :
```typescript
// Injecter l'ID de tâche si disponible : remplacer le premier "..." de chaque ligne
if (taskId) {
  const idLabel = `\"${taskId}\"`;
  result = lines.map(line => line.replace('"..."', idLabel)).join('\n');
}
```

Les autres placeholders restent tels quels dans le texte final, ce qui produit des suggestions comme :
```
  → ajoute une tâche "..." dans <domaine> au projet <projet> — Renommer
```

AU LIEU de :
```
  → ajoute une tâche "task-456" dans backend au projet mon-projet — Renommer
```

CONSÉQUENCES
------------
1. Lorsque ce texte est parsé par `parseSuggestionsFromOutput()` dans `src/cli-suggestions.ts`, les placeholders font partie du `label` et de la `command`
2. Le menu affiche des suggestions avec des placeholders visibles
3. Lorsque l'utilisateur sélectionne une suggestion, la commande exécutée échoue car elle contient des placeholders non résolus
4. L'expérience utilisateur est dégradée car le mécanisme de "suivi suggéré" ne fonctionne pas comme prévu

PREUVES DANS LOGS
-----------------
Exécution réussie de scripts visible dans `telecom/scripts/*.log` :
- `run-20-32-56.log` : `liste les projets` → `scripts/projects/list.js` (exitCode 0)
- `run-15-02-28.log` : `liste les agents` → `scripts/agents/list.js` (exitCode 0)
- `run-17-40-38.log` : `crée un projet "soulseek-downloader"` → `scripts/create/triage.js` (exitCode 0)

Malgré ces exécutions réussies, `telecom/suggestions.json` ne contient que des suggestions génériques avec placeholders, indiquant que soit :
Aucun script spécifique ne génère de suggestions utilisables, OR
Les suggestions générées contiennent des placeholders non remplacés

SOLUTION
--------
Dans `src/telecom/service/telecom-daemon.ts`, fonction `getFollowUpSuggestions()`, après la génération du texte de suggestions (après la ligne 694), ajouter une logique de remplacement complète pour tous les placeholders :

```typescript
// Remplacer tous les placeholders avec leurs valeurs réelles
if (hasProject) {
  // Extraire les paramètres disponibles depuis l'appelant si nécessaire
  const projectName = this.projectName ?? '<projet>';
  const area = this.area ?? '<domaine>';
  const name = this.name ?? '<nom>';
  const title = this.title ?? '<titre>';
  
  result = result
    .replace(/<projet>/g, projectName)
    .replace(/\{project\}/g, projectName)
    .replace(/<domaine>/g, area)
    .replace(/\{area\}/g, area)
    .replace(/<nom>/g, `"${name}"`)
    .replace(/\{name\}/g, `"${name}"`)
    .replace(/<titre>/g, `"${title}"`)
    .replace(/\{title\}/g, `"${title}"`)
    .replace(/"\.\.\."/g, taskId ? `\"${taskId}\"` : '"..."');
}
```

OU, mieux encore, passer les paramètres nécessaires à la fonction `getFollowUpSuggestions()` depuis son appelant dans `tryScriptRunner()` (ligne 738) :

Dans `tryScriptRunner()` :
```typescript
const suggestionsText = getFollowUpSuggestions(
  result.script, 
  projectName, 
  demande, 
  taskId ?? undefined, 
  taskStatus ?? undefined,
  result.params // Passer les paramètres extraits
);
```

Et modifier la signature de `getFollowUpSuggestions()` pour accepter un paramètre `params?: Record<string, string>`.

EXEMPLE DE RÉSULTAT ATTENDU
---------------------------
Après correction, pour une demande comme "ajoute une tâche \"corriger bug\" dans backend au projet mon-app", les suggestions devraient être :

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
  ...
]
```

AU LIEU DE :
[
  {
    "label": "Renommer la tâche", 
    "description": "Renommer la tâche",
    "command": "renomme la tâche \"...\" en \"Nouveau titre\" au projet <projet>"
  },
  ...
]

NOTE SUR L'ARCHITECTURE
-----------------------
Le mécanisme de suivi suggéré est conçu pour améliorer l'expérience utilisateur en proposant des actions contextuelles rapides après l'exécution d'un script. Lorsque fonctionne correctement, il réduit considérablement la quantité de frappe nécessaire pour enchainer des opérations liées, ce qui est particulièrement précieux dans les workflows de développement où les tâches sont souvent séquentielles et connexes.

La correction proposée maintient l'architecture existante tout en comblant simplement le manque de remplacement de placeholders, ce qui devrait restaurer le fonctionnement complet de cette fonctionnalité.