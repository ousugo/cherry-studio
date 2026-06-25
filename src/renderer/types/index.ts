/**
 * Renderer shared types barrel.
 *
 * NOTE [v2 refactor — barrel dissolution in progress]:
 * This file is a pure re-export barrel. Per the renderer architecture (§5),
 * `types/` carries no root barrel — consumers should import the specific topic
 * file (`@renderer/types/<topic>`) instead of this index. All definitions now
 * live in their topic files; this index only re-exports them during the
 * migration and will be removed once consumers are repointed.
 */

// --- Topic files re-exported as whole modules ---
export * from './agent'
export * from './apiGateway'
export * from './file'
export * from './knowledge'
export * from './mcp'
export * from './note'
export * from './notification'
export * from './ocr'
export * from './plugin'
export * from './provider'
export * from './tool'
export * from './websearch'
export * from '@shared/types/skill'

// --- Cross-process types re-exported from @shared ---
export type { LanguageVarious, TranslateLangCode } from '@shared/data/preference/preferenceTypes'
export type { McpServer } from '@shared/data/types/mcpServer'
export type { TranslateLanguage } from '@shared/data/types/translate'
export type { WebSearchPhase, WebSearchStatus } from '@shared/data/types/webSearch'
export type { S3Config, WebDavConfig } from '@shared/types/backup'
export type { GenerateImageParams } from '@shared/types/image'
export type { McpPrompt, McpPromptArguments, McpResource } from '@shared/types/mcp'
export type { BuiltinMcpServer, BuiltinMcpServerName } from '@shared/utils/mcp'
export {
  BuiltinMcpServerNames,
  BuiltinMcpServerNamesArray,
  isBuiltinMcpServer,
  isBuiltinMcpServerName
} from '@shared/utils/mcp'

// --- assistant ---
export type {
  Assistant,
  AssistantMessage,
  AssistantSettings,
  LegacyAssistant,
  LegacyAssistantSettings,
  McpMode,
  QuickPhrase
} from './assistant'
export { getEffectiveMcpMode } from '@renderer/utils/mcpMode'

// --- reasoning ---
export type {
  EffortRatio,
  ReasoningEffortConfig,
  ReasoningEffortOption,
  ThinkingModelType,
  ThinkingOption,
  ThinkingOptionConfig
} from './reasoning'
export { EFFORT_RATIO } from './reasoning'

// --- message ---
export type { Citation, LegacyMessage, Metrics, Usage } from './message'
export type { Message } from './newMessage'

// --- topic ---
export type { Topic } from './topic'
export { TopicType } from './topic'

// --- model ---
export type { ApiClient, EndpointType, Model, ModelCapability, ModelPricing, ModelTag, ModelType } from './model'
export { EndPointTypeSchema } from './model'

// --- painting ---
export type { Painting, PaintingParams } from './painting'

// --- image ---
export type { EditImageParams, GenerateImageResponse } from './image'

// --- mcp tool / tool responses ---
export type {
  ExternalToolResult,
  McpConfig,
  McpToolResponse,
  McpToolResponseStatus,
  NormalToolResponse,
  ToolCallResponse,
  ToolUseResponse
} from './mcpTool'

// --- web search provider ---
export type {
  AISDKWebSearchResult,
  WebSearchProvider,
  WebSearchProviderId,
  WebSearchProviderResponse,
  WebSearchProviderResult,
  WebSearchResponse,
  WebSearchResults,
  WebSearchSource
} from './webSearchProvider'
export { WEB_SEARCH_SOURCE, WebSearchProviderIds, WebSearchSourceSchema } from './webSearchProvider'

// --- memory ---
export type { MemoryConfig, MemoryItem } from './memory'

// --- app-level misc ---
export type {
  AppInfo,
  AutoDetectionMethod,
  CodeStyleVarious,
  EditorView,
  MathEngine,
  ProcessingStatus,
  Shortcut,
  Suggestion,
  User
} from './app'
export { AutoDetectionMethods, ThemeMode } from './app'

// --- generic type/util helpers ---
export type { NotUndefined } from './utility'
export { type HexColor, isHexColor } from '@renderer/utils/color'
export { objectKeys, objectValues, strip } from '@renderer/utils/object'
