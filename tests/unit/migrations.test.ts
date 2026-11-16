import { describe, expect, it } from 'vitest'
import {
  MigrationTableSchema,
  PathMigrator,
  canMigrate,
  migrationTable,
  type MigrationTable
} from '@shared/versions/migrations'
import { versionTable } from '@shared/versions'
import { buildMigrations, gitBlobSha } from '../../scripts/gen-migrations.mjs'
import rawMigrations from '../../resources/data/migrations.json'

const T = (p: string): string => `assets/minecraft/textures/${p}.png`

const SMALL: MigrationTable = {
  schemaVersion: 1,
  description: '',
  generatedAt: '2026-11-16',
  versions: ['1', '2', '3'],
  manual: [],
  transitions: [
    {
      from: '1',
      to: '2',
      renamed: [{ older: T('block/chain'), newer: T('block/iron_chain') }],
      added: [T('block/new_in_2')],
      removed: [T('block/gone_in_2')]
    },
    {
      from: '2',
      to: '3',
      renamed: [{ older: T('block/iron_chain'), newer: T('block/chain/iron') }],
      added: [],
      removed: []
    }
  ]
}

describe('PathMigrator', () => {
  it('follows renames down and up the chain, through several steps', () => {
    expect(new PathMigrator('3', '1', SMALL).migrate(T('block/chain/iron'))).toEqual({
      path: T('block/chain'),
      renamed: true
    })
    expect(new PathMigrator('1', '3', SMALL).migrate(T('block/chain'))).toEqual({
      path: T('block/chain/iron'),
      renamed: true
    })
    expect(new PathMigrator('3', '2', SMALL).migrate(T('block/stone'))).toEqual({
      path: T('block/stone'),
      renamed: false
    })
  })

  it('reports textures missing in the target version', () => {
    expect(new PathMigrator('3', '1', SMALL).migrate(T('block/new_in_2'))).toEqual({
      missingIn: '1'
    })
    expect(new PathMigrator('1', '3', SMALL).migrate(T('block/gone_in_2'))).toEqual({
      missingIn: '2'
    })
    // Going down from 2 to 1, a texture removed in 2 is not a concern (it is not in a 2 pack).
    expect(new PathMigrator('2', '1', SMALL).migrate(T('block/gone_in_2'))).toEqual({
      path: T('block/gone_in_2'),
      renamed: false
    })
  })

  it('moves .png.mcmeta files with their texture and leaves other files alone', () => {
    const down = new PathMigrator('3', '1', SMALL)
    expect(down.migrateFile(`${T('block/chain/iron')}.mcmeta`)).toEqual({
      path: `${T('block/chain')}.mcmeta`,
      renamed: true
    })
    expect(down.migrateFile('assets/minecraft/models/block/chain.json')).toEqual({
      path: 'assets/minecraft/models/block/chain.json',
      renamed: false
    })
    expect(down.identity).toBe(false)
    expect(new PathMigrator('2', '2', SMALL).identity).toBe(true)
  })

  it('throws outside the chain', () => {
    expect(() => new PathMigrator('0', '1', SMALL)).toThrow()
    expect(canMigrate('1', '3', SMALL)).toBe(true)
    expect(canMigrate('1', '9', SMALL)).toBe(false)
  })
})

describe('bundled migration table', () => {
  it('is valid and chains every version of the support window, oldest first', () => {
    expect(() => MigrationTableSchema.parse(rawMigrations)).not.toThrow()
    expect(migrationTable.versions[0]).toBe('1.21.4')
    expect(migrationTable.transitions).toHaveLength(migrationTable.versions.length - 1)
    for (const v of migrationTable.versions)
      expect(versionTable.versions.some((x) => x.id === v)).toBe(true)
    migrationTable.transitions.forEach((t, i) => {
      expect([t.from, t.to]).toEqual([migrationTable.versions[i], migrationTable.versions[i + 1]])
    })
  })

  it.each([
    // [from, to, path in from, expected]
    ['26.3', '1.21.8', 'block/iron_chain', { path: T('block/chain'), renamed: true }],
    [
      '26.3',
      '1.21.11',
      'entity/armadillo/armadillo',
      { path: T('entity/armadillo'), renamed: true }
    ],
    [
      '26.3',
      '26.2',
      'palettes/trim/amethyst',
      { path: T('trims/color_palettes/amethyst'), renamed: true }
    ],
    ['1.21.4', '26.3', 'block/chain', { path: T('block/iron_chain'), renamed: true }],
    ['26.3', '1.21.4', 'block/stone', { path: T('block/stone'), renamed: false }],
    ['26.3', '1.21.4', 'entity/cow/temperate_cow', { missingIn: '1.21.4' }]
  ] as const)('%s -> %s: %s', (from, to, path, expected) => {
    expect(new PathMigrator(from, to).migrate(T(path))).toEqual(expected)
  })
})

describe('gen-migrations', () => {
  it('detects renames by content hash, additions and removals', () => {
    const table = buildMigrations(
      [
        {
          id: 'a',
          files: new Map([
            [T('x/old'), 'h1'],
            [T('x/same'), 'h2'],
            [T('x/gone'), 'h3'],
            [T('x/dup1'), 'h9'],
            [T('x/dup2'), 'h9']
          ])
        },
        {
          id: 'b',
          files: new Map([
            [T('x/new'), 'h1'],
            [T('x/same'), 'h2'],
            [T('x/added'), 'h4'],
            [T('x/dupnew'), 'h9']
          ])
        }
      ],
      [{ from: 'a', to: 'b', older: T('x/gone'), newer: T('x/added') }],
      '2026-11-16'
    )
    expect(table.versions).toEqual(['a', 'b'])
    expect(table.transitions[0]).toEqual({
      from: 'a',
      to: 'b',
      renamed: [
        { older: T('x/gone'), newer: T('x/added') },
        { older: T('x/old'), newer: T('x/new') }
      ],
      // Two old files with the same content: ambiguous, so no rename is guessed.
      added: [T('x/dupnew')],
      removed: [T('x/dup1'), T('x/dup2')]
    })
  })

  it('computes git blob hashes like GitHub trees', () => {
    expect(gitBlobSha(new TextEncoder().encode('hello\n'))).toBe(
      'ce013625030ba8dba906f756967f9e9ca394464a'
    )
  })
})
