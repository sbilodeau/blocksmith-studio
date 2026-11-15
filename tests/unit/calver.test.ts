import { describe, expect, it } from 'vitest'
import { isoWeek, nextVersion, parseDate, parseTag } from '../../scripts/lib/calver.mjs'

const d = (value: string): Date => parseDate(value)

describe('isoWeek', () => {
  it.each([
    // [date, ISO week-year, ISO week]
    ['2026-11-15', 2026, 46], // Sunday: still week 46
    ['2026-11-16', 2026, 47], // Monday: new week
    ['2025-12-29', 2026, 1], // Monday of week 1 of 2026 is in December 2025
    ['2025-12-31', 2026, 1],
    ['2026-01-01', 2026, 1], // Thursday
    ['2026-01-04', 2026, 1], // Sunday
    ['2026-01-05', 2026, 2],
    ['2026-12-28', 2026, 53], // 2026 is a 53-week year
    ['2026-12-29', 2026, 53],
    ['2026-12-30', 2026, 53],
    ['2026-12-31', 2026, 53],
    ['2027-01-01', 2026, 53], // Friday: still ISO week-year 2026
    ['2027-01-02', 2026, 53],
    ['2027-01-03', 2026, 53],
    ['2027-01-04', 2027, 1],
    ['2027-01-18', 2027, 3],
    ['2024-12-29', 2024, 52],
    ['2024-12-30', 2025, 1],
    ['2021-01-01', 2020, 53],
    ['2021-01-04', 2021, 1],
    ['2023-01-01', 2022, 52],
    ['2023-01-02', 2023, 1],
    ['2019-12-30', 2020, 1]
  ])('%s is week %i-W%i', (date, year, week) => {
    expect(isoWeek(d(date))).toEqual({ year, week })
  })

  it('uses the UTC calendar day', () => {
    expect(isoWeek(new Date('2027-01-03T23:59:59Z'))).toEqual({ year: 2026, week: 53 })
    expect(isoWeek(new Date('2027-01-04T00:00:00Z'))).toEqual({ year: 2027, week: 1 })
  })

  it('rejects invalid dates', () => {
    expect(() => isoWeek(new Date('nope'))).toThrow(TypeError)
  })
})

describe('nextVersion', () => {
  it('starts each ISO week at .0 without leading zeros', () => {
    expect(nextVersion([], d('2026-11-15'))).toBe('26.46.0')
    expect(nextVersion([], d('2027-01-18'))).toBe('27.3.0')
  })

  it('uses the ISO week-year around new year', () => {
    expect(nextVersion([], d('2027-01-01'))).toBe('26.53.0')
    expect(nextVersion([], d('2025-12-30'))).toBe('26.1.0')
  })

  it('increments FIX for each release already tagged in the same week', () => {
    expect(nextVersion(['v26.46.0'], d('2026-11-15'))).toBe('26.46.1')
    expect(nextVersion(['v26.46.0', 'v26.46.1'], d('2026-11-12'))).toBe('26.46.2')
  })

  it('resets FIX in a new week and ignores other weeks and years', () => {
    const tags = ['v26.45.0', 'v26.45.1', 'v26.45.2', 'v25.46.0', 'v26.47.0']
    expect(nextVersion(tags, d('2026-11-15'))).toBe('26.46.0')
  })

  it('counts week-53 tags across the calendar year change', () => {
    expect(nextVersion(['v26.53.0'], d('2027-01-02'))).toBe('26.53.1')
    expect(nextVersion(['v26.53.0'], d('2027-01-04'))).toBe('27.1.0')
  })

  it('never collides with an existing tag when FIX numbers have gaps', () => {
    expect(nextVersion(['v26.46.0', 'v26.46.2'], d('2026-11-15'))).toBe('26.46.3')
  })

  it('ignores malformed tags', () => {
    const tags = [
      '',
      '26.46.0',
      'v26.46',
      'v26.046.0',
      'v026.46.0',
      'v26.46.00',
      'v26.46.0-beta.1',
      'v26.46.0+build',
      'release-26.46.0',
      'v26.46.x'
    ]
    expect(nextVersion(tags, d('2026-11-15'))).toBe('26.46.0')
  })

  it('accepts tags with surrounding whitespace or CRLF line endings', () => {
    expect(nextVersion([' v26.46.0\r', 'v26.46.1 '], d('2026-11-15'))).toBe('26.46.2')
  })
})

describe('parseTag', () => {
  it('parses strict release tags only', () => {
    expect(parseTag('v26.46.3')).toEqual({ major: 26, minor: 46, patch: 3 })
    expect(parseTag('v26.46')).toBeNull()
    expect(parseTag('v26.46.01')).toBeNull()
  })
})

describe('parseDate', () => {
  it('parses YYYY-MM-DD as a UTC date', () => {
    expect(parseDate('2026-11-15').toISOString()).toBe('2026-11-15T00:00:00.000Z')
  })

  it.each(['2026-02-30', '2026-13-01', '26-11-15', '2026/11/15', ''])('rejects %j', (value) => {
    expect(() => parseDate(value)).toThrow(RangeError)
  })
})
