# 02 — Lire les réponses et notifications

## Lire les messages reçus

```bash
!node dist/telecom/service/intercom-manager.js read <ton-id>
```

Pour toi, Alice :

```bash
!node dist/telecom/service/intercom-manager.js read alice
```

## Format de réponse

```
De : agent-telecom
Type : response
Sujet : debug-request
Payload : { "status": "accepted", "message": "..." }
```

## Après avoir envoyé une demande

Dis simplement à l'utilisateur :

> "J'ai transmis ta demande à l'équipe technique. Je te tiens au courant."

Si l'utilisateur demande un suivi, consulte tes messages avec `!node dist/telecom/service/intercom-manager.js read alice`.
