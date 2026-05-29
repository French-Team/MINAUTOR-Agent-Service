/**
 * telecom-log-parser.ts — Parseurs partagés pour les entrées du logbook
 *
 * Évite la duplication entre telecom-watcher-console.ts et telecom-watcher-persist.ts.
 * Les deux consommateurs appellent les mêmes fonctions avec des options différentes.
 */

/**
 * Extrait l'heure (HH:MM:SS) ou la date complète d'une entrée logbook.
 * @param entry — Section ## d'une entrée du logbook
 * @param fullDate — Si true, retourne la date ISO complète. Sinon, HH:MM:SS.
 */
export function parseLogbookTime(entry: string, fullDate = false): string {
  const m = entry.match(/\*\*Date :\*\*\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/)
  if (!m) return ''
  return fullDate ? m[1] : m[1].slice(11, 19)
}

/**
 * Extrait le nom de l'agent source depuis une entrée logbook.
 * @param entry — Section ## d'une entrée du logbook
 * @param truncateTo — Si > 0, tronque le résultat à cette longueur
 */
export function parseLogbookSource(entry: string, truncateTo = 0): string {
  const firstLine = entry.split('\n')[0].trim()
  const m = firstLine.match(/\(([^)]+)\)/)
  const source = m ? m[1] : firstLine
  return truncateTo > 0 ? source.slice(0, truncateTo) : source
}

/**
 * Extrait le message principal d'une entrée logbook.
 * Priorité : Instruction > Réponse > premier paragraphe après métadonnées.
 * @param entry — Section ## d'une entrée du logbook
 * @param maxLen — Longueur maximale du message (défaut: 200)
 */
export function parseLogbookMessage(entry: string, maxLen = 200): string {
  const instr = entry.match(/\*\*Instruction :\*\*\s*(.+)/)
  if (instr) return instr[1].trim().slice(0, maxLen)
  const reponse = entry.match(/\*\*R[ée]ponse :\*\*\s*([\s\S]*?)(?:\n## |\n\*\*|$)/)
  if (reponse) return reponse[1].split('\n')[0].trim().slice(0, maxLen)
  const lines = entry.split('\n').filter(l => l.trim() && !l.startsWith('**') && !l.startsWith('-'))
  return (lines[2]?.trim()?.slice(0, maxLen)) || ''
}
