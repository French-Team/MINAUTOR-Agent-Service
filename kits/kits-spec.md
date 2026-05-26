# Kits — Spécification du système

> **Statut :** Draft v1 — Issue des échanges avec le créateur du projet
> **Date :** 2026-05-21
> **Projet :** Minautor Agent Service

---

## 1. Concept

Le dossier `kits/` contient des **composants réutilisables de sécurité et de développement** que les agents importent automatiquement dans les fichiers qu'ils créent ou modifient.

Un kit encapsule un **pattern de sécurité ou de robustesse** (fail-fast, timeout, validation, logging, etc.) qu'un agent applique sans avoir à le réinventer à chaque fois.

### Principe fondamental

> Tout fichier produit par un agent devrait être aussi **sûr et résilient** que possible. Les kits sont le mécanisme pour garantir cette qualité de manière systématique.

---

## 2. Architecture du dossier `kits/`

```
kits/
├── registry.json              # Registre lisible par les agents (découverte automatique)
├── composant-erreur-securite.md  # Phase 2 : brainstorming des futurs kits
│
├── kit-tests/                 # Priorité 1 : fail-fast pour les tests
│   ├── index.ts               # Module principal du kit
│   ├── README.md              # Documentation + pattern d'utilisation
│   └── test.ts                # Tests du kit lui-même
│
├── kit-errors/                # Priorité 2 : gestion centralisée des erreurs
│   ├── index.ts
│   ├── README.md
│   └── test.ts
│
├── kit-timeout/               # Priorité 3 : timeout et garde-fous temporels
│   ├── index.ts
│   ├── README.md
│   └── test.ts
│
├── kit-validation/            # Priorité 4 : validation d'entrées
│   ├── index.ts
│   ├── README.md
│   └── test.ts
│
└── kit-logging/               # Priorité 5 : logging structuré
    ├── index.ts
    ├── README.md
    └── test.ts
```

---

## 3. Structure d'un kit

Chaque kit est un **dossier** contenant 3 fichiers :

### 3.1. `index.ts` — Module principal

- Contient la logique du kit (fonctions exportées, classes, wrappers)
- Est importé physiquement par les fichiers qui utilisent le kit
- Suit les conventions TypeScript du projet (pas de `any`, typage strict)
- Exemple pour `kit-tests` :
  ```ts
  // kit-tests/index.ts
  export function stopTestOnError<T>(fn: () => T): T {
    try {
      return fn()
    } catch (err) {
      console.error('[kit-tests] ❌ Test échoué — arrêt immédiat')
      process.exit(1)
    }
  }
  ```

### 3.2. `README.md` — Documentation

Contient :
- **Description** : problème résolu par le kit
- **Pattern d'import** : comment l'agent doit marquer le fichier (`// @kit <nom>`)
- **Exemple d'utilisation** : code avant / après l'application du kit
- **API** : description des fonctions exportées

### 3.3. `test.ts` — Tests du kit

- Teste le kit lui-même
- Utilise **le kit lui-même** pour se protéger (auto-application)
- Sert de démonstration vivante de l'utilisation du kit

---

## 4. Mécanisme d'injection

### 4.1. Marqueur explicite

L'agent ajoute un commentaire dans le fichier qu'il crée ou modifie :

```ts
// @kit tests
// @kit timeout
```

Ce marqueur indique au moteur (engine) que le fichier doit utiliser le kit correspondant.

### 4.2. Injection par le moteur (engine.ts)

Deux mécanismes complémentaires :

#### a) Injection à l'écriture (writeFileSync intercepté)

Quand un agent écrit un fichier via `writeFileSync` ou `run_terminal_command`, le moteur :
1. Détecte les marqueurs `// @kit <nom>` dans le contenu
2. Consulte `kits/registry.json` pour obtenir le chemin d'import du kit
3. Ajoute automatiquement l'import en haut du fichier
4. **Ne modifie pas** le reste du contenu

