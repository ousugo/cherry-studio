import { Button } from '@cherrystudio/ui'
import { cacheService } from '@data/CacheService'
import { loggerService } from '@logger'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import ComposerSurface, { type ComposerSurfaceActions } from '@renderer/components/chat/composer/ComposerSurface'
import {
  ComposerToolMenu,
  ComposerToolRuntimeHost,
  ComposerToolRuntimeProvider,
  useComposerToolDispatch,
  useComposerToolInternalDispatch,
  useComposerToolLauncherController,
  useComposerToolState
} from '@renderer/components/chat/composer/ComposerToolRuntime'
import type { QuickPanelInputAdapter } from '@renderer/components/QuickPanel'
import { AgentSelector, ModelSelector } from '@renderer/components/Selector'
import { isGenerateImageModel, isVisionModel } from '@renderer/config/models'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { useAgent, useUpdateAgent } from '@renderer/hooks/agents/useAgent'
import { useAgentModelFilter } from '@renderer/hooks/agents/useAgentModelFilter'
import { useSession, useUpdateSession } from '@renderer/hooks/agents/useSession'
import { useModelById } from '@renderer/hooks/useModel'
import { useProviderDisplayName } from '@renderer/hooks/useProvider'
import { useTimer } from '@renderer/hooks/useTimer'
import { AgentLabel, isSoulModeEnabled } from '@renderer/pages/agents/AgentSettings/shared'
import { getInputbarConfig } from '@renderer/pages/home/Inputbar/registry'
import type { ToolContext } from '@renderer/pages/home/Inputbar/types'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { Assistant, FileMetadata, ThinkingOption } from '@renderer/types'
import { TopicType } from '@renderer/types'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { getSendMessageShortcutLabel } from '@renderer/utils/input'
import { documentExts, imageExts, textExts } from '@shared/config/constant'
import type { AgentSessionEntity } from '@shared/data/api/schemas/sessions'
import type { AgentEntity } from '@shared/data/types/agent'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import { ChevronDown } from 'lucide-react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { createComposerUserMessageParts } from '../composerDraft'
import type { ComposerDraftToken, ComposerSerializedDraft, ComposerSerializedToken } from '../tokens'
import { agentComposerTokenId, agentFileToComposerToken, getAgentComposerTokenIds } from './agentComposerTokens'

const logger = loggerService.withContext('AgentComposer')
const DRAFT_CACHE_TTL = 24 * 60 * 60 * 1000
const AGENT_MANAGED_TOKEN_KINDS = ['file'] as const satisfies readonly ComposerDraftToken['kind'][]
const COMPOSER_TOOLBAR_CLASS =
  'flex min-w-0 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
const COMPOSER_SELECTOR_BUTTON_CLASS = 'h-7 shrink-0 gap-1.5 rounded-full px-2 text-xs'

const getAgentDraftCacheKey = (agentId: string) => `agent-session-draft-${agentId}`

type Props = {
  agentId: string
  sessionId: string
  sessionOverride?: AgentSessionEntity
  sendMessage: (message?: { text: string }, options?: { body?: Record<string, unknown> }) => Promise<void>
  stop: () => Promise<void>
  onNewSessionDraft?: () => void | Promise<void>
  onAgentChange?: (agentId: string | null) => void | Promise<void>
  agentChanging?: boolean
  isStreaming: boolean
}

type ProviderActionHandlers = ComposerSurfaceActions & {
  addNewTopic: () => void
}

const emptyActions: ProviderActionHandlers = {
  resizeTextArea: () => undefined,
  addNewTopic: () => undefined,
  onTextChange: () => undefined,
  toggleExpanded: () => undefined
}

