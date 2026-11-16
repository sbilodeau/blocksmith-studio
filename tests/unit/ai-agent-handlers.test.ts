import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyBrief } from '@shared/model/brief'
import { fakeProvider } from './ai-agent-fakes'

const handlers = new Map<string, (input: unknown) => unknown>()

vi.mock('../../src/main/ipc/registry', () => ({
  handle: (channel: string, fn: (input: unknown) => unknown) => handlers.set(channel, fn),
  AppErrorException: class extends Error {
    constructor(
      public readonly code: string,
      public readonly params?: Record<string, string | number>
    ) {
      super(code)
    }
  }
}))

const { registerAiAgentHandlers } = await import('../../src/main/ipc/ai-agent-handlers')

describe('registerAiAgentHandlers', () => {
  let folder: string

  beforeEach(async () => {
    handlers.clear()
    folder = await mkdtemp(join(tmpdir(), 'bs-agent-h-'))
  })
  afterEach(async () => {
    await rm(folder, { recursive: true, force: true })
  })

  function register(): ReturnType<typeof registerAiAgentHandlers> {
    return registerAiAgentHandlers({
      providers: fakeProvider([]).providers,
      getAgentSettings: () => ({ thinking: 'off', maxIterations: 6, imageMode: 'grid' }),
      packs: { locate: async (id) => (id === 'p1' ? { folder } : null) },
      readVanillaPng: async () => null,
      emit: () => undefined,
      now: () => new Date('2026-11-15T10:00:00Z')
    })
  }

  it('registers the agent, proposal and brief channels', () => {
    register()
    expect([...handlers.keys()].sort()).toEqual(
      [
        'ai.agent.send',
        'ai.agent.stop',
        'ai.agent.conversation',
        'ai.agent.clear',
        'ai.proposal.apply',
        'ai.proposal.reject',
        'ai.navigation.send',
        'ai.navigation.apply',
        'brief.get',
        'brief.update'
      ].sort()
    )
  })

  it('brief.get / brief.update record user decisions', async () => {
    register()
    expect(await handlers.get('brief.get')!({ packId: 'p1' })).toEqual(emptyBrief())
    const out = await handlers.get('brief.update')!({
      packId: 'p1',
      patch: { theme: 'Cozy', addDecision: 'Warm' }
    })
    expect(out).toMatchObject({
      theme: 'Cozy',
      decisions: [{ by: 'user', text: 'Warm', at: '2026-11-15T10:00:00.000Z' }]
    })
  })

  it('forwards conversation, stop and proposal errors', async () => {
    register()
    expect(await handlers.get('ai.agent.conversation')!({ packId: 'p1', agent: 'editor' })).toEqual(
      []
    )
    expect(handlers.get('ai.agent.stop')!({ runId: 'nope' })).toBeUndefined()
    await expect(
      handlers.get('ai.proposal.apply')!({ proposalId: 'x', acceptedStepIds: [] })
    ).rejects.toMatchObject({ code: 'ai.proposalNotFound' })
    await expect(handlers.get('ai.proposal.reject')!({ proposalId: 'x' })).rejects.toMatchObject({
      code: 'ai.proposalNotFound'
    })
    await expect(handlers.get('brief.get')!({ packId: 'nope' })).rejects.toMatchObject({
      code: 'packs.notFound'
    })
  })
})
