import { act, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ComposerSurface, { type ComposerSurfaceActions, type ComposerSurfaceProps } from '../ComposerSurface'

const mocks = vi.hoisted(() => ({
  editorOptions: undefined as any,
  actions: undefined as ComposerSurfaceActions | undefined
}))

vi.mock('@cherrystudio/ui', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('@cherrystudio/ui/lib/utils', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' ')
}))

vi.mock('@renderer/components/chat/layout/ChatLayoutModeContext', () => ({
  useChatLayoutMode: () => ({ forceWideLayout: false })
}))

vi.mock('@renderer/components/chat/layout/NarrowLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <div data-testid="narrow-layout">{children}</div>
}))

vi.mock('@renderer/components/QuickPanel', () => ({
  QuickPanelReservedSymbol: {
    Root: 'root'
  },
  QuickPanelView: () => null,
  useQuickPanel: () => ({
    close: vi.fn(),
    isVisible: false,
    open: vi.fn(),
    symbol: '',
    updateList: vi.fn()
  })
}))

vi.mock('@renderer/components/RichEditor/useRichTextEditorKernel', () => ({
  useRichTextEditorKernel: (options: any) => {
    mocks.editorOptions = options
    return {
      isDestroyed: false,
      commands: {
        focus: vi.fn(),
        setContent: vi.fn()
      },
      chain: () => ({
        focus: () => ({
          insertContent: () => ({ run: vi.fn() }),
          insertComposerToken: () => ({ insertContent: () => ({ run: vi.fn() }) })
        })
      }),
      view: {
        composing: false
      },
      state: {
        doc: {
          descendants: vi.fn()
        }
      }
    }
  }
}))

vi.mock('@tiptap/react', () => ({
  EditorContent: ({ style, onFocus }: { style?: React.CSSProperties; onFocus?: () => void }) => (
    <div data-testid="editor-content" style={style} onFocus={onFocus}>
      <div
        data-testid="composer-editor"
        className={mocks.editorOptions?.editorProps?.attributes?.class}
        data-editor-style={mocks.editorOptions?.editorProps?.attributes?.style}
      />
    </div>
  )
}))

vi.mock('@renderer/components/TranslateButton', () => ({
  default: () => <button type="button">translate</button>
}))

vi.mock('@renderer/pages/home/Inputbar/SendMessageButton', () => ({
  default: () => <button type="button">send</button>
}))

vi.mock('@renderer/data/hooks/usePreference', () => ({
  usePreference: (key: string) => {
    const values: Record<string, unknown> = {
      'chat.input.paste_long_text_as_file': false,
      'chat.input.paste_long_text_threshold': 1000,
      'chat.input.send_message_shortcut': 'Enter'
    }
    return [values[key]]
  }
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({
    setTimeoutTimer: vi.fn()
  })
}))

vi.mock('@renderer/pages/home/Inputbar/hooks/useFileDragDrop', () => ({
  useFileDragDrop: () => ({
    handleDragEnter: vi.fn(),
    handleDragLeave: vi.fn(),
    handleDragOver: vi.fn(),
    handleDrop: vi.fn(),
    isDragging: false
  })
}))

vi.mock('@renderer/pages/home/Inputbar/hooks/usePasteHandler', () => ({
  usePasteHandler: () => ({
    handlePaste: vi.fn()
  })
}))

vi.mock('@renderer/services/PasteService', () => ({
  default: {
    init: vi.fn(),
    registerHandler: vi.fn(),
    unregisterHandler: vi.fn(),
    setLastFocusedComponent: vi.fn()
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('../composerPreset', () => ({
  createComposerEditorPreset: () => []
}))

const baseProps: ComposerSurfaceProps = {
  text: '',
  onTextChange: vi.fn(),
  tokens: [],
  managedTokenKinds: [],
  onTokensChange: vi.fn(),
  placeholder: 'Message',
  sendDisabled: false,
  isLoading: false,
  onSendDraft: vi.fn(),
  onPause: vi.fn(),
  supportedExts: [],
  setFiles: vi.fn(),
  filesCount: 0,
  isExpanded: false,
  onExpandedChange: vi.fn(),
  quickPanelEnabled: false,
  enableQuickPanelTriggers: false,
  enableDragDrop: false,
  enableSpellCheck: false,
  fontSize: 14,
  narrowMode: false
}

const Harness = () => {
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <ComposerSurface
      {...baseProps}
      isExpanded={isExpanded}
      onExpandedChange={setIsExpanded}
      onActionsChange={(actions) => {
        mocks.actions = actions
      }}
    />
  )
}

describe('ComposerSurface', () => {
  beforeEach(() => {
    mocks.editorOptions = undefined
    mocks.actions = undefined
  })

  it('uses a viewport-relative max height and only fixes height when expanded', async () => {
    render(<Harness />)

    const editorContent = screen.getByTestId('editor-content')
    const editor = screen.getByTestId('composer-editor')
    const editorContainer = editorContent.parentElement

    expect(editorContainer).toHaveStyle({ minHeight: '46px' })
    expect(editorContainer).not.toHaveStyle({ height: 'max(220px, 50vh)' })
    expect(editorContent).not.toHaveStyle({ height: '100%' })
    expect(editor.getAttribute('data-editor-style')).toContain('max-height: max(220px, 50vh)')
    expect(editor.className).toContain('max-h-[max(220px,50vh)]')
    expect(editor.className).not.toContain('max-h-[500px]')

    await waitFor(() => expect(mocks.actions).toBeDefined())
    act(() => {
      mocks.actions?.toggleExpanded(true)
    })

    expect(editorContainer).toHaveStyle({ height: 'max(220px, 50vh)', overflow: 'hidden' })
    expect(editorContent).toHaveStyle({ height: '100%' })
    expect(screen.getByTestId('composer-editor').className).toContain('h-full')
    expect(screen.getByTestId('composer-editor').getAttribute('data-editor-style')).toContain('height: 100%')
    expect(screen.getByTestId('composer-editor').getAttribute('data-editor-style')).toContain('overflow-y: auto')
  })
})
