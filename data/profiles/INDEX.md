# Lexique Global des Profils d'Agents

Banque de profils pré-définis pour le moteur Hermes. Chaque profil exécute **une mission atomique unique** dans son domaine strict. **64 profils — 0 stub restant.**

**Principe fondamental** : *"Mieux vaut savoir faire une chose parfaitement que mal faire plusieurs choses à la fois."*

---

## 👥 Agents — Assistants Conversationnels
Profils destinés aux interactions directes avec l'utilisateur. Ils reçoivent une mission, l'exécutent avec TDD, documentent et passent la validation.

**Domaines** : Orchestration, Recherche, Rétro-ingénierie, Planification, Développement, Documentation, Validation
- **Total profils** : 28 (28 complétés ✅)
- [Index des Agents](./agents/INDEX.md)

## 🤖 Bots — Automatisation Technique
Profils spécialisés dans l'exécution rapide et atomique de tâches techniques, sans interaction utilisateur.

**Domaines** : Automatisation, Recherche, Planification, Git, Docker, Fichiers, Scripts
- **Total profils** : 20 (20 complétés ✅)
- [Index des Bots](./bots/INDEX.md)

## ⚙️ Daemons — Tâches de Fond
Profils pour les agents autonomes qui tournent en arrière-plan (surveillance, veille, logs, maintenance).

**Domaines** : Surveillance système, Veille amont, Logs, Maintenance
- **Total profils** : 16 (16 complétés ✅)
- [Index des Daemons](./daemons/INDEX.md)

---

## 📊 Statistiques Globales

| Type | Complété | Stub vide | **Total** |
|------|----------|-----------|-----------|
| Agents | 28 | 0 | **28** |
| Bots | 20 | 0 | **20** |
| Daemons | 16 | 0 | **16** |
| **Total** | **64** | **0** | **64** |

---

## 🧠 Architecture Associée

Tous les profils suivent le cadre défini dans `data/questions-importantes/` :
- [Architecture Globale](../questions-importantes/01-architecture-globale.md) — Domaines, cycle de vie (9 phases), orchestration, validation 3 niveaux, sécurité
- [Questions par Profil](../questions-importantes/02-questions-par-profil.md) — 14 questions pour définir chaque profil
- [Collaboration](../questions-importantes/03-collaboration.md) — Communication, conflits, traçabilité
- [Règles d'Or](../questions-importantes/04-regles-d-or.md) — 10 règles non négociables
- [Protocole PACO](../protocols/paco-protocol.md) — Délégation obligatoire par mots-clés, zéro production directe, supervision continue

---
*Dernière mise à jour : 2026-05-16 — Source de vérité des profils agents*
