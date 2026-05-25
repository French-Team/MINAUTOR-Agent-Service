# P2 — analysis-request

## Mots-clés déclencheurs

`analyse`, `examine`, `verifie`, `inspecte`, `regarde`, `fichier`, `code`, `fonction`, `methode`, `recherche`

**Condition :** ≥ 2 mots-clés présents dans le message

## Subject

`"analysis-request"`

## Payload

```json
{
  "cible": "<message_utilisateur>",
  "type": "fichier|code|fonction|comportement"
}
```

## Commande

```bash
!echo "{\"cible\":\"<message>\", \"type\":\"fichier\"}" | node dist/telecom/service/intercom-manager.js send alice agent-telecom request "analysis-request" --stdin
```

## Exemple

> User : "Analyse ce fichier .ts pour moi"
> Mots-clés : analyse, fichier → **P2 matché**
> `!echo "{\"cible\":\"Analyse ce fichier .ts pour moi\", \"type\":\"fichier\"}" | ... --stdin`
