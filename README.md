<div align="center">
  <img src="assets/images/MINAUTOR_logo.png" alt="MINAUTOR Logo" width="400">

  # ⚡ MINAUTOR Agent Service

  **L'orchestration multi-agents nouvelle génération pour TypeScript & Node.js**

  [![Version](https://img.shields.io/badge/version-1.1.0-blue.svg?style=for-the-badge)](https://github.com/votre-repo)
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
6. [📚 Bibliothèque de Profils](#-bibliothèque-de-profils)
7. [🏗️ Architecture du Projet](#️-architecture-du-projet)
8. [🤝 Contribution](#-contribution)
9. [📜 Licence](#-licence)

---

## ✨ Introduction

**MINAUTOR** est un framework complet d'orchestration multi-agents conçu pour l'ère de l'IA de 2026. Il permet de définir, gérer et exécuter des agents spécialisés avec une intégration LLM fluide, une gestion de sessions persistantes et un protocole de gouvernance strict basé sur la délégation (PACO).

Que vous ayez besoin d'un assistant de développement interactif ou de démons de surveillance en arrière-plan, MINAUTOR offre la flexibilité et la robustesse nécessaires pour vos workflows d'IA les plus complexes.

---

## 🚀 Démarrage Rapide

### Installation

```bash
# Cloner le dépôt
git clone https://github.com/votre-username/minautor-agents-service.git
cd minautor-agents-service

# Installer les dépendances
npm install

# Build & Lancement (Mode Interactif)
npm run final
```

### Utilisation Interactive (CLI)

Lancez le menu principal pour accéder à toutes les fonctionnalités :
- **1. Create agent** : Configurez votre premier agent (Provider, Modèle, Profil).
- **2. Start session** : Engagez la conversation avec vos agents.
- **5. Manage providers** : Configurez vos clés API (Gemini, OpenRouter, Kilo, etc.).

---

## 🛠️ Tech Stack

| Technologie | Usage |
| :--- | :--- |
| **TypeScript** | Langage principal & Typage strict |
| **Node.js** | Runtime environnement |
| **LLM Engine** | Moteur multi-fournisseurs (Kilo, Gemini, Ollama, etc.) |
| **Inquirer** | Interface CLI interactive |
| **YAML** | Parsing des compétences (Skill System) |
| **AST Parsing** | Analyse statique avancée pour le linting et l'injection |

---

## 💎 Caractéristiques Clés

- 🤖 **Multi-Agent Orchestration** — Déléguez des tâches complexes à une équipe d'agents spécialisés.
- 🔑 **Multi-Key Rotation** — Failover automatique entre clés API avec détection de rate-limit.
- 🛠️ **Tool Loop & Guardian** — Exécution sécurisée d'outils avec blocage des commandes dangereuses.
- 📡 **Inter-Process Notifications** — Communication fluide entre les démons et l'interface CLI.
- 🔄 **Self-Correction** — Capacité du moteur à valider et corriger les sorties LLM en temps réel.
- 📦 **Skill System** — Système auto-généré de compétences via `SKILL.md`.
- 💉 **Kits Injector** — Injection automatique d'imports via marqueurs `@kit` pour accélérer le développement.
- 🔍 **Regex Linter** — Analyse statique via TypeScript AST pour garantir la validité des expressions régulières.

---

## 🤖 Protocole PACO

Le protocole **PACO (Protocol for Agentic COordination)** garantit une gouvernance stricte :
1. **Orchestrateur** : Coordonne et délègue, ne produit jamais de livrables directement.
2. **Superviseur** : Surveille la conformité de l'orchestrateur (Lecture seule).
3. **Daemon-superviseur** : Audit en arrière-plan toutes les 5 minutes.

---

## 📚 Bibliothèque de Profils

Accédez à **598 profils pré-configurés** pour accélérer vos créations :
- 👨‍💻 **226 Agents** : Experts en code (Python, React, Rust), planification, analyse.
- 🤖 **269 Bots** : Automatisation Git, Docker, tests, scripts.
- 🕵️ **103 Daemons** : Maintenance, surveillance, logs, coordination.

---

## 🏗️ Architecture du Projet

```text
src/
├── engine/           # Moteur LLM (Sessions, Tool Loop, Guardian)
├── cli/              # Interface utilisateur (Menus, Sessions, Agents)
├── kits-injector.ts  # Système d'injection automatique de kits
├── lint-regex.ts     # Validateur de Regex via TypeScript AST
├── agents.ts         # Gestion CRUD et scaffolding des agents
├── providers.ts      # Gestion des fournisseurs et rotation des clés
├── skills.ts         # Système de compétences et parsing YAML
└── telecom/          # Services d'arrière-plan et intercom
```

---

## 🤝 Contribution

Les contributions sont les bienvenues ! 
1. Forkez le projet
2. Créez votre branche (`git checkout -b feature/AmazingFeature`)
3. Committez vos changements (`git commit -m 'Add some AmazingFeature'`)
4. Pushez vers la branche (`git push origin feature/AmazingFeature`)
5. Ouvrez une Pull Request

---

## 📜 Licence

Distribué sous la licence MIT. Voir `LICENSE` pour plus d'informations.

<div align="center">
  <br />
  <sub>Propulsé par <b>MINAUTOR</b> — Redéfinir l'autonomie agentique.</sub>
</div>
