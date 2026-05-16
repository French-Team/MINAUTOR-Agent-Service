# Améliorations pour Agents - Phase 2 : Système de Profils

## Contexte
Actuellement, lors de la création d'un agent, le système utilise des templates génériques. L'intelligence de l'agent (ou l'utilisateur) décide du contenu des instructions et des configurations. Cela peut mener à des comportements incohérents ou non désirés.

L'objectif de cette phase est de mettre en place une "banque de profils" prédéfinis. Un profil contient des instructions système, des contraintes et des configurations spécifiques (Guardian, Self-Correction, etc.) validées pour un cas d'usage précis.

---

## 1. Structure de Stockage

Les profils seront stockés dans `data/profiles/` organisés par type :
- `data/profiles/agents/` : Profils pour les assistants et agents conversationnels standard.
- `data/profiles/daemons/` : Profils pour les agents d'arrière-plan (background/timer).
- `data/profiles/bots/` : Profils pour les bots spécialisés (fast bots, automation).

Chaque profil sera un fichier `.json` ou `.ts` exportant une configuration partielle d'agent.

---

## 2. Format d'un Profil

Un profil (ex: `researcher.json`) contiendra :
```json
{
  "profileName": "researcher",
  "instructionsPrefix": "Tu es un agent spécialisé dans la recherche d'informations...",
  "constraints": [
    "Vérifie toujours tes sources",
    "Ne fais pas de suppositions"
  ],
  "defaultConfig": {
    "selfCorrection": { "enabled": true, "validateOutput": true },
    "guardian": { "enabled": true, "blockHarmful": true }
  }
}
```

---

## 3. Workflow de Création Automatisé

L'utilisateur ne fournit que trois informations :
1. Le **Provider** LLM.
2. Le **Modèle** LLM.
3. La **Description** (mission) de l'agent en langage naturel.

À partir de là, l'agent de création ("Scaffold Agent") prend le relais de manière autonome :
1. **Attribution du Nom** : Sélectionne un nom de dieu grec cohérent avec la description via `data/agent-name/greek-gods.json`.
2. **Choix du Template** : Détermine si l'agent doit être un `standard`, un `fast-bot` ou un `daemon` en fonction des besoins détectés dans la description.
3. **Sélection du Profil** : Parcourt la banque de profils (`data/profiles/`) et choisit le profil le plus adapté pour garantir un comportement optimal et sécurisé.
4. **Génération & Certification** : Fusionne le tout et lance le cycle de validation habituel.

---

## 4. Fichiers à modifier / créer

### Logic de Décision
- `src/cli.ts` : Supprimer les étapes de sélection manuelle (Template/Profil) et implémenter la logique de décision par LLM.
- `src/agents.ts` : S'assurer que `scaffoldAgent` supporte bien les profils chargés dynamiquement.

---

## 5. Exemples de Profils à créer

### Agents
- `assistant-general` : Polyvalent et poli.
- `expert-code` : Strict sur la syntaxe et les bonnes pratiques.

### Daemons
- `monitor-system` : Focus sur les logs et les alertes.
- `timer-reminder` : Simple et périodique.

### Bots
- `task-automator` : Rapide, exécute des commandes shell en série.

---

## Prochaines Étapes
1. Création de l'arborescence `data/profiles`.
2. Rédaction des premiers profils de référence.
3. Mise à jour de `scaffoldAgent` pour accepter un `profilePath`.
4. Intégration dans le flux `/create` du CLI.
