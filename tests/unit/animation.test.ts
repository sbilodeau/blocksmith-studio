import { describe, expect, it } from 'vitest'
import { createImage, getPixel, setPixel } from '@shared/image'
import {
  animationFromDelays,
  blendFrames,
  defaultAnimation,
  frameSize,
  frameTicks,
  insertFrame,
  joinFrames,
  moveFrame,
  parseMcmeta,
  playbackAt,
  playbackSequence,
  removeFrame,
  serializeMcmeta,
  setFrameTime,
  splitFrames,
  stripFrameHeight,
  type AnimationMeta
} from '@shared/animation'

const anim = (over: Partial<AnimationMeta> = {}): AnimationMeta => ({
  ...defaultAnimation(),
  ...over
})

describe('parseMcmeta / serializeMcmeta', () => {
  it('reads every animation field and keeps unknown keys', () => {
    const doc = parseMcmeta(
      JSON.stringify({
        animation: {
          frametime: 2,
          interpolate: true,
          frames: [0, { index: 2, time: 4 }, 'bad', -1],
          height: 16,
          custom: 'kept'
        },
        texture: { blur: true }
      })
    )!
    expect(doc.rest).toEqual({ texture: { blur: true } })
    expect(doc.animation).toEqual({
      frametime: 2,
      interpolate: true,
      frames: [{ index: 0 }, { index: 2, time: 4 }],
      height: 16,
      extra: { custom: 'kept' }
    })
    expect(JSON.parse(serializeMcmeta(doc)!)).toEqual({
      texture: { blur: true },
      animation: {
        frametime: 2,
        interpolate: true,
        frames: [0, { index: 2, time: 4 }],
        height: 16,
        custom: 'kept'
      }
    })
  })

  it('handles missing, invalid and non-animated files', () => {
    expect(parseMcmeta(null)).toBeNull()
    expect(parseMcmeta('not json')).toBeNull()
    expect(parseMcmeta('[1]')).toBeNull()
    expect(parseMcmeta('﻿{"animation":{}}')!.animation).toEqual(defaultAnimation())
    expect(parseMcmeta('{"texture":{"blur":true}}')).toEqual({
      animation: null,
      rest: { texture: { blur: true } }
    })
    expect(serializeMcmeta({ animation: null, rest: {} })).toBeNull()
    expect(serializeMcmeta({ animation: defaultAnimation(), rest: {} })).toBe(
      '{\n  "animation": {}\n}\n'
    )
  })

  it('drops a default frame order, and adds "height" for non-square frames', () => {
    const plain = anim({ frames: [{ index: 0 }, { index: 1 }, { index: 2, time: 1 }] })
    expect(
      JSON.parse(
        serializeMcmeta({ animation: plain, rest: {} }, { width: 16, height: 16, count: 3 })!
      )
    ).toEqual({ animation: {} })
    expect(
      JSON.parse(
        serializeMcmeta({ animation: anim(), rest: {} }, { width: 16, height: 8, count: 4 })!
      )
    ).toEqual({ animation: { height: 8 } })
    // Only "width" in the file would make one frame of the whole strip: "height" is added.
    expect(
      JSON.parse(
        serializeMcmeta(
          { animation: anim({ width: 16 }), rest: {} },
          { width: 16, height: 16, count: 2 }
        )!
      )
    ).toEqual({ animation: { width: 16, height: 16 } })
  })
})

describe('frame size', () => {
  it('follows Minecraft defaults', () => {
    expect(frameSize(anim(), { width: 16, height: 64 })).toEqual({
      width: 16,
      height: 16,
      count: 4
    })
    expect(frameSize(anim({ height: 8 }), { width: 16, height: 32 })).toEqual({
      width: 16,
      height: 8,
      count: 4
    })
    expect(frameSize(anim({ width: 8 }), { width: 32, height: 16 })).toEqual({
      width: 8,
      height: 16,
      count: 4
    })
    expect(frameSize(anim({ height: 64 }), { width: 16, height: 32 })).toBeNull()
  })

  it('only vertical strips of full-width frames are edited frame by frame', () => {
    expect(stripFrameHeight(anim(), { width: 16, height: 48 })).toBe(16)
    expect(stripFrameHeight(anim({ width: 8, height: 8 }), { width: 16, height: 16 })).toBeNull()
    expect(stripFrameHeight(anim({ height: 10 }), { width: 16, height: 25 })).toBeNull()
    expect(stripFrameHeight(null, { width: 16, height: 16 })).toBeNull()
  })
})

