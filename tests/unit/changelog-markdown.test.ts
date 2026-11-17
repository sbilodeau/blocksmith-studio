import { describe, expect, it } from 'vitest'
import { compareVersions, parseChangelog, sectionsSince } from '@shared/changelog'
import { parseInline, parseMarkdown } from '@shared/markdown'

const CHANGELOG = [
  '# Changelog',
  '',
  'Intro.',
  '',
  '## Unreleased',
  '',
  '- Next thing',
  '',
  '## 26.48.1 - 2026-11-26',
  '',
  '- Fix',
  '',
  '## 26.48.0 - 2026-11-24',
  '',
  '- Feature',
  '',
  '## 26.47.0 - 2026-11-17',
  '',
  '### M12',
  '',
  '- Releases',
  '',
  '## 26.46.0 - 2026-11-15',
  '',
  '- Foundation'
].join('\r\n')

describe('parseChangelog', () => {
  it('reads version sections with dates and Unreleased', () => {
    const sections = parseChangelog(CHANGELOG)
    expect(sections.map((s) => [s.version, s.date ?? null])).toEqual([
      [null, null],
      ['26.48.1', '2026-11-26'],
      ['26.48.0', '2026-11-24'],
      ['26.47.0', '2026-11-17'],
      ['26.46.0', '2026-11-15']
    ])
    expect(sections[3].body).toBe('### M12\n\n- Releases')
  })
})

describe('compareVersions', () => {
  it('compares numerically', () => {
    expect(compareVersions('26.47.0', '26.9.3')).toBe(1)
    expect(compareVersions('26.47.0', '26.47.0')).toBe(0)
    expect(compareVersions('26.47', '26.47.1')).toBe(-1)
  })
})

describe('sectionsSince', () => {
  const sections = parseChangelog(CHANGELOG)
  const versions = (prev: string | null, cur: string): (string | null)[] =>
    sectionsSince(sections, prev, cur).map((s) => s.version)

  it('lists every release after the previous version, newest first', () => {
    expect(versions('26.46.0', '26.48.1')).toEqual(['26.48.1', '26.48.0', '26.47.0'])
    expect(versions('26.48.0', '26.48.1')).toEqual(['26.48.1'])
    expect(versions('26.46.0', '26.48.0')).toEqual(['26.48.0', '26.47.0'])
  })

  it('shows only the current version without a previous one, nothing when nothing is newer', () => {
    expect(versions(null, '26.47.0')).toEqual(['26.47.0'])
    expect(versions('26.48.1', '26.48.1')).toEqual([])
  })

  it('falls back to the Unreleased notes in a development build', () => {
    expect(versions(null, '0.0.0-dev')).toEqual([null])
    expect(versions(null, '26.47.0')).not.toContain(null)
  })
})

describe('parseMarkdown', () => {
  it('reads headings, paragraphs and bullet lists with continuation lines', () => {
    const blocks = parseMarkdown(
      '### M12 - Releases\n\nSome text\nwrapped.\n\n- First item\n  continues here\n- Second\n\n#### Sub'
    )
    expect(blocks).toEqual([
      { kind: 'heading', level: 3, children: [{ kind: 'text', text: 'M12 - Releases' }] },
      { kind: 'paragraph', children: [{ kind: 'text', text: 'Some text wrapped.' }] },
      {
        kind: 'list',
        items: [
          [{ kind: 'text', text: 'First item continues here' }],
          [{ kind: 'text', text: 'Second' }]
        ]
      },
      { kind: 'heading', level: 4, children: [{ kind: 'text', text: 'Sub' }] }
    ])
  })

  it('reads bold, italic, code and links, and leaves stray markers and HTML as text', () => {
    expect(parseInline('a **b** *c* `d` [e](https://x.org/y) 2 * 3 <b>x</b>')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'strong', children: [{ kind: 'text', text: 'b' }] },
      { kind: 'text', text: ' ' },
      { kind: 'em', children: [{ kind: 'text', text: 'c' }] },
      { kind: 'text', text: ' ' },
      { kind: 'code', text: 'd' },
      { kind: 'text', text: ' ' },
      { kind: 'link', href: 'https://x.org/y', children: [{ kind: 'text', text: 'e' }] },
      { kind: 'text', text: ' 2 * 3 <b>x</b>' }
    ])
  })
})
