import { Button, Tooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { useChatLayoutMode } from '@renderer/components/chat/layout/ChatLayoutModeContext'
import NarrowLayout from '@renderer/components/chat/layout/NarrowLayout'
import type { QuickPanelInputAdapter, QuickPanelListItem } from '@renderer/components/QuickPanel'
import { QuickPanelReservedSymbol, QuickPanelView, useQuickPanel } from '@renderer/components/QuickPanel'
import { useRichTextEditorKernel } from '@renderer/components/RichEditor/useRichTextEditorKernel'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { useTimer } from '@renderer/hooks/useTimer'
import { useFileDragDrop } from '@renderer/pages/home/Inputbar/hooks/useFileDragDrop'
import { usePasteHandler } from '@renderer/pages/home/Inputbar/hooks/usePasteHandler'
import SendMessageButton from '@renderer/pages/home/Inputbar/SendMessageButton'
import PasteService from '@renderer/services/PasteService'
import type { FileMetadata } from '@renderer/types'
import type { SendMessageShortcut } from '@shared/data/preference/preferenceTypes'
import type { Editor } from '@tiptap/react'
import { EditorContent } from '@tiptap/react'
import { CirclePause, Maximize, Minimize } from 'lucide-react'
import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { serializeComposerDocument } from './composerDraft'
import { getComposerPlainTextPasteOverride } from './composerPaste'
import { createComposerEditorPreset } from './composerPreset'
import { COMPOSER_TOKEN_NODE_NAME } from './ComposerTokenNode'
import {
  createPromptVariableContent,
  createPromptVariableInlineContent,
  getNextPromptVariableIndex,
  getSelectedPromptVariableToken,
  selectPromptVariableToken,
  tokenizePromptVariablesInEditor,
  updateSelectedPromptVariableToken
} from './promptVariables'
import {
  type ComposerRootPanelSelectHandler,
  type ComposerSuggestionSource,
  createComposerSuggestionQuickPanelItem,
  createRootQuickPanelOpenOptions,
  getComposerCursorTextOffset,
  getComposerInputText,
  getComposerPositionAtTextOffset,
  getComposerSuggestionTriggerContext,
  hasComposerQuickPanelTriggerBoundary,
  ROOT_QUICK_PANEL_ALLOWED_PREFIXES
} from './quickPanel'
import type { ComposerDraftToken, ComposerSerializedDraft, ComposerSerializedToken } from './tokens'
import type { ComposerToolLauncher } from './toolLauncher'

export interface ComposerSurfaceActions {
  onTextChange: (updater: string | ((prev: string) => string)) => void
  toggleExpanded: (nextState?: boolean) => void
  removeToken: (tokenId: string) => void
  insertToken: (token: ComposerDraftToken) => void
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
  resolveSkillMarker?: (marker: string) => ComposerDraftToken | null | undefined
  suggestionSources?: readonly ComposerSuggestionSource[]
  queueContent?: React.ReactNode
  rootPanelAdditionalItems?: readonly QuickPanelListItem[]
  onToolLauncherSelect?: ComposerRootPanelSelectHandler
  renderLeftControls?: (inputAdapter?: QuickPanelInputAdapter) => React.ReactNode
  renderBelowControls?: (inputAdapter?: QuickPanelInputAdapter) => React.ReactNode
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
  insertComposerTokenAtCursor(editor, token, { insertSeparator: token.kind !== 'model' })
}

function hasComposerTokenBeforeSelection(editor: Editor) {
  const selection = editor.state.selection
  const selectedNode = (selection as { node?: { type?: { name?: string } } }).node
  if (selectedNode?.type?.name === COMPOSER_TOKEN_NODE_NAME) return true
  if (!selection.empty) return false

  return selection.$from.nodeBefore?.type.name === COMPOSER_TOKEN_NODE_NAME
}

function insertComposerTokenAtCursor(
  editor: Editor,
  token: ComposerDraftToken,
  options: { insertSeparator?: boolean } = {}
) {
  const chain = editor.chain().focus().insertComposerToken(token)
  if (options.insertSeparator === false) {
    chain.run()
    return
  }

  chain.insertContent(' ').run()
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

function deleteComposerTextRange(editor: Editor, range: { from: number; to: number }) {
  const fromOffset = Math.max(0, Math.min(range.from, range.to))
  const toOffset = Math.max(fromOffset, range.to)
  if (fromOffset === toOffset) return

  const from = getComposerPositionAtTextOffset(editor, fromOffset)
  const to = getComposerPositionAtTextOffset(editor, toOffset)
  if (to <= from) return

  editor.chain().focus().deleteRange({ from, to }).run()
}

function createComposerInputAdapter(editor: Editor): QuickPanelInputAdapter {
  return {
    getText: () => getComposerInputText(editor),
    getCursorOffset: () => getComposerCursorTextOffset(editor),
    insertText: (insertedText) => {
      editor
        .chain()
        .focus()
        .insertContent(
          createPromptVariableInlineContent(insertedText, { startIndex: getNextPromptVariableIndex(editor) })
        )
        .run()
    },
    insertToken: (token) => {
      insertComposerTokenAtCursor(editor, token as ComposerDraftToken)
    },
    deleteTriggerRange: (range) => {
      deleteComposerTextRange(editor, range)
    },
    focus: () => {
      editor.commands.focus()
    }
  }
}

const getTokenIds = (tokens: readonly ComposerDraftToken[]) => new Set(tokens.map((token) => token.id))
const getManagedTokenSignature = (
  tokens: readonly ComposerSerializedToken[],
  managedTokenKindSet: ReadonlySet<ComposerDraftToken['kind']>
) =>
  tokens
    .filter((token) => managedTokenKindSet.has(token.kind))
    .map((token) => `${token.kind}:${token.id}`)
    .join('\n')

function shouldUseNativeLongTextPaste(text: string, pasteLongTextAsFile?: boolean, pasteLongTextThreshold?: number) {
  return Boolean(text && pasteLongTextAsFile && pasteLongTextThreshold && text.length > pasteLongTextThreshold)
}

const COMPOSER_EDITOR_COLLAPSED_MAX_HEIGHT = 'max(220px, 40vh)'
const COMPOSER_EDITOR_EXPANDED_MAX_HEIGHT = 'max(220px, 50vh)'
const COMPOSER_EDITOR_COLLAPSED_MAX_HEIGHT_CLASS = 'max-h-[max(220px,40vh)]!'
const COMPOSER_EDITOR_EXPANDED_MAX_HEIGHT_CLASS = 'max-h-[max(220px,50vh)]!'

function getComposerEditorMinHeight(fontSize: number) {
  return Math.ceil(fontSize * 1.4 * 2 + 6)
}

function getComposerEditorStyle(fontSize: number, isExpanded: boolean) {
  const maxHeight = isExpanded ? COMPOSER_EDITOR_EXPANDED_MAX_HEIGHT : COMPOSER_EDITOR_COLLAPSED_MAX_HEIGHT

  return [
    '--composer-editor-padding: 6px 15px 0',
    `--composer-editor-min-height: ${getComposerEditorMinHeight(fontSize)}px`,
    `--composer-editor-font-size: ${fontSize}px`,
    '--composer-editor-line-height: 1.4',
    `max-height: ${maxHeight}`,
    'overflow-y: auto',
    isExpanded ? 'height: 100%' : undefined
  ]
    .filter(Boolean)
    .join('; ')
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
  resolveSkillMarker,
  suggestionSources = [],
  queueContent,
  rootPanelAdditionalItems,
  onToolLauncherSelect,
  renderLeftControls,
  renderBelowControls
}: ComposerSurfaceProps) {
  const [pasteLongTextAsFile] = usePreference('chat.input.paste_long_text_as_file')
  const [pasteLongTextThreshold] = usePreference('chat.input.paste_long_text_threshold')
  const [sendMessageShortcut] = usePreference('chat.input.send_message_shortcut')
  const { t } = useTranslation()
  const quickPanel = useQuickPanel()
  const { forceWideLayout } = useChatLayoutMode()
  const { setTimeoutTimer } = useTimer()
  const editorMinHeight = getComposerEditorMinHeight(fontSize)
  const editorRef = useRef<Editor | null>(null)
  const textRef = useRef(text)
  const pendingLocalTextEchoRef = useRef<string | null>(null)
  const inputListenersRef = useRef(new Set<(event?: { isComposing?: boolean }) => void>())
  const isSyncingTokensRef = useRef(false)
  const managedTokenSignatureRef = useRef('')
  const sendDisabledRef = useRef(sendDisabled)
  const sendBlockedReasonRef = useRef(sendBlockedReason)
  const onSendDraftRef = useRef(onSendDraft)
  const promptVariableEditRef = useRef<{ tokenId: string; started: boolean } | null>(null)
  const promptVariableCompositionRef = useRef<{ tokenId: string; text: string } | null>(null)
  const promptVariableSkipTextInputRef = useRef<{ tokenId: string; text: string } | null>(null)
  const managedTokenKindSet = useMemo(() => new Set(managedTokenKinds), [managedTokenKinds])

  useEffect(() => {
    textRef.current = text
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

  const applyComposerText = useCallback(
    (nextText: string) => {
      textRef.current = nextText
      pendingLocalTextEchoRef.current = nextText
      onTextChange(nextText)
      editorRef.current?.commands.setContent(createPromptVariableContent(nextText), { emitUpdate: false })
    },
    [onTextChange]
  )

  const setText = useCallback<React.Dispatch<React.SetStateAction<string>>>(
    (value) => {
      const nextText = typeof value === 'function' ? value(textRef.current) : value
      applyComposerText(nextText)
    },
    [applyComposerText]
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
    onTextDropped: (droppedText) => {
      const editor = editorRef.current
      if (!editor) return
      editor
        .chain()
        .focus()
        .insertContent(
          createPromptVariableInlineContent(droppedText, { startIndex: getNextPromptVariableIndex(editor) })
        )
        .run()
    },
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
      focusEditor()
    },
    [focusEditor, isExpanded, onExpandedChange]
  )

  const handleTextChangeFromTool = useCallback(
    (updater: string | ((prev: string) => string)) => {
      const currentText = editorRef.current ? serializeComposerDocument(editorRef.current).text : textRef.current
      const nextText = typeof updater === 'function' ? updater(currentText) : updater
      applyComposerText(nextText)
    },
    [applyComposerText]
  )

  const removeToken = useCallback((tokenId: string) => {
    const editor = editorRef.current
    if (!editor || editor.isDestroyed) return
    removeComposerTokens(editor, (token) => token.id === tokenId)
    editor.commands.focus()
  }, [])

  const insertToken = useCallback((token: ComposerDraftToken) => {
    const editor = editorRef.current
    if (!editor || editor.isDestroyed) return

    insertComposerTokenAtCursor(editor, token)
  }, [])

  useEffect(() => {
    onActionsChange?.({
      onTextChange: handleTextChangeFromTool,
      toggleExpanded: handleToggleExpanded,
      removeToken,
      insertToken
    })
  }, [handleTextChangeFromTool, handleToggleExpanded, insertToken, onActionsChange, removeToken])

  const rootSuggestionStateRef = useRef({
    getToolLaunchers,
    onToolLauncherSelect,
    quickPanel,
    rootPanelAdditionalItems
  })
  rootSuggestionStateRef.current = { getToolLaunchers, onToolLauncherSelect, quickPanel, rootPanelAdditionalItems }

  const rootSuggestionSource = useMemo<ComposerSuggestionSource>(
    () => ({
      pluginKey: 'composer-root-suggestion',
      char: QuickPanelReservedSymbol.Root,
      title: t('settings.quickPanel.title'),
      renderMode: 'headless',
      allowedPrefixes: ROOT_QUICK_PANEL_ALLOWED_PREFIXES,
      items: () => [],
      onActiveChange: ({ editor, query, range, text }) => {
        const { getToolLaunchers, onToolLauncherSelect, quickPanel, rootPanelAdditionalItems } =
          rootSuggestionStateRef.current
        const launchers = getToolLaunchers?.() ?? []
        const { cursorOffset, queryAnchor, textBeforeTrigger, triggerText } = getComposerSuggestionTriggerContext(
          editor,
          {
            range,
            query,
            text,
            triggerChar: QuickPanelReservedSymbol.Root
          }
        )

        if (
          !hasComposerQuickPanelTriggerBoundary(textBeforeTrigger) ||
          cursorOffset !== queryAnchor + triggerText.length
        ) {
          if (quickPanel.isVisible && quickPanel.symbol === QuickPanelReservedSymbol.Root) {
            quickPanel.close('input_prefix_invalid')
          }
          return
        }

        const triggerInfo = {
          type: 'input',
          position: queryAnchor,
          originalText: triggerText
        } as const

        quickPanel.open(
          createRootQuickPanelOpenOptions(launchers, {
            onToolLauncherSelect,
            inputAdapter: createComposerInputAdapter(editor),
            quickPanel,
            title: t('settings.quickPanel.title'),
            additionalItems: rootPanelAdditionalItems,
            queryAnchor,
            triggerInfo
          })
        )
      },
      onKeyDown: ({ event }) => {
        return rootSuggestionStateRef.current.quickPanel.dispatchKeyDown(event) ?? false
      },
      onExit: () => {
        window.setTimeout(() => {
          const { quickPanel } = rootSuggestionStateRef.current
          if (quickPanel.isVisible && quickPanel.symbol === QuickPanelReservedSymbol.Root) {
            quickPanel.close()
          }
        }, 0)
      }
    }),
    [t]
  )

  const suggestionPanelStateRef = useRef({ quickPanel })
  suggestionPanelStateRef.current = { quickPanel }

  const quickPanelSuggestionSources = useMemo<ComposerSuggestionSource[]>(
    () =>
      suggestionSources.map((source) => ({
        ...source,
        renderMode: 'headless',
        onActiveChange: (options) => {
          source.onActiveChange?.(options)

          const { quickPanel } = suggestionPanelStateRef.current
          const { cursorOffset, queryAnchor, textBeforeTrigger, triggerText } = getComposerSuggestionTriggerContext(
            options.editor,
            {
              range: options.range,
              query: options.query,
              text: options.text,
              triggerChar: source.char
            }
          )

          if (
            !hasComposerQuickPanelTriggerBoundary(textBeforeTrigger) ||
            cursorOffset !== queryAnchor + triggerText.length
          ) {
            if (quickPanel.isVisible && quickPanel.symbol === source.char) {
              quickPanel.close('input_prefix_invalid')
            }
            return
          }

          quickPanel.open({
            title: typeof source.title === 'string' ? source.title : undefined,
            list: options.items.map((item) =>
              createComposerSuggestionQuickPanelItem(item, {
                editor: options.editor,
                query: options.query,
                range: options.range
              })
            ),
            symbol: source.char,
            pageSize: source.pageSize,
            multiple: source.multiple,
            queryAnchor,
            triggerInfo: {
              type: 'input',
              position: queryAnchor,
              originalText: triggerText
            },
            trackInputQuery: true,
            manageListExternally: true
          })
        },
        onKeyDown: (props) => {
          const handledByQuickPanel = suggestionPanelStateRef.current.quickPanel.dispatchKeyDown(props.event)
          if (handledByQuickPanel) return true
          return source.onKeyDown?.(props) ?? false
        },
        onExit: (options) => {
          source.onExit?.(options)

          window.setTimeout(() => {
            const { quickPanel } = suggestionPanelStateRef.current
            if (quickPanel.isVisible && quickPanel.symbol === source.char) {
              quickPanel.close()
            }
          }, 0)
        }
      })),
    [suggestionSources]
  )

  const activeSuggestionSources = useMemo(
    () => (quickPanelEnabled && enableQuickPanelTriggers ? [rootSuggestionSource, ...quickPanelSuggestionSources] : []),
    [enableQuickPanelTriggers, quickPanelEnabled, rootSuggestionSource, quickPanelSuggestionSources]
  )

  const editorExtensions = useMemo(
    () => createComposerEditorPreset({ placeholder, suggestionSources: activeSuggestionSources }),
    [activeSuggestionSources, placeholder]
  )

  const editor = useRichTextEditorKernel({
    extensions: editorExtensions,
    content: createPromptVariableContent(text),
    editable,
    enableSpellCheck,
    editorProps: {
      attributes: {
        class: cn(
          'composer-tiptap after:hidden! box-border flex w-full overflow-auto whitespace-pre-wrap break-words rounded-none text-foreground outline-none transition-none! [&::-webkit-scrollbar]:w-[3px]',
          isExpanded ? COMPOSER_EDITOR_EXPANDED_MAX_HEIGHT_CLASS : COMPOSER_EDITOR_COLLAPSED_MAX_HEIGHT_CLASS,
          isExpanded && 'h-full'
        ),
        style: getComposerEditorStyle(fontSize, isExpanded)
      },
      handleKeyDown: (_view, event) => {
        if (
          ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Tab', 'Enter', 'NumpadEnter', 'Escape'].includes(event.key)
        ) {
          const handled = quickPanel.dispatchKeyDown(event)
          if (handled) return true
          if (
            quickPanel.isVisible &&
            event.key === 'Enter' &&
            event.shiftKey &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey
          ) {
            return false
          }
        }

        if (event.key === 'Escape' && isExpanded) {
          event.stopPropagation()
          handleToggleExpanded(false)
          return true
        }

        if (event.key === 'Tab' && !event.isComposing && !quickPanel.isVisible) {
          const targetToken = editorRef.current
            ? selectPromptVariableToken(editorRef.current, event.shiftKey ? -1 : 1)
            : null

          if (targetToken) {
            event.preventDefault()
            event.stopPropagation()
            promptVariableEditRef.current = { tokenId: targetToken.id, started: false }
            return true
          }
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

        if (
          event.key === 'Backspace' &&
          textRef.current.trim().length === 0 &&
          filesCount > 0 &&
          (!editorRef.current || !hasComposerTokenBeforeSelection(editorRef.current))
        ) {
          setFiles((prev) => prev.slice(0, -1))
          event.preventDefault()
          return true
        }

        return false
      },
      handleTextInput: (_view, _from, _to, insertedText) => {
        const editor = editorRef.current
        if (!editor || editor.isDestroyed) return false
        const selectedPromptVariable = getSelectedPromptVariableToken(editor)
        if (!selectedPromptVariable) return false

        const composingToken = promptVariableCompositionRef.current
        if (editor.view.composing || composingToken?.tokenId === selectedPromptVariable.token.id) {
          if (composingToken) composingToken.text = insertedText || composingToken.text
          return true
        }

        const skippedTextInput = promptVariableSkipTextInputRef.current
        if (skippedTextInput?.tokenId === selectedPromptVariable.token.id && skippedTextInput.text === insertedText) {
          promptVariableSkipTextInputRef.current = null
          return true
        }

        const editState = promptVariableEditRef.current
        const shouldAppend = editState?.tokenId === selectedPromptVariable.token.id && editState.started
        const baseText = shouldAppend ? (selectedPromptVariable.token.promptText ?? '') : ''
        updateSelectedPromptVariableToken(editor, `${baseText}${insertedText}`)
        promptVariableEditRef.current = { tokenId: selectedPromptVariable.token.id, started: true }
        return true
      },
      handleDOMEvents: {
        compositionstart: () => {
          const editor = editorRef.current
          if (!editor || editor.isDestroyed) return false
          const selectedPromptVariable = getSelectedPromptVariableToken(editor)
          if (!selectedPromptVariable) return false

          promptVariableCompositionRef.current = { tokenId: selectedPromptVariable.token.id, text: '' }
          promptVariableEditRef.current = { tokenId: selectedPromptVariable.token.id, started: false }
          return false
        },
        compositionupdate: (_view, event) => {
          const editor = editorRef.current
          const composingToken = promptVariableCompositionRef.current
          if (!editor || editor.isDestroyed || !composingToken) return false
          const selectedPromptVariable = getSelectedPromptVariableToken(editor)
          if (selectedPromptVariable?.token.id !== composingToken.tokenId) return false

          const data = 'data' in event && typeof event.data === 'string' ? event.data : ''
          composingToken.text = data || composingToken.text
          return true
        },
        compositionend: (_view, event) => {
          const editor = editorRef.current
          const composingToken = promptVariableCompositionRef.current
          promptVariableCompositionRef.current = null

          if (!editor || editor.isDestroyed || !composingToken) return false
          const selectedPromptVariable = getSelectedPromptVariableToken(editor)
          if (selectedPromptVariable?.token.id !== composingToken.tokenId) return false

          const data = 'data' in event && typeof event.data === 'string' ? event.data : ''
          const nextValue = data || composingToken.text
          if (!nextValue) return true

          updateSelectedPromptVariableToken(editor, nextValue)
          promptVariableEditRef.current = { tokenId: selectedPromptVariable.token.id, started: true }
          promptVariableSkipTextInputRef.current = { tokenId: selectedPromptVariable.token.id, text: nextValue }
          return true
        }
      }
    },
    handlePaste: (_view, event) => {
      const pastedText = event.clipboardData?.getData('text/plain') || event.clipboardData?.getData('text') || ''
      const editor = editorRef.current
      if (editor && getSelectedPromptVariableToken(editor) && pastedText) {
        event.preventDefault()
        updateSelectedPromptVariableToken(editor, pastedText)
        const selectedPromptVariable = getSelectedPromptVariableToken(editor)
        promptVariableEditRef.current = selectedPromptVariable
          ? { tokenId: selectedPromptVariable.token.id, started: true }
          : null
        return true
      }

      if (shouldUseNativeLongTextPaste(pastedText, pasteLongTextAsFile, pasteLongTextThreshold)) {
        return false
      }

      const plainTextOverride = getComposerPlainTextPasteOverride(pastedText, {
        pasteLongTextAsFile,
        pasteLongTextThreshold,
        promptVariableStartIndex: editor ? getNextPromptVariableIndex(editor) : 0,
        resolveSkillMarker
      })

      if (plainTextOverride !== null) {
        event.preventDefault()
        editorRef.current?.chain().focus().insertContent(plainTextOverride).run()
        return true
      }

      void handlePaste(event)
      return false
    },
    onUpdate: ({ editor: updatedEditor }) => {
      if (tokenizePromptVariablesInEditor(updatedEditor)) return

      const draft = serializeComposerDocument(updatedEditor)
      const nextText = draft.text
      textRef.current = nextText
      pendingLocalTextEchoRef.current = nextText
      onTextChange(nextText)
      inputListenersRef.current.forEach((listener) => listener({ isComposing: updatedEditor.view.composing }))

      const nextManagedTokenSignature = getManagedTokenSignature(draft.tokens, managedTokenKindSet)
      if (!isSyncingTokensRef.current) {
        if (nextManagedTokenSignature !== managedTokenSignatureRef.current) {
          managedTokenSignatureRef.current = nextManagedTokenSignature
          onTokensChange(draft.tokens)
        }
      } else {
        managedTokenSignatureRef.current = nextManagedTokenSignature
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
    if (currentText === text) {
      pendingLocalTextEchoRef.current = null
      return
    }
    if (pendingLocalTextEchoRef.current === text) {
      pendingLocalTextEchoRef.current = null
      return
    }
    pendingLocalTextEchoRef.current = null
    editor.commands.setContent(createPromptVariableContent(text), { emitUpdate: false })
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

    managedTokenSignatureRef.current = getManagedTokenSignature(
      serializeComposerDocument(editor).tokens,
      managedTokenKindSet
    )
  }, [editor, managedTokenKindSet, tokens])

  const inputAdapter = useMemo<QuickPanelInputAdapter | undefined>(() => {
    if (!editor) return undefined

    return {
      getText: () => getComposerInputText(editor),
      getCursorOffset: () => getComposerCursorTextOffset(editor),
      insertText: (insertedText) => {
        editor
          .chain()
          .focus()
          .insertContent(
            createPromptVariableInlineContent(insertedText, { startIndex: getNextPromptVariableIndex(editor) })
          )
          .run()
      },
      insertToken: (token) => {
        insertComposerTokenAtCursor(editor, token as ComposerDraftToken)
      },
      deleteTriggerRange: (range) => {
        deleteComposerTextRange(editor, range)
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

  const quickPanelElement = quickPanelEnabled ? <QuickPanelView inputAdapter={inputAdapter} /> : null
  const showPauseButton = isLoading && sendDisabled
  const belowControls = renderBelowControls?.(inputAdapter)
  const inputbarElement = (
    <div
      id="inputbar"
      data-composer-inputbar=""
      className={cn(
        'inputbar-container relative rounded-[20px] border-[0.5px] border-border bg-card pt-2 shadow-[0_4px_12px_rgba(15,23,42,0.08)] transition-all duration-200 ease-in-out dark:shadow-[0_4px_12px_rgba(0,0,0,0.2)]',
        belowControls ? 'mb-0.5' : 'mb-3',
        isDragging &&
          "border-2 border-[#2ecc71] border-dashed before:pointer-events-none before:absolute before:inset-0 before:z-5 before:rounded-[18px] before:bg-[rgba(46,204,113,0.03)] before:content-['']",
        isExpanded && 'expanded'
      )}>
      <div
        style={
          isExpanded
            ? { height: COMPOSER_EDITOR_EXPANDED_MAX_HEIGHT, overflow: 'hidden' }
            : { minHeight: editorMinHeight }
        }>
        <EditorContent
          editor={editor}
          style={isExpanded ? { height: '100%', minHeight: editorMinHeight } : { minHeight: editorMinHeight }}
          onFocus={() => {
            onFocus?.()
            PasteService.setLastFocusedComponent('inputbar')
          }}
        />
      </div>

      <div className="relative z-2 flex h-10 shrink-0 flex-row justify-between gap-4 px-2 py-1.25">
        <div className="flex min-w-0 flex-1 items-center overflow-hidden">{renderLeftControls?.(inputAdapter)}</div>
        <div className="flex flex-row items-center gap-1.5">
          <Tooltip content={isExpanded ? t('chat.input.collapse') : t('chat.input.expand')}>
            <Button
              onClick={() => handleToggleExpanded()}
              variant="ghost"
              size="icon-sm"
              className="rounded-full"
              aria-label={isExpanded ? t('chat.input.collapse') : t('chat.input.expand')}>
              {isExpanded ? <Minimize size={18} /> : <Maximize size={18} />}
            </Button>
          </Tooltip>
          {showPauseButton ? (
            <Tooltip content={t('chat.input.pause')} placement="top">
              <button
                type="button"
                className="flex size-7.5 items-center justify-center rounded-full text-error-base hover:bg-accent"
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
  const inputbarStack = (
    <div className="relative">
      {quickPanelElement}
      {inputbarElement}
    </div>
  )

  return (
    <NarrowLayout narrowMode={narrowMode && !forceWideLayout} withSidePadding style={{ width: '100%' }}>
      <div className="w-full">
        <div
          className="inputbar relative z-2 flex flex-col pt-0"
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}>
          {belowControls ? (
            <div className="mb-6 rounded-[20px] bg-muted/25 pb-1.5 shadow-[0_14px_36px_rgba(15,23,42,0.07)] dark:bg-muted/15 dark:shadow-[0_14px_36px_rgba(0,0,0,0.24)]">
              {queueContent}
              {inputbarStack}
              <div className="min-w-0 overflow-hidden px-2">{belowControls}</div>
            </div>
          ) : (
            <>
              {queueContent}
              {inputbarStack}
            </>
          )}
        </div>
      </div>
    </NarrowLayout>
  )
}
