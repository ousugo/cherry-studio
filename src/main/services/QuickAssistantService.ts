/**
 * QuickAssistantService — business orchestration for the quick assistant window.
 *
 * Window infrastructure (BrowserWindow construction options, preload, HTML entry,
 * Dock visibility, macOS alwaysOnTop reapply) is owned by WindowManager via the
 * `WindowType.QuickAssistant` registry entry. This service keeps the per-feature
 * business policy:
 *
 *   - feature flag gate (`feature.quick_assistant.enabled`)
 *   - pin / blur auto-hide
 *   - cursor-aware repositioning across displays
 *   - platform-specific hide branch (Windows minimize+opacity, macOS app.hide)
 *   - mainWindow lifecycle coupling (auto-hide when main window appears)
 *   - strict navigation safety (block any non-localhost navigation)
 *   - bounds persistence via electron-window-state
 *
 * Cross-process contracts retained: `miniWindow.html`, `miniWindow-state.json`.
 *
 * Notes for future maintainers:
 *   - `mainWindowRef` caches the BrowserWindow directly because WindowService is
 *     not yet under WindowManager. Once it is, replace the cache with
 *     `wm.getWindowsByType(WindowType.Main)[0]`.
 *   - `wasMainWindowFocused` is captured exactly once per show, inside
 *     `showQuickWindow`. The original service captured it both there and in
 *     `ready-to-show`, but with `show: false` in the registry every user-visible
 *     show now flows through `showQuickWindow`, so a single capture point suffices.
 */
import { application } from '@application'
import { loggerService } from '@logger'
import { isMac, isWin } from '@main/constant'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { WindowType } from '@main/core/window/types'
import { IpcChannel } from '@shared/IpcChannel'
import { app, type BrowserWindow, screen, shell } from 'electron'
import windowStateKeeper from 'electron-window-state'

import { isSafeExternalUrl } from './security'

const DEFAULT_QUICK_WINDOW_WIDTH = 550
const DEFAULT_QUICK_WINDOW_HEIGHT = 400
const QUICK_WINDOW_STATE_FILE = 'miniWindow-state.json'
/**
 * On macOS 26+ (Tahoe / future), hiding a panel-style window keeps the previous
 * application as the frontmost without the manual `app.hide()` workaround the
 * older releases need to restore the prior app's focus.
 */
const MACOS_AUTO_FOCUS_VERSION = 26

const logger = loggerService.withContext('QuickAssistantService')

