# Instructions Utilisateur — Minautor Agent Service

## 📖 Comment utiliser ce fichier

1. **Remplis ce fichier** avec tes instructions pour l'agent
2. **Consulte le template** : `TEMPLATE-user-instructions.md` pour la structure complète
3. **L'agent lira** ce fichier et mettra à jour `agent-logbook.md`
4. **Sauvegarde** tes instructions dans l'historique en bas

---

## 📋 Instruction Actuelle

### Objectif
✅ **COMPLÉTÉE** — Corriger toutes les URLs LM Studio pour inclure `/v1` et éviter les erreurs futures

### Contexte
Après avoir corrigé les vérifications dans "éditer un agent", nous avons découvert que LM Studio utilise l'API OpenAI-compatible avec le préfixe `/v1`. Il y avait plusieurs occurrences dans le code qui utilisaient des URLs incorrectes.

### Problèmes Identifiés et Corrigés

#### 1. ✅ `src/test.ts` (ligne 203-205)
- **Ancien** : `provider: 'lmstudio'` avec `baseUrl: 'http://localhost:1234'`
- **Nouveau** : `provider: 'lm-studio'` avec `baseUrl: 'http://localhost:1234/v1'`
- **Raison** : Cohérence avec le reste du code et inclusion du `/v1`

#### 2. ✅ `src/cli.ts` (ligne 1377)
- **Ancien** : `baseUrl = ... 'http://localhost:1234'`
- **Nouveau** : `baseUrl = ... 'http://localhost:1234/v1'`
- **Raison** : Ajout du `/v1` pour les appels API

#### 3. ✅ `src/providers.ts` (ligne 562)
- **Ancien** : `fetch(\`${base}/models\`)`
- **Nouveau** : `fetch(\`${base}/v1/models\`)`
- **Raison** : Correction de l'endpoint dans `checkLocalProvider()`

### Résumé des Corrections

| Fichier | Ligne | Ancien | Nouveau | Raison |
|---------|-------|--------|---------|--------|
| test.ts | 203 | `lmstudio` | `lm-studio` | Cohérence |
| test.ts | 203 | `http://localhost:1234` | `http://localhost:1234/v1` | Ajout `/v1` |
| cli.ts | 1377 | `http://localhost:1234` | `http://localhost:1234/v1` | Ajout `/v1` |
| providers.ts | 562 | `/models` | `/v1/models` | Ajout `/v1` |

### Vérification
- ✅ Compilation réussie
- ✅ Toutes les URLs LM Studio incluent maintenant `/v1`
- ✅ Pas d'autres occurrences problématiques trouvées

---

## 📝 Historique des Instructions

| Date | Instruction | Statut |
|------|-------------|--------|
| 2026-05-17 | Corriger favicon.ico | ✅ Terminé |
| 2026-05-17 | Vérifier et corriger les providers | ✅ Terminé |
| 2026-05-17 | Ajouter vérifications providers dans éditer agent | ✅ Terminé |
| 2026-05-17 | Corriger toutes les URLs LM Studio pour inclure /v1 | ✅ Terminé |

---

**Dernière mise à jour :** 2026-05-17  
**Voir aussi :** `TEMPLATE-user-instructions.md` pour la structure complète
