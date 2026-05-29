# Telecom Watcher Console — Spécification fonctionnelle

> **Fichier source :** `src/telecom/service/telecom-watcher-console.ts` (existant, vide)
> **Fichier compilé :** `dist/telecom/service/telecom-watcher-console.js`
> **Statut :** À implémenter

---

## 1. Résumé

Créer une console de surveillance en **fenêtre de terminal séparée** qui suit en temps réel l'activité de l'écosystème `telecom/`. Cette console s'ouvre automatiquement avec le daemon et se ferme avec lui. Elle affiche une **interface TUI à 4 quadrants** utilisant la librairie **terminal-kit**, en lecture seule.

---

## 2. Lancement et cycle de vie

### 2.1 Auto-démarrage avec le daemon

Le watcher est lancé **depuis le daemon** (`telecom-daemon.ts`), dans sa fonction `main()`, juste après l'initialisation du PID et des répertoires.

**Intégration dans `telecom-daemon.ts` :**

```typescript
// Dans main(), après writePid() et console.log de démarrage
if (!once) {
  // ...
  setupWatcher()
  launchWatcherConsole() // ← Nouvel appel
}
```

### 2.2 Détection OS pour l'ouverture de la fenêtre

```typescript
function launchWatcherConsole(): void {
  const watcherScript = join(cwd, 'dist', 'telecom', 'service', 'telecom-watcher-console.js')
  const title = `Telecom Watcher — PID:${process.pid} — intercom:0 routed:0`
  
  switch (process.platform) {
    case 'win32': {
      // start "Titre" cmd /c "node ..."
      const cmd = `start "${title}" cmd /c "node ${watcherScript}"`
      exec(cmd, { detached: true })
      break
    }
    case 'darwin': {
      // macOS: Terminal.app
      const cmd = `osascript -e 'tell app "Terminal" to do script "node ${watcherScript}"'`
      exec(cmd, { detached: true })
      break
    }
    default: {
      // Linux: x-terminal-emulator ou xterm
      const cmd = `x-terminal-emulator -e "node ${watcherScript}" || xterm -e "node ${watcherScript}"`
      exec(cmd, { detached: true })
      break
    }
  }
}
```

**Dépendance :** `import { exec } from 'node:child_process'` (déjà importé dans le daemon via `fork`).

### 2.3 Titre dynamique de la fenêtre

Le titre inclut les stats en temps réel :
```
Telecom Watcher — PID:12345 — intercom:3 routed:2
```

Le watcher lui-même met à jour le titre depuis son processus enfant via `process.title` ou, sur Windows, via `cmd /c "title ..."` ou des séquences ANSI `\x1b]0;...\x07`.

### 2.4 Cycle de vie

| Événement | Comportement |
|-----------|-------------|
| Daemon démarre | Watcher lancé dans une fenêtre séparée |
| Daemon s'arrête (SIGTERM, exit) | Watcher tué automatiquement (ou se détecte via polling du PID du daemon) |
| Daemon redémarre | Ancien watcher meurt, nouveau watcher s'ouvre |
| Utilisateur ferme la fenêtre watcher | Daemon non impacté — le watcher peut être relancé manuellement |
| CLI principal se ferme | Daemon tué → watcher tué |

**Détection de mort du daemon :** Le watcher vérifie périodiquement (toutes les 5s) si le processus parent (daemon) est toujours en vie. Si non, il se ferme proprement.

### 2.5 Commande manuelle dans le CLI

Optionnel mais souhaitable : ajouter une commande `/watcher start|stop|status` pour gérer le watcher manuellement.

```typescript
// Dans cli-main.ts, section /watcher
case 'watcher': {
  if (args[0] === 'start') { /* exec start watcher */ }
  else if (args[0] === 'stop') { /* kill watcher */ }
  else if (args[0] === 'status') { /* watcher PID, uptime */ }
  break
}
```

---

## 3. Architecture du watcher

### 3.1 Librairie : terminal-kit

Ajouter au `package.json` :
```json
"dependencies": {
  "terminal-kit": "^3.1.0"
}
```

**Installation :** `npm install terminal-kit`

### 3.2 Structure du fichier