const AgentComposer = ({
  agentId,
  sessionId,
  sessionOverride,
  sendMessage,
  stop,
  onNewSessionDraft,
  onAgentChange,
  agentChanging,
  isStreaming
}: Props) => {
  const { t } = useTranslation()
  const { session: loadedSession } = useSession(sessionOverride ? null : sessionId)
  const session = sessionOverride ?? loadedSession
  const { agent } = useAgent(agentId)
  const { model: sessionModel } = useModelById((agent?.model ?? '') as UniqueModelId)
  const actionsRef = useRef<ProviderActionHandlers>({ ...emptyActions })

  const assistantStub = useMemo<Assistant | null>(() => {
    if (!session || !agent) return null
    const now = new Date().toISOString()
    return {
      id: session.agentId ?? agentId,
      name: session.name ?? t('common.unnamed'),
      prompt: agent.instructions ?? '',
      emoji: '',
      description: '',
      settings: DEFAULT_ASSISTANT_SETTINGS,
      modelId: sessionModel ? sessionModel.id : null,
      modelName: sessionModel?.name ?? null,
      orderKey: '',
      mcpServerIds: [],
      knowledgeBaseIds: [],
      tags: [],
      createdAt: now,
      updatedAt: now
    } satisfies Assistant
  }, [session, agent, agentId, sessionModel, t])

  const sessionData = useMemo(() => {
    if (!session || !agent) return undefined
    return {
      agentId,
      sessionId,
      agentType: agent.type,
      accessiblePaths: session.accessiblePaths ?? []
    }
  }, [session, agent, agentId, sessionId])

  const initialState = useMemo(
    () => ({
      mentionedModels: [],
      selectedKnowledgeBases: [],
      files: [] as FileMetadata[],
      isExpanded: false,
      couldAddImageFile: false,
      extensions: [] as string[]
    }),
    []
  )

  if (!assistantStub) return null

  return (
    <ComposerToolRuntimeProvider
      initialState={initialState}
      actions={{
        resizeTextArea: () => actionsRef.current.resizeTextArea(),
        onTextChange: (updater) => actionsRef.current.onTextChange(updater),
        addNewTopic: () => {
          void onNewSessionDraft?.()
        },
        toggleExpanded: (next) => actionsRef.current.toggleExpanded(next)
      }}>
      <AgentComposerInner
        assistant={assistantStub}
        model={sessionModel}
        agentId={agentId}
        sessionId={sessionId}
        sessionData={sessionData}
        actionsRef={actionsRef}
        chatSendMessage={sendMessage}
        chatStop={stop}
        onAgentChange={onAgentChange}
        agentChanging={agentChanging}
        isStreaming={isStreaming}
      />
    </ComposerToolRuntimeProvider>
  )
}

interface InnerProps {
  assistant: Assistant
  model?: Model
  agentId: string
  sessionId: string
  sessionData?: ToolContext['session']
  actionsRef: React.MutableRefObject<ProviderActionHandlers>
  chatSendMessage: Props['sendMessage']
  chatStop: Props['stop']
  onAgentChange?: Props['onAgentChange']
  agentChanging?: boolean
  isStreaming: boolean
}

interface AgentComposerToolbarControlsProps {
  inputAdapter?: QuickPanelInputAdapter
  agent?: AgentEntity
  model?: Model
  modelProviderName?: string
  modelFilter?: (model: Model) => boolean
  selectAgentLabel: string
  selectModelLabel: string
  agentChanging?: boolean
  onAgentChange: (agentId: string | null) => void | Promise<void>
  onModelSelect: (model: Model | undefined) => void
}

const AgentComposerToolbarControls = ({
  inputAdapter,
  agent,
  model,
  modelProviderName,
  modelFilter,
  selectAgentLabel,
  selectModelLabel,
  agentChanging,
  onAgentChange,
  onModelSelect
}: AgentComposerToolbarControlsProps) => {
  return (
    <div className={COMPOSER_TOOLBAR_CLASS}>
      <ComposerToolMenu inputAdapter={inputAdapter} />
      <AgentSelector
        value={agent?.id ?? null}
        onChange={onAgentChange}
        side="top"
        align="start"
        mountStrategy="lazy-keep"
        trigger={
          <Button variant="ghost" size="sm" className={COMPOSER_SELECTOR_BUTTON_CLASS} disabled={agentChanging}>
            {agent ? (
              <AgentLabel
                agent={agent}
                classNames={{ name: 'max-w-40 text-xs', avatar: 'h-4.5 w-4.5', container: 'gap-1.5' }}
              />
            ) : (
              <span className="max-w-40 truncate text-muted-foreground">{selectAgentLabel}</span>
            )}
            <ChevronDown size={14} className="text-muted-foreground" />
          </Button>
        }
      />
      {agent ? (
        <ModelSelector
          multiple={false}
          value={model}
          onSelect={onModelSelect}
          filter={modelFilter}
          side="top"
          align="start"
          mountStrategy="lazy-keep"
          trigger={
            <Button variant="ghost" size="sm" className={COMPOSER_SELECTOR_BUTTON_CLASS}>
              <ModelAvatar model={model} size={20} />
              <span className="max-w-52 truncate">
                {model ? model.name : selectModelLabel}
                {modelProviderName ? ` | ${modelProviderName}` : ''}
              </span>
              <ChevronDown size={14} className="text-muted-foreground" />
            </Button>
          }
        />
      ) : (
        <Button variant="ghost" size="sm" className={COMPOSER_SELECTOR_BUTTON_CLASS} disabled>
          <span className="max-w-52 truncate text-muted-foreground">{selectModelLabel}</span>
          <ChevronDown size={14} className="text-muted-foreground" />
        </Button>
      )}
    </div>
  )
}

