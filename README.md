<div align="center">
  <img src="assets/images/MINAUTOR_logo.png" alt="MINAUTOR Logo" width="400">

  # ⚡ MINAUTOR Agent Service

  **L'orchestration multi-agents nouvelle génération pour TypeScript & Node.js**

  [![Version](https://img.shields.io/badge/version-1.6.0-blue.svg?style=for-the-badge)](https://github.com/French-Team/MINAUTOR-Agent-Service)
  [![License](https://img.shields.io/badge/license-MIT-green.svg?style=for-the-badge)](LICENSE)
  [![Status](https://img.shields.io/badge/status-active-success.svg?style=for-the-badge)](https://github.com/French-Team/MINAUTOR-Agent-Service)
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
git clone https://github.com/French-Team/MINAUTOR-Agent-Service.git
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

- **Runtime** : Node.js (v22/v24)
- **Langage** : TypeScript (Typage strict, AST Parsing)
- **Engine** : Multi-fournisseurs (Kilo, Gemini, OpenRouter, Ollama)
- **CI/CD** : GitHub Actions (Node 24, Pipeline de tests unitaires, intégration & performance)
- **Sécurité** : Système de permissions granulaire (Feurouge)

---

## 💎 Caractéristiques Clés

- 🤖 **Multi-Agent Orchestration** — Délégation intelligente via le protocole PACO.
- 🔑 **Multi-Key Rotation** — Failover transparent et gestion du rate-limiting.
- 💉 **Kits Injector & Engine API** — Injection automatique d'imports et exportations directes des fonctions de kits via le moteur.
- 📡 **Telecom Context Pipeline** : Système déterministe de compression de contexte en 3 étapes :
  1. **Optimiser** : Transformation du langage naturel verbeux en directives compactes.
  2. **Nettoyer** : Élimination des caractères de contrôle, espaces redondants et pollution textuelle.
  3. **Resumer** : Synthèse de l'historique ancien tout en préservant intacts les échanges récents.
- 🎨 **Visual Identity** : Système de couches utilisateur (`src/logo/layer-user.ts`) pour une identification visuelle dynamique.
- 🛡️ **Feurouge (Permissions)** : Système de gestion des droits et permissions d'accès (`src/feurouge/`) pour sécuriser les actions des agents.

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
- **Injection** : Utilisation de `// @kit <nom>` pour l'auto-injection d'imports.

---

## 🛡️ Qualité & Performance

MINAUTOR intègre des outils de validation de pointe :
- **Regex AST Linter** : Intégré au workflow de build et à la CI pour garantir la sécurité des expressions régulières.
- **Load Testing** : Scripts dédiés pour tester la montée en charge.
- **Guardian** : Filtrage intelligent des commandes shell.

---

## 🏗️ Architecture du Projet

```text
.
├── .github/workflows # Configuration CI/CD optimisée pour Node 24
├── kits/             # Registre et modules de kits réutilisables
├── src/
│   ├── engine/       # Cœur du moteur (Executor, Guardian, Sessions, Runner)
│   ├── feurouge/     # Système de permissions et sécurité
│   ├── telecom/      # Pipeline de compression de contexte (Optimiser, Nettoyer, Resumer)
│   ├── logo/         # Logique d'identité visuelle utilisateur
│   ├── kits-injector.ts # Moteur d'injection de kits
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
