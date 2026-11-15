import { describe, expect, it } from 'vitest'
import { VersionTableSchema, type McVersion, type VersionTable } from '@shared/model/versions'
import {
  comparePackFormats,
  findVersion,
  latest,
  supportWindowStart,
  supportedVersions,
  versionForPackFormat,
  versionTable
} from '@shared/versions'
import rawTable from '../../resources/data/versions.json'

function v(id: string, releaseTime: string, major: number, minor = 0): McVersion {
  return {
    id,
    releaseTime,
    resourcePack: { major, minor },
    dataPack: { major: major + 10, minor: 0 },
    mcmetaStyle: major >= 65 ? 'minmax' : 'pack_format'
  }
}

/** Deliberately unsorted to check that ordering never relies on the file order. */
const table: VersionTable = {
  schemaVersion: 1,
  updatedAt: '2026-11-15',
  versions: [
    v('1.21.4', '2024-12-03T10:12:57+00:00', 46),
    v('26.3', '2026-09-15T11:23:02+00:00', 97, 1),
    v('1.21.3', '2024-10-23T12:28:15+00:00', 42),
    v('1.21.8', '2025-07-17T12:04:02+00:00', 64),
    v('1.21.7', '2025-06-30T09:32:16+00:00', 64),
    v('1.21.2', '2024-10-22T09:58:55+00:00', 42),
    v('26.2', '2026-06-16T12:03:33+00:00', 88)
  ]
}

const ids = (versions: McVersion[]): string[] => versions.map((x) => x.id)

describe('bundled version table', () => {
  it('is valid against VersionTableSchema', () => {
    expect(() => VersionTableSchema.parse(rawTable)).not.toThrow()
  })

  it('lists every release from 1.21 to 26.3, newest first', () => {
    expect(ids(versionTable.versions)).toEqual([
      '26.3',
      '26.2',
      '26.1.2',
      '26.1.1',
      '26.1',
      '1.21.11',
      '1.21.10',
      '1.21.9',
      '1.21.8',
      '1.21.7',
      '1.21.6',
      '1.21.5',
      '1.21.4',
      '1.21.3',
      '1.21.2',
      '1.21.1',
      '1.21'
    ])
    const times = versionTable.versions.map((x) => Date.parse(x.releaseTime))
    expect(times).toEqual([...times].sort((a, b) => b - a))
  })

  it.each([
    // [id, resource major, resource minor, data major, style]
    ['1.21.4', 46, 0, 61, 'pack_format'], // matches the local 1.21.4 jar's version.json
    ['1.21.5', 55, 0, 71, 'pack_format'],
    ['1.21.6', 63, 0, 80, 'pack_format'],
    ['1.21.8', 64, 0, 81, 'pack_format'],
    ['1.21.9', 69, 0, 88, 'minmax'],
    ['1.21.11', 75, 0, 94, 'minmax'],
    ['26.1.2', 84, 0, 101, 'minmax'],
    ['26.2', 88, 0, 107, 'minmax'],
    ['26.3', 97, 1, 121, 'minmax'] // matches the 26.3 client jar's version.json
  ] as const)('%s has resource %i.%i, data %i, style %s', (id, rMaj, rMin, dMaj, style) => {
    const version = findVersion(versionTable, id)
    expect(version).toBeDefined()
    expect(version?.resourcePack).toEqual({ major: rMaj, minor: rMin })
    expect(version?.dataPack.major).toBe(dMaj)
    expect(version?.mcmetaStyle).toBe(style)
  })

  it('uses minmax exactly from resource pack format 65', () => {
    for (const version of versionTable.versions) {
      expect(version.mcmetaStyle).toBe(version.resourcePack.major >= 65 ? 'minmax' : 'pack_format')
    }
  })

  it('supports 1.21.4 -> 26.3 on 2026-11-15', () => {
    const supported = supportedVersions(versionTable, new Date('2026-11-15T12:00:00Z'))
    expect(supported[0].id).toBe('26.3')
    expect(supported.at(-1)?.id).toBe('1.21.4')
    expect(supported).toHaveLength(13)
  })
})

