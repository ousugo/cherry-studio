import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ComposerSurface, { type ComposerSurfaceActions, type ComposerSurfaceProps } from '../ComposerSurface'

const mocks = vi.hoisted(() => ({
  editorOptions: undefined as any,
  actions: undefined as ComposerSurfaceActions | undefined,
  editorViewComposing: false,
  insertContent: vi.fn(),
  setContent: vi.fn(),
  setNodeSelection: vi.fn(),
  chainRun: vi.fn(),
  docDescendants: vi.fn(),
  dispatch: vi.fn(),
  editorPresetOptions: undefined as any,
  quickPanelClose: vi.fn(),
  quickPanelDispatchKeyDown: vi.fn(),
  quickPanelIsVisible: false,
  quickPanelOpen: vi.fn(),
  quickPanelSymbol: '',
  selection: { from: 1 } as any,
  transaction: undefined as any
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({
    children,
    size: _size,
    variant: _variant,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { size?: string; variant?: string }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
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
    close: mocks.quickPanelClose,
    dispatchKeyDown: mocks.quickPanelDispatchKeyDown,
    isVisible: mocks.quickPanelIsVisible,
    open: mocks.quickPanelOpen,
    symbol: mocks.quickPanelSymbol,
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
        setContent: mocks.setContent,
        setNodeSelection: mocks.setNodeSelection
      },
      chain: () => ({
        focus: () => ({
          setNodeSelection: (...args: unknown[]) => {
            mocks.setNodeSelection(...args)
            return { run: mocks.chainRun }
          },
          insertContent: (...args: unknown[]) => {
            mocks.insertContent(...args)
            return { run: vi.fn() }
          },
          insertComposerToken: () => ({ insertContent: () => ({ run: vi.fn() }) })
        })
      }),
      view: {
        get composing() {
          return mocks.editorViewComposing
        },
        dispatch: mocks.dispatch
      },
      state: {
        get selection() {
          return mocks.selection
        },
        get tr() {
          return mocks.transaction
        },
        doc: {
          descendants: mocks.docDescendants
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
  createComposerEditorPreset: (options: any) => {
    mocks.editorPresetOptions = options
    return []
  }
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
    mocks.editorViewComposing = false
    mocks.insertContent.mockReset()
    mocks.setContent.mockReset()
    mocks.setNodeSelection.mockReset()
    mocks.chainRun.mockReset()
    mocks.docDescendants.mockReset()
    mocks.dispatch.mockReset()
    mocks.editorPresetOptions = undefined
    mocks.quickPanelClose.mockReset()
    mocks.quickPanelDispatchKeyDown.mockReset()
    mocks.quickPanelIsVisible = false
    mocks.quickPanelOpen.mockReset()
    mocks.quickPanelSymbol = ''
    mocks.selection = { from: 1 }
    mocks.transaction = {
      doc: {},
      setNodeMarkup: vi.fn(() => mocks.transaction),
      setSelection: vi.fn(() => mocks.transaction)
    }
  })

  it('uses state-specific viewport-relative max heights and only fixes height when expanded', async () => {
    render(<Harness />)

    const editorContent = screen.getByTestId('editor-content')
    const editor = screen.getByTestId('composer-editor')
    const editorContainer = editorContent.parentElement

    expect(editorContainer).toHaveStyle({ minHeight: '46px' })
    expect(editorContainer).not.toHaveStyle({ height: 'max(220px, 50vh)' })
    expect(editorContent).not.toHaveStyle({ height: '100%' })
    expect(editor.getAttribute('data-editor-style')).toContain('max-height: max(220px, 40vh)')
    expect(editor.className).toContain('max-h-[max(220px,40vh)]')
    expect(editor.className).not.toContain('max-h-[max(220px,50vh)]')
    expect(editor.className).not.toContain('max-h-[500px]')

    fireEvent.click(screen.getByRole('button', { name: 'chat.input.expand' }))

    expect(editorContainer).toHaveStyle({ height: 'max(220px, 50vh)', overflow: 'hidden' })
    expect(editorContent).toHaveStyle({ height: '100%' })
    expect(screen.getByTestId('composer-editor').className).toContain('max-h-[max(220px,50vh)]')
    expect(screen.getByTestId('composer-editor').className).toContain('h-full')
    expect(screen.getByTestId('composer-editor').getAttribute('data-editor-style')).toContain(
      'max-height: max(220px, 50vh)'
    )
    expect(screen.getByTestId('composer-editor').getAttribute('data-editor-style')).toContain('height: 100%')
    expect(screen.getByTestId('composer-editor').getAttribute('data-editor-style')).toContain('overflow-y: auto')
  })

  it('renders the expand control immediately before translate', () => {
    render(<Harness />)

    const expandButton = screen.getByRole('button', { name: 'chat.input.expand' })
    const translateButton = screen.getByRole('button', { name: 'translate' })

    expect(expandButton.nextElementSibling).toBe(translateButton)

    fireEvent.click(expandButton)

    expect(screen.getByRole('button', { name: 'chat.input.collapse' })).toBeInTheDocument()
  })

  it('sets quick phrase text as prompt variable token content', async () => {
    render(<Harness />)

    await waitFor(() => expect(mocks.actions).toBeDefined())
    act(() => {
      mocks.actions?.onTextChange('plan ${from}')
    })

    expect(mocks.setContent).toHaveBeenCalledWith(
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'plan ' },
              {
                type: 'composerToken',
                attrs: expect.objectContaining({
                  kind: 'promptVariable',
                  label: 'from',
                  promptText: '${from}'
                })
              }
            ]
          }
        ]
      },
      { emitUpdate: false }
    )
  })

  it('uses Tab to select the next prompt variable token', async () => {
    mocks.docDescendants.mockImplementation((visit: (node: unknown, position: number) => void) => {
      visit(
        {
          type: { name: 'composerToken' },
          attrs: {
            id: 'prompt-variable:0:from',
            kind: 'promptVariable',
            label: 'from',
            promptText: '${from}'
          }
        },
        5
      )
    })
    render(<Harness />)

    await waitFor(() => expect(mocks.actions).toBeDefined())
    const preventDefault = vi.fn()
    const stopPropagation = vi.fn()
    const handled = mocks.editorOptions.editorProps.handleKeyDown(null, {
      key: 'Tab',
      shiftKey: false,
      isComposing: false,
      preventDefault,
      stopPropagation
    })

    expect(handled).toBe(true)
    expect(preventDefault).toHaveBeenCalled()
    expect(stopPropagation).toHaveBeenCalled()
    expect(mocks.setNodeSelection).toHaveBeenCalledWith(5)
  })

  it('commits IME composition to a selected prompt variable once composition ends', async () => {
    mocks.selection = {
      from: 5,
      node: {
        type: { name: 'composerToken' },
        attrs: {
          id: 'prompt-variable:0:city',
          kind: 'promptVariable',
          label: 'city',
          promptText: '${city}'
        }
      }
    }
    render(<Harness />)

    await waitFor(() => expect(mocks.editorOptions).toBeDefined())
    expect(mocks.editorOptions.editorProps.handleDOMEvents.compositionstart()).toBe(false)

    mocks.editorViewComposing = true
    expect(mocks.editorOptions.editorProps.handleTextInput(null, 5, 6, 'sh')).toBe(true)
    expect(mocks.transaction.setNodeMarkup).not.toHaveBeenCalled()

    mocks.editorViewComposing = false
    expect(mocks.editorOptions.editorProps.handleDOMEvents.compositionend(null, { data: '上海' })).toBe(true)
    expect(mocks.transaction.setNodeMarkup).toHaveBeenCalledWith(
      5,
      undefined,
      expect.objectContaining({
        label: '上海',
        promptText: '上海'
      })
    )
    expect(mocks.dispatch).toHaveBeenCalledWith(mocks.transaction)

    expect(mocks.editorOptions.editorProps.handleTextInput(null, 5, 6, '上海')).toBe(true)
    expect(mocks.transaction.setNodeMarkup).toHaveBeenCalledTimes(1)
  })

  it('opens the QuickPanel root from the slash suggestion bridge', async () => {
    render(
      <ComposerSurface
        {...baseProps}
        quickPanelEnabled
        enableQuickPanelTriggers
        getToolLaunchers={() => [
          {
            id: 'generate-image',
            kind: 'command',
            label: 'Generate image',
            disabled: true,
            disabledReason: 'The model does not support generating images.',
            icon: 'image'
          }
        ]}
      />
    )

    await waitFor(() => expect(mocks.editorPresetOptions).toBeDefined())

    const rootSource = mocks.editorPresetOptions.suggestionSources[0]
    expect(rootSource.renderMode).toBe('headless')
    expect(rootSource.allowedPrefixes).toEqual([' ', '\n', '\t'])
    expect(rootSource.items({ query: 'image' })).toEqual([])

    rootSource.onActiveChange({
      editor: {
        state: {
          doc: {
            textBetween: vi.fn(() => '')
          }
        }
      },
      range: { from: 1, to: 6 },
      query: 'image',
      text: '/image',
      items: []
    })

    expect(mocks.quickPanelOpen).toHaveBeenCalledWith({
      title: 'settings.quickPanel.title',
      list: [
        expect.objectContaining({
          label: 'Generate image',
          description: 'The model does not support generating images.',
          disabled: true,
          filterText: expect.stringContaining('The model does not support generating images.')
        })
      ],
      symbol: 'root',
      queryAnchor: 0,
      triggerInfo: {
        type: 'input',
        position: 0,
        originalText: '/image'
      }
    })

    const event = new KeyboardEvent('keydown', { key: 'Enter' })
    expect(rootSource.onKeyDown({ event })).toBe(false)
    expect(mocks.quickPanelDispatchKeyDown).toHaveBeenCalledWith(event)
  })

  it('opens the QuickPanel root when slash follows whitespace', async () => {
    render(<ComposerSurface {...baseProps} quickPanelEnabled enableQuickPanelTriggers getToolLaunchers={() => []} />)

    await waitFor(() => expect(mocks.editorPresetOptions).toBeDefined())

    const rootSource = mocks.editorPresetOptions.suggestionSources[0]
    rootSource.onActiveChange({
      editor: {
        state: {
          doc: {
            textBetween: vi.fn(() => 'hello ')
          }
        }
      },
      range: { from: 7, to: 8 },
      query: '',
      text: '/',
      items: []
    })

    expect(mocks.quickPanelOpen).toHaveBeenCalledWith(expect.objectContaining({ queryAnchor: 6, symbol: 'root' }))
  })

  it('does not open the QuickPanel root when slash is attached to previous text', async () => {
    render(<ComposerSurface {...baseProps} quickPanelEnabled enableQuickPanelTriggers getToolLaunchers={() => []} />)

    await waitFor(() => expect(mocks.editorPresetOptions).toBeDefined())

    const rootSource = mocks.editorPresetOptions.suggestionSources[0]
    rootSource.onActiveChange({
      editor: {
        state: {
          doc: {
            textBetween: vi.fn(() => 'hello')
          }
        }
      },
      range: { from: 6, to: 7 },
      query: '',
      text: '/',
      items: []
    })

    expect(mocks.quickPanelOpen).not.toHaveBeenCalled()
  })

  it('does not open the QuickPanel root when cursor is not at the end of the slash query', async () => {
    render(<ComposerSurface {...baseProps} quickPanelEnabled enableQuickPanelTriggers getToolLaunchers={() => []} />)

    await waitFor(() => expect(mocks.editorPresetOptions).toBeDefined())

    const rootSource = mocks.editorPresetOptions.suggestionSources[0]
    rootSource.onActiveChange({
      editor: {
        state: {
          doc: {
            textBetween: vi.fn((_from: number, to: number) => (to === 7 ? 'hello ' : 'hello /i'))
          },
          selection: {
            from: 9
          }
        }
      },
      range: { from: 7, to: 13 },
      query: 'image',
      text: '/image',
      items: []
    })

    expect(mocks.quickPanelOpen).not.toHaveBeenCalled()
  })

  it('closes the QuickPanel root when the slash suggestion exits', async () => {
    mocks.quickPanelIsVisible = true
    mocks.quickPanelSymbol = 'root'

    render(<ComposerSurface {...baseProps} quickPanelEnabled enableQuickPanelTriggers getToolLaunchers={() => []} />)

    await waitFor(() => expect(mocks.editorPresetOptions).toBeDefined())

    const rootSource = mocks.editorPresetOptions.suggestionSources[0]
    rootSource.onExit({
      editor: {
        state: {
          doc: {
            textBetween: vi.fn(() => '')
          }
        }
      },
      range: { from: 1, to: 2 },
      query: '',
      text: '/',
      items: []
    })

    await waitFor(() => expect(mocks.quickPanelClose).toHaveBeenCalledWith())
  })

  it('does not close a child panel when the slash suggestion exits', async () => {
    mocks.quickPanelIsVisible = true
    mocks.quickPanelSymbol = 'root'

    const { rerender } = render(
      <ComposerSurface {...baseProps} quickPanelEnabled enableQuickPanelTriggers getToolLaunchers={() => []} />
    )

    await waitFor(() => expect(mocks.editorPresetOptions).toBeDefined())

    const rootSource = mocks.editorPresetOptions.suggestionSources[0]
    rootSource.onExit({
      editor: {
        state: {
          doc: {
            textBetween: vi.fn(() => '')
          }
        }
      },
      range: { from: 1, to: 2 },
      query: '',
      text: '/',
      items: []
    })

    mocks.quickPanelSymbol = 'child-panel'
    rerender(<ComposerSurface {...baseProps} quickPanelEnabled enableQuickPanelTriggers getToolLaunchers={() => []} />)

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(mocks.quickPanelClose).not.toHaveBeenCalled()
  })

  it('lets the visible QuickPanel handle Enter before send-message shortcuts', async () => {
    const onSendDraft = vi.fn()
    mocks.quickPanelIsVisible = true
    mocks.quickPanelDispatchKeyDown.mockReturnValue(true)

    render(<ComposerSurface {...baseProps} onSendDraft={onSendDraft} />)

    await waitFor(() => expect(mocks.editorOptions).toBeDefined())

    const event = new KeyboardEvent('keydown', { key: 'Enter' })
    expect(mocks.editorOptions.editorProps.handleKeyDown(null, event)).toBe(true)
    expect(mocks.quickPanelDispatchKeyDown).toHaveBeenCalledWith(event)
    expect(onSendDraft).not.toHaveBeenCalled()
  })

  it('keeps the QuickPanel root as the parent when opening child panels from slash', async () => {
    const onToolLauncherSelect = vi.fn()
    render(
      <ComposerSurface
        {...baseProps}
        quickPanelEnabled
        enableQuickPanelTriggers
        onToolLauncherSelect={onToolLauncherSelect}
        getToolLaunchers={() => [
          {
            id: 'thinking',
            kind: 'group',
            label: 'Thinking',
            description: 'Reasoning controls',
            icon: 'brain',
            sources: ['popover'],
            submenu: [
              {
                id: 'thinking-low',
                kind: 'command',
                label: 'Low',
                description: 'Use low reasoning',
                icon: 'low',
                sources: ['root-panel']
              }
            ]
          },
          {
            id: 'knowledge-base',
            kind: 'command',
            label: 'Knowledge Base',
            description: 'Use configured knowledge',
            icon: 'kb',
            sources: ['root-panel']
          }
        ]}
      />
    )

    await waitFor(() => expect(mocks.editorPresetOptions).toBeDefined())

    const rootSource = mocks.editorPresetOptions.suggestionSources[0]
    rootSource.onActiveChange({
      editor: {
        state: {
          doc: {
            textBetween: vi.fn(() => '')
          }
        }
      },
      range: { from: 1, to: 4 },
      query: 'low',
      text: '/low',
      items: []
    })

    const rootPanelOptions = mocks.quickPanelOpen.mock.calls[0][0]
    expect(rootPanelOptions).toMatchObject({
      title: 'settings.quickPanel.title',
      symbol: 'root',
      queryAnchor: 0,
      triggerInfo: {
        type: 'input',
        position: 0,
        originalText: '/low'
      }
    })
    expect(rootPanelOptions.list).toEqual([
      expect.objectContaining({
        label: 'Thinking',
        isMenu: true,
        filterText: expect.stringContaining('Low')
      }),
      expect.objectContaining({
        label: 'Knowledge Base'
      })
    ])

    rootPanelOptions.list[0].action({
      action: 'enter',
      context: rootPanelOptions,
      item: rootPanelOptions.list[0],
      parentPanel: rootPanelOptions,
      queryAnchor: 0,
      searchText: 'low'
    })

    expect(onToolLauncherSelect).not.toHaveBeenCalled()
    expect(mocks.quickPanelOpen).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: 'Thinking',
        symbol: 'thinking',
        queryAnchor: 0,
        parentPanel: expect.objectContaining({
          title: 'settings.quickPanel.title',
          symbol: 'root',
          queryAnchor: 0,
          triggerInfo: {
            type: 'input',
            position: 0,
            originalText: '/low'
          },
          list: expect.arrayContaining([
            expect.objectContaining({ label: 'Thinking' }),
            expect.objectContaining({ label: 'Knowledge Base' })
          ])
        }),
        list: [expect.objectContaining({ label: 'Low', filterText: expect.stringContaining('Low') })]
      })
    )
  })
})
