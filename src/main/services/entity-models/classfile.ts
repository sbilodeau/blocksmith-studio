/**
 * Minimal JVM class file reader (JVMS chapter 4): constant pool, fields, methods with their Code, and the
 * BootstrapMethods table (lambdas). Enough to interpret the model-building code of the Minecraft client jar.
 * Pure TypeScript, no Electron, any class file version.
 */

export type Constant =
  | { tag: 'utf8'; value: string }
  | { tag: 'int'; value: number }
  | { tag: 'float'; value: number }
  | { tag: 'long'; value: bigint }
  | { tag: 'double'; value: number }
  | { tag: 'class'; name: number }
  | { tag: 'string'; utf8: number }
  | { tag: 'fieldref' | 'methodref' | 'imethodref'; cls: number; nat: number }
  | { tag: 'nat'; name: number; desc: number }
  | { tag: 'mhandle'; kind: number; ref: number }
  | { tag: 'mtype'; desc: number }
  | { tag: 'dynamic' | 'indy'; bsm: number; nat: number }
  | { tag: 'module' | 'package'; name: number }
  | { tag: 'unusable' }

export interface MemberRef {
  owner: string
  name: string
  desc: string
}

export interface MethodHandleRef extends MemberRef {
  /** JVMS 4.4.8 reference_kind (5 = invokevirtual, 6 = invokestatic, 7 = invokespecial, 9 = invokeinterface). */
  kind: number
}

export interface CodeAttribute {
  maxStack: number
  maxLocals: number
  code: Uint8Array
}

export interface MethodInfo {
  access: number
  name: string
  desc: string
  code?: CodeAttribute
}

export interface FieldInfo {
  access: number
  name: string
  desc: string
  /** ConstantValue attribute (static final primitives and strings). */
  constant?: number | bigint | string
}

export interface BootstrapMethod {
  method: MethodHandleRef
  /** Constant pool indexes of the static arguments. */
  args: number[]
}

export const ACC_STATIC = 0x0008
export const ACC_INTERFACE = 0x0200
export const ACC_ABSTRACT = 0x0400

export class ClassFormatError extends Error {}

export class ClassFile {
  constructor(
    readonly version: number,
    readonly access: number,
    readonly name: string,
    readonly superName: string | null,
    readonly interfaces: string[],
    readonly fields: FieldInfo[],
    readonly methods: MethodInfo[],
    readonly bootstrapMethods: BootstrapMethod[],
    private readonly pool: Constant[]
  ) {}

  constant(index: number): Constant {
    const c = this.pool[index]
    if (!c) throw new ClassFormatError(`${this.name}: bad constant index ${index}`)
    return c
  }

  utf8(index: number): string {
    const c = this.constant(index)
    if (c.tag !== 'utf8') throw new ClassFormatError(`${this.name}: constant ${index} is not utf8`)
    return c.value
  }

  className(index: number): string {
    const c = this.constant(index)
    if (c.tag !== 'class')
      throw new ClassFormatError(`${this.name}: constant ${index} is not a class`)
    return this.utf8(c.name)
  }

  nameAndType(index: number): { name: string; desc: string } {
    const c = this.constant(index)
    if (c.tag !== 'nat')
      throw new ClassFormatError(`${this.name}: constant ${index} is not a name-and-type`)
    return { name: this.utf8(c.name), desc: this.utf8(c.desc) }
  }

  memberRef(index: number): MemberRef {
    const c = this.constant(index)
    if (c.tag !== 'fieldref' && c.tag !== 'methodref' && c.tag !== 'imethodref') {
      throw new ClassFormatError(`${this.name}: constant ${index} is not a member reference`)
    }
    return { owner: this.className(c.cls), ...this.nameAndType(c.nat) }
  }

  methodHandle(index: number): MethodHandleRef {
    const c = this.constant(index)
    if (c.tag !== 'mhandle')
      throw new ClassFormatError(`${this.name}: constant ${index} is not a method handle`)
    return { kind: c.kind, ...this.memberRef(c.ref) }
  }

  method(name: string, desc: string): MethodInfo | undefined {
    return this.methods.find((m) => m.name === name && m.desc === desc)
  }

