#!/usr/bin/env node
/**
 * telecom-console-layout.ts — Module de recadrage proportionnel
 *
 * Définit une **valeur de référence** (REFERENCE_WIDTH / REFERENCE_HEIGHT)
 * qui correspond à la taille de terminal à laquelle le layout a été conçu.
 * Les dimensions réelles sont mises à l'échelle proportionnellement :
 *
 *   scaleX = actualWidth  / REFERENCE_WIDTH
 *   scaleY = actualHeight / REFERENCE_HEIGHT
 *
 * Cela garantit que les colonnes grandissent/rétrécissent avec la fenêtre
 * quelle que soit la fiabilité de la détection de redimensionnement.
 */

// ── Références ──
// Valeur de conception : 120×30 colonnes.
// À cette taille, chaque colonne fait environ 27 caractères de large,
// ce qui permet d'afficher confortablement les données de chaque quadrant.
// La référence sert de base proportionnelle — si le terminal fait 60 cols,
// le scale est 0.5 et chaque colonne fait ~14 chars.
export const REFERENCE_WIDTH = 120
export const REFERENCE_HEIGHT = 30

// ── Constantes de layout physique ──
export const BORDER_WIDTH = 2        // | + | (pipe gauche + pipe droit)
export const COL_GAP = 1             // espace entre deux boîtes
export const MARGIN = 1              // marge gauche/droite

/**
 * Calcule l'overhead pour un nombre donné de colonnes.
 * Overhead = marge gauche + N×bordures + (N-1)×gaps + marge droite
 */
export function computeLayoutOverhead(columnCount: number): number {
  return MARGIN + columnCount * BORDER_WIDTH + (columnCount - 1) * COL_GAP + MARGIN
}

// Overhead pour 4 colonnes (compatible rétro)
export const LAYOUT_OVERHEAD = computeLayoutOverhead(4)

// ── Structure de sortie ──
export interface ColumnLayout {
  /** Position X de la colonne (bordure gauche) */
  x: number
  /** Largeur totale de la colonne (bordures incluses) */
  w: number
  /** Largeur intérieure du contenu (w - 2) */
  contentW: number
}

export interface LayoutResult {
  columns: ColumnLayout[]
  /** Hauteur disponible pour chaque colonne (bordures incluses) */
  columnHeight: number
  /** Scale effectif appliqué en X */
  scaleX: number
  /** Scale effectif appliqué en Y */
  scaleY: number
}

// ── Fonctions ──

/**
 * Calcule les ratios d'échelle entre la taille réelle du terminal
 * et la taille de référence.
 */
export function computeScale(tw: number, th: number): { scaleX: number; scaleY: number } {
  return {
    scaleX: tw / REFERENCE_WIDTH,
    scaleY: th / REFERENCE_HEIGHT,
  }
}

/**
 * Calcule la largeur de contenu par colonne à partir de la largeur réelle
 * du terminal et du ratio d'échelle.
 *
 * Logique :
 *   1. L'espace disponible = largueur réelle - overhead
 *   2. L'espace de référence = REFERENCE_WIDTH - overhead
 *   3. On applique le scaleX à la largeur de chaque colonne
 *
 * Résultat : des colonnes qui s'adaptent proportionnellement
 * à la taille de la fenêtre, quelle que soit la plateforme.
 */
export function computeColumnLayout(tw: number, th: number, columnCount: number = 4): LayoutResult {
  const { scaleX, scaleY } = computeScale(tw, th)
  const overhead = computeLayoutOverhead(columnCount)

  // Hauteur des colonnes
  const availH = th - 3  // title (0) + secondary bar (th-2) + main bar (th-1)
  const columnHeight = availH

  // Largeur totale disponible pour le contenu
  const totalContentRef = REFERENCE_WIDTH - overhead
  const baseColWidthRef = Math.floor(totalContentRef / columnCount)

  // Largeur de chaque colonne après mise à l'échelle
  // On arrondit à l'entier le plus proche
  const rawColW = baseColWidthRef * scaleX
  const colW = Math.max(8, Math.round(rawColW))  // minimum 8 chars de contenu

  // Distribuer l'espace restant (arrondi) sur les colonnes
  const totalUsed = colW * columnCount + overhead
  const remainder = tw - totalUsed

  // Distribuer le reste (ou le déficit) uniformément sur toutes les colonnes
  const colWidths: number[] = Array(columnCount).fill(colW)
  if (remainder >= 0) {
    for (let i = 0; i < remainder; i++) colWidths[i % columnCount]++
  } else {
    // Déficit : réduire les colonnes cycliquement sans descendre sous 8
    for (let i = 0; i < -remainder; i++) {
      const idx = i % columnCount
      if (colWidths[idx] > 8) colWidths[idx]--
    }
  }

  const columns: ColumnLayout[] = []
  let x = MARGIN

  for (let i = 0; i < columnCount; i++) {
    const w = colWidths[i] + BORDER_WIDTH  // +2 pour les pipes |
    columns.push({
      x,
      w,
      contentW: colWidths[i],
    })
    x += colWidths[i] + BORDER_WIDTH + COL_GAP
  }

  return {
    columns,
    columnHeight,
    scaleX,
    scaleY,
  }
}
