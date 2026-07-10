import type * as NotesQueryModule from '@renderer/hooks/useNotesQuery'
import { toast } from '@renderer/services/toast'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const noteNode = {
    id: '/notes/note.md',
    name: 'note',
    type: 'file' as const,
    treePath: '/note',
    externalPath: '/notes/note.md',
    createdAt: '',
    updatedAt: '',
    isStarred: false
  }

  return {
    currentContent: 'saved content',
    richEditorContent: 'edited rich content',
    sourceEditorContent: 'edited source content',
    mountedEditor: 'source',
    activeFilePath: '/notes/note.md',
    onMarkdownChange: undefined as ((content: string) => void) | undefined,
    editorReady: vi.fn(),
    getNode: vi.fn(),
    invalidateFileContent: vi.fn(),
    fileWrite: vi.fn(),
    addNote: vi.fn(),
    renameNode: vi.fn(),
    ipcRequest: vi.fn(),
    commandHandlers: new Map<string, { handler: () => void | Promise<void>; enabled: boolean }>(),
    isActiveTab: true,
    showWorkspace: false,
    printShortcutLabel: 'Ctrl+P',
    noteByPath: new Map(),
    patchNode: vi.fn(),
    removePath: vi.fn(),
    rewritePath: vi.fn(),
    setActiveFilePath: vi.fn(),
    settings: {
      isFullWidth: true,
      fontFamily: 'default',
      fontSize: 16,
      showTableOfContents: false,
      defaultViewMode: 'edit',
      defaultEditMode: 'source',
      showTabStatus: true
    },
    sortTree: vi.fn((nodes) => nodes),
    t: (key: string) => key,
    toggleShowWorkspace: vi.fn(),
    treeRoot: {},
    treeVersion: 0,
    projectedNodes: [noteNode],
    updateNotesPath: vi.fn(),
    updateSettings: vi.fn(),
    updateSortType: vi.fn(),
    noteNode
  }
})

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: mocks.t })
}))

vi.mock('i18next', () => {
  const i18n = {
    t: mocks.t,
    use: vi.fn(() => i18n),
    init: vi.fn(() => Promise.resolve(i18n))
  }

  return {
    default: i18n,
    t: i18n.t
  }
})

vi.mock('@cherrystudio/ui', async () => {
  const React = await import('react')
  const withoutDomOnlyProps = (props: Record<string, unknown>) => {
    const domProps = { ...props }
    delete domProps.active
    delete domProps.onOpenChange
    return domProps
  }
  const passthrough =
    (tag: string) =>
    ({ children, ...props }: any) =>
      React.createElement(tag, withoutDomOnlyProps(props), children)

  return {
    Breadcrumb: passthrough('nav'),
    BreadcrumbItem: passthrough('span'),
    BreadcrumbList: passthrough('div'),
    BreadcrumbSeparator: passthrough('span'),
    Button: ({ children, onPress, ...props }: any) =>
      React.createElement('button', { ...withoutDomOnlyProps(props), onClick: onPress ?? props.onClick }, children),
    Input: ({ ref, ...props }: any & { ref?: React.RefObject<HTMLInputElement | null> }) =>
      React.createElement('input', { ...props, ref }),
    MenuDivider: (props: any) => React.createElement('hr', props),
    MenuItem: ({ icon, label, onClick, suffix, ...props }: any) =>
      React.createElement('button', { ...withoutDomOnlyProps(props), type: 'button', onClick }, icon, label, suffix),
    MenuList: passthrough('div'),
    Popover: passthrough('div'),
    PopoverContent: passthrough('div'),
    PopoverTrigger: ({ children }: any) => React.createElement('div', { 'data-testid': 'popover-trigger' }, children),
    RowFlex: passthrough('div'),
    Tooltip: ({ children }: any) => children
  }
})

vi.mock('@renderer/components/popups/ContentPopup', () => ({
  default: {
    show: vi.fn()
  }
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: mocks.ipcRequest,
    on: vi.fn()
  }
}))

vi.mock('@renderer/data/hooks/useCache', () => ({
  useCache: () => [mocks.activeFilePath, mocks.setActiveFilePath]
}))

vi.mock('@renderer/hooks/useShowWorkspace', () => ({
  useShowWorkspace: () => ({
    showWorkspace: mocks.showWorkspace,
    toggleShowWorkspace: mocks.toggleShowWorkspace
  })
}))

