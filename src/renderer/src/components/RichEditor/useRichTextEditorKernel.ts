import type { EditorOptions } from '@tiptap/core'
import { useEditor, type UseEditorOptions } from '@tiptap/react'
import { useEffect, useMemo } from 'react'

export interface UseRichTextEditorKernelOptions {
  extensions: EditorOptions['extensions']
  content?: EditorOptions['content']
  editable?: boolean
  placeholder?: string
  enableSpellCheck?: boolean
  shouldRerenderOnTransaction?: boolean
  editorProps?: EditorOptions['editorProps']
  handlePaste?: EditorOptions['editorProps']['handlePaste']
  onUpdate?: EditorOptions['onUpdate']
  onBlur?: EditorOptions['onBlur']
  onCreate?: EditorOptions['onCreate']
}

export function useRichTextEditorKernel({
  extensions,
  content = '',
  editable = true,
  enableSpellCheck = false,
  shouldRerenderOnTransaction = false,
  editorProps,
  handlePaste,
  onUpdate,
  onBlur,
  onCreate
}: UseRichTextEditorKernelOptions) {
  const mergedEditorProps = useMemo<EditorOptions['editorProps']>(() => {
    const baseAttributes = editorProps?.attributes ?? {}

    return {
      ...editorProps,
      ...(handlePaste && { handlePaste }),
      attributes: {
        ...baseAttributes,
        style: editable
          ? ''
          : 'user-select: text; -webkit-user-select: text; -moz-user-select: text; -ms-user-select: text;',
        spellcheck: enableSpellCheck ? 'true' : 'false'
      }
    }
  }, [editable, editorProps, enableSpellCheck, handlePaste])

  const options = useMemo<UseEditorOptions>(
    () => ({
      shouldRerenderOnTransaction,
      extensions,
      content,
      editable,
      editorProps: mergedEditorProps,
      onUpdate,
      onBlur,
      onCreate
    }),
    [content, editable, extensions, mergedEditorProps, onBlur, onCreate, onUpdate, shouldRerenderOnTransaction]
  )

  const editor = useEditor(options)

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    editor.setEditable(editable)
  }, [editor, editable])

  return editor
}
