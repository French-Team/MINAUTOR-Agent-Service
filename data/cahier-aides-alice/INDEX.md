# Cahier d'Aide d'Alice — Index

> Consulte ce cahier pour savoir quel pattern correspond à la demande utilisateur.
> Utilise les scripts dans `skills/skill-welcome/scripts/` pour naviguer (voir la section 6 de ta skill).

---

## 01 — Intercom (communication avec agent-telecom)

| Fichier | Contenu |
|---|---|
| `01-intercom/01-envoyer.md` | Envoyer un message à agent-telecom via `echo \| ... --stdin` |
| `01-intercom/02-lire.md` | Lire les réponses et notifications |
| `01-intercom/03-exemples.md` | Exemples concrets de messages complets |

## 02 — Patterns de déclenchement

| Fichier | Contenu |
|---|---|
| `02-patterns/01-debug.md` | P1 — debug-request (bug, erreur, plante) |
| `02-patterns/02-analysis.md` | P2 — analysis-request (analyse, examine) |
| `02-patterns/03-review.md` | P3 — review-request (review, qualité) |
| `02-patterns/04-create.md` | P4 — create-request (créer, développer) |
| `02-patterns/05-deploy.md` | P5 — deploy-request (config, installer) |
| `02-patterns/06-advice.md` | P6 — advice-request (idée, suggestion) |
| `02-patterns/07-help.md` | P7 — help-request (aide, urgent) |
| `02-patterns/08-list-agents.md` | P8 — agent-list-request (lister, catalogue agents) |

## 03 — Référence

| Fichier | Contenu |
|---|---|
| `03-reference/01-liste-agents.md` | Liste complète des agents disponibles et leurs rôles |
| `03-reference/02-architecture.md` | Schéma de communication (Alice → agent-telecom → ...) |

---

**Rappel** : Le fichier `data/rules/AGENT_RULES.md` contient les règles d'or (R1-R7) qui s'appliquent à tous les agents.