describe('frames', () => {
  it('splits and joins a strip', () => {
    const strip = createImage(2, 6)
    setPixel(strip, 1, 4, [255, 0, 0, 255])
    const frames = splitFrames(strip, 2)
    expect(frames).toHaveLength(3)
    expect(getPixel(frames[2]!, 1, 0)).toEqual([255, 0, 0, 255])
    expect(joinFrames(frames)).toEqual(strip)
  })
})

describe('structural edits keep the playback order on the same images', () => {
  const custom = anim({
    frames: [{ index: 0 }, { index: 1, time: 3 }, { index: 2 }, { index: 1, time: 3 }]
  })

  it('insert / duplicate', () => {
    expect(insertFrame(anim(), 1).frames).toBeNull()
    expect(insertFrame(custom, 3).frames).toEqual([
      { index: 0 },
      { index: 1, time: 3 },
      { index: 2 },
      { index: 3 },
      { index: 1, time: 3 }
    ])
    // Duplicate of frame 1 inserted at 2: it follows each playback of frame 1, with its duration.
    expect(insertFrame(custom, 2, 1).frames).toEqual([
      { index: 0 },
      { index: 1, time: 3 },
      { index: 2, time: 3 },
      { index: 3 },
      { index: 1, time: 3 },
      { index: 2, time: 3 }
    ])
    expect(insertFrame(anim({ frames: [{ index: 0 }] }), 0).frames).toEqual([
      { index: 0 },
      { index: 1 }
    ])
  })

  it('remove', () => {
    expect(removeFrame(custom, 1).frames).toEqual([{ index: 0 }, { index: 1 }])
    expect(removeFrame(anim({ frames: [{ index: 0 }] }), 0).frames).toBeNull()
  })

  it('move: a plain order follows the strip, a custom order keeps its images', () => {
    const timed = anim({ frames: [{ index: 0, time: 5 }, { index: 1 }, { index: 2 }] })
    expect(moveFrame(timed, 0, 2, 3).frames).toEqual([
      { index: 0 },
      { index: 1 },
      { index: 2, time: 5 }
    ])
    expect(moveFrame(custom, 0, 2, 3).frames).toEqual([
      { index: 2 },
      { index: 0, time: 3 },
      { index: 1 },
      { index: 0, time: 3 }
    ])
  })

  it('per-frame duration', () => {
    const a = setFrameTime(anim({ frametime: 2 }), 1, 6, 3)
    expect(a.frames).toEqual([{ index: 0 }, { index: 1, time: 6 }, { index: 2 }])
    expect(frameTicks(a, 1)).toBe(6)
    expect(frameTicks(a, 0)).toBe(2)
    expect(setFrameTime(a, 1, null, 3).frames).toBeNull()
    expect(setFrameTime(a, 1, 2, 3).frames).toBeNull()
  })

  it('GIF delays: the most common delay becomes frametime', () => {
    expect(animationFromDelays([100, 100, 300, 100])).toMatchObject({
      frametime: 2,
      frames: [{ index: 0 }, { index: 1 }, { index: 2, time: 6 }, { index: 3 }]
    })
    expect(animationFromDelays([50, 50]).frames).toBeNull()
    expect(animationFromDelays([0, 10]).frametime).toBe(2)
  })
})

describe('playback', () => {
  it('follows the sequence and loops', () => {
    const seq = playbackSequence(
      anim({ frametime: 2, frames: [{ index: 1 }, { index: 0, time: 1 }] }),
      2
    )
    expect(seq).toEqual([
      [1, 100],
      [0, 50]
    ])
    expect(playbackAt(seq, 0)).toEqual({ index: 1, next: 0, t: 0 })
    expect(playbackAt(seq, 125)).toEqual({ index: 0, next: 1, t: 0.5 })
    expect(playbackAt(seq, 150).index).toBe(1)
    expect(playbackSequence(anim(), 3)).toEqual([
      [0, 50],
      [1, 50],
      [2, 50]
    ])
  })

  it('blends frames for interpolation', () => {
    const a = createImage(1, 1, [0, 0, 0, 255])
    const b = createImage(1, 1, [200, 100, 0, 255])
    expect(getPixel(blendFrames(a, b, 0.5), 0, 0)).toEqual([100, 50, 0, 255])
  })
})
