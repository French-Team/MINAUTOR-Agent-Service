# Protocole PACO — Protocole d'Activation par Champ Obligatoire

## 1. Objectif

Empêcher l'orchestrateur (ou tout agent coordinateur) d'exécuter directement des tâches qui appartiennent au domaine d'un agent spécialisé. Le protocole force la délégation via un registre de mots-clés et un superviseur indépendant.

## 2. Principe Fondamental

> **Un agent coordinateur ne produit JAMAIS de livrable. Il ne fait qu'assigner, coordonner et rapporter.**

Si l'orchestrateur produit du code, de la documentation, une analyse technique ou tout autre livrable concret → c'est une **violation PACO**.

## 3. Composants

### 3.1 Registre de Mots-Clés (`keyword-registry.yaml`)
- Fichier YAML lisiable par machine et par humain.
- Chaque entrée associe un ensemble de mots-clés à un agent spécialisé.
- L'orchestrateur DOIT parser ce registre avant chaque action.

### 3.2 Agent-Orchestrateur
- Son `instructionsPrefix` interdit formellement la production directe.
- Avant chaque action : `scan_keywords(task) → agent | null`
- Si match → délégation obligatoire via `@agent-ID: mission{...}`
- Si aucun match → réponse : "Tâche non couverte — intervention humaine requise"
- Outputs autorisés : `tâches_en_cours.json`, messages `@agent`, rapports de coordination.

### 3.3 Agent-Superviseur
- Agent indépendant qui surveille l'orchestrateur en continu.
- Vérifie que chaque tâche traitée a été déléguée (trace dans `tâches_en_cours.json`).
- Détecte les violations : l'orchestrateur produit un livrable direct.
- Actions : alerte → escalade → suspension temporaire de l'orchestrateur.

## 4. Cycle de Délégation PACO

```
Tâche entrante
  │
  ▼
Scan keyword-registry.yaml
  │
  ├── Match trouvé → Délégation @agent-ID
  │                    └── Agent exécute → livrable → validation
  │
  └── Aucun match  → Réponse: "Tâche non couverte — intervention humaine"
                        └── Escalade à l'utilisateur
```

## 5. Règles de Validation PACO

| Règle | Description | Sanction |
|-------|-------------|----------|
| R1 | L'orchestrateur ne produit aucun livrable direct | Violation → alerte superviseur |
| R2 | Toute tâche avec keyword match DOIT être déléguée | Violation → escalade |
| R3 | L'orchestrateur DOIT consulter le registre avant chaque action | Violation → suspension |
| R4 | Le superviseur ne modifie jamais les fichiers (lecture seule) | Violation → désactivation |
| R5 | Les mots-clés sont la source de vérité pour l'aiguillage | MAJ via PR validée |

## 6. Format de Délégation

L'orchestrateur doit utiliser ce format pour toute délégation :

```
@agent-{ID}: mission
## Intrant
{description structurée de la tâche}

## Contexte
{références, dépendances, fichiers concernés}

## Attendus
{critères de succès, format du livrable}
```

## 7. Journal de Bord

L'orchestrateur tient un journal dans `tâches_en_cours.json` :
```json
{
  "task_123": {
    "intrant": "...",
    "keywords_match": ["flexbox", "align-items"],
    "agent_assigne": "CSS-flex-01",
    "statut": "en_cours",
    "timestamp": "2026-05-16T13:00:00Z"
  }
}
```

## 8. Mise à Jour du Registre

- Les mots-clés sont définis dans chaque profil d'agent (champ `keywords`).
- Le registre est regénéré à partir des profils via un script de synchronisation.
- Tout ajout d'agent nécessite une mise à jour du registre (validée par agent-validateur).
