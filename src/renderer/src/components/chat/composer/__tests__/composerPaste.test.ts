import { describe, expect, it } from 'vitest'

import {
  createComposerMarkedTextPasteContent,
  createComposerPlainTextPasteContent,
  getComposerPlainTextPasteOverride
} from '../composerPaste'

const resolveSkillMarker = (marker: string) =>
  marker === 'pdf'
    ? {
        id: 'skill:pdf',
        kind: 'skill' as const,
        label: 'PDF',
        promptText: 'Use the PDF skill.'
      }
    : null

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

  it('restores slash skill markers only when a resolver is provided', () => {
    expect(createComposerMarkedTextPasteContent('/pdf/ hello', resolveSkillMarker)).toEqual([
      {
        type: 'composerToken',
        attrs: {
          id: 'skill:pdf',
          kind: 'skill',
          label: 'PDF',
          promptText: 'Use the PDF skill.'
        }
      },
      { type: 'text', text: ' hello' }
    ])
  })

  it('keeps slash skill markers as plain text without a resolver', () => {
    expect(
      getComposerPlainTextPasteOverride('/pdf/ hello', {
        pasteLongTextAsFile: false,
        pasteLongTextThreshold: 1500
      })
    ).toEqual([{ type: 'text', text: '/pdf/ hello' }])
  })

  it('does not parse skill markers with spaces inside the slashes', () => {
    expect(createComposerMarkedTextPasteContent('/pdf skill/ hello', resolveSkillMarker)).toBeNull()
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
