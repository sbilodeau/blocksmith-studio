import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { NMessageProvider } from 'naive-ui'
import type { GameDir, MinecraftTarget, PackMinecraftStatus } from '@shared/model/minecraft'
import type { PackSummary } from '@shared/model/pack'
import PlayInMinecraftDialog from '@renderer/components/pack/PlayInMinecraftDialog.vue'
import { usePackStore } from '@renderer/stores/pack'
import { useMinecraftStore } from '@renderer/stores/minecraft'
import { createAppI18n } from '@renderer/i18n'
import { fakeBridge } from './setup'

type InvokeFn = (channel: string, payload?: unknown) => Promise<unknown>
const invoke = vi.mocked(window.blocksmith.invoke as unknown as InvokeFn)
const baseInvoke = invoke.getMockImplementation()!

const GAME_DIR: GameDir = {
  id: 'g1',
  kind: 'official',
  path: '/Users/me/Library/Application Support/minecraft',
  worlds: [{ id: 'Survival' }]
}

let status: PackMinecraftStatus
let gameDirs: GameDir[]

function handler(channel: string, payload: unknown): unknown {
  switch (channel) {
    case 'minecraft.gameDirs':
      return gameDirs
    case 'pack.minecraft.get':
      return status
    case 'pack.minecraft.install': {
      const t = payload as MinecraftTarget
      status = { ...status, link: { ...t, parts: t.parts, live: false } }
      return {
        written: t.parts.map((part) => ({ part, name: 'Fire.zip' })),
        warnings: []
      }
    }
    case 'pack.minecraft.live': {
      const input = payload as { on: boolean }
      status = input.on
        ? {
            link: { gameDirId: 'g1', version: '26.3', parts: ['resource'], live: true },
            live: { state: 'synced', at: '2026-11-17T12:00:00.000Z', changed: 3 },
            liveNames: ['Fire [live]']
          }
        : { link: status.link, live: { state: 'off' }, liveNames: [] }
      return status
    }
    default:
      return undefined
  }
}

function summary(kind: PackSummary['kind']): PackSummary {
  return {
    id: 'fire',
    name: 'Fire',
    description: '',
    authoringVersion: '26.3',
    base: 'vanilla',
    kind,
    folder: '/ws/packs/fire',
    changedCount: 1,
    updatedAt: '2026-11-15T12:00:00.000Z'
  }
}

function mountDialog(kind: PackSummary['kind'] = 'resource'): VueWrapper {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = usePackStore('fire')
  store.summary = summary(kind)
  const Host = defineComponent({
    setup: () => () => h(NMessageProvider, () => h(PlayInMinecraftDialog, { store, show: true }))
  })
  return mount(Host, { global: { plugins: [pinia, createAppI18n()] }, attachTo: document.body })
}

const $ = (testId: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)

const calls = (channel: string): unknown[] =>
  fakeBridge.calls.filter((c) => c.channel === channel).map((c) => c.payload)

describe('PlayInMinecraftDialog', () => {
  let wrapper: VueWrapper | undefined

  beforeEach(() => {
    fakeBridge.calls = []
    gameDirs = [GAME_DIR]
    status = { link: null, live: { state: 'off' }, liveNames: [] }
    invoke.mockImplementation(async (channel: string, payload?: unknown) => {
      const value = handler(channel, payload)
      if (value === undefined) return baseInvoke(channel, payload)
      fakeBridge.calls.push({ channel, payload })
      return { ok: true, value }
    })
  })

  afterEach(() => {
    wrapper?.unmount()
    document.body.innerHTML = ''
    invoke.mockImplementation(baseInvoke)
  })

  it('preselects the Minecraft folder and the pack version, then installs', async () => {
    wrapper = mountDialog()
    await flushPromises()
    expect($('play-game-dir')!.textContent).toContain('Minecraft launcher')
    expect($('play-version')!.textContent).toContain('26.3')
    $('play-install')!.click()
    await flushPromises()
    expect(calls('pack.minecraft.install')).toEqual([
      { packId: 'fire', gameDirId: 'g1', version: '26.3', parts: ['resource'] }
    ])
    expect($('play-installed')!.textContent).toContain('Installed Fire.zip.')
    expect($('play-installed')!.textContent).toContain('Options > Resource Packs')
  })

  it('turns live mode on and off and shows the sync status', async () => {
    wrapper = mountDialog()
    await flushPromises()
    $('play-live')!.click()
    await flushPromises()
    expect(calls('pack.minecraft.live')).toEqual([
      { packId: 'fire', gameDirId: 'g1', version: '26.3', parts: ['resource'], on: true }
    ])
    expect($('play-live-status')!.textContent).toContain('3 file(s) changed')
    expect($('play-live-hint')!.textContent).toContain('"Fire [live]"')
    expect(useMinecraftStore().isLive('fire')).toBe(true)
    // The destination cannot change while live mode runs.
    expect($('play-install')!.getAttribute('disabled')).not.toBeNull()

    $('play-live')!.click()
    await flushPromises()
    expect(calls('pack.minecraft.live').at(-1)).toEqual({ packId: 'fire', on: false })
    expect(useMinecraftStore().isLive('fire')).toBe(false)
  })

  it('asks for a world when the data part is chosen, and says when no folder is found', async () => {
    wrapper = mountDialog('data')
    await flushPromises()
    // The only world is preselected.
    expect($('play-world')!.textContent).toContain('Survival')
    $('play-install')!.click()
    await flushPromises()
    expect(calls('pack.minecraft.install')).toEqual([
      { packId: 'fire', gameDirId: 'g1', version: '26.3', parts: ['data'], worldId: 'Survival' }
    ])
    wrapper.unmount()
    document.body.innerHTML = ''

    gameDirs = []
    wrapper = mountDialog()
    await flushPromises()
    expect($('play-no-game-dir')!.textContent).toContain('No Minecraft folder was found')
    expect($('play-install')!.getAttribute('disabled')).not.toBeNull()
  })
})
