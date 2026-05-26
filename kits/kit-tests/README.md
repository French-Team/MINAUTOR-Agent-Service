# kit-tests — Fail-fast pour les tests

> **Problème :** Un test qui bloque (timeout infini, boucle infinie) fige toute la suite.
> L'agent qui a lancé les tests ne reçoit aucun signal d'erreur et reste bloqué.

## Solution

Envelopper chaque test dans `stopTestOnError()`. Dès qu'un test échoue ou lève
une erreur, le processus s'arrête **immédiatement** avec un message clair.

```
Avant : ❌ erreur → suite continue → 50 tests échoués → résultat noyé
Après : ❌ erreur → ARRÊT IMMÉDIAT → agent prévenu
```

## Utilisation

### 1. Marquer le fichier

Ajoute ce commentaire en haut du fichier de test :

```ts
// @kit tests
```

Le moteur (engine.ts) détectera ce marqueur et injectera automatiquement
l'import du kit.

### 2. Importer et utiliser

```ts
// @kit tests
import { stopTestOnError } from '../../kits/kit-tests/index.js'

describe('MonModule', () => {
  it('cas normal', stopTestOnError(() => {
    const result = addition(2, 2)
    if (result !== 4) throw new Error('Échec du test')
  }))

  it('cas suivant', stopTestOnError(() => {
    // Ne sera exécuté QUE si le premier test réussit
  }))
})
```

### 3. Pour les tests async

```ts
import { stopTestOnErrorAsync } from '../../kits/kit-tests/index.js'

it('requête API', stopTestOnErrorAsync(async () => {
  const data = await fetch('/api/data')
  if (!data.ok) throw new Error('Requête échouée')
}))
```

### 4. Pour englober toute une suite

```ts
import { runTests } from '../../kits/kit-tests/index.js'

runTests(() => {
  describe('Module A', () => {
    it('test 1', () => { /* ... */ })
    it('test 2', () => { /* ... */ })
  })

  describe('Module B', () => {
    it('test 3', () => { /* ... */ })
  })
})
```

## API

### `stopTestOnError<T>(fn: () => T): T`

- **Description :** Wrapper synchrone fail-fast.
  Capture toute erreur, log le diagnostic, stoppe le processus.
- **Paramètres :**
  - `fn` — Fonction de test à exécuter
- **Retourne :** La valeur retournée par `fn`

### `stopTestOnErrorAsync<T>(fn: () => Promise<T>): Promise<T>`

- **Description :** Version asynchrone pour les tests avec `async/await`.
- **Paramètres :**
  - `fn` — Fonction de test asynchrone
- **Retourne :** Une promesse résolue avec la valeur de `fn`

### `runTests(suiteFn: () => void): void`

- **Description :** Wrapper pour toute une suite de tests.
  Une seule fonction englobe plusieurs blocs `describe`/`it`.
- **Paramètres :**
  - `suiteFn` — Fonction contenant tous les tests

### `class TestError`

- **Propriétés :**
  - `message` — Description de l'erreur
  - `context` — Contexte optionnel (nom du test, module)
  - `timestamp` — Date ISO de création
- **Méthodes :**
  - `format()` — Retourne un rapport formaté de l'erreur

## Compatibilité

- ✅ Tests unitaires (node:test, assert)
- ✅ Tests avec describe/it (vitest, jest, mocha)
- ✅ Tests async / Promise
- ✅ Toute fonction qui peut throw

## Règles

- **Zéro dépendance externe** — seulement `process`, `console` (natifs Node.js)
- **Fail-fast** — la première erreur stoppe tout
- **Log clair** — le message d'erreur montre le test, l'erreur, le timestamp

## Problèmes résolus

| Avant | Après |
|-------|-------|
| Test échoué silencieusement | Test échoué → message rouge → arrêt |
| Suite continue après erreur | Arrêt immédiat à la première erreur |
| Agent bloqué sur un test figé | Agent prévenu, peut réagir |
| Logs d'erreur noyés dans 50 échecs | 1 seule erreur visible |