```typescript
// src/telecom/service/telecom-watcher-console.ts

// ── État global ──
// Toutes les données sont rafraîchies périodiquement depuis les fichiers

interface WatcherState {
  intercom: IntercomEntry[]
  routed: RoutedEntry[]
  agents: AgentEntry[]
  logbook: LogEntry[]
  daemon: DaemonInfo
  notifications: NotificationEntry[]
  lastUpdate: number
  uptime: number
}

// ── Fonctions de collecte ──
function collectIntercomState(): IntercomEntry[]
function collectRoutedState(): RoutedEntry[]
function collectAgentState(): AgentEntry[]
function collectLogbookEntries(): LogEntry[]
function collectDaemonInfo(): DaemonInfo

// ── Fonctions de rendu TUI ──
function renderQuadrants(state: WatcherState): void
function renderIntercomPanel(state): void     // Q1
function renderRoutingPanel(state): void      // Q2
function renderAgentsPanel(state): void       // Q3
function renderLogsPanel(state): void         // Q4

// ── Boucle principale ──
async function main(): Promise<void> {
  // 1. Initialiser terminal-kit
  // 2. Créer layout 4 quadrants
  // 3. Configurer fs.watch sur telecom/{intercom,routed,agents}
  // 4. Lancer le polling 1s
  // 5. Boucle: collecter → rafraîchir → attendre
}
```

### 3.3 Collecte des données

#### Intercom (Q1 — Top-Left)

Lire `telecom/intercom/*.json` et extraire pour chaque message :
- Heure (timestamp)
- Expéditeur (from)
- Destinataire (to)
- Sujet (subject)
- Statut (pending/read/processed)
- Payload (extrait — première ligne ou résumé 80 chars)
- Nom du fichier

#### Routage (Q2 — Top-Right)

- Lire `telecom/routed/*.json` et `telecom/daemon.status.json`
- Derniers routages effectués
- Statistiques : total routé, spawns, blocages
- Dernières routes avec heure, de, à, sujet

#### Agents (Q3 — Bottom-Left)

- Lister `telecom/agents/*/` par dossier d'agent
- Pour chaque agent : livrables récents, erreurs
- Spawns actifs (depuis daemon.status.json)
- Statut de chaque agent (running/done/error)
- Temps écoulé depuis le dernier livrable

#### Logs (Q4 — Bottom-Right)

- Lire les dernières entrées du logbook (`telecom/agent-logbook.md`)
- Lire les notifications (`telecom/notifications.json`)
- Lire `telecom/agents/*/routage.log` pour chaque agent

### 3.4 Mise à jour

**Deux mécanismes complémentaires :**

1. **`fs.watch`** (temps réel) — Surveiller les dossiers :
   - `telecom/intercom/` — nouveaux messages
   - `telecom/routed/` — routages
   - `telecom/agents/*/` — nouveaux livrables
   - `telecom/daemon.status.json` — mise à jour du statut

2. **Polling 1s** (fallback) — Si `fs.watch` n'est pas disponible ou comme rafraîchissement de sécurité :

```typescript
setInterval(() => {
  const newState = collectAll()
  renderQuadrants(newState)
  updateTitle(newState)
}, 1000)
```

**Optimisation :** Ne réafficher un quadrant que si son contenu a changé (comparer hash ou timestamp).

---

## 4. Interface TUI — Layout 4 Quadrants

### 4.1 Disposition

```
┌────────────────────────────────────────────────────────────┐
│  Telecom Watcher — PID:12345 — intercom:3 routed:2         │
├───────────────────────────┬────────────────────────────────┤
│                           │                                 │
│   Q1 : INTERCOM           │   Q2 : ROUTAGE                  │
│   ┌──────┬──────┬──────┐  │   ┌──────┬──────┬──────┐       │
│   │ Heure│ De   │ Sujet│  │   │ Heure│ De→À │ Stat │       │
│   ├──────┼──────┼──────┤  │   ├──────┼──────┼──────┤       │
│   │ 10:15│ alice│ proj │  │   │ 10:15│ alic→│ rout │       │
│   │ 10:14│ orch│ task │  │   │ 10:14│ agen→│ spaw │       │
│   └──────┴──────┴──────┘  │   └──────┴──────┴──────┘       │
│                           │                                 │
├───────────────────────────┼────────────────────────────────┤
│                           │                                 │
│   Q3 : AGENTS             │   Q4 : LOGS & NOTIFICATIONS     │
│   ┌──────────────────┐    │   ┌──────────────────────┐      │
│   │ agent-telecom ▶  │    │   │ [10:15] Routé: ...   │      │
│   │   livrable 10:15 │    │   │ [10:14] Spawn: ...   │      │
│   │ orchestrateur ▶  │    │   │ [10:13] Notification │      │
│   │   en cours 30s   │    │   │                      │      │
│   └──────────────────┘    │   └──────────────────────┘      │
│                           │                                 │
└────────────────────────────────────────────────────────────┘
```

### 4.2 Implémentation avec terminal-kit

