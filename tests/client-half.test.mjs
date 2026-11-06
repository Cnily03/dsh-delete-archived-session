import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../dist/client.js', import.meta.url), 'utf8')

// Minimal loader + React stand-ins: this test exercises registration wiring only.
const registrations = []
globalThis.window = { __ModuleLoader__: { load: (entry) => registrations.push(entry) } }
const noop = () => {}
const React = {
  createElement: (...args) => ({ args }),
  useState: (value) => [value, noop],
  useEffect: noop,
  useRef: (value) => ({ current: value }),
  useCallback: (fn) => fn,
  Fragment: 'Fragment',
}
const requires = []
const IconStub = (props) => ({ args: ['icon', props] })
const TooltipStub = (props) => ({ args: ['tooltip', props] })
const MenuItemButtonStub = (props) => ({ args: ['menuItemButton', props] })
const moduleTable = {
  react: React,
  'react/jsx-runtime': {},
  // The shell static module table serves the shipped primitives; the plugin
  // reuses IconTrashOutlineRegular, Tooltip, and MenuItemButton from it so the
  // hover strip and the "…" menu row match the shipped controls exactly.
  '@deepseek-ai/dsh-client-ui-primitives': {
    IconTrashOutlineRegular: IconStub,
    Tooltip: TooltipStub,
    MenuItemButton: MenuItemButtonStub,
  },
}

const styleTags = []
globalThis.document = {
  head: { appendChild: (node) => styleTags.push(node) },
  createElement: () => ({ dataset: {}, remove: noop, textContent: '' }),
  querySelector: () => null,
}

new Function('window', source)(globalThis.window)
assert.equal(registrations.length, 1, 'one bundle registered')
assert.equal(registrations[0].id, 'dsh-delete-archived-session')

const factory = registrations[0].factory
const mod = factory((name) => {
  requires.push(name)
  if (name in moduleTable) return moduleTable[name]
  throw new Error(`unexpected module request: ${name}`)
})
assert.deepEqual(mod.inject, ['slots', 'locale', 'sessions'])
assert.equal(typeof mod.apply, 'function')
assert.deepEqual(
  requires,
  ['react', '@deepseek-ai/dsh-client-ui-primitives'],
  'requires React and the shipped primitives (icon + tooltip) only',
)

