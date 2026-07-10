import { describe, expect, it } from 'vitest'

import { getInitialNoteTitle } from '../noteTitle'

describe('getInitialNoteTitle', () => {
  it('uses the trimmed first line', () => {
    expect(getInitialNoteTitle('  Meeting notes  \r\nDetails')).toBe('Meeting notes')
  })

  it('keeps an untitled note unchanged when its first line is blank', () => {
    expect(getInitialNoteTitle(' \nMeeting notes')).toBe('')
  })
})
