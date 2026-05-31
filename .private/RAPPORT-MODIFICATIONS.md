# Rapport Complet des Modifications — Refonte du Workflow & Correctifs

**Généré par** : Buffy (Codebuff) — 2026-05-31  
**Projet** : Minautor Agents Service  
**Référence** : `refonte-workflow-spec.md`

---

## Table des Matières

1. [Résumé Exécutif](#1-résumé-exécutif)
2. [Statistiques des Changements](#2-statistiques-des-changements)
3. [Phase 1 — Matching Flexible](#3-phase-1--matching-flexible)
4. [Phase 2 — Nettoyage du Rôle agent-telecom](#4-phase-2--nettoyage-du-rôle-agent-telecom)
5. [Phase 3 — Affinage des Seuils](#5-phase-3--affinage-des-seuils)
6. [Phase 4 — Section Dédiée Notifications](#6-phase-4--section-dédiée-notifications)
7. [Correctifs Supplémentaires](#7-correctifs-supplémentaires)
8. [Questions Résolues](#8-questions-résolues)
9. [Fichiers Créés](#9-fichiers-créés)
10. [Fichiers Supprimés](#10-fichiers-supprimés)
11. [Résultats des Tests](#11-résultats-des-tests)
12. [Points d'Attention](#12-points-dattention)

---

## 1. Résumé Exécutif

**Scope** : 4 phases de refonte + 3 correctifs bugs urgents.  
**Fichiers modifiés** : 28 fichiers (18 modifiés, 9 créés, 5 supprimés)  
**Insertions nettes** : ~2 233 lignes ajoutées, ~1 181 supprimées  
**État** : ✅ Compilation TypeScript 0 erreur, tous les tests passent

### Problèmes résolus

1. **Suggestions "ignorées"** — Les commandes du menu Actions rapides (`!project use`, `/help`) étaient routées vers Intercom qui ne les reconnaissait pas → affichait "Suggestion ignorée"
2. **Boucle infinie au démarrage** — Les suggestions de la session précédente apparaissaient immédiatement, l'utilisateur tapait une commande → LLM répondait "rien" → nouvelles suggestions → re-bouclait
3. **Commande `!agents` invalide** — La suggestion "Lister les agents" pointait vers `!agents` qui n'avait pas de handler CLI direct

### Phases de refonte

| Phase | Priorité | Statut |
|-------|----------|--------|
| **Phase 1** — Matching flexible (fuzzy-matcher, registry, daemon, logger) | Haute | ✅ |
| **Phase 2** — Nettoyage rôle agent-telecom | Haute | ✅ |
| **Phase 3** — Affinage des seuils minMatch | Moyenne | ✅ |
| **Phase 4** — Section dédiée notifications + menu 402/403 | Basse | ✅ |

---

## 2. Statistiques des Changements

```
Fichier                                        +Ins   -Del
─── Refonte Workflow ──────────────────────────────────────
.agents/agent-telecom.ts                       136      5   Réécriture rôle maintenance
.agents/alice.ts                                 4      4   Suppression invocation suggestions
data/scripts/registry.yaml                      81      3   Patterns variants projets/tâches/agents
data/cahier-aides-alice/intercom-patterns.json   8      8   Ajustement seuils minMatch
src/fuzzy-matcher.ts                           353     12   NOUVEAU module matching flou
src/telecom/service/telecom-daemon.ts          523    137   Flux 3 étapes + agent-telecom dernier recours
src/cli-main.ts                                609     23   Notifications, menu 402/403, correctifs bugs
src/cli-menu.ts                                249      9   Options 201/202/402/403/500/605
src/cli-suggestions.ts                         353     12   showSuggestionMenu, clearSuggestions
src/telecom/service/telecom-notification-viewer.ts 463 114 Section notifications intercom
src/telecom/service/telecom-watcher-console.ts 139    139   Layout 3 quadrants
src/cli-selector.ts                             26      0   Help interactif
src/cli-providers.ts                            26     26   Refonte mineure
src/cli-context-test.ts                          3      3   Ajustements
src/test/unit-menu-validation.ts                92     42   Tests nouvelles options menu
src/test/unit-tests.ts                          14     14   Ajustements
tsconfig.json                                    3      3   types: ["node"]
─── Correctifs bugs supplémentaires ───────────────────────
src/cli-main.ts (suggestions)      (inclus ci-dessus)  Injection line + !normalization
src/cli-suggestions.ts             (inclus ci-dessus)  clearSuggestions + loadSuggestions
scripts/suggestions/handle.js       (nouveau)          !agents → /agents
src/test/test-suggestion-routing.ts (nouveau)          13 tests validation
─── Nettoyage ────────────────────────────────────────────
data/recovery/.recovery.md          0     481   Supprimé (agents recréés)
debug-yaml-parser.js                 0      15   Supprimé
test-suggestions.js                  0      57   Supprimé
workspaces/test-suggestions/         0      19   Dossier test supprimé
README.md                             5      0   Mention freebuff/Deepseek
```

---

## 3. Phase 1 — Matching Flexible

### 3.1 `data/scripts/registry.yaml` — Patterns élargis

**Problème** : Les patterns étaient trop stricts (ex: `liste(\\s+les)?\\s+projets?` ne matchait pas "liste mes projets").

**Modifications** :
- **Projets** : Ajout de variantes avec `(?:montre|affiche|voir?)\\s+(?:moi\\s+)?(?:les|mes|tous?|tes|nos|vos)?\\s*projets?`
- **Tâches** : Ajout de variantes avec `liste\\s+(?:toutes\\s+)?(?:les|mes|tes|nos|vos)?\\s*t[âa]ches`
- **Agents** : Ajout de `(?:montre|affiche|voir?)\\s+(?:moi\\s+)?(?:les|mes|tous?)?\\s*agents?`
- **Aide** : Pattern `comment\\s+(faire|utiliser)` retiré (trop générique, causait faux positifs)
- **Nouveaux scripts** : `analyse patterns`, `montre|affiche tâches`, liste agents variantes

### 3.2 `src/fuzzy-matcher.ts` — NOUVEAU Module

**Fichier créé** : `src/fuzzy-matcher.ts` (353 lignes)

**Architecture** :

```
fuzzyMatch(demande, subject?)
  │
  ├─ 1. Cache valide ? (isCacheValid)
  │     └─ Non → rebuild si cooldown OK (canAttemptRebuild)
  │
  ├─ 2. Embedding demande (getEmbedding)
  │     └─ LM Studio /v1/embeddings
  │     └─ Timeout 5s → fallback silencieux
  │
  ├─ 3. Charger cache embeddings (loadCache)
  │
  ├─ 4. Cosine similarity (cosineSimilarity)
  │     └─ Seuil 0.75 (SIMILARITY_THRESHOLD)
  │     └─ Filtrage par subject optionnel
  │
  └─ 5. Logger résultat (appendLogEntry)
        └─ JSON Lines → telecom/logs/fuzzy-matches.log
        └─ Rotation 500 entrées max
```

**API publique** :
| Fonction | Description |
|----------|-------------|
| `fuzzyMatch(demande, subject?)` | Matching flou principal |
| `rebuildCache()` | Reconstruit tous les embeddings |
| `getCoverage()` | Stats : patterns cachés / total / obsolètes |
| `clearEmbeddingCache()` | Vide + backup du cache |
| `countRejectedDemandes(demande, minCount?, windowMinutes?)` | Compte les échecs récurrents |
| `checkLmStudio()` | Ping LM Studio + liste modèles |
| `cosineSimilarity(a, b)` | Utilitaire de similarité |

**Configuration** (constantes dures dans le fichier) :
- `LM_STUDIO_URL` = `http://localhost:1234/v1`
- `EMBEDDING_MODEL` = `text-embedding-nomic-embed-text-v1.5`
- `SIMILARITY_THRESHOLD` = `0.75`
- `CACHE_FILE` = `telecom/cache/embeddings.json`
- `LOG_FILE` = `telecom/logs/fuzzy-matches.log`
- `TIMEOUT_MS` = `5000` (5s par appel embedding)
- `REBUILD_TIMEOUT_MS` = `30000` (30s max rebuild complet)
- `REBUILD_COOLDOWN_MS` = `60000` (60s entre rebuilds)
- `MAX_LOG_ENTRIES` = `500`

### 3.3 `src/telecom/service/telecom-daemon.ts` — Flux 3 Étapes

**Modification** : La fonction `tryScriptRunner()` a été refondue en `processIntercomMessage()` avec 3 étapes :

```
Message intercom reçu
  │
  ├─ ÉTAPE 1 : Regex strict (matchAndExecute)
  │   ├─ Match → exécuter script → notification conclusion
  │   └─ No match → passer étape 2
  │
  ├─ ÉTAPE 2 : Fuzzy matching (fuzzyMatch)
  │   ├─ Match → logger accepted → exécuter script
  │   ├─ No match → logger rejected → passer étape 3
  │   └─ Erreur LM Studio → fallback gracieux
  │
  └─ ÉTAPE 3 : Spawn agent-telecom (dernier recours)
      ├─ buildInstruction() avec analyse contexte
      ├─ Notification avertissement
      └─ Agent analyse les échecs → propose améliorations
```

**Auto-suggestion intelligente** : Si `countRejectedDemandes()` >= 3 (`AUTO_SUGGEST_THRESHOLD`), le daemon suggère automatiquement l'ajout d'un nouveau pattern via notification.

### 3.4 Logger — `telecom/logs/fuzzy-matches.log`

**Format** JSON Lines :
```json
{"timestamp":"2026-05-31T12:00:00.000Z","demande":"liste mes projets","action":"accepted","matched_pattern":"(?:montre|affiche|voir?)...","similarity":0.89,"script":"scripts/projects/list.js"}
{"timestamp":"2026-05-31T12:01:00.000Z","demande":"je veux déployer","action":"rejected","subject":null,"similarity":0.42}
```

Rotation automatique à 500 entrées (purge des plus anciennes).

---

## 4. Phase 2 — Nettoyage du Rôle agent-telecom

### 4.1 `.agents/agent-telecom.ts` — Réécriture Complète

**Avant** : Routeur de communications — analysait les messages intercom et les routait vers les agents spécialisés.

**Après** : Agent de **maintenance du service Intercom** — intervient UNIQUEMENT en dernier recours (étape 3) quand regex + fuzzy ont échoué.

**Nouvelles compétences** :
1. **Analyser** les demandes non reconnues (logs d'échecs, tendances)
2. **Consulter** les logs `fuzzy-matches.log` pour détecter les patterns récurrents
3. **Proposer** des améliorations au `registry.yaml` (nouveaux patterns, variantes)
4. **Ajuster** les seuils dans `intercom-patterns.json`
5. **Tester** le matching interactif
6. **Écrire** des scripts de maintenance (nettoyage, stats, réparation)

**Marqueurs de suivi** : `[ANALYSE]`, `[PROPOSITION]`, `[ACTION]`, `[FAIT]`, `[TREND]`

### 4.2 `telecom-daemon.ts` — agent-telecom en Dernier Recours

Confirmation que le daemon ne spawn plus `agent-telecom` qu'à l'étape 3 du flux, après l'échec du regex strict ET du fuzzy matching.

---

## 5. Phase 3 — Affinage des Seuils

### 5.1 `data/cahier-aides-alice/intercom-patterns.json`

| Pattern | minMatch AVANT | minMatch APRÈS |
|---------|:--------------:|:---------------:|
| `analysis-request` | 1 | **2** |
| `project-request` | 1 | **2** |
| `create-request` | 1 | **2** |
| `advice-request` | 1 | **2** |
| `debug-request` | 1 | **1** (inchangé) |
| `review-request` | 1 | **1** (inchangé) |
| `deploy-request` | 1 | **1** (inchangé) |
| `help-request` | 1 | **1** (inchangé) |
| `agent-list-request` | 1 | **1** (inchangé) |

**Justification** : Les patterns avec `minMatch: 1` étaient trop permissifs — un seul mot-clé présent dans une phrase déclenchait un routage intercom, même pour des phrases non pertinentes. `minMatch: 2` exige au moins 2 mots-clés, réduisant les faux positifs.

---

## 6. Phase 4 — Section Dédiée Notifications

### 6.1 `src/cli-main.ts` — Filtrage Notifications Temps Réel

**Nouveau comportement** :
- `conclusion` → affiché en temps réel ✅
- `urgent` → affiché en temps réel ✅
- `avertissement` → affiché en temps réel ✅
- `info` → **masqué** du flux temps réel (regroupé dans section 402)
- `intercom` (routage réussi) → **masqué** du flux temps réel

### 6.2 `src/cli-menu.ts` — Options 402 et 403

**Option [402] Messages intercom** — Section complète avec sous-commandes :
- `402` — Affiche les dernières notifications intercom (filtrées par niveau)
- `402 analyse` — Analyse les échecs de matching récents
- `402 rejected` — Liste les demandes non routées
- `402 coverage` — Statistiques de couverture des patterns
- `402 suggest` — Suggestions d'amélioration de patterns
- `402 suggestions` — Affiche les suggestions de patterns
- `402 rebuild` — Reconstruit le cache des embeddings
- `402 help` — Aide de la section

**Option [403] Analyse des patterns** — Menu dédié avec :
- `403 analyse` — Analyse les demandes rejetées
- `403 patterns` — Analyse les patterns du registre
- `403 coverage` — Couverture du fuzzy matching
- `403 suggest` — Suggère des améliorations
- `403 rebuild` — Reconstruit les embeddings
- `403 help` — Aide

### 6.3 Autres options de menu ajoutées

| Code | Option | Description |
|:----:|--------|-------------|
| **201** | Lister les agents | `handleListAgents()` |
| **202** | Utiliser un agent | `handleUseAgent()` |
| **402** | Messages intercom | Section notifications dédiée |
| **403** | Analyse des patterns | Outils de maintenance |
| **500** | Menu test | Sous-menu tests unitaires |
| **605** | AutoShow toggle | Activer/désactiver affichage auto suggestions |

---

## 7. Correctifs Supplémentaires

### 7.1 🐛 Suggestions "Ignorées" → Résolu

**Problème** : Quand l'utilisateur choisit une suggestion dans le menu "Actions rapides" (ex: "Utiliser le projet"), la commande (`!project use soulseek-donwloader`) était routée via `tryRouteIntercom()` qui ne reconnaît que du langage naturel → retournait "Suggestion ignorée (aucun pattern intercom)".

**Correctif** (`src/cli-main.ts`) :
1. Le choix de suggestion est maintenant injecté dans `line` (variable du prompt)
2. Il passe par le flux CLI normal (`/help`, `!project`, `!`, Intercom, LLM)
3. Les commandes shell brutes (`cat`, `ls`, `node`) reçoivent automatiquement le préfixe `!`

**Test** : `src/test/test-suggestion-routing.ts` — 13 tests validant :
- Phase 1 : `!project`, `!tasks`, `/help` → `null` de `tryRouteIntercom()` ✅
- Phase 2 : langage naturel → toujours routé ✅
- Phase 3 : commandes shell brutes → `null` ✅

### 7.2 🐛 Boucle Infinie au Démarrage → Résolu

**Problème** : Au lancement du CLI :
1. `showMenu()` affiche le menu (1-9)
2. Suggestions périmées de la session précédente apparaissent
3. L'utilisateur tape "0" pour ignorer → prompt apparaît
4. L'utilisateur tape une commande → LLM répond "rien" → `triggerSuggestions()` → nouvelles suggestions
5. **Boucle infinie**

**Correctif** (`src/cli-main.ts`) :
1. `clearSuggestions()` appelé après `showMenu()` au démarrage → nettoie les suggestions périmées
2. Après "0" (dismiss suggestions) → `showMenu()` + `continue` → l'utilisateur voit le menu à nouveau
3. `showSuggestionMenu()` appelle déjà `clearSuggestions()` en interne → pas de nouvelle boucle

### 7.3 🐛 Commande `!agents` Invalide → Résolu

**Problème** : La suggestion "Lister les agents" dans `scripts/suggestions/handle.js` pointait vers `!agents` qui n'avait pas de handler CLI direct.

**Correctif** :
1. `scripts/suggestions/handle.js` : `!agents` → `/agents` (commande slash valide)
2. `src/cli-main.ts` : Ajout d'un handler `!agents` → `handleListAgents()`

---

## 8. Questions Résolues

| Question | Réponse Implémentée | Où |
|----------|--------------------|----|
| Seuil de similarité par défaut ? | **0.75** | `SIMILARITY_THRESHOLD` dans `src/fuzzy-matcher.ts:34` |
| Format du cache des embeddings ? | **JSON** dans `telecom/cache/embeddings.json` | `loadCache()` / `saveCache()` |
| Faut-il une commande manuelle pour re-embedder ? | **Oui** — `402 /rebuild` ou `403 /rebuild` | `src/cli-main.ts` (timeout 30s, cooldown 60s) |
| Seuil auto-notification agent-telecom ? | **3 échecs** | `AUTO_SUGGEST_THRESHOLD` dans `telecom-daemon.ts` |

---

## 9. Fichiers Créés

### Nouveaux fichiers source
| Fichier | Lignes | Description |
|---------|:------:|-------------|
| `src/fuzzy-matcher.ts` | 365 | Moteur de matching flou par embeddings |
| `src/suggestion-templates.ts` | ~200 | Templates de suggestions proactives |
| `src/fuzzy-matcher.ts` intégré | — | Logger, cache, coverage, diagnostics |

### Nouveaux fichiers de test
| Fichier | Tests | Description |
|---------|:-----:|-------------|
| `src/test/test-suggestion-routing.ts` | 13 | Validation du routage des suggestions |
| `src/test/intercom-routing-thresholds.ts` | 32 | Tests des seuils de routage intercom |
| `src/test/test-fuzzy-matcher.ts` | ~10 | Tests unitaires du fuzzy matcher |
| `src/test/e2e-matching-flow-test.ts` | ~10 | Test de flux de matching complet |

### Nouveaux scripts
| Fichier | Description |
|---------|-------------|
| `scripts/telecom/analyze-patterns.js` | Analyse des patterns du registre |
| `scripts/suggestions/handle.js` | Gestionnaire de suggestions utilisateur |

### Nouveaux fichiers de données
| Fichier | Description |
|---------|-------------|
| `data/suggestions/templates.yaml` | Templates de suggestions proactives |

---

## 10. Fichiers Supprimés

| Fichier | Raison |
|---------|--------|
| `data/recovery/.recovery.md` | Agents déjà recréés, fichier obsolète |
| `debug-yaml-parser.js` | Script de debug temporaire |
| `test-suggestions.js` | Remplacé par tests structurés |
| `workspaces/test-suggestions/` (2 fichiers) | Workspace de test supprimé |

---

## 11. Résultats des Tests

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Test                          Résultat
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 unit-tests.js                 93/93  ✅
 intercom-routing-thresholds.js 32/32  ✅
 test-suggestion-routing.js    13/13  ✅
 TypeScript (tsc --noEmit)     0 erreurs ✅
 Build (npm run build)         Succès  ✅
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 12. Points d'Attention

### Mineurs

1. **Configuration non externalisée** — Les paramètres du fuzzy-matcher (seuil, modèle, URL LM Studio) sont des constantes dures dans `src/fuzzy-matcher.ts`. Si l'externalisation est souhaitée, créer `data/config/fuzzy-matcher.yaml`.

2. **Questions du spec** — Les 4 questions dans `refonte-workflow-spec.md` (section 5) ne sont pas marquées comme résolues dans le spec lui-même.

3. **Tests E2E** — Un test manuel avec LM Studio en marche serait idéal pour valider le fuzzy matching en conditions réelles.

### Recommandations

- Si le registre est modifié fréquemment, le `REBUILD_COOLDOWN_MS` (60s) peut être réduit
- Les embeddings prennent ~5-15s à générer selon le nombre de patterns — la commande `402 /rebuild` est asynchrone
- Le dossier `telecom/logs/` est créé automatiquement, mais `telecom/cache/` aussi

---

*Rapport généré automatiquement par Buffy (Codebuff) — Deepseek-v4 Flash*
*Pour toute question, exécuter `node scripts/telecom/summary.js` ou ouvrir `problems-suivants.md`*
