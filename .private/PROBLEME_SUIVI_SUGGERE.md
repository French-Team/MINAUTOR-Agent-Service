# PROBLÈME : SUIVI SUGGÉRÉ AVEC PLACEHOLDERS NON REMPLACÉS

## Description
Le mécanisme de suivi suggéré (suivi suggéré) génère des suggestions contenant des placeholders non remplacés (`<projet>`, `<domaine>`, `"<nom>"`, etc.) au lieu des valeurs réelles, rendant les suggestions inutilisables.

## Localisation du problème
Fichier : `src/telecom/service/telecom-daemon.ts`
Fonction : `getFollowUpSuggestions()` (à partir de la ligne 502)

## Analyse détaillée
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
  const idLabel = `\"${taskId}\"`
  result = lines.map(line => line.replace('"..."', idLabel)).join('\n')
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

## Preuves
- Logs d'exécution réussis de scripts visibles dans `telecom/scripts/*.log` (ex: `run-20-32-56.log`, `run-15-02-28.log`)
- Malgré ces exécutions réussies, `telecom/suggestions.json` contient uniquement des suggestions génériques avec placeholders
- Ceci confirme que les suggestions sont générées mais avec des placeholders non remplacés

## Solution requise
Modifier la fonction `getFollowUpSuggestions()` pour :
1. Remplacer tous les placeholders avec leurs valeurs réelles lorsque disponibles
2. S'assurer que les paramètres nécessaires sont passés depuis l'appelant dans `tryScriptRunner()`