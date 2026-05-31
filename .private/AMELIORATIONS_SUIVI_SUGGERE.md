# AMÉLIORATIONS POSSIBLES POUR LE « SUIVI SUGGÉRÉ »

Ce document décrit plusieurs pistes d’amélioration pour le mécanisme de suivi suggéré (suivi suggéré) du service Minautor Agent Service. Ces idées visent à rendre les suggestions plus pertinentes, personnalisées et utiles pour l’utilisateur, tout en restant dans l’esprit du système basé sur des scripts prédéfinis (sans inférence LLM en temps réel).

---

## 1. Suggestions dynamiques en fonction de l’état réel du projet

### Problème
Actuellement, les suggestions sont statiques et codées en dur dans l’instruction `switch` de la fonction `getFollowUpSuggestions`. Elles ne tiennent pas compte de l’état réel du projet (par exemple, les domaines effectivement utilisés, les tâches existantes, les blocages, etc.).

### Solution
- **Lire le tableau de tâches du projet** (`.tasks.json`) pour :
  - Déduire les domaines (`area`) réellement présents dans le projet et les utiliser dans les suggestions (au lieu de supposer des domaines génériques comme `backend`, `frontend`).
  - Adapter les suggestions en fonction du statut des tâches (par exemple, ne pas suggérer de « débloquer » si aucune tâche n’est bloquée).
  - Générer des suggestions de filtrage pertinentes (ex. : « liste les tâches en attente de revue » si des tâches ont le statut `review`).

### Exemple
Si le projet `mon-projet` contient des tâches dans les domaines `api`, `ui` et `db`, alors la suggestion :
```
→ déplace la tâche "..." dans <domaine> au projet mon-projet
```
devient :
```
→ déplace la tâche "..." dans api au projet mon-projet
→ déplace la tâche "..." dans ui au projet mon-projet
→ déplace la tâche "..." dans db au projet mon-projet
```
(ou mieux : un menu permettant de choisir le domaine parmi ceux effectivement présents).

### Fichiers concernés
- `src/telecom/service/telecom-daemon.ts` (fonction `getFollowUpSuggestions`)
- Possiblement un nouvel utilitaire pour lire le tableau de tâches.

---

## 2. Suggestions d’initialisation pour un projet vide

### Problème
Lorsqu’un projet vient d’être créé et ne contient encore aucune tâche (ni README, ni configuration), le suivi suggéré ne propose aucune action d’initialisation pertinente. L’utilisateur doit alors savoir quoi faire ensuite sans aide contextuelle.

### Solution
Dans `getFollowUpSuggestions`, lorsqu’on détecte que le projet existe mais que son tableau de tâches est vide (ou qu’aucun fichier `README` n’est présent), ajouter des suggestions d’initialisation telles que :
- « définis les objectifs du projet »
- « choisis un langage / un framework »
- « crée un README initial »
- « établis une liste de fonctionnalités principales »
- « configure l’environnement de développement »

Ces suggestions seraient affichées en priorité lorsqu’aucune tâche n’est encore définie.

### Implémentation
- Lire le fichier `.tasks.json` du projet pour vérifier si `tasks.length === 0`.
- Optionnellement, vérifier l’absence de `README.md` à la racine du workspace.
- Ajouter un bloc de suggestions spécifiques dans `getFollowUpSuggestions` (par exemple, après les suggestions communes mais avant le `switch` sur le nom du script).

### Fichiers concernés
- `src/telecom/service/telecom-daemon.ts`

---

## 3. Apprentissage léger basé sur les choix de l’utilisateur

### Problème
Les suggestions sont toujours présentées dans le même ordre, indépendamment des habitudes de l’utilisateur. Certaines actions fréquentes pourraient être mises en avant pour réduire le nombre de choix nécessaires.

### Solution
- Tenir un compteur simple (dans un fichier JSON tel que `telecom/suggestion_stats.json`) qui enregistre combien de fois chaque suggestion a été choisie.
- Lors de la génération des suggestions, les trier par fréquence décroissante (les plus choisies en premier).
- Pour éviter que le système ne s’enferme dans une boucle, ajouter un petit facteur de découverte (ex. : mélanger légèrement l’ordre après un certain nombre de choix).

### Avantages
- L’utilisateur voit plus rapidement les actions qu’il utilise réellement.
- Aucun apprentissage complexe : juste un comptage et un tri.

### Inconvénients à gérer
- Nécessite de gérer la persistance et la concurrence (le fichier de stats peut être lu/écrit depuis plusieurs sessions).
- Doit être désactivable ou réinitialisable (via une commande ou un fichier de configuration).

