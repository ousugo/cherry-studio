import { describe, expect, it } from 'vitest'

import { createComposerPlainTextPasteContent, getComposerPlainTextPasteOverride } from '../composerPaste'

describe('composer paste handling', () => {
  it('preserves LF newlines as composer hard breaks', () => {
    expect(createComposerPlainTextPasteContent('a\nb')).toEqual([
      { type: 'text', text: 'a' },
      { type: 'hardBreak' },
      { type: 'text', text: 'b' }
    ])
  })

  it('normalizes CRLF and CR newlines to composer hard breaks', () => {
    expect(createComposerPlainTextPasteContent('a\r\nb\rc')).toEqual([
      { type: 'text', text: 'a' },
      { type: 'hardBreak' },
      { type: 'text', text: 'b' },
      { type: 'hardBreak' },
      { type: 'text', text: 'c' }
    ])
  })

  it('intercepts single-line text paste as plain text content', () => {
    expect(
      getComposerPlainTextPasteOverride('single line', {
        pasteLongTextAsFile: false,
        pasteLongTextThreshold: 1500
      })
    ).toEqual([{ type: 'text', text: 'single line' }])
  })

  it('does not intercept empty text paste', () => {
    expect(
      getComposerPlainTextPasteOverride('', {
        pasteLongTextAsFile: false,
        pasteLongTextThreshold: 1500
      })
    ).toBeNull()
  })

  it('delegates long text paste to the existing long-text file handler', () => {
    expect(
      getComposerPlainTextPasteOverride('a\nlong text', {
        pasteLongTextAsFile: true,
        pasteLongTextThreshold: 5
      })
    ).toBeNull()
  })
})
