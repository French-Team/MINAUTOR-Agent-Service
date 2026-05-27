# Sandbox — Agents sans projet

Ce dossier isole les agents qui n'ont pas de projet explicite.
Ils y sont confinés (niveau « confined ») :

- Commandes de base autorisées (cat, ls, node, npm, …)
- Interdiction de sortir de ce dossier
- Pas d'accès à src/, data/, .agents/ ni aux autres projets

## Structure

```
workspaces/.sandbox/
  ├── .workspace     # Marqueur sandbox
  ├── .tasks.json    # Tableau des tâches du sandbox
  ├── README.md      # Ce fichier
  └── <agent-id>/     # Dossiers temporaires par agent
```

## Nettoyage

Les sous-dossiers d'agents sont supprimés périodiquement.
Ne rien stocker d'important ici.