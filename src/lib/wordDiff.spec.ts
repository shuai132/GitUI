import { describe, expect, it } from 'vitest'
import { diffChars, tokensToHtml, type DiffToken } from './wordDiff'

describe('wordDiff', () => {
  it('keeps both sides reconstructable for a version bump', () => {
    const left = 'version = "0.7.2"'
    const right = 'version = "0.8.0"'

    const { leftTokens, rightTokens } = diffChars(left, right)

    expect(textOf(leftTokens)).toBe(left)
    expect(textOf(rightTokens)).toBe(right)
    expect(leftTokens).toEqual([
      { kind: 'eq', text: 'version = "0.' },
      { kind: 'del', text: '7' },
      { kind: 'eq', text: '.' },
      { kind: 'del', text: '2' },
      { kind: 'eq', text: '"' },
    ])
    expect(rightTokens).toEqual([
      { kind: 'eq', text: 'version = "0.' },
      { kind: 'add', text: '8' },
      { kind: 'eq', text: '.' },
      { kind: 'add', text: '0' },
      { kind: 'eq', text: '"' },
    ])
  })

  it('does not synthesize characters when the first character changes', () => {
    const { leftTokens, rightTokens } = diffChars('abc', 'xbc')

    expect(textOf(leftTokens)).toBe('abc')
    expect(textOf(rightTokens)).toBe('xbc')
    expect(leftTokens).toEqual([
      { kind: 'del', text: 'a' },
      { kind: 'eq', text: 'bc' },
    ])
    expect(rightTokens).toEqual([
      { kind: 'add', text: 'x' },
      { kind: 'eq', text: 'bc' },
    ])
  })

  it('escapes token text when rendering HTML', () => {
    expect(tokensToHtml([{ kind: 'add', text: '<script>&</script>' }])).toBe(
      '<mark class="word-add">&lt;script&gt;&amp;&lt;/script&gt;</mark>',
    )
  })
})

function textOf(tokens: DiffToken[]): string {
  return tokens.map((token) => token.text).join('')
}
