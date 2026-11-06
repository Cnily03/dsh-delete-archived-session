/**
 * Shared constants and the bilingual message dictionaries for the delete
 * control. Imported by both halves so the namespace and route never drift.
 *
 * @module dsh-delete-archived-session/locale
 */
import type { Dictionary, Locale } from './types'

/** Locale namespace registered with `ctx.locale.register`. */
export const NS = 'deleteArchivedSession'

/** Authenticated Host route the client POSTs one deletion request to. */
export const ROUTE = 'api/session.archiveDelete'

/** Milliseconds the control stays armed after the first click. */
export const ARM_MS = 3000

/** Milliseconds a failure notice stays on screen. */
export const NOTICE_MS = 4000

/** Shipped row-action glyph size. */
export const ICON_SIZE = 14

const en: Dictionary = {
  'row.title': 'Delete archived session',
  'row.armTitle': 'Permanently delete',
  'row.aria': 'Delete archived session {name}',
  'row.armAria': 'Permanently delete archived session {name}',
  'row.busyAria': 'Deleting archived session {name}',
  'menu.title': 'Delete archived session',
  'menu.armTitle': 'Permanently delete',
  'notice.failed': 'Could not delete the Session: {reason}',
  'notice.notArchived': 'The Session is no longer archived.',
}

const zh: Dictionary = {
  'row.title': '删除归档会话',
  'row.armTitle': '彻底删除',
  'row.aria': '删除归档会话 {name}',
  'row.armAria': '彻底删除归档会话 {name}',
  'row.busyAria': '正在删除归档会话 {name}',
  'menu.title': '删除归档会话',
  'menu.armTitle': '彻底删除',
  'notice.failed': '无法删除该会话：{reason}',
  'notice.notArchived': '该会话已不再处于归档状态。',
}

/** The two shipped-language dictionaries, keyed by locale. */
export const dictionaries: Record<Locale, Dictionary> = { en, zh }
