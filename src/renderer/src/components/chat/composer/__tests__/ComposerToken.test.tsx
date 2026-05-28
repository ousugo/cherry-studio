import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import { AllSelection, NodeSelection, Selection } from '@tiptap/pm/state'
import { EditorContent, useEditor } from '@tiptap/react'
import { type ReactNode, useEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { serializeComposerDocument } from '../composerDraft'
import { createComposerEditorPreset } from '../composerPreset'
import { ComposerToken } from '../ComposerToken'
import { COMPOSER_TOKEN_NODE_NAME } from '../ComposerTokenNode'
import { createPromptVariableContent, selectPromptVariableToken } from '../promptVariables'
import { PromptVariableToken } from '../PromptVariableToken'
import type { ComposerDraftToken } from '../tokens'

vi.mock('@cherrystudio/ui', () => ({
  NormalTooltip: ({
    children,
    content,
    contentProps
  }: {
    children: ReactNode
    content: ReactNode
    contentProps?: { className?: string }
  }) => (
    <span data-content-class-name={contentProps?.className} data-testid="composer-token-tooltip">
      {children}
      <span data-testid="composer-token-tooltip-content">{content}</span>
    </span>
  )
}))

const promptVariableToken: ComposerDraftToken = {
  id: 'prompt-variable:0:city',
  kind: 'promptVariable',
  label: 'city',
  description: '${city}',
  promptText: '${city}'
}

function ComposerEditorHarness({
  onEditor,
  text = 'go ${city}'
}: {
  onEditor: (editor: Editor) => void
  text?: string
}) {
  const editor = useEditor({
    extensions: createComposerEditorPreset(),
    content: createPromptVariableContent(text)
  })

  useEffect(() => {
    if (editor) onEditor(editor)
  }, [editor, onEditor])

  return <EditorContent editor={editor} />
}

function findComposerTokenPosition(editor: Editor): number {
  let tokenPosition = -1
  editor.state.doc.descendants((node, position) => {
    if (node.type.name === COMPOSER_TOKEN_NODE_NAME) tokenPosition = position
  })
  return tokenPosition
}

describe('ComposerToken', () => {
  it('renders a static composer token label', () => {
    render(<ComposerToken token={{ id: 'file:1', kind: 'file', label: 'notes.md' }} />)

    expect(screen.getByText('notes.md')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByTestId('composer-token-tooltip')).toBeNull()
  })

  it('shows quoted content in a tooltip for quote tokens', () => {
    render(
      <ComposerToken
        token={{
          id: 'quote:1',
          kind: 'quote',
          label: 'Quote',
          description: 'first line\nsecond line',
          promptText: '> first line\n> second line'
        }}
      />
    )

    expect(screen.getByText('Quote')).toBeInTheDocument()
    expect(screen.getByText('Quote').closest('[data-composer-token-kind="quote"]')).not.toHaveAttribute('title')
    expect(screen.getByTestId('composer-token-tooltip-content')).toHaveTextContent('first line second line')
    expect(screen.getByTestId('composer-token-tooltip-content')).not.toHaveTextContent('...')
    const tooltipBody = screen.getByTestId('composer-token-tooltip-content').firstElementChild as HTMLElement
    expect(tooltipBody).toHaveClass('whitespace-pre-wrap', 'text-left', 'overflow-hidden')
    expect(tooltipBody.className).toContain('[-webkit-line-clamp:4]')
  })

  it('unwraps prompt text before showing a quote tooltip fallback', () => {
    render(
      <ComposerToken
        token={{
          id: 'quote:1',
          kind: 'quote',
          label: 'Quote',
          promptText: '<blockquote>\n\nSelected message text\n</blockquote>'
        }}
      />
    )

    expect(screen.getByTestId('composer-token-tooltip-content')).toHaveTextContent('Selected message text')
    expect(screen.getByTestId('composer-token-tooltip-content')).not.toHaveTextContent('<blockquote>')
  })

  it('keeps native title for non-quote tokens', () => {
    render(
      <ComposerToken
        token={{
          id: 'file:1',
          kind: 'file',
          label: 'notes.md',
          description: 'Project notes'
        }}
      />
    )

    expect(screen.getByText('notes.md').closest('[data-composer-token-kind="file"]')).toHaveAttribute(
      'title',
      'Project notes'
    )
  })

  it('keeps long quoted tooltip content and clamps it visually', () => {
    const quotedContent = `${'a'.repeat(199)}😀tail`

    render(
      <ComposerToken
        token={{
          id: 'quote:1',
          kind: 'quote',
          label: 'Quote',
          description: quotedContent,
          promptText: quotedContent
        }}
      />
    )

    expect(screen.getByTestId('composer-token-tooltip-content')).toHaveTextContent(quotedContent)
    expect(screen.getByTestId('composer-token-tooltip-content')).not.toHaveTextContent(`${'a'.repeat(199)}😀...`)
    const tooltipBody = screen.getByTestId('composer-token-tooltip-content').firstElementChild as HTMLElement
    expect(tooltipBody.className).toContain('[-webkit-line-clamp:4]')
  })

  it('renders skill tokens with their own visual treatment', () => {
    const { container } = render(<ComposerToken token={{ id: 'skill:pdf', kind: 'skill', label: 'pdf' }} />)

    const token = container.querySelector('[data-composer-token-kind="skill"]')
    expect(token).toBeInTheDocument()
    expect(token).toHaveClass('border-0', 'bg-transparent', 'text-primary')
    expect(token?.querySelector('svg')).toHaveClass('text-primary')
  })

  it('does not render a prompt variable input unless the token is editing', () => {
    const onPromptVariableEditRequest = vi.fn()

    render(
      <PromptVariableToken
        token={promptVariableToken}
        selected
        onCommit={vi.fn()}
        onEditRequest={onPromptVariableEditRequest}
      />
    )

    expect(screen.queryByRole('textbox')).toBeNull()
    fireEvent.mouseDown(screen.getByText('city'))
    expect(onPromptVariableEditRequest).toHaveBeenCalled()
  })

  it('renders a selected prompt variable as an editable input without committing IME intermediates', () => {
    const onPromptVariableCommit = vi.fn()

    render(<PromptVariableToken token={promptVariableToken} selected editing onCommit={onPromptVariableCommit} />)

    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('city')

    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: 'sh' } })
    expect(onPromptVariableCommit).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: '上海' } })
    fireEvent.compositionEnd(input, { data: '上海' })
    expect(onPromptVariableCommit).not.toHaveBeenCalled()

    fireEvent.blur(input)
    expect(onPromptVariableCommit).toHaveBeenCalledWith('上海', 'blur', { dirty: true })
  })

  it('uses native content sizing for the prompt variable input with a max bound', () => {
    render(<PromptVariableToken token={promptVariableToken} selected editing onCommit={vi.fn()} />)

    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.style.minWidth).toBe('2ch')
    expect(input.style.maxWidth).toBe('56ch')
    expect(input).toHaveClass('field-sizing-content')
    expect(input.style.width).toBe('')

    fireEvent.change(input, { target: { value: '上海市浦东新区世纪大道' } })
    expect(input.style.width).toBe('')
  })

  it('does not enter prompt variable editing from selection alone', async () => {
    let editor: Editor | null = null
    render(<ComposerEditorHarness onEditor={(nextEditor) => (editor = nextEditor)} />)

    await waitFor(() => expect(editor).not.toBeNull())
    const promptVariablePosition = findComposerTokenPosition(editor!)

    act(() => {
      editor!.chain().focus().setNodeSelection(promptVariablePosition).run()
    })

    await waitFor(() => expect(editor!.state.selection.from).toBe(promptVariablePosition))
    expect(screen.queryByLabelText('${city}')).toBeNull()
  })

  it('selects and edits a prompt variable when its rendered label is clicked', async () => {
    let editor: Editor | null = null
    render(<ComposerEditorHarness onEditor={(nextEditor) => (editor = nextEditor)} />)

    await waitFor(() => expect(editor).not.toBeNull())
    const promptVariablePosition = findComposerTokenPosition(editor!)

    fireEvent.mouseDown(screen.getByText('city'))

    const input = (await screen.findByLabelText('${city}')) as HTMLInputElement
    await waitFor(() => expect(editor!.state.selection.from).toBe(promptVariablePosition))
    expect(input.value).toBe('city')
  })

  it('focuses the prompt variable input after a Tab edit request and keeps IME text inside the token node', async () => {
    let editor: Editor | null = null
    render(<ComposerEditorHarness onEditor={(nextEditor) => (editor = nextEditor)} />)

    await waitFor(() => expect(editor).not.toBeNull())

    act(() => {
      selectPromptVariableToken(editor!, 1)
    })

    const input = (await screen.findByLabelText('${city}')) as HTMLInputElement
    await waitFor(() => expect(document.activeElement).toBe(input))

    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: 'sh' } })
    expect(serializeComposerDocument(editor!).text).toBe('go ${city}')

    fireEvent.change(input, { target: { value: '上海' } })
    fireEvent.compositionEnd(input, { data: '上海' })
    expect(serializeComposerDocument(editor!).text).toBe('go ${city}')

    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(serializeComposerDocument(editor!).text).toBe('go 上海'))
    expect(screen.queryByLabelText('${city}')).toBeNull()
  })

  it('forwards select-all shortcuts from the prompt variable input to the whole composer', async () => {
    let editor: Editor | null = null
    render(<ComposerEditorHarness onEditor={(nextEditor) => (editor = nextEditor)} />)

    await waitFor(() => expect(editor).not.toBeNull())

    act(() => {
      selectPromptVariableToken(editor!, 1)
    })

    const input = (await screen.findByLabelText('${city}')) as HTMLInputElement
    await waitFor(() => expect(document.activeElement).toBe(input))

    fireEvent.change(input, { target: { value: '上海' } })
    fireEvent.keyDown(input, { key: 'a', metaKey: true })

    await waitFor(() => expect(serializeComposerDocument(editor!).text).toBe('go 上海'))
    expect(editor!.state.selection).toBeInstanceOf(AllSelection)
    expect(screen.queryByLabelText('${city}')).toBeNull()
  })

  it('commits the current prompt variable and moves to the next or previous variable on Tab', async () => {
    let editor: Editor | null = null
    render(<ComposerEditorHarness text="go ${from} to ${to}" onEditor={(nextEditor) => (editor = nextEditor)} />)

    await waitFor(() => expect(editor).not.toBeNull())

    act(() => {
      selectPromptVariableToken(editor!, 1)
    })

    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('${from}')))
    const fromInput = screen.getByLabelText('${from}') as HTMLInputElement
    fireEvent.change(fromInput, { target: { value: '上海' } })
    fireEvent.keyDown(fromInput, { key: 'Tab' })

    await waitFor(() => expect(serializeComposerDocument(editor!).text).toBe('go 上海 to ${to}'))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('${to}')))
    const toInput = screen.getByLabelText('${to}') as HTMLInputElement

    fireEvent.change(toInput, { target: { value: '北京' } })
    fireEvent.keyDown(toInput, { key: 'Tab', shiftKey: true })

    await waitFor(() => expect(serializeComposerDocument(editor!).text).toBe('go 上海 to 北京'))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('${from}')))
    const previousInput = screen.getByLabelText('${from}') as HTMLInputElement
    expect(previousInput.value).toBe('上海')
  })

  it('removes an inserted quote token with Backspace without leaving quote newlines', async () => {
    const quoteToken: ComposerDraftToken = {
      id: 'quote:1',
      kind: 'quote',
      label: 'Quote',
      description: 'Selected message text',
      promptText: '<blockquote>\n\nSelected message text\n</blockquote>\n'
    }
    let editor: Editor | null = null
    render(<ComposerEditorHarness text="Reply" onEditor={(nextEditor) => (editor = nextEditor)} />)

    await waitFor(() => expect(editor).not.toBeNull())

    act(() => {
      editor!.chain().focus().setTextSelection(1).insertComposerToken(quoteToken).insertContent(' ').run()
    })

    const quotePosition = findComposerTokenPosition(editor!)
    expect(serializeComposerDocument(editor!).text).toBe('<blockquote>\n\nSelected message text\n</blockquote> Reply')

    act(() => {
      editor!
        .chain()
        .focus()
        .command(({ tr, dispatch }) => {
          dispatch?.(tr.setSelection(NodeSelection.create(tr.doc, quotePosition)))
          return true
        })
        .run()
      editor!.commands.keyboardShortcut('Backspace')
    })

    expect(serializeComposerDocument(editor!).text).toBe(' Reply')
  })

  it('keeps normal token Backspace behavior on the shared insertion path', async () => {
    const fileToken: ComposerDraftToken = {
      id: 'file:1',
      kind: 'file',
      label: 'notes.md',
      promptText: 'notes.md'
    }
    let editor: Editor | null = null
    render(<ComposerEditorHarness text="Reply" onEditor={(nextEditor) => (editor = nextEditor)} />)

    await waitFor(() => expect(editor).not.toBeNull())

    act(() => {
      editor!.chain().focus().setTextSelection(1).insertComposerToken(fileToken).insertContent(' ').run()
    })

    const filePosition = findComposerTokenPosition(editor!)
    expect(serializeComposerDocument(editor!).text).toBe('notes.md Reply')

    act(() => {
      editor!
        .chain()
        .focus()
        .command(({ tr, dispatch }) => {
          dispatch?.(tr.setSelection(NodeSelection.create(tr.doc, filePosition)))
          return true
        })
        .run()
      editor!.commands.keyboardShortcut('Backspace')
    })

    expect(serializeComposerDocument(editor!).text).toBe(' Reply')
  })

  it('does not expose a trailing quote newline after Backspace removes the inserted separator', async () => {
    const quoteToken: ComposerDraftToken = {
      id: 'quote:1',
      kind: 'quote',
      label: 'Quote',
      description: 'Selected message text',
      promptText: '<blockquote>\n\nSelected message text\n</blockquote>\n'
    }
    let editor: Editor | null = null
    render(<ComposerEditorHarness text="" onEditor={(nextEditor) => (editor = nextEditor)} />)

    await waitFor(() => expect(editor).not.toBeNull())

    act(() => {
      editor!.chain().focus().insertComposerToken(quoteToken).insertContent(' ').run()
    })

    expect(serializeComposerDocument(editor!).text).toBe('<blockquote>\n\nSelected message text\n</blockquote> ')

    act(() => {
      editor!
        .chain()
        .focus()
        .command(({ tr, dispatch }) => {
          dispatch?.(tr.setSelection(Selection.atEnd(tr.doc)))
          return true
        })
        .run()
      const cursor = editor!.state.selection.from
      editor!
        .chain()
        .focus()
        .deleteRange({ from: cursor - 1, to: cursor })
        .run()
    })

    expect(serializeComposerDocument(editor!).text).toBe('<blockquote>\n\nSelected message text\n</blockquote>')
  })

  it('removes a quote token with Backspace when the cursor is after the token', async () => {
    const quoteToken: ComposerDraftToken = {
      id: 'quote:1',
      kind: 'quote',
      label: 'Quote',
      description: 'Selected message text',
      promptText: '<blockquote>\n\nSelected message text\n</blockquote>\n'
    }
    let editor: Editor | null = null
    render(<ComposerEditorHarness text="" onEditor={(nextEditor) => (editor = nextEditor)} />)

    await waitFor(() => expect(editor).not.toBeNull())

    act(() => {
      editor!.chain().focus().insertComposerToken(quoteToken).run()
    })

    const quotePosition = findComposerTokenPosition(editor!)
    const quoteNode = editor!.state.doc.nodeAt(quotePosition)!
    expect(serializeComposerDocument(editor!).text).toBe('<blockquote>\n\nSelected message text\n</blockquote>')

    act(() => {
      editor!
        .chain()
        .focus()
        .setTextSelection(quotePosition + quoteNode.nodeSize)
        .run()
      editor!.commands.keyboardShortcut('Backspace')
    })

    expect(serializeComposerDocument(editor!).text).toBe('')
  })

  it('removes a quote token with Delete when the cursor is before the token', async () => {
    const quoteToken: ComposerDraftToken = {
      id: 'quote:1',
      kind: 'quote',
      label: 'Quote',
      description: 'Selected message text',
      promptText: '<blockquote>\n\nSelected message text\n</blockquote>\n'
    }
    let editor: Editor | null = null
    render(<ComposerEditorHarness text="" onEditor={(nextEditor) => (editor = nextEditor)} />)

    await waitFor(() => expect(editor).not.toBeNull())

    act(() => {
      editor!.chain().focus().insertComposerToken(quoteToken).run()
    })

    const quotePosition = findComposerTokenPosition(editor!)
    expect(serializeComposerDocument(editor!).text).toBe('<blockquote>\n\nSelected message text\n</blockquote>')

    act(() => {
      editor!.chain().focus().setTextSelection(quotePosition).run()
      editor!.commands.keyboardShortcut('Delete')
    })

    expect(serializeComposerDocument(editor!).text).toBe('')
  })

  it('does not create a prompt variable input when the whole composer is selected', async () => {
    let editor: Editor | null = null
    render(<ComposerEditorHarness onEditor={(nextEditor) => (editor = nextEditor)} />)

    await waitFor(() => expect(editor).not.toBeNull())

    act(() => {
      editor!
        .chain()
        .focus()
        .command(({ tr, dispatch }) => {
          dispatch?.(tr.setSelection(new AllSelection(tr.doc)))
          return true
        })
        .run()
    })

    await waitFor(() => expect(editor!.state.selection).toBeInstanceOf(AllSelection))
    expect(screen.queryByLabelText('${city}')).toBeNull()
  })
})
