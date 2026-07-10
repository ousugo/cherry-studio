import { describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/utils/platform', () => ({
  isMac: false,
  isWin: true
}))

import { getInitialNoteTitle } from '../noteTitle'

describe('getInitialNoteTitle on Windows', () => {
  it.each(['CON', 'CON.txt', 'LPT1', 'NUL.md'])('rejects the reserved filename %s', (title) => {
    expect(getInitialNoteTitle(`${title}\nDetails`)).toBe('')
  })

  it('accepts a title that only starts like a reserved filename', () => {
    expect(getInitialNoteTitle('CONversation notes\nDetails')).toBe('CONversa')
  })
})
