import type { Topic } from '@renderer/types'
import type { CherryMessagePart } from '@shared/data/types/message'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { MessageListProvider } from '../../MessageListProvider'
import {
  defaultMessageEditorConfig,
  defaultMessageRenderConfig,
  type MessageListItem,
  type MessageListProviderValue
} from '../../types'

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: ComponentProps<'button'>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Textarea: {
    Input: ({ ref, ...props }: ComponentProps<'textarea'> & { ref?: React.RefObject<HTMLTextAreaElement | null> }) => (
      <textarea ref={ref} {...props} />
    )
  },
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('@renderer/components/Buttons', () => ({
  ActionIconButton: ({ icon, ...props }: ComponentProps<'button'> & { icon: ReactNode }) => (
    <button type="button" {...props}>
      {icon}
    </button>
  )
}))

vi.mock('@renderer/utils', () => ({
  classNames: (...values: unknown[]) => values.filter(Boolean).join(' '),
  formatErrorMessageWithPrefix: (error: unknown, prefix: string) => `${prefix}: ${String(error)}`
}))

vi.mock('./../MessageAttachmentPreview', () => ({
  MessageAttachmentButton: () => <button type="button">attachment</button>,
  MessageAttachmentPreview: () => null
}))

vi.mock('lucide-react', () => ({
  Languages: () => <span>translate-icon</span>,
  Loader2: () => <span>loading-icon</span>,
  Save: () => <span>save-icon</span>,
  Send: () => <span>resend-icon</span>,
  X: () => <span>cancel-icon</span>
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

const { default: MessageEditor } = await import('../MessageEditor')

const topic = {
  id: 'topic-1',
  assistantId: 'assistant-1',
  name: 'Topic',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  messages: []
} as Topic

const textPart = (text: string): CherryMessagePart => ({ type: 'text', text }) as CherryMessagePart

function userMessage(overrides: Partial<MessageListItem>): MessageListItem {
  return {
    id: 'message-1',
    role: 'user',
    topicId: topic.id,
    parentId: 'assistant-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'success',
    ...overrides
  } as MessageListItem
}

function renderEditor({
  message,
  onSave = vi.fn(),
  onResend = vi.fn(),
  onCancel = vi.fn()
}: {
  message: MessageListItem
  onSave?: (parts: CherryMessagePart[]) => void | Promise<void>
  onResend?: (parts: CherryMessagePart[]) => void | Promise<void>
  onCancel?: () => void
}) {
  const value: MessageListProviderValue = {
    state: {
      topic,
      messages: [message],
      partsByMessageId: {
        [message.id]: [textPart('hello')]
      },
      hasOlder: false,
      messageNavigation: 'none',
      estimateSize: 0,
      overscan: 0,
      loadOlderDelayMs: 0,
      loadingResetDelayMs: 0,
      renderConfig: defaultMessageRenderConfig,
      editorConfig: defaultMessageEditorConfig,
      getMessageEditorCapabilities: (item) => ({
        canAddImageFile: false,
        canAddTextFile: true,
        canForkAndResend: item.parentId != null
      })
    },
    actions: {
      forkAndResendMessage: vi.fn(),
      editMessage: vi.fn()
    },
    meta: {
      selectionLayer: false
    }
  }

  const result = render(
    <MessageListProvider value={value}>
      <MessageEditor message={message} onSave={onSave} onResend={onResend} onCancel={onCancel} />
    </MessageListProvider>
  )

  return { ...result, onSave, onResend, onCancel }
}

describe('MessageEditor', () => {
  it('hides resend for root user messages and keeps save available', () => {
    const { onCancel, onResend } = renderEditor({ message: userMessage({ parentId: null }) })

    expect(screen.queryByText('resend-icon')).not.toBeInTheDocument()
    expect(screen.getByText('save-icon')).toBeInTheDocument()

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })

    expect(onResend).not.toHaveBeenCalled()

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })

    expect(onCancel).toHaveBeenCalled()
  })

  it('shows resend for non-root user messages', () => {
    renderEditor({ message: userMessage({ parentId: 'assistant-1' }) })

    expect(screen.getByText('resend-icon')).toBeInTheDocument()
  })

  it('saves root user edits without requiring resend', async () => {
    const { onSave, onResend } = renderEditor({ message: userMessage({ parentId: null }) })

    fireEvent.click(screen.getByText('save-icon').closest('button')!)

    await waitFor(() => expect(onSave).toHaveBeenCalledWith([textPart('hello')]))
    expect(onResend).not.toHaveBeenCalled()
  })
})
