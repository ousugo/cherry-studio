import type { ComposerToolLauncher } from '@renderer/components/chat/composer/toolLauncher'
import type { FileMetadata } from '@renderer/types'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import type { Model } from '@shared/data/types/model'
import React, { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from 'react'

/**
 * Read-only state interface for Composer tools.
 * Components subscribing to this state will re-render on changes.
 */
export interface ComposerToolState {
  /** Attached files */
  files: FileMetadata[]
  /** Models selected by the composer model selector for the current send */
  mentionedModels: Model[]
  /** Selected knowledge base items */
  selectedKnowledgeBases: KnowledgeBase[]
  /** Whether the composer is expanded */
  isExpanded: boolean

  /** Whether image files can be added (derived state) */
  couldAddImageFile: boolean
  /** Supported file extensions (derived state) */
  extensions: string[]
}

/**
 * Tools registry API for tool buttons.
 * Used to register composer launchers.
 */
export interface ComposerToolsRegistryAPI {
  registerLaunchers: (toolKey: string, entries: ComposerToolLauncher[]) => () => void
}

/**
 * Composer launcher API.
 */
export interface ComposerToolLaunchersAPI {
  getLaunchers: () => ComposerToolLauncher[]
  version: number
}

/**
 * Dispatch interface containing all action functions.
 * These functions have stable references and won't cause re-renders.
 */
export interface ComposerToolDispatch {
  /** State setters */
  setFiles: React.Dispatch<React.SetStateAction<FileMetadata[]>>
  setMentionedModels: React.Dispatch<React.SetStateAction<Model[]>>
  setSelectedKnowledgeBases: React.Dispatch<React.SetStateAction<KnowledgeBase[]>>
  setIsExpanded: React.Dispatch<React.SetStateAction<boolean>>

  /** Parent component actions */
  resizeTextArea: () => void
  addNewTopic: () => void

  /** Text manipulation (avoids putting text state in Context) */
  onTextChange: (updater: string | ((prev: string) => string)) => void

  /** Tools registry API (for tool buttons) */
  toolsRegistry: ComposerToolsRegistryAPI

  /** Launcher API (for Composer component) */
  triggers: ComposerToolLaunchersAPI
}

const ComposerToolStateContext = createContext<ComposerToolState | undefined>(undefined)
const ComposerToolDispatchContext = createContext<ComposerToolDispatch | undefined>(undefined)
const ComposerToolLaunchersContext = createContext<ComposerToolLaunchersAPI | undefined>(undefined)

/**
 * Get Composer tool state (read-only).
 * Components using this hook will re-render when state changes.
 */
export const useComposerToolProviderState = (): ComposerToolState => {
  const context = use(ComposerToolStateContext)
  if (!context) {
    throw new Error('useComposerToolProviderState must be used within ComposerToolProvider')
  }
  return context
}

/**
 * Get Composer tool dispatch functions (stable references).
 * Components using this hook won't re-render when state changes.
 */
export const useComposerToolProviderDispatch = (): ComposerToolDispatch => {
  const context = use(ComposerToolDispatchContext)
  if (!context) {
    throw new Error('useComposerToolProviderDispatch must be used within ComposerToolProvider')
  }
  return context
}

export const useComposerToolProviderLaunchers = (): ComposerToolLaunchersAPI => {
  const context = use(ComposerToolLaunchersContext)
  if (!context) {
    throw new Error('useComposerToolProviderLaunchers must be used within ComposerToolProvider')
  }
  return context
}

/**
 * Combined type containing both state and dispatch.
 * Used for type inference in tool buttons.
 */
export type ComposerToolContextValue = ComposerToolState & ComposerToolDispatch

/**
 * Get both state and dispatch (convenience hook).
 * Components using this hook will re-render when state changes.
 */
export const useComposerToolProvider = (): ComposerToolContextValue => {
  const state = useComposerToolProviderState()
  const dispatch = useComposerToolProviderDispatch()
  return { ...state, ...dispatch }
}

interface ComposerToolProviderProps {
  children: React.ReactNode
  initialState?: Partial<{
    files: FileMetadata[]
    mentionedModels: Model[]
    selectedKnowledgeBases: KnowledgeBase[]
    isExpanded: boolean
    couldAddImageFile: boolean
    extensions: string[]
  }>
  actions: {
    resizeTextArea: () => void
    addNewTopic: () => void
    onTextChange: (updater: string | ((prev: string) => string)) => void
  }
}

export const ComposerToolProvider: React.FC<ComposerToolProviderProps> = ({ children, initialState, actions }) => {
  // Core state
  const [files, setFiles] = useState<FileMetadata[]>(initialState?.files || [])
  const [mentionedModels, setMentionedModels] = useState<Model[]>(initialState?.mentionedModels || [])
  const [selectedKnowledgeBases, setSelectedKnowledgeBases] = useState<KnowledgeBase[]>(
    initialState?.selectedKnowledgeBases || []
  )
  const [isExpanded, setIsExpanded] = useState(initialState?.isExpanded || false)

  // Derived state (internal management)
  const [couldAddImageFile, setCouldAddImageFile] = useState(initialState?.couldAddImageFile || false)
  const [extensions, setExtensions] = useState<string[]>(initialState?.extensions || [])

  // Composer launcher registry (stored in refs to avoid re-renders)
  const launcherRegistryRef = useRef(new Map<string, ComposerToolLauncher[]>())
  const [launcherVersion, setLauncherVersion] = useState(0)
  const launcherVersionRef = useRef(launcherVersion)
  launcherVersionRef.current = launcherVersion

  const getComposerToolLaunchers = useCallback(() => {
    const allEntries: ComposerToolLauncher[] = []
    launcherRegistryRef.current.forEach((entries) => {
      allEntries.push(...entries)
    })
    return allEntries
  }, [])

  const registerLaunchers = useCallback((toolKey: string, entries: ComposerToolLauncher[]) => {
    launcherRegistryRef.current.set(toolKey, entries)
    setLauncherVersion((version) => version + 1)
    return () => {
      launcherRegistryRef.current.delete(toolKey)
      setLauncherVersion((version) => version + 1)
    }
  }, [])

  // Stabilize parent actions (prevent dispatch context updates from parent action reference changes)
  const actionsRef = useRef(actions)
  useEffect(() => {
    actionsRef.current = actions
  }, [actions])

  const stableActions = useMemo(
    () => ({
      resizeTextArea: () => actionsRef.current.resizeTextArea(),
      addNewTopic: () => actionsRef.current.addNewTopic(),
      onTextChange: (updater: string | ((prev: string) => string)) => actionsRef.current.onTextChange(updater)
    }),
    []
  )

  // State Context Value (updates when state changes)
  const stateValue = useMemo<ComposerToolState>(
    () => ({
      files,
      mentionedModels,
      selectedKnowledgeBases,
      isExpanded,
      couldAddImageFile,
      extensions
    }),
    [files, mentionedModels, selectedKnowledgeBases, isExpanded, couldAddImageFile, extensions]
  )

  // Tools Registry API (stable references for tool buttons)
  const toolsRegistryAPI = useMemo<ComposerToolsRegistryAPI>(
    () => ({
      registerLaunchers
    }),
    [registerLaunchers]
  )

  // Launcher API (stable references for Composer component)
  const triggersAPI = useMemo<ComposerToolLaunchersAPI>(
    () => ({
      getLaunchers: getComposerToolLaunchers,
      version: launcherVersion
    }),
    [getComposerToolLaunchers, launcherVersion]
  )

  const stableTriggersAPI = useMemo<ComposerToolLaunchersAPI>(
    () => ({
      getLaunchers: getComposerToolLaunchers,
      get version() {
        return launcherVersionRef.current
      }
    }),
    [getComposerToolLaunchers]
  )

  // Dispatch Context Value (stable references)
  const dispatchValue = useMemo<ComposerToolDispatch>(
    () => ({
      // State setters (React guarantees stable references)
      setFiles,
      setMentionedModels,
      setSelectedKnowledgeBases,
      setIsExpanded,

      // Stable actions
      ...stableActions,

      // API objects
      toolsRegistry: toolsRegistryAPI,
      triggers: stableTriggersAPI
    }),
    [stableActions, toolsRegistryAPI, stableTriggersAPI]
  )

  // Internal Dispatch (contains setCouldAddImageFile and setExtensions)
  // These setters are exposed to Composer but not to tool buttons
  // Using a separate internal context to avoid polluting the main dispatch context
  const internalDispatchValue = useMemo(
    () => ({
      setCouldAddImageFile,
      setExtensions
    }),
    []
  )

  return (
    <ComposerToolStateContext value={stateValue}>
      <ComposerToolDispatchContext value={dispatchValue}>
        <ComposerToolLaunchersContext value={triggersAPI}>
          <ComposerToolInternalDispatchContext value={internalDispatchValue}>
            {children}
          </ComposerToolInternalDispatchContext>
        </ComposerToolLaunchersContext>
      </ComposerToolDispatchContext>
    </ComposerToolStateContext>
  )
}

/**
 * Internal dispatch interface for Inputbar component only.
 * Used to set derived state (couldAddImageFile, extensions).
 */
interface ComposerToolProviderInternalDispatch {
  setCouldAddImageFile: React.Dispatch<React.SetStateAction<boolean>>
  setExtensions: React.Dispatch<React.SetStateAction<string[]>>
}

const ComposerToolInternalDispatchContext = createContext<ComposerToolProviderInternalDispatch | undefined>(undefined)

/**
 * Internal hook for Composer component only.
 * Used to set derived state (couldAddImageFile, extensions).
 */
export const useComposerToolProviderInternalDispatch = (): ComposerToolProviderInternalDispatch => {
  const context = use(ComposerToolInternalDispatchContext)
  if (!context) {
    throw new Error('useComposerToolProviderInternalDispatch must be used within ComposerToolProvider')
  }
  return context
}
