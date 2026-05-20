import { render, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { ComposerToolLauncher } from '../toolLauncher'
import type { ToolRenderContext } from '../tools/types'

const { mockGetToolsForScope } = vi.hoisted(() => ({
  mockGetToolsForScope: vi.fn()
}))

vi.mock('@renderer/components/chat/composer/tools', () => ({}))

vi.mock('@renderer/components/chat/composer/tools/types', () => ({
  TopicType: {
    Chat: 'chat',
    Session: 'session'
  },
  getToolsForScope: (...args: unknown[]) => mockGetToolsForScope(...args)
}))

vi.mock('@renderer/components/QuickPanel', () => ({
  QuickPanelReservedSymbol: {
    Root: 'root'
  },
  useQuickPanel: () => ({
    close: vi.fn(),
    isVisible: false,
    open: vi.fn(),
    symbol: '',
    updateList: vi.fn()
  })
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: () => ({ provider: { id: 'provider-1' } })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import {
  ComposerToolRuntimeHost,
  ComposerToolRuntimeProvider,
  useComposerToolLauncherActions,
  useComposerToolLauncherController
} from '../ComposerToolRuntime'
import { TopicType } from '../tools/types'

const assistant = {
  id: 'assistant-1',
  name: 'Assistant',
  settings: {},
  mcpServerIds: [],
  knowledgeBaseIds: []
} as any

const model = {
  id: 'provider-1::model-1',
  providerId: 'provider-1',
  name: 'Model'
} as any

const menuLauncher: ComposerToolLauncher = {
  id: 'fake-menu',
  kind: 'command',
  label: 'Fake menu',
  icon: 'fake'
}

const runtimeLauncher: ComposerToolLauncher = {
  id: 'fake-runtime',
  kind: 'command',
  label: 'Fake runtime',
  icon: 'fake'
}

const LauncherObserver = ({ onSnapshot }: { onSnapshot: (ids: string[]) => void }) => {
  const { getLaunchers } = useComposerToolLauncherController()

  useEffect(() => {
    onSnapshot(getLaunchers().map((launcher) => launcher.id))
  }, [getLaunchers, onSnapshot])

  return null
}

const LauncherActionReader = ({
  onRender,
  readRef
}: {
  onRender: () => void
  readRef: { current: () => string[] }
}) => {
  const { getLaunchers } = useComposerToolLauncherActions()
  onRender()
  readRef.current = () => getLaunchers().map((launcher) => launcher.id)
  return null
}

describe('ComposerToolRuntimeHost', () => {
  it('does not re-register tools when launcher registry updates its version', async () => {
    const createItems = vi.fn(() => [menuLauncher])
    let runtimeRegisterCount = 0

    const Runtime = ({ context }: { context: ToolRenderContext<readonly ['isExpanded'], readonly []> }) => {
      useEffect(() => {
        runtimeRegisterCount += 1
        return context.launcher.registerLaunchers([runtimeLauncher])
      }, [context.launcher])

      return null
    }

    mockGetToolsForScope.mockReturnValue([
      {
        key: 'fake-menu-tool',
        label: 'Fake menu tool',
        composer: {
          menuItems: { createItems }
        }
      },
      {
        key: 'fake-runtime-tool',
        label: 'Fake runtime tool',
        dependencies: {
          state: ['isExpanded']
        },
        composer: {
          runtime: Runtime
        }
      }
    ])

    const onSnapshot = vi.fn()
    const onNonReactiveRender = vi.fn()
    const readLaunchersRef = { current: () => [] as string[] }

    render(
      <ComposerToolRuntimeProvider
        actions={{
          addNewTopic: vi.fn(),
          onTextChange: vi.fn(),
          resizeTextArea: vi.fn(),
          toggleExpanded: vi.fn()
        }}>
        <ComposerToolRuntimeHost scope={TopicType.Chat} assistant={assistant} model={model} />
        <LauncherActionReader onRender={onNonReactiveRender} readRef={readLaunchersRef} />
        <LauncherObserver onSnapshot={onSnapshot} />
      </ComposerToolRuntimeProvider>
    )

    await waitFor(() => {
      const lastSnapshot = onSnapshot.mock.lastCall?.[0]
      expect(lastSnapshot).toHaveLength(2)
      expect(lastSnapshot).toEqual(expect.arrayContaining(['fake-menu', 'fake-runtime']))
    })
    expect(readLaunchersRef.current()).toEqual(expect.arrayContaining(['fake-menu', 'fake-runtime']))
    expect(onNonReactiveRender).toHaveBeenCalledTimes(1)
    expect(createItems).toHaveBeenCalledTimes(1)
    expect(runtimeRegisterCount).toBe(1)
  })
})