const slots = []
const effects = []
const localeDicts = []
const refreshes = []
const fetchCalls = []
const ctx = {
  slots: {
    inject: (_key, callback) => {
      const effect = callback()
      effects.push(effect)
      return noop
    },
    register: (options, component) => {
      slots.push({ options, component })
      return noop
    },
  },
  locale: {
    register: (ns, dicts) => {
      localeDicts.push({ ns, dicts })
      return noop
    },
    bind: (ns) => (key, params) => {
      const dict = localeDicts.find((entry) => entry.ns === ns)?.dicts.en ?? {}
      const template = dict[key] ?? key
      return params === undefined
        ? template
        : template.replace(/\{(\w+)\}/g, (m, n) => (n in params ? String(params[n]) : m))
    },
  },
  sessions: {
    refresh: async () => {
      refreshes.push(true)
    },
  },
  effect: (fn, label) => {
    effects.push({ label, dispose: fn() })
    return noop
  },
}
globalThis.fetch = async (url, init) => {
  fetchCalls.push({ url, init })
  return new Response(JSON.stringify({ ok: true, value: { sessionId: 'session-archived' } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

mod.apply(ctx)

// Locale dictionaries registered for both shipped UI languages.
assert.equal(localeDicts.length, 1)
assert.equal(localeDicts[0].ns, 'deleteArchivedSession')
assert.deepEqual(Object.keys(localeDicts[0].dicts).sort(), ['en', 'zh'])
assert.equal(localeDicts[0].dicts.zh['row.title'], '删除归档会话')

// One style tag installed and cleaned up by its effect; the plugin only layers
// the armed error tint on the reused row icon button and the transient notice.
// The menu row is the shipped MenuItemButton, so the plugin adds no menu CSS.
assert.equal(styleTags.length, 1)
assert.ok(
  styleTags[0].textContent.includes('--dsw-alias-state-error-primary'),
  'armed base color uses the error-primary token',
)
assert.ok(
  styleTags[0].textContent.includes('.adsd_rowButton[data-armed="true"]{color:var(--dsw-alias-state-error-primary)}'),
  'armed base tint targets the reused row icon button with the registered error token',
)
assert.ok(
  styleTags[0].textContent.includes(
    '.adsd_rowButton[data-armed="true"]:hover{color:color-mix(in srgb,var(--dsw-alias-state-error-primary),#fff 28%)}',
  ),
  'armed hover brightens the registered error token via color-mix',
)
assert.ok(
  !styleTags[0].textContent.includes('error-secondary'),
  'does not reference error-secondary, which is not a live theme token',
)
assert.ok(
  styleTags[0].textContent.includes('.adsd_notice{position:fixed'),
  'notice is the only plugin floating surface',
)
assert.ok(
  !styleTags[0].textContent.includes('.adsd_menuItem'),
  'menu row reuses the shipped MenuItemButton, no self-drawn menu CSS',
)
assert.ok(
  /\.adsd_rowButton\s*\{[^}]*width:24px/.test(styleTags[0].textContent),
  'row button replicates the shipped 24px icon-button box from theme tokens, not a hashed class',
)
assert.ok(
  !styleTags[0].textContent.includes('u14Mxa'),
  'does not depend on a hashed CSS-module class that changes between Harness versions',
)

// All three slots registered with fresh ids.
const rowAction = slots.find((entry) => entry.options.name === 'sidebar.workspaces.session.row.action')
assert.ok(rowAction, 'row action slot registered')
assert.equal(rowAction.options.id, 'archived-delete')
assert.equal(rowAction.options.order, 300)
assert.equal(rowAction.options.locale, 'deleteArchivedSession')
const menuItem = slots.find((entry) => entry.options.name === 'sidebar.workspaces.session.menu.item')
assert.ok(menuItem, 'menu item slot registered')
assert.equal(menuItem.options.id, 'dsh-delete-archived-session')
assert.equal(menuItem.options.order, 500, 'menu row placed after the shipped session-id row (450)')
assert.equal(menuItem.options.locale, 'deleteArchivedSession')
const overlay = slots.find((entry) => entry.options.name === 'shell.overlay')
assert.ok(overlay, 'overlay slot registered')
assert.equal(overlay.options.id, 'delete-archived-session-notice')

// Both entry points share the same delete face, which posts to the exact Host
// route and refreshes the Session list after a success.
const rowFace = rowAction.options.inject()
const menuFace = menuItem.options.inject()
assert.equal(rowFace.removeSession, menuFace.removeSession, 'hover button and menu row share one delete face')
const outcome = await rowFace.removeSession('session-archived')
assert.equal(outcome.ok, true)
assert.equal(fetchCalls.length, 1)
assert.equal(fetchCalls[0].url, 'api/session.archiveDelete')
assert.equal(fetchCalls[0].init.method, 'POST')
assert.deepEqual(JSON.parse(fetchCalls[0].init.body), { sessionId: 'session-archived' })
assert.equal(refreshes.length, 1, 'session list refreshed after a cold-session success')

// When the Host reports the Agent is still live, the client trusts the Host's
// optimistic row removal and skips the refresh that would re-summarize a ghost.
globalThis.fetch = async (url, init) => {
  fetchCalls.push({ url, init })
  return new Response(JSON.stringify({ ok: true, value: { sessionId: 'session-archived', agentStillLive: true } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
const liveOutcome = await rowFace.removeSession('session-archived')
assert.equal(liveOutcome.ok, true)
assert.equal(refreshes.length, 1, 'no refresh when the Agent is still live')

// A refusal surfaces a localized notice instead of a silent success, and does
// not refresh the list.
const overlayFace = overlay.options.inject()
assert.equal(typeof overlayFace.hooks.notice.getSnapshot, 'function')
assert.equal(typeof overlayFace.dismissNotice, 'function')
globalThis.fetch = async () =>
  new Response(
    JSON.stringify({
      ok: false,
      error: { code: 'session/not-archived', message: 'not archived' },
    }),
    { status: 409, headers: { 'content-type': 'application/json' } },
  )
const refused = await rowFace.removeSession('session-archived')
assert.equal(refused.ok, false)
assert.equal(refreshes.length, 1, 'no refresh on failure')
assert.equal(overlayFace.hooks.notice.getSnapshot().text, 'The Session is no longer archived.')

console.log('client half: all checks passed')
