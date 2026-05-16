# Index des Profils - Daemons

Profils pour les agents autonomes, planifiés ou de surveillance. Ils tournent en arrière-plan et agissent sans intervention humaine directe.

---

## 📚 Lexique des Profils

| Profil | Domaine | Rôle | Mission Atomique | Déclencheur | Intrant | Extrant | Statut |
|--------|---------|------|------------------|-------------|---------|---------|--------|
| **SURVEILLANCE SYSTÈME** | | | | | | | |
| `monitor-system` | WATCH | system-monitor | Surveiller les ressources systèmes (CPU, RAM, disque), détecter les anomalies et notifier | Timer (60s), démarrage | Métriques système | `rapports/alertes/`, pushNotification | ✅ Complété |
| `WATCH-process-01` | WATCH | process | Surveiller le statut et la mémoire des processus actifs | Timer (30s) | Liste des processus à surveiller | Rapport de santé, alerte si anomalie | ✅ Complété |
| `WATCH-network-01` | WATCH | network | Vérifier la disponibilité des ports, la latence réseau et les connexions | Timer (60s) | Liste des endpoints/hôtes | Rapport de connectivité, alerte si down | ✅ Complété |
| `WATCH-file-01` | WATCH | filesystem | Surveiller les modifications de fichiers (création, modification, suppression) | Watchdog continu | Dossiers à surveiller | Log des changements, notification | ✅ Complété |
| `WATCH-health-01` | WATCH | healthcheck | Exécuter des healthchecks sur les services internes (API, BDD, cache) | Timer (30s) | Liste des services | Rapport de santé global, alerte si défaillant | ✅ Complété |
| **SUPERVISION PACO** | | | | | | | |
| `DAEMON-superviseur-01` | WATCH | superviseur | Scruter l'orchestrateur toutes les 5 min, vérifier les délégations PACO, alerter et suspendre après 3 violations | Timer (5min) | `tâches_en_cours.json`, logs coordination | `rapports/supervision/`, pushNotification, flag SUSPENDU | ✅ Complété |
| **VEILLE AMONT** | | | | | | | |
| `WATCH-tech-01` | WATCH | tech-scout | Surveiller les nouvelles versions des frameworks et librairies utilisées | Timer (24h) | Liste des dépendances | `rapports/veille/tech/{date}.md` | ✅ Complété |
| `WATCH-vuln-01` | WATCH | security | Surveiller les vulnérabilités (CVE) des dépendances et proposer des correctifs | Timer (6h) | Liste des dépendances + version | `rapports/veille/securite/{date}.md`, alertes | ✅ Complété |
| `WATCH-doc-01` | WATCH | documentation | Détecter les changements dans les documentations officielles des outils utilisés | Timer (24h) | URLs des documentations | `rapports/veille/doc/{date}.md` | ✅ Complété |
| **LOGS** | | | | | | | |
| `LOG-collect-01` | LOG | collecteur | Collecter les logs de tous les agents et les centraliser dans un format standard | Timer (5min), watchdog | Logs éparpillés dans `logs/` | Logs centralisés dans `logs/central/` | ✅ Complété |
| `LOG-format-01` | LOG | formatter | Mettre en forme les logs en JSON structuré avec niveaux de sévérité | Orchestrateur, watchdog | Logs bruts | `logs/central/{date}.json` | ✅ Complété |
| `LOG-rotate-01` | LOG | rotation | Rotationner et compresser automatiquement les logs (archivage, rétention 90 jours) | Timer (24h) | Logs à archiver | Archives dans `logs/archive/`, espace libéré | ✅ Complété |
| `LOG-alert-01` | LOG | alerter | Analyser les logs en temps réel et déclencher des alertes sur erreur critique | Watchdog continu | Flux de logs | Alertes dans `rapports/alertes/`, pushNotification | ✅ Complété |
| **MAINTENANCE** | | | | | | | |
| `MAINT-cleanup-01` | MAINT | nettoyeur | Nettoyer les fichiers temporaires, les caches et les backups obsolètes | Timer (hebdo) | Liste des dossiers à nettoyer | Espace disque récupéré, rapport | ✅ Complété |
| `MAINT-backup-01` | MAINT | backup | Sauvegarder les fichiers critiques (configs, rapports, base de connaissances) | Timer (24h) | Dossiers à sauvegarder | Backup dans `backups/{date}/` | ✅ Complété |
| `MAINT-gc-01` | MAINT | garbage-collector | Nettoyer les rapports orphelins et les tâches en statut `bloquée` depuis > 7 jours | Timer (semaine) | `tâches_en_cours.json`, `rapports/` | Nettoyage effectué, rapport | ✅ Complété |

---

## 🛠️ Convention de Nommage

- Format : `[DOMAINE]-[ROLE]-[INDEX]` (ex: `WATCH-tech-01`, `LOG-rotate-01`)
- Fichier associé : `data/profiles/daemons/{nom}.json`