```typescript
import termkit from 'terminal-kit'
const term = termkit.terminal

// Créer le terminal plein écran
term.fullscreen(true)

// Définir les quadrants
const layout = {
  intercom:   { x: 0, y: 0, w: 0.5, h: 0.5 },    // Top-Left
  routing:    { x: 0.5, y: 0, w: 0.5, h: 0.5 },   // Top-Right
  agents:     { x: 0, y: 0.5, w: 0.5, h: 0.5 },   // Bottom-Left
  logs:       { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, // Bottom-Right
}
```

Chaque quadrant est un `termkit.Box` ou une zone avec bordures, titre, contenu scrollable.

### 4.3 Éléments d'interface par quadrant

#### Q1 — Intercom

| Colonne | Largeur | Contenu |
|---------|---------|---------|
| Heure   | 8       | `HH:MM:SS` |
| Statut  | 3       | `⏳`, `📖`, `✅` |
| De      | 18      | Expéditeur tronqué |
| →       | 2       | `→` |
| À       | 18      | Destinataire tronqué |
| Sujet   | 20      | Sujet tronqué |
| Payload | *       | Résumé demande (80 chars) |

**Couleurs :**
- Pending : `yellow`
- Read : `green`
- Processed : `gray`
- Titre du quadrant : `cyan` + `bold`

#### Q2 — Routage

| Colonne | Contenu |
|---------|---------|
| Heure   | Derniers routages |
| Source  | `from → to` |
| Sujet   | Sujet du message |
| Statut  | `routé ✓`, `spawn ▶`, `bloqué ⚠` |

**Section stats en haut du quadrant :**
- `Total routés : 15`
- `Spawns effectués : 12`
- `Blocages : 0`
- `Agents disponibles : 10`

#### Q3 — Agents

Liste des dossiers agents avec leur dernier état :

```
agent-telecom    ▶ PID 12345  [30s]   livrable-10:15.md
orchestrateur    ▶ PID 12346  [15s]   (en cours)
agent-reviewer   ■ done                livrable-10:10.md ✓
agent-superviseur ■ idle
agent-scrutineer ✗ error               erreur-10:05.md
```

**Indicateurs :**
- `▶` running (vert clignotant)
- `■` done/idle (gris)
- `✗` error (rouge)
- `⚠` timeout (jaune)

#### Q4 — Logs & Notifications

Console scrollante des 50 dernières lignes de logs :

```
[10:15:23] ↪ Routé: alice → agent-telecom [project-request]: liste les projets
[10:15:24] ▶ Spawn agent-telecom (PID 12345)
[10:15:48] ✓ agent-telecom terminé (succès)
[10:15:49] ✅ Notification: alice → orchestrateur [project-request]
[10:15:50] ▶ Spawn orchestrateur (PID 12346)
```

Les nouvelles lignes apparaissent en bas, le contenu défile vers le haut automatiquement (auto-scroll).

### 4.4 Barre d'état (en bas)

Barre de statut fixe en bas de l'écran affichant :

```
[PID:12345] [Daemon uptime: 12m 34s] [Watcher uptime: 12m 30s] [MAJ: 1.0s] [Ctrl+C pour quitter]
```

### 4.5 Couleurs et style

```typescript
const COLORS = {
  title:     term.bold.cyan,
  header:    term.bold,
  pending:   term.yellow,
  read:      term.green,
  running:   term.green,
  error:     term.red,
  timeout:   term.yellow,
  done:      term.gray,
  info:      term.white,
  border:    term.dim,
  highlight: term.bold,
}
```

---

## 5. Interactions et comportement

### 5.1 Lecture seule

Le watcher n'accepte **aucune saisie utilisateur**. L'utilisateur peut seulement :
- Observer les quadrants se mettre à jour
- Ctrl+C ou fermer la fenêtre pour arrêter le watcher

### 5.2 Rafraîchissement

- **fs.watch** : Déclenche une mise à jour immédiate du quadrant concerné
- **Polling 1s** : Rafraîchissement complet de tous les quadrants

### 5.3 Gestion de la fin de vie

```typescript
// Détection de la mort du daemon parent
const daemonPid = readDaemonPid() // depuis telecom/daemon.pid
setInterval(() => {
  try {
    process.kill(daemonPid, 0) // test si le process existe
  } catch {
    // Daemon mort → on ferme le watcher
    term.fullscreen(false)
    process.exit(0)
  }
}, 5000)
```

### 5.4 Gestion du redimensionnement

terminal-kit gère automatiquement le redimensionnement du terminal. Les quadrants doivent être recalculés sur l'événement `resize` :

```typescript
term.on('resize', () => {
  recalculateLayout()
  renderAll()
})
```

