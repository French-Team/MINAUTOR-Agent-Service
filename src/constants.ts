// ── ANSI color constants ─────────────────────────────────

export const RESET = '\x1b[0m'
export const CYAN = '\x1b[36m'
export const GREEN = '\x1b[32m'
export const YELLOW = '\x1b[33m'
export const RED = '\x1b[31m'
export const GRAY = '\x1b[90m'
export const BOLD = '\x1b[1m'
export const LIME = '\x1b[92m'

// ── Provider URL mappings ───────────────────────────────

export const ONLINE_URLS: Record<string, string> = {
  kilo: 'https://api.kilo.ai',
  google: 'https://generativelanguage.googleapis.com',
  openrouter: 'https://openrouter.ai/api/v1',
  'opencode-zen': 'https://opencode.ai/zen/v1',
  'lm-studio': 'http://localhost:1234/v1',
  'ollama-local': 'http://localhost:11434',
  'ollama-cloud': 'https://ollama.com',
}

// ── Providers that require an API key ───────────────────

export const KEY_REQUIRED = ['google', 'openrouter', 'opencode-zen', 'custom', 'ollama-cloud']

// ── Safe exit (Windows workaround for libuv assertion with undici/fetch) ──

/**
 * Safe exit that avoids libuv assertion on Windows when fetch/undici handles
 * are still closing. Sets process.exitCode immediately, then schedules a
 * forced process.exit() after 200ms. The timer is unref'd so Node can exit
 * naturally if handles close cleanly.
 *
 * Usage: safeExit(0) or safeExit(failed > 0 ? 1 : 0)
 */
export function safeExit(code: number): void {
  process.exitCode = code
  setTimeout(() => process.exit(), 200).unref()
}

// ── Model ranking helpers ───────────────────────────────

const TOP_MODELS = [
  'gpt-5', 'gpt-5.5', 'gpt-5.5-pro', 'gpt-5.2', 'gpt-5-codex', 'gpt-5.1-codex',
  'claude-opus-4.7', 'claude-sonnet-4.6', 'claude-haiku-4.5',
  'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-3-flash-preview', 'gemini-3.1-pro-preview',
  'grok-4', 'grok-4-fast', 'grok-4.1-fast', 'grok-code-fast-1',
  'deepseek/deepseek-v4-pro', 'deepseek/deepseek-v4-flash',
  'qwen/qwen3-max', 'qwen/qwen3-coder-plus', 'qwen/qwen3.6-plus',
  'kilo-auto/free', 'kilo-auto/balanced', 'kilo-auto/frontier',
]

export function top15(m: string[]): string[] {
  // Détecte :free (OpenRouter) ou -free (Opencode Zen, etc.)
  const isFree = (x: string) => x.includes(':free') || x.endsWith('-free')
  const free = m.filter(x => isFree(x))
  const best = m.filter(x =>
    !isFree(x) &&
    TOP_MODELS.some(t => x.toLowerCase().includes(t.toLowerCase()))
  )
  const rest = m.filter(x => !free.includes(x) && !best.includes(x))
  const combined = [...free, ...best, ...rest]
  return combined.slice(0, 15)
}
