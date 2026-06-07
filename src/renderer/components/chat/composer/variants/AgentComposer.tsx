import { Button, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useCommandHandler } from '@renderer/commands'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import ComposerSurface, { type ComposerSurfaceActions } from '@renderer/components/chat/composer/ComposerSurface'
import {
  ComposerToolDerivedStateProvider,
  ComposerToolRuntimeHost,
  ComposerToolRuntimeProvider,
  useComposerTokenReconcile,
  useComposerToolDispatch,
  useComposerToolLauncherActions,
  useComposerToolState
} from '@renderer/components/chat/composer/ComposerToolRuntime'
import { getComposerToolConfig } from '@renderer/components/chat/composer/tools/registry'
import type { ToolContext } from '@renderer/components/chat/composer/tools/types'
import type { QuickPanelInputAdapter, QuickPanelListItem } from '@renderer/components/QuickPanel'
import { AgentSelector, ModelSelector, WorkspaceSelector } from '@renderer/components/Selector'
import { useIsActiveTab } from '@renderer/context/TabIdContext'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { isSoulModeEnabled } from '@renderer/hooks/agents/agentConfiguration'
import { useAgent, useUpdateAgent } from '@renderer/hooks/agents/useAgent'
import { useAgentModelFilter } from '@renderer/hooks/agents/useAgentModelFilter'
import { useSession, useUpdateSession } from '@renderer/hooks/agents/useSession'
import { useModelById } from '@renderer/hooks/useModel'
import { useProviderDisplayName } from '@renderer/hooks/useProvider'
import { useAvailableSkills } from '@renderer/hooks/useSkills'
import { useTimer } from '@renderer/hooks/useTimer'
import { AgentLabel } from '@renderer/pages/agents/components/AgentLabel'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { FileMetadata, LocalSkill, ThinkingOption } from '@renderer/types'
import { TopicType } from '@renderer/types'
import { cn } from '@renderer/utils'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { getSendMessageShortcutLabel } from '@renderer/utils/input'
import type { ComposerQueuedMessagePayload } from '@shared/ai/transport'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { AgentEntity } from '@shared/data/types/agent'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import { Bot, ChevronDown, CircleSlash, Folder, Sparkles, TriangleAlert } from 'lucide-react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ComposerDraftToken, ComposerSerializedDraft, ComposerSerializedToken } from '../tokens'
import {
  type AgentComposerDraftCache,
  getAgentDraftCacheKey,
  getCachedSkillTokens,
  getSkillFromCachedToken,
  readAgentDraftCache,
  writeAgentDraftCache
} from './agent/agentDraftCache'
import { useAgentResourceSuggestion } from './agent/useAgentResourceSuggestion'
import {
  agentComposerTokenId,
  agentFileToComposerToken,
  agentSkillToComposerToken,
  getAgentComposerTokenIds
} from './agentComposerTokens'
import {
  COMPOSER_ICON_ONLY_LABEL_CLASS,
  COMPOSER_ICON_ONLY_SELECTOR_BUTTON_CLASS,
  COMPOSER_SELECTOR_BUTTON_CLASS,
  COMPOSER_TOOLBAR_CLASS,
  ComposerBelowControls,
  ComposerToolbarControls,
  ComposerToolMenuControls
} from './shared/ComposerControlScaffolding'
import { buildComposerQueuedPayload } from './shared/composerQueuedPayload'
import { useComposerQuoteInsertion } from './shared/composerQuote'
import { useComposerFileCapabilities } from './shared/useComposerFileCapabilities'

const logger = loggerService.withContext('AgentComposer')

const AGENT_MANAGED_TOKEN_KINDS = ['file', 'skill'] as const satisfies readonly ComposerDraftToken['kind'][]

const createSkillQuickPanelItems = (
  skills: readonly LocalSkill[],
  options: {
    skillLabel: string
    onInsertSkill: (skill: LocalSkill, inputAdapter?: QuickPanelInputAdapter) => void
  }
): QuickPanelListItem[] => {
  return skills.map((skill) => ({
    id: agentComposerTokenId.skill(skill),
    label: skill.name,
    description: skill.description ?? undefined,
    icon: <Sparkles size={16} />,
    suffix: options.skillLabel,
    filterText: `${skill.name} ${skill.description ?? ''} ${options.skillLabel}`,
    action: ({ inputAdapter }) => {
      options.onInsertSkill(skill, inputAdapter)
    }
  }))
}

