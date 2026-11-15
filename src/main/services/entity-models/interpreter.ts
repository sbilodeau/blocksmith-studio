/**
 * A small symbolic JVM interpreter for the model-building code of the Minecraft client jar (PLAN M3b).
 *
 * It runs real bytecode for the classes `interpretable()` accepts (the jar's `net/minecraft/client/model/**`), and
 * simulates the few JDK / library classes that code touches (collections, boxing, Math, Guava builders, JOML
 * vectors, Mojang's Direction / Identifier / Mth / Util.make). Everything else evaluates to OPAQUE: an unknown value.
 * Branching on an unknown value, throwing, or exhausting the budget aborts the current method; the caller receives
 * OPAQUE and goes on, so one unsupported model only loses that model. Nothing is ever executed natively.
 */
import {
  ACC_STATIC,
  ClassFile,
  isWide,
  parseMethodDescriptor,
  type MemberRef,
  type MethodHandleRef,
  type MethodInfo
} from './classfile'

// ---------- values ----------
export class JLong {
  constructor(readonly v: bigint) {}
}
export class JDouble {
  constructor(readonly v: number) {}
}
/** An unknown value. `wide` for unknown long/double (two slots, category 2 on the stack). */
export class Opaque {
  constructor(readonly wide = false) {}
}
export const OPAQUE = new Opaque()
export const OPAQUE_WIDE = new Opaque(true)

/** An instance of a jar class (or of a simulated class with plain fields, like org/joml/Vector3f). */
export class JObject {
  readonly fields = new Map<string, JValue>()
  constructor(readonly cls: string) {}
  get(name: string): JValue | undefined {
    return this.fields.get(name)
  }
}
export class JArray {
  constructor(
    readonly elem: string,
    readonly items: JValue[]
  ) {}
}
export class Lambda {
  constructor(
    readonly iface: string,
    readonly impl: MethodHandleRef,
    readonly captured: JValue[]
  ) {}
}
export class JEnum {
  constructor(
    readonly cls: string,
    readonly name: string,
    readonly ordinal: number
  ) {}
}
export class JList {
  constructor(readonly items: JValue[] = []) {}
}
export class JMap {
  readonly entries: Array<[JValue, JValue]> = []
  find(key: JValue): number {
    return this.entries.findIndex(([k]) => jEquals(k, key))
  }
  get(key: JValue): JValue {
    const i = this.find(key)
    return i < 0 ? null : this.entries[i]![1]
  }
  put(key: JValue, value: JValue): JValue {
    const i = this.find(key)
    if (i < 0) {
      this.entries.push([key, value])
      return null
    }
    const old = this.entries[i]![1]
    this.entries[i]![1] = value
    return old
  }
}
export class JSet {
  readonly items: JValue[] = []
  add(v: JValue): boolean {
    if (this.items.some((x) => jEquals(x, v))) return false
    this.items.push(v)
    return true
  }
}
export class JEntry {
  constructor(
    readonly map: JMap,
    readonly key: JValue
  ) {}
}
export class JIterator {
  pos = 0
  constructor(readonly items: JValue[]) {}
}
/** ImmutableMap.Builder / ImmutableList.Builder / ImmutableSet.Builder. */
export class JBuilder {
  readonly map = new JMap()
  readonly list: JValue[] = []
  constructor(readonly kind: 'map' | 'list' | 'set') {}
}
/**
 * Mojang's seeded RandomSource (LegacyRandomSource / SingleThreadedRandomSource): the java.util.Random 48-bit LCG,
 * so a model that draws from a fixed seed (the ghast's tentacle lengths) gets the same numbers as the game.
 */
export class JRandom {
  private seed: bigint
  constructor(seed: bigint) {
    this.seed = (seed ^ 0x5deece66dn) & ((1n << 48n) - 1n)
  }
  next(bits: number): number {
    this.seed = (this.seed * 0x5deece66dn + 0xbn) & ((1n << 48n) - 1n)
    return Number(BigInt.asIntN(32, this.seed >> BigInt(48 - bits)))
  }
  nextInt(bound?: number): number {
    if (bound === undefined) return this.next(32)
    if (bound <= 0) throw new InterpAbort('IllegalArgumentException')
    if ((bound & -bound) === bound) return Number((BigInt(bound) * BigInt(this.next(31))) >> 31n)
    for (;;) {
      const bits = this.next(31)
      const val = bits % bound
      if (bits - val + (bound - 1) >= 0 && bits - val + (bound - 1) <= 0x7fffffff) return val
    }
  }
  nextFloat(): number {
    return Math.fround(this.next(24) * 5.9604645e-8)
  }
}

export class JStringBuilder {
  constructor(public s = '') {}
}

export type JValue =
  | number
  | string
  | null
  | JLong
  | JDouble
  | Opaque
  | JObject
  | JArray
  | Lambda
  | JEnum
  | JList
  | JMap
  | JSet
  | JIterator
  | JEntry
  | JBuilder
  | JRandom
  | JStringBuilder

function jEquals(a: JValue, b: JValue): boolean {
  if (a === b) return true
  if (a instanceof JObject && b instanceof JObject && a.cls === b.cls) {
    // Records and value objects (ModelLayerLocation, Identifier): compare fields.
    if (a.fields.size !== b.fields.size) return false
    for (const [k, v] of a.fields) if (!jEquals(v, b.fields.get(k) ?? null)) return false
    return true
  }
  if (a instanceof JLong && b instanceof JLong) return a.v === b.v
  if (a instanceof JDouble && b instanceof JDouble) return a.v === b.v
  return false
}

function wideValue(v: JValue): boolean {
  return v instanceof JLong || v instanceof JDouble || (v instanceof Opaque && v.wide)
}

function opaqueFor(type: string): Opaque {
  return isWide(type) ? OPAQUE_WIDE : OPAQUE
}

function defaultFor(desc: string): JValue {
  switch (desc[0]) {
    case 'J':
      return new JLong(0n)
    case 'D':
      return new JDouble(0)
    case 'L':
    case '[':
      return null
    default:
      return 0
  }
}

/** Java String.hashCode (used by switch on strings). */
function javaHash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return h
}

// ---------- control flow ----------
/** Aborts the current method (unsupported construct, unknown branch, exception...). */
export class InterpAbort extends Error {}
/** The global instruction budget is exhausted: stops everything. */
export class BudgetExceeded extends Error {}

const NOT_HANDLED: unique symbol = Symbol('not handled')
type HostResult = JValue | undefined | typeof NOT_HANDLED

export interface ClassSource {
  /** Parsed class by internal name (`net/minecraft/...`), or undefined when not available. */
  load(name: string): ClassFile | undefined
}

export interface InterpreterOptions {
  /** Classes whose bytecode is interpreted (others are simulated or opaque). */
  interpretable?: (name: string) => boolean
  maxSteps?: number
  maxDepth?: number
  /** Called for every abort with a short reason (for diagnostics). */
  onAbort?: (where: string, reason: string) => void
  /** Called on every ImmutableMap.Builder.put (to collect results even if the caller later aborts). */
  onMapBuilderPut?: (key: JValue, value: JValue) => void
}

const DIRECTIONS = ['DOWN', 'UP', 'NORTH', 'SOUTH', 'WEST', 'EAST']

/**
 * Classes whose bytecode is run: the model package, plus entity and block-entity renderers (some layers, like the
 * conduit, the decorated pot or the wither skull, are built by static methods of their renderer).
 */
export function isModelCodeClass(name: string): boolean {
  return (
    name.startsWith('net/minecraft/client/model/') ||
    name.startsWith('net/minecraft/client/renderer/entity/') ||
    name.startsWith('net/minecraft/client/renderer/blockentity/')
  )
}
const DIRECTION_CLASS = 'net/minecraft/core/Direction'

export class Interpreter {
  private readonly statics = new Map<string, Map<string, JValue>>()
  private readonly initState = new Map<string, 'running' | 'done'>()
  private readonly enums = new Map<string, JEnum>()
  private steps = 0
  private depth = 0
  private readonly maxSteps: number
  private readonly maxDepth: number
  private readonly interpretable: (name: string) => boolean

