import { describe, expect, it } from 'vitest'
import { classSourceFromEntries } from '../../src/main/services/entity-models/extract'
import {
  BudgetExceeded,
  Interpreter,
  JDouble,
  JList,
  JLong,
  JMap,
  JObject,
  JRandom,
  OPAQUE
} from '../../src/main/services/entity-models/interpreter'
import { loadAssembler, type ClassBuilderLike } from '../fixtures/jvm/assembler'

const OWNER = 'net/minecraft/client/model/T'

async function interp(
  build: (c: ClassBuilderLike, flags: { PS: number }) => void,
  options: ConstructorParameters<typeof Interpreter>[1] = {}
): Promise<Interpreter> {
  const { ClassBuilder, ACC_PUBLIC, ACC_STATIC } = await loadAssembler()
  const b = new ClassBuilder(OWNER)
  build(b, { PS: ACC_PUBLIC | ACC_STATIC })
  return new Interpreter(classSourceFromEntries({ [`${OWNER}.class`]: b.build() }), options)
}

describe('entity model interpreter', () => {
  it('computes int and float arithmetic with Java semantics', async () => {
    const it = await interp((b, { PS }) => {
      b.method('f', '()F', (c) => c.fconst(1.5).fconst(2).fmul().fconst(0.1).fadd().freturn(), {
        access: PS
      })
      b.method('i', '()I', (c) => c.iconst(2147483647).iconst(1).iadd().ireturn(), { access: PS })
      b.method('cast', '()I', (c) => c.fconst(-2.75).f2i().ireturn(), { access: PS })
    })
    expect(it.invokeStatic(OWNER, 'f', '()F')).toBe(Math.fround(Math.fround(3) + Math.fround(0.1)))
    expect(it.invokeStatic(OWNER, 'i', '()I')).toBe(-2147483648)
    expect(it.invokeStatic(OWNER, 'cast', '()I')).toBe(-2)
  })

  it('handles long and double constants', async () => {
    const it = await interp((b, { PS }) => {
      b.method('l', '()J', (c) => c.lconst(1660).areturn(), { access: PS })
      b.method('d', '()D', (c) => c.dconst(0.25).areturn(), { access: PS })
    })
    expect(it.invokeStatic(OWNER, 'l', '()J')).toEqual(new JLong(1660n))
    expect(it.invokeStatic(OWNER, 'd', '()D')).toEqual(new JDouble(0.25))
  })

  it('runs loops and static initializers once', async () => {
    const it = await interp((b, { PS }) => {
      b.field('COUNT', 'I', { access: PS })
      b.method('<clinit>', '()V', (c) => c.iconst(10).putstatic(OWNER, 'COUNT', 'I').vreturn(), {
        access: 8
      })
      // sum = 0; for (i = 0; i < COUNT; i++) sum += i
      b.method(
        'sum',
        '()I',
        (c) =>
          c
            .iconst(0)
            .istore(0)
            .iconst(0)
            .istore(1)
            .label('top')
            .iload(1)
            .getstatic(OWNER, 'COUNT', 'I')
            .if_icmpge('end')
            .iload(0)
            .iload(1)
            .iadd()
            .istore(0)
            .iinc(1, 1)
            .goto('top')
            .label('end')
            .iload(0)
            .ireturn(),
        { access: PS }
      )
    })
    expect(it.invokeStatic(OWNER, 'sum', '()I')).toBe(45)
    expect(it.getStatic(OWNER, 'COUNT', 'I')).toBe(10)
  })

  it('calls lambdas through their interface', async () => {
    const it = await interp((b, { PS }) => {
      b.method(
        'twice',
        '(F)F',
        (c) =>
          c
            .fload(0)
            .lambda({
              iface: 'java/util/function/Supplier',
              samName: 'get',
              samDesc: '()Ljava/lang/Object;',
              implOwner: OWNER,
              implName: 'impl',
              implDesc: '(F)Ljava/lang/Object;',
              capturedDesc: '(F)'
            })
            .invokeinterface('java/util/function/Supplier', 'get', '()Ljava/lang/Object;')
            .checkcast('java/lang/Float')
            .invokevirtual('java/lang/Float', 'floatValue', '()F')
            .freturn(),
        { access: PS }
      )
      b.method(
        'impl',
        '(F)Ljava/lang/Object;',
        (c) =>
          c
            .fload(0)
            .fconst(2)
            .fmul()
            .invokestatic('java/lang/Float', 'valueOf', '(F)Ljava/lang/Float;')
            .areturn(),
        { access: PS }
      )
    })
    expect(it.invokeStatic(OWNER, 'twice', '(F)F', [3])).toBe(6)
  })

  it('simulates collections, string concatenation and null', async () => {
    const it = await interp((b, { PS }) => {
      b.method(
        'map',
        '()Ljava/util/Map;',
        (c) =>
          c
            .invokestatic('com/google/common/collect/Maps', 'newHashMap', '()Ljava/util/HashMap;')
            .astore(0)
            .aload(0)
            .sconst('a')
            .iconst(7)
            .concat('leg\u0001', '(I)')
            .invokeinterface(
              'java/util/Map',
              'put',
              '(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;'
            )
            .ifnonnull('bad')
            .aload(0)
            .areturn()
            .label('bad')
            .aconst_null()
            .areturn(),
        { access: PS }
      )
      b.method(
        'list',
        '()Ljava/util/List;',
        (c) =>
          c
            .sconst('x')
            .sconst('y')
            .invokestatic(
              'java/util/List',
              'of',
              '(Ljava/lang/Object;Ljava/lang/Object;)Ljava/util/List;'
            )
            .areturn(),
        { access: PS }
      )
    })
    const map = it.invokeStatic(OWNER, 'map', '()Ljava/util/Map;')
    expect(map).toBeInstanceOf(JMap)
    expect((map as JMap).get('a')).toBe('leg7')
    expect((it.invokeStatic(OWNER, 'list', '()Ljava/util/List;') as JList).items).toEqual([
      'x',
      'y'
    ])
  })

  it('creates jar objects and runs their constructors', async () => {
    const it = await interp((b, { PS }) => {
      b.field('v', 'F')
      b.method('<init>', '(F)V', (c) =>
        c
          .aload(0)
          .invokespecial('java/lang/Object', '<init>', '()V')
          .aload(0)
          .fload(1)
          .putfield(OWNER, 'v', 'F')
          .vreturn()
      )
      b.method(
        'make',
        `()L${OWNER};`,
        (c) => c.newObject(OWNER).dup().fconst(4).invokespecial(OWNER, '<init>', '(F)V').areturn(),
        { access: PS }
      )
    })
    const o = it.invokeStatic(OWNER, 'make', `()L${OWNER};`)
    expect(o).toBeInstanceOf(JObject)
    expect((o as JObject).get('v')).toBe(4)
  })

  it('returns an unknown value when a method throws or calls unknown code, and keeps going', async () => {
    const aborts: string[] = []
    const it = await interp(
      (b, { PS }) => {
        b.method(
          'boom',
          '()F',
          (c) =>
            c
              .newObject('java/lang/RuntimeException')
              .dup()
              .invokespecial('java/lang/RuntimeException', '<init>', '()V')
              .athrow(),
          { access: PS }
        )
        b.method(
          'unknown',
          '()F',
          (c) => c.invokestatic('com/example/Native', 'value', '()F').freturn(),
          {
            access: PS
          }
        )
        b.method(
          'branchOnUnknown',
          '()I',
          (c) =>
            c
              .invokestatic('com/example/Native', 'flag', '()I')
              .ifeq('zero')
              .iconst(1)
              .ireturn()
              .label('zero')
              .iconst(0)
              .ireturn(),
          { access: PS }
        )
      },
      { onAbort: (_where, reason) => aborts.push(reason) }
    )
    expect(it.invokeStatic(OWNER, 'boom', '()F')).toBe(OPAQUE)
    expect(it.invokeStatic(OWNER, 'unknown', '()F')).toBe(OPAQUE)
    expect(it.invokeStatic(OWNER, 'branchOnUnknown', '()I')).toBe(OPAQUE)
    expect(aborts).toContain('athrow')
    expect(aborts).toContain('unknown number')
  })

  it('stops on the instruction budget', async () => {
    const it = await interp(
      (b, { PS }) => {
        b.method('spin', '()V', (c) => c.label('l').goto('l'), { access: PS })
      },
      { maxSteps: 1000 }
    )
    expect(() => it.invokeStatic(OWNER, 'spin', '()V')).toThrow(BudgetExceeded)
  })

  it('reproduces java.util.Random for seeded random sources', () => {
    // new java.util.Random(42).nextInt() == -1170105035
    expect(new JRandom(42n).nextInt()).toBe(-1170105035)
    const r = new JRandom(1660n)
    const values = Array.from({ length: 9 }, () => r.nextInt(7))
    expect(values.every((v) => v >= 0 && v < 7)).toBe(true)
  })
})
