import { describe, expect, it } from 'vitest'
import phrases from '../../resources/data/ai-eval/phrases.json'
import {
  EvalFileSchema,
  callMatches,
  colorIs,
  matchCalls
} from '../../src/main/services/ai/eval/match'

describe('FR/EN evaluation cases', () => {
  it('phrases.json is valid, has unique ids and about 60 phrases', () => {
    const file = EvalFileSchema.parse(phrases)
    const ids = file.cases.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(file.cases.length * 2).toBeGreaterThanOrEqual(60)
  })
})

describe('tool-call matcher', () => {
  const rotate = { id: '1', name: 'rotate', args: { degrees: 90, direction: 'counterclockwise' } }

  it('matches tool names and exact args', () => {
    expect(
      callMatches(rotate, { tool: 'rotate', args: { degrees: 90, direction: 'counterclockwise' } })
    ).toBe(true)
    expect(callMatches(rotate, { tool: 'rotate', args: { direction: 'clockwise' } })).toBe(false)
    expect(callMatches(rotate, { anyTool: ['flip', 'rotate'] })).toBe(true)
  })

  it('supports anyOf alternatives (270 clockwise == 90 counterclockwise)', () => {
    const m = {
      anyOf: [
        { tool: 'rotate', args: { degrees: 270, direction: 'clockwise' } },
        { tool: 'rotate', args: { degrees: 90, direction: 'counterclockwise' } }
      ]
    }
    expect(callMatches(rotate, m)).toBe(true)
  })

  it('checks dot paths, numeric ranges, colors and contains', () => {
    const px = { id: '2', name: 'set_pixels', args: { pixels: [{ x: 0, y: 0, color: '#e11d1d' }] } }
    expect(
      callMatches(px, {
        tool: 'set_pixels',
        args: { 'pixels.0.x': 0, 'pixels.0.color': { color: 'red' } }
      })
    ).toBe(true)
    const b = { id: '3', name: 'brightness', args: { delta: -0.3 } }
    expect(callMatches(b, { tool: 'brightness', args: { delta: { lt: 0 } } })).toBe(true)
    expect(callMatches(b, { tool: 'brightness', args: { delta: { gt: 0 } } })).toBe(false)
    const pal = {
      id: '4',
      name: 'apply_palette',
      args: { palette: ['#000000', '#FFFFFF', '#ff0000'] }
    }
    expect(
      callMatches(pal, {
        tool: 'apply_palette',
        args: { palette: { containsAll: ['#000000', '#ffffff', '#ff0000'] } }
      })
    ).toBe(true)
    const brief = {
      id: '5',
      name: 'update_style_brief',
      args: { patch: { theme: 'Fire and lava' } }
    }
    expect(
      callMatches(brief, {
        tool: 'update_style_brief',
        args: { 'patch.theme': { containsAny: ['feu', 'fire'] } }
      })
    ).toBe(true)
  })

  it('names colors loosely', () => {
    expect(colorIs('#ff0000', 'red')).toBe(true)
    expect(colorIs('#00ff00', 'green')).toBe(true)
    expect(colorIs('#1e40ff', 'blue')).toBe(true)
    expect(colorIs('#ffe600', 'yellow')).toBe(true)
    expect(colorIs('#101010', 'black')).toBe(true)
    expect(colorIs('#fafafa', 'white')).toBe(true)
    expect(colorIs('#00000000', 'transparent')).toBe(true)
    expect(colorIs('#808080', 'red')).toBe(false)
    expect(colorIs('nope', 'red')).toBe(false)
  })

  it('requires every expectation to be satisfied by some call, in any order', () => {
    const calls = [
      { id: 'a', name: 'set_pixels', args: { pixels: [] } },
      { id: 'b', name: 'rotate', args: { degrees: 90, direction: 'counterclockwise' } }
    ]
    const r = matchCalls(calls, [
      { tool: 'rotate', args: { degrees: 90, direction: 'counterclockwise' } },
      { anyTool: ['set_pixels', 'draw_line'] }
    ])
    expect(r).toEqual({ pass: true, satisfied: [1, 0] })
    expect(matchCalls(calls, [{ tool: 'flip' }]).pass).toBe(false)
  })
})