  constructor(
    private readonly source: ClassSource,
    private readonly options: InterpreterOptions = {}
  ) {
    this.maxSteps = options.maxSteps ?? 20_000_000
    this.maxDepth = options.maxDepth ?? 120
    this.interpretable = options.interpretable ?? isModelCodeClass
  }

  get stepCount(): number {
    return this.steps
  }

  // ---------- public entry points ----------
  /** Runs a static method; returns OPAQUE (or nothing for void) when it aborts. Budget errors propagate. */
  invokeStatic(owner: string, name: string, desc: string, args: JValue[] = []): JValue | undefined {
    return this.call({ owner, name, desc }, 'static', null, args)
  }

  getStatic(owner: string, name: string, desc = 'Ljava/lang/Object;'): JValue {
    return this.readStatic({ owner, name, desc })
  }

  // ---------- classes ----------
  private canInterpret(name: string): boolean {
    return this.interpretable(name) && this.source.load(name) !== undefined
  }

  private ensureInit(name: string): void {
    if (this.initState.has(name) || !this.canInterpret(name)) return
    const cls = this.source.load(name)!
    this.initState.set(name, 'running')
    const map = new Map<string, JValue>()
    for (const f of cls.fields) {
      if (f.access & ACC_STATIC) {
        map.set(
          f.name,
          f.constant !== undefined
            ? typeof f.constant === 'bigint'
              ? new JLong(f.constant)
              : f.desc === 'D'
                ? new JDouble(f.constant as number)
                : (f.constant as number | string)
            : defaultFor(f.desc)
        )
      }
    }
    this.statics.set(name, map)
    if (cls.superName) this.ensureInit(cls.superName)
    const clinit = cls.method('<clinit>', '()V')
    if (clinit?.code) {
      const assigned = new Set<string>()
      try {
        this.execute(cls, clinit, [], assigned)
      } catch (err) {
        if (err instanceof BudgetExceeded) throw err
        this.options.onAbort?.(`${name}.<clinit>`, String((err as Error).message))
        // Fields the initializer never reached are unknown, not null.
        for (const f of cls.fields) {
          if (f.access & ACC_STATIC && f.constant === undefined && !assigned.has(f.name)) {
            map.set(f.name, opaqueFor(f.desc))
          }
        }
      }
    }
    this.initState.set(name, 'done')
  }

  private isSubclass(cls: string, target: string): boolean {
    if (cls === target || target === 'java/lang/Object') return true
    const c = this.source.load(cls)
    if (!c) return false
    if (c.superName && this.isSubclass(c.superName, target)) return true
    return c.interfaces.some((i) => this.isSubclass(i, target))
  }

  /** Finds a method with code (or abstract) in a class, its superclasses, then its interfaces (default methods). */
  private resolve(
    cls: string,
    name: string,
    desc: string
  ): { cls: ClassFile; m: MethodInfo } | undefined {
    const seen = new Set<string>()
    const walk = (n: string | null): { cls: ClassFile; m: MethodInfo } | undefined => {
      if (!n || seen.has(n)) return undefined
      seen.add(n)
      const c = this.source.load(n)
      if (!c) return undefined
      const m = c.method(name, desc)
      if (m?.code) return { cls: c, m }
      return walk(c.superName) ?? c.interfaces.map((i) => walk(i)).find(Boolean)
    }
    return walk(cls)
  }

  // ---------- statics ----------
  private readStatic(ref: MemberRef): JValue {
    if (ref.owner === DIRECTION_CLASS && DIRECTIONS.includes(ref.name))
      return this.direction(ref.name)
    if (ref.owner === 'net/minecraft/util/Mth') {
      const c: Record<string, number> = {
        PI: Math.fround(Math.PI),
        HALF_PI: Math.fround(Math.PI / 2),
        TWO_PI: Math.fround(Math.PI * 2),
        DEG_TO_RAD: Math.fround(Math.PI / 180),
        RAD_TO_DEG: Math.fround(180 / Math.PI)
      }
      if (ref.name in c) return c[ref.name]!
    }
    if (!this.canInterpret(ref.owner)) {
      const cls = this.source.load(ref.owner)
      const f = cls?.field(ref.name)
      if (f?.constant !== undefined) {
        return typeof f.constant === 'bigint'
          ? new JLong(f.constant)
          : (f.constant as number | string)
      }
      // A constant of its own type in a class we do not run (EquipmentSlot.HEAD...): a symbolic enum value,
      // equal only to itself, so maps and sets keyed by it still work.
      if (ref.desc === `L${ref.owner};` && /^[A-Z][A-Z0-9_]*$/.test(ref.name)) {
        const key = `${ref.owner}.${ref.name}`
        let e = this.enums.get(key)
        if (!e) {
          e = new JEnum(ref.owner, ref.name, -1)
          this.enums.set(key, e)
        }
        return e
      }
      return opaqueFor(ref.desc)
    }
    this.ensureInit(ref.owner)
    // Inherited statics: look up the declaring class.
    let n: string | null = ref.owner
    while (n) {
      const map = this.statics.get(n)
      if (map?.has(ref.name)) return map.get(ref.name)!
      n = this.source.load(n)?.superName ?? null
      if (n) this.ensureInit(n)
    }
    return opaqueFor(ref.desc)
  }

  private writeStatic(ref: MemberRef, value: JValue, assigned?: Set<string>): void {
    if (!this.canInterpret(ref.owner)) return
    this.ensureInit(ref.owner)
    this.statics.get(ref.owner)?.set(ref.name, value)
    assigned?.add(ref.name)
  }

  private direction(name: string): JEnum {
    let e = this.enums.get(`${DIRECTION_CLASS}.${name}`)
    if (!e) {
      e = new JEnum(DIRECTION_CLASS, name, DIRECTIONS.indexOf(name))
      this.enums.set(`${DIRECTION_CLASS}.${name}`, e)
    }
    return e
  }

  // ---------- calls ----------
  /**
   * Calls a method. `kind`: 'static', 'special' (constructors, private/super) or 'virtual' (also interface).
   * Returns the value (undefined for void). Aborts of interpreted callees become OPAQUE here.
   */
  private call(
    ref: MemberRef,
    kind: 'static' | 'special' | 'virtual',
    receiver: JValue | null,
    args: JValue[]
  ): JValue | undefined {
    const { ret } = parseMethodDescriptor(ref.desc)
    const fail = (): JValue | undefined => (ret === 'V' ? undefined : opaqueFor(ret))

    // Lambdas: any interface method call on a lambda runs its implementation.
    if (kind === 'virtual' && receiver instanceof Lambda) {
      if (ref.owner === 'java/lang/Object') return fail()
      return this.callHandle(receiver.impl, [...receiver.captured, ...args], ret)
    }
    if (receiver instanceof Opaque) return fail()
    if (kind !== 'static' && receiver === null) {
      this.options.onAbort?.(`${ref.owner}.${ref.name}`, 'null receiver')
      throw new InterpAbort('NullPointerException')
    }

    const hosted = this.host(ref, kind, receiver, args)
    if (hosted !== NOT_HANDLED) return hosted

    let target: { cls: ClassFile; m: MethodInfo } | undefined
    if (kind === 'virtual' && receiver instanceof JObject) {
      target = this.resolve(receiver.cls, ref.name, ref.desc)
    } else {
      if (kind === 'static') this.ensureInit(ref.owner)
      target = this.resolve(ref.owner, ref.name, ref.desc)
    }
    if (!target || !this.interpretable(target.cls.name)) {
      // Object/Record constructors and unknown library code.
      if (ref.name === '<init>') return undefined
      return fail()
    }
    if (kind === 'static') this.ensureInit(target.cls.name)
    const locals = kind === 'static' ? args : [receiver, ...args]
    try {
      return this.execute(target.cls, target.m, locals)
    } catch (err) {
      if (err instanceof BudgetExceeded) throw err
      this.options.onAbort?.(`${target.cls.name}.${ref.name}${ref.desc}`, (err as Error).message)
      return fail()
    }
  }