  field(name: string): FieldInfo | undefined {
    return this.fields.find((f) => f.name === name)
  }

  get isInterface(): boolean {
    return (this.access & ACC_INTERFACE) !== 0
  }
}

class Reader {
  private view: DataView
  pos = 0
  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }
  private need(n: number): void {
    if (this.pos + n > this.bytes.length) throw new ClassFormatError('unexpected end of class file')
  }
  u1(): number {
    this.need(1)
    return this.bytes[this.pos++]!
  }
  u2(): number {
    this.need(2)
    const v = this.view.getUint16(this.pos)
    this.pos += 2
    return v
  }
  u4(): number {
    this.need(4)
    const v = this.view.getUint32(this.pos)
    this.pos += 4
    return v
  }
  i4(): number {
    this.need(4)
    const v = this.view.getInt32(this.pos)
    this.pos += 4
    return v
  }
  f4(): number {
    this.need(4)
    const v = this.view.getFloat32(this.pos)
    this.pos += 4
    return v
  }
  i8(): bigint {
    this.need(8)
    const v = this.view.getBigInt64(this.pos)
    this.pos += 8
    return v
  }
  f8(): number {
    this.need(8)
    const v = this.view.getFloat64(this.pos)
    this.pos += 8
    return v
  }
  bytesOf(n: number): Uint8Array {
    this.need(n)
    const out = this.bytes.subarray(this.pos, this.pos + n)
    this.pos += n
    return out
  }
}

/** Java "modified UTF-8" (JVMS 4.4.7): like UTF-8, with 0 encoded on two bytes and surrogate pairs as 2 x 3 bytes. */
function decodeModifiedUtf8(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length;) {
    const a = bytes[i++]!
    if (a < 0x80) out += String.fromCharCode(a)
    else if ((a & 0xe0) === 0xc0)
      out += String.fromCharCode(((a & 0x1f) << 6) | (bytes[i++]! & 0x3f))
    else {
      const b = bytes[i++]!
      const c = bytes[i++]!
      out += String.fromCharCode(((a & 0x0f) << 12) | ((b & 0x3f) << 6) | (c & 0x3f))
    }
  }
  return out
}

