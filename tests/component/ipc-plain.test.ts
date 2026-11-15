import { describe, expect, it } from 'vitest'
import { reactive, ref } from 'vue'
import { toPlain } from '@renderer/services/ipc'

describe('toPlain', () => {
  it('strips reactive proxies so the payload survives structured clone', () => {
    const model = ref({ providerId: 'p', modelId: 'm' })
    const state = reactive({ list: [{ a: 1 }], headers: { x: 'y' }, png: new Uint8Array([1, 2]) })
    const plain = toPlain({ model: model.value, state, skip: undefined })
    expect(() => structuredClone(plain)).not.toThrow()
    expect(plain).toEqual({
      model: { providerId: 'p', modelId: 'm' },
      state: { list: [{ a: 1 }], headers: { x: 'y' }, png: new Uint8Array([1, 2]) }
    })
    expect(plain.state.png).toBeInstanceOf(Uint8Array)
    expect('skip' in plain).toBe(false)
  })
})
