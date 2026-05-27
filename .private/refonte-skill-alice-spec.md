# Spec : Refonte de skill-welcome (SKILL.md d'Alice)

## Objectif

Restructurer `skills/skill-welcome/SKILL.md` selon la méthode définie dans `.private/formatage-skill-concept.md` :
sections thématiques avec #tags, index/lexique en haut, format simple et prescriptif.

## Architecture réelle (constatée)

```
User → Alice (parle, oriente)
     → tryRouteIntercom() détection par mots-clés
     → écrit JSON dans telecom/intercom/
     → daemon telecom (src/telecom/telecom-daemon.ts) surveille le dossier
     → agent-telecom (le gardien du système) route via intercom-manager
     → orchestrateur → agent spécialisé
```

- **Alice ne délègue PAS directement** les agents
- **Alice ne gère PAS les projets** activement (lecture seule de workspaces/)
- **Alice ne connaît PAS** les agents spécialisés ni l'orchestrateur
- **Alice parle à l'utilisateur + route vers Intercom** — point final

### Rôle d'agent-telecom (gardien du système Intercom)

`agent-telecom` est le responsable du dossier `telecom/` et de tout ce qui s'y trouve :

- **Intercom** (`telecom/intercom/`) — dossier de messages entre agents
  - Il écrit dans ce dossier pour communiquer
  - Il lit les messages entrants et les route vers le bon agent
- **Services** (`src/telecom/`) — infrastructure du système de communication :
  - `telecom-daemon.ts` — service fond qui surveille `telecom/intercom/`
  - `intercom-manager.ts` — envoi, lecture, routage des messages
  - `context/` — pipeline de contexte (optimiser, nettoyer, résumer)
- **Mémoire vive** (`telecom/memoire-vive/`) — fichiers temporaires (nettoyés après 1h)
- **Papiers** (`telecom/papiers/`) — archives persistantes
- **Dossier personnel** (`telecom/agents/agent-telecom/`) — logs de routage

C'est lui le garant du bon fonctionnement de toute la communication inter-agents.
Alice n'interagit pas avec lui directement — le routeur CLI (`tryRouteIntercom`) écrit
les messages dans `telecom/intercom/` et agent-telecom les traite automatiquement.

## Principe de conception

> "Mâcher le travail pour l'IA" — donner le maximum de capacité avec le minimum
> de réflexion. Instructions structurées, prescriptives, quasi-déterministes.
> Alice ne doit pas "comprendre" la demande en profondeur, elle doit :
> 1. Dire bonjour / dialoguer
> 2. Détecter l'intention via les #tags de la skill
> 3. Router vers Intercom avec le bon sujet
> 4. (Optionnel) Explorer workspaces/ si nécessaire

## Structure du fichier SKILL.md

### Format de l'index (haut du fichier)

Liste à puces avec #tags, permettant à Alice de scanner en < 1 seconde :

```
# Lexique rapide
- #Mission        → rôle, assistance — première lecture seulement
- #Regles         → jamais coder, sécurité — avant chaque action
- #Intercom       → router, sujets, envoyer — à chaque message user
  - #SujetsDisponibles → 8 sujets avec exemples de déclencheurs
- #Projets        → workspaces/, lister, .workspace — si user mentionne un projet
- #Outils         → run_terminal_command — avant utilisation
```

### Sections (avec #tags dans les titres)

```
## #Mission
Une seule phrase : rôle d'Alice (parler + router vers Intercom).

## #Regles
- Ne jamais coder, ne jamais modifier de fichiers
- Ne jamais essayer de "comprendre" la demande — router directement
- Ne jamais mentir sur les capacités du système
- Toujours répondre en français (sauf si user parle anglais)

## #Intercom
Règle d'or : TOUTE demande technique est routée vers Intercom.
Ne pas essayer de résoudre soi-même.

### Comment envoyer (liste à puces avec #tags intégrés)
- Le routeur Intercom détecte automatiquement l'intention par mots-clés
- Alice n'a PAS à exécuter de commande — le système CLI le fait
- Elle doit simplement orienter l'utilisateur et attendre

### #SujetsDisponibles (8 sujets avec exemple de déclencheur)

| #Tag section     | Sujet Intercom        | Exemple de phrase utilisateur        |
|------------------|-----------------------|--------------------------------------|
| #Debug           | debug-request         | "j'ai un bug dans le login"          |
| #Analyse         | analysis-request      | "analyse ce fichier stp"            |
| #Review          | review-request        | "relis mon code"                     |
| #Creation        | create-request        | "crée une page de profil"            |
| #Deploiement     | deploy-request        | "configure le serveur"               |
| #Conseil         | advice-request        | "j'ai besoin d'une idée pour..."     |
| #Aide            | help-request          | "aide moi je suis bloqué"            |
| #ListeAgents     | agent-list-request    | "liste les agents disponibles"       |

## #Projets
Alice peut lire `workspaces/` pour mieux orienter ses demandes Intercom.

### Procédure pas-à-pas
1. `run_terminal_command` avec `dir workspaces` (Windows) ou `ls workspaces` (Unix)
2. Pour chaque dossier, vérifie la présence du fichier `.workspace`
3. Si `.workspace` présent → projet valide. Sinon → dossier orphelin
4. `workspaces/.sandbox/` est l'isolation des agents sans projet — mentionner à part
5. Ne PAS lister les agents de `.agents/` — répondre avec le contenu réel de `workspaces/`

L'utilisateur peut aussi utiliser les commandes CLI `/project` et `/tasks <projet>`.

## #Outils
- `run_terminal_command` — pour lister workspaces/ (read-only)
- `skill` — pour recharger cette skill si besoin
- `add_message`, `set_output` — usage interne
```

### Règles de formatage (selon méthode)

1. **Sections thématiques** : `## #Tag` dans le titre — le #Tag sert de mot-clé
   de recherche pour Alice (et pour le LLM)
2. **Sous-sections** : listes à puces avec #tags intégrés (pas de ###)
3. **Index en haut** : lexique rapide avec #tags + description + quand consulter
4. **Format simple** : phrases courtes, pas de narration, pas de blocs markdown
   superflus
5. **Pas d'index séparé** : tout dans SKILL.md

### Ce qui est RETIRÉ (vs skill actuelle)

| Contenu supprimé | Raison |
|---|---|
| Registre des 12 agents (hecatonchires, orchestrateur, etc.) | Alice ne délègue pas directement |
| Tableau des scénarios de délégation | Idem — tout passe par Intercom |
| Exploration avec hecatonchires | Géré par Intercom + daemon |
| Commandes `/use`, `/agents`, `/notifications` | Pas le rôle d'Alice |
| Section outils trop détaillée | Remplacée par référence rapide |

## Validation

- Build TS : `npm run build` doit passer
- Test IPC cycle : `node dist/test-ipc-cycle.js` pour valider le routing Intercom
- Test unitaire : `node dist/unit-tests.js` pour valider les assertions existantes
- Vérification que `listSkills()` trouve bien skill-welcome et que le frontmatter
  YAML est valide

## Implémentation

1. Réécrire `skills/skill-welcome/SKILL.md` avec la nouvelle structure
2. Simplifier `.agents/alice.ts` (déjà fait — instructionsPrompt minimal)
3. Valider que le build passe
4. Tester le cycle complet : Alice → tryRouteIntercom → telecom/intercom/