### Fichiers concernés
- `src/telecom/service/telecom-daemon.ts` (pour lire/écrire les stats lorsqu’une suggestion est exécutée)
- `src/cli-suggestions.ts` (pour incrémenter le compteur lorsqu’un choix est fait dans le menu)
- Nouveau fichier : `telecom/suggestion_stats.json` (à créer automatiquement s’il n’existe pas).

---

## 4. Modèles de suggestions configurables

### Problème
Les libellés et les formulations des suggestions sont figés dans le code. Toute modification nécessite un changement de code et une recompilation.

### Solution
- Externaliser les modèles de suggestions dans un fichier de configuration (YAML ou JSON) situé dans `data/suggestions/templates.yaml`.
- Chaque entrée du fichier associe un nom de script à une liste de modèles de suggestion.
- Un modèle de suggestion contient :
  - `label` : le texte affiché dans le menu (ex. : « Renommer la tâche »)
  - `description` : texte secondaire (souvent identique au label)
  - `command` : un modèle avec des placeholders (ex. : `renomme la tâche "{taskId}" en "{newTitle}" au projet {project}`)

### Exemple de `data/suggestions/templates.yaml`
```yaml
add-task:
  - label: "Renommer la tâche"
    description: "Renommer la tâche"
    command: "renomme la tâche \"{taskId}\" en '{newTitle}' au projet {project}"
  - label: "Déplacer la tâche"
    description: "Déplacer la tâche"
    command: "déplace la tâche \"{taskId}\" dans {area} au projet {project}"
  # ... etc.
```

### Avantages
- Permet à un administrateur ou à un utilisateur avancé de personnaliser les suggestions sans toucher au code.
- Facilite la traduction ou l’adaptation à différents workflows.

### Inconvénients
- Ajoute une légère dépendance à la lecture d’un fichier de configuration au démarrage (ou en cache).
- Nécessite de gérer les erreurs de configuration (fichier manquant, mal formé).

### Fichiers concernés
- Nouveau fichier : `data/suggestions/templates.yaml`
- `src/telecom/service/telecom-daemon.ts` (lecture du fichier de templates et utilisation dans `getFollowUpSuggestions`)
- `src/cli-suggestions.ts` (inchangé, car il travaille déjà sur le texte généré)

---

## 5. Regroupement et hiérarchisation des suggestions

### Problème
Lorsque de nombreuses suggestions sont générées, le menu devient long et difficile à scanner. Certaines suggestions sont étroitement liées (ex. : toutes les actions de modification d’une tâche).

### Solution
- Introduire des séparateurs visuels dans le menu (ex. : lignes de titre comme `--- Modification de tâche ---`).
- Grouper les suggestions par catégorie (ex. : « Modification », « Déplacement », « État ») et afficher le groupe seulement s’il contient au moins une suggestion pertinente.
- Permettre à l’utilisateur de développer/réduire un groupe (si le CLI le supporte) ou de naviguer par groupes.

### Implémentation légère
- Dans `getFollowUpSuggestions`, au lieu de retourner une simple liste de lignes, retourner une liste d’objets structurés (comme `Suggestion` dans `cli-suggestions.ts`) avec un champ supplémentaire `group`.
- Dans `cli-suggestions.ts`, lors de l’affichage du menu, insérer une ligne de séparation lorsque le groupe change.

### Avantages
- Améliore considérablement la lisibilité lorsqu’il y a beaucoup de suggestions.
- Reste compatible avec l’actuel mécanisme de choix par numéro (on peut numéroter toutes les suggestions à la plate, les groupes étant purement visuels).

### Fichiers concernés
- `src/telecom/service/telecom-daemon.ts` (changer le type de retour de `getFollowUpSuggestions` pour retourner un tableau d’objets, puis adapter l’appelant)
- `src/cli-suggestions.ts` (adapter `loadSuggestions`/`writeSuggestions` pour travailler avec les nouveaux champs, et modifier l’affichage pour ajouter les séparateurs de groupe)

---

## 6. Suggestions contextuelles au-delà du script exécuté

### Problème
Les suggestions ne tiennent compte que du script qui vient de s’exécuter. Elles pourraient bénéficier d’une vue d’ensemble plus large (ex. : l’état global du système, les projets actifs récemment, les tâches bloquées dans tous les projets, etc.).

### Solution
- Étendre le contexte fourni à `getFollowUpSuggestions` avec des informations globales telles que :
  - La liste des projets ayant des tâches bloquées.
  - Le projet le plus récemment modifié.
  - Les tâches en attente de revue depuis plus de X jours.
