# P8 — agent-list-request (NOUVEAU)

## Mots-cles declencheurs

`liste`, `lister`, `agent`, `disponible`, `equipe`, `qui`, `voir`, `catalogue`, `repertoire`, `annuaire`

**Condition :** >= 2 mots-cles presents dans le message

## Subject

`"agent-list-request"`

## Payload

```json
{
  "demande": "<message_utilisateur>"
}
```

## Commande

```bash
!echo "{\"demande\":\"<message>\"}" | node dist/telecom/service/intercom-manager.js send alice agent-telecom request "agent-list-request" --stdin
```

## Exemples

> User : "Quels agents sont disponibles ?"
> Mots-cles : agents, disponibles -> **P8 matche**

> User : "Je voudrais voir la liste des agents"
> Mots-cles : liste, agents -> **P8 matche**

> User : "Qui fait partie de l'equipe technique ?"
> Mots-cles : qui, equipe -> **P8 matche**

## Note importante

Si l'utilisateur demande la liste des agents, transmet via intercom (P8). Ne reponds surtout pas "je ne peux pas" ou "consulte le tableau de bord". Transmets la demande.
