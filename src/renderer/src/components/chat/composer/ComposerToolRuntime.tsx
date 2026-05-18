import '@renderer/pages/home/Inputbar/tools'

import { MenuDivider, MenuItem, MenuList, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import type {
  QuickPanelInputAdapter,
  QuickPanelListItem,
  QuickPanelReservedSymbol
} from '@renderer/components/QuickPanel'
import { QuickPanelReservedSymbol as ReservedSymbol, useQuickPanel } from '@renderer/components/QuickPanel'
import { useProvider } from '@renderer/hooks/useProvider'
import {
  InputbarToolsProvider,
  useInputbarTools,
  useInputbarToolsDispatch,
  useInputbarToolsInternalDispatch,
  useInputbarToolsState
} from '@renderer/pages/home/Inputbar/context/InputbarToolsProvider'
import type {
  InputbarScope,
  ToolActionKey,
  ToolActionMap,
  ToolContext,
  ToolDefinition,
  ToolQuickPanelApi,
  ToolRenderContext,
  ToolStateKey,
  ToolStateMap
} from '@renderer/pages/home/Inputbar/types'
import { getToolsForScope } from '@renderer/pages/home/Inputbar/types'
import type { Assistant, FileMetadata } from '@renderer/types'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import type { Model } from '@shared/data/types/model'
import { MoreHorizontal, Plus } from 'lucide-react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ComposerToolLauncher, ComposerToolLauncherActionOptions } from './toolLauncher'

interface ComposerToolRuntimeActions {
  resizeTextArea: () => void
  addNewTopic: () => void
  onTextChange: (updater: string | ((prev: string) => string)) => void
  toggleExpanded: (nextState?: boolean) => void
}

interface ComposerToolRuntimeProviderProps {
  children: React.ReactNode
  initialState?: Partial<{
    files: FileMetadata[]
    mentionedModels: Model[]
    selectedKnowledgeBases: KnowledgeBase[]
    isExpanded: boolean
    couldAddImageFile: boolean
    extensions: string[]
  }>
  actions: ComposerToolRuntimeActions
}

export const ComposerToolRuntimeProvider = ({ children, initialState, actions }: ComposerToolRuntimeProviderProps) => {
  return (
    <InputbarToolsProvider initialState={initialState} actions={actions}>
      {children}
    </InputbarToolsProvider>
  )
}

interface ComposerToolRuntimeBootstrapProps {
  scope: InputbarScope
  assistant: Assistant
  model: Model
  session?: ToolContext['session']
}

type AnyToolDefinition = ToolDefinition<readonly ToolStateKey[], readonly ToolActionKey[]>
type AnyToolRenderContext = ToolRenderContext<readonly ToolStateKey[], readonly ToolActionKey[]>

const ComposerToolRenderSlot = ({ tool, context }: { tool: AnyToolDefinition; context: AnyToolRenderContext }) => {
  const render = tool.render
  if (!render) return null
  return <>{render(context)}</>
}

const ComposerToolManagerSlot = ({ tool, context }: { tool: AnyToolDefinition; context: AnyToolRenderContext }) => {
  const Manager = tool.quickPanelManager
  if (!Manager) return null
  return <Manager context={context} />
}

export const ComposerToolRuntimeHost = ({ scope, assistant, model, session }: ComposerToolRuntimeBootstrapProps) => {
  const { t } = useTranslation()
  const toolsContext = useInputbarTools()
  const quickPanelContext = useQuickPanel()
  const quickPanelApiCacheRef = useRef(new Map<string, ToolQuickPanelApi>())
  const launcherApiCacheRef = useRef(new Map<string, ToolRenderContext<any, any>['launcher']>())
  const { provider } = useProvider(model.providerId)

  const availableTools = useMemo(() => {
    return getToolsForScope(scope, { assistant, model, session, provider })
  }, [assistant, model, provider, scope, session])

  const getQuickPanelApiForTool = useCallback(
    (toolKey: string): ToolQuickPanelApi => {
      const cache = quickPanelApiCacheRef.current

      if (!cache.has(toolKey)) {
        cache.set(toolKey, {
          // Composer-native menus are built from launchers. Legacy root menu
          // registrations remain available to the old horizontal Inputbar only.
          registerRootMenu: (entries: QuickPanelListItem[]) => {
            void entries
            return () => undefined
          },
          registerTrigger: (symbol: QuickPanelReservedSymbol, handler: (payload?: unknown) => void) =>
            toolsContext.toolsRegistry.registerTrigger(toolKey, symbol, handler)
        })
      }

      return cache.get(toolKey)!
    },
    [toolsContext.toolsRegistry]
  )

  const getLauncherApiForTool = useCallback(
    (toolKey: string): ToolRenderContext<any, any>['launcher'] => {
      const cache = launcherApiCacheRef.current

      if (!cache.has(toolKey)) {
        cache.set(toolKey, {
          registerLaunchers: (entries) => toolsContext.toolsRegistry.registerLaunchers(toolKey, entries)
        })
      }

      return cache.get(toolKey)!
    },
    [toolsContext.toolsRegistry]
  )

  const buildRenderContext = useCallback(
    <S extends readonly ToolStateKey[], A extends readonly ToolActionKey[]>(
      tool: ToolDefinition<S, A>
    ): ToolRenderContext<S, A> => {
      const deps = tool.dependencies
      const quickPanel = getQuickPanelApiForTool(tool.key)

      const state = (deps?.state || ([] as unknown as S)).reduce(
        (acc, key) => {
          acc[key] = toolsContext[key]
          return acc
        },
        {} as Pick<ToolStateMap, S[number]>
      )

      const runtimeActions = (deps?.actions || ([] as unknown as A)).reduce(
        (acc, key) => {
          const actionValue = toolsContext[key]
          if (actionValue) {
            acc[key] = actionValue
          }
          return acc
        },
        {} as Pick<ToolActionMap, A[number]>
      )

      return {
        scope,
        assistant,
        model,
        session,
        state,
        actions: runtimeActions,
        quickPanel,
        launcher: getLauncherApiForTool(tool.key),
        quickPanelController: quickPanelContext,
        t
      } as ToolRenderContext<S, A>
    },
    [
      assistant,
      getLauncherApiForTool,
      getQuickPanelApiForTool,
      model,
      quickPanelContext,
      scope,
      session,
      t,
      toolsContext
    ]
  )

  useEffect(() => {
    const disposeCallbacks: Array<() => void> = []

    for (const tool of availableTools) {
      const context = buildRenderContext(tool)

      if (tool.launcher) {
        const launchers = tool.launcher.createLaunchers(context)
        const dispose = toolsContext.toolsRegistry.registerLaunchers(tool.key, launchers)
        disposeCallbacks.push(dispose)
      }

      if (!tool.quickPanel?.triggers) continue

      for (const triggerConfig of tool.quickPanel.triggers) {
        const handler = triggerConfig.createHandler(context)
        const dispose = toolsContext.toolsRegistry.registerTrigger(tool.key, triggerConfig.symbol, handler)
        disposeCallbacks.push(dispose)
      }
    }

    return () => {
      disposeCallbacks.forEach((dispose) => dispose())
    }
  }, [availableTools, buildRenderContext, toolsContext.toolsRegistry])

  return (
    <>
      {availableTools.some((tool) => tool.render) && (
        <div className="hidden" aria-hidden>
          {availableTools.map((tool) => {
            if (!tool.render) return null
            return (
              <ComposerToolRenderSlot
                key={`${tool.key}-runtime-render`}
                tool={tool}
                context={buildRenderContext(tool)}
              />
            )
          })}
        </div>
      )}
      {availableTools.map((tool) => {
        if (!tool.quickPanelManager) return null
        return (
          <ComposerToolManagerSlot
            key={`${tool.key}-quick-panel-manager`}
            tool={tool}
            context={buildRenderContext(tool)}
          />
        )
      })}
    </>
  )
}

export const useComposerToolState = useInputbarToolsState
export const useComposerToolDispatch = useInputbarToolsDispatch

interface ComposerToolInternalDispatch {
  setCouldAddImageFile: React.Dispatch<React.SetStateAction<boolean>>
  setExtensions: React.Dispatch<React.SetStateAction<string[]>>
}

export const useComposerToolInternalDispatch = (): ComposerToolInternalDispatch => {
  return useInputbarToolsInternalDispatch()
}

export function useComposerToolLauncherController() {
  const { triggers } = useComposerToolDispatch()
  const quickPanel = useQuickPanel()

  const getLaunchers = useCallback(
    (source?: ComposerToolLauncherActionOptions['source']) => {
      return [
        ...triggers
          .getLaunchers()
          .filter((launcher) => !launcher.hidden)
          .filter((launcher) => !source || !launcher.sources || launcher.sources.includes(source))
      ].sort((left, right) => (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER))
    },
    [triggers]
  )

  const dispatchLauncher = useCallback(
    (
      launcher: ComposerToolLauncher,
      options: Omit<ComposerToolLauncherActionOptions, 'quickPanel'> & {
        quickPanel?: ComposerToolLauncherActionOptions['quickPanel']
      }
    ) => {
      launcher.action?.({
        quickPanel: options.quickPanel ?? quickPanel,
        inputAdapter: options.inputAdapter,
        triggerInfo: options.triggerInfo,
        searchText: options.searchText,
        source: options.source
      })
    },
    [quickPanel]
  )

  return { getLaunchers, dispatchLauncher }
}

interface ComposerToolMenuProps {
  inputAdapter?: QuickPanelInputAdapter
}

export const ComposerToolMenu = ({ inputAdapter }: ComposerToolMenuProps) => {
  const { t } = useTranslation()
  const quickPanel = useQuickPanel()
  const { getLaunchers, dispatchLauncher } = useComposerToolLauncherController()
  const [open, setOpen] = useState(false)
  const [launchers, setLaunchers] = useState(() => getLaunchers('popover'))

  const refreshLaunchers = useCallback(() => {
    setLaunchers(getLaunchers('popover'))
  }, [getLaunchers])

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen)
      if (nextOpen) refreshLaunchers()
    },
    [refreshLaunchers]
  )

  const visibleLaunchers = useMemo(() => launchers.filter((launcher) => !launcher.hidden), [launchers])

  return (
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
          {visibleLaunchers.map((launcher) => (
            <MenuItem
              key={launcher.id}
              icon={<span className="text-foreground-muted [&_svg]:size-5">{launcher.icon}</span>}
              label={String(launcher.label)}
              disabled={launcher.disabled}
              suffix={
                launcher.suffix ??
                (launcher.kind === 'panel' || launcher.kind === 'group' ? (
                  <span className="text-foreground-muted">›</span>
                ) : undefined)
              }
              active={launcher.active}
              onClick={() => {
                dispatchLauncher(launcher, { source: 'popover', inputAdapter })
                setOpen(false)
              }}
            />
          ))}

          {visibleLaunchers.length > 0 && <MenuDivider />}

          <MenuItem
            icon={<MoreHorizontal size={20} />}
            label={t('common.more')}
            onClick={() => {
              const rootLaunchers = getLaunchers('root-panel')
              if (rootLaunchers.length === 0) return

              quickPanel.open({
                title: t('settings.quickPanel.title'),
                list: rootLaunchers.map((launcher) => ({
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
                  action: ({ context, searchText, inputAdapter: quickPanelInputAdapter }) => {
                    dispatchLauncher(launcher, {
                      quickPanel: context,
                      source: 'root-panel',
                      inputAdapter: quickPanelInputAdapter,
                      triggerInfo: context.triggerInfo,
                      searchText
                    })
                  }
                })),
                symbol: ReservedSymbol.Root,
                triggerInfo: { type: 'button' }
              })
              setOpen(false)
            }}
          />
        </MenuList>
      </PopoverContent>
    </Popover>
  )
}
