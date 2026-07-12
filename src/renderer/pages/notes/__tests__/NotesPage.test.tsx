import type * as NotesQueryModule from '@renderer/hooks/useNotesQuery'
import type * as NotesServiceModule from '@renderer/services/NotesService'
import { toast } from '@renderer/services/toast'
import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
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
    fileContents: new Map<string, string>(),
    richEditorContent: 'edited rich content',
    sourceEditorContent: 'edited source content',
    mountedEditor: 'source',
    onMarkdownChange: undefined as ((content: string) => void) | undefined,
    onEditorBlur: undefined as (() => void) | undefined,
    editorReady: vi.fn(),
    getNode: vi.fn(),
    invalidateFileContent: vi.fn(),
    primeFileContent: vi.fn(),
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
    sortType: 'sort_a2z',
    sortTree: vi.fn((nodes, sortType: string) => {
      void sortType
      return nodes
    }),
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
    sortType: mocks.sortType,
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
    useFileContent: (filePath?: string) => ({
      data: (filePath && mocks.fileContents.get(filePath)) ?? mocks.currentContent,
      error: undefined
    }),
    useFileContentSync: () => ({
      invalidateFileContent: mocks.invalidateFileContent,
      primeFileContent: mocks.primeFileContent
    })
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

  function MockNotesEditor({
    activeNodeId,
    codeEditorRef,
    currentContent,
    documentId,
    editorRef,
    onMarkdownChange,
    onBlur
  }: any) {
    React.useEffect(() => {
      mocks.onMarkdownChange = onMarkdownChange
      mocks.onEditorBlur = onBlur
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
        mocks.onEditorBlur = undefined
        codeEditorRef.current = null
        editorRef.current = null
      }
    }, [codeEditorRef, editorRef, onBlur, onMarkdownChange])

    if (!activeNodeId) {
      return React.createElement('div', { 'data-testid': 'notes-empty' })
    }

    return React.createElement(
      'div',
      { key: documentId ?? activeNodeId, 'data-testid': 'notes-editor' },
      currentContent
    )
  }

  return {
    default: MockNotesEditor
  }
})

vi.mock('../NotesSettings', () => ({
  default: () => null
}))

vi.mock('../NotesSidebar', () => ({
  default: ({ notesTree, onCreateNote, onRenameNode, onSelectNode }: any) => (
    <>
      <output data-testid="note-order">{notesTree.map((node: any) => node.externalPath).join(',')}</output>
      <button type="button" onClick={() => onCreateNote('notes.untitled_note')}>
        create-note
      </button>
      <button type="button" onClick={() => onRenameNode(notesTree[0]?.id, 'renamed')}>
        rename-note
      </button>
      {notesTree[1] && (
        <button type="button" onClick={() => onSelectNode(notesTree[1])}>
          switch-note
        </button>
      )}
    </>
  )
}))

import NotesPage from '../NotesPage'

