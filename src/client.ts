/**
 * Client half of the delete-archived-session bundle. Registers a two-step permanent
 * delete control into the sidebar row-action strip and the "..." more-menu,
 * both rendered only while the Session is archived, plus a root-overlay notice
 * for a refused or failed deletion.
 *
 * Loaded through `window.__ModuleLoader__.load`; `react` and the shipped UI
 * primitives are resolved at runtime through the injected `require`, never
 * bundled, so this stays a thin wrapper over the host's own components.
 *
 * @module dsh-delete-archived-session/client
 */
import { ARM_MS, dictionaries, ICON_SIZE, NOTICE_MS, NS, ROUTE } from './locale'
import { createNoticeStore, type Notice, type NoticeStore } from './notice-store'
import { CSS, ROW_BUTTON_CLASS } from './styles'
import type { RemoveOutcome, RemoveSession, SessionId, Translate } from './types'

/** The runtime `require` the module loader injects. */
type Require = (id: string) => any

/** The sliver of the React runtime this bundle uses, typed so hooks keep generics. */
interface ReactLike {
  createElement(type: unknown, props?: unknown, ...children: unknown[]): unknown
  useState<S>(initial: S | (() => S)): [S, (next: S | ((prev: S) => S)) => void]
  useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void
  useCallback<T extends (...args: any[]) => any>(callback: T, deps: readonly unknown[]): T
  useRef<T>(initial: T): { current: T }
}

/** The browser module-loader global the Harness exposes. */
declare global {
  interface Window {
    __ModuleLoader__: {
      load(entry: { id: string; factory: (require: Require) => unknown }): void
    }
  }
}

