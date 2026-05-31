# Spécification : Refonte du Workflow, Matching et Rôle d'Agent-Telecom

> **Date** : 2026-05-31
> **Statut** : ✅ **Implémentée** — toutes les phases (1-4) sont déployées et validées

---

## 1. Problèmes Identifiés

### P1 — Agent-telecom confondu avec le routeur central
`agent-telecom` est défini comme un agent LLM complet (modèle `qwen/qwen3.5-9b`, 4 outils). Il est spawné systématiquement par le daemon pour router les messages intercom. **Parallèlement**, le `script-runner` exécute déjà les scripts directement sans passer par agent-telecom.

**Conséquence** : Double couche de routing inutile. Pour les commandes reconnues (`liste les projets`, `crée un projet`, etc.), le script-runner fait le travail, mais agent-telecom est spawné en vain (ou le flux est confus).

**Cause racine** : Le daemon traite `tryScriptRunner()` comme essai prioritaire, mais si le script réussit, le message intercom a déjà été écrit et notifié. Si le script échoue, agent-telecom est spawné pour router — alors qu'il n'est pas un routeur mais un agent de maintenance.

### P2 — Pattern matching trop rigide
Les patterns dans `data/scripts/registry.yaml` utilisent des regex strictes. Exemple :
```yaml
- pattern: "liste(\\s+les)?\\s+projets?"
```
`liste les projets` → ✅ match
`liste mes projets` → ❌ pas match (car `mes` ≠ `les`)

**Conséquence** : L'utilisateur doit deviner la syntaxe exacte. Aucune tolérance aux variantes naturelles.

### P3 — Fallback exclusivement LLM (coûteux)
Quand aucun pattern ne match, le daemon spawn immédiatement un agent LLM. Pas d'étape intermédiaire de matching flou (fuzzy) avant de recourir à une inference LLM coûteuse.

### P4 — Notifications intercom bruyantes dans le CLI
Chaque écriture dans `telecom/intercom/` génère une notification `🔔 intercom → alice → agent-telecom [project-request]` dans le CLI, même pour les routages de routine réussis par le script-runner.

### P5 — Seuils de matching intercom trop larges
Les patterns dans `intercom-patterns.json` utilisent `minMatch: 1` pour presque tous les sujets. Le mot `projet` seul suffit à déclencher un routage, même dans une phrase comme `j'ai une idée de projet`.

---

## 2. Architecture Cible

```
Utilisateur → CLI
  ↓ tryRouteIntercom (mots-clés larges → déterminer un subject)
  ↓ si subject trouvé → écrit dans telecom/intercom/
  ↓ sinon → message direct "je n'ai pas compris"
  
Daemon lit telecom/intercom/
  ↓
  ÉTAPE 1 : tryScriptRunner (regex STRICT)
  │   → si match → exécute le script ✅
  │   → NOTIFIE le résultat dans le CLI (section dédiée)
  │
  ├── ÉTAPE 2 (si étape 1 échoue) : fallback FUZZY
  │   │   via embeddings LM Studio (text-embedding-nomic-embed-text-v1.5)
  │   │   compare la similarité entre la demande et les patterns du registre
  │   │   seuil de similarité configurable (défaut 0.75)
  │   │
  │   → si match → exécute le script ✅
  │   → NOTIFIE le résultat
  │   → LOGUE la correspondance floue pour apprentissage
  │
  └── ÉTAPE 3 (si étapes 1 et 2 échouent) : spawn agent-telecom
      │   agent LLM de MAINTENANCE du service Intercom
      │
      → N'EXÉCUTE PAS la demande lui-même
      → ANALYSE la demande non reconnue
      → PEUT AJOUTER / MODIFIER un pattern dans le registre
      → PEUT AJOUTER / MODIFIER un mot-clé intercom
      → PEUT ÉCRIRE une suggestion de pattern pour validation
      → RÉPOND à l'utilisateur avec une proposition d'amélioration
```

### Rôles clarifiés

