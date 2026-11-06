/**
 * Minimal structural types for the DeepSeek Harness runtime seams this plugin
 * touches. The Harness ships no public type package for plugins, so these cover
 * only the members used here — enough for a strict build, not a full model.
 *
 * @module dsh-delete-archived-session/types
 */

/** A branded Session id string. */
export type SessionId = string

/** The two shipped UI languages this plugin localizes. */
export type Locale = 'en' | 'zh'

/** A flat message dictionary keyed by dotted message id. */
export type Dictionary = Record<string, string>

/** Locale interpolation parameters. */
export type LocaleParams = Record<string, string>

/** The bound translator returned by `ctx.locale.bind`. */
export type Translate = (key: string, params?: LocaleParams) => string

/** The deletion result envelope the Host route returns in its `value`. */
export interface DeleteValue {
  readonly sessionId: SessionId
  readonly removedFile: boolean
  readonly agentStillLive: boolean
  readonly warnings: readonly string[]
}

/** The outcome the client delete face resolves to. */
export interface RemoveOutcome {
  readonly ok: boolean
  readonly value?: Partial<DeleteValue>
}

/** Delete one archived Session; resolves whether the Host accepted it. */
export type RemoveSession = (sessionId: SessionId) => Promise<RemoveOutcome>
