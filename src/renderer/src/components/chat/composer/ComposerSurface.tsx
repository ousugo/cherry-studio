import { Tooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { useChatLayoutMode } from '@renderer/components/chat/layout/ChatLayoutModeContext'
import NarrowLayout from '@renderer/components/chat/layout/NarrowLayout'
import type {
  QuickPanelContextType,
  QuickPanelInputAdapter,
  QuickPanelTriggerInfo
} from '@renderer/components/QuickPanel'
import { QuickPanelReservedSymbol, QuickPanelView, useQuickPanel } from '@renderer/components/QuickPanel'
import { useRichTextEditorKernel } from '@renderer/components/RichEditor/useRichTextEditorKernel'
import { matchesModelTag, MODEL_SELECTOR_TAGS } from '@renderer/components/Selector/model/filters'
import { ModelTagChip } from '@renderer/components/Selector/model/ModelTagChip'
import TranslateButton from '@renderer/components/TranslateButton'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { getProviderDisplayName, useProviders } from '@renderer/hooks/useProvider'
import { useTimer } from '@renderer/hooks/useTimer'
import { useFileDragDrop } from '@renderer/pages/home/Inputbar/hooks/useFileDragDrop'
import { usePasteHandler } from '@renderer/pages/home/Inputbar/hooks/usePasteHandler'
import SendMessageButton from '@renderer/pages/home/Inputbar/SendMessageButton'
import PasteService from '@renderer/services/PasteService'
import type { FileMetadata } from '@renderer/types'
import type { SendMessageShortcut } from '@shared/data/preference/preferenceTypes'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import type { JSONContent } from '@tiptap/core'
import type { Editor } from '@tiptap/react'
import { EditorContent } from '@tiptap/react'
import { Bot, CirclePause, X } from 'lucide-react'
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
  removeToken: (tokenId: string) => void
}

export interface ComposerTokenRemoveRequest {
  kind: ComposerDraftToken['kind']
  tokenId: string
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
  onTokenRemoveRequest?: (request: ComposerTokenRemoveRequest) => void
  getToolLaunchers?: () => ComposerToolLauncher[]
  suggestionSources?: readonly ComposerSuggestionSource[]
  queueContent?: React.ReactNode
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
  const chain = editor.chain().focus().insertComposerToken(token)
  if (token.kind === 'model') {
    chain.run()
    return
  }
  chain.insertContent(' ').run()
}

interface ModelTokenPayload {
  id: string
  name: string
  provider?: string
  providerId?: string
  contextWindow?: number
  maxInputTokens?: number
  capabilities?: Model['capabilities']
  inputModalities?: Model['inputModalities']
  outputModalities?: Model['outputModalities']
}

interface ModelTokenView {
  token: ComposerDraftToken
  model?: ModelTokenPayload
  providerName: string
}

function getModelPayload(payload: unknown): ModelTokenPayload | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const model = payload as Partial<ModelTokenPayload>
  return typeof model.id === 'string' && typeof model.name === 'string' ? (model as ModelTokenPayload) : undefined
}

function getModelTokenViews(tokens: readonly ComposerDraftToken[], providers: readonly Provider[]): ModelTokenView[] {
  const providerById = new Map(providers.map((provider) => [provider.id, provider]))

  return tokens
    .filter((token) => token.kind === 'model')
    .map((token) => {
      const model = getModelPayload(token.payload)
      const providerId = model?.providerId ?? model?.provider
      const providerName = providerId ? getProviderDisplayName(providerById.get(providerId)) || providerId : ''

      return {
        token,
        model,
        providerName
      }
    })
}

function formatTokenLimit(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? new Intl.NumberFormat().format(value) : undefined
}

function isTaggableModelPayload(model: ModelTokenPayload | undefined): model is Model {
  return Boolean(model && Array.isArray(model.capabilities))
}

function ModelTokenCapabilityTags({ model }: { model?: ModelTokenPayload }) {
  if (!isTaggableModelPayload(model)) return null

  const tags = MODEL_SELECTOR_TAGS.filter((tag) => matchesModelTag(model, tag))
  if (tags.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <ModelTagChip
          key={tag}
          tag={tag}
          size={8}
          showLabel={false}
          showTooltip={false}
          className="border border-current/15 shadow-none dark:border-current/25"
          style={{ height: 16, justifyContent: 'center', minWidth: 22, padding: 0 }}
        />
      ))}
    </div>
  )
}

