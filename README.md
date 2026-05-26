<div align="center">
  <img src="assets/images/MINAUTOR_logo.png" alt="MINAUTOR Logo" width="400">

  # ⚡ MINAUTOR Agent Service

  **L'orchestration multi-agents nouvelle génération pour TypeScript & Node.js**

  [![Version](https://img.shields.io/badge/version-1.2.0-blue.svg?style=for-the-badge)](https://github.com/votre-repo)
  [![License](https://img.shields.io/badge/license-MIT-green.svg?style=for-the-badge)](LICENSE)
  [![Status](https://img.shields.io/badge/status-active-success.svg?style=for-the-badge)](https://github.com/votre-repo)
  [![Platform](https://img.shields.io/badge/platform-node.js-black.svg?style=for-the-badge)](https://nodejs.org/)

  *Inspiré par Codebuff. Propulsé par l'intelligence collective.*
</div>

---

## 📖 Sommaire

1. [✨ Introduction](#-introduction)
2. [🚀 Démarrage Rapide](#-démarrage-rapide)
3. [🛠️ Tech Stack](#️-tech-stack)
4. [💎 Caractéristiques Clés](#-caractéristiques-clés)
5. [🤖 Protocole PACO](#-protocole-paco)
6. [📦 Écosystème de Kits](#-écosystème-de-kits)
7. [🛡️ Qualité & Performance](#️-qualité--performance)
8. [🏗️ Architecture du Projet](#️-architecture-du-projet)
9. [🤝 Contribution](#-contribution)
10. [📜 Licence](#-licence)

---

## ✨ Introduction

**MINAUTOR** est un framework complet d'orchestration multi-agents conçu pour l'ère de l'IA de 2026. Il permet de définir, gérer et exécuter des agents spécialisés avec une intégration LLM fluide, une gestion de sessions persistantes et un protocole de gouvernance strict basé sur la délégation (PACO).

---

## 🚀 Démarrage Rapide

### Installation & Build

```bash
git clone https://github.com/votre-username/minautor-agents-service.git
cd minautor-agents-service
npm install
npm run final # Build complet avec linting automatique et lancement CLI
```

### Scripts Utiles

| Commande | Description |
| :--- | :--- |
| `npm run build` | Compilation TS (exécute `lint:regex` en pré-build) |
| `npm run test:load` | Exécute les tests de charge du moteur |
| `npm run validate:all` | Valide l'intégrité de tous les agents enregistrés |
| `npm run lint:regex` | Analyse statique des Regex via AST |

---

## 🛠️ Tech Stack

- **Runtime** : Node.js (v22+)
- **Langage** : TypeScript (Typage strict, AST Parsing)
- **Engine** : Multi-fournisseurs (Kilo, Gemini, OpenRouter, Ollama)
- **Qualité** : ESLint, TSX, Regex Linter (Custom AST)
- **Interface** : CLI Interactive via Inquirer

---

## 💎 Caractéristiques Clés

- 🤖 **Multi-Agent Orchestration** — Délégation intelligente via le protocole PACO.
- 🔑 **Multi-Key Rotation** — Failover transparent et gestion du rate-limiting.
- 💉 **Kits Injector** — Injection automatique d'imports via marqueurs `@kit`.
- 📡 **Telecom Services** :
  - `Daemon` : Surveillance active en arrière-plan.
  - `Resumer` : Synthèse automatique des activités.
  - `Optimiser` : Optimisation des performances des agents.
  - `Nettoyer` : Maintenance automatique des sessions et fichiers temporaires.

---

## 🤖 Protocole PACO

Gouvernance par délégation :
1. **Orchestrateur** : Chef d'orchestre, délègue aux experts.
2. **Superviseur** : Gardien de la conformité (Read-only).
3. **Audit Daemon** : Surveillance continue et rapport d'audit toutes les 5 min.

---

## 📦 Écosystème de Kits

Le système de **Kits** permet d'étendre les capacités des agents de manière modulaire :
- **Localisation** : `kits/`
- **Registre** : `registry.json` gère les versions et dépendances.
- **Utilisation** : Insérez `// @kit tests` dans votre code pour injecter automatiquement les utilitaires de test.

---

## 🛡️ Qualité & Performance

MINAUTOR intègre des outils de validation de pointe :
- **Regex AST Linter** : Intégré au workflow de build, il empêche la compilation si des expressions régulières invalides sont détectées.
- **Load Testing** : Scripts dédiés pour tester la montée en charge des sessions agents.
- **Guardian** : Système de filtrage des commandes shell pour empêcher l'exécution d'instructions malveillantes.

---

## 🏗️ Architecture du Projet

```text
.
├── kits/             # Registre et modules de kits réutilisables
├── src/
│   ├── engine/       # Cœur du moteur (Executor, Guardian, Sessions)
│   ├── telecom/      # Services de maintenance et optimisation
│   ├── kits-injector.ts # Logique d'injection automatique
│   ├── lint-regex.ts    # Analyseur AST pour les Regex
│   └── cli.ts        # Point d'entrée de l'interface utilisateur
```

---

## 📜 Licence

Distribué sous la licence MIT.

<div align="center">
  <br />
  <sub>Propulsé par <b>MINAUTOR</b> — L'excellence agentique par la structure.</sub>
</div>
