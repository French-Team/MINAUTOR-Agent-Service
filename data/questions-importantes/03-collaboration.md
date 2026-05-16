# Collaboration Inter-Agents

Questions sur la façon dont les agents s'articulent et se coordonnent.

---

## Modèle d'orchestration — Réponse

**Centralisé.** L'**Agent-Maître (Orchestrateur)** est le chef d'orchestre : il assigne les tâches, vérifie les dépendances, gère les conflits, et supervise les validations.

- Tous les agents sont au **niveau tactique** — ils n'ont pas le pouvoir de décision
- L'**utilisateur (Fred)** est au-dessus de l'Orchestrateur et peut forcer des overrides via `Agent-docs/override.yaml`
- L'Orchestrateur ne modifie jamais les fichiers source (orchestration pure)
- Décisions clés de l'Orchestrateur : quel agent, quel ordre, priorisation, reassignment en cas d'échec

## Circulation de l'information — Réponse

- **Qui lit quoi ?** L'Orchestrateur lit tout. Chaque agent spécialisé lit uniquement les rapports de son domaine amont (ex: Agent-Novice lit les rapports de Agent-Rétro). L'Agent-Validateur lit tous les rapports finaux.
- **Comment un agent sait qu'il peut commencer ?** Son `statut.json` passe à `"assigné"` via l'Orchestrateur. Le watchdog détecte le changement et déclenche l'agent. Alternative : un fichier apparaît dans `agents/{nom}/inbox/`.
- **Comment trouver un rapport ?** Les rapports sont dans `rapports/{type}/{tâche}_{date}.md`. Le lien est tracé dans `tâches_en_cours.json` (champ `"dépend_de"`). L'agent suit les références du YAML frontmatter.

## Gestion des conflits — Réponse

- **Évitement** : sandbox obligatoire (travail dans `sandbox/` puis `rsync` après validation). Permissions strictes (`permissions.yaml`). L'Orchestrateur bloque toute écriture concurrente sur un même fichier.
- **Un agent peut-il modifier le travail d'un autre ?** **Non** (Règle d'Or #7). Il signale les incohérences, il ne corrige pas.
- **Modification concurrente** : l'Orchestrateur détecte via `tâches_en_cours.json` si deux tâches ciblent le même fichier. Il bloque la seconde jusqu'à résolution de la première. Si nécessaire, escalade humaine.

## Format et standardisation — Réponse

- **Format** : Markdown + YAML frontmatter pour les rapports (lisibilité humaine + parsing automatique). JSON pour les fichiers de statut/état (`tâches_en_cours.json`, `statut.json`). YAML pour les configurations (`permissions.yaml`, `config.yaml`).
- **Champs obligatoires d'un rapport** : `tâche`, `agent`, `date`, `statut`, `version`. Champs optionnels : `dépend_de`, `priorité`, `date_mise_à_jour`.
- **Statuts possibles d'une tâche** :
  | Statut | Description |
  |--------|-------------|
  | `planifiée` | Créée mais pas encore assignée |
  | `assignée` | Assignée à un agent, en attente de début |
  | `en_cours` | L'agent travaille dessus |
  | `en_attente` | Bloquée par une dépendance non résolue |
  | `en_revue` | En cours de revue par les pairs |
  | `en_validation` | En validation finale |
  | `en_rollback` | Restauration d'une version précédente |
  | `terminée` | Mission accomplie, tous critères validés |
  | `bloquée` | Problème nécessitant intervention |
  | `rejetée` | Refusée par validation (retour à l'agent) |
  | `escaladée` | Transférée à un humain |

## Timeout et relance — Réponse

- **Détection** : watchdog vérifie les timestamps de `statut.json`. Si pas de mise à jour depuis 30 min, l'Orchestrateur considère l'agent en timeout.
- **Action** : 1ère relance automatique par l'agent. 2ème échec → réassignment à un autre agent. 3ème échec → escalade humaine.
- **Qui relance ?** L'Orchestrateur via `scripts/reassign_task.py` ou `scripts/escalate_to_human.py`.

## Boucles infinies — Réponse

- **Détection** : compteur de passages dans `tâches_en_cours.json` (champ `"passages"`). Max 3 passages entre agents pour une même tâche.
- **Prévention** : l'Orchestrateur suit l'historique de chaque tâche. Si une tâche revient au même agent > 2 fois, elle est marquée `bloquée`.
- **Action** : escalade humaine immédiate avec rapport détaillant les allers-retours. Un humain analyse la cause racine.

## Parallélisme et agrégation — Réponse

- **Oui**, si les dépendances le permettent. Deux tâches indépendantes sur des fichiers différents peuvent être parallélisées.
- **Fusion** : l'Orchestrateur collecte les rapports de chaque agent parallèle et les agrège. Si des conflits surviennent, il bloque et escalade.
- **Cohérence** : chaque agent travaille dans sa sandbox. L'intégration finale (`rsync`) est séquentielle et ordonnée par l'Orchestrateur. Les tests globaux (`npm test`) valident l'ensemble.

## Traçabilité — Réponse

- **Qui a fait quoi ?** `tâches_en_cours.json` garde l'historique complet (agent, dates, versions, statuts). Git versionne le code et les configurations. Les rapports sont horodatés avec version.
- **Audit trail** : `logs/audit/{agent}.log` avec format : `{date} {agent} [ACTION] {fichier} {résultat}`. Hash SHA-256 pour l'intégrité.
- **Consultation humaine** : oui, tout est en fichiers Markdown/JSON lisibles. L'humain peut suivre le fil dans `tâches_en_cours.json` + `rapports/archive/` + `git log`.

## Signalement de blocage — Réponse

- **Comment ?** L'agent génère un rapport dans `rapports/alertes/{tâche}.md` avec : cause, logs, suggestions. Ou dépose un fichier dans `agents/{nom}/inbox/orchestrateur/`.
- **Qui est notifié ?** L'Orchestrateur en priorité. Si le blocage persiste après 2 tentatives, escalade à l'utilisateur (Fred) via `rapports/à_traiter_manuellement/{tâche}.md`.
- **Canal d'escalade** : fichier dans `rapports/urgent/` + notification (email/Slack si configuré). L'humain consulte, résout, et met à jour le statut.

---

*Document généré le 2026-05-16 — Toutes les questions ont reçu une réponse.*
