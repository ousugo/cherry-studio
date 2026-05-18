import type { QuickPanelInputAdapter } from '@renderer/components/QuickPanel'
import { describe, expect, it, vi } from 'vitest'

import { insertSlashCommand } from '../slashCommandsTool'

describe('slash command tool', () => {
  it('uses the rich composer input adapter when replacing a typed slash command', () => {
    const inputAdapter: QuickPanelInputAdapter = {
      getText: () => '/cl',
      getCursorOffset: () => 3,
      insertText: vi.fn(),
      deleteTriggerRange: vi.fn(),
      focus: vi.fn()
    }
    const onTextChange = vi.fn()

    insertSlashCommand('/clear', onTextChange, true, inputAdapter)

    expect(inputAdapter.deleteTriggerRange).toHaveBeenCalledWith({ from: 0, to: 3 })
    expect(inputAdapter.insertText).toHaveBeenCalledWith('/clear ')
    expect(inputAdapter.focus).toHaveBeenCalled()
    expect(onTextChange).not.toHaveBeenCalled()
  })

  it('inserts at the adapter cursor when opened from a button', () => {
    const inputAdapter: QuickPanelInputAdapter = {
      getText: () => 'hello',
      getCursorOffset: () => 5,
      insertText: vi.fn(),
      deleteTriggerRange: vi.fn(),
      focus: vi.fn()
    }

    insertSlashCommand('/clear', vi.fn(), false, inputAdapter)

    expect(inputAdapter.deleteTriggerRange).not.toHaveBeenCalled()
    expect(inputAdapter.insertText).toHaveBeenCalledWith('/clear ')
    expect(inputAdapter.focus).toHaveBeenCalled()
  })
})
