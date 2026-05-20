import { Tooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import NarrowLayout from '@renderer/components/chat/layout/NarrowLayout'
import type {
  QuickPanelContextType,
  QuickPanelInputAdapter,
  QuickPanelTriggerInfo
} from '@renderer/components/QuickPanel'
import { QuickPanelReservedSymbol, QuickPanelView, useQuickPanel } from '@renderer/components/QuickPanel'
import { useRichTextEditorKernel } from '@renderer/components/RichEditor/useRichTextEditorKernel'
import TranslateButton from '@renderer/components/TranslateButton'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { useTimer } from '@renderer/hooks/useTimer'
import { useFileDragDrop } from '@renderer/pages/home/Inputbar/hooks/useFileDragDrop'
import { usePasteHandler } from '@renderer/pages/home/Inputbar/hooks/usePasteHandler'
import SendMessageButton from '@renderer/pages/home/Inputbar/SendMessageButton'
import PasteService from '@renderer/services/PasteService'
import type { FileMetadata } from '@renderer/types'
import type { SendMessageShortcut } from '@shared/data/preference/preferenceTypes'
import type { JSONContent } from '@tiptap/core'
import type { Editor } from '@tiptap/react'
import { EditorContent } from '@tiptap/react'
import { CirclePause } from 'lucide-react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { serializeComposerDocument } from './composerDraft'
import { createComposerEditorPreset } from './composerPreset'
import type { ComposerSuggestionItem, ComposerSuggestionSource } from './ComposerSuggestion'
import { COMPOSER_TOKEN_NODE_NAME } from './ComposerTokenNode'
import type { ComposerDraftToken, ComposerSerializedDraft, ComposerSerializedToken } from './tokens'
import type { ComposerToolLauncher } from './toolLauncher'

export interface ComposerSurfaceActions {
  resizeTextArea: () => void
  onTextChange: (updater: string | ((prev: string) => string)) => void
  toggleExpanded: (nextState?: boolean) => void
}

export interface ComposerSurfaceProps {
  text: string
  onTextChange: (text: string) => void
  tokens: readonly ComposerDraftToken[]
  managedTokenKinds: readonly ComposerDraftToken['kind'][]
  onTokensChange: (tokens: readonly ComposerSerializedToken[]) => void
  placeholder: string
  sendDisabled: boolean
  sendBlockedReason?: string
  isLoading: boolean
  onSendDraft: (draft: ComposerSerializedDraft) => void | Promise<void>
  onPause: () => void | Promise<void>
  supportedExts: string[]
  setFiles: React.Dispatch<React.SetStateAction<FileMetadata[]>>
  filesCount: number
  isExpanded: boolean
  onExpandedChange: (expanded: boolean) => void
  quickPanelEnabled: boolean
  enableQuickPanelTriggers: boolean
  enableDragDrop: boolean
  enableSpellCheck: boolean
  editable?: boolean
  fontSize: number
  narrowMode: boolean
  onFocus?: () => void
  onActionsChange?: (actions: ComposerSurfaceActions) => void
  getToolLaunchers?: () => ComposerToolLauncher[]
  suggestionSources?: readonly ComposerSuggestionSource[]
  topContent?: React.ReactNode
  onToolLauncherSelect?: (
    launcher: ComposerToolLauncher,
    options: {
      source: 'root-panel'
      inputAdapter?: QuickPanelInputAdapter
      quickPanel: QuickPanelContextType
      triggerInfo?: QuickPanelTriggerInfo
      searchText?: string
    }
  ) => void
  renderLeftControls?: (inputAdapter?: QuickPanelInputAdapter) => React.ReactNode
  renderBelowControls?: (inputAdapter?: QuickPanelInputAdapter) => React.ReactNode
}

function createPlainTextContent(text: string): JSONContent {
  if (!text) return { type: 'doc', content: [{ type: 'paragraph' }] }

  const content = text.split('\n').flatMap<JSONContent>((line, index) => {
    const nodes: JSONContent[] = []
    if (index > 0) nodes.push({ type: 'hardBreak' })
    if (line) nodes.push({ type: 'text', text: line })
    return nodes
  })

  return {
    type: 'doc',
    content: [{ type: 'paragraph', content }]
  }
}

function removeComposerTokens(editor: Editor, shouldRemove: (token: ComposerSerializedToken) => boolean) {
  const ranges: Array<{ from: number; to: number }> = []

  editor.state.doc.descendants((node, position) => {
    if (node.type.name !== COMPOSER_TOKEN_NODE_NAME) return
    const draft = serializeComposerDocument({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: COMPOSER_TOKEN_NODE_NAME, attrs: node.attrs }] }]
    })
    const token = draft.tokens[0]
    if (token && shouldRemove(token)) {
      ranges.push({ from: position, to: position + node.nodeSize })
    }
  })

  if (!ranges.length) return

  const transaction = editor.state.tr
  for (const range of ranges.reverse()) {
    transaction.delete(range.from, range.to)
  }
  editor.view.dispatch(transaction)
}

