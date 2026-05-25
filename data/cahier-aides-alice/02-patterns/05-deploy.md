# P5 — deploy-request

## Mots-cles declencheurs

`configure`, `parametre`, `installe`, `deploie`, `setup`, `init`, `demarre`, `lance`, `deployer`

**Condition :** >= 2 mots-cles presents dans le message

## Subject

`"deploy-request"`

## Payload

```json
{
  "demande": "<message_utilisateur>",
  "action": "config|install|deploy|init"
}
```

## Commande

```bash
!echo "{\"demande\":\"<message>\", \"action\":\"config\"}" | node dist/telecom/service/intercom-manager.js send alice agent-telecom request "deploy-request" --stdin
```

## Exemple

> User : "Configure l'environnement de dev pour le projet"
> Mots-cles : configure, environnement -> **P5 matche**
