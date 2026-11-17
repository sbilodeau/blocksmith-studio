import { describe, expect, it } from 'vitest'
import { launchWhatsNew } from '../../src/main/services/whats-new'

const packaged = { isPackaged: true, currentVersion: '26.47.0', ranBefore: true }

describe('launchWhatsNew', () => {
  it('reports the previous version after an update', () => {
    expect(launchWhatsNew({ ...packaged, lastRunVersion: '26.46.0' })).toEqual({
      previousVersion: '26.46.0',
      version: '26.47.0'
    })
  })

  it('shows the current notes when an older app ran without recording its version', () => {
    expect(launchWhatsNew(packaged)).toEqual({ previousVersion: null, version: '26.47.0' })
  })

  it('shows nothing on a first install, the same version, a downgrade or a development build', () => {
    expect(launchWhatsNew({ ...packaged, ranBefore: false })).toBeNull()
    expect(launchWhatsNew({ ...packaged, lastRunVersion: '26.47.0' })).toBeNull()
    expect(launchWhatsNew({ ...packaged, lastRunVersion: '26.48.0' })).toBeNull()
    expect(launchWhatsNew({ ...packaged, isPackaged: false, lastRunVersion: '26.46.0' })).toBeNull()
  })
})
