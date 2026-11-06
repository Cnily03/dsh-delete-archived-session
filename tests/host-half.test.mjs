import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const pluginUrl = new URL('../dist/index.js', import.meta.url)
const mod = await import(pluginUrl.href)

const sid = 'session-abc-123'
const otherId = 'session-other'
const state = {
  archived: new Set([sid, otherId]),
  emitted: [],
  unarchived: [],
  parallel: [],
  services: {},
  workspaces: [],
}
const routes = []
const warnings = []
const ctx = {
  logger: { warn: (message) => warnings.push(message) },
  get: (name) => state.services[name],
  effect: (fn) => {
    fn()
  },
  emit: (name, ...args) => {
    state.emitted.push([name, ...args])
  },
  parallel: async (name, payload) => {
    state.parallel.push([name, payload])
  },
  connection: {
    fetch: {
      register: (route) => {
        routes.push(route)
        return () => {}
      },
    },
  },
  workspaceRegistry: {
    get archivedSessionIds() {
      return [...state.archived]
    },
    list: () => state.workspaces,
    unarchiveSession: async (id) => {
      state.archived.delete(id)
      state.unarchived.push(id)
    },
    unpinSession: async () => {},
  },
}

mod.apply(ctx)
assert.equal(routes.length, 1, 'one route registered')
assert.equal(routes[0].path, '/api/session.archiveDelete')
assert.deepEqual(routes[0].methods, ['POST'])
assert.equal(routes[0].requestBody, 'buffered')

