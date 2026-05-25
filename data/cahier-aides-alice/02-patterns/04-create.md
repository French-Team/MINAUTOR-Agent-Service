# P4 — create-request

## Mots-clés déclencheurs

`cree`, `fais`, `developpe`, `implemente`, `ecris`, `code`, `genere`, `construit`, `nouveau`, `creez`, `fabrique`

**Condition :** ≥ 1 mot-clé + description suffisante

## Subject

`"create-request"`

## Payload

```json
{
  "demande": "<message_utilisateur>",
  "type": "script|fichier|fonction|projet"
}
```

## Commande

```bash
!echo "{\"demande\":\"<message>\", \"type\":\"script\"}" | node dist/telecom/service/intercom-manager.js send alice agent-telecom request "create-request" --stdin
```

## Exemple

> User : "Fais un script de backup pour ma DB"
> Mots-clés : fais, script → **P4 matché**
> `!echo "{\"demande\":\"Fais un script de backup pour ma DB\", \"type\":\"script\"}" | ... --stdin`