  private callHandle(h: MethodHandleRef, args: JValue[], ret: string): JValue | undefined {
    switch (h.kind) {
      case 6: // invokestatic
        return this.call(h, 'static', null, args)
      case 5: // invokevirtual
      case 9: // invokeinterface
        return this.call(h, 'virtual', args[0] ?? null, args.slice(1))
      case 7: // invokespecial
        return this.call(h, 'special', args[0] ?? null, args.slice(1))
      case 8: {
        // newInvokeSpecial: constructor reference
        const obj = this.newObject(h.owner)
        this.call(h, 'special', obj, args)
        return obj
      }
      default:
        return ret === 'V' ? undefined : OPAQUE
    }
  }

  private newObject(cls: string): JValue {
    if (cls === 'org/joml/Vector3f' || cls === 'net/minecraft/resources/Identifier')
      return new JObject(cls)
    if (cls === 'java/util/ArrayList' || cls === 'java/util/LinkedList') return new JList()
    if (
      cls === 'java/util/HashMap' ||
      cls === 'java/util/LinkedHashMap' ||
      cls === 'java/util/TreeMap' ||
      cls === 'java/util/EnumMap' ||
      cls === 'java/util/IdentityHashMap'
    ) {
      return new JMap()
    }
    if (cls === 'java/util/HashSet' || cls === 'java/util/LinkedHashSet') return new JSet()
    if (cls === 'java/lang/StringBuilder') return new JStringBuilder()
    if (this.canInterpret(cls)) {
      this.ensureInit(cls)
      return new JObject(cls)
    }
    return OPAQUE
  }

