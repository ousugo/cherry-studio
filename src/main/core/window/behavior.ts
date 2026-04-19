import type { WindowBehavior, WindowOptions } from '@main/core/window/types'
import type { BrowserWindow } from 'electron'

/**
 * Apply the declarative {@link WindowBehavior} layer to a freshly-created window.
 *
 * This is the non-hacky counterpart to `applyWindowQuirks`: it runs the initial
 * setter calls that Electron's `BrowserWindow` constructor cannot express, and
 * mounts the `blur → hide` listener for {@link WindowBehavior.hideOnBlur}.
 *
 * Call ordering in `WindowManager.createWindow`:
 *
 *   1. `new BrowserWindow(constructorOptions)` — Electron-native setup
 *   2. `applyWindowBehavior(window, behavior, ...)` — initial setters + blur hook
 *   3. `applyWindowQuirks(window, quirks, behavior)` — monkey-patches hide/show
 *
 * Running behavior BEFORE quirks has two intentional effects:
 *   - The initial `setAlwaysOnTop(true, level)` is free of monkey-patch overhead
 *     (first-time setup with no hide/show loop to guard against).
 *   - The blur → `window.hide()` call inherits whatever `quirks` install on
 *     `hide` (macRestoreFocusOnHide, macClearHoverOnHide), because quirks
 *     re-assign `window.hide` after this function returns but the listener
 *     body dereferences `window.hide` at event-fire time.
 *
 * @param window - The BrowserWindow instance
 * @param behavior - The declarative behavior metadata (undefined skips all work)
 * @param id - The WindowManager-assigned windowId (used as override map key)
 * @param getHideOnBlurOverride - Closure returning the runtime override for this
 *   window id (or undefined if unset). Provided by WindowManager — passing a
 *   closure instead of the WM instance keeps this module free of a reverse
 *   dependency.
 * @param windowOptions - The merged WindowOptions used to construct the window.
 *   Consulted to decide whether to re-apply `setAlwaysOnTop` with the
 *   `behavior.alwaysOnTop` level: the initial call is skipped if
 *   `windowOptions.alwaysOnTop !== true`, since Electron did not enable it
 *   during construction and the caller has not opted in.
 */
export function applyWindowBehavior(
  window: BrowserWindow,
  behavior: WindowBehavior | undefined,
  id: string,
  getHideOnBlurOverride: (id: string) => boolean | undefined,
  windowOptions: WindowOptions
): void {
  if (!behavior) return

  // ── Initial alwaysOnTop with level/relativeLevel ─────────────────────
  // Electron's `new BrowserWindow({ alwaysOnTop: true })` enables the flag but
  // cannot accept a level. We enhance it here once so the level takes effect
  // before any show happens. The macReapplyAlwaysOnTop quirk (if set) will
  // keep re-applying on subsequent show/showInactive to survive macOS demotion.
  if (windowOptions.alwaysOnTop === true && behavior.alwaysOnTop) {
    const { level, relativeLevel } = behavior.alwaysOnTop
    if (level !== undefined && relativeLevel !== undefined) {
      window.setAlwaysOnTop(true, level, relativeLevel)
    } else if (level !== undefined) {
      window.setAlwaysOnTop(true, level)
    }
    // No-op when only relativeLevel is set without level — not a meaningful
    // Electron call (the method's 2nd parameter must be a level string).
  }

  // ── Initial setVisibleOnAllWorkspaces ────────────────────────────────
  // One-shot on create. Windows whose true/false options differ per call
  // (e.g. SelectionAction's full-screen show sequence) should not declare
  // this — they drive both directions via direct window calls.
  if (behavior.visibleOnAllWorkspaces) {
    const { enabled, ...options } = behavior.visibleOnAllWorkspaces
    window.setVisibleOnAllWorkspaces(enabled, options)
  }

  // ── hideOnBlur listener ──────────────────────────────────────────────
  // Auto-hide on blur, with runtime override via WM.setHideOnBlur(id, enabled).
  // `window.hide()` dereferences at fire time, so it picks up any monkey-patch
  // quirks (macRestoreFocusOnHide, macClearHoverOnHide) installed later.
  if (behavior.hideOnBlur) {
    window.on('blur', () => {
      if (window.isDestroyed() || !window.isVisible()) return
      // override === false means "pinned / don't auto-hide"; undefined falls
      // through to the registry-declared default (true in this branch).
      if (getHideOnBlurOverride(id) === false) return
      window.hide()
    })
  }
}