const AgentComposerInner = ({
  assistant,
  model,
  agentId,
  sessionId,
  sessionData,
  actionsRef,
  chatSendMessage,
  chatStop,
  onAgentChange,
  agentChanging,
  isStreaming
}: InnerProps) => {
  const { agent: agentBase } = useAgent(agentId)
  const { updateModel } = useUpdateAgent()
  const { updateSession } = useUpdateSession()
  const scope = TopicType.Session
  const config = getInputbarConfig(scope)
  const { files, isExpanded } = useComposerToolState()
  const { setFiles, setIsExpanded, triggers } = useComposerToolDispatch()
  const { setCouldAddImageFile, setExtensions } = useComposerToolInternalDispatch()
  const { getLaunchers, dispatchLauncher } = useComposerToolLauncherController()
  const [enableSpellCheck] = usePreference('app.spell_check.enabled')
  const [fontSize] = usePreference('chat.message.font_size')
  const [narrowMode] = usePreference('chat.narrow_mode')
  const [sendMessageShortcut] = usePreference('chat.input.send_message_shortcut')
  const { t } = useTranslation()
  const { setTimeoutTimer } = useTimer()
  const [reasoningEffort, setReasoningEffort] = useState<ThinkingOption>('default')
  const modelFilter = useAgentModelFilter(agentBase?.type)
  const providerName = useProviderDisplayName(model?.providerId)
  const draftCacheKey = getAgentDraftCacheKey(agentId)
  const [text, setTextState] = useState(() => cacheService.getCasual<string>(draftCacheKey) ?? '')
  const sessionTopicId = buildAgentSessionTopicId(sessionId)

  const isVisionAssistant = useMemo(() => (model ? isVisionModel(model) : false), [model])
  const isGenerateImageAssistant = useMemo(() => (model ? isGenerateImageModel(model) : false), [model])

  const canAddImageFile = useMemo(
    () => isVisionAssistant || isGenerateImageAssistant,
    [isGenerateImageAssistant, isVisionAssistant]
  )

  const canAddTextFile = useMemo(
    () => isVisionAssistant || (!isVisionAssistant && !isGenerateImageAssistant),
    [isGenerateImageAssistant, isVisionAssistant]
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

  const setText = useCallback(
    (nextText: string) => {
      setTextState(nextText)
      cacheService.setCasual(draftCacheKey, nextText, DRAFT_CACHE_TTL)
    },
    [draftCacheKey]
  )

  const tokens = useMemo(() => files.map(agentFileToComposerToken), [files])

  const handleTokensChange = useCallback(
    (draftTokens: readonly ComposerSerializedToken[]) => {
      const fileTokenIds = getAgentComposerTokenIds(draftTokens, 'file')
      setFiles((prev) => prev.filter((file) => fileTokenIds.has(agentComposerTokenId.file(file))))
    },
    [setFiles]
  )

  useEffect(() => {
    setFiles((prev) => {
      const counts = new Map<string, number>()
      for (const file of prev) {
        const id = agentComposerTokenId.file(file)
        counts.set(id, (counts.get(id) ?? 0) + 1)
      }

      const duplicateIds = new Set([...counts].filter(([, count]) => count > 1).map(([id]) => id))
      if (duplicateIds.size === 0) return prev

      return prev.filter((file) => !duplicateIds.has(agentComposerTokenId.file(file)))
    })
  }, [files, setFiles])

  const handleSurfaceActionsChange = useCallback(
    (actions: ComposerSurfaceActions) => {
      Object.assign(actionsRef.current, actions)
    },
    [actionsRef]
  )

  const abortAgentSession = useCallback(async () => {
    logger.info('Aborting agent session', { sessionTopicId })
    await chatStop()
  }, [chatStop, sessionTopicId])

  const handleAgentChange = useCallback(
    async (nextAgentId: string | null) => {
      if (!nextAgentId || nextAgentId === agentId) return
      if (onAgentChange) {
        await onAgentChange(nextAgentId)
        return
      }
      await updateSession({ id: sessionId, agentId: nextAgentId }, { showSuccessToast: false })
    },
    [agentId, onAgentChange, sessionId, updateSession]
  )

  const handleModelSelect = useCallback(
    (nextModel: Model | undefined) => {
      if (!agentBase || !nextModel) return
      void updateModel(agentBase.id, nextModel.id, { showSuccessToast: false })
    },
    [agentBase, updateModel]
  )

  const toolsSession = useMemo(() => {
    if (!sessionData) return undefined
    return { ...sessionData, reasoningEffort, onReasoningEffortChange: setReasoningEffort }
  }, [sessionData, reasoningEffort])

  const placeholderText = useMemo(() => {
    if (isSoulModeEnabled(agentBase?.configuration)) return t('agent.input.soul_placeholder')
    return t('agent.input.placeholder', {
      key: getSendMessageShortcutLabel(sendMessageShortcut)
    })
  }, [agentBase?.configuration, sendMessageShortcut, t])

  const handleSendDraft = useCallback(
    (draft: ComposerSerializedDraft) => {
      if (text.trim().length === 0 && files.length === 0) return

      const fileTokenIds = getAgentComposerTokenIds(draft.tokens, 'file')
      const attachedFiles = files.filter((file) => fileTokenIds.has(agentComposerTokenId.file(file)))
      const userMessageParts = createComposerUserMessageParts(draft, { files: attachedFiles })

      void chatSendMessage({ text: draft.text }, { body: { agentId, sessionId, userMessageParts } }).catch(
        (error: unknown) => {
          logger.warn('Failed to send message:', error as Error)
        }
      )
      void EventEmitter.emit(EVENT_NAMES.SEND_MESSAGE, { topicId: sessionTopicId })

      setText('')
      setFiles([])
      setTimeoutTimer('agentComposerSendMessage', () => setText(''), 500)
    },
    [agentId, chatSendMessage, files, sessionId, sessionTopicId, setFiles, setText, setTimeoutTimer, text]
  )

  return (
    <>
      {model && <ComposerToolRuntimeHost scope={scope} assistant={assistant} model={model} session={toolsSession} />}
      <ComposerSurface
        text={text}
        onTextChange={setText}
        tokens={tokens}
        managedTokenKinds={AGENT_MANAGED_TOKEN_KINDS}
        onTokensChange={handleTokensChange}
        placeholder={placeholderText}
        sendDisabled={(text.trim().length === 0 && files.length === 0) || isStreaming}
        isLoading={isStreaming}
        onSendDraft={handleSendDraft}
        onPause={abortAgentSession}
        supportedExts={supportedExts}
        setFiles={setFiles}
        filesCount={files.length}
        isExpanded={isExpanded}
        onExpandedChange={setIsExpanded}
        quickPanelEnabled={config.enableQuickPanel ?? true}
        enableQuickPanelTriggers
        enableMentionModelTrigger
        enableDragDrop={config.enableDragDrop ?? true}
        enableSpellCheck={enableSpellCheck}
        fontSize={fontSize}
        narrowMode={narrowMode}
        onActionsChange={handleSurfaceActionsChange}
        getToolLaunchers={() => getLaunchers('root-panel')}
        emitToolTrigger={triggers.emit}
        onToolLauncherSelect={(launcher, options) => dispatchLauncher(launcher, options)}
        renderLeftControls={(inputAdapter) => (
          <AgentComposerToolbarControls
            inputAdapter={inputAdapter}
            agent={agentBase}
            model={model}
            modelProviderName={providerName}
            modelFilter={modelFilter}
            selectAgentLabel={t('chat.alerts.select_agent')}
            selectModelLabel={t('button.select_model')}
            agentChanging={agentChanging}
            onAgentChange={handleAgentChange}
            onModelSelect={handleModelSelect}
          />
        )}
      />
    </>
  )
}

export default AgentComposer