  // ---------- simulated library classes ----------
  private host(
    ref: MemberRef,
    kind: 'static' | 'special' | 'virtual',
    recv: JValue | null,
    args: JValue[]
  ): HostResult {
    const { owner, name } = ref
    const a0 = args[0]
    const a1 = args[1]

    if (kind === 'special' && name === '<init>') {
      if (recv instanceof JObject && recv.cls === 'org/joml/Vector3f') {
        const v =
          args.length === 3
            ? args
            : args.length === 1 && typeof a0 === 'number'
              ? [a0, a0, a0]
              : [0, 0, 0]
        if (args.length === 1 && a0 instanceof JObject) {
          for (const k of ['x', 'y', 'z']) recv.fields.set(k, a0.get(k) ?? 0)
        } else ['x', 'y', 'z'].forEach((k, i) => recv.fields.set(k, v[i] as JValue))
        return undefined
      }
      if (recv instanceof JList || recv instanceof JMap || recv instanceof JSet) {
        if (a0 instanceof JList || a0 instanceof JSet) {
          for (const x of a0.items) {
            if (recv instanceof JList) recv.items.push(x)
            else if (recv instanceof JSet) recv.add(x)
          }
        } else if (a0 instanceof JMap && recv instanceof JMap) {
          for (const [k, v] of a0.entries) recv.put(k, v)
        }
        return undefined
      }
      if (recv instanceof JStringBuilder) {
        if (typeof a0 === 'string') recv.s = a0
        return undefined
      }
      if (
        owner === 'java/lang/Object' ||
        owner === 'java/lang/Record' ||
        owner === 'java/lang/Enum'
      ) {
        return undefined
      }
    }

    // Value-ish receivers.
    if (kind === 'virtual' && typeof recv === 'number') {
      if (/^(float|int|double|long|short|byte)Value$/.test(name)) {
        return name === 'longValue'
          ? new JLong(BigInt(Math.trunc(recv)))
          : name === 'doubleValue'
            ? new JDouble(recv)
            : recv
      }
      if (name === 'booleanValue') return recv
      if (name === 'equals') return recv === a0 ? 1 : 0
      if (name === 'hashCode') return recv | 0
    }
    if (kind === 'virtual' && typeof recv === 'string') {
      switch (name) {
        case 'hashCode':
          return javaHash(recv)
        case 'equals':
          return recv === a0 ? 1 : 0
        case 'length':
          return recv.length
        case 'isEmpty':
          return recv.length === 0 ? 1 : 0
        case 'concat':
          return typeof a0 === 'string' ? recv + a0 : OPAQUE
        case 'startsWith':
          return typeof a0 === 'string' ? (recv.startsWith(a0) ? 1 : 0) : OPAQUE
        case 'endsWith':
          return typeof a0 === 'string' ? (recv.endsWith(a0) ? 1 : 0) : OPAQUE
        case 'toString':
        case 'intern':
          return recv
      }
      return NOT_HANDLED
    }
    if (kind === 'virtual' && recv instanceof JEnum) {
      if (name === 'ordinal') return recv.ordinal >= 0 ? recv.ordinal : OPAQUE
      if (name === 'name' || name === 'toString') return recv.name
      if (name === 'equals') return recv === a0 ? 1 : 0
      if (name === 'hashCode') return recv.ordinal
      return OPAQUE_FOR_RET(ref)
    }
    if (kind === 'virtual' && recv instanceof JStringBuilder) {
      if (name === 'append') {
        if (typeof a0 === 'string' || typeof a0 === 'number') recv.s += String(a0)
        else return OPAQUE
        return recv
      }
      if (name === 'toString') return recv.s
      return OPAQUE_FOR_RET(ref)
    }

    // Boxing and math.
    if (kind === 'static') {
      if (
        name === 'valueOf' &&
        [
          'java/lang/Float',
          'java/lang/Integer',
          'java/lang/Boolean',
          'java/lang/Short',
          'java/lang/Byte',
          'java/lang/Character'
        ].includes(owner)
      ) {
        return a0 ?? null
      }
      if (owner === 'java/lang/Double' && name === 'valueOf') return a0 ?? null
      if (owner === 'java/lang/Math' || owner === 'java/lang/StrictMath') {
        const d = (v: JValue | undefined): number | undefined =>
          v instanceof JDouble ? v.v : typeof v === 'number' ? v : undefined
        const x = d(a0)
        const y = d(a1)
        if (x === undefined) return OPAQUE_FOR_RET(ref)
        const isF = ref.desc.endsWith(')F')
        const isI = ref.desc.endsWith(')I')
        const out = (v: number): JValue => (isF ? Math.fround(v) : isI ? v | 0 : new JDouble(v))
        switch (name) {
          case 'sin':
            return out(Math.sin(x))
          case 'cos':
            return out(Math.cos(x))
          case 'sqrt':
            return out(Math.sqrt(x))
          case 'toRadians':
            return out((x * Math.PI) / 180)
          case 'toDegrees':
            return out((x * 180) / Math.PI)
          case 'abs':
            return out(Math.abs(x))
          case 'floor':
            return out(Math.floor(x))
          case 'ceil':
            return out(Math.ceil(x))
          case 'min':
            return y === undefined ? OPAQUE : out(Math.min(x, y))
          case 'max':
            return y === undefined ? OPAQUE : out(Math.max(x, y))
          case 'atan2':
            return y === undefined ? OPAQUE : out(Math.atan2(x, y))
        }
        return OPAQUE_FOR_RET(ref)
      }
      if (owner === 'net/minecraft/util/Mth') {
        const x = typeof a0 === 'number' ? a0 : a0 instanceof JDouble ? a0.v : undefined
        if (x === undefined) return OPAQUE_FOR_RET(ref)
        const isD = ref.desc.endsWith(')D')
        const out = (v: number): JValue => (isD ? new JDouble(v) : Math.fround(v))
        switch (name) {
          case 'sin':
            return out(Math.sin(x))
          case 'cos':
            return out(Math.cos(x))
          case 'sqrt':
            return out(Math.sqrt(x))
          case 'abs':
            return ref.desc.endsWith(')I') ? Math.abs(x) | 0 : out(Math.abs(x))
          case 'floor':
            return Math.floor(x) | 0
          case 'clamp': {
            const lo = typeof args[1] === 'number' ? args[1] : 0
            const hi = typeof args[2] === 'number' ? args[2] : 0
            return ref.desc.endsWith(')I')
              ? Math.min(Math.max(x, lo), hi) | 0
              : out(Math.min(Math.max(x, lo), hi))
          }
        }
        return OPAQUE_FOR_RET(ref)
      }
      if (owner === 'java/util/Objects' && name === 'requireNonNull') return a0 ?? null
      if (
        owner === 'net/minecraft/util/Util' &&
        name === 'allOfEnumExcept' &&
        a0 instanceof JEnum
      ) {
        if (a0.cls !== DIRECTION_CLASS) return OPAQUE
        const s = new JSet()
        for (const d of DIRECTIONS) if (d !== a0.name) s.add(this.direction(d))
        return s
      }
      if (owner === 'net/minecraft/util/Util' && name === 'make' && args.length === 2) {
        if (a1 instanceof Lambda) this.callHandle(a1.impl, [...a1.captured, a0 ?? null], 'V')
        return a0 ?? null
      }
      if (owner === 'net/minecraft/resources/Identifier') {
        const make = (ns: string, path: string): JObject => {
          const id = new JObject('net/minecraft/resources/Identifier')
          id.fields.set('namespace', ns)
          id.fields.set('path', path)
          return id
        }
        if (name === 'withDefaultNamespace' && typeof a0 === 'string') return make('minecraft', a0)
        if (name === 'fromNamespaceAndPath' && typeof a0 === 'string' && typeof a1 === 'string') {
          return make(a0, a1)
        }
        if (name === 'parse' && typeof a0 === 'string') {
          const [ns, path] = a0.includes(':') ? a0.split(':', 2) : ['minecraft', a0]
          return make(ns!, path!)
        }
        return OPAQUE_FOR_RET(ref)
      }
      if (
        owner === 'net/minecraft/util/RandomSource' &&
        (name === 'create' || name === 'createThreadLocalInstance') &&
        a0 instanceof JLong
      ) {
        return new JRandom(a0.v)
      }
      if (owner === DIRECTION_CLASS && name === 'values') {
        return new JArray(
          `L${DIRECTION_CLASS};`,
          DIRECTIONS.map((d) => this.direction(d))
        )
      }
      // Collections factories.
      const listLike = (items: JValue[]): JList => new JList([...items])
      // Varargs factories: a trailing array parameter holds the remaining elements (Guava's of(e1, ..., e6, E...)).
      const varargs = (): JValue[] => {
        const { params } = parseMethodDescriptor(ref.desc)
        const last = args[args.length - 1]
        if (params[params.length - 1]?.startsWith('[') && last instanceof JArray) {
          return [...args.slice(0, -1), ...last.items]
        }
        return args
      }
      if (
        (owner === 'java/util/List' && (name === 'of' || name === 'copyOf')) ||
        (owner === 'com/google/common/collect/ImmutableList' &&
          (name === 'of' || name === 'copyOf')) ||
        (owner === 'com/google/common/collect/Lists' && name === 'newArrayList') ||
        (owner === 'java/util/Arrays' && name === 'asList')
      ) {
        if (
          name === 'copyOf' ||
          (name === 'newArrayList' && (a0 instanceof JList || a0 instanceof JSet))
        ) {
          return a0 instanceof JList || a0 instanceof JSet ? listLike(a0.items) : OPAQUE
        }
        return listLike(varargs())
      }
      if (
        (owner === 'java/util/Set' && (name === 'of' || name === 'copyOf')) ||
        (owner === 'com/google/common/collect/ImmutableSet' &&
          (name === 'of' || name === 'copyOf')) ||
        (owner === 'com/google/common/collect/Sets' && name === 'newHashSet') ||
        (owner === 'java/util/EnumSet' &&
          ['of', 'noneOf', 'copyOf', 'allOf', 'complementOf'].includes(name))
      ) {
        const s = new JSet()
        if (owner === 'java/util/EnumSet' && name === 'noneOf') return s
        if (owner === 'java/util/EnumSet' && (name === 'allOf' || name === 'complementOf')) {
          // Only Direction sets are expected here.
          const all = DIRECTIONS.map((d) => this.direction(d))
          const exclude = name === 'complementOf' && a0 instanceof JSet ? a0.items : []
          for (const d of all) if (!exclude.includes(d)) s.add(d)
          return s
        }
        const items =
          name === 'copyOf' ||
          (name === 'newHashSet' && (a0 instanceof JList || a0 instanceof JSet))
            ? a0 instanceof JList || a0 instanceof JSet
              ? a0.items
              : null
            : varargs()
        if (!items) return OPAQUE
        for (const x of items) s.add(x)
        return s
      }
      if (
        (owner === 'com/google/common/collect/Maps' &&
          (name === 'newHashMap' || name === 'newLinkedHashMap' || name === 'newEnumMap')) ||
        (owner === 'java/util/Map' && name === 'of') ||
        (owner === 'com/google/common/collect/ImmutableMap' && name === 'of')
      ) {
        const m = new JMap()
        for (let i = 0; i + 1 < args.length; i += 2) m.put(args[i]!, args[i + 1]!)
        return m
      }
      if (owner === 'com/google/common/collect/ImmutableMap' && name === 'builder')
        return new JBuilder('map')
      if (owner === 'com/google/common/collect/ImmutableList' && name === 'builder')
        return new JBuilder('list')
      if (owner === 'com/google/common/collect/ImmutableSet' && name === 'builder')
        return new JBuilder('set')
    }

    // Collection instances.
    if (kind === 'virtual') {
      if (recv instanceof JList) {
        switch (name) {
          case 'add':
            if (args.length === 2 && typeof a0 === 'number') recv.items.splice(a0, 0, a1 ?? null)
            else recv.items.push(a0 ?? null)
            return ref.desc.endsWith(')Z') ? 1 : undefined
          case 'addAll':
            if (a0 instanceof JList || a0 instanceof JSet) recv.items.push(...a0.items)
            else return OPAQUE
            return 1
          case 'get':
            return typeof a0 === 'number' ? (recv.items[a0] ?? null) : OPAQUE
          case 'set':
            if (typeof a0 !== 'number') return OPAQUE
            recv.items[a0] = a1 ?? null
            return null
          case 'size':
            return recv.items.length
          case 'isEmpty':
            return recv.items.length === 0 ? 1 : 0
          case 'contains':
            return recv.items.some((x) => jEquals(x, a0 ?? null)) ? 1 : 0
          case 'iterator':
            return new JIterator([...recv.items])
          case 'clear':
            recv.items.length = 0
            return undefined
          case 'forEach':
            if (a0 instanceof Lambda)
              for (const x of [...recv.items]) this.callHandle(a0.impl, [...a0.captured, x], 'V')
            return undefined
          case 'toArray':
            return new JArray('Ljava/lang/Object;', [...recv.items])
        }
        return OPAQUE_FOR_RET(ref)
      }
      if (recv instanceof JSet) {
        switch (name) {
          case 'add':
            return recv.add(a0 ?? null) ? 1 : 0
          case 'addAll':
            if (!(a0 instanceof JList || a0 instanceof JSet)) return OPAQUE
            for (const x of a0.items) recv.add(x)
            return 1
          case 'contains':
            return recv.items.some((x) => jEquals(x, a0 ?? null)) ? 1 : 0
          case 'remove': {
            const i = recv.items.findIndex((x) => jEquals(x, a0 ?? null))
            if (i >= 0) recv.items.splice(i, 1)
            return i >= 0 ? 1 : 0
          }
          case 'size':
            return recv.items.length
          case 'isEmpty':
            return recv.items.length === 0 ? 1 : 0
          case 'iterator':
            return new JIterator([...recv.items])
          case 'forEach':
            if (a0 instanceof Lambda)
              for (const x of [...recv.items]) this.callHandle(a0.impl, [...a0.captured, x], 'V')
            return undefined
        }
        return OPAQUE_FOR_RET(ref)
      }
      if (recv instanceof JMap) {
        switch (name) {
          case 'put':
            return recv.put(a0 ?? null, a1 ?? null)
          case 'putAll':
            if (!(a0 instanceof JMap)) return OPAQUE
            for (const [k, v] of a0.entries) recv.put(k, v)
            return undefined
          case 'get':
            return recv.get(a0 ?? null)
          case 'getOrDefault': {
            const i = recv.find(a0 ?? null)
            return i < 0 ? (a1 ?? null) : recv.entries[i]![1]
          }
          case 'containsKey':
            return recv.find(a0 ?? null) >= 0 ? 1 : 0
          case 'remove': {
            const i = recv.find(a0 ?? null)
            if (i < 0) return null
            return recv.entries.splice(i, 1)[0]![1]
          }
          case 'size':
            return recv.entries.length
          case 'isEmpty':
            return recv.entries.length === 0 ? 1 : 0
          case 'keySet': {
            const s = new JSet()
            for (const [k] of recv.entries) s.add(k)
            return s
          }
          case 'values':
            return new JList(recv.entries.map(([, v]) => v))
          case 'entrySet': {
            // Entries read through to the map (setValue writes back), like java.util.HashMap.
            const s = new JSet()
            for (const [k] of recv.entries) s.items.push(new JEntry(recv, k))
            return s
          }
          case 'forEach':
            if (a0 instanceof Lambda) {
              for (const [k, v] of [...recv.entries])
                this.callHandle(a0.impl, [...a0.captured, k, v], 'V')
            }
            return undefined
          case 'computeIfAbsent': {
            const i = recv.find(a0 ?? null)
            if (i >= 0) return recv.entries[i]![1]
            if (!(a1 instanceof Lambda)) return OPAQUE
            const v =
              this.callHandle(a1.impl, [...a1.captured, a0 ?? null], 'Ljava/lang/Object;') ?? null
            recv.put(a0 ?? null, v)
            return v
          }
        }
        return OPAQUE_FOR_RET(ref)
      }
      if (recv instanceof JRandom) {
        if (
          name === 'nextInt' &&
          args.length <= 1 &&
          (a0 === undefined || typeof a0 === 'number')
        ) {
          return recv.nextInt(a0)
        }
        if (
          name === 'nextInt' &&
          args.length === 2 &&
          typeof a0 === 'number' &&
          typeof a1 === 'number'
        ) {
          return a0 >= a1 ? OPAQUE : a0 + recv.nextInt(a1 - a0)
        }
        if (name === 'nextFloat') return recv.nextFloat()
        if (name === 'nextBoolean') return recv.next(1) !== 0 ? 1 : 0
        return OPAQUE_FOR_RET(ref)
      }
      if (recv instanceof JEntry) {
        if (name === 'getKey') return recv.key
        if (name === 'getValue') return recv.map.get(recv.key)
        if (name === 'setValue') return recv.map.put(recv.key, a0 ?? null)
        return OPAQUE_FOR_RET(ref)
      }
      if (recv instanceof JIterator) {
        if (name === 'hasNext') return recv.pos < recv.items.length ? 1 : 0
        if (name === 'next') {
          if (recv.pos >= recv.items.length) throw new InterpAbort('NoSuchElementException')
          return recv.items[recv.pos++]!
        }
        return OPAQUE_FOR_RET(ref)
      }
      if (recv instanceof JBuilder) {
        switch (name) {
          case 'put':
            recv.map.put(a0 ?? null, a1 ?? null)
            this.options.onMapBuilderPut?.(a0 ?? null, a1 ?? null)
            return recv
          case 'putAll':
            if (a0 instanceof JMap) {
              for (const [k, v] of a0.entries) {
                recv.map.put(k, v)
                this.options.onMapBuilderPut?.(k, v)
              }
              return recv
            }
            return OPAQUE
          case 'add':
            if (args.length === 1 && a0 instanceof JArray) recv.list.push(...a0.items)
            else recv.list.push(...args)
            return recv
          case 'addAll':
            if (a0 instanceof JList || a0 instanceof JSet) recv.list.push(...a0.items)
            return recv
          case 'build':
          case 'buildOrThrow':
          case 'buildKeepingLast': {
            if (recv.kind === 'map') {
              const m = new JMap()
              for (const [k, v] of recv.map.entries) m.put(k, v)
              return m
            }
            if (recv.kind === 'set') {
              const s = new JSet()
              for (const x of recv.list) s.add(x)
              return s
            }
            return new JList([...recv.list])
          }
        }
        return OPAQUE_FOR_RET(ref)
      }
      if (recv instanceof JObject && recv.cls === 'org/joml/Vector3f') {
        if (['x', 'y', 'z'].includes(name) && args.length === 0) return recv.get(name) ?? 0
        return OPAQUE_FOR_RET(ref)
      }
      if (recv instanceof JObject && recv.cls === 'net/minecraft/resources/Identifier') {
        if (name === 'getPath') return recv.get('path') ?? OPAQUE
        if (name === 'getNamespace') return recv.get('namespace') ?? OPAQUE
        if (name === 'equals') return jEquals(recv, a0 ?? null) ? 1 : 0
        return OPAQUE_FOR_RET(ref)
      }
      if (
        recv instanceof JObject &&
        (name === 'hashCode' || name === 'equals' || name === 'toString')
      ) {
        // Records: ObjectMethods bootstraps are not interpreted; give stable answers.
        if (name === 'equals') return jEquals(recv, a0 ?? null) ? 1 : 0
        const target = this.resolve(recv.cls, name, ref.desc)
        if (!target || target.cls.isInterface) return name === 'hashCode' ? 0 : OPAQUE
      }
    }
    return NOT_HANDLED
  }