function ModelTokenHoverInfo({ model, providerName }: { model?: ModelTokenPayload; providerName: string }) {
  const { t } = useTranslation()
  const contextWindow = formatTokenLimit(model?.contextWindow)
  const maxInputTokens = formatTokenLimit(model?.maxInputTokens)
  const hasTokenLimits = Boolean(contextWindow || maxInputTokens)

  return (
    <div className="inline-flex w-max min-w-[120px] flex-col gap-1.5">
      <div className="flex items-start justify-between gap-3">
        <div className="max-w-[150px] truncate font-semibold text-[11px] leading-4">{model?.name}</div>
        {providerName ? (
          <div className="shrink-0 whitespace-nowrap text-right text-[10px] text-muted-foreground leading-4">
            {providerName}
          </div>
        ) : null}
      </div>
      {hasTokenLimits ? (
        <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[10px] leading-4">
          {contextWindow ? (
            <>
              <span className="text-muted-foreground">{t('settings.models.add.context_window.label')}</span>
              <span className="text-right font-semibold tabular-nums">{contextWindow}</span>
            </>
          ) : null}
          {maxInputTokens ? (
            <>
              <span className="text-muted-foreground">{t('settings.models.add.max_input_tokens.label')}</span>
              <span className="text-right font-semibold tabular-nums">{maxInputTokens}</span>
            </>
          ) : null}
        </div>
      ) : null}
      <ModelTokenCapabilityTags model={model} />
    </div>
  )
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

  const queryTerms = normalizedQuery.split(/\s+/).filter(Boolean)

  return items.filter((item) => {
    const searchableText = [item.label, item.description, item.filterText]
      .map((value) => (typeof value === 'string' ? value.toLowerCase() : ''))
      .join(' ')
    const compactSearchableText = searchableText.replace(/\s+/g, '')

    return queryTerms.every((term) => searchableText.includes(term) || compactSearchableText.includes(term))
  })
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
  onTokenRemoveRequest,
  getToolLaunchers,
  suggestionSources = [],
  queueContent,
  onToolLauncherSelect,
  renderLeftControls,
  renderBelowControls
}: ComposerSurfaceProps) {
  const [pasteLongTextAsFile] = usePreference('chat.input.paste_long_text_as_file')
  const [pasteLongTextThreshold] = usePreference('chat.input.paste_long_text_threshold')
  const [sendMessageShortcut] = usePreference('chat.input.send_message_shortcut')
  const { t } = useTranslation()
  const quickPanel = useQuickPanel()
  const { providers } = useProviders()
  const { forceWideLayout } = useChatLayoutMode()
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

  const removeToken = useCallback((tokenId: string) => {
    const editor = editorRef.current
    if (!editor || editor.isDestroyed) return
    removeComposerTokens(editor, (token) => token.id === tokenId)
    editor.commands.focus()
  }, [])

  useEffect(() => {
    onActionsChange?.({
      resizeTextArea: () => undefined,
      onTextChange: handleTextChangeFromTool,
      toggleExpanded: handleToggleExpanded,
      removeToken
    })
  }, [handleTextChangeFromTool, handleToggleExpanded, onActionsChange, removeToken])

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
  const showPauseButton = isLoading && sendDisabled
  const belowControls = renderBelowControls?.(inputAdapter)
  const modelTokenViews = useMemo(() => getModelTokenViews(tokens, providers), [providers, tokens])
  const inputbarElement = (
    <div
      id="inputbar"
      data-composer-inputbar=""
      className={cn(
        'inputbar-container relative rounded-[20px] border-(--color-border) border-[0.5px] bg-card pt-2 shadow-[0_4px_12px_rgba(15,23,42,0.08)] transition-all duration-200 ease-in-out dark:shadow-[0_4px_12px_rgba(0,0,0,0.2)]',
        belowControls ? 'mb-0.5' : 'mb-3',
        isDragging &&
          "border-2 border-[#2ecc71] border-dashed before:pointer-events-none before:absolute before:inset-0 before:z-5 before:rounded-[18px] before:bg-[rgba(46,204,113,0.03)] before:content-['']",
        isExpanded && 'expanded'
      )}>
      {modelTokenViews.length > 0 ? (
        <div className="-translate-y-1/2 absolute top-0 left-4 z-4 flex items-center rounded-full">
          <div className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-0 z-0 h-3 w-full rounded-full bg-card" />
          {modelTokenViews.map(({ token, model, providerName }) => (
            <Tooltip
              key={token.id}
              content={<ModelTokenHoverInfo model={model} providerName={providerName} />}
              placement="top"
              delay={300}
              sideOffset={6}
              showArrow={false}
              isDisabled={!model}
              className="max-w-none rounded-md border border-border bg-popover/95 p-2 text-popover-foreground shadow-black/10 shadow-lg backdrop-blur-xl dark:bg-popover/95 dark:shadow-black/40">
              <span className="group/model-token relative z-1 flex size-7 items-center justify-center text-foreground">
                {model ? (
                  <ModelAvatar
                    className={cn(
                      'bg-transparent shadow-none [&_[data-slot=avatar-fallback]]:bg-transparent',
                      (model.id.toLowerCase().includes('kimi') ||
                        model.provider?.toLowerCase() === 'moonshot' ||
                        model.providerId?.toLowerCase() === 'moonshot') &&
                        '[&_svg>path:first-child]:fill-transparent'
                    )}
                    model={model}
                    size={26}
                  />
                ) : (
                  <Bot size={22} />
                )}
                <button
                  type="button"
                  className="-top-1 -right-1 absolute hidden size-3.5 items-center justify-center rounded-full bg-muted text-muted-foreground shadow-sm hover:bg-muted/90 hover:text-foreground group-hover/model-token:flex"
                  aria-label={t('common.delete')}
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    onTokenRemoveRequest?.({ kind: token.kind, tokenId: token.id })
                  }}>
                  <X size={10} />
                </button>
              </span>
            </Tooltip>
          ))}
        </div>
      ) : null}
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
          {showPauseButton ? (
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
              <div className="px-2">{belowControls}</div>
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