Transformation exemple :
```ts
// Fichier écrit par l'agent
// @kit tests
import { describe, it } from 'vitest'

describe('Mon composant', () => {
  it('devrait fonctionner', () => { ... })
})
```

→ Devient après injection moteur :
```ts
// @kit tests
import { stopTestOnError } from '../../kits/kit-tests/index.js'
import { describe, it } from 'vitest'

describe('Mon composant', () => {
  it('devrait fonctionner', stopTestOnError(() => { ... }))
})
```

#### b) Scan post-création

Après qu'un agent a créé ou modifié un fichier, le moteur scanne le fichier pour :
- Vérifier que les imports des kits marqués sont bien présents
- Les ajouter s'ils manquent (rattrapage)
- Détecter des kits applicables mais non marqués (suggestion dans le log)

### 4.3. Découverte automatique par les agents

Quand un agent commence une session, le moteur lui fournit la liste des kits disponibles
(tirée de `kits/registry.json`) dans ses instructions système.

L'agent sait donc :
- Quels kits existent
- Quel problème chaque kit résout
- Quand appliquer quel kit (par type de fichier créé)

### 4.4. Comportement de l'agent

L'agent **ajoute automatiquement** les kits appropriés sans demander la permission.
Il détermine le kit applicable ainsi :

| Type de fichier créé | Kit(s) à ajouter |
|----------------------|-------------------|
| Fichier de test (`*.test.ts`, `*.spec.ts`) | `kit-tests` (+ `kit-timeout` si temps long) |
| Fonction utilitaire | `kit-errors` |
| Handler API / entrée utilisateur | `kit-validation` |
| Script long / batch | `kit-timeout` |
| Tout fichier complexe | `kit-logging` |

---

## 5. Registre des kits (`kits/registry.json`)

Fichier JSON lisible par la machine, utilisé par le moteur pour :
- Résoudre le chemin d'import d'un kit à partir de son nom
- Connaître la description et le pattern de détection de chaque kit

```json
{
  "version": "1",
  "kits": [
    {
      "name": "tests",
      "path": "kits/kit-tests/index.js",
      "description": "Fail-fast pour les tests — arrête tout à la première erreur",
      "triggers": ["*.test.ts", "*.spec.ts"],
      "exports": ["stopTestOnError"]
    },
    {
      "name": "errors",
      "path": "kits/kit-errors/index.js",
      "description": "Gestion centralisée des erreurs avec contexte",
      "triggers": ["*.ts"],
      "exports": ["ErrorBoundary", "wrapWithContext"]
    },
    {
      "name": "timeout",
      "path": "kits/kit-timeout/index.js",
      "description": "Timeout et garde-fous pour opérations longues",
      "triggers": ["*.ts"],
      "exports": ["withTimeout", "TimeoutError"]
    },
    {
      "name": "validation",
      "path": "kits/kit-validation/index.js",
      "description": "Validation d'entrées avec schémas type-safe",
      "triggers": ["*.ts"],
      "exports": ["validate", "assertSchema"]
    },
    {
      "name": "logging",
      "path": "kits/kit-logging/index.js",
      "description": "Logging structuré avec niveaux et contexte",
      "triggers": ["*.ts"],
      "exports": ["logger", "LogLevel"]
    }
  ]
}
```

---

## 6. Détail des 5 premiers kits

### 6.1. `kit-tests` — Fail-fast pour les tests

**Problème :** Un test qui bloque (timeout infini, boucle infinie) fige toute la suite.
L'agent qui a lancé les tests ne reçoit aucun signal d'erreur.

**Solution :** Chaque test est enveloppé dans `stopTestOnError()` qui :
- Capture la première erreur
- Affiche un message clair (`❌ Test échoué — arrêt immédiat`)
- Stoppe tout le processus de test (`process.exit(1)`)
- Journalise l'erreur dans le logbook de l'agent

**Pattern d'utilisation :**
```ts
// @kit tests
import { stopTestOnError } from '../../kits/kit-tests/index.js'

describe('MonModule', () => {
  it('cas normal', stopTestOnError(() => {
    // Si ce test échoue ou bloque, tout s'arrête
  }))

  it('cas suivant', stopTestOnError(() => {
    // Ne sera exécuté que si le premier passe
  }))
})
```

