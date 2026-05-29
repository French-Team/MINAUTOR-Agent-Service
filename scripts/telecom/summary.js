#!/usr/bin/env node
/**
 * scripts/telecom/summary.js — Résumé des 4 quadrants watcher
 *
 * Lit les fichiers data/watcher/telecom/{intercom,routing,agents,logs}.json
 * et produit un résumé structuré, lisible par agent-telecom.
 *
 * Usage :
 *   node scripts/telecom/summary.js                   # affichage texte
 *   node scripts/telecom/summary.js --json            # sortie JSON brute
 *
 * Variables d'environnement :
 *   SCRIPT_DEMANDE — demande brute (optionnel)
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = join(__dirname, '..', '..')
const WATCHER_DIR = join(PROJECT_ROOT, 'data', 'watcher', 'telecom')

function loadAll() {
  const result = { intercom: null, routing: null, agents: null, logs: null }
  for (const key of ['intercom', 'routing', 'agents', 'logs']) {
    const path = join(WATCHER_DIR, `${key}.json`)
    if (existsSync(path)) {
      try {
        result[key] = JSON.parse(readFileSync(path, 'utf-8'))
      } catch {
        result[key] = null
      }
    }
  }
  return result
}

function formatDate(iso) {
  if (!iso) return '—'
  return iso.replace('T', ' ').slice(0, 19)
}

function main() {
  const isJson = process.argv.includes('--json')
  const demande = process.env.SCRIPT_DEMANDE || ''

  const data = loadAll()

  // Vérifier si le watcher tourne
  const watcherActif = data.intercom !== null || data.routing !== null
    || data.agents !== null || data.logs !== null

  if (!watcherActif) {
    console.log('ℹ️  Watcher non démarré — aucun fichier dans data/watcher/telecom/.')
    console.log('   Les données apparaîtront dès que le watcher sera lancé.')
    return
  }

  if (isJson) {
    // Sortie JSON brute (pour traitement par agent)
    console.log(JSON.stringify({
      fetchedAt: new Date().toISOString(),
      intercom: data.intercom,
      routing: data.routing,
      agents: data.agents,
      logs: data.logs,
    }, null, 2))
    return
  }

  // ── Résumé texte structuré ──

  console.log('═══════════════════════════════════════════')
  console.log('  📊 Résumé de l\'état du système telecom')
  console.log('═══════════════════════════════════════════')
  console.log('')

  // 1. Intercom
  console.log('── Intercom ──')
  if (data.intercom) {
    const i = data.intercom
    console.log(`  Messages    : ${i.total ?? 0} total`)
    console.log(`  En attente  : ${i.pending ?? 0}`)
    console.log(`  Lus         : ${i.read ?? 0}`)
    console.log(`  Traités     : ${i.processed ?? 0}`)
    if (i.messages && i.messages.length > 0) {
      console.log(`  Derniers    :`)
      for (const m of i.messages.slice(-5)) {
        const time = (m.timestamp || '').slice(11, 19) || '--:--:--'
        const sujet = (m.subject || '').slice(0, 20)
        const demandeTrunc = m.demande ? ` | ${m.demande.slice(0, 40)}` : ''
        console.log(`    ${time} ${m.from?.padEnd(12) ?? '?'}→ ${m.to?.padEnd(12) ?? '?'} [${sujet}]${demandeTrunc}`)
      }
    }
  } else {
    console.log('  (aucune donnée)')
  }
  console.log('')

  // 2. Routage
  console.log('── Routage ──')
  if (data.routing) {
    const r = data.routing
    if (r.stats) {
      console.log(`  PID daemon  : ${r.stats.pid ?? '—'}`)
      console.log(`  Uptime      : ${r.stats.uptimeSec ? `${Math.floor(r.stats.uptimeSec / 60)}m ${r.stats.uptimeSec % 60}s` : '—'}`)
      console.log(`  Messages    : ${r.stats.totalMessagesRouted ?? '?'}`)
      console.log(`  Spawns      : ${r.stats.totalSpawns ?? '?'}`)
      console.log(`  Agents      : ${r.stats.agentCount ?? '?'}`)
      if (r.stats.activeSpawns && r.stats.activeSpawns.length > 0) {
        console.log(`  Actifs      :`)
        for (const s of r.stats.activeSpawns) {
          console.log(`    ▶ ${s.agentId} [${s.runningFor}s] ${s.subject ? `— ${s.subject}` : ''}`)
        }
      } else {
        console.log(`  Actifs      : aucun`)
      }
    }
    if (r.routages && r.routages.length > 0) {
      console.log(`  Derniers routages :`)
      for (const rt of r.routages.slice(-5)) {
        const time = rt.timestamp?.slice(11, 19) || '--:--:--'
        console.log(`    ${time} ${rt.from?.padEnd(12) ?? '?'}→ ${rt.to?.padEnd(12) ?? '?'} [${rt.subject ?? ''}]`)
      }
    }
  } else {
    console.log('  (aucune donnée)')
  }
  console.log('')

  // 3. Agents
  console.log('── Agents ──')
  if (data.agents) {
    const a = data.agents
    console.log(`  Total       : ${a.totalAgents ?? 0}`)
    console.log(`  Actifs      : ${a.actifs ?? 0}`)
    console.log(`  Erreurs     : ${a.totalErreurs ?? 0}`)
    console.log(`  Livrables   : ${a.totalLivrables ?? 0}`)
    if (a.agents && a.agents.length > 0) {
      console.log(`  Détail :`)
      for (const agent of a.agents) {
        const status = agent.actif
          ? '▶ actif'
          : agent.erreurs > 0
            ? `✗ ${agent.erreurs} err`
            : `■ ${agent.livrables > 0 ? `${agent.livrables} liv` : 'idle'}`
        const dernier = agent.dernierLivrable ? ` (${agent.dernierLivrable.slice(0, 10)})` : ''
        console.log(`    ${agent.id.padEnd(18)} ${status}${dernier}`)
      }
    }
  } else {
    console.log('  (aucune donnée)')
  }
  console.log('')

  // 4. Logs
  console.log('── Logs récents ──')
  if (data.logs) {
    const l = data.logs
    console.log(`  Entrées     : ${l.total ?? 0}`)
    if (l.entries && l.entries.length > 0) {
      console.log(`  Dernières   :`)
      for (const e of l.entries.slice(-8)) {
        const time = e.timestamp || '--:--:--'
        const typeIcon = e.type === 'notification' ? '🔔' : '📝'
        const msg = (e.message || '').slice(0, 70)
        console.log(`    ${typeIcon} ${time} ${e.source?.padEnd(12) ?? ''}${msg}`)
      }
    }
  } else {
    console.log('  (aucune donnée)')
  }
  console.log('')

  // Dernière mise à jour
  const lastUpdate = [
    data.intercom?.updatedAt,
    data.routing?.updatedAt,
    data.agents?.updatedAt,
    data.logs?.updatedAt,
  ].filter(Boolean).sort().pop()

  console.log(`  Dernière màj : ${lastUpdate ? formatDate(lastUpdate) : '—'}`)
  console.log('═══════════════════════════════════════════')
}

main()