---

## 6. Dépendances et installation

### 6.1 Nouvelle dépendance

| Package | Version | Utilisation |
|---------|---------|-------------|
| `terminal-kit` | ^3.1.0 | Interface TUI structurée |

### 6.2 Installation

```bash
cd Q:/minautor-agents-service
npm install terminal-kit
npm install @types/terminal-kit --save-dev  # Si types disponibles
```

### 6.3 Modification du `package.json`

Ajouter dans `dependencies` :
```json
"terminal-kit": "^3.1.0"
```

---

## 7. Tests

### 7.1 Test manuel

```bash
# 1. Builder
npm run build

# 2. Lancer le watcher seul (pour test)
node dist/telecom/service/telecom-watcher-console.js

# 3. Créer un message intercom (dans une autre fenêtre)
node dist/telecom/service/intercom-manager.js send alice agent-telecom request test "hello world"

# 4. Vérifier que le watcher affiche le nouveau message dans Q1
```

### 7.2 Test d'intégration avec le daemon

```bash
# 1. Builder
npm run build

# 2. Nettoyer l'état
rm -f telecom/intercom/*.json telecom/routed/*.json

# 3. Lancer le daemon (devrait aussi lancer le watcher)
node dist/telecom/service/telecom-daemon.js

# 4. Depuis un autre terminal, envoyer un message
node dist/telecom/service/intercom-manager.js send alice agent-telecom request project-request --payload '{"demande":"liste les projets"}'

# 5. Vérifier que le watcher montre :
#    - Q1 : nouveau message pending → read
#    - Q2 : routage effectué
#    - Q4 : log de routage
```

### 7.3 Test de résilience

```bash
# Tuer le daemon et vérifier que le watcher se ferme
kill <daemon_pid>
# → La fenêtre watcher doit se fermer dans les 5s
```

---

## 8. Implémentation recommandée — Ordre des étapes

1. **Installer `terminal-kit`** via npm
2. **Créer le squelette** dans `telecom-watcher-console.ts` : layout 4 quadrants vides
3. **Implémenter `collectIntercomState()`** et le rendu Q1
4. **Implémenter `collectRoutedState()`** et le rendu Q2
5. **Implémenter `collectAgentState()`** et le rendu Q3
6. **Implémenter `collectLogbook()`** et le rendu Q4
7. **Ajouter `fs.watch`** pour les mises à jour temps réel
8. **Ajouter le polling 1s** comme fallback
9. **Intégrer le lancement dans `telecom-daemon.ts`**
10. **Ajouter la détection de mort du daemon** + fermeture
11. **Tester l'intégration complète**

---

## 9. Glossaire

| Terme | Définition |
|-------|------------|
| **Daemon** | Service fond (`telecom-daemon.ts`) qui surveille `telecom/intercom/` et route les messages |
| **Intercom** | Dossier `telecom/intercom/` contenant les messages JSON en attente |
| **Routed** | Dossier `telecom/routed/` contenant les messages après routage |
| **Agent** | Agent IA défini dans `.agents/` avec un dossier de travail dans `telecom/agents/` |
| **Livrable** | Fichier `livrable-*.md` produit par un agent dans son dossier |
| **Logbook** | Fichier `telecom/agent-logbook.md` journalisant les événements des spawns |
| **TUI** | Terminal User Interface — interface utilisateur textuelle structurée |
| **terminal-kit** | Librairie Node.js pour créer des interfaces TUI riches |
| **Quadrant** | Zone d'affichage dans une grille 2×2 |

---

## 10. Annexes

### 10.1 Références terminal-kit

- [terminal-kit GitHub](https://github.com/cronvel/terminal-kit)
- Documentation : `Document` model pour layouts, `Box`, `Text`, `ScrollableText`
- Événements : `resize`, `key` (pour Ctrl+C)

### 10.2 Fichiers impactés

| Fichier | Changement |
|---------|-----------|
| `src/telecom/service/telecom-watcher-console.ts` | **Nouveau** — watcher TUI complet |
| `src/telecom/service/telecom-daemon.ts` | **Modifié** — ajout de `launchWatcherConsole()` dans `main()` |
| `package.json` | **Modifié** — ajout de `terminal-kit` en dépendance |

### 10.3 Schéma des données intercom (rappel)

```typescript
interface IntercomMessage {
  id: string
  from: string
  to: string
  type: 'request' | 'response' | 'signal' | 'log' | 'alert'
  subject: string
  payload: Record<string, unknown>
  timestamp: string
  status: 'pending' | 'read' | 'processed' | 'archived'
}
```
