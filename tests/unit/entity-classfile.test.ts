import { describe, expect, it } from 'vitest'
import {
  ClassFormatError,
  parseClassFile,
  parseMethodDescriptor
} from '../../src/main/services/entity-models/classfile'
import { loadAssembler } from '../fixtures/jvm/assembler'

describe('class file reader', () => {
  it('reads names, fields with constants, methods, code and bootstrap methods', async () => {
    const { ClassBuilder, ACC_PUBLIC, ACC_STATIC } = await loadAssembler()
    const b = new ClassBuilder('net/minecraft/client/model/Demo', { superName: 'java/lang/Record' })
    b.field('SIZE', 'I', { access: ACC_PUBLIC | ACC_STATIC, constant: 64 })
    b.field('NAME', 'Ljava/lang/String;', { access: ACC_PUBLIC | ACC_STATIC, constant: 'héllo' })
    b.field('x', 'F')
    b.method(
      'make',
      '()Ljava/util/function/Supplier;',
      (c) =>
        c
          .lambda({
            iface: 'java/util/function/Supplier',
            samName: 'get',
            samDesc: '()Ljava/lang/Object;',
            implOwner: 'net/minecraft/client/model/Demo',
            implName: 'lambda$make$0',
            implDesc: '()Ljava/lang/Object;'
          })
          .areturn(),
      { access: ACC_PUBLIC | ACC_STATIC }
    )
    const cls = parseClassFile(b.build())
    expect(cls.version).toBe(69)
    expect(cls.name).toBe('net/minecraft/client/model/Demo')
    expect(cls.superName).toBe('java/lang/Record')
    expect(cls.field('SIZE')?.constant).toBe(64)
    expect(cls.field('NAME')?.constant).toBe('héllo')
    expect(cls.field('x')?.desc).toBe('F')
    const m = cls.method('make', '()Ljava/util/function/Supplier;')
    expect(m?.code?.code.length).toBeGreaterThan(0)
    expect(cls.bootstrapMethods).toHaveLength(1)
    expect(cls.bootstrapMethods[0]!.method.owner).toBe('java/lang/invoke/LambdaMetafactory')
  })

  it('rejects files that are not class files', () => {
    expect(() => parseClassFile(new Uint8Array([1, 2, 3, 4]))).toThrow(ClassFormatError)
    expect(() => parseClassFile(new Uint8Array([0xca, 0xfe, 0xba, 0xbe, 0, 0]))).toThrow(
      ClassFormatError
    )
  })

  it('parses method descriptors', () => {
    expect(parseMethodDescriptor('(FI[JLjava/lang/String;[[Lx/Y;D)V')).toEqual({
      params: ['F', 'I', '[J', 'Ljava/lang/String;', '[[Lx/Y;', 'D'],
      ret: 'V'
    })
    expect(parseMethodDescriptor('()Lnet/minecraft/A;').ret).toBe('Lnet/minecraft/A;')
    expect(() => parseMethodDescriptor('V')).toThrow(ClassFormatError)
  })
})
