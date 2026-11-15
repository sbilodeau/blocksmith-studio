import { describe, expect, it } from 'vitest'
import { buildVersionTable, packVersionFromVersionJson } from '../../scripts/update-versions.mjs'
import { VersionTableSchema } from '@shared/model/versions'

const manifest = {
  latest: { release: '26.3', snapshot: '26.4-snapshot-8' },
  versions: [
    { id: '26.4-snapshot-8', type: 'snapshot', releaseTime: '2026-11-10T14:20:05+00:00' },
    { id: '26.3', type: 'release', releaseTime: '2026-09-15T11:23:02+00:00' },
    { id: '1.21.9', type: 'release', releaseTime: '2025-09-30T11:58:43+00:00' },
    { id: '1.21.8', type: 'release', releaseTime: '2025-07-17T12:04:02+00:00' },
    { id: '1.21', type: 'release', releaseTime: '2024-06-13T08:24:03+00:00' },
    { id: '1.20.6', type: 'release', releaseTime: '2024-04-29T12:00:00+00:00' }
  ]
}

const summary = [
  { id: '26.3', resource_pack_version: 97, resource_pack_version_minor: 1, data_pack_version: 121 },
  { id: '1.21.9', resource_pack_version: 69, data_pack_version: 88, data_pack_version_minor: 0 },
  { id: '1.21.8', resource_pack_version: 64, data_pack_version: 81 },
  { id: '1.21', resource_pack_version: 34, data_pack_version: 48 }
]

describe('buildVersionTable', () => {
  it('keeps releases from 1.21 on, newest first, with formats and mcmeta style', () => {
    const table = buildVersionTable(manifest, summary, '2026-11-15')
    expect(() => VersionTableSchema.parse(table)).not.toThrow()
    expect(table.updatedAt).toBe('2026-11-15')
    expect(table.versions.map((v: { id: string }) => v.id)).toEqual([
      '26.3',
      '1.21.9',
      '1.21.8',
      '1.21'
    ])
    expect(table.versions[0]).toEqual({
      id: '26.3',
      releaseTime: '2026-09-15T11:23:02+00:00',
      resourcePack: { major: 97, minor: 1 },
      dataPack: { major: 121, minor: 0 },
      mcmetaStyle: 'minmax'
    })
    expect(table.versions[1].mcmetaStyle).toBe('minmax')
    expect(table.versions[2].mcmetaStyle).toBe('pack_format')
  })

  it('fails when a release has no pack formats', () => {
    expect(() => buildVersionTable(manifest, summary.slice(1), '2026-11-15')).toThrow(/26\.3/)
  })
})

describe('packVersionFromVersionJson', () => {
  it('reads the pre-1.21.9 shape { resource, data }', () => {
    expect(packVersionFromVersionJson({ pack_version: { resource: 46, data: 61 } })).toEqual({
      resourcePack: { major: 46, minor: 0 },
      dataPack: { major: 61, minor: 0 }
    })
  })

  it('reads the 1.21.9+ shape { resource_major, resource_minor, data_major, data_minor }', () => {
    expect(
      packVersionFromVersionJson({
        pack_version: { resource_major: 97, resource_minor: 1, data_major: 121, data_minor: 0 }
      })
    ).toEqual({ resourcePack: { major: 97, minor: 1 }, dataPack: { major: 121, minor: 0 } })
  })

  it('rejects anything else', () => {
    expect(() => packVersionFromVersionJson({})).toThrow()
  })
})