function addMissingToken(
  editor: Editor,
  token: ComposerDraftToken,
  existingTokens: readonly ComposerSerializedToken[]
) {
  if (existingTokens.some((existing) => existing.id === token.id)) return
  editor.chain().focus().insertComposerToken(token).insertContent(' ').run()
}

function isComposerSendKeyPressed(event: KeyboardEvent, shortcut: SendMessageShortcut) {
  switch (shortcut) {
    case 'Enter':
      return !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey
    case 'Ctrl+Enter':
      return event.ctrlKey && !event.shiftKey && !event.metaKey && !event.altKey
    case 'Command+Enter':
      return event.metaKey && !event.shiftKey && !event.ctrlKey && !event.altKey
    case 'Alt+Enter':
      return event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey
    case 'Shift+Enter':
      return event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey
  }
}

function getComposerCursorTextOffset(editor: Editor) {
  return editor.state.doc.textBetween(0, editor.state.selection.from, '\n', '').length
}

function deleteComposerTextBeforeCursor(editor: Editor, range: { from: number; to: number }) {
  const length = Math.max(0, range.to - range.from)
  if (length === 0) return
  const to = editor.state.selection.from
  editor
    .chain()
    .focus()
    .deleteRange({ from: Math.max(1, to - length), to })
    .run()
}

function createComposerInputAdapter(editor: Editor): QuickPanelInputAdapter {
  return {
    getText: () => serializeComposerDocument(editor).text,
    getCursorOffset: () => getComposerCursorTextOffset(editor),
    insertText: (insertedText) => {
      editor.chain().focus().insertContent(insertedText).run()
    },
    insertToken: (token) => {
      editor
        .chain()
        .focus()
        .insertComposerToken(token as ComposerDraftToken)
        .insertContent(' ')
        .run()
    },
    deleteTriggerRange: (range) => {
      deleteComposerTextBeforeCursor(editor, range)
    },
    focus: () => {
      editor.commands.focus()
    }
  }
}

function getLauncherSearchText(launcher: ComposerToolLauncher) {
  return [launcher.label, launcher.description].map((value) => (typeof value === 'string' ? value : '')).join(' ')
}

function createRootSuggestionItem(
  launcher: ComposerToolLauncher,
  options: {
    quickPanel: QuickPanelContextType
    onToolLauncherSelect?: ComposerSurfaceProps['onToolLauncherSelect']
  }
): ComposerSuggestionItem {
  return {
    id: launcher.id,
    label: launcher.label,
    description: launcher.description,
    icon: launcher.icon,
    filterText: getLauncherSearchText(launcher),
    disabled: launcher.disabled,
    isMenu: launcher.kind === 'panel' || launcher.kind === 'group',
    command: ({ editor, query }) => {
      options.onToolLauncherSelect?.(launcher, {
        source: 'root-panel',
        inputAdapter: createComposerInputAdapter(editor),
        quickPanel: options.quickPanel,
        triggerInfo: { type: 'button' },
        searchText: query
      })
    }
  }
}

function filterSuggestionItems(items: readonly ComposerSuggestionItem[], query: string) {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return [...items]

  return items.filter((item) =>
    [item.label, item.description, item.filterText]
      .map((value) => (typeof value === 'string' ? value.toLowerCase() : ''))
      .some((value) => value.includes(normalizedQuery))
  )
}

const getTokenIds = (tokens: readonly ComposerDraftToken[]) => new Set(tokens.map((token) => token.id))

function getComposerEditorMinHeight(fontSize: number) {
  return Math.ceil(fontSize * 1.4 * 2 + 6)
}

function getComposerEditorStyle(fontSize: number) {
  return [
    '--composer-editor-padding: 6px 15px 0',
    `--composer-editor-min-height: ${getComposerEditorMinHeight(fontSize)}px`,
    `--composer-editor-font-size: ${fontSize}px`,
    '--composer-editor-line-height: 1.4'
  ].join('; ')
}

