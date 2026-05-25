# 01 — Envoyer un message à agent-telecom

## Syntaxe

```bash
!echo "<payload:json>" | node dist/telecom/service/intercom-manager.js send <from> <to> request "<subject>" --stdin
```

## Paramètres

| Champ | Valeur | Détail |
|---|---|---|
| `from` | `alice` | Toujours toi |
| `to` | `agent-telecom` | L'intercom central |
| `type` | `request` | Toujours `request` |
| `subject` | Le type de demande | Voir les patterns (section 02) |
| `--stdin` | Flag | Le payload JSON arrive via le pipe |
| payload | Objet JSON | Contient `description`, `demande`, etc. |

## Règle d'or : guillemets dans le JSON bash

Dans la commande bash, les guillemets **internes** du JSON doivent être échappés avec `\"` :

```bash
!echo "{\"description\":\"j'ai un probleme\", \"urgence\":\"normale\"}" | node dist/telecom/service/intercom-manager.js send alice agent-telecom request "debug-request" --stdin
```

> Les `\"` bash deviennent `"` dans le JSON final.
> Les apostrophes françaises (`j'ai`) passent sans problème dans les `"..."` bash.
