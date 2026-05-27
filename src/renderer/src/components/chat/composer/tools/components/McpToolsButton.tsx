import type { ComposerDraftToken } from '@renderer/components/chat/composer/tokens'
import type { ComposerToolLauncher } from '@renderer/components/chat/composer/toolLauncher'
import type { ToolLauncherApi } from '@renderer/components/chat/composer/tools/types'
import type { QuickPanelInputAdapter, QuickPanelListItem, QuickPanelOpenOptions } from '@renderer/components/QuickPanel'
import { QuickPanelReservedSymbol, useQuickPanel } from '@renderer/components/QuickPanel'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useMcpServers } from '@renderer/hooks/useMcpServer'
import { useProvider } from '@renderer/hooks/useProvider'
import { useTimer } from '@renderer/hooks/useTimer'
import type { AssistantSettings, McpMode, MCPPrompt, MCPResource } from '@renderer/types'
import { getEffectiveMcpMode } from '@renderer/types'
import { isToolUseModeFunction } from '@renderer/utils/assistant'
import type { MCPServer } from '@shared/data/types/mcpServer'
import { isGemini3Model, isGeminiModel } from '@shared/utils/model'
import { isGeminiWebSearchProvider } from '@shared/utils/provider'
import { useNavigate } from '@tanstack/react-router'
import { Form, Input } from 'antd'
import { Hammer, Plus } from 'lucide-react'
import type { Dispatch, FC, SetStateAction } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  assistantId: string
  launcher: ToolLauncherApi
  setInputValue: Dispatch<SetStateAction<string>>
  disabled?: boolean
  disabledReason?: string
}

interface PromptArgument {
  name: string
  description?: string
  required?: boolean
}

interface MCPPromptWithArgs extends MCPPrompt {
  arguments?: PromptArgument[]
}

interface ResourceData {
  blob?: string
  mimeType?: string
  name?: string
  text?: string
  uri?: string
}

type McpComposerTokenKind = Extract<ComposerDraftToken['kind'], 'mcpPrompt' | 'mcpResource'>

interface McpComposerTokenInput {
  id: string
  kind: McpComposerTokenKind
  label: string
  description?: string
  payload?: unknown
}

const extractPromptContent = (response: any): string | null => {
  if (typeof response === 'string') {
    return response
  }

  if (response && Array.isArray(response.messages)) {
    let formattedContent = ''

    for (const message of response.messages) {
      if (!message.content) continue

      const rolePrefix = message.role ? `**${message.role.charAt(0).toUpperCase() + message.role.slice(1)}:** ` : ''

      switch (message.content.type) {
        case 'text':
          formattedContent += `${rolePrefix}${message.content.text}\n\n`
          break

        case 'image':
          if (message.content.data && message.content.mimeType) {
            if (rolePrefix) {
              formattedContent += `${rolePrefix}\n`
            }
            formattedContent += `![Image](data:${message.content.mimeType};base64,${message.content.data})\n\n`
          }
          break

        case 'audio':
          formattedContent += `${rolePrefix}[Audio content available]\n\n`
          break

        case 'resource':
          if (message.content.text) {
            formattedContent += `${rolePrefix}${message.content.text}\n\n`
          } else {
            formattedContent += `${rolePrefix}[Resource content available]\n\n`
          }
          break

        default:
          if (message.content.text) {
            formattedContent += `${rolePrefix}${message.content.text}\n\n`
          }
      }
    }

    return formattedContent.trim()
  }

  if (response && response.messages && response.messages.length > 0) {
    const message = response.messages[0]
    if (message.content && message.content.text) {
      const rolePrefix = message.role ? `**${message.role.charAt(0).toUpperCase() + message.role.slice(1)}:** ` : ''
      return `${rolePrefix}${message.content.text}`
    }
  }

  return null
}

const hammerIcon = <Hammer />
const plusIcon = <Plus />
const MCP_LAUNCHER_ORDER_BASE = 90