vi.mock('@renderer/hooks/useNotesSettings', () => ({
  useNotesSettings: () => ({
    settings: mocks.settings,
    updateSettings: mocks.updateSettings,
    notesPath: '/notes',
    updateNotesPath: mocks.updateNotesPath,
    sortType: 'sort_a2z',
    updateSortType: mocks.updateSortType
  })
}))

vi.mock('@renderer/hooks/tab', () => ({
  useIsActiveTab: () => mocks.isActiveTab
}))

vi.mock('@renderer/hooks/command', () => ({
  useCommandHandler: (command: string, handler: () => void | Promise<void>, options?: { enabled?: boolean }) => {
    mocks.commandHandlers.set(command, {
      handler,
      enabled: options?.enabled !== false
    })
  },
  useResolvedCommand: (command: string) => ({
    id: command,
    label: command,
    enabled: true,
    shortcutLabel: command === 'app.print' ? mocks.printShortcutLabel : '',
    execute: vi.fn()
  })
}))

vi.mock('@renderer/hooks/useDirectoryTree', () => ({
  useDirectoryTree: () => ({
    root: mocks.treeRoot,
    isLoading: false,
    error: null,
    version: mocks.treeVersion,
    treeId: null,
    getNode: mocks.getNode
  })
}))

vi.mock('@renderer/hooks/useNote', () => ({
  useNote: () => ({
    noteByPath: mocks.noteByPath,
    patchNode: mocks.patchNode,
    removePath: mocks.removePath,
    rewritePath: mocks.rewritePath
  })
}))

vi.mock('@renderer/hooks/useNotesQuery', async (importOriginal) => {
  const actual = await importOriginal<typeof NotesQueryModule>()

  return {
    ...actual,
    useFileContent: () => ({ data: mocks.currentContent, error: undefined }),
    useFileContentSync: () => ({ invalidateFileContent: mocks.invalidateFileContent })
  }
})

vi.mock('@renderer/services/NotesService', () => ({
  projectNotesTree: vi.fn(() => mocks.projectedNodes),
  sortTree: mocks.sortTree,
  addDir: vi.fn(),
  addNote: mocks.addNote,
  delNode: vi.fn(),
  renameNode: mocks.renameNode,
  resolveNotesPath: vi.fn(async (path: string) => ({ path, isFallback: false })),
  uploadNotes: vi.fn()
}))

vi.mock('../NotesEditor', async () => {
  const React = await import('react')

  function MockNotesEditor({ codeEditorRef, editorRef, onMarkdownChange }: any) {
    React.useEffect(() => {
      mocks.onMarkdownChange = onMarkdownChange
      codeEditorRef.current =
        mocks.mountedEditor === 'rich'
          ? null
          : {
              getContent: () => mocks.sourceEditorContent,
              scrollToLine: vi.fn()
            }
      editorRef.current =
        mocks.mountedEditor === 'source'
          ? null
          : {
              getContent: () => mocks.richEditorContent,
              getMarkdown: () => mocks.richEditorContent,
              setMarkdown: (content: string) => {
                mocks.richEditorContent = content
              },
              scrollToLine: vi.fn()
            }
      if (mocks.mountedEditor !== 'rich') {
        onMarkdownChange(mocks.sourceEditorContent)
      } else {
        onMarkdownChange(mocks.richEditorContent)
      }
      mocks.editorReady()

      return () => {
        mocks.onMarkdownChange = undefined
        codeEditorRef.current = null
        editorRef.current = null
      }
    }, [codeEditorRef, editorRef, onMarkdownChange])

    return React.createElement('div', { 'data-testid': 'notes-editor' })
  }

  return {
    default: MockNotesEditor
  }
})

vi.mock('../NotesSettings', () => ({
  default: () => null
}))

vi.mock('../NotesSidebar', () => ({
  default: ({ onCreateNote }: { onCreateNote: (name: string) => void }) => (
    <button type="button" onClick={() => onCreateNote('notes.untitled_note')}>
      create-note
    </button>
  )
}))

import NotesPage from '../NotesPage'