const call = (body) =>
  routes[0].fetch(
    new Request('http://x/api/session.archiveDelete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )

// 1. not archived -> 409
let res = await call({ sessionId: 'session-nope' })
assert.equal(res.status, 409)
assert.equal((await res.json()).error.code, 'session/not-archived')

// 2. malformed body -> 400
res = await call({})
assert.equal(res.status, 400)
assert.equal((await res.json()).error.code, 'bad-request')

// 3. an archived Session that still has a live Agent is deleted after the
//    archive-stop seam runs: the archive gate, not deletion, owns that refusal.
const root = await mkdtemp(join(tmpdir(), 'adsd-'))
// Mirror the real layout `<root>/sessions/<proj>/<seg>` so the deterministic
// projection-cache fallback resolves `<root>/storages/session_projcache/...`.
const project = join(root, 'sessions', '--proj--')
const dir = join(project, sid)
await mkdir(dir, { recursive: true })
const logPath = join(dir, 'session.v4.jsonl.zstd')
await writeFile(logPath, 'stub')
await writeFile(join(dir, 'session.lock'), '')
const projcacheDir = join(root, 'storages', 'session_projcache', 'sessions')
await mkdir(projcacheDir, { recursive: true })
const projcacheRecord = join(projcacheDir, `${sid}.json`)
await writeFile(projcacheRecord, '{}')
const detachCalls = []
state.workspaces = [
  {
    id: 'ws1',
    sessionIds: [sid],
    detachSession: async (id) => {
      detachCalls.push(id)
    },
  },
  {
    id: 'ws2',
    sessionIds: [otherId],
    detachSession: async () => {
      throw new Error('unexpected detach')
    },
  },
]
const flushCalls = []
state.services.sessions = {
  get: (id) => (id === sid ? { id } : undefined),
  flush: async (session) => {
    flushCalls.push(session.id)
    return true
  },
}
// A live Agent that exposes its own idle barrier; deletion cancels its turn via
// the stop seam and waits on this before removing the log.
let idleWaited = 0
state.services.agents = {
  get: (id) =>
    id === sid
      ? {
          id,
          whenIdle: async () => {
            idleWaited += 1
          },
        }
      : undefined,
}
state.services.sessionPersistence = {
  stat: async (id) => (id === sid ? { header: { id }, location: { kind: 'jsonl', path: logPath } } : undefined),
}
const projectionDeletes = []
state.services.storageDomain = {
  get: () => ({
    table: () => ({
      delete: async (id) => {
        projectionDeletes.push(id)
        return true
      },
    }),
  }),
}

res = await call({ sessionId: sid })
assert.equal(res.status, 200)
const payload = await res.json()
assert.equal(payload.ok, true)
assert.equal(payload.value.removedFile, true)
assert.equal(payload.value.agentStillLive, true, 'reports the live Agent so the client keeps its optimistic removal')
assert.deepEqual(payload.value.warnings, [], 'no internal step failed')
assert.deepEqual(state.parallel, [['workspace/session-stop', { sessionId: sid }]], 'stop providers asked first')
assert.equal(idleWaited, 1, 'waited for the cancelled Agent turn to settle before removal')
assert.deepEqual(flushCalls, [sid], 'durability barrier before removal')
assert.deepEqual(detachCalls, [sid], 'detached exactly the target workspace membership')
assert.deepEqual(state.unarchived, [], 'live Agent keeps its archive gate')
assert.ok(state.archived.has(sid), 'archive entry retained while the Agent is live')
assert.deepEqual(projectionDeletes, [sid], 'projection cache row removed')
assert.deepEqual(state.emitted, [['api-session/removed', sid]], 'list removal emitted')
await assert.rejects(access(dir), 'session directory removed from disk')
await assert.rejects(access(projcacheRecord), 'projection-cache record removed by the deterministic fallback')

// 4. a cold Session with a missing artifact still clears the remaining accounting
state.archived = new Set([sid])
state.unarchived = []
state.services.sessionPersistence = { stat: async () => undefined }
state.services.sessions = { get: () => undefined, flush: async () => true }
state.services.agents = { get: () => undefined }
res = await call({ sessionId: sid })
assert.equal(res.status, 200)
const coldPayload = await res.json()
assert.equal(coldPayload.value.removedFile, false)
assert.equal(coldPayload.value.agentStillLive, false, 'cold Session reports no live Agent')
assert.deepEqual(state.unarchived, [sid], 'cold Session is unarchived')

// 5. an artifact outside the target Session directory is refused
const foreignDir = join(project, 'session-foreign')
await mkdir(foreignDir, { recursive: true })
await writeFile(join(foreignDir, 'session.v4.jsonl.zstd'), 'x')
state.archived = new Set([otherId])
state.services.sessionPersistence = {
  stat: async () => ({ location: { kind: 'jsonl', path: join(foreignDir, 'session.v4.jsonl.zstd') } }),
}
res = await call({ sessionId: otherId })
assert.equal(res.status, 500)
assert.equal((await res.json()).error.code, 'unsafe-path')

// 6. a backend without a deletable artifact is refused
state.services.sessionPersistence = { stat: async () => ({ location: { kind: 'sqlite', path: '/x' } }) }
res = await call({ sessionId: otherId })
assert.equal(res.status, 501)
assert.equal((await res.json()).error.code, 'unsupported-backend')

// 7. a failing stop provider is reported, never a reason to keep the Session
state.archived = new Set([sid])
const failStop = ctx.parallel
ctx.parallel = async () => {
  throw new AggregateError([new Error('stop exploded')], 'stop failed')
}
const lockedDir = join(project, sid)
await mkdir(lockedDir, { recursive: true })
await writeFile(join(lockedDir, 'session.v4.jsonl.zstd'), 'y')
state.services.sessionPersistence = {
  stat: async () => ({ location: { kind: 'jsonl', path: join(lockedDir, 'session.v4.jsonl.zstd') } }),
}
state.services.sessions = { get: () => undefined, flush: async () => true }
state.services.agents = { get: () => undefined }
state.emitted = []
res = await call({ sessionId: sid })
ctx.parallel = failStop
assert.equal(res.status, 200, 'stop failure is a warning, not a refusal')
const warned = await res.json()
assert.equal(warned.value.warnings.length, 1)
assert.match(warned.value.warnings[0], /^stop activity: /)

await rm(root, { recursive: true, force: true })

// 8. the startup sweep drops archive entries that reference neither a live
//    Session nor a stored log, and keeps every entry that still does.
const sweepState = {
  archived: new Set(['session-dangling', 'session-live', 'session-stored']),
  unarchived: [],
  services: {
    agents: { get: (id) => (id === 'session-live' ? { id } : undefined) },
    sessionPersistence: {
      stat: async (id) => (id === 'session-stored' ? { header: { id } } : undefined),
    },
  },
}
const sweepCtx = {
  logger: { warn: noopLog, info: noopLog },
  get: (name) => sweepState.services[name],
  effect: (fn) => {
    fn()
  },
  emit: () => {},
  parallel: async () => {},
  connection: { fetch: { register: () => () => {} } },
  workspaceRegistry: {
    get archivedSessionIds() {
      return [...sweepState.archived]
    },
    list: () => [],
    unarchiveSession: async (id) => {
      sweepState.archived.delete(id)
      sweepState.unarchived.push(id)
    },
    unpinSession: async () => {},
  },
}
function noopLog() {}
mod.apply(sweepCtx)
await new Promise((resolve) => setImmediate(resolve))
assert.deepEqual(sweepState.unarchived, ['session-dangling'], 'only the dangling entry is swept')
assert.ok(sweepState.archived.has('session-live'), 'live Session keeps its archive gate')
assert.ok(sweepState.archived.has('session-stored'), 'stored Session keeps its archive entry')

console.log('host half: all checks passed')
