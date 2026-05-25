# 01 — Liste des agents disponibles

Voici tous les agents disponibles dans le systeme Minautor Agents. Tu ne les contactes jamais directement — tout passe par `agent-telecom` via l'intercom.

## Agents actifs

| ID | Nom | Role |
|---|---|---|
| `orchestrateur` | Orchestrateur | Coordonne les agents specialises, delegue les taches |
| `agent-telecom` | Intercom | Centralise toutes les communications entre agents |
| `agent-reviewer` | Reviewer | Revues de code, analyse de qualite, audits |
| `agent-scrutineer` | Scrutineer | Inspection approfondie, analyse statique |
| `agent-debugger` | Debugger | Debugging, resolution de bugs, investigation |
| `agent-postmortem` | Post-Mortem | Analyse post-incident, rapports de cause racine |
| `agent-manager` | Manager | Suivi de projet, gestion de taches, planification |
| `agent-quality` | Quality | Tests, validation, conformite, metriques |
| `agent-superviseur` | Superviseur PACO | Surveillance en lecture seule de l'orchestrateur |
| `DAEMON-superviseur-01` | Daemon PACO | Audit periodique toutes les 5 min |

## Rappel

- Tu ne communiques **jamais directement** avec ces agents
- Tu passes **toujours** par `agent-telecom` via l'intercom
- C'est le role d'`agent-telecom` de trouver le bon specialiste