| Composant | Rôle |
|-----------|------|
| `tryRouteIntercom` | Détection large → déterminer un **subject** (pas un agent). Écriture dans intercom/. |
| `tryScriptRunner` (regex strict) | Exécution RAPIDE des commandes connues. Premier match = gagnant. |
| `fuzzy-matcher` (nouveau) | Fallback par similarité textuelle via embeddings LM Studio. Deuxième chance. |
| `agent-telecom` | Agent de **maintenance** du service Intercom. N'exécute pas de tâches utilisateur, n'est pas un routeur. |
| `script-runner` | Moteur d'exécution. Ne change pas de comportement — c'est l'appelant qui décide. |

---

## 3. Changements par Composant

### 3.1 — Nouveau module : `src/fuzzy-matcher.ts`

Moteur de matching flou utilisant un modèle d'embeddings local via LM Studio.

**API** :
```typescript
export interface FuzzyMatchResult {
  matched: boolean
  entry?: ScriptEntry
  params?: Record<string, string>
  similarity: number
}

export function fuzzyMatch(demande: string, subject?: string): Promise<FuzzyMatchResult>
```

**Fonctionnement** :
1. Envoyer la demande utilisateur à LM Studio endpoint `/v1/embeddings` avec le modèle `text-embedding-nomic-embed-text-v1.5`
2. Calculer l'embedding de la demande
3. Comparer (similarité cosinus) avec les embeddings de chaque pattern du registre (pool de phrases pertinentes)
4. Si similarité > seuil configurable (défaut 0.75) → match
5. Extraire les paramètres nommés du pattern matché (comme dans le matching regex)

**Optimisation** :
- Les embeddings des patterns connus sont pré-calculés et mis en cache
- Recalcul uniquement quand le registre change (détection via timestamp du fichier)
- Pas de mise en cache si le nombre de patterns est < 20 (coût négligeable)

**Configuration** :
```yaml
# data/config/fuzzy-matcher.yaml
similarity_threshold: 0.75
model: text-embedding-nomic-embed-text-v1.5
lm_studio_url: http://localhost:1234/v1
cache_enabled: true
```

### 3.2 — `src/telecom/service/telecom-daemon.ts`

Modifier le flux de traitement dans `tryScriptRunner()` → le renommer conceptuellement en `processIntercomMessage()` avec 3 étapes :

```typescript
function processIntercomMessage(msg: IntercomMessage): void {
  // Étape 1 : Regex strict (script-runner actuel)
  const regexResult = matchAndExecute(demande, msg.subject, extraEnv)
  if (regexResult.matched) {
    notifyScriptResult(regexResult)
    return
  }

  // Étape 2 : Fuzzy matching (nouveau)
  const fuzzyResult = await fuzzyMatch(demande, msg.subject)
  if (fuzzyResult.matched) {
    // Logguer la correspondance floue pour apprentissage
    logFuzzyMatch(demande, fuzzyResult.entry, fuzzyResult.similarity)
    // Exécuter le script trouvé
    const scriptResult = executeScript(fuzzyResult.entry.script, extraEnv)
    notifyScriptResult(scriptResult)
    return
  }

  // Étape 3 : Spawn agent-telecom (maintenance)
  spawnAgent('agent-telecom', msg)
}
```

**Pas de changement** dans le reste du daemon (polling, rotation, IPC, etc.).

### 3.3 — `data/scripts/registry.yaml`

Ajouter des variantes de patterns pour couvrir les formulations naturelles les plus fréquentes.

**Pour les projets** :
```yaml
# Variante avec 'mes' / 'tous' / 'tes' entre liste et projets
- pattern: "liste\\s+(?:les|mes|tous?|tes|nos|vos)?\\s*projets?"
  subject: "project-request"
  script: "scripts/projects/list.js"
  description: "Liste tous les projets disponibles"

# Variante : montrer / afficher + projets
- pattern: "(?:montre|affiche|voir?)\\s+(?:moi\\s+)?(?:les|mes|tous?)?\\s*projets?"
  subject: "project-request"
  script: "scripts/projects/list.js"
  description: "Liste tous les projets disponibles"
```

**Pour les tâches** :
```yaml
# Variante avec 'mes' / 'toutes'
- pattern: "liste\\s+(?:toutes\\s+)?(?:les|mes)?\\s*t[âa]ches"
  subject: "project-request"
  script: "scripts/projects/list-tasks.js"
  description: "Liste les tâches"
```

### 3.4 — `data/cahier-aides-alice/intercom-patterns.json`

Ajuster les seuils `minMatch` pattern par pattern :

