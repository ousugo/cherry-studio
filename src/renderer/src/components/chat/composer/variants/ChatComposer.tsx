import { MenuDivider, MenuItem, MenuList, Popover, PopoverContent, PopoverTrigger, Tooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { cacheService } from '@data/CacheService'
import { loggerService } from '@logger'
import NarrowLayout from '@renderer/components/chat/layout/NarrowLayout'
import {
  type QuickPanelInputAdapter,
  QuickPanelReservedSymbol,
  QuickPanelView,
  useQuickPanel
} from '@renderer/components/QuickPanel'
import { useRichTextEditorKernel } from '@renderer/components/RichEditor/useRichTextEditorKernel'
import TranslateButton from '@renderer/components/TranslateButton'
import { isGenerateImageModel, isGenerateImageModels, isVisionModel, isVisionModels } from '@renderer/config/models'
import { useCache } from '@renderer/data/hooks/useCache'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { useChatWrite } from '@renderer/hooks/ChatWriteContext'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useKnowledgeBases } from '@renderer/hooks/useKnowledgeBaseDataApi'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { useTimer } from '@renderer/hooks/useTimer'
import { mapApiTopicToRendererTopic, useTopicMutations } from '@renderer/hooks/useTopic'
import { useTopicAwaitingApproval } from '@renderer/hooks/useTopicAwaitingApproval'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import {
  InputbarToolsProvider,
  useInputbarToolsDispatch,
  useInputbarToolsInternalDispatch,
  useInputbarToolsState
} from '@renderer/pages/home/Inputbar/context/InputbarToolsProvider'
import { useFileDragDrop } from '@renderer/pages/home/Inputbar/hooks/useFileDragDrop'
import { usePasteHandler } from '@renderer/pages/home/Inputbar/hooks/usePasteHandler'
import { resolveNewTopicAssistantId } from '@renderer/pages/home/Inputbar/Inputbar.helpers'
import InputbarTools from '@renderer/pages/home/Inputbar/InputbarTools'
import { getInputbarConfig } from '@renderer/pages/home/Inputbar/registry'
import SendMessageButton from '@renderer/pages/home/Inputbar/SendMessageButton'
import type { InputbarScope } from '@renderer/pages/home/Inputbar/types'
import { type AddNewTopicPayload, EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import PasteService from '@renderer/services/PasteService'
import type { Assistant, FileMetadata, KnowledgeBase, Topic } from '@renderer/types'
import { TopicType } from '@renderer/types'
import { delay } from '@renderer/utils'
import { getSendMessageShortcutLabel } from '@renderer/utils/input'
import { documentExts, imageExts, textExts } from '@shared/config/constant'
import type { SendMessageShortcut } from '@shared/data/preference/preferenceTypes'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import type { JSONContent } from '@tiptap/core'
import type { Editor } from '@tiptap/react'
import { EditorContent } from '@tiptap/react'
import { CirclePause, Image, MoreHorizontal, Plus } from 'lucide-react'
import React, { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { serializeComposerDocument, toLegacyComposerPayload } from '../composerDraft'
import { createComposerEditorPreset } from '../composerPreset'
import { COMPOSER_TOKEN_NODE_NAME } from '../ComposerTokenNode'
import type { ComposerDraftToken, ComposerSerializedToken } from '../tokens'
import {
  chatComposerTokenId,
  fileToComposerToken,
  getComposerTokenIds,
  hasComposerToken,
  knowledgeBaseToComposerToken,
  modelToComposerToken
} from './chatComposerTokens'

const INPUTBAR_DRAFT_CACHE_KEY = 'inputbar-draft'
const DRAFT_CACHE_TTL = 24 * 60 * 60 * 1000
const logger = loggerService.withContext('ChatComposer')

const getMentionedModelsCacheKey = (assistantId: string | undefined) =>
  `inputbar-mentioned-models-${assistantId ?? 'no-assistant'}`

const getValidatedCachedModels = (assistantId: string | undefined): Model[] => {
  const cached = cacheService.getCasual<Model[]>(getMentionedModelsCacheKey(assistantId))
  if (!Array.isArray(cached)) return []
  return cached.filter((model) => model?.id && model?.name)
}

interface ChatComposerProps {
  setActiveTopic: (topic: Topic) => void
  topic: Topic
  onSend: (
    text: string,
    options?: { files?: FileMetadata[]; mentionedModels?: UniqueModelId[] }
  ) => void | Promise<void>
}

type ProviderActionHandlers = {
  resizeTextArea: () => void
  addNewTopic: (payload?: AddNewTopicPayload) => void
  clearTopic: () => void
  onNewContext: () => void
  onTextChange: (updater: string | ((prev: string) => string)) => void
  toggleExpanded: (nextState?: boolean) => void
}

function createPlainTextContent(text: string): JSONContent {
  if (!text) {
    return { type: 'doc', content: [{ type: 'paragraph' }] }
  }

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
  if (hasComposerToken(existingTokens, token.id)) return
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

const ChatComposer = ({ setActiveTopic, topic, onSend }: ChatComposerProps) => {
  const actionsRef = useRef<ProviderActionHandlers>({
    resizeTextArea: () => {},
    addNewTopic: () => {},
    clearTopic: () => {},
    onNewContext: () => {},
    onTextChange: () => {},
    toggleExpanded: () => {}
  })
  const [initialMentionedModels] = useState(() => getValidatedCachedModels(topic.assistantId))

  const initialState = useMemo(
    () => ({
      files: [] as FileMetadata[],
      mentionedModels: initialMentionedModels,
      selectedKnowledgeBases: [] as KnowledgeBase[],
      isExpanded: false,
      couldAddImageFile: false,
      extensions: [] as string[]
    }),
    [initialMentionedModels]
  )

  return (
    <InputbarToolsProvider
      initialState={initialState}
      actions={{
        resizeTextArea: () => actionsRef.current.resizeTextArea(),
        addNewTopic: () => actionsRef.current.addNewTopic(),
        clearTopic: () => actionsRef.current.clearTopic(),
        onNewContext: () => actionsRef.current.onNewContext(),
        onTextChange: (updater) => actionsRef.current.onTextChange(updater),
        toggleExpanded: (next) => actionsRef.current.toggleExpanded(next)
      }}>
      <ChatComposerInner setActiveTopic={setActiveTopic} topic={topic} actionsRef={actionsRef} onSend={onSend} />
    </InputbarToolsProvider>
  )
}

interface ChatComposerInnerProps extends ChatComposerProps {
  actionsRef: React.RefObject<ProviderActionHandlers>
}

const ChatComposerInner = ({ setActiveTopic, topic, actionsRef, onSend }: ChatComposerInnerProps) => {
  const awaitingApproval = useTopicAwaitingApproval(topic.id)
  const scope = topic.type ?? TopicType.Chat
  const config = getInputbarConfig(scope)
  const { files, mentionedModels, selectedKnowledgeBases, isExpanded } = useInputbarToolsState()
  const { setFiles, setMentionedModels, setSelectedKnowledgeBases, setIsExpanded, triggers } =
    useInputbarToolsDispatch()
  const { setCouldAddImageFile, setExtensions } = useInputbarToolsInternalDispatch()
  const { assistant, model, updateAssistant } = useAssistant(topic.assistantId)
  const { createTopic } = useTopicMutations()
  const { knowledgeBases: allKnowledgeBases } = useKnowledgeBases()
  const [sendMessageShortcut] = usePreference('chat.input.send_message_shortcut')
  const [enableQuickPanelTriggers] = usePreference('chat.input.quick_panel.triggers_enabled')
  const [pasteLongTextAsFile] = usePreference('chat.input.paste_long_text_as_file')
  const [pasteLongTextThreshold] = usePreference('chat.input.paste_long_text_threshold')
  const [enableSpellCheck] = usePreference('app.spell_check.enabled')
  const [fontSize] = usePreference('chat.message.font_size')
  const [narrowMode] = usePreference('chat.narrow_mode')
  const [searching, setSearching] = useCache('chat.web_search.searching')
  const [isMultiSelectMode] = useCache('chat.multi_select_mode')
  const { t } = useTranslation()
  const chatWrite = useChatWrite()
  const { isPending } = useTopicStreamStatus(topic.id)
  const { setTimeoutTimer } = useTimer()
  const [isSending, setIsSending] = useState(false)
  const [text, setTextState] = useState(() => cacheService.getCasual<string>(INPUTBAR_DRAFT_CACHE_KEY) ?? '')
  const [customHeight, setCustomHeight] = useState<number | undefined>()
  const isSyncingTokensRef = useRef(false)
  const editorShellRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<Editor | null>(null)
  const inputListenersRef = useRef(new Set<(event?: { isComposing?: boolean }) => void>())
  const sendMessageRef = useRef<() => void>(() => undefined)
  const sendDisabledRef = useRef(true)

  useEffect(() => {
    if (isPending) setIsSending(false)
  }, [isPending])

  useEffect(() => {
    setIsSending(false)
  }, [topic.id])

  const loading = isPending || isSending || awaitingApproval
  const isVisionAssistant = useMemo(() => (model ? isVisionModel(model) : false), [model])
  const isGenerateImageAssistant = useMemo(() => (model ? isGenerateImageModel(model) : false), [model])

  const isVisionSupported = useMemo(
    () =>
      (mentionedModels.length > 0 && isVisionModels(mentionedModels)) ||
      (mentionedModels.length === 0 && isVisionAssistant),
    [mentionedModels, isVisionAssistant]
  )

  const isGenerateImageSupported = useMemo(
    () =>
      (mentionedModels.length > 0 && isGenerateImageModels(mentionedModels)) ||
      (mentionedModels.length === 0 && isGenerateImageAssistant),
    [mentionedModels, isGenerateImageAssistant]
  )

  const canAddImageFile = useMemo(
    () => isVisionSupported || isGenerateImageSupported,
    [isGenerateImageSupported, isVisionSupported]
  )

  const canAddTextFile = useMemo(
    () => isVisionSupported || (!isVisionSupported && !isGenerateImageSupported),
    [isGenerateImageSupported, isVisionSupported]
  )

  const supportedExts = useMemo(() => {
    if (canAddImageFile && canAddTextFile) return [...imageExts, ...documentExts, ...textExts]
    if (canAddImageFile) return [...imageExts]
    if (canAddTextFile) return [...documentExts, ...textExts]
    return []
  }, [canAddImageFile, canAddTextFile])

  useEffect(() => {
    setCouldAddImageFile(canAddImageFile)
  }, [canAddImageFile, setCouldAddImageFile])

  useEffect(() => {
    setExtensions(supportedExts)
  }, [setExtensions, supportedExts])

  const setText = useCallback((nextText: string) => {
    setTextState(nextText)
    cacheService.setCasual(INPUTBAR_DRAFT_CACHE_KEY, nextText, DRAFT_CACHE_TTL)
  }, [])

  const placeholderText = enableQuickPanelTriggers
    ? t('chat.input.placeholder', { key: getSendMessageShortcutLabel(sendMessageShortcut) })
    : t('chat.input.placeholder_without_triggers', {
        key: getSendMessageShortcutLabel(sendMessageShortcut),
        defaultValue: t('chat.input.placeholder', {
          key: getSendMessageShortcutLabel(sendMessageShortcut)
        })
      })

  const editorExtensions = useMemo(
    () =>
      createComposerEditorPreset({
        placeholder: searching ? t('chat.input.translating') : placeholderText
      }),
    [placeholderText, searching, t]
  )

  const replaceEditorText = useCallback(
    (updater: string | ((prev: string) => string)) => {
      const nextText = typeof updater === 'function' ? updater(text) : updater
      setText(nextText)
    },
    [setText, text]
  )

  const { handlePaste } = usePasteHandler(text, replaceEditorText, {
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
    enabled: config.enableDragDrop,
    t
  })

  const focusEditor = useCallback(() => {
    editorRef.current?.commands.focus()
  }, [])

  const handleToggleExpanded = useCallback(
    (nextState?: boolean) => {
      const target = typeof nextState === 'boolean' ? nextState : !isExpanded
      setIsExpanded(target)
      setCustomHeight(target ? Math.max(220, Math.round(window.innerHeight * 0.5)) : undefined)
      focusEditor()
    },
    [focusEditor, isExpanded, setIsExpanded]
  )

  const editor = useRichTextEditorKernel({
    extensions: editorExtensions,
    content: createPlainTextContent(text),
    editable: !searching,
    enableSpellCheck,
    editorProps: {
      attributes: {
        class:
          'min-h-[30px] max-h-[500px] w-full overflow-y-auto px-[15px] py-1.5 text-foreground outline-none break-words whitespace-pre-wrap [&_p]:m-0'
      },
      handleKeyDown: (_view, event) => {
        if (event.key === 'Escape' && isExpanded) {
          event.stopPropagation()
          handleToggleExpanded(false)
          return true
        }

        const isEnterPressed = event.key === 'Enter' && !event.isComposing
        if (isEnterPressed && isComposerSendKeyPressed(event, sendMessageShortcut)) {
          if (!sendDisabledRef.current) {
            sendMessageRef.current()
          }
          event.preventDefault()
          return true
        }

        if (event.key === 'Backspace' && text.trim().length === 0 && files.length > 0) {
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
      setText(draft.text)
      inputListenersRef.current.forEach((listener) => listener({ isComposing: updatedEditor.view.composing }))

      if (isSyncingTokensRef.current) return
      const tokenIds = getComposerTokenIds(draft.tokens)
      setFiles((prev) => prev.filter((file) => tokenIds.has(chatComposerTokenId.file(file))))
      setMentionedModels((prev) => prev.filter((currentModel) => tokenIds.has(chatComposerTokenId.model(currentModel))))
      const nextSelectedKnowledgeBases = selectedKnowledgeBases.filter((base) =>
        tokenIds.has(chatComposerTokenId.knowledge(base))
      )
      if (nextSelectedKnowledgeBases.length !== selectedKnowledgeBases.length) {
        const nextIds = (assistant?.knowledgeBaseIds ?? []).filter((id) => tokenIds.has(`knowledge:${id}`))
        void updateAssistant({ knowledgeBaseIds: nextIds })
      }
      setSelectedKnowledgeBases(nextSelectedKnowledgeBases)

      if (!enableQuickPanelTriggers || !config.enableQuickPanel) return
      const selectionFrom = updatedEditor.state.selection.from
      const textBeforeCursor = updatedEditor.state.doc.textBetween(Math.max(0, selectionFrom - 80), selectionFrom)
      const lastSymbol = textBeforeCursor.at(-1)
      const previousChar = textBeforeCursor.at(-2)
      const hasBoundary = textBeforeCursor.length <= 1 || !previousChar || /\s/.test(previousChar)

      if (lastSymbol === QuickPanelReservedSymbol.Root && hasBoundary && triggers.getRootMenu().length > 0) {
        triggers.emit(QuickPanelReservedSymbol.Root, {
          type: 'input',
          position: selectionFrom - 1,
          originalText: draft.text
        })
      }

      if (lastSymbol === QuickPanelReservedSymbol.MentionModels && hasBoundary) {
        triggers.emit(QuickPanelReservedSymbol.MentionModels, {
          type: 'input',
          position: selectionFrom - 1,
          originalText: draft.text
        })
      }
    },
    onCreate: ({ editor: createdEditor }) => {
      setTimeoutTimer('chatComposerFocus', () => createdEditor.commands.focus(), 0)
    },
    shouldRerenderOnTransaction: true
  })

  useEffect(() => {
    editorRef.current = editor
  }, [editor])

  const sendDisabled = text.trim().length === 0 || loading || searching

  useEffect(() => {
    sendDisabledRef.current = sendDisabled
  }, [sendDisabled])

  const syncEditorTokens = useCallback(() => {
    if (!editor || editor.isDestroyed) return
    const draft = serializeComposerDocument(editor)
    isSyncingTokensRef.current = true

    for (const file of files) addMissingToken(editor, fileToComposerToken(file), draft.tokens)
    for (const currentModel of mentionedModels)
      addMissingToken(editor, modelToComposerToken(currentModel), draft.tokens)
    for (const base of selectedKnowledgeBases) addMissingToken(editor, knowledgeBaseToComposerToken(base), draft.tokens)

    const desiredFileIds = new Set(files.map(chatComposerTokenId.file))
    const desiredModelIds = new Set(mentionedModels.map(chatComposerTokenId.model))
    const desiredKnowledgeIds = new Set(selectedKnowledgeBases.map(chatComposerTokenId.knowledge))

    removeComposerTokens(editor, (token) => {
      if (token.kind === 'file') return !desiredFileIds.has(token.id)
      if (token.kind === 'model') return !desiredModelIds.has(token.id)
      if (token.kind === 'knowledge') return !desiredKnowledgeIds.has(token.id)
      return false
    })

    isSyncingTokensRef.current = false
  }, [editor, files, mentionedModels, selectedKnowledgeBases])

  useEffect(() => {
    syncEditorTokens()
  }, [syncEditorTokens])

  useEffect(() => {
    setFiles((prev) => {
      const counts = new Map<string, number>()
      for (const file of prev) {
        const id = chatComposerTokenId.file(file)
        counts.set(id, (counts.get(id) ?? 0) + 1)
      }

      const duplicateIds = new Set([...counts].filter(([, count]) => count > 1).map(([id]) => id))
      if (duplicateIds.size === 0) return prev

      return prev.filter((file) => !duplicateIds.has(chatComposerTokenId.file(file)))
    })
  }, [files, setFiles])

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
    if (!editor || editor.isDestroyed) return
    const currentText = serializeComposerDocument(editor).text
    if (currentText === text) return
    editor.commands.setContent(createPlainTextContent(text), { emitUpdate: false })
  }, [editor, text])

  const onUnmount = useEffectEvent((id: string | undefined) => {
    cacheService.setCasual(getMentionedModelsCacheKey(id), mentionedModels, DRAFT_CACHE_TTL)
  })

  useEffect(() => {
    return () => onUnmount(topic.assistantId)
  }, [onUnmount, topic.assistantId])

  const onPause = useCallback(() => {
    chatWrite?.pause()
  }, [chatWrite])

  const clearTopic = useCallback(async () => {
    if (loading) {
      onPause()
      await delay(1)
    }
    void EventEmitter.emit(EVENT_NAMES.CLEAR_MESSAGES, topic)
    focusEditor()
  }, [focusEditor, loading, onPause, topic])

  const onNewContext = useCallback(() => {
    if (loading) {
      onPause()
      return
    }
    void EventEmitter.emit(EVENT_NAMES.NEW_CONTEXT)
  }, [loading, onPause])

  const addNewTopic = useCallback(
    async (payload?: AddNewTopicPayload) => {
      const assistantId = resolveNewTopicAssistantId(topic.assistantId, payload)
      const persisted = await createTopic({ assistantId, name: t('chat.default.topic.name') })
      if (!persisted) return
      setActiveTopic(mapApiTopicToRendererTopic(persisted))
      setTimeoutTimer('addNewTopic', () => EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR), 0)
    },
    [createTopic, topic.assistantId, t, setActiveTopic, setTimeoutTimer]
  )

  const handleTextChangeFromTool = useCallback(
    (updater: string | ((prev: string) => string)) => {
      const currentText = editor ? serializeComposerDocument(editor).text : text
      const nextText = typeof updater === 'function' ? updater(currentText) : updater
      setText(nextText)
    },
    [editor, setText, text]
  )

  useEffect(() => {
    actionsRef.current = {
      resizeTextArea: () => undefined,
      addNewTopic,
      clearTopic,
      onNewContext,
      onTextChange: handleTextChangeFromTool,
      toggleExpanded: handleToggleExpanded
    }
  }, [addNewTopic, clearTopic, onNewContext, handleTextChangeFromTool, handleToggleExpanded, actionsRef])

  useShortcut(
    'topic.new',
    () => {
      void addNewTopic()
      void EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR)
      focusEditor()
    },
    { preventDefault: true, enableOnFormTags: true }
  )

  useShortcut('chat.clear', clearTopic, {
    preventDefault: true,
    enableOnFormTags: true
  })

  useEffect(() => {
    const unsubscribes = [EventEmitter.on(EVENT_NAMES.ADD_NEW_TOPIC, addNewTopic)]
    return () => {
      unsubscribes.forEach((unsubscribe) => unsubscribe())
    }
  }, [addNewTopic])

  useEffect(() => {
    if (!document.querySelector('.topview-fullscreen-container')) {
      focusEditor()
    }
  }, [
    topic.id,
    assistant?.mcpServerIds,
    assistant?.knowledgeBaseIds,
    assistant?.settings.enableWebSearch,
    mentionedModels,
    focusEditor
  ])

  useEffect(() => {
    const ids = assistant?.knowledgeBaseIds ?? []
    if (ids.length === 0) {
      setSelectedKnowledgeBases([])
      return
    }
    setSelectedKnowledgeBases(allKnowledgeBases.filter((kb) => ids.includes(kb.id)) as unknown as KnowledgeBase[])
  }, [assistant?.knowledgeBaseIds, allKnowledgeBases, setSelectedKnowledgeBases])

  useEffect(() => {
    PasteService.init()
    PasteService.registerHandler('inputbar', handlePaste)
    return () => {
      PasteService.unregisterHandler('inputbar')
    }
  }, [handlePaste])

  const sendMessage = useCallback(async () => {
    if (!editor || sendDisabled) return
    const draft = serializeComposerDocument(editor)
    const legacyPayload = toLegacyComposerPayload(draft)
    const nextText = legacyPayload.text.trim()
    if (!nextText) return

    setIsSending(true)
    setText('')
    setFiles([])
    editor.commands.clearContent()
    focusEditor()

    try {
      await onSend(nextText, {
        files: legacyPayload.files?.length ? (legacyPayload.files as FileMetadata[]) : undefined,
        mentionedModels: legacyPayload.mentionedModels?.length
          ? (legacyPayload.mentionedModels as Model[]).map((currentModel) => currentModel.id)
          : undefined
      })
    } catch (error) {
      logger.warn('send failed', { error })
    } finally {
      setIsSending(false)
    }
  }, [editor, focusEditor, onSend, sendDisabled, setFiles, setText])

  useEffect(() => {
    sendMessageRef.current = sendMessage
  }, [sendMessage])

  const onTranslated = useCallback(
    (translatedText: string) => {
      setText(translatedText)
      editor?.commands.setContent(createPlainTextContent(translatedText), { emitUpdate: false })
    },
    [editor, setText]
  )

  if (isMultiSelectMode) {
    return null
  }

  const quickPanelElement = config.enableQuickPanel ? (
    <QuickPanelView setInputText={handleTextChangeFromTool} inputAdapter={inputAdapter} />
  ) : null

  return (
    <NarrowLayout narrowMode={narrowMode} style={{ width: '100%' }}>
      <div
        className="relative z-2 flex flex-col px-[18px] pt-0 in-[[navbar-position=top]]:pb-2.5 pb-[18px]"
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}>
        {quickPanelElement}
        <div
          className={cn(
            'inputbar inputbar-container relative rounded-[17px] border-(--color-border) border-[0.5px] bg-(--color-background-opacity) pt-2 transition-all duration-200 ease-in-out',
            isDragging &&
              "border-2 border-[#2ecc71] border-dashed before:pointer-events-none before:absolute before:inset-0 before:z-5 before:rounded-[14px] before:bg-[rgba(46,204,113,0.03)] before:content-['']",
            isExpanded && 'expanded'
          )}>
          <div ref={editorShellRef} style={customHeight ? { height: customHeight } : undefined}>
            <EditorContent
              editor={editor}
              style={{
                fontSize,
                minHeight: 30
              }}
              onFocus={() => {
                setSearching(false)
                PasteService.setLastFocusedComponent('inputbar')
              }}
            />
          </div>

          <div className="relative z-2 flex h-10 shrink-0 flex-row justify-between gap-4 px-2 py-[5px]">
            <div className="flex min-w-0 flex-1 items-center">
              {assistant && model && <ChatComposerToolMenu scope={scope} assistant={assistant} model={model} />}
            </div>
            <div className="flex flex-row items-center gap-1.5">
              <TranslateButton text={text} disabled={sendDisabled} onTranslated={onTranslated} />
              {loading ? (
                <Tooltip content={t('chat.input.pause')} placement="top">
                  <button
                    type="button"
                    className="flex size-[30px] items-center justify-center rounded-full text-(--color-error-base) hover:bg-accent"
                    aria-label={t('chat.input.pause')}
                    onClick={onPause}>
                    <CirclePause size={20} />
                  </button>
                </Tooltip>
              ) : (
                <SendMessageButton sendMessage={sendMessage} disabled={sendDisabled} />
              )}
            </div>
          </div>
        </div>
      </div>
    </NarrowLayout>
  )
}

