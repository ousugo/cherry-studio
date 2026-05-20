import '@renderer/components/chat/composer/tools'

import { MenuDivider, MenuItem, MenuList, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import {
  ComposerToolProvider,
  useComposerToolProvider,
  useComposerToolProviderDispatch,
  useComposerToolProviderInternalDispatch,
  useComposerToolProviderState
} from '@renderer/components/chat/composer/tools/ComposerToolProvider'
import type {
  ComposerToolScope,
  ToolActionKey,
  ToolActionMap,
  ToolContext,
  ToolDefinition,
  ToolRenderContext,
  ToolStateKey,
  ToolStateMap
} from '@renderer/components/chat/composer/tools/types'
import { getToolsForScope } from '@renderer/components/chat/composer/tools/types'
import type { QuickPanelInputAdapter } from '@renderer/components/QuickPanel'
import { QuickPanelReservedSymbol as ReservedSymbol, useQuickPanel } from '@renderer/components/QuickPanel'
import { useProvider } from '@renderer/hooks/useProvider'
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
    <ComposerToolProvider initialState={initialState} actions={actions}>
      {children}
    </ComposerToolProvider>
  )
}

interface ComposerToolRuntimeBootstrapProps {
  scope: ComposerToolScope
  assistant: Assistant
  model: Model
  session?: ToolContext['session']
}

type AnyToolDefinition = ToolDefinition<readonly ToolStateKey[], readonly ToolActionKey[]>
type AnyToolRenderContext = ToolRenderContext<readonly ToolStateKey[], readonly ToolActionKey[]>

const ComposerToolRuntimeSlot = ({ tool, context }: { tool: AnyToolDefinition; context: AnyToolRenderContext }) => {
  const Runtime = tool.composer?.runtime
  if (!Runtime) return null
  return <Runtime context={context} />
}

export const ComposerToolRuntimeHost = ({ scope, assistant, model, session }: ComposerToolRuntimeBootstrapProps) => {
  const { t } = useTranslation()
  const toolsContext = useComposerToolProvider()
  const quickPanelContext = useQuickPanel()
  const launcherApiCacheRef = useRef(new Map<string, ToolRenderContext<any, any>['launcher']>())
  const { provider } = useProvider(model.providerId)

  const availableTools = useMemo(() => {
    return getToolsForScope(scope, { assistant, model, session, provider })
  }, [assistant, model, provider, scope, session])

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
        launcher: getLauncherApiForTool(tool.key),
        quickPanelController: quickPanelContext,
        t
      } as ToolRenderContext<S, A>
    },
    [assistant, getLauncherApiForTool, model, quickPanelContext, scope, session, t, toolsContext]
  )

  useEffect(() => {
    const disposeCallbacks: Array<() => void> = []

    for (const tool of availableTools) {
      const context = buildRenderContext(tool)

      if (tool.composer?.menuItems) {
        const launchers = tool.composer.menuItems.createItems(context)
        const dispose = toolsContext.toolsRegistry.registerLaunchers(tool.key, launchers)
        disposeCallbacks.push(dispose)
      }
    }

    return () => {
      disposeCallbacks.forEach((dispose) => dispose())
    }
  }, [availableTools, buildRenderContext, toolsContext.toolsRegistry])

  return (
    <>
      {availableTools.map((tool) => {
        if (!tool.composer?.runtime) return null
        return (
          <ComposerToolRuntimeSlot
            key={`${tool.key}-composer-runtime`}
            tool={tool}
            context={buildRenderContext(tool)}
          />
        )
      })}
    </>
  )
}

export const useComposerToolState = useComposerToolProviderState
export const useComposerToolDispatch = useComposerToolProviderDispatch

interface ComposerToolInternalDispatch {
  setCouldAddImageFile: React.Dispatch<React.SetStateAction<boolean>>
  setExtensions: React.Dispatch<React.SetStateAction<string[]>>
}

export const useComposerToolInternalDispatch = (): ComposerToolInternalDispatch => {
  return useComposerToolProviderInternalDispatch()
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

export const ComposerActiveToolControls = ({ inputAdapter }: ComposerToolMenuProps) => {
  const { getLaunchers, dispatchLauncher } = useComposerToolLauncherController()
  const activeLaunchers = useMemo(
    () => getLaunchers('popover').filter((launcher) => launcher.active && !launcher.hidden),
    [getLaunchers]
  )

  if (activeLaunchers.length === 0) return null

  return (
    <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
      {activeLaunchers.map((launcher) => (
        <button
          key={launcher.id}
          type="button"
          className="flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2 font-medium text-foreground-secondary text-xs transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40 data-[active=true]:bg-accent data-[active=true]:text-foreground [&_svg]:size-4"
          data-active
          disabled={launcher.disabled}
          aria-label={typeof launcher.label === 'string' ? launcher.label : undefined}
          onClick={() => dispatchLauncher(launcher, { source: 'popover', inputAdapter })}>
          <span className="flex shrink-0 items-center justify-center text-foreground-muted">{launcher.icon}</span>
          {launcher.suffix ? <span className="max-w-24 truncate">{launcher.suffix}</span> : null}
        </button>
      ))}
    </div>
  )
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
