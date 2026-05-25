import type { TopicMessageFlowLiveState } from '@renderer/components/chat/messages/flow/topicMessageFlowLiveTree'
import { Shell, useShellState } from '@renderer/components/chat/panes/Shell'
import { GitBranch } from 'lucide-react'
import type { PropsWithChildren } from 'react'
import { createContext, use, useCallback, useRef, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import TopicBranchPanel from './TopicBranchPanel'

interface TopicRightPaneSurfaceProps {
  topicId: string
  topicName?: string
}

type TopicBranchLiveStateSetter = (topicId: string, state: TopicMessageFlowLiveState | null) => void

interface TopicBranchLiveStateStore {
  getSnapshot: (topicId: string) => TopicMessageFlowLiveState | null
  setSnapshot: TopicBranchLiveStateSetter
  subscribe: (topicId: string, listener: () => void) => () => void
}

function createTopicBranchLiveStateStore(): TopicBranchLiveStateStore {
  const snapshots = new Map<string, TopicMessageFlowLiveState>()
  const listeners = new Map<string, Set<() => void>>()

  const notify = (topicId: string) => {
    for (const listener of listeners.get(topicId) ?? []) listener()
  }

  return {
    getSnapshot: (topicId) => snapshots.get(topicId) ?? null,
    setSnapshot: (topicId, state) => {
      const current = snapshots.get(topicId) ?? null
      if (current === state) return
      if (state) {
        snapshots.set(topicId, state)
      } else {
        snapshots.delete(topicId)
      }
      notify(topicId)
    },
    subscribe: (topicId, listener) => {
      let topicListeners = listeners.get(topicId)
      if (!topicListeners) {
        topicListeners = new Set()
        listeners.set(topicId, topicListeners)
      }
      topicListeners.add(listener)

      return () => {
        topicListeners?.delete(listener)
        if (topicListeners?.size === 0) listeners.delete(topicId)
      }
    }
  }
}

const TopicBranchLiveStateStoreContext = createContext<TopicBranchLiveStateStore | null>(null)

function useTopicBranchLiveStateStore(): TopicBranchLiveStateStore {
  const store = use(TopicBranchLiveStateStoreContext)
  if (!store) throw new Error('useTopicBranchLiveStateStore must be used within <TopicRightPane>')
  return store
}

export function useTopicBranchLiveStateSetter(): TopicBranchLiveStateSetter {
  return useTopicBranchLiveStateStore().setSnapshot
}

function useTopicBranchLiveState(topicId: string): TopicMessageFlowLiveState | null {
  const store = useTopicBranchLiveStateStore()
  const subscribe = useCallback((listener: () => void) => store.subscribe(topicId, listener), [store, topicId])
  const getSnapshot = useCallback(() => store.getSnapshot(topicId), [store, topicId])

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

function TopicRightPaneProvider({ children }: PropsWithChildren) {
  const storeRef = useRef<TopicBranchLiveStateStore>(undefined as never)
  if (!storeRef.current) storeRef.current = createTopicBranchLiveStateStore()

  return (
    <Shell defaultTab="branch">
      <TopicBranchLiveStateStoreContext value={storeRef.current}>{children}</TopicBranchLiveStateStoreContext>
    </Shell>
  )
}

function TopicRightPaneSurface({ topicId, topicName }: TopicRightPaneSurfaceProps) {
  const { t } = useTranslation()
  const shellState = useShellState()
  const branchLiveState = useTopicBranchLiveState(topicId)
  const canvasFocusKey = `${shellState.maximized ? 'maximized' : 'docked'}:${shellState.pdfLayoutRefreshKey}`
  const canvasLayoutReady = shellState.maximized || !shellState.pdfLayoutPending

  return (
    <Shell.Tabs>
      <Shell.TabList>
        <Shell.Tab value="branch" icon={<GitBranch className="size-3.5" />}>
          {t('chat.message.flow.title')}
        </Shell.Tab>
      </Shell.TabList>
      <Shell.Panel value="branch">
        <TopicBranchPanel
          open
          topicId={topicId}
          topicName={topicName}
          liveState={branchLiveState}
          focusKey={canvasFocusKey}
          layoutReady={canvasLayoutReady}
        />
      </Shell.Panel>
    </Shell.Tabs>
  )
}

function TopicRightPaneHost(props: TopicRightPaneSurfaceProps) {
  return (
    <Shell.Host>
      <TopicRightPaneSurface {...props} />
    </Shell.Host>
  )
}

function TopicRightPaneMaximizedOverlay(props: TopicRightPaneSurfaceProps) {
  return (
    <Shell.MaximizedOverlay>
      <TopicRightPaneSurface {...props} />
    </Shell.MaximizedOverlay>
  )
}

function TopicRightPaneToggle() {
  const { t } = useTranslation()
  return <Shell.Toggle tab="branch" label={t('chat.message.flow.title')} />
}

export const TopicRightPane = Object.assign(TopicRightPaneProvider, {
  Host: TopicRightPaneHost,
  MaximizedOverlay: TopicRightPaneMaximizedOverlay,
  Toggle: TopicRightPaneToggle
})
