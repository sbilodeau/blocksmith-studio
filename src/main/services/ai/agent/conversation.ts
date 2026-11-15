import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import type { AgentKind, ConversationTurn } from '@shared/ai/types'
import { AppErrorException } from '../../../ipc/registry'
import { META_DIR } from '../../packs/project'

/** Per-agent conversation files (PLAN 6.5): append-only JSON lines. */
export const CONVERSATIONS_DIR = `${META_DIR}/conversations`
/** Most recent turns returned by read(). */
export const MAX_READ_TURNS = 1000

const TurnSchema = z
  .object({
    id: z.string(),
    at: z.string(),
    role: z.enum(['user', 'assistant', 'tool'])
  })
  .loose()

export interface ConversationStore {
  /** Turns in order; corrupted lines are skipped. Unknown pack -> packs.notFound. */
  read(packId: string, agent: AgentKind): Promise<ConversationTurn[]>
  append(packId: string, agent: AgentKind, turns: ConversationTurn[]): Promise<void>
  clear(packId: string, agent: AgentKind): Promise<void>
}

export function createConversationStore(deps: {
  locate: (packId: string) => Promise<{ folder: string } | null>
}): ConversationStore {
  const queues = new Map<string, Promise<unknown>>()

  function enqueue<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const run = (queues.get(key) ?? Promise.resolve()).then(fn, fn)
    const tail = run.catch(() => undefined)
    queues.set(key, tail)
    void tail.then(() => {
      if (queues.get(key) === tail) queues.delete(key)
    })
    return run
  }

  async function fileOf(packId: string, agent: AgentKind): Promise<string> {
    const location = await deps.locate(packId)
    if (!location) throw new AppErrorException('packs.notFound', { packId })
    return join(location.folder, ...CONVERSATIONS_DIR.split('/'), `${agent}.jsonl`)
  }

  /** True when the file exists and its last byte is not a newline (a previous write was cut). */
  async function needsNewline(file: string): Promise<boolean> {
    let handle: fs.FileHandle | undefined
    try {
      handle = await fs.open(file, 'r')
      const { size } = await handle.stat()
      if (size === 0) return false
      const buf = Buffer.alloc(1)
      await handle.read(buf, 0, 1, size - 1)
      return buf[0] !== 0x0a
    } catch {
      return false
    } finally {
      await handle?.close()
    }
  }

  return {
    read: async (packId, agent) => {
      const file = await fileOf(packId, agent)
      return enqueue(file, async () => {
        let raw: string
        try {
          raw = await fs.readFile(file, 'utf8')
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
          throw err
        }
        const turns: ConversationTurn[] = []
        for (const line of raw.split('\n')) {
          if (!line.trim()) continue
          try {
            const parsed = TurnSchema.safeParse(JSON.parse(line))
            if (parsed.success) turns.push(parsed.data as ConversationTurn)
          } catch {
            // corrupted line: skipped
          }
        }
        return turns.slice(-MAX_READ_TURNS)
      })
    },

    append: async (packId, agent, turns) => {
      if (turns.length === 0) return
      const file = await fileOf(packId, agent)
      await enqueue(file, async () => {
        await fs.mkdir(dirname(file), { recursive: true })
        const prefix = (await needsNewline(file)) ? '\n' : ''
        await fs.appendFile(file, prefix + turns.map((t) => JSON.stringify(t)).join('\n') + '\n')
      })
    },

    clear: async (packId, agent) => {
      const file = await fileOf(packId, agent)
      await enqueue(file, () => fs.rm(file, { force: true }))
    }
  }
}
