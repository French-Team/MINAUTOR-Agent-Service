import { randomUUID } from 'crypto'
import type { Session } from './engine-types.js'

const sessions = new Map<string, Session>()
let currentSessionId: string | undefined

export function createSessionManager() {

  function createSession(): Session {
    const session: Session = {
      id: randomUUID(),
      messages: [],
      createdAt: new Date(),
      output: undefined,
    }
    sessions.set(session.id, session)
    currentSessionId = session.id
    return session
  }

  function getCurrentSession(): Session | undefined {
    if (currentSessionId) return sessions.get(currentSessionId)
    return undefined
  }

  function getSession(id: string): Session | undefined {
    return sessions.get(id)
  }

  function listSessions(): Session[] {
    return Array.from(sessions.values())
  }

  function addMessage(role: 'user' | 'assistant', content: string) {
    const session = getCurrentSession()
    if (session) {
      session.messages.push({ role, content: [{ type: 'text', text: content }] })
    }
  }

  function setOutput(output: Record<string, unknown>) {
    const session = getCurrentSession()
    if (session) {
      session.output = output
    }
  }

  return {
    createSession,
    getCurrentSession,
    getSession,
    listSessions,
    addMessage,
    setOutput,
  }
}
