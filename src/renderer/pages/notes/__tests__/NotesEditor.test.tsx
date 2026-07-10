import type { CodeEditorHandles } from '@renderer/components/CodeEditor'
import type { RichEditorRef } from '@renderer/components/RichEditor/types'
import { render, screen } from '@testing-library/react'
import type { RefObject } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  defaultViewMode: 'preview' as 'preview' | 'source'
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: () => [false, vi.fn().mockResolvedValue(undefined)]
}))

vi.mock('@renderer/hooks/useNotesSettings', () => ({
  useNotesSettings: () => ({
    settings: {
      defaultViewMode: mocks.defaultViewMode,
      defaultEditMode: 'source',
      showTableOfContents: false,
      isFullWidth: true,
      fontFamily: 'default',
      fontSize: 16
    }
  })
}))

vi.mock('@renderer/components/RichEditor/RichEditor', () => ({
  default: () => <div data-testid="rich-editor" />
}))

vi.mock('@renderer/components/CodeEditor', () => ({
  CodeEditor: () => <div data-testid="code-editor" />
}))

vi.mock('@renderer/components/ActionIconButton', () => ({
  default: () => null
}))

vi.mock('@renderer/components/Selector', () => ({
  default: () => null
}))

import NotesEditor from '../NotesEditor'

const baseProps = {
  currentContent: 'draft content',
  tokenCount: 13,
  editorRef: { current: null } as RefObject<RichEditorRef | null>,
  codeEditorRef: { current: null } as RefObject<CodeEditorHandles | null>,
  onMarkdownChange: vi.fn()
}

describe('NotesEditor document identity', () => {
  beforeEach(() => {
    mocks.defaultViewMode = 'preview'
  })

  it('preserves the rich editor across a path-only rename and resets it for a different document', () => {
    const { rerender } = render(<NotesEditor {...baseProps} activeNodeId="/notes/old.md" documentId="document-1" />)
    const originalEditor = screen.getByTestId('rich-editor')

    rerender(<NotesEditor {...baseProps} activeNodeId="/notes/renamed.md" documentId="document-1" />)
    expect(screen.getByTestId('rich-editor')).toBe(originalEditor)

    rerender(<NotesEditor {...baseProps} activeNodeId="/notes/other.md" documentId="document-2" />)
    expect(screen.getByTestId('rich-editor')).not.toBe(originalEditor)
  })

  it('preserves the source editor across a path-only rename and resets it for a different document', () => {
    mocks.defaultViewMode = 'source'
    const { rerender } = render(<NotesEditor {...baseProps} activeNodeId="/notes/old.md" documentId="document-1" />)
    const originalEditor = screen.getByTestId('code-editor')

    rerender(<NotesEditor {...baseProps} activeNodeId="/notes/renamed.md" documentId="document-1" />)
    expect(screen.getByTestId('code-editor')).toBe(originalEditor)

    rerender(<NotesEditor {...baseProps} activeNodeId="/notes/other.md" documentId="document-2" />)
    expect(screen.getByTestId('code-editor')).not.toBe(originalEditor)
  })
})
