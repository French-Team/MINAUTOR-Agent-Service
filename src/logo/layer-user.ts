/**
 * Calque unique — Design utilisateur : cadre ▐▀▄ avec FIGlet "MINAUTOR AGENT SERVICE".
 * Grille 80×20 — le cadre fait office de bannière complète.
 *
 * Utilise String.raw pour préserver les backslashes (\) du FIGlet.
 */
type Layer = string[]

const LINES: Layer = [
  String.raw`▐▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▌`,
  String.raw`▐                                                                              ▌`,
  String.raw`▐                                                                              ▌`,
  String.raw`▐     __  __ _____ _   _         _    _ _______ ____  _____                    ▌`,
  String.raw`▐    |  \/  |_   _| \ | |   /\  | |  | |__   __/ __ \|  __ \                   ▌`,
  String.raw`▐    | \  / | | | |  \| |  /  \ | |  | |  | | | |  | | |__) |                  ▌`,
  String.raw`▐    | |\/| | | | | . \ | / /\ \| |  | |  | | | |  | |  _  /                   ▌`,
  String.raw`▐    | |  | |_| |_| |\  |/ ____ \ |__| |  | | | |__| | | \ \                   ▌`,
  String.raw`▐    |_|  |_|_____|_| \_/_/    \_\____/   |_|  \____/|_|  \_\                  ▌`,
  String.raw`▐                              _          _____                 _              ▌`,
  String.raw`▐        /\                   | |        / ____|               (_)             ▌`,
  String.raw`▐       /  \   __ _  ___ _ __ | |_ ___  | (___   ___ _ ____   ___  ___ ___     ▌`,
  String.raw`▐      / /\ \ / _\ |/ _ \ _ \ | __/ __|  \___ \ / _ \__\ \ \ / | |/ __/ _ \    ▌`,
  String.raw`▐     / ____ \ (_| |  __/ | | | |_\__ \  ____) |  __/ |   \ V /| | (_|  __/    ▌`,
  String.raw`▐    /_/    \_\__, |\___|_| |_|\__|___/ |_____/ \___|_|    \_/ |_|\___\___|    ▌`,
  String.raw`▐              __/ |                                                           ▌`,
  String.raw`▐             |___/                                                            ▌`,
  String.raw`▐                                                                              ▌`,
  String.raw`▐                                                                              ▌`,
  String.raw`▐▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▌`,
]

export const layer: Layer = LINES
export const HEIGHT = LINES.length
export const WIDTH = LINES[0].length