  // ---------- the bytecode loop ----------
  private execute(
    cls: ClassFile,
    method: MethodInfo,
    args: JValue[],
    assignedStatics?: Set<string>
  ): JValue | undefined {
    const code = method.code!
    if (++this.depth > this.maxDepth) {
      this.depth--
      throw new InterpAbort('max depth')
    }
    try {
      return this.run(cls, method, code.code, code.maxLocals, args, assignedStatics)
    } finally {
      this.depth--
    }
  }

  private run(
    cls: ClassFile,
    method: MethodInfo,
    code: Uint8Array,
    maxLocals: number,
    args: JValue[],
    assignedStatics?: Set<string>
  ): JValue | undefined {
    // Lay out arguments in local slots (long/double take two).
    const locals: (JValue | undefined)[] = new Array(Math.max(maxLocals, args.length * 2))
    {
      const { params } = parseMethodDescriptor(method.desc)
      const isStatic = (method.access & ACC_STATIC) !== 0
      let slot = 0
      let ai = 0
      if (!isStatic) locals[slot++] = args[ai++] ?? null
      for (const p of params) {
        locals[slot] = args[ai++] ?? defaultFor(p)
        slot += isWide(p) ? 2 : 1
      }
    }
    const stack: JValue[] = []
    const view = new DataView(code.buffer, code.byteOffset, code.byteLength)
    let pc = 0
    const u1 = (): number => code[pc++]!
    const s1 = (): number => view.getInt8(pc++)
    const u2 = (): number => {
      const v = view.getUint16(pc)
      pc += 2
      return v
    }
    const s2 = (): number => {
      const v = view.getInt16(pc)
      pc += 2
      return v
    }
    const s4 = (): number => {
      const v = view.getInt32(pc)
      pc += 4
      return v
    }
    /** A local slot; `null` is a real value, only never-written slots are unknown. */
    const load = (i: number, wide = false): JValue => {
      const v = locals[i]
      return v === undefined ? (wide ? OPAQUE_WIDE : OPAQUE) : v
    }
    const pop = (): JValue => {
      if (stack.length === 0) throw new InterpAbort('stack underflow')
      return stack.pop()!
    }
    const num = (): number => {
      const v = pop()
      if (typeof v !== 'number')
        throw new InterpAbort(v instanceof Opaque ? 'unknown number' : 'not a number')
      return v
    }
    const lng = (): bigint => {
      const v = pop()
      if (!(v instanceof JLong)) throw new InterpAbort('unknown long')
      return v.v
    }
    const dbl = (): number => {
      const v = pop()
      if (!(v instanceof JDouble)) throw new InterpAbort('unknown double')
      return v.v
    }
    /** Numeric pop that tolerates unknowns (arithmetic on unknowns gives unknowns). */
    const numOrOpaque = (): number | Opaque => {
      const v = pop()
      if (typeof v === 'number') return v
      if (v instanceof Opaque) return v
      throw new InterpAbort('not a number')
    }
    const binF = (f: (a: number, b: number) => number): void => {
      const b = numOrOpaque()
      const a = numOrOpaque()
      stack.push(a instanceof Opaque || b instanceof Opaque ? OPAQUE : f(a, b))
    }
    const binI = (f: (a: number, b: number) => number): void => binF((a, b) => f(a, b) | 0)
    const binL = (f: (a: bigint, b: bigint) => bigint): void => {
      const b = pop()
      const a = pop()
      if (!(a instanceof JLong) || !(b instanceof JLong)) {
        stack.push(OPAQUE_WIDE)
        return
      }
      stack.push(new JLong(BigInt.asIntN(64, f(a.v, b.v))))
    }
    const binD = (f: (a: number, b: number) => number): void => {
      const b = pop()
      const a = pop()
      if (!(a instanceof JDouble) || !(b instanceof JDouble)) {
        stack.push(OPAQUE_WIDE)
        return
      }
      stack.push(new JDouble(f(a.v, b.v)))
    }
    const fr = Math.fround
    const branch = (cond: boolean, offset: number, start: number): void => {
      if (cond) pc = start + offset
    }
    const ldc = (index: number): void => {
      const c = cls.constant(index)
      switch (c.tag) {
        case 'int':
        case 'float':
          stack.push(c.value)
          return
        case 'long':
          stack.push(new JLong(c.value))
          return
        case 'double':
          stack.push(new JDouble(c.value))
          return
        case 'string':
          stack.push(cls.utf8(c.utf8))
          return
        default:
          stack.push(OPAQUE) // class literals, method types, dynamic constants
      }
    }
    const invoke = (ref: MemberRef, kind: 'static' | 'special' | 'virtual'): void => {
      const { params, ret } = parseMethodDescriptor(ref.desc)
      const args: JValue[] = new Array(params.length)
      for (let i = params.length - 1; i >= 0; i--) args[i] = pop()
      const receiver = kind === 'static' ? null : pop()
      const result = this.call(ref, kind, receiver, args)
      if (ret !== 'V') stack.push(result === undefined ? opaqueFor(ret) : result)
    }

    for (;;) {
      if (++this.steps > this.maxSteps) throw new BudgetExceeded('instruction budget exhausted')
      const start = pc
      if (pc >= code.length) throw new InterpAbort('fell off the end of the code')
      const op = u1()
      switch (op) {
        case 0x00: // nop
          break
        case 0x01:
          stack.push(null)
          break
        case 0x02:
        case 0x03:
        case 0x04:
        case 0x05:
        case 0x06:
        case 0x07:
        case 0x08:
          stack.push(op - 0x03)
          break
        case 0x09:
        case 0x0a:
          stack.push(new JLong(BigInt(op - 0x09)))
          break
        case 0x0b:
        case 0x0c:
        case 0x0d:
          stack.push(op - 0x0b)
          break
        case 0x0e:
        case 0x0f:
          stack.push(new JDouble(op - 0x0e))
          break
        case 0x10:
          stack.push(s1())
          break
        case 0x11:
          stack.push(s2())
          break
        case 0x12:
          ldc(u1())
          break
        case 0x13:
        case 0x14:
          ldc(u2())
          break
        // loads
        case 0x15:
        case 0x16:
        case 0x17:
        case 0x18:
        case 0x19:
          stack.push(load(u1()))
          break
        case 0x1a:
        case 0x1b:
        case 0x1c:
        case 0x1d:
          stack.push(load(op - 0x1a))
          break
        case 0x1e:
        case 0x1f:
        case 0x20:
        case 0x21:
          stack.push(load(op - 0x1e, true))
          break
        case 0x22:
        case 0x23:
        case 0x24:
        case 0x25:
          stack.push(load(op - 0x22))
          break
        case 0x26:
        case 0x27:
        case 0x28:
        case 0x29:
          stack.push(load(op - 0x26, true))
          break
        case 0x2a:
        case 0x2b:
        case 0x2c:
        case 0x2d:
          stack.push(load(op - 0x2a))
          break
        // array loads
        case 0x2e:
        case 0x2f:
        case 0x30:
        case 0x31:
        case 0x32:
        case 0x33:
        case 0x34:
        case 0x35: {
          const i = pop()
          const arr = pop()
          if (arr instanceof Opaque) {
            stack.push(op === 0x2f || op === 0x31 ? OPAQUE_WIDE : OPAQUE)
            break
          }
          if (!(arr instanceof JArray) || typeof i !== 'number')
            throw new InterpAbort('bad array load')
          if (i < 0 || i >= arr.items.length)
            throw new InterpAbort('ArrayIndexOutOfBoundsException')
          stack.push(arr.items[i]!)
          break
        }
        // stores
        case 0x36:
        case 0x37:
        case 0x38:
        case 0x39:
        case 0x3a:
          locals[u1()] = pop()
          break
        case 0x3b:
        case 0x3c:
        case 0x3d:
        case 0x3e:
          locals[op - 0x3b] = pop()
          break
        case 0x3f:
        case 0x40:
        case 0x41:
        case 0x42:
          locals[op - 0x3f] = pop()
          break
        case 0x43:
        case 0x44:
        case 0x45:
        case 0x46:
          locals[op - 0x43] = pop()
          break
        case 0x47:
        case 0x48:
        case 0x49:
        case 0x4a:
          locals[op - 0x47] = pop()
          break
        case 0x4b:
        case 0x4c:
        case 0x4d:
        case 0x4e:
          locals[op - 0x4b] = pop()
          break
        // array stores
        case 0x4f:
        case 0x50:
        case 0x51:
        case 0x52:
        case 0x53:
        case 0x54:
        case 0x55:
        case 0x56: {
          const v = pop()
          const i = pop()
          const arr = pop()
          if (arr instanceof Opaque) break
          if (!(arr instanceof JArray) || typeof i !== 'number')
            throw new InterpAbort('bad array store')
          if (i < 0 || i >= arr.items.length)
            throw new InterpAbort('ArrayIndexOutOfBoundsException')
          arr.items[i] = op === 0x54 && typeof v === 'number' ? (v << 24) >> 24 : v
          break
        }
        // stack
        case 0x57:
          pop()
          break
        case 0x58: {
          const v = pop()
          if (!wideValue(v)) pop()
          break
        }
        case 0x59: {
          const v = pop()
          stack.push(v, v)
          break
        }
        case 0x5a: {
          const v1 = pop()
          const v2 = pop()
          stack.push(v1, v2, v1)
          break
        }
        case 0x5b: {
          const v1 = pop()
          const v2 = pop()
          if (wideValue(v2)) stack.push(v1, v2, v1)
          else {
            const v3 = pop()
            stack.push(v1, v3, v2, v1)
          }
          break
        }
        case 0x5c: {
          const v1 = pop()
          if (wideValue(v1)) stack.push(v1, v1)
          else {
            const v2 = pop()
            stack.push(v2, v1, v2, v1)
          }
          break
        }
        case 0x5d: {
          const v1 = pop()
          if (wideValue(v1)) {
            const v2 = pop()
            stack.push(v1, v2, v1)
          } else {
            const v2 = pop()
            const v3 = pop()
            stack.push(v2, v1, v3, v2, v1)
          }
          break
        }
        case 0x5e: {
          const v1 = pop()
          if (wideValue(v1)) {
            const v2 = pop()
            if (wideValue(v2)) stack.push(v1, v2, v1)
            else {
              const v3 = pop()
              stack.push(v1, v3, v2, v1)
            }
          } else {
            const v2 = pop()
            const v3 = pop()
            if (wideValue(v3)) stack.push(v2, v1, v3, v2, v1)
            else {
              const v4 = pop()
              stack.push(v2, v1, v4, v3, v2, v1)
            }
          }
          break
        }
        case 0x5f: {
          const v1 = pop()
          const v2 = pop()
          stack.push(v1, v2)
          break
        }
        // arithmetic
        case 0x60:
          binI((a, b) => a + b)
          break
        case 0x61:
          binL((a, b) => a + b)
          break
        case 0x62:
          binF((a, b) => fr(a + b))
          break
        case 0x63:
          binD((a, b) => a + b)
          break
        case 0x64:
          binI((a, b) => a - b)
          break
        case 0x65:
          binL((a, b) => a - b)
          break
        case 0x66:
          binF((a, b) => fr(a - b))
          break
        case 0x67:
          binD((a, b) => a - b)
          break
        case 0x68:
          binF((a, b) => Math.imul(a, b))
          break
        case 0x69:
          binL((a, b) => a * b)
          break
        case 0x6a:
          binF((a, b) => fr(a * b))
          break
        case 0x6b:
          binD((a, b) => a * b)
          break
        case 0x6c:
          binI((a, b) => {
            if (b === 0) throw new InterpAbort('ArithmeticException')
            return Math.trunc(a / b)
          })
          break
        case 0x6d:
          binL((a, b) => {
            if (b === 0n) throw new InterpAbort('ArithmeticException')
            return a / b
          })
          break
        case 0x6e:
          binF((a, b) => fr(a / b))
          break
        case 0x6f:
          binD((a, b) => a / b)
          break
        case 0x70:
          binI((a, b) => {
            if (b === 0) throw new InterpAbort('ArithmeticException')
            return a % b
          })
          break
        case 0x71:
          binL((a, b) => {
            if (b === 0n) throw new InterpAbort('ArithmeticException')
            return a % b
          })
          break
        case 0x72:
          binF((a, b) => fr(a % b))
          break
        case 0x73:
          binD((a, b) => a % b)
          break
        case 0x74: {
          const v = numOrOpaque()
          stack.push(v instanceof Opaque ? v : -v | 0)
          break
        }
        case 0x75: {
          const v = pop()
          stack.push(v instanceof JLong ? new JLong(BigInt.asIntN(64, -v.v)) : OPAQUE_WIDE)
          break
        }
        case 0x76: {
          const v = numOrOpaque()
          stack.push(v instanceof Opaque ? v : -v)
          break
        }
        case 0x77: {
          const v = pop()
          stack.push(v instanceof JDouble ? new JDouble(-v.v) : OPAQUE_WIDE)
          break
        }
        case 0x78:
          binI((a, b) => a << (b & 31))
          break
        case 0x79: {
          const s = num()
          const v = pop()
          stack.push(
            v instanceof JLong ? new JLong(BigInt.asIntN(64, v.v << BigInt(s & 63))) : OPAQUE_WIDE
          )
          break
        }
        case 0x7a:
          binI((a, b) => a >> (b & 31))
          break
        case 0x7b: {
          const s = num()
          const v = pop()
          stack.push(v instanceof JLong ? new JLong(v.v >> BigInt(s & 63)) : OPAQUE_WIDE)
          break
        }
        case 0x7c:
          binI((a, b) => a >>> (b & 31))
          break
        case 0x7d: {
          const s = num()
          const v = pop()
          stack.push(
            v instanceof JLong
              ? new JLong(BigInt.asIntN(64, BigInt.asUintN(64, v.v) >> BigInt(s & 63)))
              : OPAQUE_WIDE
          )
          break
        }
        case 0x7e:
          binI((a, b) => a & b)
          break
        case 0x7f:
          binL((a, b) => a & b)
          break
        case 0x80:
          binI((a, b) => a | b)
          break
        case 0x81:
          binL((a, b) => a | b)
          break
        case 0x82:
          binI((a, b) => a ^ b)
          break
        case 0x83:
          binL((a, b) => a ^ b)
          break
        case 0x84: {
          const idx = u1()
          const inc = s1()
          const v = locals[idx]
          locals[idx] = typeof v === 'number' ? (v + inc) | 0 : OPAQUE
          break
        }
        // conversions
        case 0x85: {
          const v = numOrOpaque()
          stack.push(v instanceof Opaque ? OPAQUE_WIDE : new JLong(BigInt(v)))
          break
        }
        case 0x86: {
          const v = numOrOpaque()
          stack.push(v instanceof Opaque ? v : fr(v))
          break
        }
        case 0x87: {
          const v = numOrOpaque()
          stack.push(v instanceof Opaque ? OPAQUE_WIDE : new JDouble(v))
          break
        }
        case 0x88: {
          const v = pop()
          stack.push(v instanceof JLong ? Number(BigInt.asIntN(32, v.v)) : OPAQUE)
          break
        }
        case 0x89: {
          const v = pop()
          stack.push(v instanceof JLong ? fr(Number(v.v)) : OPAQUE)
          break
        }
        case 0x8a: {
          const v = pop()
          stack.push(v instanceof JLong ? new JDouble(Number(v.v)) : OPAQUE_WIDE)
          break
        }
        case 0x8b:
        case 0x8e: {
          const v = op === 0x8b ? numOrOpaque() : pop()
          const x = v instanceof JDouble ? v.v : v
          if (typeof x !== 'number') {
            stack.push(OPAQUE)
            break
          }
          stack.push(
            Number.isNaN(x) ? 0 : Math.max(-2147483648, Math.min(2147483647, Math.trunc(x)))
          )
          break
        }
        case 0x8c:
        case 0x8f: {
          const v = op === 0x8c ? numOrOpaque() : pop()
          const x = v instanceof JDouble ? v.v : v
          if (typeof x !== 'number') {
            stack.push(OPAQUE_WIDE)
            break
          }
          stack.push(
            new JLong(
              Number.isNaN(x) ? 0n : BigInt(Math.trunc(Math.max(-9.2e18, Math.min(9.2e18, x))))
            )
          )
          break
        }
        case 0x8d: {
          const v = numOrOpaque()
          stack.push(v instanceof Opaque ? OPAQUE_WIDE : new JDouble(v))
          break
        }
        case 0x90: {
          const v = pop()
          stack.push(v instanceof JDouble ? fr(v.v) : OPAQUE)
          break
        }
        case 0x91: {
          const v = numOrOpaque()
          stack.push(v instanceof Opaque ? v : (v << 24) >> 24)
          break
        }
        case 0x92: {
          const v = numOrOpaque()
          stack.push(v instanceof Opaque ? v : v & 0xffff)
          break
        }
        case 0x93: {
          const v = numOrOpaque()
          stack.push(v instanceof Opaque ? v : (v << 16) >> 16)
          break
        }
        // comparisons
        case 0x94: {
          const b = lng()
          const a = lng()
          stack.push(a < b ? -1 : a > b ? 1 : 0)
          break
        }
        case 0x95:
        case 0x96: {
          const b = num()
          const a = num()
          stack.push(
            Number.isNaN(a) || Number.isNaN(b) ? (op === 0x95 ? -1 : 1) : a < b ? -1 : a > b ? 1 : 0
          )
          break
        }
        case 0x97:
        case 0x98: {
          const b = dbl()
          const a = dbl()
          stack.push(
            Number.isNaN(a) || Number.isNaN(b) ? (op === 0x97 ? -1 : 1) : a < b ? -1 : a > b ? 1 : 0
          )
          break
        }
        case 0x99:
        case 0x9a:
        case 0x9b:
        case 0x9c:
        case 0x9d:
        case 0x9e: {
          const off = s2()
          const v = num()
          const c = [v === 0, v !== 0, v < 0, v >= 0, v > 0, v <= 0][op - 0x99]!
          branch(c, off, start)
          break
        }
        case 0x9f:
        case 0xa0:
        case 0xa1:
        case 0xa2:
        case 0xa3:
        case 0xa4: {
          const off = s2()
          const b = num()
          const a = num()
          const c = [a === b, a !== b, a < b, a >= b, a > b, a <= b][op - 0x9f]!
          branch(c, off, start)
          break
        }
        case 0xa5:
        case 0xa6: {
          const off = s2()
          const b = pop()
          const a = pop()
          if (a instanceof Opaque || b instanceof Opaque)
            throw new InterpAbort('unknown reference comparison')
          branch(op === 0xa5 ? a === b : a !== b, off, start)
          break
        }
        case 0xa7:
          pc = start + s2()
          break
        case 0xa8:
        case 0xa9:
          throw new InterpAbort('jsr/ret')
        case 0xaa: {
          // tableswitch
          pc = start + 1 + ((4 - ((start + 1) % 4)) % 4)
          const def = s4()
          const lo = s4()
          const hi = s4()
          const key = num()
          if (key < lo || key > hi) pc = start + def
          else {
            const at = pc + (key - lo) * 4
            pc = start + view.getInt32(at)
          }
          break
        }
        case 0xab: {
          // lookupswitch
          pc = start + 1 + ((4 - ((start + 1) % 4)) % 4)
          const def = s4()
          const n = s4()
          const key = num()
          let target = start + def
          for (let i = 0; i < n; i++) {
            const k = s4()
            const off = s4()
            if (k === key) target = start + off
          }
          pc = target
          break
        }
        case 0xac:
        case 0xad:
        case 0xae:
        case 0xaf:
        case 0xb0:
          return pop()
        case 0xb1:
          return undefined
        case 0xb2: {
          const ref = cls.memberRef(u2())
          stack.push(this.readStatic(ref))
          break
        }
        case 0xb3: {
          const ref = cls.memberRef(u2())
          this.writeStatic(ref, pop(), ref.owner === cls.name ? assignedStatics : undefined)
          break
        }
        case 0xb4: {
          const ref = cls.memberRef(u2())
          const obj = pop()
          if (obj instanceof JObject)
            stack.push(obj.fields.has(ref.name) ? obj.fields.get(ref.name)! : defaultFor(ref.desc))
          else if (obj === null) throw new InterpAbort('NullPointerException (getfield)')
          else stack.push(opaqueFor(ref.desc))
          break
        }
        case 0xb5: {
          const ref = cls.memberRef(u2())
          const v = pop()
          const obj = pop()
          if (obj instanceof JObject) obj.fields.set(ref.name, v)
          else if (obj === null) throw new InterpAbort('NullPointerException (putfield)')
          break
        }
        case 0xb6:
          invoke(cls.memberRef(u2()), 'virtual')
          break
        case 0xb7:
          invoke(cls.memberRef(u2()), 'special')
          break
        case 0xb8:
          invoke(cls.memberRef(u2()), 'static')
          break
        case 0xb9:
          invoke(cls.memberRef(u2()), 'virtual')
          pc += 2
          break
        case 0xba: {
          const index = u2()
          pc += 2
          this.invokeDynamic(cls, index, stack, pop)
          break
        }
        case 0xbb: {
          stack.push(this.newObject(cls.className(u2())))
          break
        }
        case 0xbc: {
          const type = u1()
          const n = num()
          if (n < 0 || n > 1_000_000) throw new InterpAbort('bad array size')
          const zero: JValue = type === 11 ? new JLong(0n) : type === 7 ? new JDouble(0) : 0
          stack.push(new JArray(String(type), new Array(n).fill(zero)))
          break
        }
        case 0xbd: {
          const elem = cls.className(u2())
          const n = num()
          if (n < 0 || n > 1_000_000) throw new InterpAbort('bad array size')
          stack.push(new JArray(elem, new Array(n).fill(null)))
          break
        }
        case 0xbe: {
          const arr = pop()
          if (arr instanceof JArray) stack.push(arr.items.length)
          else if (arr instanceof Opaque) stack.push(OPAQUE)
          else throw new InterpAbort('arraylength on non-array')
          break
        }
        case 0xbf:
          throw new InterpAbort('athrow')
        case 0xc0:
          pc += 2 // checkcast: trust the compiler
          break
        case 0xc1: {
          const target = cls.className(u2())
          const v = pop()
          if (v === null) stack.push(0)
          else if (v instanceof JObject) stack.push(this.isSubclass(v.cls, target) ? 1 : 0)
          else if (v instanceof Lambda) stack.push(v.iface === target ? 1 : OPAQUE)
          else stack.push(OPAQUE)
          break
        }
        case 0xc2:
        case 0xc3:
          pop() // monitorenter / monitorexit
          break
        case 0xc4: {
          // wide
          const op2 = u1()
          const idx = u2()
          if (op2 === 0x84) {
            const inc = s2()
            const v = locals[idx]
            locals[idx] = typeof v === 'number' ? (v + inc) | 0 : OPAQUE
          } else if (op2 >= 0x15 && op2 <= 0x19) stack.push(load(idx, op2 === 0x16 || op2 === 0x18))
          else if (op2 >= 0x36 && op2 <= 0x3a) locals[idx] = pop()
          else throw new InterpAbort('unsupported wide')
          break
        }
        case 0xc5: {
          const elem = cls.className(u2())
          const dims = u1()
          const sizes: number[] = []
          for (let i = 0; i < dims; i++) sizes.unshift(num())
          const make = (d: number): JArray => {
            const n = sizes[d]!
            if (n < 0 || n > 100_000) throw new InterpAbort('bad array size')
            return new JArray(
              elem,
              Array.from({ length: n }, () => (d + 1 < sizes.length ? make(d + 1) : null))
            )
          }
          stack.push(make(0))
          break
        }
        case 0xc6:
        case 0xc7: {
          const off = s2()
          const v = pop()
          if (v instanceof Opaque) throw new InterpAbort('unknown null check')
          branch(op === 0xc6 ? v === null : v !== null, off, start)
          break
        }
        case 0xc8:
          pc = start + s4()
          break
        case 0xc9:
          throw new InterpAbort('jsr_w')
        default:
          throw new InterpAbort(`unsupported opcode 0x${op.toString(16)}`)
      }
    }
  }

