import { describe, expect, it } from 'vitest'

import { getInitialNoteTitle } from '../noteTitle'

describe('getInitialNoteTitle', () => {
  it('waits until the first line has been completed', () => {
    expect(getInitialNoteTitle('Meeting notes')).toBe('')
  })

  it('uses the trimmed first line', () => {
    expect(getInitialNoteTitle('  Meeting notes  \r\nDetails')).toBe('Meeting notes')
  })

  it('keeps an untitled note unchanged when its first line is blank', () => {
    expect(getInitialNoteTitle(' \nMeeting notes')).toBe('')
  })

  it('keeps an untitled note unchanged when its first line has no valid filename characters', () => {
    expect(getInitialNoteTitle('/\nDetails')).toBe('')
  })
})