@Injectable('QuickAssistantService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['WindowService', 'WindowManager'])
export class QuickAssistantService extends BaseService {
  private windowId: string | null = null
  private isPinnedQuickWindow = false
  // Captured before each show; hideQuickWindow consults it to decide whether to call app.hide()
  // so that the previous foreground app gets focus back instead of an unrelated app.
  private wasMainWindowFocused = false
  // Cached mainWindow reference — see file-level docstring for why this asymmetry exists.
  private mainWindowRef: BrowserWindow | null = null
  // Lives across the service lifetime; instantiated in onReady BEFORE the BrowserWindow is
  // created so its persisted x/y/width/height can be passed as constructor options. Calling
  // `manage()` on it later (in onWindowCreated) only attaches resize/move/close listeners —
  // it does NOT retroactively apply persisted bounds, hence the up-front instantiation.
  private quickWindowState: ReturnType<typeof windowStateKeeper> | null = null

  protected async onInit() {
    this.registerIpcHandlers()
    this.subscribeMainWindowLifecycle()
  }

  protected async onReady() {
    const enabled = application.get('PreferenceService').get('feature.quick_assistant.enabled')
    if (!enabled) return
    this.createQuickWindow()
  }

  private registerIpcHandlers() {
    this.ipcHandle(IpcChannel.QuickAssistant_Show, () => this.showQuickWindow())
    this.ipcHandle(IpcChannel.QuickAssistant_Hide, () => this.hideQuickWindow())
    this.ipcHandle(IpcChannel.QuickAssistant_Close, () => this.closeQuickWindow())
    this.ipcHandle(IpcChannel.QuickAssistant_Toggle, () => this.toggleQuickWindow())
    this.ipcHandle(IpcChannel.QuickAssistant_SetPin, (_, isPinned: boolean) => this.setPinQuickWindow(isPinned))
  }

  /**
   * Subscribe to mainWindow lifecycle through WindowService's event API (loose coupling).
   *   - Hide quickWindow when mainWindow becomes visible ('show') or is restored from
   *     minimized ('restore'). Both are required: WindowService.showMainWindow calls
   *     mainWindow.restore() for the minimized branch, which does NOT fire 'show'.
   *   - Cache the mainWindow reference so isFocused() can be read locally, without
   *     calling WindowService methods at runtime.
   */
  private subscribeMainWindowLifecycle() {
    const windowService = application.get('WindowService')

    const attach = (mainWindow: BrowserWindow) => {
      this.mainWindowRef = mainWindow

      const onMainVisible = () => {
        const window = this.getQuickWindow()
        if (window) window.hide()
      }
      const onMainClosed = () => {
        if (this.mainWindowRef === mainWindow) {
          this.mainWindowRef = null
        }
      }

      mainWindow.on('show', onMainVisible)
      mainWindow.on('restore', onMainVisible)
      mainWindow.on('closed', onMainClosed)
      this.registerDisposable(() => {
        mainWindow.removeListener('show', onMainVisible)
        mainWindow.removeListener('restore', onMainVisible)
        mainWindow.removeListener('closed', onMainClosed)
      })
    }

    this.registerDisposable(windowService.onMainWindowCreated((w) => attach(w)))
  }

  /**
   * Strict navigation safety for the quick window. Quick window is a single-page SPA;
   * any will-navigate that is not the dev-server URL is treated as an attempt to leave
   * the SPA shell and is either re-routed to the system browser (when safe) or denied.
   *
   * Coexists with WindowManager's default handlers (WindowManager.ts: createWindow):
   *   - will-navigate: both listeners fire; this stricter preventDefault wins.
   *   - setWindowOpenHandler: last-call-wins per Electron contract; this overrides
   *     WindowManager's default and applies the stricter safe-URL check.
   */
  private setupQuickWindowWebContents(window: BrowserWindow) {
    window.webContents.on('will-navigate', (event, url) => {
      if (url.includes('localhost:517')) {
        return
      }

      event.preventDefault()
      if (isSafeExternalUrl(url)) {
        void shell.openExternal(url)
      } else {
        logger.warn(`Blocked navigation to untrusted URL scheme: ${url}`)
      }
    })

    window.webContents.setWindowOpenHandler((details) => {
      if (isSafeExternalUrl(details.url)) {
        void shell.openExternal(details.url)
      } else {
        logger.warn(`Blocked shell.openExternal for untrusted URL scheme: ${details.url}`)
      }
      return { action: 'deny' }
    })
  }

  /**
   * Idempotently ensure the quick window exists. Safe to call from any code path —
   * if the window is already alive (this.windowId set), this is a no-op.
   *
   * Because we own the creation, there is no need to subscribe to `wm.onWindowCreated`
   * — that extension point is for services that observe windows they didn't create.
   * `wm.create()` is synchronous through to `_onWindowCreated.fire()` and quirk
   * application, so by the time it returns, the BrowserWindow is fully tracked and
   * ready for setup. Content load (`loadURL`/`loadFile`) is async and finishes
   * later — none of our listeners can miss events that fire only after load.
   *
   * The windowStateKeeper is instantiated BEFORE the create call so its persisted
   * x/y/w/h can be passed as constructor options. `state.manage()` (called inside
   * setup) only attaches outbound listeners — it does NOT retroactively apply
   * persisted bounds.
   *
   * Note on lifecycle modes: `wm.create()` throws on duplicate singleton creation,
   * which serves as a defensive safety net behind our local `windowId` guard. We
   * deliberately do NOT use `wm.open()` here — open() would return the existing
   * windowId without re-running setup, leaving the window without our listeners on
   * a singleton-reuse path.
   */
  private createQuickWindow() {
    if (this.windowId) return

    if (!this.quickWindowState) {
      this.quickWindowState = windowStateKeeper({
        defaultWidth: DEFAULT_QUICK_WINDOW_WIDTH,
        defaultHeight: DEFAULT_QUICK_WINDOW_HEIGHT,
        file: QUICK_WINDOW_STATE_FILE
      })
    }

    const wm = application.get('WindowManager')
    const windowId = wm.create(WindowType.QuickAssistant, {
      options: {
        x: this.quickWindowState.x,
        y: this.quickWindowState.y,
        width: this.quickWindowState.width,
        height: this.quickWindowState.height
      }
    })
    this.windowId = windowId

    const window = wm.getWindow(windowId)
    if (!window) {
      // Defensive: wm.create() returning a windowId without a backing window would be
      // a WindowManager bug. Bail loudly so the issue is visible instead of silent.
      logger.error('WindowManager.create returned a windowId with no backing BrowserWindow', {
        windowId
      })
      this.windowId = null
      return
    }

    this.setupQuickWindow(window, windowId)
  }

  /**
   * Attach all quick-window-specific behavior to a freshly created BrowserWindow:
   * navigation safety, bounds persistence, OS workspace visibility, alwaysOnTop level,
   * blur/closed/show listeners. Idempotent in scope (only called from createQuickWindow).
   */
  private setupQuickWindow(window: BrowserWindow, windowId: string) {
    this.setupQuickWindowWebContents(window)

    // Outbound bounds persistence: resize/move/close listeners that write to disk.
    // Inbound restoration was already done at construction via wm.create options.
    this.quickWindowState?.manage(window)

    // Keep the window visible across all workspaces and over fullscreen apps.
    // (Reusable WindowQuirks abstraction is a planned follow-up — see plan doc.)
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

    // Set the initial alwaysOnTop level once. The macReapplyAlwaysOnTop quirk
    // ensures macOS does not silently demote the level on subsequent show() calls.
    window.setAlwaysOnTop(true, 'floating')

    const onBlur = () => {
      if (!this.isPinnedQuickWindow) {
        this.hideQuickWindow()
      }
    }
    const onClosed = () => {
      // Guard against a stale close event after re-creation: only clear windowId
      // if it still points to THIS window instance.
      if (this.windowId === windowId) {
        this.windowId = null
      }
    }
    // Renderer-facing event: HomeWindow listens to this and re-reads clipboard
    // + focuses input on every show. The symmetric "Hidden" event used to exist
    // but had no listener anywhere — removed as dead code.
    const onShow = () => {
      if (!window.isDestroyed()) {
        window.webContents.send(IpcChannel.QuickAssistant_Shown)
      }
    }

    window.on('blur', onBlur)
    window.on('closed', onClosed)
    window.on('show', onShow)
    this.registerDisposable(() => {
      if (window.isDestroyed()) return
      window.removeListener('blur', onBlur)
      window.removeListener('closed', onClosed)
      window.removeListener('show', onShow)
    })
  }

  /** Returns the live quick window or null if not created / already destroyed. */
  private getQuickWindow(): BrowserWindow | null {
    if (!this.windowId) return null
    const window = application.get('WindowManager').getWindow(this.windowId)
    if (!window || window.isDestroyed()) return null
    return window
  }

  public showQuickWindow() {
    const enabled = application.get('PreferenceService').get('feature.quick_assistant.enabled')
    if (!enabled) return

    let window = this.getQuickWindow()
    if (!window) {
      // Defensive: onReady should have created the window when feature is enabled.
      // If we land here (e.g. preference toggled on at runtime), create it now and
      // wait for ready-to-show before continuing — otherwise show() would flash an
      // empty BrowserWindow before the renderer mounts.
      this.createQuickWindow()
      window = this.getQuickWindow()
      if (!window) return
      window.once('ready-to-show', () => this.proceedShow())
      return
    }

    this.proceedShow()
  }

  /** Inner show pipeline. Assumes the quick window exists and its content is ready. */
  private proceedShow() {
    const window = this.getQuickWindow()
    if (!window) return

    this.wasMainWindowFocused = this.mainWindowRef?.isFocused() ?? false

    // [Windows] Recovery from the minimize-instead-of-hide branch in hideQuickWindow.
    // Note: do NOT use restore() — Electron has a bug across screens with different scale
    // factors. Use show() then setPosition/setBounds. setOpacity(0) hides the visual
    // glitch while we reposition.
    if (window.isMinimized()) {
      window.setOpacity(0)
      window.show()
    }

    this.repositionToCursorDisplay(window)

    window.setOpacity(1)
    window.show()
  }

  /**
   * If the cursor is on a different display than the quick window, move the window
   * to the center of the cursor's display. setPosition + setBounds works around an
   * Electron scale-factor bug between displays.
   */
  private repositionToCursorDisplay(window: BrowserWindow) {
    const bounds = window.getBounds()
    const cursorDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const windowDisplay = screen.getDisplayNearestPoint(bounds)

    if (cursorDisplay.id === windowDisplay.id) return

    const workArea = cursorDisplay.bounds
    const { width, height } = bounds
    const x = Math.round(workArea.x + (workArea.width - width) / 2)
    const y = Math.round(workArea.y + (workArea.height - height) / 2)

    window.setPosition(x, y, false)
    window.setBounds({ x, y, width, height })
  }

  public hideQuickWindow() {
    const window = this.getQuickWindow()
    if (!window) return

    if (isWin) {
      // Hide() vs minimize() on Windows: minimize avoids a visible flicker on next show
      // and skipTaskbar:true keeps it out of the taskbar. setOpacity(0) hides the
      // minimize animation entirely.
      window.setOpacity(0)
      window.minimize()
      return
    }

    if (isMac) {
      window.hide()
      const majorVersion = parseInt(process.getSystemVersion().split('.')[0], 10)
      if (majorVersion >= MACOS_AUTO_FOCUS_VERSION) {
        // macOS 26+ already returns focus to the previous foreground app on hide.
        return
      }
      // On older macOS, hide() leaves us as the frontmost app; app.hide() returns
      // focus to whatever was focused before the quick window — but only if THAT
      // window was not our own mainWindow (else we hide the whole app needlessly).
      if (!this.wasMainWindowFocused) {
        app.hide()
      }
      return
    }

    window.hide()
  }

  /**
   * Behavior change vs. legacy: this is now a hide(), not a destroy. The quick window
   * is a high-frequency toggle surface; destroy + recreate would cause a blank-flash
   * on next show (loadURL is async and ready-to-show races the show() call) and waste
   * the preload work. The two renderer call sites (settings panel toggles) only need
   * the window to disappear — hide() satisfies that. Final teardown happens in
   * WindowManager.onDestroy() at app quit.
   */
  public closeQuickWindow() {
    this.getQuickWindow()?.hide()
  }

  public toggleQuickWindow() {
    const window = this.getQuickWindow()
    if (window?.isVisible()) {
      this.hideQuickWindow()
      return
    }
    this.showQuickWindow()
  }

  public setPinQuickWindow(isPinned: boolean) {
    this.isPinnedQuickWindow = isPinned
  }
}