| Pattern | minMatch actuel | minMatch cible | Justification |
|---------|----------------|----------------|---------------|
| `debug-request` | 1 | **1** (garder) | bug, erreur, crash — important de ne pas rater |
| `analysis-request` | 1 | **2** | "vérifie l'heure", "regarde ça" = faux positifs |
| `review-request` | 1 | **1** (garder) | review, revue, qualité — plutôt spécifique |
| `project-request` | 1 | **2** | "projet" est trop large (projet scolaire, projet perso...) |
| `create-request` | 1 | **2** | "fais", "code", "génère", "écris" — mots courants |
| `deploy-request` | 1 | **1** (garder) | configure, installe, déploie — plutôt spécifique |
| `advice-request` | 1 | **2** | "idée", "suggestion", "conseil", "avis" — large |
| `help-request` | 1 | **1** (garder) | aide, besoin, urgent, bloqué — important |
| `agent-list-request` | 2 | **2** (garder) | déjà correct |

### 3.5 — `.agents/agent-telecom.ts`

Redéfinir le rôle d'agent-telecom comme **agent de maintenance du service Intercom**, pas comme routeur.

**Nouvelle instruction** :
```
Tu es l'Agent Télécom, responsable de la MAINTENANCE du système de communication Intercom.

## Ta mission

Tu ne routes PAS les messages utilisateur — le script-runner et le fuzzy-matcher s'en chargent.
Tu interviens UNIQUEMENT quand aucune correspondance n'a été trouvée (étape 3).

## Tes compétences

1. ANALYSER les demandes non reconnues — comprendre ce que l'utilisateur voulait
2. PROPOSER des améliorations au registre de scripts (data/scripts/registry.yaml) :
   - Ajouter des variantes de patterns pour couvrir de nouvelles formulations
   - Ajuster les patterns existants qui sont trop stricts
   - Ajouter des synonymes et des mots-clés
3. PROPOSER des améliorations aux patterns intercom (intercom-patterns.json) :
   - Ajuster les minMatch pour réduire les faux positifs
   - Ajouter de nouveaux sujets si nécessaire
4. ANALYSER les logs d'échecs de matching :
   - Consulter telecom/logs/ pour les correspondances floues récentes
   - Identifier les tendances (même demande échoue plusieurs fois)
5. DEBUGGER le matching interactif :
   - Simuler une demande pour voir quel pattern match
   - Tester différents seuils de similarité
6. ÉCRIRE des scripts de maintenance pour le service intercom :
   - Nettoyage des dossiers intercom/
   - Réparation des messages bloqués
   - Stats et rapports de santé

## Ce que tu ne fais PAS

- Tu n'exécutes PAS la demande utilisateur toi-même
- Tu n'es PAS un routeur — tu renvoies vers l'utilisateur avec une proposition
- Tu ne modifies PAS le registre sans laisser une trace (log de modification)

## Outils à ta disposition

- run_terminal_command : pour lire/écrire/modifier les fichiers du registre
- add_message : pour communiquer avec l'utilisateur
- skill : pour charger des compétences spécifiques
```

### 3.6 — `src/cli-main.ts` — Section dédiée pour les notifications intercom

Les notifications intercom (`🔔 intercom`) ne disparaissent pas mais sont regroupées dans une **section pliable** du menu principal, accessible via un numéro dédié (ex: 402).

**Comportement** :
- Les notifications intercom de routine (routage réussi) ne s'affichent PLUS en temps réel dans le flux CLI
- Elles sont accessibles via une option dédiée dans le menu principal : `[402] Messages intercom`
- Les notifications d'ERREUR ou de résultat important (script échoué, spawn bloqué) s'affichent toujours en temps réel
- Le compteur de notifications en attente (`[N]`) dans le prompt inclut toujours les messages intercom

**Niveaux de notification** :
| Niveau | Affichage temps réel | Section dédiée |
|--------|---------------------|----------------|
| `urgent` | ✅ Toujours (erreur, crash) | ✅ Aussi |
| `avertissement` | ✅ Toujours (échec script) | ✅ Aussi |
| `conclusion` | ✅ Résultat script réussi | ✅ Aussi |
| `info` | ❌ Masqué | ✅ Section 402 |
| `intercom` (routage réussi) | ❌ Masqué | ✅ Section 402 |

