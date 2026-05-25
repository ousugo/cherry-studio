/**
 * Internal hooks for the markdown composite.
 *
 * `useAnimatePluginHandle` owns the per-`id` `createAnimatePlugin` lifecycle.
 * Streamdown ships an animate plugin behind the `animated` prop, but that
 * surface recreates the plugin every render so already-rendered text gets
 * re-wrapped in `<span data-sd-animate>` on each chunk → visible re-fade
 * whenever the AST changes shape mid-stream (e.g. `**bold` → `<strong>`).
 *
 * The fix is to create the plugin once per message-block `id`, pass it
 * through `rehypePlugins` ourselves, and call
 * `setPrevContentLength(getLastRenderCharCount())` AFTER every render so the
 * next pass skips anything already animated. That is Streamdown's documented
 * escape hatch.
 */

import { useEffect, useLayoutEffect, useRef } from 'react'
import { type AnimateOptions, createAnimatePlugin } from 'streamdown'

type AnimatePlugin = ReturnType<typeof createAnimatePlugin>

const DEFAULT_OPTIONS: AnimateOptions = {
  animation: 'blurIn',
  duration: 250,
  easing: 'ease-out'
}

export interface AnimatePluginHandle {
  plugin: AnimatePlugin
  /** Call after each render commits to mark "already animated" characters. */
  commit: () => void
  /** Reset when the message-block id changes (drop old plugin instance). */
  reset: () => void
}

/**
 * Owns a single `AnimatePlugin` instance per `(id, options)` pair. Returns
 * the plugin (whose `rehypePlugin` you splice into `rehypePlugins`) and a
 * `commit()` callback the streaming wrapper invokes in a `useLayoutEffect`
 * keyed on `children`. When `id` changes (different message block), the
 * plugin is rebuilt so a brand-new block doesn't inherit the previous
 * block's "already animated" counter.
 */
export function useAnimatePluginHandle(id: string, options?: AnimateOptions): AnimatePluginHandle {
  const optionsRef = useRef(options)
  optionsRef.current = options

  const idRef = useRef(id)
  const pluginRef = useRef<AnimatePlugin | null>(null)

  if (pluginRef.current === null || idRef.current !== id) {
    pluginRef.current = createAnimatePlugin({ ...DEFAULT_OPTIONS, ...optionsRef.current })
    idRef.current = id
  }

  // Drop the plugin when the host unmounts so the closure (which holds
  // counter state) does not leak across remounts in dev / Strict mode.
  useEffect(() => {
    return () => {
      pluginRef.current = null
    }
  }, [])

  return {
    plugin: pluginRef.current,
    commit() {
      const p = pluginRef.current
      if (!p) return
      p.setPrevContentLength(p.getLastRenderCharCount())
    },
    reset() {
      pluginRef.current = null
    }
  }
}

/**
 * Layout-effect helper for streaming wrappers: marks already-rendered text
 * as "do not re-animate" after every commit where the source content changed.
 */
export function useCommitAnimateAfterRender(handle: AnimatePluginHandle, content: string): void {
  useLayoutEffect(() => {
    handle.commit()
  }, [handle, content])
}
