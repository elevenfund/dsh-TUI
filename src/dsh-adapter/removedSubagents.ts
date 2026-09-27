/**
 * Persisted subagent removals: the host catalog is an append-only durable
 * fact stream, so "delete a settled subagent" is a client-side preference.
 * dsh-tui keeps the removed child ids at
 * `~/.dsh-tui/removed-subagents.json`, grouped by parent session id, so a
 * removed row stays gone across restarts and log replay. Best-effort like
 * every prefs file: a missing or corrupt file just yields no removals.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR } from '../utils/paths.js'

const PREFS_DIR = DATA_DIR

interface RemovedSubagentsFile {
  sessions: Record<string, string[]>
}

function parseFile(text: string): RemovedSubagentsFile {
  const parsed: unknown = JSON.parse(text)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { sessions: {} }
  const sessions = (parsed as Record<string, unknown>).sessions
  if (sessions === undefined || sessions === null || typeof sessions !== 'object' || Array.isArray(sessions)) {
    return { sessions: {} }
  }
  const result: Record<string, string[]> = {}
  for (const [sessionId, ids] of Object.entries(sessions as Record<string, unknown>)) {
    if (Array.isArray(ids)) result[sessionId] = ids.filter((id): id is string => typeof id === 'string')
  }
  return { sessions: result }
}

/** The persisted removed-child ids of one parent session (best-effort read). */
export function readRemovedSubagents(parentSessionId: string, dir: string = PREFS_DIR): string[] {
  try {
    return parseFile(readFileSync(join(dir, 'removed-subagents.json'), 'utf8')).sessions[parentSessionId] ?? []
  } catch {
    return []
  }
}

/** Record one removed child id under its parent session (best-effort write). */
export function addRemovedSubagent(parentSessionId: string, childId: string, dir: string = PREFS_DIR): boolean {
  try {
    let file: RemovedSubagentsFile = { sessions: {} }
    try {
      file = parseFile(readFileSync(join(dir, 'removed-subagents.json'), 'utf8'))
    } catch { /* first write or corrupt file: start fresh */ }
    const ids = new Set(file.sessions[parentSessionId] ?? [])
    ids.add(childId)
    file.sessions[parentSessionId] = [...ids]
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'removed-subagents.json'), JSON.stringify(file, null, 2))
    return true
  } catch {
    return false
  }
}