const useMcpToolsController = ({ launcher, setInputValue, assistantId, disabled, disabledReason }: Props) => {
  const { mcpServers: activedMcpServers } = useMcpServers({ isActive: true })
  const { t } = useTranslation()
  const quickPanelHook = useQuickPanel()
  const navigate = useNavigate()
  const [form] = Form.useForm()

  const { assistant, model, updateAssistant } = useAssistant(assistantId)
  const { provider: modelProvider } = useProvider(model?.providerId ?? '')
  const { setTimeoutTimer } = useTimer()

  const isMountedRef = useRef(true)

  useEffect(() => {
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const currentMode = useMemo(() => (assistant ? getEffectiveMcpMode(assistant) : 'disabled'), [assistant])
  const isDisabled = disabled || !assistant
  const resolvedDisabledReason = isDisabled
    ? (disabledReason ?? t('assistants.settings.mcp.mode.disabled.description'))
    : undefined

  const modeLabelMap = useMemo(
    () => ({
      disabled: t('assistants.settings.mcp.mode.disabled.label'),
      auto: t('assistants.settings.mcp.mode.auto.label'),
      manual: t('assistants.settings.mcp.mode.manual.label')
    }),
    [t]
  )

  const mcpServerIds = useMemo(() => new Set(assistant?.mcpServerIds ?? []), [assistant?.mcpServerIds])

  const mergeSettings = useCallback(
    (patch: Partial<AssistantSettings>): AssistantSettings | undefined => {
      if (!assistant?.settings) return undefined
      return { ...assistant.settings, ...patch }
    },
    [assistant?.settings]
  )

  const handleModeChange = useCallback(
    (mode: McpMode) => {
      setTimeoutTimer(
        'updateMcpMode',
        async () => {
          const next = mergeSettings({ mcpMode: mode })
          if (next) await updateAssistant({ settings: next })
        },
        200
      )
    },
    [mergeSettings, setTimeoutTimer, updateAssistant]
  )

  const cycleMcpMode = useCallback(() => {
    if (isDisabled) return
    const modes: McpMode[] = ['disabled', 'auto', 'manual']
    const currentIndex = modes.indexOf(currentMode)
    const nextMode = modes[(currentIndex + 1) % modes.length]
    handleModeChange(nextMode)
  }, [currentMode, handleModeChange, isDisabled])

  const handleMcpServerSelect = useCallback(
    (server: MCPServer) => {
      const nextServerIds = mcpServerIds.has(server.id)
        ? Array.from(mcpServerIds).filter((id) => id !== server.id)
        : [...Array.from(mcpServerIds), server.id]

      const settingsPatch: Partial<AssistantSettings> = { mcpMode: 'manual' }
      if (nextServerIds.length > 0 && model && isGeminiModel(model) && assistant && isToolUseModeFunction(assistant)) {
        // Gemini 3+ supports combining built-in tools with function calling
        if (
          modelProvider &&
          isGeminiWebSearchProvider(modelProvider) &&
          assistant.settings?.enableWebSearch &&
          !isGemini3Model(model)
        ) {
          window.toast.warning(t('chat.mcp.warning.gemini_web_search'))
          settingsPatch.enableWebSearch = false
        }
      }

      const nextSettings = mergeSettings(settingsPatch)
      if (!nextSettings) return
      void updateAssistant({
        mcpServerIds: nextServerIds,
        settings: nextSettings
      })
    },
    [assistant, mcpServerIds, model, modelProvider, mergeSettings, t, updateAssistant]
  )

  const manualModeMenuItems = useMemo(() => {
    const newList: QuickPanelListItem[] = activedMcpServers.map((server) => ({
      label: server.name,
      description: server.description || server.baseUrl,
      icon: hammerIcon,
      action: () => handleMcpServerSelect(server),
      isSelected: mcpServerIds.has(server.id)
    }))

    newList.push({
      label: t('settings.mcp.addServer.label') + '...',
      icon: plusIcon,
      action: () => navigate({ to: '/settings/mcp' })
    })

    return newList
  }, [activedMcpServers, handleMcpServerSelect, t, mcpServerIds, navigate])

  const openManualModePanel = useCallback(() => {
    quickPanelHook.open({
      title: t('assistants.settings.mcp.mode.manual.label'),
      list: manualModeMenuItems,
      symbol: QuickPanelReservedSymbol.Mcp,
      multiple: true,
      afterAction({ item }) {
        item.isSelected = !item.isSelected
      }
    })
  }, [manualModeMenuItems, quickPanelHook, t])

  const modeSubmenu = useMemo(
    () =>
      (['disabled', 'auto', 'manual'] as const).map((mode, index) => ({
        id: `mcp-mode-${mode}`,
        kind: 'command' as const,
        sources: ['popover', 'root-panel'] as const,
        order: MCP_LAUNCHER_ORDER_BASE + index / 100,
        label: modeLabelMap[mode],
        description: t('settings.mcp.title'),
        icon: hammerIcon,
        active: currentMode === mode,
        disabled: isDisabled,
        disabledReason: resolvedDisabledReason,
        action: () => {
          handleModeChange(mode)
          if (mode === 'manual') openManualModePanel()
        }
      })),
    [currentMode, handleModeChange, isDisabled, modeLabelMap, openManualModePanel, resolvedDisabledReason, t]
  )

  const insertPromptContent = useCallback(
    (promptText: string, tokenInput?: McpComposerTokenInput, inputAdapter?: QuickPanelInputAdapter) => {
      if (inputAdapter?.insertToken && tokenInput) {
        inputAdapter.insertToken({
          ...tokenInput,
          promptText
        })
        inputAdapter.focus()
        return
      }

      setInputValue((prev) => {
        const separator = prev.length > 0 && !/\s$/.test(prev) ? '\n' : ''
        return `${prev}${separator}${promptText}`
      })
    },
    [setInputValue]
  )

  const handlePromptSelect = useCallback(
    (prompt: MCPPromptWithArgs, inputAdapter?: QuickPanelInputAdapter) => {
      if (isDisabled) return

      const server = activedMcpServers.find((s) => s.id === prompt.serverId)
      if (!server) return

      const createPromptToken = (args?: Record<string, string>): McpComposerTokenInput => ({
        id: `mcpPrompt:${prompt.serverId}:${prompt.name}`,
        kind: 'mcpPrompt',
        label: prompt.name,
        description: prompt.serverName,
        payload: {
          serverId: prompt.serverId,
          serverName: prompt.serverName,
          name: prompt.name,
          ...(args && { args })
        }
      })

      const handlePromptResponse = async (response: any, args?: Record<string, string>) => {
        const promptContent = extractPromptContent(response)
        if (promptContent) {
          insertPromptContent(promptContent, createPromptToken(args), inputAdapter)
        } else {
          throw new Error('Invalid prompt response format')
        }
      }

      const handlePromptWithArgs = async () => {
        try {
          form.resetFields()

          const result = await new Promise<Record<string, string>>((resolve, reject) => {
            window.modal.confirm({
              title: `${t('settings.mcp.prompts.arguments')}: ${prompt.name}`,
              content: (
                <Form form={form} layout="vertical">
                  {prompt.arguments?.map((arg, index) => (
                    <Form.Item
                      key={index}
                      name={arg.name}
                      label={`${arg.name}${arg.required ? ' *' : ''}`}
                      tooltip={arg.description}
                      rules={
                        arg.required ? [{ required: true, message: t('settings.mcp.prompts.requiredField') }] : []
                      }>
                      <Input placeholder={arg.description || arg.name} />
                    </Form.Item>
                  ))}
                </Form>
              ),
              onOk: async () => {
                try {
                  const values = await form.validateFields()
                  resolve(values)
                } catch (error) {
                  reject(error)
                }
              },
              onCancel: () => reject(new Error('cancelled')),
              okText: t('common.confirm'),
              cancelText: t('common.cancel')
            })
          })

          const response = await window.api.mcp.getPrompt({
            serverId: server.id,
            name: prompt.name,
            args: result
          })

          await handlePromptResponse(response, result)
        } catch (error: any) {
          if (error.message !== 'cancelled') {
            window.modal.error({
              title: t('common.error'),
              content: error.message || t('settings.mcp.prompts.genericError')
            })
          }
        }
      }

      const handlePromptWithoutArgs = async () => {
        try {
          const response = await window.api.mcp.getPrompt({
            serverId: server.id,
            name: prompt.name
          })
          await handlePromptResponse(response)
        } catch (error: any) {
          window.modal.error({
            title: t('common.error'),
            content: error.message || t('settings.mcp.prompts.genericError')
          })
        }
      }

      requestAnimationFrame(() => {
        const hasArguments = prompt.arguments && prompt.arguments.length > 0
        if (hasArguments) {
          void handlePromptWithArgs()
        } else {
          void handlePromptWithoutArgs()
        }
      })
    },
    [activedMcpServers, form, isDisabled, t, insertPromptContent]
  )

  const [prompts, setPrompts] = useState<MCPPrompt[]>([])
  const [promptLoadError, setPromptLoadError] = useState<string | undefined>()

  useEffect(() => {
    if (isDisabled) {
      setPrompts((current) => (current.length === 0 ? current : []))
      setPromptLoadError(undefined)
      return
    }

    let cancelled = false

    const fetchPrompts = async () => {
      const results = await Promise.allSettled(activedMcpServers.map((server) => window.api.mcp.listPrompts(server.id)))
      if (!cancelled) {
        const successfulPrompts = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
        const failedCount = results.filter((result) => result.status === 'rejected').length
        setPrompts(successfulPrompts)
        setPromptLoadError(failedCount > 0 ? t('settings.mcp.prompts.genericError') : undefined)
      }
    }

    void fetchPrompts()
    return () => {
      cancelled = true
    }
  }, [activedMcpServers, isDisabled, t])

  const promptList = useMemo<QuickPanelListItem[]>(() => {
    const items: QuickPanelListItem[] = prompts.map((prompt) => ({
      label: prompt.name,
      description: prompt.description,
      icon: hammerIcon,
      action: (options) => handlePromptSelect(prompt as MCPPromptWithArgs, options.inputAdapter)
    }))

    if (promptLoadError) {
      items.push({
        label: promptLoadError,
        icon: hammerIcon,
        disabled: true,
        action: () => {}
      })
    }

    return items
  }, [prompts, promptLoadError, handlePromptSelect])

  const openPromptList = useCallback(
    (
      inputAdapter?: QuickPanelInputAdapter,
      parentPanel?: QuickPanelOpenOptions,
      queryAnchor?: number,
      triggerInfo?: QuickPanelOpenOptions['triggerInfo']
    ) => {
      if (isDisabled) return

      quickPanelHook.open({
        title: t('settings.mcp.title'),
        list: promptList.map((item) => ({
          ...item,
          action: item.action
            ? (options) => item.action?.({ ...options, inputAdapter: options.inputAdapter ?? inputAdapter })
            : undefined
        })),
        symbol: QuickPanelReservedSymbol.McpPrompt,
        parentPanel,
        queryAnchor,
        triggerInfo,
        multiple: true
      })
    },
    [isDisabled, promptList, quickPanelHook, t]
  )

  const handleResourceSelect = useCallback(
    (resource: MCPResource, inputAdapter?: QuickPanelInputAdapter) => {
      if (isDisabled) return

      const server = activedMcpServers.find((s) => s.id === resource.serverId)
      if (!server) return

      const createResourceToken = (resourceData: ResourceData): McpComposerTokenInput => ({
        id: `mcpResource:${resource.serverId}:${resource.uri}`,
        kind: 'mcpResource',
        label: resource.name,
        description: resource.serverName,
        payload: {
          serverId: resource.serverId,
          serverName: resource.serverName,
          uri: resourceData.uri ?? resource.uri,
          name: resourceData.name ?? resource.name,
          mimeType: resourceData.mimeType ?? resource.mimeType
        }
      })

      const processResourceContent = (resourceData: ResourceData) => {
        if (resourceData.blob) {
          throw new Error(t('settings.mcp.resources.blobInvisible'))
        } else if (resourceData.text) {
          insertPromptContent(resourceData.text, createResourceToken(resourceData), inputAdapter)
        } else {
          const resourceInfo = `[${resourceData.name || resource.name} - ${resourceData.uri || resource.uri}]`
          insertPromptContent(resourceInfo, createResourceToken(resourceData), inputAdapter)
        }
      }

      requestAnimationFrame(async () => {
        try {
          const response = await window.api.mcp.getResource({
            serverId: server.id,
            uri: resource.uri
          })

          if (response?.contents && Array.isArray(response.contents)) {
            response.contents.forEach((content: ResourceData) => processResourceContent(content))
          } else {
            processResourceContent(response as ResourceData)
          }
        } catch (error: any) {
          window.modal.error({
            title: t('common.error'),
            content: error.message || t('settings.mcp.resources.genericError')
          })
        }
      })
    },
    [activedMcpServers, isDisabled, t, insertPromptContent]
  )

  const [resources, setResources] = useState<MCPResource[]>([])
  const [resourceLoadError, setResourceLoadError] = useState<string | undefined>()

  useEffect(() => {
    if (isDisabled) {
      setResources((current) => (current.length === 0 ? current : []))
      setResourceLoadError(undefined)
      return
    }

    let cancelled = false

    const fetchResources = async () => {
      const results = await Promise.allSettled(
        activedMcpServers.map((server) => window.api.mcp.listResources(server.id))
      )
      if (!cancelled) {
        const successfulResources = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
        const failedCount = results.filter((result) => result.status === 'rejected').length
        setResources(successfulResources)
        setResourceLoadError(failedCount > 0 ? t('settings.mcp.resources.genericError') : undefined)
      }
    }

    void fetchResources()

    return () => {
      cancelled = true
    }
  }, [activedMcpServers, isDisabled, t])

  const isUnsupportedResource = useCallback((resource: MCPResource) => {
    if (!resource.mimeType) return false
    if (resource.mimeType.startsWith('text/')) return false
    return !['json', 'xml', 'markdown'].some((type) => resource.mimeType?.includes(type))
  }, [])

  const resourcesList = useMemo<QuickPanelListItem[]>(() => {
    const items: QuickPanelListItem[] = resources.map((resource) => {
      const unsupported = isUnsupportedResource(resource)
      return {
        label: resource.name,
        description: unsupported ? t('settings.mcp.resources.blobInvisible') : resource.description,
        icon: hammerIcon,
        disabled: unsupported,
        action: (options) => handleResourceSelect(resource, options.inputAdapter)
      }
    })

    if (resourceLoadError) {
      items.push({
        label: resourceLoadError,
        icon: hammerIcon,
        disabled: true,
        action: () => {}
      })
    }

    return items
  }, [resources, resourceLoadError, handleResourceSelect, isUnsupportedResource, t])

  const openResourcesList = useCallback(
    async (
      inputAdapter?: QuickPanelInputAdapter,
      parentPanel?: QuickPanelOpenOptions,
      queryAnchor?: number,
      triggerInfo?: QuickPanelOpenOptions['triggerInfo']
    ) => {
      if (isDisabled) return

      quickPanelHook.open({
        title: t('settings.mcp.title'),
        list: resourcesList.map((item) => ({
          ...item,
          action: item.action
            ? (options) => item.action?.({ ...options, inputAdapter: options.inputAdapter ?? inputAdapter })
            : undefined
        })),
        symbol: QuickPanelReservedSymbol.McpResource,
        parentPanel,
        queryAnchor,
        triggerInfo,
        multiple: true
      })
    },
    [isDisabled, resourcesList, quickPanelHook, t]
  )

  useEffect(() => {
    const promptResourceLaunchers: ComposerToolLauncher[] = isDisabled
      ? []
      : [
          {
            id: 'mcp-prompts',
            kind: 'panel' as const,
            sources: ['root-panel'] as const,
            order: MCP_LAUNCHER_ORDER_BASE + 1,
            label: `MCP ${t('settings.mcp.tabs.prompts')}`,
            description: '',
            icon: hammerIcon,
            action: ({ inputAdapter, parentPanel, queryAnchor, triggerInfo }) =>
              openPromptList(inputAdapter, parentPanel, queryAnchor, triggerInfo)
          },
          {
            id: 'mcp-resources',
            kind: 'panel' as const,
            sources: ['root-panel'] as const,
            order: MCP_LAUNCHER_ORDER_BASE + 2,
            label: `MCP ${t('settings.mcp.tabs.resources')}`,
            description: '',
            icon: hammerIcon,
            action: ({ inputAdapter, parentPanel, queryAnchor, triggerInfo }) =>
              openResourcesList(inputAdapter, parentPanel, queryAnchor, triggerInfo)
          }
        ]

    const disposeLauncher = launcher.registerLaunchers([
      {
        id: 'mcp-tools',
        kind: 'group',
        sources: ['popover'],
        order: MCP_LAUNCHER_ORDER_BASE,
        label: t('settings.mcp.title'),
        description: resolvedDisabledReason ?? '',
        disabledReason: resolvedDisabledReason,
        icon: hammerIcon,
        active: !isDisabled && currentMode !== 'disabled',
        disabled: isDisabled,
        suffix: modeLabelMap[currentMode],
        submenu: modeSubmenu,
        action: cycleMcpMode
      },
      ...promptResourceLaunchers
    ])

    return () => {
      disposeLauncher()
    }
  }, [
    currentMode,
    cycleMcpMode,
    isDisabled,
    launcher,
    modeLabelMap,
    modeSubmenu,
    openPromptList,
    openResourcesList,
    resolvedDisabledReason,
    t
  ])
}

export const McpToolsRuntime: FC<Props> = (props) => {
  useMcpToolsController(props)
  return null
}
