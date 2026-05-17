# Carnet de Bord — Hermes Agent Engine

> **Vision :** Moteur d'agents autonome basé sur l'Hyper-Granularité. Chaque agent = une mission atomique. Zéro invention. Délégation obligatoire (PACO).

---

## 🎯 État du Système

| # | Composant | Statut | Mission |
|---|-----------|--------|---------|
| 1 | **Core Engine** | ✅ | Gestion des sessions, appels LLM, exécution d'outils asynchrones |
| 2 | **Guardian** | ✅ | Sécurité et filtrage des commandes shell dangereuses |
| 3 | **Self-Correction** | ✅ | Boucles de validation et auto-correction des sorties LLM |
| 4 | **Parallel Tools** | ✅ | Exécution d'outils en parallèle pour la performance |
| 5 | **Scaffold Agent** | ✅ | Création automatisée d'agents (nom, template, profil) |
| 6 | **Streaming UI** | ✅ | Affichage progressif des réponses dans le terminal |
| 7 | **Intelligence Amont** | ✅ | Profils dédiés à la Recherche Web, Code et Planification |
| 8 | **Banque de Profils** | ✅ | 64 profils (28 agents, 20 bots, 16 daemons) — 0 stub |
| 9 | **Orchestration PACO** | ✅ | Équipe (Orchestrateur, Superviseur) pilotant la certification |
| 10 | **Golden Rules** | ✅ | Règles de validation : agent, skill, orchestration PACO |
| 11 | **Templates** | ✅ | standard, fast, daemon, orchestration-team |

---

## ✅ Étapes Terminées

| Phase | Description | Points clés |
|-------|-------------|-------------|
| 🛡️ **Sécurité** | Implémentation du Guardian | Filtrage Regex, Audit Trail, confirmation forcée. |
| 🔄 **Fiabilité** | Self-Correction | Retry technique + validation métier par LLM. |
| ⚡ **Performance** | Parallel Tools | `Promise.all` sur les outils, `execAsync`, throttling. |
| 🔄 **Certification** | Auto-correction++ | Augmentation à 5 tentatives, détection de stagnation, injection du feedback reviewer et calibration du Reviewer (Golden Rules). |
| 🧪 **Analyse Workflow**| Correction Échec | Identification de l'instabilité des petits modèles (1.2B) et réduction de la sévérité du Reviewer pour éviter les blocages sur des points subjectifs. |
| 🗺️ **Cartographie**| Profil Pisteur & Boucle Tools | Implémentation de la boucle d'exécution des outils dans le moteur pour permettre l'autonomie réelle. |
| 🤖 **Autonomie** | Scaffold Automatisé | Choix autonome du nom (Mythologie), Template et Profil. Amélioration du matching des dieux grecs (extraction intelligente). |

---

## 📊 Profils — 64 / 64 complétés

| Type | Quantité | Statut |
|------|----------|--------|
| Agents | 28 | ✅ Tous complétés |
| Bots | 20 | ✅ Tous complétés |
| Daemons | 16 | ✅ Tous complétés |
| **Total** | **64** | **0 stub restant** |

---

## 🧩 Architecture

```
src/
├── engine.ts             # Cœur du moteur (Sessions, LLM, Tools)
├── cli.ts                # Interface interactive + logique de création
├── agents.ts             # Gestion fichiers agents et profils
├── validate-agent.ts     # Validation autonome d'un agent
├── generate-skill.ts     # Génération et validation de skills
data/
├── profiles/             # 64 profils (agents/, bots/, daemons/)
├── protocols/            # PACO : keyword-registry.yaml, paco-protocol.md
├── golden-rules/         # Règles de validation : agent, skill, orchestration
├── templates/            # Templates TS pour scaffolding
questions-importantes/    # Architecture, collaboration, règles d'or
```

---

## 📜 Protocole PACO

- **Registre de mots-clés** : 30+ entrées mappant mots → agents
- **Orchestrateur** : zéro production directe, délégation obligatoire
- **Superviseur** : scrutation toutes les 5 min, 3 violations → suspension
- **Golden rules** : 6 règles critiques validant l'équipe d'orchestration

---

## 🔜 Prochaines étapes

1. Implémenter les agents runtime (`.agents/*.ts`) à partir des profils
2. Tester la collaboration orchestrateur → agents spécialisés
3. Développer les bots d'automatisation (Git, Docker, SCRIPT, FILE)
4. Déployer les daemons de surveillance système
5. Tests d'intégration complets
