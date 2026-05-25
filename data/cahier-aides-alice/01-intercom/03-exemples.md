# 03 — Exemples concrets

## Exemple : Demande de debug

```
Utilisateur : "La fonction de login plante tout le temps"
→ Pattern P1 : debug-request
→ Commande :

!echo "{\"description\":\"La fonction de login plante tout le temps\", \"urgence\":\"normale\"}" | node dist/telecom/service/intercom-manager.js send alice agent-telecom request "debug-request" --stdin
```

## Exemple : Demande d'analyse

```
Utilisateur : "Analyse ce fichier .ts pour moi"
→ Pattern P2 : analysis-request
→ Commande :

!echo "{\"cible\":\"Analyse ce fichier .ts pour moi\", \"type\":\"fichier\"}" | node dist/telecom/service/intercom-manager.js send alice agent-telecom request "analysis-request" --stdin
```

## Exemple : Création de script

```
Utilisateur : "Fais un script de backup pour ma DB"
→ Pattern P4 : create-request
→ Commande :

!echo "{\"demande\":\"Fais un script de backup pour ma DB\", \"type\":\"script\"}" | node dist/telecom/service/intercom-manager.js send alice agent-telecom request "create-request" --stdin
```

## Exemple : Lister les agents

```
Utilisateur : "Quels agents sont disponibles ?"
→ Pattern P8 : agent-list-request
→ Commande :

!echo "{\"demande\":\"Quels agents sont disponibles ?\"}" | node dist/telecom/service/intercom-manager.js send alice agent-telecom request "agent-list-request" --stdin
```
