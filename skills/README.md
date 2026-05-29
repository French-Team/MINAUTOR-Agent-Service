# Skills

Les skills sont des jeux d'instructions réutilisables que les agents peuvent charger via la commande `/skill` ou `!skill`.

## Structure

```
skills/
├── README.md
└── <skill-name>/
    └── SKILL.md
```

## Créer une skill

1. Crée un dossier avec le nom de la skill (minuscules, chiffres et tirets) :
   ```
   skills/ma-skill/
   ```

2. Crée un fichier `SKILL.md` avec frontmatter YAML :
   ```markdown
   ---
   name: ma-skill
   description: Description courte de ce que fait la skill
   ---

   # Ma Skill

   Instructions détaillées pour l'agent...
   ```

## Frontmatter

| Champ | Requis | Description |
|-------|--------|-------------|
| `name` | Oui | Nom de la skill (doit correspondre au nom du dossier) |
| `description` | Oui | Description utilisée pour le chargement |

## Commandes CLI

- `/skills` — Liste toutes les skills disponibles
- `/skills load <name>` — Charge et affiche le contenu d'une skill

## Skills incluses

- `skill-alice` — Lexique des scripts Alice (salutations, présentation, routage)