- Générer des suggestions transverses comme :
  - « vois les tâches bloquées dans tous les projets »
  - « poursuis le projet le plus récemment actif »
  - « revue les tâches en attente depuis plus de 3 jours »

### Implémentation
- Créer un nouvel utilitaire qui agrège ces informations globales (en lecture rapide des fichiers `.tasks.json` de tous les workspaces).
- Passer cet agrégat en tant que paramètre supplémentaire à `getFollowUpSuggestions`.
- Ajouter un nouveau `case` dans le `switch` (peut-être un `default` enrichi) ou des suggestions supplémentaires après le `switch`.

### Précaution
- Garder cette étape légère pour ne pas ralentir le daemon.
- Utiliser des caches en mémoire si nécessaire.

### Fichiers concernés
- Nouveau fichier : `src/telecom/service/global-context.ts` (ou similaire)
- Modification de `src/telecom/service/telecom-daemon.ts` pour appeler ce nouvel utilitaire et passer le résultat à `getFollowUpSuggestions`
- Mise à jour de la fonction `getFollowUpSuggestions` pour accepter le nouveau paramètre.

---

## 7. Intégration avec les objectifs du projet (roadmap légère)

### Problème
Les suggestions sont purement opérationnelles. Elles ne tiennent pas compte des objectifs de plus haut niveau définis pour le projet (si ils existent).

### Solution
- Si un fichier `data/projects/<project>/goals.yaml` existe (ou similaire), le lire et générer des suggestions qui permettent de faire avancer ces objectifs.
- Exemple d’objectif : « Authentification utilisateur »
  - Suggestions associées : « implémente la connexion », « ajoute la récupération de mot de passe », « écris les tests d’authentification ».

### Implémentation
- Dans `getFollowUpSuggestions`, après avoir vérifié l’état des tâches, chercher un fichier d’objectifs pour le projet.
- Si présent, extraire les objectifs non encore atteints (en comparant avec les tâches terminées) et générer des suggestions correspondantes.

### Avantages
- Lie les actions quotidiennes à la vision du projet.
- Aide l’utilisateur à rester concentré sur ce qui est important.

### Fichiers concernés
- `src/telecom/service/telecom-daemon.ts` (lecture éventuelle du fichier d’objectifs)
- Nouvelle convention de fichier : `data/projects/<project>/goals.yaml` (à définir)

---

## Priorisation des améliorations

Données les contraintes du système (fiabilité, simplicité, absence d’inférence LLM en temps réel), voici un ordre suggéré d’implémentation :

1. **Correction des placeholders** (déjà faite) – critique pour la fonctionnalité de base.
2. **Suggestions d’initialisation pour projet vide** – forte valeur ajoutée pour les nouveaux projets, relativement simple à ajouter.
3. **Modèles de suggestions configurables** – améliore la maintenabilité et la flexibilité sans changer le cœur de l’algorithme.
4. **Lecture dynamique des domaines depuis .tasks.json** – rend les suggestions plus précises et évite les propositions absurdes (ex. : déplacer vers un domaine qui n’existe pas).
5. **Regroupement visuel des suggestions** – améliore l’expérience utilisateur dans le CLI lorsqu’il y a beaucoup de suggestions.
6. **Apprentissage léger basé sur les choix** – nécessite une gestion de persistance mais reste simple conceptuellement.
7. **Suggestions contextuelles globales** – utile pour les environnements multi-projets, mais plus complexe à mettre en place de façon performante.
8. **Intégration avec les objectifs du projet** – plus stratégique, nécessite une définition claire du format d’objectifs et peut être considérée comme une extension majeure.

---

## Notes importantes

- Toute amélioration doit rester **déterministe et basée sur des règles** afin de garantir la fiabilité qui fait la force du système actuel.
- Éviter d’introduire des dépendances lourdes ou des appels réseau/LLM en temps réel dans le chemin critique de génération des suggestions.
- Privilégier les améliorations qui peuvent être testées de façon unitaire et qui n’altèrent pas le comportement existant lorsqu’elles ne sont pas activées (par exemple, via des fichiers de configuration optionnels).
- Documenter clairement toute nouvelle convention de fichier ou de configuration afin que les utilisateurs et les développeurs puissent en tirer parti.

Ces améliorations visent à transformer le suivi suggéré d’un simple mécanisme de rappel d’actions en un véritable assistant contextuel qui aide l’utilisateur à maintenir le cap sur son projet tout en réduisant la charge cognitive liée à la découverte des prochaines étapes possibles.