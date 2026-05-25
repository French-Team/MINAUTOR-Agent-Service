---
name: skill-telecom
description: Protocole de communication inter-agents via Intercom, Mémoire Vive et Mémoire Papiers
---

# Skill Télécom — Protocole de communication

## Résumé

Ce protocole standardise les communications entre tous les agents du système Minautor Agents.
Tout agent qui charge cette skill s'engage à respecter les règles de l'Intercom.

## Principes

1. **Un seul point d'entrée** : agent-telecom est l'unique routeur de messages
2. **Communication écrite** : tout passe par des fichiers JSON dans telecom/intercom/
3. **Mémoire à deux niveaux** : vive (volatile) et papiers (persistante)
4. **Pas de communication directe** : les agents ne se parlent jamais directement

## Canaux

| Canal | Emplacement | Persistance | Usage |
|---|---|---|---|
| Intercom | telecom/intercom/ | Messages traités puis archivés | Communications actives |
| Mémoire Vive | telecom/memoire-vive/ | Volatile, nettoyée périodiquement | Données temporaires de session |
| Mémoire Papiers | telecom/papiers/<id>/ | Permanente | Données durables |
| Dossier Agent | telecom/agents/<id>/ | Permanente | Scripts et ressources |

## Pour les agents

En tant qu'agent utilisant cette skill :

1. **Écris dans telecom/intercom/** pour envoyer un message à agent-telecom
2. **Lis telecom/intercom/** pour recevoir les messages d'agent-telecom
3. **Stocke dans telecom/memoire-vive/<ton-id>/** les données temporaires
4. **Stocke dans telecom/papiers/<ton-id>/** les données persistantes
5. **Utilise telecom/agents/<ton-id>/** pour tes scripts et ressources
6. **Consulte telecom/templates/protocol.md** pour le protocole complet

## Commandes intercom

```bash
# Envoyer un message
node dist/telecom/service/intercom-manager.js send <from> <to> <type> <subject> '<payload-json>'

# Lire les messages
node dist/telecom/service/intercom-manager.js read <agent-id>

# Écrire en mémoire vive
node dist/telecom/service/intercom-manager.js write-vive <agent-id> <sujet> '<donnees-json>'

# Écrire un papier
node dist/telecom/service/intercom-manager.js write-papier <agent-id> <categorie> <nom> <contenu>
```
