import { describe, expect, it } from 'vitest'

import { buildFunctionCallToolName, isFunctionCallToolNameForServer, toCamelCase } from '../mcp'

describe('isFunctionCallToolNameForServer', () => {
  it('matches a normal minted id back to its server', () => {
    const id = buildFunctionCallToolName('github', 'search_issues')
    expect(id).toBe('mcp__github__searchIssues')
    expect(isFunctionCallToolNameForServer('github', id)).toBe(true)
  })

  it('does not let a shorter server name claim a longer server id', () => {
    const id = buildFunctionCallToolName('github', 'search_issues')
    // The trailing `__` delimiter keeps `git` from prefix-matching `github`.
    expect(isFunctionCallToolNameForServer('git', id)).toBe(false)
  })

  it('does not match an unrelated server', () => {
    const id = buildFunctionCallToolName('github', 'search_issues')
    expect(isFunctionCallToolNameForServer('gitlab', id)).toBe(false)
  })

  // ── Regression: 63-char truncation drops the `__` delimiter (tools-mcp-meta-4) ──
  it('matches a minted id whose server segment is long enough to truncate the delimiter', () => {
    const serverName = 's'.repeat(56) // camelCase length 56 → `mcp__` + 56 + `__` = 63
    const id = buildFunctionCallToolName(serverName, 'doThing')

    // The minted id has the trailing delimiter stripped, so the untruncated
    // prefix the old code reconstructed is NOT a prefix of it.
    const untruncatedPrefix = `mcp__${toCamelCase(serverName)}__`
    expect(id.startsWith(untruncatedPrefix)).toBe(false)

    // The fixed matcher still recognises the id as belonging to this server.
    expect(isFunctionCallToolNameForServer(serverName, id)).toBe(true)
  })

  it('matches a minted id whose server segment is itself clipped by the cap', () => {
    const serverName = 'x'.repeat(80) // `mcp__` + 80 > 63 → server segment clipped to 58 chars
    const id = buildFunctionCallToolName(serverName, 'anything')
    expect(isFunctionCallToolNameForServer(serverName, id)).toBe(true)
  })

  it('round-trips every minted id to its own server across the truncation boundary', () => {
    const lengths = [3, 10, 54, 55, 56, 57, 58, 59, 60, 70]
    for (const len of lengths) {
      const serverName = 'a'.repeat(len)
      // Differ at the front so the distinguishing character survives the 63-char
      // cap even when the server segment is clipped (a tail difference past the
      // clip is genuinely ambiguous and cannot be recovered from the id alone).
      const sibling = `b${'a'.repeat(len - 1)}`
      const id = buildFunctionCallToolName(serverName, 'tool')
      expect(isFunctionCallToolNameForServer(serverName, id), `len=${len} owns its id`).toBe(true)
      expect(isFunctionCallToolNameForServer(sibling, id), `len=${len} sibling rejects it`).toBe(false)
    }
  })

  it('does not match a non-mcp tool id', () => {
    expect(isFunctionCallToolNameForServer('github', 'web__search')).toBe(false)
  })
})
