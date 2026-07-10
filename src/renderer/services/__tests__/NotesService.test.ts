import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renameNode } from '../NotesService'

describe('NotesService.renameNode', () => {
  const checkFileName = vi.fn()
  const rename = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    window.api.file.checkFileName = checkFileName
    window.api.file.rename = rename
  })

  it('rejects a filename that becomes empty after validation', async () => {
    checkFileName.mockResolvedValue({ safeName: '', exists: false })

    await expect(
      renameNode(
        {
          id: 'C:/notes/untitled.md',
          name: 'untitled',
          type: 'file',
          treePath: '/untitled',
          externalPath: 'C:/notes/untitled.md',
          createdAt: '',
          updatedAt: '',
          isStarred: false
        },
        '/'
      )
    ).rejects.toThrow('Note title must contain valid filename characters')
    expect(rename).not.toHaveBeenCalled()
  })
})