describe('latest', () => {
  it('returns the most recent release regardless of order', () => {
    expect(latest(table).id).toBe('26.3')
  })

  it('throws on an empty table', () => {
    expect(() => latest({ ...table, versions: [] })).toThrow()
  })
})

describe('supportWindowStart', () => {
  it.each([
    ['2026-11-15T12:00:00Z', '2024-11-15T12:00:00.000Z'],
    ['2026-03-31T00:00:00Z', '2024-03-31T00:00:00.000Z'],
    ['2026-02-28T00:00:00Z', '2024-02-28T00:00:00.000Z']
  ])('%s -> %s', (now, expected) => {
    expect(supportWindowStart(new Date(now)).toISOString()).toBe(expected)
  })

  it('clamps to the end of shorter months', () => {
    expect(supportWindowStart(new Date('2026-03-31T00:00:00Z'), 1).toISOString()).toBe(
      '2026-02-28T00:00:00.000Z'
    )
    expect(supportWindowStart(new Date('2024-03-31T00:00:00Z'), 1).toISOString()).toBe(
      '2024-02-29T00:00:00.000Z'
    )
  })
})

describe('supportedVersions', () => {
  it('keeps releases from the last 24 months, newest first', () => {
    expect(ids(supportedVersions(table, new Date('2026-11-15T00:00:00Z')))).toEqual([
      '26.3',
      '26.2',
      '1.21.8',
      '1.21.7',
      '1.21.4'
    ])
  })

  it('includes a release exactly on the window boundary and drops it one millisecond later', () => {
    const boundary = new Date('2026-12-03T10:12:57Z') // 1.21.4 release time + 24 months
    expect(ids(supportedVersions(table, boundary))).toContain('1.21.4')
    const after = new Date(boundary.getTime() + 1)
    expect(ids(supportedVersions(table, after))).not.toContain('1.21.4')
  })

  it('drops versions as time passes', () => {
    expect(ids(supportedVersions(table, new Date('2027-07-10T00:00:00Z')))).toEqual([
      '26.3',
      '26.2',
      '1.21.8'
    ])
  })

  it('always keeps the latest release, even outside the window', () => {
    expect(ids(supportedVersions(table, new Date('2030-01-01T00:00:00Z')))).toEqual(['26.3'])
  })

  it('includes older releases when the window reaches back far enough', () => {
    expect(ids(supportedVersions(table, new Date('2026-10-22T09:58:55Z')))).toContain('1.21.2')
  })
})

describe('findVersion', () => {
  it('finds by exact id', () => {
    expect(findVersion(table, '1.21.4')?.resourcePack.major).toBe(46)
    expect(findVersion(table, '1.21')).toBeUndefined()
    expect(findVersion(table, '26.3 ')).toBeUndefined()
  })
})

describe('versionForPackFormat', () => {
  it('matches the major number exactly', () => {
    expect(versionForPackFormat(table, { major: 46 })?.id).toBe('1.21.4')
    expect(versionForPackFormat(table, { major: 97 })?.id).toBe('26.3')
    expect(versionForPackFormat(table, { major: 45 })).toBeUndefined()
    expect(versionForPackFormat(table, { major: 200 })).toBeUndefined()
  })

  it('picks the newest release when several share a format', () => {
    expect(versionForPackFormat(table, { major: 64 })?.id).toBe('1.21.8')
    expect(versionForPackFormat(table, { major: 42 })?.id).toBe('1.21.3')
    expect(versionForPackFormat(versionTable, { major: 84 })?.id).toBe('26.1.2')
  })

  it('ignores the minor part', () => {
    expect(versionForPackFormat(table, { major: 97, minor: 0 } as never)?.id).toBe('26.3')
  })
})

describe('comparePackFormats', () => {
  it('orders by major then minor', () => {
    expect(comparePackFormats({ major: 97, minor: 1 }, { major: 97, minor: 0 })).toBeGreaterThan(0)
    expect(comparePackFormats({ major: 88, minor: 5 }, { major: 97, minor: 0 })).toBeLessThan(0)
    expect(comparePackFormats({ major: 46, minor: 0 }, { major: 46, minor: 0 })).toBe(0)
  })
})
