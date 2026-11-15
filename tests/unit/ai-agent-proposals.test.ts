import { describe, expect, it, vi } from 'vitest'
import { createImage, decodePng, encodePng, getPixel, setPixel, toHex } from '@shared/image'
import { getTool } from '@shared/ai/tools'
import { emptyBrief } from '@shared/model/brief'
import type { Proposal, ProposalStep } from '@shared/ai/types'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const { ProposalStore, replayProposal, requestSummary, decisionNote, shortTexturePath } =
  await import('../../src/main/services/ai/agent/proposals')

function step(
  id: string,
  tool: string,
  args: unknown,
  extra: Partial<ProposalStep> = {}
): ProposalStep {
  const t = getTool(tool)!
  const parsed = t.params.parse(args)
  return {
    id,
    callId: `c-${id}`,
    tool,
    args: parsed,
    kind: t.kind,
    description: t.describe(parsed),
    dependsOn: [],
    ...extra
  }
}

function proposal(steps: ProposalStep[], extra: Partial<Proposal> = {}): Proposal {
  const img = createImage(2, 1)
  setPixel(img, 0, 0, [255, 0, 0, 255])
  setPixel(img, 1, 0, [0, 255, 0, 255])
  return {
    id: 'p1',
    runId: 'r1',
    agent: 'editor',
    packId: 'pack',
    texturePath: 'assets/minecraft/textures/block/stone.png',
    basePng: encodePng(img),
    steps,
    status: 'pending',
    ...extra
  }
}

const STEPS = [
  step('s1', 'flip', { axis: 'horizontal' }),
  step('s2', 'set_pixels', { pixels: [{ x: 0, y: 0, color: '#0000ff' }] }, { dependsOn: ['s1'] }),
  step('s3', 'update_style_brief', { patch: { theme: 'Dark' } }, { briefPatch: { theme: 'Dark' } })
]

describe('proposal replay', () => {
  it('replays all accepted mutate steps in order and collects brief patches', () => {
    const out = replayProposal(proposal(STEPS), ['s3', 's2', 's1'], emptyBrief())
    expect(out.applied.map((s) => s.id)).toEqual(['s1', 's2', 's3'])
    // flip: [g r], then (0,0) blue: [b r]
    expect(toHex(getPixel(out.image, 0, 0))).toBe('#0000ffff')
    expect(toHex(getPixel(out.image, 1, 0))).toBe('#ff0000ff')
    expect(out.patches).toEqual([{ theme: 'Dark' }])
    expect(decodePng(out.png).width).toBe(2)
  })

  it('replays only the accepted steps, even when a dependency was unchecked', () => {
    const out = replayProposal(proposal(STEPS), ['s2'], emptyBrief())
    expect(out.applied.map((s) => s.id)).toEqual(['s2'])
    // No flip: (0,0) red becomes blue, green stays.
    expect(toHex(getPixel(out.image, 0, 0))).toBe('#0000ffff')
    expect(toHex(getPixel(out.image, 1, 0))).toBe('#00ff00ff')
    expect(out.patches).toEqual([])
  })

  it('no accepted step returns the base image', () => {
    const p = proposal(STEPS)
    const out = replayProposal(p, [], emptyBrief())
    expect(out.applied).toEqual([])
    expect(toHex(getPixel(out.image, 0, 0))).toBe('#ff0000ff')
  })

  it('fails with ai.replayFailed for an unknown tool', () => {
    const bad = { ...STEPS[0], id: 'x', tool: 'teleport' }
    expect(() => replayProposal(proposal([bad]), ['x'], emptyBrief())).toThrow(
      expect.objectContaining({ code: 'ai.replayFailed' })
    )
  })

  it('summaries and notes', () => {
    const p = proposal(STEPS)
    expect(shortTexturePath(p.texturePath)).toBe('block/stone.png')
    expect(shortTexturePath('assets/mymod/textures/item/x.png')).toBe('mymod:item/x.png')
    expect(
      requestSummary({ proposal: p, createdAt: 0, request: 'flip it' }, STEPS.slice(0, 2))
    ).toBe('block/stone.png: "flip it" -> flip, set_pixels (2 of 3 steps)')
    expect(decisionNote(p, STEPS.slice(0, 2))).toContain('applied 2 of 3 steps')
    expect(decisionNote(p, STEPS.slice(0, 2))).toContain('not applied: update_style_brief')
    expect(decisionNote(p, [])).toContain('rejected the proposal (applied 0 of 3 steps)')
  })
})

describe('proposal store', () => {
  it('finds, expires after the TTL and reports unknown ids', () => {
    let t = 0
    const store = new ProposalStore(() => t, 1000)
    store.add(proposal(STEPS), 'req')
    expect(store.get('p1').request).toBe('req')
    t = 1001
    expect(() => store.get('p1')).toThrow(expect.objectContaining({ code: 'ai.proposalNotFound' }))
    expect(() => store.get('nope')).toThrow(
      expect.objectContaining({ code: 'ai.proposalNotFound' })
    )
  })

  it('getPending refuses decided proposals', () => {
    const store = new ProposalStore()
    const p = proposal(STEPS)
    store.add(p, 'req')
    p.status = 'applied'
    expect(() => store.getPending('p1')).toThrow(
      expect.objectContaining({
        code: 'ai.proposalNotPending',
        params: { proposalId: 'p1', status: 'applied' }
      })
    )
  })

  it('a new run expires the pending proposals of the same pack and agent only', () => {
    const store = new ProposalStore()
    store.add(proposal(STEPS, { id: 'a' }), '')
    store.add(proposal(STEPS, { id: 'b', packId: 'other' }), '')
    store.add(proposal(STEPS, { id: 'c', status: 'applied' }), '')
    store.expireFor('pack', 'editor')
    expect(() => store.get('a')).toThrow()
    expect(store.get('b')).toBeDefined()
    expect(store.get('c')).toBeDefined()
  })
})
