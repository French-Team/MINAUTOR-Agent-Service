# Workspaces — Projets utilisateur

Ce dossier contient tous les projets créés ou importés par les agents.

## Structure

```
workspaces/
├── <nom-du-projet>/
│   ├── .workspace     # Marqueur de projet (fichier YAML)
│   ├── .tasks.json    # Tableau des tâches du projet
│   └── ...            # Fichiers du projet
├── .tasks.json        # Tableau global (orchestrateur)
└── README.md          # Ce fichier
```

## Commandes

- `!project create <nom> [description]` — Crée un nouveau projet
- `!project list` — Liste tous les projets
- `!project init <nom>` — Marque un dossier existant comme projet
- `!project show <nom>` — Affiche les infos d'un projet
- `!project tasks <nom>` — Affiche les tâches d'un projet
- `!project archive <nom>` — Archive un projet

## Notes

- Les dossiers sans `.workspace` sont ignorés par le système
- Pour utiliser un dossier existant : `!project init <nom>`
- Le fichier `.tasks.json` est géré par l'orchestrateur
- Les agents confinés ne voient que leur propre projet

## Projets

*(Cette section est automatiquement mise à jour par la CLI)*
