import { describe, expect, it } from 'vitest'
import { stampRelease, unreleasedNotes } from '../../scripts/lib/changelog.mjs'

const CHANGELOG = [
  '# Changelog',
  '',
  'Intro text.',
  '',
  '## Unreleased',
  '',
  '### M12 - Releases',
  '',
  '- Release notes from the changelog',
  '- **What is new** dialog',
  '',
  '## 26.46.0 - 2026-11-15',
  '',
  '### M0 - Foundation',
  '',
  '- App scaffold',
  ''
].join('\n')

describe('unreleasedNotes', () => {
  it('returns the trimmed text under "## Unreleased", up to the next version', () => {
    expect(unreleasedNotes(CHANGELOG)).toBe(
      '### M12 - Releases\n\n- Release notes from the changelog\n- **What is new** dialog'
    )
  })

  it('handles CRLF files, an empty section and a section at the end of the file', () => {
    expect(unreleasedNotes(CHANGELOG.replace(/\n/g, '\r\n'))).toContain('### M12 - Releases\n\n-')
    expect(unreleasedNotes('# C\n\n## Unreleased\n\n## 1.0.0 - 2026-01-01\n\n- a\n')).toBe('')
    expect(unreleasedNotes('# C\n\n## Unreleased\n\n- only\n')).toBe('- only')
  })

  it('fails without an Unreleased heading', () => {
    expect(() => unreleasedNotes('# Changelog\n\n## 1.0.0\n')).toThrow(/Unreleased/)
  })
})

describe('stampRelease', () => {
  it('moves the notes under a dated version heading and leaves Unreleased empty', () => {
    const out = stampRelease(CHANGELOG, '26.47.0', '2026-11-17')
    expect(out).toBe(
      [
        '# Changelog',
        '',
        'Intro text.',
        '',
        '## Unreleased',
        '',
        '## 26.47.0 - 2026-11-17',
        '',
        '### M12 - Releases',
        '',
        '- Release notes from the changelog',
        '- **What is new** dialog',
        '',
        '## 26.46.0 - 2026-11-15',
        '',
        '### M0 - Foundation',
        '',
        '- App scaffold',
        ''
      ].join('\n')
    )
    expect(unreleasedNotes(out)).toBe('')
  })

  it('rejects bad input and a version that already has a section', () => {
    expect(() => stampRelease(CHANGELOG, '26.47', '2026-11-17')).toThrow(/version/)
    expect(() => stampRelease(CHANGELOG, '26.47.0', '17/11/2026')).toThrow(/date/)
    expect(() => stampRelease(CHANGELOG, '26.46.0', '2026-11-17')).toThrow(/already/)
  })
})
