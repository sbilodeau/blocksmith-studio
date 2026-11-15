import { describe, expect, it } from 'vitest'
import {
  EVENT_CHANNELS,
  INVOKE_CHANNELS,
  isEventChannel,
  isInvokeChannel
} from '@shared/ipc/channels'
import { inputSchemas } from '@shared/ipc/contract'

describe('IPC contract', () => {
  it('defines an input schema for every invoke channel and nothing else', () => {
    expect(Object.keys(inputSchemas).sort()).toEqual([...INVOKE_CHANNELS].sort())
  })

  it('recognizes only whitelisted channels', () => {
    expect(isInvokeChannel('settings.get')).toBe(true)
    expect(isInvokeChannel('fs.readFile')).toBe(false)
    expect(isInvokeChannel(42)).toBe(false)
    expect(isEventChannel('updater.status')).toBe(true)
    expect(isEventChannel('settings.get')).toBe(false)
    expect(EVENT_CHANNELS.length).toBeGreaterThan(0)
  })

  it('rejects payloads on channels that take no input', () => {
    expect(inputSchemas['settings.get'].safeParse(undefined).success).toBe(true)
    expect(inputSchemas['settings.get'].safeParse({ path: '/etc/passwd' }).success).toBe(false)
  })

  it('only accepts https URLs for openExternal', () => {
    const schema = inputSchemas['app.openExternal']
    expect(schema.safeParse({ url: 'https://github.com/sbilodeau' }).success).toBe(true)
    expect(schema.safeParse({ url: 'http://example.com' }).success).toBe(false)
    expect(schema.safeParse({ url: 'file:///etc/passwd' }).success).toBe(false)
    expect(schema.safeParse({ url: 'javascript:alert(1)' }).success).toBe(false)
  })

  it('validates settings patches strictly', () => {
    const schema = inputSchemas['settings.update']
    expect(schema.safeParse({ theme: 'dark' }).success).toBe(true)
    expect(schema.safeParse({ theme: 'neon' }).success).toBe(false)
    expect(schema.safeParse({ secret: 'x' }).success).toBe(false)
  })
})
