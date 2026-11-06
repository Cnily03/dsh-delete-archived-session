/**
 * One transient notice shared by the row button, the menu row, and the overlay.
 * A tiny observable the overlay subscribes to; the delete face publishes into
 * it when the Host refuses or the request fails.
 *
 * @module dsh-delete-archived-session/notice-store
 */

/** A single notice: a monotonic id plus its display text. */
export interface Notice {
  readonly id: number
  readonly text: string
}

/** The notice observable surface. */
export interface NoticeStore {
  getSnapshot(): Notice | null
  subscribe(listener: () => void): () => void
  show(text: string): void
  clear(): void
  dispose(): void
}

/** Create one empty notice store. */
export function createNoticeStore(): NoticeStore {
  let snapshot: Notice | null = null
  const listeners = new Set<() => void>()
  const publish = (): void => {
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch (error) {
        console.error('delete-archived-session: notice subscriber crashed:', error)
      }
    }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    show(text) {
      snapshot = { id: (snapshot === null ? 0 : snapshot.id) + 1, text }
      publish()
    },
    clear() {
      if (snapshot === null) return
      snapshot = null
      publish()
    },
    dispose() {
      snapshot = null
      listeners.clear()
    },
  }
}
