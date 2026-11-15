import { describe, expect, it } from 'vitest'
import { parseJarVersionJson } from '../../src/main/services/vanilla/version-json'

describe('parseJarVersionJson', () => {
  it('reads the pre-1.21.9 shape (real 1.21.4 jar)', () => {
    expect(
      parseJarVersionJson({
        id: '1.21.4',
        name: '1.21.4',
        pack_version: { resource: 46, data: 61 }
      })
    ).toEqual({
      id: '1.21.4',
      resourcePack: { major: 46, minor: 0 },
      dataPack: { major: 61, minor: 0 }
    })
  })

  it('reads the 1.21.9+ shape (real 26.3 jar)', () => {
    expect(
      parseJarVersionJson({
        id: '26.3',
        pack_version: { resource_major: 97, resource_minor: 1, data_major: 121, data_minor: 0 }
      })
    ).toEqual({
      id: '26.3',
      resourcePack: { major: 97, minor: 1 },
      dataPack: { major: 121, minor: 0 }
    })
  })

  it('defaults missing minors to 0', () => {
    expect(
      parseJarVersionJson({ id: 'x', pack_version: { resource_major: 70, data_major: 90 } })
    ).toMatchObject({ resourcePack: { major: 70, minor: 0 }, dataPack: { major: 90, minor: 0 } })
  })

  it.each([
    null,
    'text',
    {},
    { id: '1.21.4' },
    { id: '1.21.4', pack_version: 46 },
    { id: '1.21.4', pack_version: { resource: '46', data: 61 } },
    { id: '1.21.4', pack_version: { resource: -1, data: 61 } },
    { pack_version: { resource: 46, data: 61 } }
  ])('rejects %j', (value) => {
    expect(parseJarVersionJson(value)).toBeNull()
  })
})
