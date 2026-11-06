/**
 * Host half of the delete-archived-session bundle.
 *
 * The Web UI asks for one deletion through an authenticated exact Fetch route.
 * This half enforces the archive precondition, asks the Workspace registry's
 * own stop seam to end any work the Session still runs, waits for the cancelled
 * Agent turn to settle, removes the stored Session log directory, and then
 * clears the durable Workspace accounting and projection-cache rows that
 * referenced the removed Session.
 *
 * The installed Harness has no deletion API — the JSONL seam states that
 * nothing deletes session files — so this bundle owns the whole operation.
 *
 * @module dsh-delete-archived-session
 */
import { rm } from 'node:fs/promises'
import { basename, dirname, join, sep } from 'node:path'
import type { SessionId } from './types'

/** Authenticated exact Fetch route the browser POSTs one deletion request to. */
const DELETE_PATH = '/api/session.archiveDelete'

/** Canonical stored Session log filename (`session[.vN].jsonl[.zstd]`). */
const LOG_FILENAME = /^session(?:\.v[1-9]\d*)?\.jsonl(?:\.zstd)?$/

/** Bounded wait for a cancelled Agent turn to settle before the log is removed. */
const AGENT_IDLE_TIMEOUT_MS = 5000

/** A live Agent handle, as far as this plugin reads it. */
interface LiveAgent {
  whenIdle?: () => unknown
}

/** A stored-session stat snapshot from the persistence service. */
interface StatSnapshot {
  location?: { kind: string; path: string }
}

/** One attached workspace, as far as this plugin reads it. */
interface Workspace {
  readonly id: string
  readonly sessionIds: readonly SessionId[]
  detachSession(id: SessionId): unknown
}

/** The Workspace registry service. */
interface WorkspaceRegistry {
  readonly archivedSessionIds: readonly SessionId[]
  list(): readonly Workspace[]
  unarchiveSession(id: SessionId): unknown
  unpinSession(id: SessionId): unknown
}

/** The members of the Host context this plugin uses. */
export interface HostContext {
  readonly connection: {
    readonly fetch: {
      register(route: {
        path: string
        methods: string[]
        requestBody: 'buffered'
        fetch: (request: Request) => Promise<Response>
      }): () => void
    }
  }
  readonly workspaceRegistry: WorkspaceRegistry
  readonly logger?: { warn?: (message: string) => void; info?: (message: string) => void }
  get(name: string): any
  parallel(event: string, payload: unknown): Promise<unknown>
  emit(event: string, ...args: unknown[]): unknown
}

/** A lossless JSON result envelope. */
type Envelope = { ok: true; value: Record<string, unknown> } | { ok: false; error: { code: string; message: string } }

/** Services the delete route needs; persistence and storage stay optional. */
export const inject = ['connection', 'workspaceRegistry']

/**
 * Encode one Session id exactly as the JSONL backend encodes its directory name.
 */
function encodeSegment(raw: string): string {
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let index = 0; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index)
    const char = String.fromCharCode(code)
    if (char !== '~' && /^[A-Za-z0-9._-]$/.test(char)) out += char
    else out += `~${code.toString(16).toUpperCase().padStart(4, '0')}`
  }
  return out
}

/**
 * Register the delete route, then sweep archive entries that reference nothing.
 *
 * `connection.fetch.register` returns a Context effect of its own, so that call
 * is the registration: wrapping it in another `ctx.effect` would nest two.
 */
export function apply(ctx: HostContext): void {
  try {
    ctx.connection.fetch.register({
      path: DELETE_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: (request) => handleDelete(ctx, request),
    })
  } catch (error) {
    ctx.logger?.warn?.(`delete-archived-session: route registration failed: ${messageOf(error)}`)
  }
  sweepDanglingArchiveEntries(ctx).catch((error) => {
    ctx.logger?.warn?.(`delete-archived-session: archive sweep failed: ${messageOf(error)}`)
  })
}

