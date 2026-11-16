import { describe, expect, it, vi } from 'vitest'
import { createImage, decodePng, encodePng, getPixel, setPixel, toHex } from '@shared/image'
import {
  applyOperations,
  bulkTools,
  describeOperation,
  frameHeightOf,
  isBulkTool,
  parseOperation
} from '@shared/bulk/operations'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const { computeBulk, computeBulkItem } = await import('../../src/main/services/bulk/compute')
const { createWorkerBulkRunner, inProcessBulkRunner } =
  await import('../../src/main/services/bulk/runner')

/** 2 frames of 2x2 stacked vertically: frame 0 red at (0,0), frame 1 green at (0,0). */
function strip(): ReturnType<typeof createImage> {
  const img = createImage(2, 4, [0, 0, 0, 255])
  setPixel(img, 0, 0, [255, 0, 0, 255])
  setPixel(img, 0, 2, [0, 255, 0, 255])
  return img
}

describe('bulk operations', () => {
  it('allows the color operations and transforms of the navigation scope only', () => {
    const names = bulkTools().map((t) => t.name)
    expect(names).toEqual(
      expect.arrayContaining(['hue_shift', 'brightness', 'replace_color', 'rotate', 'flip'])
    )
    expect(names).not.toContain('set_pixels')
    expect(names).not.toContain('get_palette')
    expect(isBulkTool('fill')).toBe(false)
  })

  it('validates operations with the tool schema', () => {
    expect(parseOperation({ tool: 'set_pixels', args: {} })).toMatch(/cannot be applied in bulk/)
    expect(parseOperation({ tool: 'hue_shift', args: { degrees: 999 } })).toMatch(
      /Invalid arguments for hue_shift: degrees/
    )
    const ok = parseOperation({ tool: 'flip', args: { axis: 'horizontal' } })
    expect(typeof ok).not.toBe('string')
    expect(describeOperation({ tool: 'flip', args: { axis: 'vertical' } })).toEqual({
      key: 'ops.flip',
      params: { axis: 'vertical' }
    })
    expect(describeOperation({ tool: 'nope', args: {} })).toEqual({
      key: 'ops.unknown',
      params: { tool: 'nope' }
    })
  })

  it('applies operations in order and counts changed pixels', () => {
    const img = createImage(2, 1, [100, 100, 100, 255])
    const out = applyOperations(img, [
      { tool: 'replace_color', args: { from: '#646464', to: '#ff0000' } },
      { tool: 'flip', args: { axis: 'horizontal' } }
    ])
    expect(toHex(getPixel(out.image, 0, 0))).toBe('#ff0000ff')
    expect(out.changedPixels).toBe(2)
    expect(
      applyOperations(img, [{ tool: 'flip', args: { axis: 'horizontal' } }]).changedPixels
    ).toBe(0)
    expect(() => applyOperations(img, [{ tool: 'fill', args: {} }])).toThrow(/cannot be applied/)
  })

  it('runs each animation frame separately', () => {
    // A vertical flip of the whole strip would swap the frames; per frame, each frame flips in place.
    const out = applyOperations(strip(), [{ tool: 'flip', args: { axis: 'vertical' } }], {
      frameHeight: 2
    }).image
    expect(toHex(getPixel(out, 0, 1))).toBe('#ff0000ff')
    expect(toHex(getPixel(out, 0, 3))).toBe('#00ff00ff')
    const whole = applyOperations(strip(), [{ tool: 'flip', args: { axis: 'vertical' } }]).image
    expect(toHex(getPixel(whole, 0, 1))).toBe('#00ff00ff')
  })

  it('frame height of a texture entry', () => {
    expect(frameHeightOf({ height: 64, animated: true, frameCount: 4 })).toBe(16)
    expect(frameHeightOf({ height: 16, animated: false })).toBeUndefined()
    expect(frameHeightOf({ height: 10, animated: true, frameCount: 3 })).toBeUndefined()
  })
})

describe('bulk compute', () => {
  const png = encodePng(createImage(2, 2, [100, 100, 100, 255]))
  const op = [{ tool: 'brightness', args: { delta: 0.5 } }]

  it('returns the new PNG, nothing for unchanged textures, and errors per texture', () => {
    const changed = computeBulkItem({ path: 'a', png, ops: op })
    expect(changed.changedPixels).toBe(4)
    expect(decodePng(changed.png!).width).toBe(2)
    expect(
      computeBulkItem({ path: 'b', png, ops: [{ tool: 'brightness', args: { delta: 0 } }] })
    ).toEqual({ path: 'b', changedPixels: 0 })
    expect(
      computeBulkItem({ path: 'c', png: new Uint8Array([1, 2, 3]), ops: op }).error
    ).toBeTruthy()
  })

  it('reports progress and stops on abort', async () => {
    const progress: number[] = []
    const items = Array.from({ length: 3 }, (_, i) => ({ path: `p${i}`, png, ops: op }))
    const out = await computeBulk({ items }, (done) => progress.push(done))
    expect(out).toHaveLength(3)
    expect(progress).toEqual([1, 2, 3])
    const ac = new AbortController()
    ac.abort()
    await expect(inProcessBulkRunner({ items }, undefined, ac.signal)).rejects.toMatchObject({
      code: 'bulk.aborted'
    })
  })

  it('worker runner: forwards progress, resolves results, maps failures and aborts', async () => {
    type Listener = (arg: unknown) => void
    function fakeWorker(script: (emit: (event: string, arg: unknown) => void) => void): never {
      const listeners = new Map<string, Listener>()
      const worker = {
        on: (event: string, l: Listener) => listeners.set(event, l),
        terminate: vi.fn(async () => 0)
      }
      setTimeout(() => script((e, a) => listeners.get(e)?.(a)), 0)
      return worker as never
    }
    const progress: number[] = []
    const ok = createWorkerBulkRunner('w.js', () =>
      fakeWorker((emit) => {
        emit('message', { type: 'progress', done: 1, total: 1 })
        emit('message', { type: 'done', results: [{ path: 'a', changedPixels: 0 }] })
      })
    )
    expect(await ok({ items: [] }, (d) => progress.push(d))).toEqual([
      { path: 'a', changedPixels: 0 }
    ])
    expect(progress).toEqual([1])

    const bad = createWorkerBulkRunner('w.js', () =>
      fakeWorker((emit) => emit('message', { type: 'error', message: 'boom' }))
    )
    await expect(bad({ items: [] })).rejects.toMatchObject({
      code: 'bulk.failed',
      params: { reason: 'boom' }
    })

    let w: { terminate: ReturnType<typeof vi.fn> } | undefined
    const slow = createWorkerBulkRunner('w.js', () => {
      w = fakeWorker(() => undefined) as never
      return w as never
    })
    const ac = new AbortController()
    const pending = slow({ items: [] }, undefined, ac.signal)
    ac.abort()
    await expect(pending).rejects.toMatchObject({ code: 'bulk.aborted' })
    expect(w!.terminate).toHaveBeenCalled()
  })
})
