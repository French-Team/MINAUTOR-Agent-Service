# Lexique Global des Profils d'Agents

Banque de profils pré-définis pour le moteur Hermes. Chaque profil exécute **une mission atomique unique** dans son domaine strict. **541 profils — 0 stub restant.**

**Principe fondamental** : *"Mieux vaut savoir faire une chose parfaitement que mal faire plusieurs choses à la fois."*

---

## 👥 Agents — Assistants Conversationnels
Profils destinés aux interactions directes avec l'utilisateur. Ils reçoivent une mission, l'exécutent avec TDD, documentent et passent la validation.

**Domaines** : Analyse projet, Orchestration générale, Orchestration spécialisée, Supervision, Documentation, Ingénierie, Diagrammes, Intérim, Validation, Recherche, Planification, Développement (CSS, Next.js, Python, React, Rust, Vanilla, Vite), Revue
- **Total profils** : 214 (214 complétés ✅)
- [Index des Agents](./agents/INDEX.md)

## 🤖 Bots — Automatisation Technique
Profils spécialisés dans l'exécution rapide et atomique de tâches techniques, sans interaction utilisateur.

**Domaines** : Sauvegarde, Docker, Exécution, Fichiers, Formatage, Git, Optimisation (8 profils), Paquets (10 profils), Performance (8 profils), Planification (20 profils), Recherche (20 profils), Réseau (10 profils), Scripts (20 profils), Synchronisation (10 profils), Tests (19 profils), Boucles de travail (21 profils), Signaux (10 profils), Rétro-actions (8 profils), Introspection (10 profils), Débogage (10 profils), Refonte (10 profils)
- **Total profils** : 269 (269 complétés ✅)
- [Index des Bots](./bots/INDEX.md)

## ⚙️ Daemons — Tâches de Fond
Profils pour les agents autonomes qui tournent en arrière-plan (surveillance, veille, logs, maintenance).

**Domaines** : Logs (15 profils), Maintenance (12 profils), Performance (5 profils), Surveillance système (19 profils), Supervision PACO, Veille amont, Boucles autonomes (15 profils), Coordination signaux (10 profils), Analyse rétro-active (8 profils), Surveillance système (5 profils), Surveillance erreurs (5 profils), Surveillance structurelle (5 profils)
- **Total profils** : 103 (103 complétés ✅)
- [Index des Daemons](./daemons/INDEX.md)

---

## 📊 Statistiques Globales

| Type | Complété | Stub vide | **Total** |
|------|----------|-----------|-----------|
| Agents | 226 | 0 | **226** |
| Bots | 269 | 0 | **269** |
| Daemons | 103 | 0 | **103** |
| **Total** : **598** | **0** : **598** |

---

## 🧠 Architecture Associée

Tous les profils suivent le cadre défini dans `data/questions-importantes/` :
- [Architecture Globale](../questions-importantes/01-architecture-globale.md) — Domaines, cycle de vie (9 phases), orchestration, validation 3 niveaux, sécurité
- [Questions par Profil](../questions-importantes/02-questions-par-profil.md) — 14 questions pour définir chaque profil
- [Collaboration](../questions-importantes/03-collaboration.md) — Communication, conflits, traçabilité
- [Règles d'Or](../questions-importantes/04-regles-d-or.md) — 10 règles non négociables
- [Protocole PACO](../protocols/paco-protocol.md) — Délégation obligatoire par mots-clés, zéro production directe, supervision continue

---
*Dernière mise à jour : 2026-05-17 — Source de vérité des profils agents*
