---
name: skill-alice
description: Documentation du dispatcher handle.js — scripts et patterns d'Alice
---

# Skill Alice — Architecture

Cette skill est une **documentation de référence** pour les scripts qu'Alice exécute.
Le routage est 100% géré par `scripts/alice/handle.js` — Alice ne fait qu'appeler ce script.

## Pipeline

```
Message utilisateur
  → handle.js (matching patterns)
    ├─ "bonjour"        → greeting.js      (réponse directe)
    ├─ "bonjour alice"   → presentation.js   (présentation)
    ├─ mot-clé technique → intercom.js       (écrit dans intercom, daemon route)
    └─ autre             → fallback générique
```

## Scripts

| Script | Rôle |
|--------|------|
| `scripts/alice/handle.js` | Dispatcher — reçoit le message, match les patterns, exécute le bon sous-script |
| `scripts/alice/greeting.js` | Réponse greeting simple |
| `scripts/alice/presentation.js` | Présentation complète d'Alice |
| `scripts/alice/intercom.js` | Écrit dans l'intercom système, le daemon route automatiquement |

## Fichiers de configuration

| Fichier | Rôle |
|---------|------|
| `data/cahier-aides-alice/intercom-patterns.json` | Patterns mots-clés → sujets intercom |

## Notes

- Alice **ne route rien**. Elle appelle `handle.js`, qui écrit dans l'intercom si nécessaire.
- Le daemon telecom détecte le message et soit exécute un script (via script-runner), soit spawn l'orchestrateur.
- L'orchestrateur (ou le script-runner) coordonne l'agent spécialisé approprié.
- Aucun nom d'agent d'infrastructure n'est exposé à Alice ou à l'utilisateur.
