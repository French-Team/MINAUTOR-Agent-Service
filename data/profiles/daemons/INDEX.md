# Index des Profils - Daemons

Profils pour les agents autonomes, planifiés ou de surveillance. Ils tournent en arrière-plan et agissent sans intervention humaine directe. **55 profils — tous complétés.**

Déclenchement : **timer ou watchdog** (autonome). Tous les daemons ont une section `healthCheck` obligatoire.

---

## 📚 Lexique des Profils

| Profil | Domaine | Rôle | Mission Atomique | Déclencheur | Intrant | Extrant | Statut |
|--------|---------|------|------------------|-------------|---------|---------|--------|
| **SURVEILLANCE SYSTÈME** | | | | | | | |
| `WATCH-doc-01` | WATCH | documentation | Détecter les changements dans les documentations officielles des outils utilisés | Timer (24h) | URLs des documentations | `rapports/veille/doc/{date}.md` | ✅ Complété |
| `WATCH-file-02` | WATCH | filesystem | Surveiller les modifications de fichiers (création, modification, suppression) | Watchdog continu | Dossiers à surveiller | Log des changements, notification | ✅ Complété |
| `WATCH-health-03` | WATCH | healthcheck | Exécuter des healthchecks sur les services internes (API, BDD, cache) | Timer (30s) | Liste des services | Rapport de santé global, alerte si défaillant | ✅ Complété |
| `WATCH-monitor-system-04` | WATCH | system-monitor | Surveiller les ressources systèmes (CPU, RAM, disque), détecter les anomalies et notifier | Timer (60s), démarrage | Métriques système | `rapports/alertes/`, pushNotification | ✅ Complété |
| `WATCH-network-05` | WATCH | network | Vérifier la disponibilité des ports, la latence réseau et les connexions | Timer (60s) | Liste des endpoints/hôtes | Rapport de connectivité, alerte si down | ✅ Complété |
| `WATCH-process-06` | WATCH | process | Surveiller le statut et la mémoire des processus actifs | Timer (30s) | Liste des processus à surveiller | Rapport de santé, alerte si anomalie | ✅ Complété |
| `WATCH-superviseur-07` | WATCH | superviseur | Scruter l'orchestrateur toutes les 5 min, vérifier les délégations PACO, alerter et suspendre après 3 violations | Timer (5min) | `tâches_en_cours.json`, logs coordination | `rapports/supervision/`, pushNotification, flag SUSPENDU | ✅ Complété |
| `WATCH-tech-08` | WATCH | tech-scout | Surveiller les nouvelles versions des frameworks et librairies utilisées | Timer (24h) | Liste des dépendances | `rapports/veille/tech/{date}.md` | ✅ Complété |
| `WATCH-vuln-09` | WATCH | security | Surveiller les vulnérabilités (CVE) des dépendances et proposer des correctifs | Timer (6h) | Liste des dépendances + version | `rapports/veille/securite/{date}.md`, alertes | ✅ Complété |
| `WATCH-api-10` | WATCH | api | Surveiller endpoints API (latence, statut, SLA, conformité réponse) | Timer (60s) | Endpoints à surveiller | Uptime %, latence p99, erreurs | ✅ Complété |
| `WATCH-cert-11` | WATCH | cert | Surveiller certificats SSL/TLS (expiration, chaîne, SAN, algo) | Timer (24h) | Domaines à surveiller | Rapport expiration, alertes progressives | ✅ Complété |
| `WATCH-dns-12` | WATCH | dns | Surveiller DNS (résolution A/AAAA/MX, propagation, changements) | Timer (5min) | Domaines à surveiller | Records, changements, latence | ✅ Complété |
| `WATCH-docker-13` | WATCH | docker | Surveiller conteneurs Docker (santé, CPU/RAM, crash-loop) | Timer (30s) | Conteneurs à surveiller | Santé par conteneur, incidents | ✅ Complété |
| `WATCH-log-14` | WATCH | log | Surveiller patterns dans logs en temps réel (watchdog configurable) | Watchdog continu | Flux de logs | Patterns détectés, occurrences, tendance | ✅ Complété |
| `WATCH-config-16` | WATCH | config | Détecter dérive de configuration (config drift vs baseline) | Timer (5min) | Fichiers de config | Dérives détectées, diff, alertes | ✅ Complété |
| `WATCH-license-17` | WATCH | license | Surveiller licences/abonnements (expiration, coûts, renouvellement) | Timer (24h) | Registre des licences | Échéances, coûts, ordre de priorité | ✅ Complété |
| `WATCH-backup-18` | WATCH | backup | Surveiller fraîcheur et succès des sauvegardes (age, taille, intégrité) | Timer (1h) | Backups à vérifier | Statut backup, historique 7 jours | ✅ Complété |
| `WATCH-synthetic-19` | WATCH | synthetic | Monitoring synthétique (parcours utilisateur automatisés critiques) | Timer (5min) | Parcours à exécuter | Succès/échec par étape, durée | ✅ Complété |
| `WATCH-weather-20` | WATCH | weather | Surveiller conditions externes (statut GitHub, npm, Docker, clouds) | Timer (5min) | Services tiers | Statut services, incidents, maintenances | ✅ Complété |
| **LOGS** | | | | | | | |
| `LOG-alert-01` | LOG | alerter | Analyser les logs en temps réel et déclencher des alertes sur erreur critique | Watchdog continu | Flux de logs | Alertes dans `rapports/alertes/`, pushNotification | ✅ Complété |
| `LOG-collect-02` | LOG | collecteur | Collecter les logs de tous les agents et les centraliser dans un format standard | Timer (5min), watchdog | Logs éparpillés dans `logs/` | Logs centralisés dans `logs/central/` | ✅ Complété |
| `LOG-format-03` | LOG | formatter | Mettre en forme les logs en JSON structuré avec niveaux de sévérité | Watchdog | Logs bruts | `logs/central/{date}.json` | ✅ Complété |
| `LOG-rotate-04` | LOG | rotation | Rotationner et compresser automatiquement les logs (archivage, rétention 90 jours) | Timer (24h) | Logs à archiver | Archives dans `logs/archive/`, espace libéré | ✅ Complété |
| `LOG-query-05` | LOG | query | Rechercher et interroger les logs (Loki LogQL, Elasticsearch KQL, grep filtré) | Timer (5min) | Requête + filtres | Résultats formatés, tableau/JSON | ✅ Complété |
| `LOG-analyze-06` | LOG | analyze | Analyse intelligente des logs (anomalies, patterns, tendances, AI/ML) | Timer (1h) | Fenêtre temporelle | Rapport anomalies, tendances, recommandations | ✅ Complété |
| `LOG-correlate-07` | LOG | correlate | Corrélation logs-traces-métriques (OpenTelemetry, traceID/spanID) | Timer (5min) | traceID ou période | Waterfall, logs+traces+métriques corrélés | ✅ Complété |
| `LOG-mask-08` | LOG | mask | Masquer les données sensibles (PII, secrets, tokens, emails) en pipeline | Watchdog continu | Flux de logs | Logs masqués, rapport occurrences | ✅ Complété |
| `LOG-sample-09` | LOG | sample | Échantillonnage adaptatif des logs (INFO/DEBUG réduits, 100% ERROR) | Watchdog continu | Flux de logs | Volume réduit, check coût/valeur | ✅ Complété |
| `LOG-metrics-10` | LOG | metrics | Conversion logs → métriques Prometheus (compteurs, taux, histogrammes) | Timer (60s) | Logs structurés | Métriques exposées, réduction stockage | ✅ Complété |
| `LOG-enrich-11` | LOG | enrich | Enrichir les logs avec contexte (service, version, environnement, équipe) | Watchdog continu | Flux de logs | Logs enrichis, métadonnées ajoutées | ✅ Complété |
| `LOG-archive-12` | LOG | archive | Archivage longue durée et récupération de logs historiques (> 90 jours) | Timer (24h) | Logs à archiver | Archive compressée, index, restauration | ✅ Complété |
| `LOG-audit-13` | LOG | audit | Piste d'audit immuable (hash chain, conformité GDPR, SOC 2) | Timer (5min) + watchdog | Flux de logs | Chaîne d'audit signée, vérification intégrité | ✅ Complété |
| `LOG-dashboard-14` | LOG | dashboard | Générer des tableaux de bord et rapports visuels des logs (Grafana, ASCII) | Timer (24h) | Logs agrégés | Dashboard {date}.md, config Grafana JSON | ✅ Complété |
| `LOG-synthetize-15` | LOG | synthetize | Générer des logs synthétiques pour tester les pipelines d'observabilité | Timer (24h) | Scénario de test | Logs synthétiques, rapport scénario | ✅ Complété |
| **MAINTENANCE** | | | | | | | |
| `MAINT-backup-01` | MAINT | backup | Sauvegarder les fichiers critiques (configs, rapports, base de connaissances) | Timer (24h) | Dossiers à sauvegarder | Backup dans `backups/{date}/` | ✅ Complété |
| `MAINT-cleanup-02` | MAINT | nettoyeur | Nettoyer les fichiers temporaires, orphelins, caches et backups obsolètes | Timer (hebdo) | Liste des dossiers à nettoyer | Espace disque récupéré, rapport | ✅ Complété |
| `MAINT-gc-03` | MAINT | garbage-collector | Nettoyer les rapports orphelins et les tâches en statut `bloquée` depuis > 7 jours | Timer (semaine) | `tâches_en_cours.json`, `rapports/` | Nettoyage effectué, rapport | ✅ Complété |
| `MAINT-update-04` | MAINT | update | Mettre à jour dépendances et paquets (npm, pip, cargo, apt) — dry-run d'abord | Timer (semaine) | Gestionnaires de paquets | Paquets à jour, vulnérabilités corrigées | ✅ Complété |
| `MAINT-disk-05` | MAINT | disk | Surveiller espace disque, tendance consommation, alerter avant saturation | Timer (1h) | Volumes montés | Rapport disque, projection, top consommateurs | ✅ Complété |
| `MAINT-integrity-06` | MAINT | integrity | Vérifier intégrité backups, configs, fichiers critiques (checksum SHA256) | Timer (24h) | Fichiers critiques | Rapport intégrité, altérations détectées | ✅ Complété |
| `MAINT-snapshot-07` | MAINT | snapshot | Gérer snapshots avant opérations destructrices (rollback safety) | Sur demande + timer | Opération à protéger | Snapshot backup, rollback possible | ✅ Complété |
| `MAINT-lock-08` | MAINT | lock | Détecter et nettoyer les fichiers de verrouillage obsolètes (stale .lock .pid) | Timer (5min) | Locks à inspecter | Locks orphelins supprimés, rapport | ✅ Complété |
| `MAINT-retention-09` | MAINT | retention | Appliquer politiques de rétention (backups 30j, logs 90j, archives 1 an) | Timer (24h) | Politique de rétention | Données obsolètes supprimées, espace libéré | ✅ Complété |
| `MAINT-validate-10` | MAINT | validate | Valider structure projet et configurations (dossiers, JSON, plans) | Timer (24h) | Structure à valider | Rapport santé structurelle OK/WARN/ERROR | ✅ Complété |
| `MAINT-reconcile-11` | MAINT | reconcile | Réconcilier données entre dépôts (tâches, agents, skills, rapports) | Timer (24h) | Références croisées | Incohérences signalées, corrections proposées | ✅ Complété |
| `MAINT-report-12` | MAINT | report | Générer rapport maintenance consolidé (statut 🟢/🟡/🔴, actions) | Timer (24h) | Rapports MAINT | Rapport consolidé, résumé exécutif | ✅ Complété |
| **PERFORMANCE** | | | | | | | |
| `PERF-monitor-09` | PERF | monitor | Collecter et surveiller en continu les métriques de performance applicative (temps réponse, RPS, CPU, RAM) | Timer (60s) | Services à surveiller | Métriques, alertes, historique 7j | ✅ Complété |
| `PERF-trend-10` | PERF | trend | Analyser l'évolution long-terme des métriques de performance, détecter les dégradations progressives | Timer (1h) | Métriques historiques | Tendances, projections, corrélations | ✅ Complété |
| `PERF-budget-11` | PERF | budget | Maintenir un budget de performance (taille bundle, LCP, TTFB, score Lighthouse) et alerter au dépassement | Timer (1h) + build | Seuils de budget | Statut budget, écarts, actions correctives | ✅ Complété |
| `PERF-report-12` | PERF | report | Générer le rapport de performance consolidé hebdomadaire (statut 🟢/🟡/🔴, tendances, budget) | Timer (hebdo) | Rapports PERF | Rapport consolidé, résumé exécutif | ✅ Complété |
| `PERF-anomaly-13` | PERF | anomaly | Détecter les anomalies statistiques de performance (z-score, pics, chutes, silence) | Timer (5min) | Métriques en continu | Anomalies, sévérité, corrélations | ✅ Complété |
| **OPTIMISATION** | | | | | | | |
| `OPT-audit-09` | OPT | audit | Scanner périodiquement les opportunités d'optimisation (Lighthouse best-practices, couverture code) | Timer (24h) | Projet à auditer | Registre opportunités, score, taille | ✅ Complété |
| `OPT-trend-10` | OPT | trend | Suivre l'évolution des métriques d'optimisation (score, taille bundle, dette technique) | Timer (24h) | Métriques OPT | Tendance, régression, projection seuils | ✅ Complété |
| `OPT-budget-11` | OPT | budget | Maintenir un budget d'optimisation (taille assets, score, opportunités max) et alerter au dépassement | Timer (1h) + build | Seuils de budget | Statut budget, écart, actions correctives | ✅ Complété |
| `OPT-report-12` | OPT | report | Générer le rapport d'optimisation consolidé hebdomadaire (statut 🟢/🟡/🔴, tendances, priorités) | Timer (hebdo) | Rapports OPT | Rapport consolidé, résumé exécutif | ✅ Complété |
| **LOOP — GESTION AUTONOME** | | | | | | | |
| `LOOP-runner-01` | LOOP | runner | Exécuter une boucle en mode infini (traitement continu) | Timer/Watchdog | ID boucle | Logs continus, healthchecks | ✅ Complété |
| `LOOP-keeper-02` | LOOP | keeper | Gérer le cycle de vie d'une boucle (pause/resume, hot update) | Watchdog | ID boucle | État maintenu, mises à jour | ✅ Complété |
| `LOOP-watchdog-03` | LOOP | watchdog | Surveiller la stabilité d'une boucle (latence, erreurs) | Watchdog continu | ID boucle active | Alertes, rapports stabilité | ✅ Complété |
| `LOOP-adapter-04` | LOOP | adapter | Adapter la boucle aux changements externes en temps réel | Watchdog | Sources externes | Config adaptée dynamiquement | ✅ Complété |
| `LOOP-retry-05` | LOOP | retry | Gérer les échecs et réessais intelligents (backoff expo) | Watchdog | Erreurs boucle | Réessais effectués, alertes | ✅ Complété |
| `LOOP-cron-06` | LOOP | cron | Exécuter une boucle selon un cron flexible | Timer (cron) | Planning cron | Exécutions planifiées | ✅ Complété |
| `LOOP-queue-07` | LOOP | queue | Gérer une queue de tâches pour une boucle (FIFO/Priorité) | Watchdog | Tâches entrantes | Tâches ordonnancées, débit | ✅ Complété |
| `LOOP-log-08` | LOOP | log | Centraliser les logs d'une boucle en temps réel (JSON) | Watchdog continu | Flux logs boucle | Logs structurés, archives | ✅ Complété |
| `LOOP-monitor-metric-09` | LOOP | metrics | Exporter en temps réel les métriques clés (CPU, RAM, temps) | Timer (30s) | Métriques boucle | Export Prometheus/Grafana | ✅ Complété |
| `LOOP-traffic-10` | LOOP | traffic | Limiter le débit d'une boucle (rate limit dynamique) | Watchdog | Flux données | Débit contrôlé, rapport | ✅ Complété |
| `LOOP-resource-11` | LOOP | resource | Gérer les ressources allouées (CPU, mémoire, scaling) | Watchdog | Métriques système | Scaling effectué, quotas | ✅ Complété |
| `LOOP-transition-12` | LOOP | transition | Gérer les transitions entre états (init → run → error) | Watchdog | Événements état | État atomique garanti | ✅ Complété |
| `LOOP-backup-13` | LOOP | backup | Sauvegarder l'état d'une boucle en cas de crash | Timer (périodique) | État boucle | Sauvegardes, plan restauration | ✅ Complété |
| `LOOP-compare-14` | LOOP | compare | Comparer l'état d'une boucle à un snapshot (régression) | Watchdog | État vs Snapshot | Rapport équivalence, deltas | ✅ Complété |
| `LOOP-user-feedback-15` | LOOP | user-feedback | Intégrer des retours humains via notifications | Watchdog | Notifications UI | Retours injectés, priorité | ✅ Complété |
| **SIGNAL — COORDINATION TEMPS RÉEL** | | | | | | | |
| `SIGNAL-receiver-01` | SIGNAL | receiver | Réception et dispatching des signaux | Watchdog continu | Flux signaux | Destinataires notifiés, logs | ✅ Complété |
| `SIGNAL-router-02` | SIGNAL | router | Routage intelligent entre domaines | Watchdog | Cible domaine | Flux routé, optimisation | ✅ Complété |
| `SIGNAL-monitor-03` | SIGNAL | monitor | Surveiller le trafic et les goulots | Timer (60s) | Trafic bus | Métriques débit/latence, alertes | ✅ Complété |
| `SIGNAL-watchdog-04` | SIGNAL | watchdog | Surveiller heartbeats des composants | Timer (15s) | Heartbeats reçus | Alertes composants down, restart | ✅ Complété |
| `SIGNAL-logger-05` | SIGNAL | logger | Journaliser immuablement les échanges | Watchdog continu | Flux signaux | Archives indexées, audit | ✅ Complété |
| `SIGNAL-coordinator-06` | SIGNAL | coordinator | Coordonner flux complexes multi-agents | Watchdog | Workflows signaux | Synchronisation garantie, état | ✅ Complété |
| `SIGNAL-health-07` | SIGNAL | health | Vérifier la santé technique du bus | Timer (10s) | Tests écho (ping) | Uptime bus, latence technique | ✅ Complété |
| `SIGNAL-aggregator-08` | SIGNAL | aggregator | Fusionner les signaux corrélés | Watchdog | Patterns signaux | Événements consolidés, bruit réduit | ✅ Complété |
| `SIGNAL-filter-09` | SIGNAL | filter | Filtrer signaux redondants ou bruit | Watchdog continu | Flux signaux | Volume filtré, priorisation | ✅ Complété |
| `SIGNAL-persistence-10` | SIGNAL | persistence | Garantir la persistance des signaux critiques | Watchdog | Signaux critiques | Stockage durable, retransmission | ✅ Complété |
| **RETRO — ANALYSE & DÉTECTION** | | | | | | | |
| `RETRO-observer-01` | RETRO | observer | Détecter les patterns d'erreurs répétitives | Watchdog continu | Flux logs | Patterns identifiés, alertes | ✅ Complété |
| `RETRO-block-detect-02` | RETRO | block-detect | Identifier les agents en stagnation | Watchdog | Statut tâches | Alertes blocage, cause suspectée | ✅ Complété |
| `RETRO-analyzer-03` | RETRO | analyzer | Analyse de cause racine (RCA) des échecs | Watchdog | Échec critique | Cause racine, mesures correctives | ✅ Complété |
| `RETRO-auto-trigger-04` | RETRO | auto-trigger | Déclenchement automatique de rétro-actions | Watchdog | Signaux erreur | Boucle activée, motif | ✅ Complété |
| `RETRO-sentiment-05` | RETRO | sentiment | Analyse du sentiment et satisfaction utilisateur | Watchdog | Flux interactions | Score sentiment, alertes ton | ✅ Complété |
| `RETRO-drift-monitor-06` | RETRO | drift-monitor | Surveillance de l'écart aux objectifs | Timer (1h) | Produit vs Roadmap | Taux dérive, recommandations | ✅ Complété |
| `RETRO-knowledge-07` | RETRO | knowledge | Extraction et mémorisation des connaissances | Timer (24h) | Solutions rétro | Best practices extraites, mémoire | ✅ Complété |
| `RETRO-quality-08` | RETRO | quality | Évaluation continue de la qualité | Timer (1h) | Livrables | Score qualité, tendance | ✅ Complété |
| **INTRO — SURVEILLANCE SYSTÈME** | | | | | | | |
| `INTRO-watchdog-01` | INTRO | watchdog | Surveillance continue de la santé globale | Watchdog continu | Statut composants | Alertes santé, uptime | ✅ Complété |
| `INTRO-paco-audit-02` | INTRO | paco-audit | Audit continu de conformité PACO sur logs | Watchdog continu | Flux logs | Rapport audit, violations | ✅ Complété |
| `INTRO-perf-monitor-03` | INTRO | perf-monitor | Monitoring continu des performances | Watchdog continu | Métriques système | Tendances perf, alertes | ✅ Complété |
| `INTRO-signal-monitor-04` | INTRO | signal-monitor | Surveillance continue du bus de signaux | Watchdog continu | Flux SIGNAL | Santé bus, stats transit | ✅ Complété |
| `INTRO-anomaly-detect-05` | INTRO | anomaly-detect | Détection d'anomalies comportementales | Watchdog continu | Patterns agents | Score risque, preuves | ✅ Complété |
| **DEBUG — SURVEILLANCE ERREURS** | | | | | | | |
| `DEBUG-watchdog-01` | DEBUG | watchdog | Surveillance continue des crashs critiques | Watchdog continu | stderr/Logs | Snapshots post-mortem | ✅ Complété |
| `DEBUG-log-analyzer-02` | DEBUG | log-analyzer | Analyse sémantique continue des logs | Watchdog continu | Flux logs | Patterns erreurs, alertes | ✅ Complété |
| `DEBUG-resource-leak-03` | DEBUG | resource-leak | Détection continue de fuites de ressources | Watchdog continu | Descripteurs | Inventaire fuites, alertes | ✅ Complété |
| `DEBUG-integrity-check-04` | DEBUG | integrity-check | Vérification continue de l'intégrité code | Watchdog périodique | Checksums | Rapport intégrité, alertes | ✅ Complété |
| `DEBUG-performance-drift-05` | DEBUG | performance-drift | Détection de dérive de performance lente | Watchdog long terme | Stats réponse | Alertes dérive, tendances | ✅ Complété |
| **REFONTE — SURVEILLANCE STRUCTURELLE** | | | | | | | |
| `REFONTE-debt-monitor-01` | REFONTE | debt-monitor | Suivi continu de la dette technique | Watchdog continu | Commits | Tendance dette, alertes | ✅ Complété |
| `REFONTE-impact-checker-02` | REFONTE | impact-checker | Analyse d'impact des changements structurels | Watchdog continu | Changements | Ruptures API, alertes | ✅ Complété |
| `REFONTE-consistency-03` | REFONTE | consistency | Vérification de cohérence des patterns | Watchdog périodique | Code refactoré | Taux adoption, alertes | ✅ Complété |
| `REFONTE-version-watch-04` | REFONTE | version-watch | Veille sur dépréciations et obsolescences | Watchdog périodique | Frameworks | Alertes obsolescence | ✅ Complété |
| `REFONTE-progress-05` | REFONTE | progress | Suivi de l'avancement des migrations | Watchdog continu | Périmètre refonte | Barre progression, ETA | ✅ Complété |

---

## 🛠️ Convention de Nommage

- Format : `[DOMAINE]-[ROLE]-[NN]` (ex: `WATCH-tech-08`, `LOG-rotate-04`)
- NN est un numéro séquentiel par domaine (de 01 à N), ordre alphabétique du rôle
- Fichier associé : `data/profiles/daemons/{nom}.json`

## 🔒 Distinction Bot vs Daemon

| Critère | Bot | Daemon |
|---------|-----|--------|
| Déclencheur | Sur demande (orchestrateur) | Timer, watchdog (autonome) |
| Cycle de vie | Exécute → sortie | Tourne en continu / réveil périodique |
| `healthCheck` | Aucun | Obligatoire |
