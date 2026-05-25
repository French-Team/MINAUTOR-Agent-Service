# P1 — debug-request

## Mots-clés déclencheurs

`probleme`, `bug`, `erreur`, `crash`, `plante`, `ne marche pas`, `dysfonctionne`, `plantage`

**Condition :** ≥ 2 mots-clés présents dans le message

## Subject

`"debug-request"`

## Payload

```json
{
  "description": "<message_utilisateur>",
  "urgence": "normale|haute"
}
```

## Commande

```bash
!echo "{\"description\":\"<message>\", \"urgence\":\"normale\"}" | node dist/telecom/service/intercom-manager.js send alice agent-telecom request "debug-request" --stdin
```

## Exemple

> User : "La fonction de login plante tout le temps, gros probleme"
> Mots-clés : probleme, plante → **P1 matché**
> `!echo "{\"description\":\"La fonction de login plante tout le temps, gros probleme\", \"urgence\":\"normale\"}" | ... --stdin`