interface ChatComposerToolMenuProps {
  scope: InputbarScope
  assistant: Assistant
  model: Model
}

const ChatComposerToolMenu = ({ scope, assistant, model }: ChatComposerToolMenuProps) => {
  const { t } = useTranslation()
  const { triggers } = useInputbarToolsDispatch()
  const quickPanel = useQuickPanel()
  const [open, setOpen] = useState(false)
  const [menuItems, setMenuItems] = useState(() => triggers.getRootMenu())
  const [generateImageEnabled, setGenerateImageEnabled] = useState(false)

  const refreshMenuItems = useCallback(() => {
    setMenuItems(triggers.getRootMenu())
  }, [triggers])

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen)
      if (nextOpen) refreshMenuItems()
    },
    [refreshMenuItems]
  )

  const visibleMenuItems = useMemo(() => menuItems.filter((item) => !item.hidden), [menuItems])

  return (
    <>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex size-[30px] shrink-0 items-center justify-center rounded-full text-foreground-secondary transition-colors hover:bg-accent hover:text-foreground"
            aria-label={t('common.add')}>
            <Plus size={20} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" side="top" sideOffset={10} className="w-64 rounded-[20px] p-2 shadow-xl">
          <MenuList className="gap-1">
            {visibleMenuItems.map((item, index) => (
              <MenuItem
                key={`${String(item.label)}-${index}`}
                icon={<span className="text-foreground-muted [&_svg]:size-5">{item.icon}</span>}
                label={String(item.label)}
                disabled={item.disabled}
                suffix={item.isMenu ? <span className="text-foreground-muted">›</span> : undefined}
                active={item.isSelected}
                onClick={() => {
                  item.action?.({ item, context: quickPanel, action: 'click' })
                  setOpen(false)
                }}
              />
            ))}

            {visibleMenuItems.length > 0 && <MenuDivider />}

            {isGenerateImageModel(model) && (
              <MenuItem
                icon={<Image size={20} />}
                label={t('chat.input.generate_image')}
                active={generateImageEnabled}
                onClick={() => setGenerateImageEnabled((enabled) => !enabled)}
              />
            )}

            <MenuItem
              icon={<MoreHorizontal size={20} />}
              label={t('common.more')}
              onClick={() => {
                triggers.emit(QuickPanelReservedSymbol.Root, { type: 'button' })
                setOpen(false)
              }}
            />
          </MenuList>
        </PopoverContent>
      </Popover>

      <div className="hidden" aria-hidden>
        <InputbarTools scope={scope} assistant={assistant} model={model} />
      </div>
    </>
  )
}

export default ChatComposer
