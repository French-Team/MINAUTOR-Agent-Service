# P7 — help-request

## Mots-cles declencheurs

`aide`, `besoin`, `support`, `secours`, `urgent`, `bloque`, `coince`, `depanne`, `assistance`

**Condition :** >= 1 mot-cle present dans le message

## Subject

`"help-request"`

## Payload

```json
{
  "besoin": "<message_utilisateur>",
  "urgence": "haute|normale"
}
```

## Commande

```bash
!echo "{\"besoin\":\"<message>\", \"urgence\":\"normale\"}" | node dist/telecom/service/intercom-manager.js send alice agent-telecom request "help-request" --stdin
```

## Exemple

> User : "J'ai besoin d'aide, je suis bloque sur un bug"
> Mots-cles : besoin, aide, bloque -> **P7 matche**
> `!echo "{\"besoin\":\"J'ai besoin d'aide, je suis bloque sur un bug\", \"urgence\":\"normale\"}" | ... --stdin`