export default function ComposerSurface({
  text,
  onTextChange,
  tokens,
  managedTokenKinds,
  onTokensChange,
  placeholder,
  sendDisabled,
  sendBlockedReason,
  isLoading,
  onSendDraft,
  onPause,
  supportedExts,
  setFiles,
  filesCount,
  isExpanded,
  onExpandedChange,
  quickPanelEnabled,
  enableQuickPanelTriggers,
  enableDragDrop,
  enableSpellCheck,
  editable = true,
  fontSize,
  narrowMode,
  onFocus,
  onActionsChange,
  getToolLaunchers,
  suggestionSources = [],
  topContent,
  onToolLauncherSelect,
  renderLeftControls,
  renderBelowControls
}: ComposerSurfaceProps) {
  const [pasteLongTextAsFile] = usePreference('chat.input.paste_long_text_as_file')
  const [pasteLongTextThreshold] = usePreference('chat.input.paste_long_text_threshold')
  const [sendMessageShortcut] = usePreference('chat.input.send_message_shortcut')
  const { t } = useTranslation()
  const quickPanel = useQuickPanel()
  const { setTimeoutTimer } = useTimer()
  const [customHeight, setCustomHeight] = useState<number | undefined>()
  const editorMinHeight = getComposerEditorMinHeight(fontSize)
  const editorRef = useRef<Editor | null>(null)
  const textRef = useRef(text)
  const inputListenersRef = useRef(new Set<(event?: { isComposing?: boolean }) => void>())
  const isSyncingTokensRef = useRef(false)
  const sendDisabledRef = useRef(sendDisabled)
  const sendBlockedReasonRef = useRef(sendBlockedReason)
  const onSendDraftRef = useRef(onSendDraft)
  const previousTextRef = useRef(text)
  const managedTokenKindSet = useMemo(() => new Set(managedTokenKinds), [managedTokenKinds])

  useEffect(() => {
    textRef.current = text
    previousTextRef.current = text
  }, [text])

  useEffect(() => {
    sendDisabledRef.current = sendDisabled
  }, [sendDisabled])

  useEffect(() => {
    sendBlockedReasonRef.current = sendBlockedReason
  }, [sendBlockedReason])

  useEffect(() => {
    onSendDraftRef.current = onSendDraft
  }, [onSendDraft])

  const showBlockedSendReason = useCallback(() => {
    if (sendBlockedReasonRef.current) {
      window.toast?.error(sendBlockedReasonRef.current)
    }
  }, [])

  const setText = useCallback<React.Dispatch<React.SetStateAction<string>>>(
    (value) => {
      const nextText = typeof value === 'function' ? value(textRef.current) : value
      onTextChange(nextText)
    },
    [onTextChange]
  )

  const { handlePaste } = usePasteHandler(text, setText, {
    supportedExts,
    setFiles,
    pasteLongTextAsFile,
    pasteLongTextThreshold,
    onResize: () => undefined,
    t
  })

  const { handleDragEnter, handleDragLeave, handleDragOver, handleDrop, isDragging } = useFileDragDrop({
    supportedExts,
    setFiles,
    onTextDropped: (droppedText) => editorRef.current?.chain().focus().insertContent(droppedText).run(),
    enabled: enableDragDrop,
    t
  })

  const focusEditor = useCallback(() => {
    editorRef.current?.commands.focus()
  }, [])

  const handleToggleExpanded = useCallback(
    (nextState?: boolean) => {
      const target = typeof nextState === 'boolean' ? nextState : !isExpanded
      onExpandedChange(target)
      setCustomHeight(target ? Math.max(220, Math.round(window.innerHeight * 0.5)) : undefined)
      focusEditor()
    },
    [focusEditor, isExpanded, onExpandedChange]
  )

  const handleTextChangeFromTool = useCallback(
    (updater: string | ((prev: string) => string)) => {
      const currentText = editorRef.current ? serializeComposerDocument(editorRef.current).text : textRef.current
      const nextText = typeof updater === 'function' ? updater(currentText) : updater
      onTextChange(nextText)
    },
    [onTextChange]
  )

  useEffect(() => {
    onActionsChange?.({
      resizeTextArea: () => undefined,
      onTextChange: handleTextChangeFromTool,
      toggleExpanded: handleToggleExpanded
    })
  }, [handleTextChangeFromTool, handleToggleExpanded, onActionsChange])

  const rootSuggestionStateRef = useRef({ getToolLaunchers, onToolLauncherSelect, quickPanel })
  rootSuggestionStateRef.current = { getToolLaunchers, onToolLauncherSelect, quickPanel }

  const rootSuggestionSource = useMemo<ComposerSuggestionSource>(
    () => ({
      pluginKey: 'composer-root-suggestion',
      char: QuickPanelReservedSymbol.Root,
      allowedPrefixes: [' ', '\n'],
      items: ({ query }) => {
        const { getToolLaunchers, onToolLauncherSelect, quickPanel } = rootSuggestionStateRef.current
        const items = (getToolLaunchers?.() ?? [])
          .filter((launcher) => !launcher.hidden)
          .map((launcher) => createRootSuggestionItem(launcher, { onToolLauncherSelect, quickPanel }))
        return filterSuggestionItems(items, query)
      }
    }),
    []
  )

  const activeSuggestionSources = useMemo(
    () => (quickPanelEnabled && enableQuickPanelTriggers ? [rootSuggestionSource, ...suggestionSources] : []),
    [enableQuickPanelTriggers, quickPanelEnabled, rootSuggestionSource, suggestionSources]
  )

  const editorExtensions = useMemo(
    () => createComposerEditorPreset({ placeholder, suggestionSources: activeSuggestionSources }),
    [activeSuggestionSources, placeholder]
  )

  const editor = useRichTextEditorKernel({
    extensions: editorExtensions,
    content: createPlainTextContent(text),
    editable,
    enableSpellCheck,
    editorProps: {
      attributes: {
        class:
          'composer-tiptap box-border flex max-h-[500px]! w-full overflow-auto rounded-none text-foreground outline-none transition-none! break-words whitespace-pre-wrap after:hidden! [&::-webkit-scrollbar]:w-[3px]',
        style: getComposerEditorStyle(fontSize)
      },
      handleKeyDown: (_view, event) => {
        if (event.key === 'Escape' && isExpanded) {
          event.stopPropagation()
          handleToggleExpanded(false)
          return true
        }

        const isEnterPressed = event.key === 'Enter' && !event.isComposing
        if (isEnterPressed && isComposerSendKeyPressed(event, sendMessageShortcut)) {
          if (!sendDisabledRef.current && editorRef.current) {
            const draft = serializeComposerDocument(editorRef.current)
            void Promise.resolve(onSendDraftRef.current(draft)).finally(focusEditor)
          } else {
            showBlockedSendReason()
          }
          event.preventDefault()
          return true
        }

        if (event.key === 'Backspace' && textRef.current.trim().length === 0 && filesCount > 0) {
          setFiles((prev) => prev.slice(0, -1))
          event.preventDefault()
          return true
        }

        return false
      }
    },
    handlePaste: (_view, event) => {
      void handlePaste(event)
      return false
    },
    onUpdate: ({ editor: updatedEditor }) => {
      const draft = serializeComposerDocument(updatedEditor)
      const nextText = draft.text
      previousTextRef.current = nextText
      textRef.current = nextText
      onTextChange(nextText)
      inputListenersRef.current.forEach((listener) => listener({ isComposing: updatedEditor.view.composing }))

      if (!isSyncingTokensRef.current) {
        onTokensChange(draft.tokens)
      }
    },
    onCreate: ({ editor: createdEditor }) => {
      setTimeoutTimer('composerSurfaceFocus', () => createdEditor.commands.focus(), 0)
    },
    shouldRerenderOnTransaction: true
  })

  useEffect(() => {
    editorRef.current = editor
  }, [editor])

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const currentText = serializeComposerDocument(editor).text
    if (currentText === text) return
    editor.commands.setContent(createPlainTextContent(text), { emitUpdate: false })
  }, [editor, text])

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const draft = serializeComposerDocument(editor)
    const desiredTokenIds = getTokenIds(tokens)
    isSyncingTokensRef.current = true

    try {
      for (const token of tokens) {
        addMissingToken(editor, token, draft.tokens)
      }

      removeComposerTokens(editor, (token) => managedTokenKindSet.has(token.kind) && !desiredTokenIds.has(token.id))
    } finally {
      isSyncingTokensRef.current = false
    }
  }, [editor, managedTokenKindSet, tokens])

  const inputAdapter = useMemo<QuickPanelInputAdapter | undefined>(() => {
    if (!editor) return undefined

    return {
      getText: () => serializeComposerDocument(editor).text,
      getCursorOffset: () => getComposerCursorTextOffset(editor),
      insertText: (insertedText) => {
        editor.chain().focus().insertContent(insertedText).run()
      },
      insertToken: (token) => {
        editor
          .chain()
          .focus()
          .insertComposerToken(token as ComposerDraftToken)
          .insertContent(' ')
          .run()
      },
      deleteTriggerRange: (range) => {
        deleteComposerTextBeforeCursor(editor, range)
      },
      focus: () => {
        editor.commands.focus()
      },
      subscribeInput: (listener) => {
        inputListenersRef.current.add(listener)
        return () => {
          inputListenersRef.current.delete(listener)
        }
      }
    }
  }, [editor])

  useEffect(() => {
    PasteService.init()
    PasteService.registerHandler('inputbar', handlePaste)
    return () => {
      PasteService.unregisterHandler('inputbar')
    }
  }, [handlePaste])

  const sendDraft = useCallback(() => {
    if (!editor) return
    if (sendDisabled) {
      showBlockedSendReason()
      return
    }
    const draft = serializeComposerDocument(editor)
    void Promise.resolve(onSendDraft(draft)).finally(focusEditor)
  }, [editor, focusEditor, onSendDraft, sendDisabled, showBlockedSendReason])

  const onTranslated = useCallback(
    (translatedText: string) => {
      onTextChange(translatedText)
      editor?.commands.setContent(createPlainTextContent(translatedText), { emitUpdate: false })
    },
    [editor, onTextChange]
  )

  const quickPanelElement = quickPanelEnabled ? (
    <QuickPanelView setInputText={setText} inputAdapter={inputAdapter} />
  ) : null
  const belowControls = renderBelowControls?.(inputAdapter)
  const inputbarElement = (
    <div
      id="inputbar"
      className={cn(
        'inputbar-container relative rounded-[17px] border-(--color-border) border-[0.5px] bg-muted/50 pt-2 transition-all duration-200 ease-in-out',
        belowControls
          ? 'mb-0.5 shadow-[0_10px_24px_rgba(15,23,42,0.08)] dark:shadow-[0_10px_24px_rgba(0,0,0,0.22)]'
          : 'mb-3',
        isDragging &&
          "border-2 border-[#2ecc71] border-dashed before:pointer-events-none before:absolute before:inset-0 before:z-5 before:rounded-[14px] before:bg-[rgba(46,204,113,0.03)] before:content-['']",
        isExpanded && 'expanded'
      )}>
      <div style={customHeight ? { height: customHeight } : { minHeight: editorMinHeight }}>
        <EditorContent
          editor={editor}
          style={{ minHeight: editorMinHeight }}
          onFocus={() => {
            onFocus?.()
            PasteService.setLastFocusedComponent('inputbar')
          }}
        />
      </div>

      <div className="relative z-2 flex h-10 shrink-0 flex-row justify-between gap-4 px-2 py-[5px]">
        <div className="flex min-w-0 flex-1 items-center overflow-hidden">{renderLeftControls?.(inputAdapter)}</div>
        <div className="flex flex-row items-center gap-1.5">
          <TranslateButton text={text} disabled={sendDisabled} onTranslated={onTranslated} />
          {isLoading ? (
            <Tooltip content={t('chat.input.pause')} placement="top">
              <button
                type="button"
                className="flex size-[30px] items-center justify-center rounded-full text-(--color-error-base) hover:bg-accent"
                aria-label={t('chat.input.pause')}
                onClick={() => void onPause()}>
                <CirclePause size={20} />
              </button>
            </Tooltip>
          ) : (
            <SendMessageButton
              sendMessage={sendDraft}
              disabled={sendDisabled}
              onDisabledClick={showBlockedSendReason}
            />
          )}
        </div>
      </div>
    </div>
  )

  return (
    <NarrowLayout narrowMode={narrowMode} style={{ width: '100%' }}>
      <div className="w-full">
        {topContent ? <div className="mb-6 flex justify-center">{topContent}</div> : null}
        <div
          className="inputbar relative z-2 flex flex-col pt-0"
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}>
          {quickPanelElement}
          {belowControls ? (
            <div className="mb-6 rounded-[20px] bg-muted/25 pb-1.5 shadow-[0_14px_36px_rgba(15,23,42,0.07)] dark:bg-muted/15 dark:shadow-[0_14px_36px_rgba(0,0,0,0.24)]">
              {inputbarElement}
              <div className="px-2">{belowControls}</div>
            </div>
          ) : (
            inputbarElement
          )}
        </div>
      </div>
    </NarrowLayout>
  )
}