  private invokeDynamic(cls: ClassFile, index: number, stack: JValue[], pop: () => JValue): void {
    const c = cls.constant(index)
    if (c.tag !== 'indy') throw new InterpAbort('bad invokedynamic constant')
    const { desc } = cls.nameAndType(c.nat)
    const { params, ret } = parseMethodDescriptor(desc)
    const args: JValue[] = new Array(params.length)
    for (let i = params.length - 1; i >= 0; i--) args[i] = pop()
    const bsm = cls.bootstrapMethods[c.bsm]
    if (!bsm) throw new InterpAbort('missing bootstrap method')
    const owner = bsm.method.owner
    if (owner === 'java/lang/invoke/LambdaMetafactory') {
      const implIndex = bsm.args[1]
      if (implIndex === undefined) throw new InterpAbort('lambda without implementation')
      const impl = cls.methodHandle(implIndex)
      stack.push(new Lambda(ret.slice(1, -1), impl, args))
      return
    }
    if (
      owner === 'java/lang/invoke/StringConcatFactory' &&
      bsm.method.name === 'makeConcatWithConstants'
    ) {
      const recipeConst = cls.constant(bsm.args[0]!)
      const recipe = recipeConst.tag === 'string' ? cls.utf8(recipeConst.utf8) : ''
      let out = ''
      let ai = 0
      let ci = 1
      for (const ch of recipe) {
        if (ch === '\u0001') {
          const v = args[ai++]
          if (typeof v === 'string' || typeof v === 'number') out += String(v)
          else if (v === null) out += 'null'
          else if (v instanceof JEnum) out += v.name
          else {
            stack.push(OPAQUE)
            return
          }
        } else if (ch === '\u0002') {
          const k = cls.constant(bsm.args[ci++]!)
          out +=
            k.tag === 'string'
              ? cls.utf8(k.utf8)
              : k.tag === 'int' || k.tag === 'float'
                ? String(k.value)
                : ''
        } else out += ch
      }
      stack.push(out)
      return
    }
    // Record ObjectMethods, pattern switches, ...: unknown.
    stack.push(opaqueFor(ret))
  }
}

function OPAQUE_FOR_RET(ref: MemberRef): JValue | undefined {
  const { ret } = parseMethodDescriptor(ref.desc)
  return ret === 'V' ? undefined : opaqueFor(ret)
}