### 6.2. `kit-errors` — Gestion centralisée des erreurs

**Problème :** Les erreurs sont catchées n'importe comment, perte de contexte,
messages d'erreur incohérents.

**Solution :** Un wrapper `ErrorBoundary` qui :
- Capture toutes les erreurs avec pile d'appels complète
- Ajoute le contexte (fonction appelante, paramètres, timestamp)
- Formate et log l'erreur de manière structurée

### 6.3. `kit-timeout` — Garde-fous temporels

**Problème :** Des opérations qui prennent trop de temps (requête réseau, boucle,
traitement fichier) sans limite.

**Solution :** Fonction `withTimeout(fn, ms)` qui :
- Lève une `TimeoutError` si l'opération dépasse le délai
- Nettoie les ressources (timers, handles) après timeout
- Journalise la durée réelle vs le timeout configuré

### 6.4. `kit-validation` — Validation d'entrées

**Problème :** Les entrées utilisateur, paramètres d'API, et données externes
ne sont pas validés, causant des crashs silencieux.

**Solution :** Fonctions `validate(schema, data)` et `assertSchema(schema, data)` :
- Validation type-safe avec messages d'erreur explicites
- Assertion qui stoppe l'exécution si la validation échoue
- Compatible avec les types TypeScript

### 6.5. `kit-logging` — Logging structuré

**Problème :** `console.log()` partout, pas de niveaux, pas de contexte,
logs impossibles à filtrer.

**Solution :** Un logger structuré avec :
- Niveaux : DEBUG, INFO, WARN, ERROR
- Contexte automatique (module, fonction, timestamp)
- Sortie formatée (JSON pour machine, coloré pour humain)

---

## 7. Phase 2 — `composant-erreur-securite.md`

Fichier de brainstorming pour imaginer les prochains kits.

### Format attendu

```markdown
# Composants erreur & sécurité — Brainstorming

## Idée : kit-[nom]
- **Problème :** [description du problème ou scénario d'erreur]
- **Solution imaginée :** [description du kit]
- **Fichiers concernés :** [types de fichiers qui utiliseraient ce kit]
- **Priorité :** [haute/moyenne/basse]

## Idée : kit-[nom 2]
- ...
```

### Objectifs du brainstorming

- Lister tous les scénarios d'erreur possibles dans un projet d'agents
- Associer chaque scénario à un kit existant ou à créer
- Prioriser les kits à implémenter
- Détecter les patterns transverses (un kit peut en utiliser un autre)

---

## 8. Règles de développement des kits

1. **Langage :** TypeScript uniquement
2. **Typage strict :** pas de `any`, pas de `as` (sauf cast justifié)
3. **Zéro dépendance externe :** un kit ne doit importer que des modules Node.js
   natifs (`fs`, `path`, `process`) — pas de dépendances npm
4. **Auto-testé :** chaque kit a ses propres tests dans `test.ts`
5. **Auto-appliqué :** le `test.ts` d'un kit doit utiliser le kit lui-même
6. **Documenté :** `README.md` obligatoire avec exemple d'utilisation
7. **Registré :** chaque kit doit être déclaré dans `kits/registry.json`

---

## 9. Roadmap

| Phase | Contenu |
|-------|---------|
| **Phase 1** | Créer les 5 premiers kits (tests, errors, timeout, validation, logging) |
| **Phase 1.1** | Implémenter le mécanisme d'injection dans engine.ts |
| **Phase 1.2** | Créer le registre registry.json |
| **Phase 2** | Rédiger composant-erreur-securite.md (brainstorming) |
| **Phase 2.1** | Prioriser et implémenter les kits issus du brainstorming |
| **Phase 3** | Ajouter un système de suggestion proactive dans le moteur |
| **Phase 4** | Permettre aux agents de proposer de nouveaux kits via un template |