window.__ModuleLoader__.load({
  id: 'dsh-delete-archived-session',
  factory(require) {
    const React = require('react') as ReactLike
    const h = React.createElement
    // The shell's static module table serves the shipped UI primitives, so the
    // delete control reuses the exact Icon, Tooltip, and MenuItemButton the
    // archive and pin controls use — same glyph source, same tooltip placement
    // and timing, same menu row with its native hover and danger styling.
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    const IconTrashOutlineRegular = primitives.IconTrashOutlineRegular
    const Tooltip = primitives.Tooltip
    const MenuItemButton = primitives.MenuItemButton

    interface ToastProps {
      readonly text: string
      readonly holdMs: number
      readonly onDone: () => void
    }

    /** Plugin-owned notice mirroring the shipped toast placement and timing. */
    function Toast(props: ToastProps): unknown {
      const { text, holdMs, onDone } = props
      React.useEffect(() => {
        const timer = setTimeout(onDone, holdMs)
        return () => clearTimeout(timer)
      }, [text, holdMs, onDone])
      return h('div', { role: 'status', className: 'adsd_notice' }, text)
    }

    interface ControlProps {
      readonly sessionId: SessionId
      readonly displayTitle?: string
      readonly useWorkspaces: <T>(selector: (state: { archivedSessionIds: SessionId[] }) => T) => T
      readonly removeSession: RemoveSession
      readonly t: Translate
      readonly menu?: boolean
      readonly dismissMenu?: () => void
    }

    /**
     * The two-step delete control, shared by the hover strip and the "..." menu.
     * Renders only while the row's Session is archived. The first click arms the
     * control for {@link ARM_MS} (error color, "permanently delete" label); a
     * click while armed performs the deletion; the arm lapses on its own.
     */
    function DeleteArchivedSessionControl(props: ControlProps): unknown {
      const { sessionId, displayTitle, useWorkspaces, removeSession, t } = props
      const archived = useWorkspaces((state) => state.archivedSessionIds.includes(sessionId))
      const [armed, setArmed] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
      const deadlineRef = React.useRef(0)
      const busyRef = React.useRef(false)
      const menu = props.menu === true
      const keyPrefix = menu ? 'menu' : 'row'

      const disarm = React.useCallback(() => {
        if (timerRef.current !== null) {
          clearTimeout(timerRef.current)
          timerRef.current = null
        }
        deadlineRef.current = 0
        setArmed(false)
      }, [])

      React.useEffect(
        () => () => {
          if (timerRef.current !== null) clearTimeout(timerRef.current)
        },
        [],
      )

      // A row whose Session lost its archived state (or changed identity) never
      // carries an armed confirmation over.
      React.useEffect(() => {
        disarm()
      }, [archived, sessionId, disarm])

      if (!archived) return null

      const name = displayTitle === '' || displayTitle === undefined ? sessionId : displayTitle
      const label = t(armed ? `${keyPrefix}.armTitle` : `${keyPrefix}.title`)

      const onClick = (): void => {
        if (busyRef.current) return
        if (!armed || Date.now() >= deadlineRef.current) {
          if (timerRef.current !== null) clearTimeout(timerRef.current)
          deadlineRef.current = Date.now() + ARM_MS
          setArmed(true)
          timerRef.current = setTimeout(disarm, ARM_MS)
          return
        }
        disarm()
        busyRef.current = true
        setBusy(true)
        removeSession(sessionId)
          .then((result) => {
            if (result.ok) props.dismissMenu?.()
          })
          .finally(() => {
            busyRef.current = false
            setBusy(false)
          })
      }

      if (menu) {
        // The shipped menu row: native hover background, native danger tint
        // while armed, native icon slot and label. `onSelect` drives the same
        // two-step click handler.
        return h(
          MenuItemButton,
          {
            icon: h(IconTrashOutlineRegular, { size: ICON_SIZE }),
            danger: armed,
            disabled: busy,
            onSelect: onClick,
          },
          busy ? t('row.busyAria', { name }) : label,
        )
      }

      return h(
        Tooltip,
        { label, side: 'bottom', align: 'end', delayMs: 500, portal: true },
        h(
          'button',
          {
            type: 'button',
            className: ROW_BUTTON_CLASS,
            'data-adsd-row': 'true',
            'aria-label': busy ? t('row.busyAria', { name }) : t(armed ? 'row.armAria' : 'row.aria', { name }),
            'aria-busy': busy ? 'true' : undefined,
            'data-armed': armed ? 'true' : undefined,
            onClick,
          },
          h(IconTrashOutlineRegular, { size: ICON_SIZE }),
        ),
      )
    }

    interface MenuProps extends ControlProps {
      readonly useMenuOpenState: () => [boolean, (open: boolean) => void]
    }

    /**
     * The "..." menu row: the shared control wired to the menu's open-state
     * hook, so a confirmed deletion closes the menu.
     */
    function DeleteArchivedMenuItem(props: MenuProps): unknown {
      const [, setMenuOpen] = props.useMenuOpenState()
      return h(DeleteArchivedSessionControl, { ...props, menu: true, dismissMenu: () => setMenuOpen(false) })
    }

    interface NoticeProps {
      readonly useNotice: <T>(selector: (value: Notice | null) => T) => T
      readonly dismissNotice: () => void
    }

    /** Root overlay notice for a refused or failed deletion. */
    function DeleteNotice(props: NoticeProps): unknown {
      const notice = props.useNotice((value) => value)
      if (notice === null || notice === undefined) return null
      return h(Toast, { text: notice.text, holdMs: NOTICE_MS, onDone: props.dismissNotice, key: notice.id })
    }

    interface ClientContext {
      locale: {
        bind(ns: string): Translate
        register(ns: string, dicts: Record<string, Record<string, string>>): () => void
      }
      sessions: { refresh(): Promise<void> }
      slots: {
        inject(name: string, factory: () => unknown): () => void
        register(options: Record<string, unknown>, component: unknown): unknown
      }
      effect(callback: () => (() => void) | void, label?: string): () => void
    }

    return {
      inject: ['slots', 'locale', 'sessions'],
      apply(ctx: ClientContext) {
        const t = ctx.locale.bind(NS)
        const notices: NoticeStore = createNoticeStore()

        ctx.effect(() => ctx.locale.register(NS, dictionaries), 'delete-archived-session: dictionaries')

        ctx.effect(() => {
          const tag = document.createElement('style')
          tag.dataset.plugin = 'dsh-delete-archived-session'
          tag.dataset.pluginCss = 'dsh-delete-archived-session/row-action.css'
          tag.textContent = CSS
          // Lower specificity than the reused shipped class: the plugin style
          // only layers the armed tint, so it must come after the module CSS.
          document.head.appendChild(tag)
          return () => {
            tag.remove()
          }
        }, 'delete-archived-session: styles')

        ctx.effect(() => () => notices.dispose(), 'delete-archived-session: notices')

        /** Delete one archived Session through the authenticated Host route. */
        const removeSession: RemoveSession = async (sessionId) => {
          let response: Response
          try {
            response = await fetch(ROUTE, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ sessionId }),
            })
          } catch (error) {
            notices.show(t('notice.failed', { reason: error instanceof Error ? error.message : String(error) }))
            return { ok: false }
          }
          let payload: any = null
          try {
            payload = await response.json()
          } catch {
            payload = null
          }
          if (response.ok && payload !== null && payload.ok === true) {
            // When the Host could fully retire the Session (cold, no live Agent)
            // a refresh reconciles the list to the removed state. When an Agent
            // is still live the Host cannot dispose it, so the list would
            // re-summarize a ghost row; the Host's `api-session/removed` relay
            // already removed the row optimistically, so skip the refresh.
            const value = (payload.value ?? {}) as RemoveOutcome['value']
            if (value?.agentStillLive !== true) {
              try {
                await ctx.sessions.refresh()
              } catch (error) {
                console.error('delete-archived-session: session list refresh failed:', error)
              }
            }
            return { ok: true, value }
          }
          const failure = payload !== null && payload.error !== undefined ? payload.error : null
          const code = failure === null ? '' : String(failure.code ?? '')
          const reason = failure === null ? `HTTP ${response.status}` : String(failure.message ?? code)
          notices.show(t(code === 'session/not-archived' ? 'notice.notArchived' : 'notice.failed', { reason }))
          return { ok: false }
        }

        ctx.slots.inject('sidebar.workspaces.session.row.action', () =>
          ctx.slots.register(
            {
              name: 'sidebar.workspaces.session.row.action',
              id: 'archived-delete',
              order: 300,
              locale: NS,
              inject: () => ({ removeSession }),
            },
            DeleteArchivedSessionControl,
          ),
        )

        ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
          ctx.slots.register(
            {
              name: 'sidebar.workspaces.session.menu.item',
              id: 'dsh-delete-archived-session',
              order: 500,
              locale: NS,
              inject: () => ({ removeSession }),
            },
            DeleteArchivedMenuItem,
          ),
        )

        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            {
              name: 'shell.overlay',
              id: 'delete-archived-session-notice',
              order: 900,
              locale: NS,
              inject: () => ({ hooks: { notice: notices }, dismissNotice: () => notices.clear() }),
            },
            DeleteNotice,
          ),
        )
      },
    }
  },
})
