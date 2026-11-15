import type { ProviderKind } from './types'

/** Ready-made provider settings offered by Settings > AI > "Add a provider" (PLAN 7.3). */
export interface ProviderPreset {
  /** Preset key; also the default provider id. */
  id: 'ollama-cloud' | 'openai' | 'openrouter' | 'ollama-local' | 'custom'
  kind: ProviderKind
  /** Empty for "custom" (the user names it). */
  label: string
  baseUrl: string
  extraHeaders?: Record<string, string>
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  { id: 'ollama-cloud', kind: 'ollama', label: 'Ollama Cloud', baseUrl: 'https://ollama.com' },
  {
    id: 'openai',
    kind: 'openai-compatible',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1'
  },
  {
    id: 'openrouter',
    kind: 'openai-compatible',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    // Optional app attribution headers documented by OpenRouter (no user data).
    extraHeaders: {
      'HTTP-Referer': 'https://github.com/sbilodeau/blocksmith-studio',
      'X-Title': 'Blocksmith Studio'
    }
  },
  {
    id: 'ollama-local',
    kind: 'ollama',
    label: 'Ollama (this computer)',
    baseUrl: 'http://localhost:11434'
  },
  { id: 'custom', kind: 'openai-compatible', label: '', baseUrl: '' }
]

/** A provider id from a label that does not collide with `taken` ("OpenRouter" -> "openrouter", "openrouter-2"). */
export function providerIdFor(label: string, taken: readonly string[]): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 36) || 'provider'
  if (!taken.includes(base)) return base
  for (let n = 2; ; n++) {
    const id = `${base}-${n}`
    if (!taken.includes(id)) return id
  }
}

/** "Name: value" lines -> headers (blank lines ignored); undefined when there are none. */
export function parseHeaderLines(text: string): Record<string, string> | undefined {
  const headers: Record<string, string> = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const colon = line.indexOf(':')
    if (colon <= 0) throw new Error(`invalid header line: ${line.slice(0, 60)}`)
    headers[line.slice(0, colon).trim()] = line.slice(colon + 1).trim()
  }
  return Object.keys(headers).length ? headers : undefined
}

export function headerLines(headers: Record<string, string> | undefined): string {
  return Object.entries(headers ?? {})
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
}
