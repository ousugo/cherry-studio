import { emitResourceListReveal } from '@renderer/components/chat/resources/resourceListRevealEvents'
import {
  buildSidebarAppOpenMetadata,
  getSidebarApp,
  getSidebarAppTabInstanceKey,
  tabBelongsToApp
} from '@renderer/config/sidebar'
import { useOptionalTabsContext } from '@renderer/context/TabsContext'
import type { SidebarIcon } from '@shared/data/preference/preferenceTypes'
import { useMemo } from 'react'

export interface ConversationNavigation {
  /**
   * Focus the tab already showing conversation `key`; returns true if one was focused.
   * `excludeTabId` skips a tab (the caller's own) so an in-page click can fall through
   * to navigating the current tab instead of bouncing to itself.
   */
  focusExistingTab: (key: string, options?: { excludeTabId?: string }) => boolean
  /** Focus the tab showing `key`, else open a new base-route tab with instance metadata. */
  openConversationTab: (key: string, title?: string) => string | undefined
}

/**
 * Single boundary for "navigate to a conversation tab" intents (chat topic / agent
 * session). Built on the SIDEBAR_APPS registry's identity↔url mapping (`instanceKey`),
 * so pages and lists stop touching the tabs context, `openTab`, or url helpers directly.
 *
 * Degrades to no-ops when there is no TabsProvider (tests, detached popups) or when the
 * app has no `instanceKey`.
 */
export function useConversationNavigation(appId: SidebarIcon): ConversationNavigation {
  const tabs = useOptionalTabsContext()

  return useMemo<ConversationNavigation>(() => {
    const app = getSidebarApp(appId)
    const instanceKey = app?.instanceKey

    const findTabId = (key: string, excludeTabId?: string): string | undefined =>
      tabs && app && instanceKey
        ? tabs.tabs.find(
            (t) =>
              t.type === 'route' &&
              t.id !== excludeTabId &&
              tabBelongsToApp(app, t.url) &&
              getSidebarAppTabInstanceKey(app, t) === key
          )?.id
        : undefined

    const focusExistingTab: ConversationNavigation['focusExistingTab'] = (key, options) => {
      const id = findTabId(key, options?.excludeTabId)
      if (id && tabs) {
        tabs.setActiveTab(id)
        if (appId === 'assistants' || appId === 'agents') {
          emitResourceListReveal({ source: appId, tabId: id })
        }
        return true
      }
      return false
    }

    const openConversationTab: ConversationNavigation['openConversationTab'] = (key, title) => {
      if (!tabs || !app || !instanceKey) return
      if (focusExistingTab(key)) return
      const metadata = buildSidebarAppOpenMetadata(app, key)
      const openedId = tabs.openTab(app.routePrefix, { forceNew: true, title, ...(metadata && { metadata }) })
      if (openedId && (appId === 'assistants' || appId === 'agents')) {
        emitResourceListReveal({ source: appId, tabId: openedId })
      }
      return openedId
    }

    return {
      focusExistingTab,
      openConversationTab
    }
  }, [appId, tabs])
}
