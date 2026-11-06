/**
 * The plugin's only stylesheet. The row button replicates the shipped sidebar
 * icon-button metrics from theme tokens — instead of depending on a hashed
 * CSS-module class that changes between Harness versions — and adds the armed
 * error tint the native button has no variant for. The menu row is the shipped
 * `MenuItemButton`, so it needs no CSS here. Every color comes from a theme
 * token.
 *
 * @module dsh-delete-archived-session/styles
 */

/** Plugin-owned, version-stable class for the row delete button. */
export const ROW_BUTTON_CLASS = 'adsd_rowButton'

/** The injected stylesheet text. */
export const CSS = [
  // Replicate the shipped row icon button (24px box, radius-xs, -4px inset,
  // tertiary label brightening to primary on hover) from theme tokens, so no
  // hashed CSS-module class is referenced.
  '.adsd_rowButton{box-sizing:border-box;width:24px;height:24px;margin:-4px;padding:0;border:none;',
  'border-radius:var(--dsw-radius-xs);background:transparent;cursor:pointer;flex:none;',
  'display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary)}',
  '.adsd_rowButton:focus-visible{outline-offset:-2px}',
  '.adsd_rowButton:hover{color:var(--dsw-alias-label-primary)}',
  // Armed state tints the button with the only registered error token,
  // error-primary. Hovering an armed button brightens that same token toward
  // white via color-mix, mirroring the native tertiary -> primary hover. The
  // non-hover rule is the fallback color on engines without color-mix.
  '.adsd_rowButton[data-armed="true"]{color:var(--dsw-alias-state-error-primary)}',
  '.adsd_rowButton[data-armed="true"]:hover{color:color-mix(in srgb,var(--dsw-alias-state-error-primary),#fff 28%)}',
  '.adsd_rowButton[aria-busy="true"]{cursor:progress;opacity:.55}',
  '.adsd_notice{position:fixed;top:40px;left:50%;transform:translateX(-50%);z-index:1100;',
  'pointer-events:none;width:max-content;max-width:min(640px,calc(100vw - 48px));',
  'padding:12px 16px;border-radius:var(--dsw-radius-lg,var(--dsw-radius-md));',
  'background:var(--dsw-alias-toast-bg,var(--dsw-alias-bg-overlay));',
  'color:var(--dsw-alias-toast-label,var(--dsw-alias-label-primary));',
  'font-size:14px;line-height:22px}',
].join('')
