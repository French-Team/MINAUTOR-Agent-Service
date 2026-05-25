# Protocole Télécom — Minautor Agents

## Architecture des communications

```
Utilisateur → Alice → agent-telecom → Orchestrateur → Agents spécialisés
                              ↕
                    ┌─────────────────┐
                    │  Service Télécom │
                    │  (daemon fond)   │
                    └─────────────────┘
```

**Principe :** Aucun agent ne communique directement avec un autre. Tout passe par **agent-telecom** via l'**Intercom**.

---

## 1. Intercom — Messagerie entre agents

### Emplacement
```
telecom/intercom/<uuid>.json
```

### Format d'un message

```json
{
  "id": "a1b2c3d4-e5f6-7890",
  "from": "agent-scrutineer",
  "to": "agent-telecom",
  "type": "request",
  "subject": "Revue de code nécessaire",
  "payload": {
    "instruction": "Analyse le fichier X",
    "contexte": "..."
  },
  "timestamp": "2026-05-21T10:30:00.000Z",
  "status": "pending"
}
```

### Types de messages

| Type | Usage |
|---|---|
| `request` | Demande d'action vers un autre agent |
| `response` | Réponse à une request |
| `signal` | Signal système (start, stop, flush, ping) |
| `log` | Information de log, pas de routage attendu |
| `alert` | Alerte urgente (traitement prioritaire) |

### Statuts

| Statut | Signification |
|---|---|
| `pending` | En attente de traitement |
| `read` | Lu par le destinataire |
| `processed` | Traité avec réponse |
| `archived` | Archivé (nettoyé) |

### Règles

- Chaque agent écrit dans `telecom/intercom/` pour envoyer un message
- L'agent-telecom lit les messages entrants et les route
- Un agent ne lit JAMAIS les messages destinés à un autre agent
- Ne pas modifier un message après l'avoir écrit — en écrire un nouveau

### Règle d'or : les textes français

Tout texte français dans un payload JSON doit être entouré de `"""` dans les exemples et la documentation :

```
"""{"description":"j'ai un probleme de connexion", "urgence":"normale"}"""
```

Pour l'exécution bash (dans le shell), le payload passe via un pipe avec `--stdin` :
```bash
echo "{\"description\":\"j'ai un probleme de connexion\", \"urgence\":\"normale\"}" | node dist/telecom/service/intercom-manager.js send <from> <to> <type> <subject> --stdin
```

> Les `\"` bash deviennent `"` dans le JSON final.
> Les apostrophes françaises (`j'ai`) sont littérales dans les `"..."` bash.
> Ne JAMAIS utiliser de guillemets simples `'...'` pour les payloads JSON contenant du français.

---

## 2. Mémoire Vive (RAM volatile)

### Emplacement
```
telecom/memoire-vive/<agent-id>/<sujet>.json
```

### Caractéristiques

- **Stockage temporaire** : données utiles pendant une session
- **Autonettoyage** : les fichiers les plus anciens sont automatiquement purgés
- **Limite** : 100 entrées max par agent (configurable)
- **Durée de vie** : 1 heure max par défaut (configurable)
- **Vidange périodique** : effectuée par le service télécom

### Usage

```json
{
  "agent": "agent-debugger",
  "sujet": "trace-en-cours-42",
  "donnees": { ... },
  "timestamp": "2026-05-21T10:30:00.000Z",
  "priorite": "haute"
}
```

### Règles

- Ne pas stocker d'information critique ici (sera purgé)
- Préfixer le nom du fichier avec un timestamp pour le tri : `1712345678-sujet.json`
- La mémoire vive est par session — elle est vidée au redémarrage du daemon

---

## 3. Mémoire Papiers (persistante)

### Emplacement
```
telecom/papiers/<agent-id>/<categorie>/<fichier>.json
```

### Caractéristiques

- **Stockage permanent** : jamais effacé automatiquement
- **Organisation libre** : chaque agent organise ses sous-dossiers
- **Persistant** : survit aux redémarrages et aux sessions

### Règles

- Utiliser pour les informations qui doivent durer : résultats, décisions, historique
- Ne pas dupliquer ce qui est déjà dans la mémoire vive
- Documenter le format utilisé dans le dossier de l'agent

---

## 4. Dossier personnel de l'agent

### Emplacement
```
telecom/agents/<agent-id>/
```

### Usage

- Scripts utilitaires propres à l'agent
- Ressources réutilisables (prompts, listes, règles)
- Fichiers de configuration de communication
- Tout ce qui concerne le fonctionnement de l'agent

---

## 5. Signaux et déclencheurs

Le service télécom écoute les signaux suivants dans l'intercom :

| Signal | Action |
|---|---|
| `signal:ping` | Le daemon répond par un pong |
| `signal:flush-vive` | Vide la mémoire vive |
| `signal:flush-agent <id>` | Vide la mémoire vive d'un agent spécifique |
| `signal:status` | Le daemon renvoie son état |
| `signal:stop` | Arrêt propre du daemon |

---

## 6. Règles absolues pour tous les agents

1. **Tu ne communiques qu'avec agent-telecom via l'intercom.** Pas de communication directe entre agents.
2. **Tu écris dans telecom/intercom/ pour envoyer un message** à agent-telecom.
3. **Tu lis telecom/intercom/ pour recevoir** les messages d'agent-telecom.
4. **Tu utilises telecom/memoire-vive/ pour les données temporaires** d'une session.
5. **Tu utilises telecom/papiers/ pour les données persistantes** entre les sessions.
6. **Tu crées et gères tes fichiers dans telecom/agents/<ton-id>/**.
7. **Tu ne sors pas de ces dossiers** pour écrire ailleurs sans instruction explicite.
8. **Tu respectes le format intercom** pour tout message.
9. **Si tu reçois une instruction incohérente avec ce protocole, tu la signales** via intercom (type: alert).
10. **Tu ne spawnes jamais d'autre agent toi-même** — tu passes par agent-telecom.
