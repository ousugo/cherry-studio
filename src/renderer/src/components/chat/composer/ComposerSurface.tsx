import { Tooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import NarrowLayout from '@renderer/components/chat/layout/NarrowLayout'
import type {
  QuickPanelContextType,
  QuickPanelInputAdapter,
  QuickPanelListItem,
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
  enableMentionModelTrigger?: boolean
  enableDragDrop: boolean
  enableSpellCheck: boolean
  editable?: boolean
  fontSize: number
  narrowMode: boolean
  onFocus?: () => void
  onActionsChange?: (actions: ComposerSurfaceActions) => void
  getToolLaunchers?: () => ComposerToolLauncher[]
  emitToolTrigger?: (symbol: QuickPanelReservedSymbol, payload?: unknown) => void
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

const getTokenIds = (tokens: readonly ComposerDraftToken[]) => new Set(tokens.map((token) => token.id))

function getComposerEditorStyle(fontSize: number) {
  return [
    '--composer-editor-padding: 6px 15px 0',
    '--composer-editor-min-height: 30px',
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
  enableMentionModelTrigger = false,
  enableDragDrop,
  enableSpellCheck,
  editable = true,
  fontSize,
  narrowMode,
  onFocus,
  onActionsChange,
  getToolLaunchers,
  emitToolTrigger,
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

  const editorExtensions = useMemo(() => createComposerEditorPreset({ placeholder }), [placeholder])

  const getRootPanelItems = useCallback((): QuickPanelListItem[] => {
    return (getToolLaunchers?.() ?? [])
      .filter((launcher) => !launcher.hidden)
      .map((launcher) => ({
        label: launcher.label,
        description: launcher.description,
        icon: launcher.icon,
        suffix:
          launcher.suffix ??
          (launcher.kind === 'panel' || launcher.kind === 'group' ? (
            <span className="text-foreground-muted">›</span>
          ) : undefined),
        disabled: launcher.disabled,
        hidden: launcher.hidden,
        isSelected: launcher.active,
        isMenu: launcher.kind === 'panel' || launcher.kind === 'group',
        action: ({ context, searchText, inputAdapter }) => {
          onToolLauncherSelect?.(launcher, {
            source: 'root-panel',
            quickPanel: context,
            inputAdapter,
            triggerInfo: context.triggerInfo,
            searchText
          })
        }
      }))
  }, [getToolLaunchers, onToolLauncherSelect])

  const openRootPanel = useCallback(
    (payload?: unknown) => {
      const menuItems = getRootPanelItems()
      if (menuItems.length === 0) return

      quickPanel.open({
        title: t('settings.quickPanel.title'),
        list: menuItems,
        symbol: QuickPanelReservedSymbol.Root,
        triggerInfo: (payload ?? { type: 'button' }) as QuickPanelTriggerInfo
      })
    },
    [getRootPanelItems, quickPanel, t]
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
      const cursorPosition = getComposerCursorTextOffset(updatedEditor)
      const previousText = previousTextRef.current
      const isDeletion = nextText.length < previousText.length
      previousTextRef.current = nextText
      textRef.current = nextText
      onTextChange(nextText)
      inputListenersRef.current.forEach((listener) => listener({ isComposing: updatedEditor.view.composing }))

      if (!isSyncingTokensRef.current) {
        onTokensChange(draft.tokens)
      }

      if (!enableQuickPanelTriggers || !quickPanelEnabled) return

      const hasRootMenuItems = getRootPanelItems().length > 0
      const textBeforeCursor = nextText.slice(0, cursorPosition)
      const lastRootIndex = textBeforeCursor.lastIndexOf(QuickPanelReservedSymbol.Root)
      const lastMentionIndex = textBeforeCursor.lastIndexOf(QuickPanelReservedSymbol.MentionModels)
      const lastTriggerIndex = Math.max(lastRootIndex, enableMentionModelTrigger ? lastMentionIndex : -1)
      const lastSymbol = nextText[cursorPosition - 1]
      const previousChar = nextText[cursorPosition - 2]
      const hasBoundary = cursorPosition <= 1 || !previousChar || /\s/.test(previousChar)
      const allowResumeSearch =
        !quickPanel.isVisible &&
        (quickPanel.lastCloseAction === undefined || quickPanel.lastCloseAction === 'outsideclick')

      const openRootPanelAt = (position: number) => {
        openRootPanel({
          type: 'input',
          position,
          originalText: nextText
        })
      }

      const openMentionPanelAt = (position: number) => {
        emitToolTrigger?.(QuickPanelReservedSymbol.MentionModels, {
          type: 'input',
          position,
          originalText: nextText
        })
      }

      if (!quickPanel.isVisible && lastTriggerIndex !== -1 && cursorPosition > lastTriggerIndex) {
        const triggerChar = nextText[lastTriggerIndex]
        const boundaryChar = nextText[lastTriggerIndex - 1] ?? ''
        const triggerHasBoundary = lastTriggerIndex === 0 || /\s/.test(boundaryChar)
        const searchSegment = nextText.slice(lastTriggerIndex + 1, cursorPosition)
        const hasSearchContent = searchSegment.trim().length > 0

        if (triggerHasBoundary && (!hasSearchContent || isDeletion || allowResumeSearch)) {
          if (triggerChar === QuickPanelReservedSymbol.Root && hasRootMenuItems) {
            openRootPanelAt(lastTriggerIndex)
          } else if (triggerChar === QuickPanelReservedSymbol.MentionModels && enableMentionModelTrigger) {
            openMentionPanelAt(lastTriggerIndex)
          }
        }
      }

      if (lastSymbol === QuickPanelReservedSymbol.Root && hasBoundary && hasRootMenuItems) {
        if (quickPanel.isVisible && quickPanel.symbol !== QuickPanelReservedSymbol.Root) {
          quickPanel.close('switch-symbol')
        }
        if (!quickPanel.isVisible || quickPanel.symbol !== QuickPanelReservedSymbol.Root) {
          openRootPanelAt(cursorPosition - 1)
        }
      }

      if (enableMentionModelTrigger && lastSymbol === QuickPanelReservedSymbol.MentionModels && hasBoundary) {
        if (quickPanel.isVisible && quickPanel.symbol !== QuickPanelReservedSymbol.MentionModels) {
          quickPanel.close('switch-symbol')
        }
        if (!quickPanel.isVisible || quickPanel.symbol !== QuickPanelReservedSymbol.MentionModels) {
          openMentionPanelAt(cursorPosition - 1)
        }
      }

      if (quickPanel.isVisible && quickPanel.triggerInfo?.type === 'input') {
        const activeSymbol = quickPanel.symbol as QuickPanelReservedSymbol
        const triggerPosition = quickPanel.triggerInfo.position ?? -1
        const isTrackedSymbol =
          activeSymbol === QuickPanelReservedSymbol.Root || activeSymbol === QuickPanelReservedSymbol.MentionModels

        if (isTrackedSymbol && triggerPosition >= 0) {
          if (cursorPosition <= triggerPosition || nextText[triggerPosition] !== activeSymbol) {
            quickPanel.close('delete-symbol')
          }
        }
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

  return (
    <NarrowLayout narrowMode={narrowMode} style={{ width: '100%' }}>
      <div
        className="inputbar relative z-2 flex flex-col px-[18px] pt-0"
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}>
        {quickPanelElement}
        <div
          id="inputbar"
          className={cn(
            'inputbar-container relative rounded-[17px] border-(--color-border) border-[0.5px] bg-(--color-background-opacity) pt-2 transition-all duration-200 ease-in-out',
            belowControls ? 'mb-2' : 'in-[[navbar-position=top]]:mb-3.5 mb-6',
            isDragging &&
              "border-2 border-[#2ecc71] border-dashed before:pointer-events-none before:absolute before:inset-0 before:z-5 before:rounded-[14px] before:bg-[rgba(46,204,113,0.03)] before:content-['']",
            isExpanded && 'expanded'
          )}>
          <div style={customHeight ? { height: customHeight } : undefined}>
            <EditorContent
              editor={editor}
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
        {belowControls && <div className="in-[[navbar-position=top]]:mb-3.5 mb-6 px-2">{belowControls}</div>}
      </div>
    </NarrowLayout>
  )
}
