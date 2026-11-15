import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { turnsToItems, useAiStore } from '@renderer/stores/ai'
import type { AgentEvent, Proposal } from '@shared/ai/types'

const proposal: Proposal = {
  id: 'prop1',
  runId: 'run1',
  agent: 'editor',
  packId: 'fire',
  texturePath: 'assets/minecraft/textures/block/stone.png',
  basePng: new Uint8Array([1]),
  steps: [],
  status: 'pending'
}

describe('AI store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('folds persisted turns into user and assistant bubbles with tool results', () => {
    const items = turnsToItems([
      { id: '1', at: 't', role: 'user', text: 'rotate it' },
      {
        id: '2',
        at: 't',
        role: 'assistant',
        text: 'Sure',
        toolCalls: [{ id: 'c1', name: 'rotate', args: { degrees: 90 } }]
      },
      {
        id: '3',
        at: 't',
        role: 'tool',
        toolResult: { callId: 'c1', ok: true, summary: 'rotated' }
      },
      { id: '4', at: 't', role: 'assistant', text: 'Done', proposalId: 'prop1' }
    ])
    expect(items).toHaveLength(2)
    expect(items[1].text).toBe('Sure\nDone')
    expect(items[1].toolCalls[0].result).toEqual({ ok: true, summary: 'rotated' })
    expect(items[1].proposalId).toBe('prop1')
  })

  it('routes streamed agent events into the running session', async () => {
    window.blocksmith.invoke = (async (channel: string) =>
      channel === 'ai.agent.send'
        ? { ok: true, value: { runId: 'run1' } }
        : { ok: true, value: [] }) as typeof window.blocksmith.invoke
    const ai = useAiStore()
    await ai.sendEditor({
      packId: 'fire',
      message: 'tourne de 90 à gauche',
      model: { providerId: 'ollama-cloud', modelId: 'm' },
      texture: { path: proposal.texturePath, png: new Uint8Array([1]) },
      language: 'fr'
    })
    const events: AgentEvent[] = [
      { runId: 'run1', type: 'thinking', delta: 'Let me ' },
      { runId: 'run1', type: 'thinking', delta: 'rotate.' },
      {
        runId: 'run1',
        type: 'tool_call',
        call: { id: 'c1', name: 'rotate', args: {} },
        kind: 'mutate',
        iteration: 1
      },
      { runId: 'run1', type: 'tool_result', callId: 'c1', ok: true, summary: 'ok' },
      { runId: 'run1', type: 'text', delta: 'Voilà' },
      { runId: 'run1', type: 'usage', inputTokens: 100, outputTokens: 20 },
      { runId: 'run1', type: 'usage', inputTokens: 50, outputTokens: 5 },
      { runId: 'run1', type: 'proposal', proposal },
      { runId: 'run1', type: 'done', reason: 'end' }
    ]
    events.forEach((e) => ai.onEvent(e))
    const s = ai.session('fire', 'editor')
    const last = s.items[s.items.length - 1]
    expect(s.items[0].text).toBe('tourne de 90 à gauche')
    expect(last.thinking).toBe('Let me rotate.')
    expect(last.toolCalls[0].result?.ok).toBe(true)
    expect(last.text).toBe('Voilà')
    expect(last.usage).toMatchObject({ inputTokens: 150, outputTokens: 25 })
    expect(last.proposalId).toBe('prop1')
    expect(last.streaming).toBe(false)
    expect(s.runId).toBeNull()
  })

  it('marks budget and stop endings on the reply', async () => {
    window.blocksmith.invoke = (async () => ({
      ok: true,
      value: { runId: 'run2' }
    })) as typeof window.blocksmith.invoke
    const ai = useAiStore()
    await ai.sendEditor({
      packId: 'fire',
      message: 'x',
      model: { providerId: 'p', modelId: 'm' },
      texture: { path: proposal.texturePath, png: new Uint8Array([1]) },
      language: 'en'
    })
    ai.onEvent({ runId: 'run2', type: 'done', reason: 'budget' })
    const s = ai.session('fire', 'editor')
    expect(s.items[s.items.length - 1].error?.code).toBe('ai.budgetReached')
  })

  it('ignores events of unknown runs', () => {
    const ai = useAiStore()
    ai.onEvent({ runId: 'nope', type: 'text', delta: 'x' })
    expect(Object.keys(ai.sessions)).toHaveLength(0)
  })
})
