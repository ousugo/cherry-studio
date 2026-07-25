import type { Tab } from '@shared/data/cache/cacheValueTypes'

class SelectionQuoteService {
  private pendingQuotes = new Map<string, string>()

  store(requestId: string, text: string): void {
    this.pendingQuotes.set(requestId, text)
  }

  take(requestId: string | undefined): string | undefined {
    if (!requestId) return undefined

    const text = this.pendingQuotes.get(requestId)
    this.pendingQuotes.delete(requestId)
    return text
  }
}

export const selectionQuoteService = new SelectionQuoteService()

function isUsableChatTab(tab: Tab | undefined): tab is Tab {
  if (!tab || tab.type !== 'route') return false
  const url = new URL(tab.url, 'https://www.cherry-ai.com')
  return url.pathname === '/app/chat' && url.searchParams.get('view') !== 'message'
}

export function findSelectionQuoteTargetTab(tabs: Tab[], activeTab: Tab | undefined): Tab | undefined {
  if (isUsableChatTab(activeTab)) return activeTab

  return tabs
    .filter(isUsableChatTab)
    .toSorted((left, right) => (right.lastAccessTime ?? 0) - (left.lastAccessTime ?? 0))[0]
}

type SelectionQuoteNavigation = {
  activeTab: Tab | undefined
  openTab: (url: string, options: { forceNew: true }) => string
  requestId: string
  setActiveTab: (id: string) => void
  tabs: Tab[]
  updateTab: (id: string, updates: Partial<Tab>) => void
}

export function routeSelectionQuoteToChat({
  activeTab,
  openTab,
  requestId,
  setActiveTab,
  tabs,
  updateTab
}: SelectionQuoteNavigation): void {
  const targetTab = findSelectionQuoteTargetTab(tabs, activeTab)
  if (!targetTab) {
    openTab(`/app/chat?quoteRequestId=${encodeURIComponent(requestId)}`, { forceNew: true })
    return
  }

  const targetUrl = new URL(targetTab.url, 'https://www.cherry-ai.com')
  targetUrl.searchParams.set('quoteRequestId', requestId)
  updateTab(targetTab.id, { url: `${targetUrl.pathname}${targetUrl.search}` })
  setActiveTab(targetTab.id)
}
