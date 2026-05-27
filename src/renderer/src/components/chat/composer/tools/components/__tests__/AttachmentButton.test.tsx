import type { ToolLauncherApi } from '@renderer/components/chat/composer/tools/types'
import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AttachmentToolRuntime } from '../AttachmentButton'

const mocks = vi.hoisted(() => ({
  useKnowledgeBases: vi.fn(),
  useKnowledgeItems: vi.fn(),
  useQuickPanel: vi.fn()
}))

vi.mock('@renderer/hooks/useKnowledgeBase', () => ({
  useKnowledgeBases: (...args: unknown[]) => mocks.useKnowledgeBases(...args)
}))

vi.mock('@renderer/hooks/useKnowledgeItems', () => ({
  useKnowledgeItems: (...args: unknown[]) => mocks.useKnowledgeItems(...args)
}))

vi.mock('@renderer/components/QuickPanel', () => ({
  QuickPanelReservedSymbol: {
    File: 'file'
  },
  useQuickPanel: (...args: unknown[]) => mocks.useQuickPanel(...args)
}))

vi.mock('@renderer/utils/file', () => ({
  filterSupportedFiles: vi.fn(async (files) => files),
  formatFileSize: vi.fn(() => '1 KB')
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'chat.input.upload.attachment': 'Upload attachment',
        'chat.input.upload.document_only': 'Documents only',
        'chat.input.upload.image_not_supported': 'This model does not support image uploads. Documents only.'
      }

      return translations[key] ?? key
    }
  })
}))

const createLauncherApi = (): ToolLauncherApi => ({
  registerLaunchers: vi.fn(() => vi.fn())
})

describe('AttachmentToolRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.useKnowledgeBases.mockReturnValue({ bases: [] })
    mocks.useKnowledgeItems.mockReturnValue({ items: [], isLoading: false })
    mocks.useQuickPanel.mockReturnValue({
      open: vi.fn(),
      updateList: vi.fn(),
      isVisible: false,
      symbol: '',
      multiple: false
    })
  })

  it('keeps document-only support as a suffix and tooltip instead of a long label', async () => {
    const launcher = createLauncherApi()

    render(
      <AttachmentToolRuntime
        launcher={launcher}
        couldAddImageFile={false}
        extensions={['.txt']}
        files={[]}
        setFiles={vi.fn()}
      />
    )

    await waitFor(() => expect(launcher.registerLaunchers).toHaveBeenCalled())

    const [attachmentLauncher] = vi.mocked(launcher.registerLaunchers).mock.calls[0][0]

    expect(attachmentLauncher).toMatchObject({
      id: 'attachment',
      label: 'Upload attachment',
      suffix: 'Documents only',
      tooltip: 'This model does not support image uploads. Documents only.'
    })
  })
})
