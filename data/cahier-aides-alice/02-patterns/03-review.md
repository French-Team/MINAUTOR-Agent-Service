# P3 — review-request

## Mots-clés déclencheurs

`review`, `revue`, `relis`, `corrige`, `qualite`, `propre`, `nettoyer`, `ameliorer`, `optimiser`, `audit`

**Condition :** ≥ 2 mots-clés présents dans le message

## Subject

`"review-request"`

## Payload

```json
{
  "description": "<message_utilisateur>",
  "focus": "qualite|performance|securite|style"
}
```

## Commande

```bash
!echo "{\"description\":\"<message>\", \"focus\":\"qualite\"}" | node dist/telecom/service/intercom-manager.js send alice agent-telecom request "review-request" --stdin
```

## Exemple

> User : "Relis mon code et dis-moi si c'est propre"
> Mots-clés : relis, code, propre → **P3 matché**
> `!echo "{\"description\":\"Relis mon code et dis-moi si c'est propre\", \"focus\":\"qualite\"}" | ... --stdin`
