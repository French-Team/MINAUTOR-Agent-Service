# Améliorations pour Agents - Phase 3 : Structuration et Indexation des Profils

## Contexte
Après la mise en place du système de profils automatisé, nous passons à une phase de structuration rigoureuse de la "banque de profils". L'objectif est de rendre la navigation et la sélection des profils plus claires pour l'agent de création via des fichiers d'index et une convention de nommage stricte.

---

## 1. Structure d'Indexation

### Index Principal (`data/profiles/INDEX.md`)
Regroupe un lexique global classé par type :
- **Agents** : Assistants conversationnels.
- **Daemons** : Tâches de fond et surveillance.
- **Bots** : Automatisation et exécution rapide.

### Index Secondaires
Chaque dossier (`agents/`, `daemons/`, `bots/`) possède son propre `INDEX.md` contenant :
- Un lexique en haut du fichier listant tous les profils présents.
- Une description courte de l'utilité de chaque profil.

---

## 2. Convention de Nommage des Profils

Le nom des fichiers de profils doit suivre ce schéma :
`[CATEGORIE]-[ROLE]-[INDEX]`

- **CATEGORIE** : Domaine technique ou métier (ex: PYTHON, CSS, BACK, FRONT, DOC).
- **ROLE** : Fonction spécifique (ex: expert, helper, watcher).
- **INDEX** : Numéro de création sur 2 chiffres (ex: 01, 02).

**Exemples :**
- `PYTHON-expert-01.json`
- `CSS-layout-01.json`
- `CSS-animation-02.json` (si un profil CSS-animation-01 existe déjà)

---

## 3. Workflow de Maintenance
1. Lors de l'ajout d'un profil, vérifier le dernier index utilisé pour la paire CATEGORIE-ROLE.
2. Mettre à jour l'index secondaire du dossier concerné.
3. Mettre à jour l'index principal si une nouvelle catégorie est introduite.

---

## 4. Phase 0 : Préparation & Recherche en Amont

Avant toute ligne de code, le système doit suivre ce workflow d'intelligence :

1. **Recherche en Amont** :
   - `RESEARCH-web-01` : Explore les meilleures pratiques et documentations externes.
   - `RESEARCH-code-01` : Analyse les librairies et code open-source.
   - `RESEARCH-file-01` : Cartographie la codebase existante pour éviter les doublons.
   
2. **Planification & Stratégie** :
   - `PLAN-strategy-01` : Définit la "Source de Vérité" (Master Plan).
   - `PLAN-architecture-01` : Valide les choix technologiques.
   - `PLAN-task-01` : Découpe en tâches atomiques.

3. **Constitution de l'Équipe** :
   - `TEAM-creator-01` : Sélectionne les micro-profils nécessaires.
   - `TEAM-leader-01` : Désigne les responsables et coordonne les sous-tâches en parallèle.

---

## 5. Fichiers à créer (vides pour l'instant)
- `data/profiles/INDEX.md`
- `data/profiles/agents/INDEX.md`
- `data/profiles/daemons/INDEX.md`
- `data/profiles/bots/INDEX.md`