export function parseClassFile(bytes: Uint8Array): ClassFile {
  const r = new Reader(bytes)
  if (r.u4() !== 0xcafebabe) throw new ClassFormatError('not a class file')
  r.u2() // minor
  const version = r.u2()
  const count = r.u2()
  const pool: Constant[] = [{ tag: 'unusable' }]
  for (let i = 1; i < count; i++) {
    const tag = r.u1()
    switch (tag) {
      case 1:
        pool[i] = { tag: 'utf8', value: decodeModifiedUtf8(r.bytesOf(r.u2())) }
        break
      case 3:
        pool[i] = { tag: 'int', value: r.i4() }
        break
      case 4:
        pool[i] = { tag: 'float', value: r.f4() }
        break
      case 5:
        pool[i] = { tag: 'long', value: r.i8() }
        pool[++i] = { tag: 'unusable' }
        break
      case 6:
        pool[i] = { tag: 'double', value: r.f8() }
        pool[++i] = { tag: 'unusable' }
        break
      case 7:
        pool[i] = { tag: 'class', name: r.u2() }
        break
      case 8:
        pool[i] = { tag: 'string', utf8: r.u2() }
        break
      case 9:
      case 10:
      case 11:
        pool[i] = {
          tag: tag === 9 ? 'fieldref' : tag === 10 ? 'methodref' : 'imethodref',
          cls: r.u2(),
          nat: r.u2()
        }
        break
      case 12:
        pool[i] = { tag: 'nat', name: r.u2(), desc: r.u2() }
        break
      case 15:
        pool[i] = { tag: 'mhandle', kind: r.u1(), ref: r.u2() }
        break
      case 16:
        pool[i] = { tag: 'mtype', desc: r.u2() }
        break
      case 17:
      case 18:
        pool[i] = { tag: tag === 17 ? 'dynamic' : 'indy', bsm: r.u2(), nat: r.u2() }
        break
      case 19:
      case 20:
        pool[i] = { tag: tag === 19 ? 'module' : 'package', name: r.u2() }
        break
      default:
        throw new ClassFormatError(`unknown constant tag ${tag} at index ${i}`)
    }
  }
  const utf8 = (i: number): string => {
    const c = pool[i]
    if (c?.tag !== 'utf8') throw new ClassFormatError(`constant ${i} is not utf8`)
    return c.value
  }
  const className = (i: number): string => {
    const c = pool[i]
    if (c?.tag !== 'class') throw new ClassFormatError(`constant ${i} is not a class`)
    return utf8(c.name)
  }

  const access = r.u2()
  const name = className(r.u2())
  const superIndex = r.u2()
  const superName = superIndex ? className(superIndex) : null
  const interfaces = Array.from({ length: r.u2() }, () => className(r.u2()))

  const fields: FieldInfo[] = []
  for (let n = r.u2(); n > 0; n--) {
    const field: FieldInfo = { access: r.u2(), name: utf8(r.u2()), desc: utf8(r.u2()) }
    for (let a = r.u2(); a > 0; a--) {
      const attr = utf8(r.u2())
      const len = r.u4()
      const end = r.pos + len
      if (attr === 'ConstantValue') {
        const c = pool[r.u2()]
        if (c?.tag === 'int' || c?.tag === 'float' || c?.tag === 'double' || c?.tag === 'long') {
          field.constant = c.value
        } else if (c?.tag === 'string') field.constant = utf8(c.utf8)
      }
      r.pos = end
    }
    fields.push(field)
  }

  const methods: MethodInfo[] = []
  for (let n = r.u2(); n > 0; n--) {
    const method: MethodInfo = { access: r.u2(), name: utf8(r.u2()), desc: utf8(r.u2()) }
    for (let a = r.u2(); a > 0; a--) {
      const attr = utf8(r.u2())
      const len = r.u4()
      const end = r.pos + len
      if (attr === 'Code') {
        const maxStack = r.u2()
        const maxLocals = r.u2()
        const code = r.bytesOf(r.u4())
        method.code = { maxStack, maxLocals, code }
      }
      r.pos = end
    }
    methods.push(method)
  }

  const bootstrapMethods: BootstrapMethod[] = []
  const pending: Array<{ ref: number; args: number[] }> = []
  for (let a = r.u2(); a > 0; a--) {
    const attr = utf8(r.u2())
    const len = r.u4()
    const end = r.pos + len
    if (attr === 'BootstrapMethods') {
      for (let n = r.u2(); n > 0; n--) {
        const ref = r.u2()
        const args = Array.from({ length: r.u2() }, () => r.u2())
        pending.push({ ref, args })
      }
    }
    r.pos = end
  }

  const cls = new ClassFile(
    version,
    access,
    name,
    superName,
    interfaces,
    fields,
    methods,
    bootstrapMethods,
    pool
  )
  for (const p of pending) bootstrapMethods.push({ method: cls.methodHandle(p.ref), args: p.args })
  return cls
}

/** Parameter and return types of a method descriptor, e.g. "(FFLjava/lang/String;)V" -> [["F","F","Ljava/lang/String;"],"V"]. */
export function parseMethodDescriptor(desc: string): { params: string[]; ret: string } {
  if (desc[0] !== '(') throw new ClassFormatError(`bad method descriptor ${desc}`)
  const params: string[] = []
  let i = 1
  const one = (): string => {
    const start = i
    while (desc[i] === '[') i++
    if (desc[i] === 'L') {
      const end = desc.indexOf(';', i)
      if (end < 0) throw new ClassFormatError(`bad descriptor ${desc}`)
      i = end + 1
    } else i++
    return desc.slice(start, i)
  }
  while (desc[i] !== ')') {
    if (i >= desc.length) throw new ClassFormatError(`bad method descriptor ${desc}`)
    params.push(one())
  }
  i++
  return { params, ret: one() }
}

/** Long and double take two local variable slots. */
export function isWide(type: string): boolean {
  return type === 'J' || type === 'D'
}