### 3.7 — Logger de correspondances floues

Nouveau fichier de log pour tracer les correspondances floues (fuzzy matches) afin qu'agent-telecom puisse les analyser.

**Fichier** : `telecom/logs/fuzzy-matches.log`

**Format** (JSON Lines, une entrée par ligne) :
```json
{"timestamp":"2026-05-31T10:30:00Z","demande":"liste mes projets","matched_pattern":"liste(\\\\s+les)?\\\\s+projets?","similarity":0.89,"script":"scripts/projects/list.js","action":"accepted"}
{"timestamp":"2026-05-31T10:31:00Z","demande":"montre moi les workspaces","matched_pattern":"(?:montre|affiche|voir?)\\\\s+(?:moi\\\\s+)?(?:les|mes|tous?)?\\\\s*projets?","similarity":0.72,"script":"scripts/projects/list.js","action":"accepted"}
```

**Rotation** : Max 500 entrées, purge automatique des plus anciennes via `rotateDir()`.

---

## 4. Plan d'implémentation

### Phase 1 — Matching flexible (priorité haute)

1. **Ajouter les variantes de patterns** dans `data/scripts/registry.yaml`
2. **Créer `src/fuzzy-matcher.ts`** avec :
   - Appel embeddings LM Studio
   - Similarité cosinus
   - Cache des embeddings de patterns
   - Seuil configurable
3. **Intégrer le fuzzy-matcher** dans `telecom-daemon.ts` (entre regex et spawn)
4. **Créer le logger de correspondances floues**

### Phase 2 — Nettoyage du rôle agent-telecom (priorité haute)

1. **Réécrire `.agents/agent-telecom.ts`** avec le nouveau rôle maintenance
2. Ajuster `telecom-daemon.ts` pour ne spawner agent-telecom qu'en dernier recours

### Phase 3 — Affinage des seuils (priorité moyenne)

1. Ajuster `minMatch` dans `intercom-patterns.json` selon le tableau en 3.4

### Phase 4 — Section dédiée notifications (priorité basse)

1. Modifier les niveaux de notification intercom
2. Ajouter l'option `[402] Messages intercom` dans le menu CLI
3. Filtrer les notifications info/intercom en temps réel

---

## 5. Questions Restantes

> ✅ **Toutes résolues** — implémenté le 2026-05-31

- [x] **Seuil de similarité par défaut** : `0.75` — constante `SIMILARITY_THRESHOLD` dans `src/fuzzy-matcher.ts`, valeur par défaut utilisée quand LM Studio est disponible
- [x] **Format du cache des embeddings** : fichier JSON dans `telecom/cache/embeddings.json` — généré automatiquement par `fuzzy-matcher.ts`, recalculé si le registre change (détection par timestamp)
- [x] **Commande manuelle de re-embedding** : oui — `402 /rebuild` (message intercom) et `403 /rebuild` (analyse patterns) dans `src/cli-main.ts` déclenchent un re-embedding manuel
- [x] **Seuil d'auto-notification d'agent-telecom** : `AUTO_SUGGEST_THRESHOLD = 3` dans `src/telecom/service/telecom-daemon.ts` — après 3 échecs de matching (regex + fuzzy) sur la même demande, le daemon notifie automatiquement agent-telecom

---

## 6. Annexes

### Flux actuel (simplifié)

```
CLI → tryRouteIntercom() → écrit intercom/ → daemon lit
  → tryScriptRunner() → si match → exécute → notifie ✅
  → sinon → spawn agent-telecom (LLM) → route → parfois spawn un autre agent
```

### Flux cible (simplifié)

```
CLI → tryRouteIntercom() → écrit intercom/ → daemon lit
  → tryScriptRunner() (regex strict) → si match → exécute ✅
  → fuzzyMatch() (embeddings LM Studio) → si match → exécute ✅ → loggue
  → spawn agent-telecom (maintenance) → analyse → propose amélioration registre
```

### Dépendances

- LM Studio doit être en cours d'exécution avec le modèle `text-embedding-nomic-embed-text-v1.5` chargé
- Le fuzzy-matcher doit être non-bloquant : timeouts, fallback silencieux si LM Studio est indisponible
- Compatibilité Windows assurée (chemins, exec, etc.)
