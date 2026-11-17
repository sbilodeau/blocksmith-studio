import { describe, expect, it, vi } from 'vitest'
import {
  createPopoutManager,
  type PopoutContents,
  type PopoutWindow
} from '../../src/main/services/preview/popout'
import { PopoutInputSchema, PopoutStateSchema } from '../../src/shared/model/popout'

function contents(
  id: number
): PopoutContents & { sent: Array<[string, unknown]>; destroyed: boolean } {
  const c = {
    id,
    sent: [] as Array<[string, unknown]>,
    destroyed: false,
    isDestroyed: () => c.destroyed,
    send: (channel: string, payload: unknown) => void c.sent.push([channel, payload])
  }
  return c
}

function fakeWindow(id: number): PopoutWindow & {
  contents: ReturnType<typeof contents>
  titles: string[]
  focused: number
  fireClosed(): void
} {
  const listeners: Array<() => void> = []
  let destroyed = false
  const win = {
    contents: contents(id),
    titles: [] as string[],
    focused: 0,
    get webContents() {
      return win.contents
    },
    isDestroyed: () => destroyed,
    focus: () => void win.focused++,
    close: () => win.fireClosed(),
    setTitle: (t: string) => void win.titles.push(t),
    onClosed: (l: () => void) => void listeners.push(l),
    fireClosed: () => {
      destroyed = true
      win.contents.destroyed = true
      for (const l of listeners) l()
    }
  }
  return win
}

const STATE = {
  path: 'assets/minecraft/textures/block/stone.png',
  mcmeta: null,
  editingFrame: null,
  hover: null
}

describe('pop-out manager', () => {
  it('opens one window per pack, focuses it again and relays only between the two windows', () => {
    const windows: Array<ReturnType<typeof fakeWindow>> = []
    const createWindow = vi.fn((): PopoutWindow => {
      const w = fakeWindow(100 + windows.length)
      windows.push(w)
      return w
    })
    const manager = createPopoutManager({ createWindow })
    const owner = contents(1)
    const stranger = contents(2)

    manager.open('p', 'Fire - 3D', owner)
    manager.open('p', 'Fire 2 - 3D', owner)
    expect(createWindow).toHaveBeenCalledTimes(1)
    expect(windows[0]!.titles).toEqual(['Fire 2 - 3D'])
    expect(windows[0]!.focused).toBe(1)

    expect(manager.push('p', STATE, owner)).toBe(true)
    expect(windows[0]!.contents.sent).toEqual([
      ['preview.popout.state', { packId: 'p', state: STATE }]
    ])
    expect(manager.push('p', STATE, stranger)).toBe(false)
    expect(manager.push('other', STATE, owner)).toBe(false)

    const input = { kind: 'paintStart' as const, x: 1, y: 2, secondary: false }
    expect(manager.input('p', input, windows[0]!.contents)).toBe(true)
    expect(owner.sent).toEqual([['preview.popout.input', { packId: 'p', input }]])
    expect(manager.input('p', input, stranger)).toBe(false)

    manager.close('p', stranger)
    expect(windows[0]!.isDestroyed()).toBe(false)
    manager.close('p', owner)
    expect(owner.sent.at(-1)).toEqual(['preview.popout.closed', { packId: 'p' }])
    expect(manager.push('p', STATE, owner)).toBe(false)

    // A new pop-out opens after the old one closed; closeAll closes them all.
    manager.open('p', 'Fire - 3D', owner)
    manager.open('q', 'Ice - 3D', owner)
    expect(createWindow).toHaveBeenCalledTimes(3)
    manager.closeAll()
    expect(windows.every((w) => w.isDestroyed())).toBe(true)
  })

  it('validates states and inputs', () => {
    const rgba = new Uint8Array(2 * 1 * 4)
    expect(
      PopoutStateSchema.safeParse({ ...STATE, image: { width: 2, height: 1, rgba } }).success
    ).toBe(true)
    expect(
      PopoutStateSchema.safeParse({ ...STATE, image: { width: 2, height: 2, rgba } }).success
    ).toBe(false)
    expect(
      PopoutInputSchema.safeParse({ kind: 'paintMove', x: 3, y: 4, connect: true }).success
    ).toBe(true)
    expect(
      PopoutInputSchema.safeParse({ kind: 'paintMove', x: -1, y: 4, connect: true }).success
    ).toBe(false)
    expect(PopoutInputSchema.safeParse({ kind: 'eval', code: 'x' }).success).toBe(false)
  })
})
