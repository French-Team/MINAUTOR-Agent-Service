# Améliorations pour Agents - Phase 1

## Contexte

Les agents actuels du système Minautor Agent Service sont fonctionnels mais peuvent être améliorés en termes de fiabilité, sécurité, performance et observabilité.

Ce document détaille les améliorations proposées, leur implémentation potentielle, et les fichiers à modifier.

---

## 1. Self-Correction (Auto-Correction)

### Description
L'agent se relit avant de retourner une réponse. Vérifie que le output est cohérent avec la demande et les contraintes.

### Implémentation
```typescript
interface SelfCorrection {
  enabled: boolean
  retryOnFailure: boolean
  maxRetries: number
  validateOutput: boolean
}
```

### Workflow
```
1. Agent génère réponse
2. SelfCorrection active → Réponse passe par un validateur
3. Si invalide → Retry jusqu'à maxRetries
4. Si toujours invalide → Retourne avec avertissement
```

---

## 2. Guardian (Garde de Sécurité)

### Description
Filtre de sécurité qui bloque les actions dangereuses ou irreversibles avant exécution.

### Actions bloquables
- Suppression de fichiers (rm, del, unlink)
- Modifications de base de données (DROP, DELETE sans WHERE)
- Accès à des fichiers système critiques (/etc, /windows/system32)
- Commandes réseau potentiellement dangereuses
- Execution de code arbitraire

### Implémentation
```typescript
interface Guardian {
  enabled: boolean
  blockHarmful: boolean           // Bloque les actions dangereuses
  requireConfirmation: boolean    // Demande confirmation pour actions irréversibles
  auditTrail: boolean           // Log toutes les actions
  blockedPatterns: RegExp[]      // Patterns à bloquer
}
```

---

## 3. Health Check (Daemon)

### Description
Monitoring automatique pour les agents daemon. Vérifie que le daemon fonctionne et peut s'auto-restarter si nécessaire.

### Implémentation
```typescript
interface DaemonHealth {
  enabled: boolean
  checkIntervalMs: number        // Fréquence des checks (défaut: 30000)
  maxConsecutiveFailures: number // Arrêt après N échecs (défaut: 3)
  autoRestart: boolean           // Redémarrage automatique
  maxRestarts: number           // Max restart dans une fenêtre de temps
}
```

---

## 4. Streaming

### Description
Retourne la réponse du LLM en temps réel plutôt que d'attendre la réponse complète.

### Implémentation
```typescript
interface Streaming {
  enabled: boolean
  chunkSize: number             // Taille des chunks en tokens (défaut: 50)
  showThinking: boolean         // Affiche le "thinking" en cours
}
```

---

## 5. Rate Limiting

### Description
Empêche de saturer une API ou un service avec trop de requêtes.

### Implémentation
```typescript
interface RateLimit {
  enabled: boolean
  requestsPerMinute: number      // Max req/min
  burst: number                // Burst allowed
  backoffMultiplier: number     // Multiplicateur en cas de limite
}
```

---

## 6. Parallel Tools

### Description
Exécute plusieurs outils en même temps quand ils sont indépendants.

### Implémentation
```typescript
interface ToolConfig {
  parallelTools: boolean         // Active le parallel mode
  toolTimeoutMs: number         // Timeout par tool
  maxParallel: number           // Max tools parallèles (défaut: 5)
}
```

---

## Fichiers à Modifier

### 1. Types
- `src/types/agent-definition.ts` - Ajouter les nouveaux types

### 2. Templates
- `data/templates/llm-agent-template.ts` - Agent Standard
- `data/templates/fast-intelligent-bot-template.ts` - Bot Rapide & Intelligent
- `data/templates/daemon-agent-template.ts` - Agent Daemon

### 3. Engine & Logique
- `src/agents.ts` - Templates inline + parsing
- `src/engine.ts` - Implémentation des fonctionnalités
- `src/cli.ts` - Options de configuration si besoin

---

## Évolution des Templates

### Template Agent Standard
```typescript
export const agent = {
  displayName: "{{displayName}}",
  model: "{{model}}",
  toolNames: ["run_terminal_command", "add_message", "set_output", "skill"],
  instructionsPrompt: `...`,

  // Nouvelles config
  selfCorrection: {
    enabled: false,  // Opt-in pour standard
    maxRetries: 2,
  },
  guardian: {
    enabled: true,  // Actif par défaut pour la sécurité
    blockHarmful: true,
    requireConfirmation: false,
    auditTrail: true,
  },
}
```

### Template Bot Rapide & Intelligent
```typescript
export const agent = {
  // ... existant ...

  // Nouvelles config - toutes actives pour ce template
  selfCorrection: {
    enabled: true,
    maxRetries: 3,
    validateOutput: true,
  },
  guardian: {
    enabled: true,
    blockHarmful: true,
    requireConfirmation: false,
    auditTrail: true,
  },
  streaming: {
    enabled: true,
    chunkSize: 50,
  },
  parallelTools: {
    enabled: true,
    maxParallel: 5,
  },
  rateLimit: {
    enabled: true,
    requestsPerMinute: 60,
  },
}
```

### Template Daemon
```typescript
export const agent = {
  // ... existant ...

  daemonConfig: {
    defaultIntervalMs: 60000,
    defaultNotificationMessage: "...",
  },

  // Nouvelles config daemon
  healthCheck: {
    enabled: true,
    checkIntervalMs: 30000,
    maxConsecutiveFailures: 3,
    autoRestart: true,
    maxRestarts: 5,
  },
  guardian: {
    enabled: true,
    blockHarmful: true,
    requireConfirmation: true,  // Plus prudent pour daemon
    auditTrail: true,
  },
}
```

---

## Résumé des Priorités

| Feature | Utilité | Difficulté | Template Impact |
|---------|---------|------------|-----------------|
| Guardian | ⭐⭐⭐ | Moyenne | Tous (principalement daemon) |
| Self-Correction | ⭐⭐⭐ | Moyenne | Tous |
| Parallel Tools | ⭐⭐ | Moyenne | Fast Bot |
| Health Check | ⭐⭐ | Facile | Daemon |
| Rate Limiting | ⭐ | Moyenne | Fast Bot |
| Streaming | ⭐ | Difficile | Fast Bot |

---

## Prochaines Étapes

1. **Phase 1** (ce document): Documentation détaillée ✓
2. **Phase 2**: Mettre à jour `src/types/agent-definition.ts`
3. **Phase 3**: Modifier les 3 templates pour inclure les configs
4. **Phase 4**: Implémenter Guardian + Self-Correction dans engine.ts
5. **Phase 5**: Testing et validation

---

*Document généré le: $(date)*
*Version: 1.1*
