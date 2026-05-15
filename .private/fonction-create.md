# Analyse du workflow `/create` dans Hermes Agent Engine

## Description générale
La commande `/create` permet de créer un nouvel agent avec un workflow interactif guidé et certifié :

1. **Phase 1 : Provider & Sécurité**
   - Sélection du provider LLM
   - Configuration et **validation immédiate** de la clé API
2. **Phase 2 : Modèle & Connectivité**
   - Sélection du modèle parmi ceux disponibles pour le provider validé
   - **Test de connexion complet** (Hello World LLM)
3. **Phase 3 : Identification de l'agent**
   - Saisie de l'ID (format kebab-case strict)
   - Saisie du nom affiché
   - Saisie de la description (min. 10 mots)
4. **Phase 4 : Création & Certification**
   - Génération de la skill via LLM
   - **Nettoyage intelligent** : Suppression automatique des bavardages du LLM (texte avant/après les blocs de code ou le frontmatter).
   - Enregistrement de l'agent (Scaffold) avec injection des instructions de la skill.
   - **Validation itérative** (max 3 cycles) via scripts de validation et "Golden Rules".
   - Certification finale et affichage du certificat.

## Résilience du Parsing
Le système utilise désormais des expressions régulières robustes pour extraire le frontmatter YAML des skills, supportant :
- Les sauts de ligne Windows (CRLF) et Linux (LF).
- Les textes introductifs générés par certains modèles LLM.
- Les blocs de code markdown (` ```markdown `) qui enveloppent parfois la réponse.

## Étapes détaillées

### 1. Phase 1 : Choix du Provider et Validation Clé
- Sélection parmi Kilo, Google, OpenRouter, Opencode Zen, Ollama, LM Studio, Custom.
- Demande de clé API si requise.
- **Validation Clé** : Appel à `fetchModels()` pour vérifier que la clé est fonctionnelle.
- Enregistrement immédiat dans `providers.json` si valide.

### 2. Phase 2 : Sélection du Modèle et Test Connexion
- Récupération des modèles réels via le provider validé.
- Sélection par l'utilisateur.
- **Test Connexion** : Appel à `testConnection()` pour valider la chaîne complète (Provider + Clé + Modèle).

### 3. Phase 3 : Identification de l'agent
- Prompt pour l'ID de l'agent (ex: mon-agent)
- Validation : ID non vide, format kebab-case (`^[a-z0-9]+(-[a-z0-9]+)+$`), doit contenir au moins un tiret.
- Prompt pour le nom affiché (boucle jusqu'à saisie non vide).
- Prompt pour la description (boucle jusqu'à saisie d'au moins 10 mots - règle "agent-description-length").

### 4. Phase 4 : Création et Certification
Cette phase est itérative (max 3 tentatives d'auto-correction) :
- **Génération Skill** : Utilisation du modèle validé pour créer `skills/skill-{id}/SKILL.md`.
- **Scaffold Agent** : Création de `.agents/{id}.ts` en utilisant le template LLM et en injectant le contenu de la skill comme instructions.
- **Validation & Golden Rules** : 
  - Exécution des scripts de validation (structure skill, existence fichiers).
  - Vérification de la conformité aux règles définies dans `data/golden-rules/`.
- **Auto-correction** : En cas d'échec, le système tente de re-générer la skill ou le scaffold avec les corrections nécessaires.

### 5. Résultat final et Certification
- Si succès : Affichage du certificat de certification avec statut **CERTIFIÉ**.
- Si échec : Message d'erreur détaillé invitant à une correction manuelle.

## Points clés du workflow

### Sécurité et Robustesse
- **Fail-fast** : On ne choisit pas de modèle si la clé API n'est pas validée.
- **Validation itérative** : 3 cycles complets pour garantir que les fichiers générés par l'IA respectent les contraintes techniques.
- **Injection de Skill** : L'agent possède nativement sa mission grâce à l'injection directe du contenu de la skill dans son prompt système.

## Fichiers et fonctions clés
- `handleCreate()` dans `src/cli.ts` : Orchestrateur du workflow.
- `generateSkill()` & `validateIntegration()` dans `src/generate-skill.ts`.
- `scaffoldAgent()` dans `src/agents.ts`.
- `fetchModels()` & `testConnection()` dans `src/providers.ts`.
- Templates dans `data/templates/`.
- Golden Rules dans `data/golden-rules/`.