/**
 * Drop archive-set entries that reference neither a live Agent nor a stored
 * log. Deleting a Session whose Agent was still live keeps its archive entry
 * (that entry is the `agent/pre-step` gate that keeps the surviving Agent from
 * writing a fresh log for the deleted id); once the Host restarts, the Agent is
 * gone and the entry is invisible cruft, so this pass removes it. An entry with
 * no live Agent and no stored log renders nowhere, so removing it changes no
 * view.
 */
async function sweepDanglingArchiveEntries(ctx: HostContext): Promise<void> {
  const registry = ctx.workspaceRegistry
  const persistence = ctx.get('sessionPersistence')
  if (persistence === undefined) return
  for (const sessionId of [...registry.archivedSessionIds]) {
    try {
      if (ctx.get('agents')?.get(sessionId) !== undefined) continue
      if ((await persistence.stat(sessionId)) !== undefined) continue
      await registry.unarchiveSession(sessionId)
      ctx.logger?.info?.(`delete-archived-session: removed dangling archive entry "${sessionId}"`)
    } catch (error) {
      ctx.logger?.warn?.(`delete-archived-session: archive sweep kept "${sessionId}": ${messageOf(error)}`)
    }
  }
}

/** Handle one deletion request. */
async function handleDelete(ctx: HostContext, request: Request): Promise<Response> {
  let body: { sessionId?: unknown } | null
  try {
    body = (await request.json()) as { sessionId?: unknown }
  } catch {
    return respond(400, { ok: false, error: { code: 'bad-request', message: 'request body is not valid JSON' } })
  }
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
  if (sessionId === '') {
    return respond(400, { ok: false, error: { code: 'bad-request', message: 'sessionId is required' } })
  }

  const registry = ctx.workspaceRegistry
  if (!registry.archivedSessionIds.includes(sessionId)) {
    return respond(409, {
      ok: false,
      error: { code: 'session/not-archived', message: `session "${sessionId}" is not archived` },
    })
  }

  const warnings: string[] = []
  const settle = async (label: string, operation: () => unknown): Promise<void> => {
    try {
      await operation()
    } catch (error) {
      const reason = messageOf(error)
      warnings.push(`${label}: ${reason}`)
      ctx.logger?.warn?.(`delete-archived-session: ${label} failed for "${sessionId}": ${reason}`)
    }
  }

  // Stop everything the Session still runs through the Workspace registry's own
  // archive-stop seam: the Agent registry, jobs, subagent runtime, and schedule
  // each cancel their work here, exactly as stop-and-archive does. For the Agent
  // this is `agent.cancel({ kind: 'user' })`, which does not wait.
  await settle('stop activity', () => ctx.parallel('workspace/session-stop', { sessionId }))

  // Then wait for the Agent's cancelled turn to actually settle before the log
  // is removed, so no in-flight step writes a fresh event after deletion. Only
  // the Agent's own published idle barrier is used; the full lifecycle teardown
  // belongs to the owner fiber and is not reachable from here. A bounded wait
  // keeps a stuck turn from blocking the delete indefinitely.
  const liveAgent = ctx.get('agents')?.get(sessionId) as LiveAgent | undefined
  if (liveAgent !== undefined && typeof liveAgent.whenIdle === 'function') {
    await settle('await agent idle', () =>
      Promise.race([
        Promise.resolve(liveAgent.whenIdle?.()),
        new Promise((resolve) => setTimeout(resolve, AGENT_IDLE_TIMEOUT_MS)),
      ]),
    )
  }

  // Durability barrier before removal, so deleting the artifact afterwards
  // cannot race a later flush of buffered events.
  const sessions = ctx.get('sessions')
  const live = sessions?.get(sessionId)
  if (live !== undefined) await settle('flush', () => sessions.flush(live))

  let snapshot: StatSnapshot | undefined
  const persistence = ctx.get('sessionPersistence')
  if (persistence !== undefined) {
    try {
      snapshot = (await persistence.stat(sessionId)) as StatSnapshot | undefined
    } catch (error) {
      return respond(500, { ok: false, error: { code: 'session/stat-failed', message: messageOf(error) } })
    }
  }

  let removedFile = false
  let logDir: string | undefined
  if (snapshot?.location !== undefined) {
    if (snapshot.location.kind !== 'jsonl') {
      return respond(501, {
        ok: false,
        error: {
          code: 'unsupported-backend',
          message: `session storage backend "${snapshot.location.kind}" has no deletable log artifact`,
        },
      })
    }
    const logPath = snapshot.location.path
    const dir = dirname(logPath)
    if (
      !LOG_FILENAME.test(basename(logPath)) ||
      basename(dir) !== encodeSegment(sessionId) ||
      dir.split(sep).length < 4
    ) {
      return respond(500, {
        ok: false,
        error: { code: 'unsafe-path', message: `refusing to delete unexpected session artifact "${logPath}"` },
      })
    }
    try {
      await rm(dir, { recursive: true, force: true })
      removedFile = true
      logDir = dir
    } catch (error) {
      return respond(500, { ok: false, error: { code: 'delete-failed', message: messageOf(error) } })
    }
  }

  // Drop the Session-list summary first, so the row leaves the sidebar before
  // the archive-set change would otherwise move it into the active list.
  await settle('session list removal', () => ctx.emit('api-session/removed', sessionId))

  for (const workspace of registry.list()) {
    if (!workspace.sessionIds.includes(sessionId)) continue
    await settle(`detach workspace "${workspace.id}"`, () => workspace.detachSession(sessionId))
  }
  // A Session whose Agent is still live keeps its archive-set entry: that entry
  // is the `agent/pre-step` gate, so dropping it would let the surviving Agent
  // write a fresh log for an id the user just deleted, and an archived id stays
  // out of the default (unarchived) sidebar view. A cold Session is dropped from
  // the set so no dangling id outlives the log that was just removed; entries
  // left by live Agents are swept on the next Host start.
  const agentStillLive = ctx.get('agents')?.get(sessionId) !== undefined
  if (!agentStillLive) await settle('unarchive', () => registry.unarchiveSession(sessionId))
  await settle('unpin', () => registry.unpinSession(sessionId))
  const projectionDomain = ctx.get('storageDomain')?.get('session_projcache')
  if (projectionDomain !== undefined) {
    await settle('projection cache', () => projectionDomain.table('sessions').delete(sessionId))
  }
  // Deterministic fallback for the projection-cache record: while an Agent is
  // still live the domain's logical delete can stay buffered in memory, leaving
  // the JSON record on disk. The log layout is `<root>/sessions/<proj>/<seg>`
  // and the cache is `<root>/storages/session_projcache/sessions/<id>.json`, so
  // the already path-checked log directory yields the storage root. Best-effort
  // and jsonl-only, so a non-jsonl backend is never touched.
  if (logDir !== undefined && /^[A-Za-z0-9._-]+$/.test(sessionId)) {
    const root = dirname(dirname(dirname(logDir)))
    const record = join(root, 'storages', 'session_projcache', 'sessions', `${sessionId}.json`)
    await settle('projection cache file', () => rm(record, { force: true }))
  }

  // `agentStillLive` tells the client to trust its optimistic row removal and
  // skip the list refresh: the Host cannot fully dispose another owner's Agent,
  // so a refresh would re-summarize the detached-but-live Session as a ghost
  // row. The log and projection cache are already gone and the Agent's work was
  // cancelled; the stale archive entry is swept on the next Host start.
  return respond(200, { ok: true, value: { sessionId, removedFile, agentStillLive, warnings } })
}

/** Build one JSON response. */
function respond(status: number, body: Envelope): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/** Describe one failure. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
