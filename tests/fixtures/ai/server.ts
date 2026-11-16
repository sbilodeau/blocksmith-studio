import { createServer, type IncomingHttpHeaders, type ServerResponse } from 'http'
import type { AddressInfo } from 'net'
import { readFileSync } from 'fs'
import { join } from 'path'

/** Local HTTP server replaying recorded / hand-written provider responses (tests/fixtures/ai). */
export interface RecordedRequest {
  method: string
  path: string
  headers: IncomingHttpHeaders
  body: unknown
}

export type RouteHandler = (req: RecordedRequest, res: ServerResponse) => void | Promise<void>

export interface FakeProviderServer {
  url: string
  requests: RecordedRequest[]
  /** Handlers are used in order for successive requests; the last one repeats. */
  on(method: string, path: string, ...handlers: RouteHandler[]): void
  close(): Promise<void>
}

const FIXTURES = join(__dirname)

export function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8')
}

export function json(
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): RouteHandler {
  return (_req, res) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers })
    res.end(JSON.stringify(body))
  }
}

export function jsonFixture(name: string): RouteHandler {
  return json(200, JSON.parse(fixture(name)))
}

/** Streams an NDJSON fixture line by line (one write per line, like a real server). */
export function ndjsonFixture(name: string): RouteHandler {
  return ndjson(fixture(name))
}

export function ndjson(text: string): RouteHandler {
  return async (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
    for (const line of text.split('\n')) {
      if (!line) continue
      res.write(line + '\n')
      await new Promise((r) => setImmediate(r))
    }
    res.end()
  }
}

/** Streams a Server-Sent Events text, one event per write (split on blank lines, like a real server). */
export function sse(text: string): RouteHandler {
  return async (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    for (const event of text.split(/\r?\n\r?\n/)) {
      if (!event.trim()) continue
      res.write(event + '\n\n')
      await new Promise((r) => setImmediate(r))
    }
    res.end()
  }
}

export function sseFixture(name: string): RouteHandler {
  return sse(fixture(name))
}

export async function startFakeProviderServer(): Promise<FakeProviderServer> {
  const routes = new Map<string, RouteHandler[]>()
  const counters = new Map<string, number>()
  const requests: RecordedRequest[] = []

  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      let body: unknown = raw
      try {
        body = raw ? JSON.parse(raw) : undefined
      } catch {
        // keep the raw text
      }
      const path = (req.url ?? '/').split('?')[0] ?? '/'
      const recorded: RecordedRequest = {
        method: req.method ?? 'GET',
        path,
        headers: req.headers,
        body
      }
      requests.push(recorded)
      const key = `${recorded.method} ${path}`
      const handlers = routes.get(key)
      if (!handlers?.length) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: `no route for ${key}` }))
        return
      }
      const n = counters.get(key) ?? 0
      counters.set(key, n + 1)
      const handler = handlers[Math.min(n, handlers.length - 1)]!
      void Promise.resolve(handler(recorded, res)).catch(() => res.destroy())
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    on(method, path, ...handlers) {
      routes.set(`${method} ${path}`, handlers)
      counters.delete(`${method} ${path}`)
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
  }
}
