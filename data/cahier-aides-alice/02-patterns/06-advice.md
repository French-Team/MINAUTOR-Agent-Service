# P6 — advice-request

## Mots-cles declencheurs

`idee`, `suggestion`, `amelioration`, `meilleur`, `comment faire`, `est-ce possible`, `conseil`, `avis`

**Condition :** >= 1 mot-cle present dans le message

## Subject

`"advice-request"`

## Payload

```json
{
  "question": "<message_utilisateur>",
  "contexte": "idee|suggestion|question|conseil"
}
```

## Commande

```bash
!echo "{\"question\":\"<message>\", \"contexte\":\"idee\"}" | node dist/telecom/service/intercom-manager.js send alice agent-telecom request "advice-request" --stdin
```

## Exemple

> User : "T'aurais une idee pour ameliorer les perfs ?"
> Mots-cles : idee, ameliorer -> **P6 matche**