type Props = {
  agentId: string
  sessionId: string
  sessionOverride?: AgentSessionEntity
  sendMessage: (message?: { text: string }, options?: { body?: Record<string, unknown> }) => Promise<void>
  stop: () => Promise<void>
  onNewSessionDraft?: () => void | Promise<void>
  onAgentChange?: (agentId: string | null) => void | Promise<void>
  agentChanging?: boolean
  workspaceId?: string | null
  onWorkspaceChange?: (workspaceId: string | null) => void | Promise<void>
  showWorkspaceSelector?: boolean
  workspaceChanging?: boolean
  isStreaming: boolean
  sendDisabled?: boolean
}

type AgentComposerRootProps = Props & {
  renderControls: AgentComposerControlsRenderer
}

type ProviderActionHandlers = ComposerSurfaceActions & {
  addNewTopic: () => void
}

const emptyActions: ProviderActionHandlers = {
  addNewTopic: () => undefined,
  focus: () => undefined,
  onTextChange: () => undefined,
  toggleExpanded: () => undefined,
  removeToken: () => undefined,
  insertToken: () => undefined,
  getDraft: () => ({ text: '', tokens: [] })
}

const AgentComposerRoot = ({
  agentId,
  sessionId,
  sessionOverride,
  sendMessage,
  stop,
  onNewSessionDraft,
  onAgentChange,
  agentChanging,
  workspaceId,
  onWorkspaceChange,
  showWorkspaceSelector,
  workspaceChanging,
  isStreaming,
  sendDisabled = false,
  renderControls
}: AgentComposerRootProps) => {
  const { session: loadedSession } = useSession(sessionOverride ? null : sessionId)
  const session = sessionOverride ?? loadedSession
  const { agent } = useAgent(agentId)
  const { model: sessionModel } = useModelById((agent?.model ?? '') as UniqueModelId)
  const actionsRef = useRef<ProviderActionHandlers>({ ...emptyActions })
  const handleNewSessionShortcut = useCallback(() => {
    void onNewSessionDraft?.()
  }, [onNewSessionDraft])

  const isActiveTab = useIsActiveTab()
  useCommandHandler('topic.create', handleNewSessionShortcut, {
    enabled: isActiveTab && Boolean(session && agent && onNewSessionDraft)
  })

  const sessionData = useMemo(() => {
    if (!session || !agent) return undefined
    return {
      agentId,
      sessionId,
      agentType: agent.type,
      accessiblePaths: session.workspace?.path ? [session.workspace.path] : []
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

  if (!session || !agent) return null

  return (
    <ComposerToolRuntimeProvider
      initialState={initialState}
      actions={{
        onTextChange: (updater) => actionsRef.current.onTextChange(updater),
        addNewTopic: () => {
          void onNewSessionDraft?.()
        }
      }}>
      <AgentComposerInner
        model={sessionModel}
        agentId={agentId}
        sessionId={sessionId}
        sessionData={sessionData}
        workspace={session?.workspace ?? null}
        workspaceId={workspaceId ?? session?.workspaceId ?? null}
        actionsRef={actionsRef}
        chatSendMessage={sendMessage}
        chatStop={stop}
        onAgentChange={onAgentChange}
        agentChanging={agentChanging}
        onWorkspaceChange={onWorkspaceChange}
        showWorkspaceSelector={showWorkspaceSelector}
        workspaceChanging={workspaceChanging}
        isStreaming={isStreaming}
        sendDisabled={sendDisabled}
        renderControls={renderControls}
      />
    </ComposerToolRuntimeProvider>
  )
}

interface InnerProps {
  model?: Model
  agentId: string
  sessionId: string
  sessionData?: ToolContext['session']
  workspace?: AgentSessionEntity['workspace']
  workspaceId?: string | null
  actionsRef: React.MutableRefObject<ProviderActionHandlers>
  chatSendMessage: Props['sendMessage']
  chatStop: Props['stop']
  onAgentChange?: Props['onAgentChange']
  agentChanging?: boolean
  onWorkspaceChange?: Props['onWorkspaceChange']
  showWorkspaceSelector?: boolean
  workspaceChanging?: boolean
  isStreaming: boolean
  sendDisabled: boolean
  renderControls: AgentComposerControlsRenderer
}

interface AgentComposerContextControlsProps {
  agent?: AgentEntity
  model?: Model
  modelProviderName?: string
  modelFilter?: (model: Model) => boolean
  selectAgentLabel: string
  selectModelLabel: string
  agentChanging?: boolean
  shouldAutoSelectCreatedAgent: boolean
  side: 'top' | 'bottom'
  iconOnly?: boolean
  onAgentChange: (agentId: string | null) => void | Promise<void>
  onModelSelect: (model: Model | undefined) => void
}

interface AgentComposerWorkspaceControlProps {
  workspace?: AgentSessionEntity['workspace']
  workspaceId?: string | null
  workspaceChanging?: boolean
  workspaceWarning?: string
  selectWorkspaceLabel: string
  side: 'top' | 'bottom'
  iconOnly?: boolean
  onWorkspaceChange?: (workspaceId: string | null) => void | Promise<void>
}

const AgentComposerContextControls = ({
  agent,
  model,
  modelProviderName,
  modelFilter,
  selectAgentLabel,
  selectModelLabel,
  agentChanging,
  shouldAutoSelectCreatedAgent,
  side,
  iconOnly = false,
  onAgentChange,
  onModelSelect
}: AgentComposerContextControlsProps) => {
  const triggerClassName = cn(COMPOSER_SELECTOR_BUTTON_CLASS, iconOnly && COMPOSER_ICON_ONLY_SELECTOR_BUTTON_CLASS)
  const labelClassName = cn('truncate', iconOnly && COMPOSER_ICON_ONLY_LABEL_CLASS)
  const chevronClassName = cn('text-muted-foreground', iconOnly && 'hidden')
  const modelTriggerClassName = cn(
    COMPOSER_SELECTOR_BUTTON_CLASS,
    iconOnly && model && COMPOSER_ICON_ONLY_SELECTOR_BUTTON_CLASS
  )
  const modelLabelClassName = cn('truncate', iconOnly && model && COMPOSER_ICON_ONLY_LABEL_CLASS)
  const modelChevronClassName = cn('text-muted-foreground', iconOnly && model && 'hidden')
  const [agentModelSelectorOpen, setAgentModelSelectorOpen] = useState(false)

  return (
    <>
      <AgentSelector
        value={agent?.id ?? null}
        onChange={onAgentChange}
        autoSelectOnCreate={shouldAutoSelectCreatedAgent}
        side={side}
        align="start"
        mountStrategy="lazy-keep"
        trigger={
          <Button variant="ghost" size="sm" className={triggerClassName} disabled={agentChanging}>
            {agent ? (
              <AgentLabel
                agent={agent}
                classNames={{
                  name: cn('max-w-40 text-xs', iconOnly && COMPOSER_ICON_ONLY_LABEL_CLASS),
                  avatar: 'h-4.5 w-4.5',
                  container: 'gap-1.5'
                }}
              />
            ) : (
              <>
                {iconOnly ? <Bot size={16} aria-hidden /> : null}
                <span className={cn('max-w-40 text-muted-foreground', labelClassName)}>{selectAgentLabel}</span>
              </>
            )}
            <ChevronDown size={14} className={chevronClassName} />
          </Button>
        }
      />
      {agent ? (
        <ModelSelector
          multiple={false}
          value={model}
          onSelect={onModelSelect}
          open={agentModelSelectorOpen}
          onOpenChange={setAgentModelSelectorOpen}
          filter={modelFilter}
          shortcut="chat.model.select"
          side={side}
          align="start"
          mountStrategy="lazy-keep"
          trigger={
            <Button variant="ghost" size="sm" className={modelTriggerClassName}>
              {model ? <ModelAvatar model={model} size={20} /> : null}
              <span className={cn('max-w-52', modelLabelClassName)}>
                {model ? model.name : selectModelLabel}
                {modelProviderName ? ` | ${modelProviderName}` : ''}
              </span>
              <ChevronDown size={14} className={modelChevronClassName} />
            </Button>
          }
        />
      ) : (
        <Button variant="ghost" size="sm" className={COMPOSER_SELECTOR_BUTTON_CLASS} disabled>
          <span className="max-w-52 truncate text-muted-foreground">{selectModelLabel}</span>
          <ChevronDown size={14} className="text-muted-foreground" />
        </Button>
      )}
    </>
  )
}

const AgentComposerWorkspaceControl = ({
  workspace,
  workspaceId,
  workspaceChanging,
  workspaceWarning,
  selectWorkspaceLabel,
  side,
  iconOnly = false,
  onWorkspaceChange
}: AgentComposerWorkspaceControlProps) => {
  const { t } = useTranslation()
  const hasWarning = Boolean(workspaceWarning)
  const isSystemWorkspace = workspace?.type === 'system'
  const selectorValue = isSystemWorkspace ? null : workspaceId
  const workspaceLabel = isSystemWorkspace
    ? t('agent.session.workspace_selector.no_project')
    : (workspace?.name ?? selectWorkspaceLabel)
  const selector = (
    <WorkspaceSelector
      value={selectorValue}
      onChange={onWorkspaceChange ?? (() => undefined)}
      side={side}
      align="start"
      mountStrategy="lazy-keep"
      disabled={!onWorkspaceChange || workspaceChanging}
      trigger={
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            COMPOSER_SELECTOR_BUTTON_CLASS,
            iconOnly && COMPOSER_ICON_ONLY_SELECTOR_BUTTON_CLASS,
            hasWarning && 'text-warning hover:text-warning'
          )}
          disabled={!onWorkspaceChange || workspaceChanging}
          aria-label={workspaceWarning}>
          {hasWarning ? (
            <TriangleAlert size={14} aria-hidden />
          ) : isSystemWorkspace ? (
            <CircleSlash size={14} aria-hidden className="text-muted-foreground" />
          ) : (
            <Folder size={14} aria-hidden className="text-muted-foreground" />
          )}
          <span className={cn('max-w-40 truncate', iconOnly && COMPOSER_ICON_ONLY_LABEL_CLASS)}>{workspaceLabel}</span>
          <ChevronDown size={14} aria-hidden className={cn('text-muted-foreground', iconOnly && 'hidden')} />
        </Button>
      }
    />
  )

  if (!hasWarning) return selector
  return <Tooltip content={workspaceWarning}>{selector}</Tooltip>
}

type AgentComposerControlProps = Omit<AgentComposerContextControlsProps, 'side'> & {
  workspace?: AgentSessionEntity['workspace']
  workspaceId?: string | null
  workspaceChanging?: boolean
  workspaceWarning?: string
  showWorkspaceSelector?: boolean
  selectWorkspaceLabel: string
  onWorkspaceChange?: (workspaceId: string | null) => void | Promise<void>
}
type ComposerSurfaceProps = React.ComponentProps<typeof ComposerSurface>
type AgentComposerControlSlots = Pick<ComposerSurfaceProps, 'renderLeftControls' | 'renderBelowControls'>
type AgentComposerControlsRenderer = (props: AgentComposerControlProps) => AgentComposerControlSlots

const renderAgentToolbarControls: AgentComposerControlsRenderer = (props) => ({
  renderLeftControls: (inputAdapter) => (
    <ComposerToolbarControls
      inputAdapter={inputAdapter}
      renderContextControls={({ side, iconOnly }) => (
        <AgentComposerContextControls {...props} side={side} iconOnly={iconOnly} />
      )}
    />
  )
})

const renderAgentHomeControls: AgentComposerControlsRenderer = (props) => {
  const { showWorkspaceSelector = true } = props

  return {
    renderLeftControls: (inputAdapter) => (
      <div className={COMPOSER_TOOLBAR_CLASS}>
        <ComposerToolMenuControls inputAdapter={inputAdapter} />
      </div>
    ),
    renderBelowControls: () => (
      <ComposerBelowControls
        renderContextControls={({ side, iconOnly }) => (
          <AgentComposerContextControls {...props} side={side} iconOnly={iconOnly} />
        )}
        trailing={
          showWorkspaceSelector
            ? ({ iconOnly }) => <AgentComposerWorkspaceControl {...props} side="bottom" iconOnly={iconOnly} />
            : undefined
        }
      />
    )
  }
}

const AgentComposerInner = ({
  model,
  agentId,
  sessionId,
  sessionData,
  workspace,
  workspaceId,
  actionsRef,
  chatSendMessage,
  chatStop,
  onAgentChange,
  agentChanging,
  onWorkspaceChange,
  showWorkspaceSelector,
  workspaceChanging,
  isStreaming,
  sendDisabled,
  renderControls
}: InnerProps) => {
  const { agent: agentBase } = useAgent(agentId)
  const { updateModel } = useUpdateAgent()
  const { updateSession } = useUpdateSession()
  const scope = TopicType.Session
  const config = getComposerToolConfig(scope)
  const { files, isExpanded } = useComposerToolState()
  const { setFiles, setIsExpanded } = useComposerToolDispatch()
  const { getLaunchers, dispatchLauncher } = useComposerToolLauncherActions()
  const [enableSpellCheck] = usePreference('app.spell_check.enabled')
  const [fontSize] = usePreference('chat.message.font_size')
  const [narrowMode] = usePreference('chat.narrow_mode')
  const [sendMessageShortcut] = usePreference('chat.input.send_message_shortcut')
  const { t } = useTranslation()
  const { setTimeoutTimer } = useTimer()
  const workspaceWarning: string | undefined = undefined
  const initialDraftRef = useRef<AgentComposerDraftCache | null>(null)
  if (initialDraftRef.current === null) {
    initialDraftRef.current = readAgentDraftCache(getAgentDraftCacheKey(agentId))
  }

  const [reasoningEffort, setReasoningEffort] = useState<ThinkingOption>('default')
  const [selectedSkills, setSelectedSkills] = useState<LocalSkill[]>(() =>
    initialDraftRef.current ? initialDraftRef.current.tokens.map(getSkillFromCachedToken) : []
  )
  const modelFilter = useAgentModelFilter(agentBase?.type)
  const providerName = useProviderDisplayName(model?.providerId)
  const draftCacheKey = getAgentDraftCacheKey(agentId)
  const [text, setTextState] = useState(() => initialDraftRef.current?.text ?? '')
  const [draftTokens, setDraftTokens] = useState<ComposerSerializedToken[]>(() => initialDraftRef.current?.tokens ?? [])
  const textRef = useRef(text)
  const draftTokensRef = useRef(draftTokens)
  const sessionTopicId = buildAgentSessionTopicId(sessionId)
  const accessiblePaths = sessionData?.accessiblePaths ?? []
  const enableMentionModelTrigger = accessiblePaths.length > 0
  const { skills: availableSkills, refresh: refreshAvailableSkills } = useAvailableSkills(agentId, workspace?.path)

  const { canAddImageFile, supportedExts } = useComposerFileCapabilities(model)

  const setText = useCallback(
    (nextText: string) => {
      textRef.current = nextText
      setTextState(nextText)
      writeAgentDraftCache(draftCacheKey, nextText, draftTokensRef.current)
    },
    [draftCacheKey]
  )

  useEffect(() => {
    textRef.current = text
  }, [text])

  useEffect(() => {
    draftTokensRef.current = draftTokens
  }, [draftTokens])

  const tokens = useMemo(
    () => [...files.map(agentFileToComposerToken), ...selectedSkills.map(agentSkillToComposerToken)],
    [files, selectedSkills]
  )
  const skillByFilename = useMemo(
    () => new Map(availableSkills.map((skill) => [skill.filename, skill])),
    [availableSkills]
  )
  const resolveSkillMarker = useCallback(
    (marker: string): ComposerDraftToken | null => {
      const skill = skillByFilename.get(marker)
      return skill ? agentSkillToComposerToken(skill) : null
    },
    [skillByFilename]
  )

  const handleSurfaceActionsChange = useCallback(
    (actions: ComposerSurfaceActions) => {
      Object.assign(actionsRef.current, actions)
    },
    [actionsRef]
  )

  const insertSkillToken = useCallback(
    (skill: LocalSkill, inputAdapter?: QuickPanelInputAdapter) => {
      if (!inputAdapter?.insertToken) return

      const token = agentSkillToComposerToken(skill)
      const exists = selectedSkills.some((selectedSkill) => agentComposerTokenId.skill(selectedSkill) === token.id)
      if (!exists) {
        inputAdapter.insertToken(token)
        setSelectedSkills((prev) =>
          prev.some((selectedSkill) => agentComposerTokenId.skill(selectedSkill) === token.id) ? prev : [...prev, skill]
        )
      }
      inputAdapter.focus()
    },
    [selectedSkills]
  )

  const rootPanelSkillItems = useMemo(
    () =>
      createSkillQuickPanelItems(availableSkills, {
        skillLabel: t('plugins.skills'),
        onInsertSkill: insertSkillToken
      }),
    [availableSkills, insertSkillToken, t]
  )

  const handleRootPanelOpen = useCallback(() => {
    void refreshAvailableSkills().catch((error) => {
      logger.warn('Failed to refresh available skills when opening root panel', { error })
    })
  }, [refreshAvailableSkills])

  useComposerQuoteInsertion(actionsRef, isExpanded)

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

  // File reconcile (prune + dedup) is owned by attachmentTool via the tools DI seam. Skill
  // reconcile stays here (agent-only, no shared duplication) alongside the editor draft-token
  // cache snapshot, which is variant state.
  const reconcileTokens = useComposerTokenReconcile({ scope, model, session: toolsSession })
  const handleTokensChange = useCallback(
    (draftTokens: readonly ComposerSerializedToken[]) => {
      const nextDraftTokens = getCachedSkillTokens(draftTokens)
      setDraftTokens(nextDraftTokens)
      draftTokensRef.current = nextDraftTokens
      writeAgentDraftCache(draftCacheKey, textRef.current, nextDraftTokens)
      reconcileTokens(draftTokens)

      const skillTokenIds = getAgentComposerTokenIds(draftTokens, 'skill')
      const skillTokens = draftTokens.filter((token) => token.kind === 'skill')
      setSelectedSkills((prev) => {
        const next = prev.filter((skill) => skillTokenIds.has(agentComposerTokenId.skill(skill)))
        const nextIds = new Set(next.map(agentComposerTokenId.skill))
        let changed = next.length !== prev.length

        for (const token of skillTokens) {
          const skill = availableSkills.find((candidate) => {
            const candidateId = agentComposerTokenId.skill(candidate)
            return candidateId === token.id || candidate.name === token.label || candidate.filename === token.label
          })
          if (!skill) continue

          const skillId = agentComposerTokenId.skill(skill)
          if (nextIds.has(skillId)) continue
          next.push(skill)
          nextIds.add(skillId)
          changed = true
        }

        return changed ? next : prev
      })
    },
    [availableSkills, draftCacheKey, reconcileTokens]
  )

  const placeholderText = useMemo(() => {
    if (isSoulModeEnabled(agentBase?.configuration)) return t('agent.input.soul_placeholder')
    return t('agent.input.placeholder', {
      key: getSendMessageShortcutLabel(sendMessageShortcut)
    })
  }, [agentBase?.configuration, sendMessageShortcut, t])

  const buildQueuedPayload = useCallback(
    (draft: ComposerSerializedDraft): ComposerQueuedMessagePayload | null =>
      buildComposerQueuedPayload(draft, { files, fileTokenId: agentComposerTokenId.file }),
    [files]
  )

  const sendQueuedPayload = useCallback(
    async (payload: ComposerQueuedMessagePayload) => {
      try {
        await chatSendMessage(
          { text: payload.text },
          { body: { agentId, sessionId, userMessageParts: payload.userMessageParts } }
        )
        void EventEmitter.emit(EVENT_NAMES.SEND_MESSAGE, { topicId: sessionTopicId })
        return true
      } catch (error: unknown) {
        logger.warn('Failed to send message:', error as Error)
        return false
      }
    },
    [agentId, chatSendMessage, sessionId, sessionTopicId]
  )

  const clearCurrentDraft = useCallback(() => {
    setText('')
    setFiles([])
    setSelectedSkills([])
    setDraftTokens([])
    draftTokensRef.current = []
    writeAgentDraftCache(draftCacheKey, '', [])
    setTimeoutTimer('agentComposerSendMessage', () => setText(''), 500)
  }, [draftCacheKey, setFiles, setText, setTimeoutTimer])

  const handleSendDraft = useCallback(
    (draft: ComposerSerializedDraft) => {
      if (sendDisabled) return
      // The send queue was removed; while the session is streaming we no longer buffer
      // messages, so block sending until it finishes instead of dispatching concurrently.
      if (isStreaming) return
      if (!model) {
        window.toast?.error(t('code.model_required'))
        return
      }
      if (workspaceWarning) {
        window.toast?.error(workspaceWarning)
        return
      }
      const payload = buildQueuedPayload(draft)
      if (!payload) return

      clearCurrentDraft()
      void sendQueuedPayload(payload).catch((error: unknown) => {
        logger.warn('Failed to send message:', error as Error)
      })
    },
    [buildQueuedPayload, clearCurrentDraft, isStreaming, model, sendDisabled, sendQueuedPayload, t, workspaceWarning]
  )

  const suggestionSources = useAgentResourceSuggestion({
    accessiblePaths,
    files,
    setFiles,
    enabled: enableMentionModelTrigger
  })

  const controlSlots = renderControls({
    agent: agentBase,
    model,
    modelProviderName: providerName,
    modelFilter,
    workspace,
    workspaceId,
    workspaceWarning,
    selectAgentLabel: t('chat.alerts.select_agent'),
    selectModelLabel: t('button.select_model'),
    selectWorkspaceLabel: t('agent.session.workspace_selector.placeholder'),
    agentChanging,
    shouldAutoSelectCreatedAgent: Boolean(onAgentChange),
    workspaceChanging,
    showWorkspaceSelector,
    onAgentChange: handleAgentChange,
    onWorkspaceChange,
    onModelSelect: handleModelSelect
  })

  return (
    <ComposerToolDerivedStateProvider couldAddImageFile={canAddImageFile} extensions={supportedExts}>
      {model && <ComposerToolRuntimeHost scope={scope} model={model} session={toolsSession} />}
      <ComposerSurface
        text={text}
        onTextChange={setText}
        tokens={tokens}
        draftTokens={draftTokens}
        managedTokenKinds={AGENT_MANAGED_TOKEN_KINDS}
        onTokensChange={handleTokensChange}
        resolveSkillMarker={resolveSkillMarker}
        placeholder={placeholderText}
        sendDisabled={
          isStreaming || sendDisabled || (text.trim().length === 0 && files.length === 0 && selectedSkills.length === 0)
        }
        sendBlockedReason={sendDisabled ? t('common.loading') : undefined}
        isLoading={isStreaming}
        onSendDraft={handleSendDraft}
        onPause={abortAgentSession}
        supportedExts={supportedExts}
        setFiles={setFiles}
        filesCount={files.length}
        isExpanded={isExpanded}
        onExpandedChange={setIsExpanded}
        quickPanelEnabled={config.enableQuickPanel ?? true}
        enableDragDrop={config.enableDragDrop ?? true}
        enableSpellCheck={enableSpellCheck}
        fontSize={fontSize}
        narrowMode={narrowMode}
        onActionsChange={handleSurfaceActionsChange}
        getToolLaunchers={() => getLaunchers()}
        suggestionSources={suggestionSources}
        rootPanelAdditionalItems={rootPanelSkillItems}
        onRootPanelOpen={handleRootPanelOpen}
        onToolLauncherSelect={(launcher, options) => dispatchLauncher(launcher, options)}
        {...controlSlots}
      />
    </ComposerToolDerivedStateProvider>
  )
}

type MissingAgentHomeComposerProps = {
  onAgentChange?: (agentId: string | null) => void | Promise<void>
  agentChanging?: boolean
}

type MissingAgentHomeComposerInnerProps = MissingAgentHomeComposerProps & {
  actionsRef: React.RefObject<ProviderActionHandlers>
}

const MissingAgentHomeComposerInner = ({
  onAgentChange,
  agentChanging,
  actionsRef
}: MissingAgentHomeComposerInnerProps) => {
  const config = getComposerToolConfig(TopicType.Session)
  const { files, isExpanded } = useComposerToolState()
  const { setFiles, setIsExpanded } = useComposerToolDispatch()
  const { getLaunchers, dispatchLauncher } = useComposerToolLauncherActions()
  const [enableSpellCheck] = usePreference('app.spell_check.enabled')
  const [fontSize] = usePreference('chat.message.font_size')
  const [narrowMode] = usePreference('chat.narrow_mode')
  const [sendMessageShortcut] = usePreference('chat.input.send_message_shortcut')
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const selectAgentMessage = t('chat.alerts.select_agent')
  const handleSurfaceActionsChange = useCallback(
    (actions: ComposerSurfaceActions) => {
      Object.assign(actionsRef.current, actions)
    },
    [actionsRef]
  )
  const handleAgentChange = useCallback(
    async (nextAgentId: string | null) => {
      if (!nextAgentId) return
      if (text.trim().length > 0) {
        writeAgentDraftCache(getAgentDraftCacheKey(nextAgentId), text, [])
      }
      await onAgentChange?.(nextAgentId)
    },
    [onAgentChange, text]
  )
  const handleBlockedSend = useCallback(() => {
    window.toast?.error(selectAgentMessage)
  }, [selectAgentMessage])
  const placeholderText = t('agent.input.placeholder', {
    key: getSendMessageShortcutLabel(sendMessageShortcut)
  })
  const controlSlots = renderAgentHomeControls({
    agent: undefined,
    model: undefined,
    modelProviderName: undefined,
    modelFilter: undefined,
    workspace: undefined,
    workspaceId: null,
    workspaceWarning: undefined,
    selectAgentLabel: selectAgentMessage,
    selectModelLabel: t('button.select_model'),
    selectWorkspaceLabel: t('agent.session.workspace_selector.placeholder'),
    agentChanging,
    shouldAutoSelectCreatedAgent: true,
    workspaceChanging: false,
    showWorkspaceSelector: false,
    onAgentChange: handleAgentChange,
    onWorkspaceChange: undefined,
    onModelSelect: () => undefined
  })

  return (
    <ComposerToolDerivedStateProvider couldAddImageFile={false} extensions={[]}>
      <ComposerSurface
        text={text}
        onTextChange={setText}
        tokens={[]}
        draftTokens={[]}
        managedTokenKinds={AGENT_MANAGED_TOKEN_KINDS}
        onTokensChange={() => undefined}
        placeholder={placeholderText}
        sendDisabled
        sendBlockedReason={selectAgentMessage}
        isLoading={false}
        onSendDraft={handleBlockedSend}
        onPause={() => undefined}
        supportedExts={[]}
        setFiles={setFiles}
        filesCount={files.length}
        isExpanded={isExpanded}
        onExpandedChange={setIsExpanded}
        quickPanelEnabled={config.enableQuickPanel ?? true}
        enableDragDrop={false}
        enableSpellCheck={enableSpellCheck}
        fontSize={fontSize}
        narrowMode={narrowMode}
        onActionsChange={handleSurfaceActionsChange}
        getToolLaunchers={() => getLaunchers()}
        onToolLauncherSelect={(launcher, options) => dispatchLauncher(launcher, options)}
        {...controlSlots}
      />
    </ComposerToolDerivedStateProvider>
  )
}

export const MissingAgentHomeComposer = (props: MissingAgentHomeComposerProps) => {
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
  const actionsRef = useRef<ProviderActionHandlers>({ ...emptyActions })

  return (
    <ComposerToolRuntimeProvider
      initialState={initialState}
      actions={{
        onTextChange: (updater) => actionsRef.current.onTextChange(updater),
        addNewTopic: () => undefined
      }}>
      <MissingAgentHomeComposerInner {...props} actionsRef={actionsRef} />
    </ComposerToolRuntimeProvider>
  )
}

const AgentComposer = (props: Props) => {
  return <AgentComposerRoot {...props} renderControls={renderAgentToolbarControls} />
}

export const AgentHomeComposer = (props: Props) => {
  return <AgentComposerRoot {...props} renderControls={renderAgentHomeControls} />
}

export default AgentComposer
