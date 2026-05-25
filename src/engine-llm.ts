import type { LLMProvider } from './engine-types.js'

export interface StreamingConfig {
  enabled: boolean
  chunkSize?: number
  showThinking?: boolean
}

async function post(url: string, body: unknown, headers?: Record<string, string>, timeout = 60000): Promise<Response> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status} — ${text.slice(0, 200)}`)
  }
  return res
}

export async function internalCallLLM(
  userMessage: string,
  llm: LLMProvider,
  systemPrompt: string,
  streamingConfig?: StreamingConfig,
): Promise<string> {
  const base = llm.baseUrl.replace(/\/+$/, '')

  const msgs = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ]

  if (llm.provider === 'google') {
    const modelName = llm.model.replace(/^models\//, '')
    const url = `${base}/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(llm.apiKey)}`
    const res = await post(url, {
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
    })
    const json = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text: string }> } }> }
    return json.candidates?.[0]?.content?.parts?.[0]?.text || '(réponse vide)'
  }

  if (llm.provider === 'ollama' || llm.provider === 'ollama-local' || llm.provider === 'ollama-cloud') {
    const url = `${base}/api/chat`
    const res = await post(url, { model: llm.model, messages: msgs, stream: false })
    const json = await res.json() as { message?: { content?: string } }
    return json.message?.content || '(réponse vide)'
  }

  // OpenAI-compatible (kilo, openrouter, opencode-zen, lm-studio, custom)
  const chatPath = llm.provider === 'kilo' ? '/api/gateway/chat/completions' : '/chat/completions'
  const url = `${base}${chatPath}`
  const headers: Record<string, string> = {}
  if (llm.apiKey) headers['Authorization'] = `Bearer ${llm.apiKey}`

  if (streamingConfig?.enabled) {
    const res = await post(url, { model: llm.model, messages: msgs, stream: true }, headers)
    const reader = res.body?.getReader()
    if (!reader) throw new Error('Streaming not supported by response body')

    let fullContent = ''
    let currentChunk = ''
    const chunkSize = streamingConfig.chunkSize || 50
    const decoder = new TextDecoder()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value)
      const lines = chunk.split('\n').filter(line => line.trim() !== '')
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed === 'data: [DONE]') break
        if (trimmed.startsWith('data: ')) {
          try {
            const data = JSON.parse(trimmed.slice(6))
            const delta = data.choices?.[0]?.delta?.content || ''
            fullContent += delta
            currentChunk += delta

            if (streamingConfig?.showThinking && delta) {
              // If we reach chunkSize (roughly estimating by words/chars as we don't have a tokenizer)
              // or if it's a newline/end of sentence
              if (currentChunk.length >= chunkSize * 4 || delta.includes('\n') || delta.includes('.') || delta.includes('?')) {
                process.stdout.write(currentChunk)
                currentChunk = ''
              }
            }
          } catch {
            // Skip partial or malformed JSON
          }
        }
      }
    }
    if (streamingConfig?.showThinking) {
      if (currentChunk) process.stdout.write(currentChunk)
      process.stdout.write('\n')
    }
    return fullContent || '(streaming empty)'
  }

  const res = await post(url, { model: llm.model, messages: msgs }, headers)
  const raw = await res.text()
  let content = ''
  try {
    const json = JSON.parse(raw) as { choices?: Array<{ message?: { content?: string } }>; error?: { message: string } }
    if (json.error) throw new Error(json.error.message)
    content = json.choices?.[0]?.message?.content || ''
  } catch {
    // if JSON parsing or extraction fails, show raw response snippet
    content = raw.slice(0, 500)
  }
  return content || `(raw) ${raw.slice(0, 200)}`
}