describe('NotesPage print payloads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.currentContent = 'saved content'
    mocks.richEditorContent = 'edited rich content'
    mocks.sourceEditorContent = 'edited source content'
    mocks.mountedEditor = 'source'
    mocks.activeFilePath = '/notes/note.md'
    mocks.onMarkdownChange = undefined
    Object.assign(mocks.noteNode, {
      id: '/notes/note.md',
      name: 'note',
      treePath: '/note',
      externalPath: '/notes/note.md'
    })
    mocks.treeVersion = 0
    mocks.projectedNodes = [mocks.noteNode]
    mocks.settings.defaultEditMode = 'source'
    mocks.settings.defaultViewMode = 'edit'
    mocks.ipcRequest.mockImplementation((route: string) => {
      if (route === 'app.get_info') return Promise.resolve({ notesPath: '/notes' })
      if (route === 'app.set_spell_check_enabled') return Promise.resolve(undefined)
      return Promise.resolve(true)
    })
    mocks.commandHandlers.clear()
    mocks.isActiveTab = true
    mocks.showWorkspace = false
    mocks.printShortcutLabel = 'Ctrl+P'
    mocks.addNote.mockResolvedValue({ path: '/notes/notes.untitled_note.md', name: 'notes.untitled_note' })
    mocks.renameNode.mockResolvedValue({ path: '/notes/renamed.md', name: 'renamed' })

    Object.assign(window, {
      api: {
        export: {
          toWord: vi.fn().mockResolvedValue(undefined)
        },
        file: {
          write: mocks.fileWrite.mockResolvedValue(undefined),
          listDirectory: vi.fn().mockResolvedValue([])
        },
        tree: {
          onMutation: vi.fn(() => vi.fn()),
          dispose: vi.fn().mockResolvedValue(undefined)
        }
      }
    })
  })

  it('renames a newly created note from its first line after saving', async () => {
    mocks.showWorkspace = true
    mocks.activeFilePath = '/notes/notes.untitled_note.md'
    mocks.currentContent = ''
    mocks.sourceEditorContent = ''
    Object.assign(mocks.noteNode, {
      id: '/notes/notes.untitled_note.md',
      name: 'notes.untitled_note',
      treePath: '/notes.untitled_note',
      externalPath: '/notes/notes.untitled_note.md'
    })
    mocks.addNote.mockResolvedValue({
      path: '/notes/notes.untitled_note.md',
      name: 'notes.untitled_note'
    })
    mocks.renameNode.mockResolvedValue({ path: '/notes/Meeting notes.md', name: 'Meeting notes' })

    render(<NotesPage />)

    fireEvent.click(screen.getByRole('button', { name: 'create-note' }))
    await waitFor(() => expect(mocks.addNote).toHaveBeenCalled())

    act(() => mocks.onMarkdownChange?.('  Meeting notes  \nDetails'))

    await waitFor(
      () => {
        expect(mocks.fileWrite).toHaveBeenCalledWith('/notes/notes.untitled_note.md', '  Meeting notes  \nDetails')
        expect(mocks.renameNode).toHaveBeenCalledWith(
          expect.objectContaining({ externalPath: '/notes/notes.untitled_note.md' }),
          'Meeting notes'
        )
      },
      { timeout: 2000 }
    )
  })

  it('waits for a slow file watcher before applying the saved first-line title', async () => {
    mocks.showWorkspace = true
    mocks.activeFilePath = '/notes/notes.untitled_note.md'
    mocks.currentContent = ''
    mocks.sourceEditorContent = ''
    Object.assign(mocks.noteNode, {
      id: '/notes/notes.untitled_note.md',
      name: 'notes.untitled_note',
      treePath: '/notes.untitled_note',
      externalPath: '/notes/notes.untitled_note.md'
    })
    mocks.projectedNodes = []
    mocks.addNote.mockResolvedValue({
      path: '/notes/notes.untitled_note.md',
      name: 'notes.untitled_note'
    })
    mocks.renameNode.mockResolvedValue({ path: '/notes/Meeting notes.md', name: 'Meeting notes' })

    const { rerender } = render(<NotesPage />)

    fireEvent.click(screen.getByRole('button', { name: 'create-note' }))
    await waitFor(() => expect(mocks.addNote).toHaveBeenCalled())
    act(() => mocks.onMarkdownChange?.('Meeting notes\nDetails'))
    await waitFor(() => expect(mocks.fileWrite).toHaveBeenCalled(), { timeout: 2000 })
    expect(mocks.renameNode).not.toHaveBeenCalled()

    mocks.projectedNodes = [mocks.noteNode]
    mocks.treeVersion += 1
    rerender(<NotesPage />)

    await waitFor(() => {
      expect(mocks.renameNode).toHaveBeenCalledWith(
        expect.objectContaining({ externalPath: '/notes/notes.untitled_note.md' }),
        'Meeting notes'
      )
    })
  })

  it.each([
    ['notes.exportToPDF', 'print.export_pdf'],
    ['notes.print', 'print.print']
  ])('uses current source editor content for %s', async (label, route) => {
    render(<NotesPage />)

    await waitFor(() => expect(screen.getByDisplayValue('note')).toBeInTheDocument())
    await waitFor(() => expect(mocks.editorReady).toHaveBeenCalled())

    fireEvent.click(screen.getByTestId('popover-trigger'))
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}`) }))

    await waitFor(() => {
      expect(mocks.ipcRequest).toHaveBeenCalledWith(route, {
        title: 'note',
        markdown: mocks.sourceEditorContent,
        sourcePath: '/notes/note.md'
      })
    })
    expect(mocks.ipcRequest).not.toHaveBeenCalledWith(
      route,
      expect.objectContaining({
        markdown: mocks.currentContent
      })
    )
  })

  it.each([
    ['notes.exportToPDF', 'print.export_pdf'],
    ['notes.print', 'print.print']
  ])(
    'uses current rich editor markdown for %s when source is the default but rich editor is mounted',
    async (label, route) => {
      mocks.settings.defaultEditMode = 'source'
      mocks.mountedEditor = 'rich'
      const editedRichContent = 'edited rich content after switching view'

      render(<NotesPage />)

      await waitFor(() => expect(screen.getByDisplayValue('note')).toBeInTheDocument())
      await waitFor(() => expect(mocks.editorReady).toHaveBeenCalled())

      mocks.richEditorContent = editedRichContent
      fireEvent.click(screen.getByTestId('popover-trigger'))
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}`) }))

      await waitFor(() => {
        expect(mocks.ipcRequest).toHaveBeenCalledWith(route, {
          title: 'note',
          markdown: editedRichContent,
          sourcePath: '/notes/note.md'
        })
      })
      expect(mocks.ipcRequest).not.toHaveBeenCalledWith(
        route,
        expect.objectContaining({
          markdown: mocks.currentContent
        })
      )
    }
  )

  it('does not export stale saved content when the rich editor has been cleared', async () => {
    mocks.settings.defaultEditMode = 'preview'
    mocks.mountedEditor = 'rich'
    mocks.richEditorContent = mocks.currentContent

    render(<NotesPage />)

    await waitFor(() => expect(screen.getByDisplayValue('note')).toBeInTheDocument())
    await waitFor(() => expect(mocks.editorReady).toHaveBeenCalled())

    mocks.richEditorContent = ''
    fireEvent.click(screen.getByTestId('popover-trigger'))
    fireEvent.click(screen.getByRole('button', { name: 'notes.exportToPDF' }))

    await waitFor(() => {
      expect(toast.warning).toHaveBeenCalledWith('notes.no_content_to_export')
    })
    expect(mocks.ipcRequest).not.toHaveBeenCalled()
  })

  it('routes the app.print command through the current source editor content', async () => {
    render(<NotesPage />)

    await waitFor(() => expect(screen.getByDisplayValue('note')).toBeInTheDocument())
    await waitFor(() => expect(mocks.editorReady).toHaveBeenCalled())

    let command: { handler: () => void | Promise<void>; enabled: boolean } | undefined
    await waitFor(() => {
      command = mocks.commandHandlers.get('app.print')
      expect(command?.enabled).toBe(true)
    })

    await command?.handler()

    await waitFor(() => {
      expect(mocks.ipcRequest).toHaveBeenCalledWith('print.print', {
        title: 'note',
        markdown: mocks.sourceEditorContent,
        sourcePath: '/notes/note.md'
      })
    })
  })

  it('keeps the app.print command disabled for inactive tabs', async () => {
    mocks.isActiveTab = false

    render(<NotesPage />)

    await waitFor(() => expect(screen.getByDisplayValue('note')).toBeInTheDocument())
    await waitFor(() => {
      expect(mocks.commandHandlers.get('app.print')?.enabled).toBe(false)
    })
  })

  it('shows the resolved print shortcut next to the print menu item', async () => {
    mocks.printShortcutLabel = '⌘P'

    render(<NotesPage />)

    await waitFor(() => expect(screen.getByDisplayValue('note')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('popover-trigger'))

    expect(screen.getByRole('button', { name: /notes\.print/ })).toHaveTextContent('⌘P')
  })
})
