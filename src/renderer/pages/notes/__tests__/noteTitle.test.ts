import { describe, expect, it, vi } from 'vitest'

import { getInitialNoteTitle } from '../noteTitle'

describe('getInitialNoteTitle', () => {
  it('waits until the first line has been completed', () => {
    expect(getInitialNoteTitle('Meeting notes')).toBe('')
  })

  it('uses the trimmed first line', () => {
    expect(getInitialNoteTitle('  Meeting notes  \r\nDetails')).toBe('Meeting notes')
  })

  it('works when the renderer does not expose the Node.js process global', () => {
    const originalProcess = globalThis.process
    vi.stubGlobal('process', undefined)

    try {
      expect(getInitialNoteTitle('Meeting notes\nDetails')).toBe('Meeting notes')
    } finally {
      vi.stubGlobal('process', originalProcess)
    }
  })

  it('keeps an untitled note unchanged when its first line is blank', () => {
    expect(getInitialNoteTitle(' \nMeeting notes')).toBe('')
  })

  it('keeps an untitled note unchanged when its first line has no valid filename characters', () => {
    expect(getInitialNoteTitle('/\nDetails')).toBe('')
  })

  it('removes invalid filename characters before using the first line', () => {
    expect(getInitialNoteTitle('///测试\n正文')).toBe('测试')
  })

  it.each([
    ['angle brackets', 'a<b>c\nDetails', 'abc'],
    ['quotes and separators', 'a:b"c/d\\e|f?g*h\nDetails', 'abcdefgh'],
    ['ASCII control characters', 'a\u0000b\u001fc\nDetails', 'abc'],
    ['trailing dots', 'Release notes...\nDetails', 'Release notes']
  ])('cleans %s from the completed first line', (_, content, expected) => {
    expect(getInitialNoteTitle(content)).toBe(expected)
  })

  it('keeps an untitled note unchanged when the cleaned title is too long', () => {
    expect(getInitialNoteTitle(`${'a'.repeat(256)}\nDetails`)).toBe('')
  })
})