describe('NotesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockUseCacheUtils.resetMocks()
    MockUseCacheUtils.setCacheValue('notes.active_file_path', '/notes/note.md')
    mocks.setActiveFilePath = MockUseCacheUtils.getCacheSetter('notes.active_file_path')
    mocks.currentContent = 'saved content'
    mocks.fileContents.clear()
    mocks.richEditorContent = 'edited rich content'
    mocks.sourceEditorContent = 'edited source content'
    mocks.mountedEditor = 'source'
    mocks.onMarkdownChange = undefined
    mocks.onEditorBlur = undefined
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
    mocks.sortType = 'sort_a2z'
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
          move: vi.fn().mockResolvedValue(undefined),
          listDirectory: vi.fn().mockResolvedValue([])
        },
        tree: {
          onMutation: vi.fn(() => vi.fn()),
          dispose: vi.fn().mockResolvedValue(undefined)
        }
      }
    })
  })

  it('renames a newly created note from its sanitized first line after saving', async () => {
    mocks.showWorkspace = true
    MockUseCacheUtils.setCacheValue('notes.active_file_path', '/notes/notes.untitled_note.md')
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
    mocks.renameNode.mockResolvedValue({ path: '/notes/Meeting note.md', name: 'Meeting note' })

    render(<NotesPage />)

    fireEvent.click(screen.getByRole('button', { name: 'create-note' }))
    await waitFor(() => expect(mocks.addNote).toHaveBeenCalled())

    act(() => mocks.onMarkdownChange?.('  ///Meeting notes  \nDetails'))

    await waitFor(
      () => {
        expect(mocks.fileWrite).toHaveBeenCalledWith('/notes/notes.untitled_note.md', '  ///Meeting notes  \nDetails')
        expect(mocks.renameNode).toHaveBeenCalledWith(
          expect.objectContaining({ externalPath: '/notes/notes.untitled_note.md' }),
          'Meeting note'
        )
      },
      { timeout: 2000 }
    )
  })

  it('keeps initial-title work on the new path while its tree node is still pending', async () => {
    mocks.showWorkspace = true
    const oldNote = { ...mocks.noteNode }
    const newNote = {
      ...mocks.noteNode,
      id: '/notes/notes.untitled_note.md',
      name: 'notes.untitled_note',
      treePath: '/notes.untitled_note',
      externalPath: '/notes/notes.untitled_note.md'
    }
    MockUseCacheUtils.setCacheValue('notes.active_file_path', oldNote.externalPath)
    mocks.currentContent = 'old content'
    mocks.sourceEditorContent = 'old content'
    mocks.projectedNodes = [oldNote]

    const { rerender } = render(<NotesPage />)
    fireEvent.click(screen.getByRole('button', { name: 'create-note' }))
    await waitFor(() => expect(mocks.setActiveFilePath).toHaveBeenCalledWith(newNote.externalPath))

    mocks.sourceEditorContent = 'Meeting notes'
    act(() => mocks.onMarkdownChange?.('Meeting notes'))
    act(() => mocks.onEditorBlur?.())
    await waitFor(() => expect(mocks.fileWrite).toHaveBeenCalledWith(newNote.externalPath, 'Meeting notes'))
    expect(mocks.fileWrite).not.toHaveBeenCalledWith(oldNote.externalPath, 'Meeting notes')
    expect(mocks.renameNode).not.toHaveBeenCalled()

    mocks.projectedNodes = [newNote, oldNote]
    mocks.treeVersion += 1
    rerender(<NotesPage />)

    await waitFor(() =>
      expect(mocks.renameNode).toHaveBeenCalledWith(
        expect.objectContaining({ externalPath: newNote.externalPath }),
        'Meeting note'
      )
    )
  })

  it('does not derive a new title for an existing note', async () => {
    render(<NotesPage />)

    await waitFor(() => expect(mocks.editorReady).toHaveBeenCalled())
    act(() => mocks.onMarkdownChange?.('Replacement title\nDetails'))

    await waitFor(() => expect(mocks.fileWrite).toHaveBeenCalledWith('/notes/note.md', 'Replacement title\nDetails'), {
      timeout: 2000
    })
    expect(mocks.renameNode).not.toHaveBeenCalled()
  })

  it('does not rewrite unchanged content when switching to an old note', async () => {
    mocks.showWorkspace = true
    const oldNote = {
      ...mocks.noteNode,
      id: '/notes/old.md',
      name: 'old',
      treePath: '/old',
      externalPath: '/notes/old.md'
    }
    mocks.projectedNodes = [mocks.noteNode, oldNote]
    mocks.fileContents.set('/notes/note.md', 'currently active content')
    mocks.fileContents.set('/notes/old.md', 'unchanged old content')
    mocks.currentContent = 'currently active content'
    mocks.sourceEditorContent = 'currently active content'

    render(<NotesPage />)
    await waitFor(() => expect(mocks.editorReady).toHaveBeenCalled())
    mocks.fileWrite.mockClear()

    const staleOnMarkdownChange = mocks.onMarkdownChange
    mocks.sourceEditorContent = 'unchanged old content'
    fireEvent.click(screen.getByRole('button', { name: 'switch-note' }))
    act(() => staleOnMarkdownChange?.('currently active content'))

    await new Promise((resolve) => setTimeout(resolve, 900))
    expect(mocks.fileWrite).not.toHaveBeenCalledWith('/notes/note.md', 'currently active content')
  })

  it('keeps updated-time order stable when selecting an unchanged old note and refreshing the tree', async () => {
    mocks.showWorkspace = true
    mocks.sortType = 'sort_updated_desc'
    const actual = await vi.importActual<typeof NotesServiceModule>('@renderer/services/NotesService')
    mocks.sortTree.mockImplementation((nodes, sortType) =>
      actual.sortTree(nodes, sortType as Parameters<typeof actual.sortTree>[1])
    )
    const newestNote = { ...mocks.noteNode, updatedAt: '2026-07-11T12:00:00.000Z' }
    const oldNote = {
      ...mocks.noteNode,
      id: '/notes/old.md',
      name: 'old',
      treePath: '/old',
      externalPath: '/notes/old.md',
      updatedAt: '2026-07-10T12:00:00.000Z'
    }
    mocks.projectedNodes = [oldNote, newestNote]
    mocks.fileContents.set(newestNote.externalPath, 'newest content')
    mocks.fileContents.set(oldNote.externalPath, 'old content')
    mocks.currentContent = 'newest content'
    mocks.sourceEditorContent = 'newest content'

    const { rerender } = render(<NotesPage />)
    await waitFor(() => expect(screen.getByTestId('note-order')).toHaveTextContent('/notes/note.md,/notes/old.md'))
    mocks.fileWrite.mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'switch-note' }))
    mocks.treeVersion += 1
    rerender(<NotesPage />)

    await waitFor(() => expect(screen.getByTestId('note-order')).toHaveTextContent('/notes/note.md,/notes/old.md'))
    expect(mocks.fileWrite).not.toHaveBeenCalled()
  })

  it('waits for the first newline before deriving a title', async () => {
    mocks.showWorkspace = true
    MockUseCacheUtils.setCacheValue('notes.active_file_path', '/notes/notes.untitled_note.md')
    mocks.currentContent = ''
    mocks.sourceEditorContent = ''
    Object.assign(mocks.noteNode, {
      id: '/notes/notes.untitled_note.md',
      name: 'notes.untitled_note',
      treePath: '/notes.untitled_note',
      externalPath: '/notes/notes.untitled_note.md'
    })

    render(<NotesPage />)

    fireEvent.click(screen.getByRole('button', { name: 'create-note' }))
    await waitFor(() => expect(mocks.addNote).toHaveBeenCalled())

    act(() => mocks.onMarkdownChange?.('Meeting notes'))
    await waitFor(
      () => expect(mocks.fileWrite).toHaveBeenCalledWith('/notes/notes.untitled_note.md', 'Meeting notes'),
      {
        timeout: 2000
      }
    )
    expect(mocks.renameNode).not.toHaveBeenCalled()

    act(() => mocks.onMarkdownChange?.('Meeting notes\n'))
    await waitFor(
      () => {
        expect(mocks.renameNode).toHaveBeenCalledWith(
          expect.objectContaining({ externalPath: '/notes/notes.untitled_note.md' }),
          'Meeting note'
        )
      },
      { timeout: 2000 }
    )
  })

  it('starts the initial rename immediately when a pasted first line is completed', async () => {
    mocks.showWorkspace = true
    MockUseCacheUtils.setCacheValue('notes.active_file_path', '/notes/notes.untitled_note.md')
    mocks.currentContent = ''
    mocks.sourceEditorContent = ''
    Object.assign(mocks.noteNode, {
      id: '/notes/notes.untitled_note.md',
      name: 'notes.untitled_note',
      treePath: '/notes.untitled_note',
      externalPath: '/notes/notes.untitled_note.md'
    })

    render(<NotesPage />)
    fireEvent.click(screen.getByRole('button', { name: 'create-note' }))
    await waitFor(() => expect(mocks.addNote).toHaveBeenCalled())

    const content = `${'Long title '.repeat(2000)}\nBody`
    mocks.sourceEditorContent = content
    act(() => mocks.onMarkdownChange?.(content))

    await waitFor(() => expect(mocks.renameNode).toHaveBeenCalled(), { timeout: 400 })
  })

  it('does not start concurrent initial-title writes while pasted content is still changing', async () => {
    mocks.showWorkspace = true
    MockUseCacheUtils.setCacheValue('notes.active_file_path', '/notes/notes.untitled_note.md')
    mocks.currentContent = ''
    mocks.sourceEditorContent = ''
    Object.assign(mocks.noteNode, {
      id: '/notes/notes.untitled_note.md',
      name: 'notes.untitled_note',
      treePath: '/notes.untitled_note',
      externalPath: '/notes/notes.untitled_note.md'
    })

    let resolveFirstWrite: (() => void) | undefined
    mocks.fileWrite.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveFirstWrite = resolve
        })
    )

    render(<NotesPage />)
    fireEvent.click(screen.getByRole('button', { name: 'create-note' }))
    await waitFor(() => expect(mocks.addNote).toHaveBeenCalled())

    mocks.sourceEditorContent = 'Meeting notes\nFirst body'
    act(() => mocks.onMarkdownChange?.('Meeting notes\nFirst body'))
    await waitFor(() => expect(mocks.fileWrite).toHaveBeenCalledTimes(1))

    mocks.sourceEditorContent = 'Latest title\nLatest body'
    act(() => mocks.onMarkdownChange?.('Latest title\nLatest body'))
    act(() => mocks.onEditorBlur?.())
    act(() => mocks.onEditorBlur?.())
    expect(mocks.fileWrite).toHaveBeenCalledTimes(1)

    act(() => resolveFirstWrite?.())
    await waitFor(() => expect(mocks.renameNode).toHaveBeenCalled())
    expect(mocks.renameNode).toHaveBeenCalledWith(expect.anything(), 'Latest title')
    expect(mocks.fileWrite).toHaveBeenCalledWith('/notes/notes.untitled_note.md', 'Latest title\nLatest body')
  })

  it('derives a title from an unfinished first line when the editor loses focus', async () => {
    mocks.showWorkspace = true
    MockUseCacheUtils.setCacheValue('notes.active_file_path', '/notes/notes.untitled_note.md')
    mocks.currentContent = ''
    mocks.sourceEditorContent = ''
    Object.assign(mocks.noteNode, {
      id: '/notes/notes.untitled_note.md',
      name: 'notes.untitled_note',
      treePath: '/notes.untitled_note',
      externalPath: '/notes/notes.untitled_note.md'
    })
    mocks.renameNode.mockResolvedValue({ path: '/notes/Meeting note.md', name: 'Meeting note' })

    render(<NotesPage />)

    fireEvent.click(screen.getByRole('button', { name: 'create-note' }))
    await waitFor(() => expect(mocks.addNote).toHaveBeenCalled())

    mocks.sourceEditorContent = 'Meeting notes'
    act(() => mocks.onMarkdownChange?.('Meeting notes'))
    act(() => mocks.onEditorBlur?.())

    await waitFor(() => {
      expect(mocks.fileWrite).toHaveBeenCalledWith('/notes/notes.untitled_note.md', 'Meeting notes')
      expect(mocks.renameNode).toHaveBeenCalledWith(
        expect.objectContaining({ externalPath: '/notes/notes.untitled_note.md' }),
        'Meeting note'
      )
    })
  })

  it('finishes the initial title before switching to another note', async () => {
    mocks.showWorkspace = true
    MockUseCacheUtils.setCacheValue('notes.active_file_path', '/notes/notes.untitled_note.md')
    mocks.currentContent = ''
    mocks.sourceEditorContent = ''
    Object.assign(mocks.noteNode, {
      id: '/notes/notes.untitled_note.md',
      name: 'notes.untitled_note',
      treePath: '/notes.untitled_note',
      externalPath: '/notes/notes.untitled_note.md'
    })
    const otherNote = {
      ...mocks.noteNode,
      id: '/notes/other.md',
      name: 'other',
      treePath: '/other',
      externalPath: '/notes/other.md'
    }
    mocks.projectedNodes = [mocks.noteNode, otherNote]
    mocks.renameNode.mockResolvedValue({ path: '/notes/Meeting note.md', name: 'Meeting note' })

    render(<NotesPage />)

    fireEvent.click(screen.getByRole('button', { name: 'create-note' }))
    await waitFor(() => expect(mocks.addNote).toHaveBeenCalled())
    mocks.sourceEditorContent = 'Meeting notes'
    act(() => mocks.onMarkdownChange?.('Meeting notes'))

    fireEvent.click(screen.getByRole('button', { name: 'switch-note' }))

    await waitFor(() => expect(mocks.setActiveFilePath).toHaveBeenCalledWith('/notes/other.md'))
    expect(mocks.renameNode).toHaveBeenCalledWith(
      expect.objectContaining({ externalPath: '/notes/notes.untitled_note.md' }),
      'Meeting note'
    )
    expect(mocks.renameNode.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.setActiveFilePath.mock.invocationCallOrder.at(-1) ?? Number.POSITIVE_INFINITY
    )
  })

  it('does not overwrite a manual rename with a title derived later', async () => {
    mocks.showWorkspace = true
    MockUseCacheUtils.setCacheValue('notes.active_file_path', '/notes/notes.untitled_note.md')
    mocks.currentContent = ''
    mocks.sourceEditorContent = ''
    Object.assign(mocks.noteNode, {
      id: '/notes/notes.untitled_note.md',
      name: 'notes.untitled_note',
      treePath: '/notes.untitled_note',
      externalPath: '/notes/notes.untitled_note.md'
    })

    const { rerender } = render(<NotesPage />)

    fireEvent.click(screen.getByRole('button', { name: 'create-note' }))
    await waitFor(() => expect(mocks.addNote).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'rename-note' }))
    await waitFor(() => expect(mocks.renameNode).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mocks.setActiveFilePath).toHaveBeenCalledWith('/notes/renamed.md'))

    act(() => mocks.onMarkdownChange?.('Automatic title\nDetails'))

    Object.assign(mocks.noteNode, {
      id: '/notes/renamed.md',
      name: 'renamed',
      treePath: '/renamed',
      externalPath: '/notes/renamed.md'
    })
    mocks.projectedNodes = [{ ...mocks.noteNode }]
    mocks.treeVersion += 1
    rerender(<NotesPage />)

    await waitFor(() => expect(mocks.fileWrite).toHaveBeenCalledWith('/notes/renamed.md', 'Automatic title\nDetails'), {
      timeout: 2000
    })
    expect(mocks.renameNode).toHaveBeenCalledTimes(1)
  })

  it('gives a manual rename priority over an in-flight blur fallback', async () => {
    mocks.showWorkspace = true
    MockUseCacheUtils.setCacheValue('notes.active_file_path', '/notes/notes.untitled_note.md')
    mocks.currentContent = ''
    mocks.sourceEditorContent = ''
    Object.assign(mocks.noteNode, {
      id: '/notes/notes.untitled_note.md',
      name: 'notes.untitled_note',
      treePath: '/notes.untitled_note',
      externalPath: '/notes/notes.untitled_note.md'
    })
    let resolveAutomaticRename: ((result: { path: string; name: string }) => void) | undefined
    mocks.renameNode
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveAutomaticRename = resolve
          })
      )
      .mockResolvedValueOnce({ path: '/notes/renamed.md', name: 'renamed' })

    render(<NotesPage />)

    fireEvent.click(
      screen.getByRole('button', {
        name: 'create-note'
      })
    )
    await waitFor(() => expect(mocks.addNote).toHaveBeenCalled())
    mocks.sourceEditorContent = 'Automatic title'
    act(() => mocks.onMarkdownChange?.('Automatic title'))
    act(() => mocks.onEditorBlur?.())
    await waitFor(() => expect(mocks.renameNode).toHaveBeenCalledWith(expect.anything(), 'Automatic ti'))

    fireEvent.click(
      screen.getByRole('button', {
        name: 'rename-note'
      })
    )

    await waitFor(() => expect(mocks.renameNode).toHaveBeenCalledTimes(1))
    act(() =>
      resolveAutomaticRename?.({
        path: '/notes/Automatic ti.md',
        name: 'Automatic ti'
      })
    )
    await waitFor(() => expect(mocks.renameNode).toHaveBeenCalledTimes(2))
    expect(mocks.renameNode).toHaveBeenLastCalledWith(
      expect.objectContaining({
        externalPath: '/notes/Automatic ti.md'
      }),
      'renamed'
    )
  })

  it('waits for a slow file watcher before applying the saved first-line title', async () => {
    mocks.showWorkspace = true
    MockUseCacheUtils.setCacheValue('notes.active_file_path', '/notes/notes.untitled_note.md')
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
    mocks.renameNode.mockResolvedValue({ path: '/notes/Meeting note.md', name: 'Meeting note' })

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
        'Meeting note'
      )
    })
  })

  it('preserves blur finalization while waiting for the new node to reach the tree', async () => {
    mocks.showWorkspace = true
    MockUseCacheUtils.setCacheValue('notes.active_file_path', '/notes/notes.untitled_note.md')
    mocks.currentContent = ''
    mocks.sourceEditorContent = ''
    Object.assign(mocks.noteNode, {
      id: '/notes/notes.untitled_note.md',
      name: 'notes.untitled_note',
      treePath: '/notes.untitled_note',
      externalPath: '/notes/notes.untitled_note.md'
    })
    mocks.projectedNodes = []

    const { rerender } = render(<NotesPage />)
    fireEvent.click(screen.getByRole('button', { name: 'create-note' }))
    await waitFor(() => expect(mocks.addNote).toHaveBeenCalled())

    mocks.sourceEditorContent = 'Meeting notes'
    act(() => mocks.onMarkdownChange?.('Meeting notes'))
    act(() => mocks.onEditorBlur?.())
    await waitFor(() => expect(mocks.fileWrite).toHaveBeenCalledWith('/notes/notes.untitled_note.md', 'Meeting notes'))
    expect(mocks.renameNode).not.toHaveBeenCalled()

    mocks.projectedNodes = [mocks.noteNode]
    mocks.treeVersion += 1
    rerender(<NotesPage />)

    await waitFor(() => expect(mocks.renameNode).toHaveBeenCalled(), { timeout: 1500 })
  })

  it('does not reuse blur fallback state when a note path is created again', async () => {
    mocks.showWorkspace = true
    MockUseCacheUtils.setCacheValue('notes.active_file_path', '/notes/note.md')
    mocks.currentContent = ''
    mocks.sourceEditorContent = ''
    mocks.addNote.mockResolvedValue({ path: '/notes/note.md', name: 'note' })

    const { rerender } = render(<NotesPage />)

    fireEvent.click(screen.getByRole('button', { name: 'create-note' }))
    await waitFor(() => expect(mocks.addNote).toHaveBeenCalledTimes(1))
    mocks.sourceEditorContent = 'note'
    act(() => mocks.onMarkdownChange?.('note'))
    act(() => mocks.onEditorBlur?.())
    await waitFor(() => expect(mocks.fileWrite).toHaveBeenCalledWith('/notes/note.md', 'note'))
    expect(mocks.renameNode).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'create-note' }))
    await waitFor(() => expect(mocks.addNote).toHaveBeenCalledTimes(2))
    mocks.sourceEditorContent = 'Draft'
    act(() => mocks.onMarkdownChange?.('Draft'))
    await waitFor(() => expect(mocks.fileWrite).toHaveBeenCalledWith('/notes/note.md', 'Draft'), { timeout: 1500 })

    mocks.treeVersion += 1
    rerender(<NotesPage />)

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(mocks.renameNode).not.toHaveBeenCalled()
  })

  it('stops retrying an automatic title after the rename fails', async () => {
    mocks.showWorkspace = true
    MockUseCacheUtils.setCacheValue('notes.active_file_path', '/notes/notes.untitled_note.md')
    mocks.currentContent = ''
    mocks.sourceEditorContent = ''
    Object.assign(mocks.noteNode, {
      id: '/notes/notes.untitled_note.md',
      name: 'notes.untitled_note',
      treePath: '/notes.untitled_note',
      externalPath: '/notes/notes.untitled_note.md'
    })
    mocks.renameNode.mockRejectedValue(new Error('Target name already exists'))

    const { rerender } = render(<NotesPage />)

    fireEvent.click(screen.getByRole('button', { name: 'create-note' }))
    await waitFor(() => expect(mocks.addNote).toHaveBeenCalled())
    act(() => mocks.onMarkdownChange?.('Meeting notes\nDetails'))

    await waitFor(() => expect(mocks.renameNode).toHaveBeenCalledTimes(1), { timeout: 2000 })

    mocks.projectedNodes = [{ ...mocks.noteNode }]
    mocks.treeVersion += 1
    rerender(<NotesPage />)
    mocks.projectedNodes = [{ ...mocks.noteNode }]
    mocks.treeVersion += 1
    rerender(<NotesPage />)

    await waitFor(() => expect(mocks.renameNode).toHaveBeenCalledTimes(1))
  })

  it('keeps the active editor visible while its note is renamed', async () => {
    mocks.showWorkspace = true
    let resolveRename: ((result: { path: string; name: string }) => void) | undefined
    mocks.renameNode.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRename = resolve
        })
    )

    const { rerender } = render(<NotesPage />)

    expect(screen.getByTestId('notes-editor')).toHaveTextContent('saved content')
    const editorElement = screen.getByTestId('notes-editor')
    fireEvent.click(screen.getByRole('button', { name: 'rename-note' }))
    await waitFor(() => expect(mocks.renameNode).toHaveBeenCalled())

    expect(mocks.fileWrite).toHaveBeenCalledWith('/notes/note.md', 'edited source content')
    expect(mocks.fileWrite.mock.invocationCallOrder[0]).toBeLessThan(mocks.renameNode.mock.invocationCallOrder[0])

    // The pre-rename write can refresh the old tree node before the move
    // event arrives. That refresh must not end rename suppression early.
    mocks.projectedNodes = [{ ...mocks.noteNode }]
    mocks.treeVersion += 1
    rerender(<NotesPage />)
    mocks.projectedNodes = []
    mocks.treeVersion += 1
    rerender(<NotesPage />)

    expect(screen.queryByTestId('notes-empty')).not.toBeInTheDocument()
    expect(screen.getByTestId('notes-editor')).toBe(editorElement)
    expect(screen.getByTestId('notes-editor')).toHaveTextContent('saved content')

    act(() => resolveRename?.({ path: '/notes/renamed.md', name: 'renamed' }))
    await waitFor(() => expect(mocks.setActiveFilePath).toHaveBeenCalledWith('/notes/renamed.md'))

    Object.assign(mocks.noteNode, {
      id: '/notes/renamed.md',
      name: 'renamed',
      treePath: '/renamed',
      externalPath: '/notes/renamed.md'
    })
    mocks.projectedNodes = [mocks.noteNode]
    mocks.treeVersion += 1
    rerender(<NotesPage />)

    await waitFor(() => expect(screen.queryByTestId('notes-empty')).not.toBeInTheDocument())
    expect(screen.getByTestId('notes-editor')).toBe(editorElement)

    mocks.projectedNodes = [{ ...mocks.noteNode }]
    mocks.treeVersion += 1
    rerender(<NotesPage />)

    await waitFor(() => expect(screen.getByTestId('notes-editor')).toBe(editorElement))
  })

  it('saves edits made during a slow rename only to the final path', async () => {
    mocks.showWorkspace = true
    let resolveRename: ((result: { path: string; name: string }) => void) | undefined
    mocks.renameNode.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRename = resolve
        })
    )

    render(<NotesPage />)

    fireEvent.click(screen.getByRole('button', { name: 'rename-note' }))
    await waitFor(() => expect(mocks.renameNode).toHaveBeenCalled())
    mocks.fileWrite.mockClear()

    mocks.sourceEditorContent = 'latest content during rename'
    act(() => mocks.onMarkdownChange?.('latest content during rename'))
    await new Promise((resolve) => setTimeout(resolve, 900))

    expect(mocks.fileWrite).not.toHaveBeenCalledWith('/notes/note.md', 'latest content during rename')

    act(() => resolveRename?.({ path: '/notes/renamed.md', name: 'renamed' }))

    await waitFor(() =>
      expect(mocks.fileWrite).toHaveBeenCalledWith('/notes/renamed.md', 'latest content during rename')
    )
    expect(mocks.primeFileContent).toHaveBeenCalledWith('/notes/renamed.md', 'latest content during rename')
  })

  it('keeps a slow rename from reading or replacing another note content after navigation', async () => {
    mocks.showWorkspace = true
    const otherNode = {
      ...mocks.noteNode,
      id: '/notes/other.md',
      name: 'other',
      treePath: '/other',
      externalPath: '/notes/other.md'
    }
    mocks.projectedNodes = [{ ...mocks.noteNode }, otherNode]
    let resolveRename: ((result: { path: string; name: string }) => void) | undefined
    mocks.renameNode.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRename = resolve
        })
    )

    render(<NotesPage />)

    fireEvent.click(screen.getByRole('button', { name: 'rename-note' }))
    await waitFor(() => expect(mocks.renameNode).toHaveBeenCalled())
    mocks.fileWrite.mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'switch-note' }))
    await waitFor(() => expect(mocks.setActiveFilePath).toHaveBeenCalledWith('/notes/other.md'))
    mocks.sourceEditorContent = 'other note content'
    act(() => mocks.onMarkdownChange?.('other note content'))

    act(() => resolveRename?.({ path: '/notes/renamed.md', name: 'renamed' }))

    await waitFor(() => expect(mocks.fileWrite).toHaveBeenCalledWith('/notes/renamed.md', 'edited source content'))
    expect(mocks.fileWrite).not.toHaveBeenCalledWith('/notes/renamed.md', 'other note content')
    expect(mocks.setActiveFilePath).not.toHaveBeenCalledWith('/notes/renamed.md')
    await waitFor(() => expect(mocks.fileWrite).toHaveBeenCalledWith('/notes/other.md', 'other note content'), {
      timeout: 1500
    })
  })

  it('keeps the active editor until the rolled-back path returns to the tree', async () => {
    mocks.showWorkspace = true
    mocks.rewritePath.mockRejectedValueOnce(new Error('metadata sync failed'))
    const otherNode = {
      ...mocks.noteNode,
      id: '/notes/other.md',
      name: 'other',
      treePath: '/other',
      externalPath: '/notes/other.md'
    }

    const { rerender } = render(<NotesPage />)
    const editorElement = screen.getByTestId('notes-editor')

    fireEvent.click(screen.getByRole('button', { name: 'rename-note' }))
    await waitFor(() => expect(mocks.rewritePath).toHaveBeenCalled())

    mocks.projectedNodes = [otherNode]
    mocks.treeVersion += 1
    rerender(<NotesPage />)

    expect(screen.queryByTestId('notes-empty')).not.toBeInTheDocument()
    expect(screen.getByTestId('notes-editor')).toBe(editorElement)
    expect(mocks.setActiveFilePath).not.toHaveBeenCalledWith(undefined)

    mocks.projectedNodes = [{ ...mocks.noteNode }]
    mocks.treeVersion += 1
    rerender(<NotesPage />)

    await waitFor(() => expect(screen.getByTestId('notes-editor')).toBe(editorElement))
    expect(mocks.setActiveFilePath).not.toHaveBeenCalledWith(undefined)
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
