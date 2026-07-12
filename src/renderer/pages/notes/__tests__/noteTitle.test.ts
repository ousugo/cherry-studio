import { describe, expect, it, vi } from 'vitest'

import { getInitialNoteTitle } from '../noteTitle'

describe('getInitialNoteTitle', () => {
  it('waits until the first line has been completed', () => {
    expect(getInitialNoteTitle('Meeting notes')).toBe('')
  })

  it('uses an incomplete first line when finalizing on blur or note switch', () => {
    expect(getInitialNoteTitle('Meeting notes', true)).toBe('Meeting note')
  })

  it('uses the trimmed first line', () => {
    expect(getInitialNoteTitle('  Meeting notes  \r\nDetails')).toBe('Meeting note')
  })

  it('works when the renderer does not expose the Node.js process global', () => {
    const originalProcess = globalThis.process
    vi.stubGlobal('process', undefined)

    try {
      expect(getInitialNoteTitle('Meeting notes\nDetails')).toBe('Meeting note')
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

  it.each(['CON', 'CON.txt', 'LPT1', 'NUL.md'])(
    'rejects the Windows reserved filename %s on every platform',
    (title) => {
      expect(getInitialNoteTitle(`${title}\nDetails`)).toBe('')
    }
  )

  it('removes invalid filename characters before using the first line', () => {
    expect(getInitialNoteTitle('///测试\n正文')).toBe('测试')
  })

  it('uses at most the first twelve cleaned characters', () => {
    expect(getInitialNoteTitle('///一二三四五六七八九十十一十二十三\n正文')).toBe('一二三四五六七八九十十一')
  })

  it('does not split emoji sequences or combining characters when truncating', () => {
    expect(getInitialNoteTitle('👨‍👩‍👧‍👦👍🏽é😀😁😂🤣😃😄\nDetails')).toBe('👨‍👩‍👧‍👦👍🏽é😀😁😂🤣😃😄')
  })

  it.each([
    ['angle brackets', 'a<b>c\nDetails', 'abc'],
    ['quotes and separators', 'a:b"c/d\\e|f?g*h\nDetails', 'abcdefgh'],
    ['ASCII control characters', 'a\u0000b\u001fc\nDetails', 'abc'],
    ['trailing dots', 'Release notes...\nDetails', 'Release note']
  ])('cleans %s from the completed first line', (_, content, expected) => {
    expect(getInitialNoteTitle(content)).toBe(expected)
  })

  it('truncates a very long cleaned title', () => {
    expect(getInitialNoteTitle(`${'a'.repeat(256)}\nDetails`)).toBe('aaaaaaaaaaaa')
  })
})
