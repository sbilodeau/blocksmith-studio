/**
 * Tiny JVM class file assembler for tests and fixtures (no Mojang code is used or committed). It writes valid
 * class files (version 69) that the entity model interpreter can read; it does not compute stack map frames or
 * verify anything, which the interpreter does not need.
 *
 *   const cls = new ClassBuilder('demo/Model')
 *   cls.method('make', '()F', (c) => c.fconst(1.5).freturn(), { access: ACC_PUBLIC | ACC_STATIC })
 *   const bytes = cls.build()
 */

export const ACC_PUBLIC = 0x0001
export const ACC_PRIVATE = 0x0002
export const ACC_STATIC = 0x0008
export const ACC_FINAL = 0x0010
export const ACC_SUPER = 0x0020
export const ACC_INTERFACE = 0x0200
export const ACC_ABSTRACT = 0x0400

class ByteWriter {
  constructor() {
    /** @type {number[]} */
    this.bytes = []
  }
  u1(v) {
    this.bytes.push(v & 0xff)
    return this
  }
  u2(v) {
    return this.u1(v >> 8).u1(v)
  }
  u4(v) {
    return this.u2((v >>> 16) & 0xffff).u2(v & 0xffff)
  }
  raw(arr) {
    for (const b of arr) this.bytes.push(b & 0xff)
    return this
  }
  get length() {
    return this.bytes.length
  }
}

function utf8Bytes(s) {
  // Modified UTF-8 is plain UTF-8 for the characters fixtures use.
  return [...new TextEncoder().encode(s)]
}

class ConstantPool {
  constructor() {
    /** @type {Array<{ key: string, bytes: number[], wide: boolean }>} */
    this.entries = []
    /** @type {Map<string, number>} */
    this.index = new Map()
    this.next = 1
  }
  add(key, bytes, wide = false) {
    const hit = this.index.get(key)
    if (hit) return hit
    const i = this.next
    this.entries.push({ key, bytes, wide })
    this.index.set(key, i)
    this.next += wide ? 2 : 1
    return i
  }
  utf8(s) {
    const b = utf8Bytes(s)
    return this.add(`utf8:${s}`, [1, b.length >> 8, b.length & 0xff, ...b])
  }
  cls(name) {
    const n = this.utf8(name)
    return this.add(`class:${name}`, [7, n >> 8, n & 0xff])
  }
  str(s) {
    const n = this.utf8(s)
    return this.add(`string:${s}`, [8, n >> 8, n & 0xff])
  }
  int(v) {
    const w = new ByteWriter().u1(3).u4(v | 0)
    return this.add(`int:${v | 0}`, w.bytes)
  }
  float(v) {
    const buf = new DataView(new ArrayBuffer(4))
    buf.setFloat32(0, v)
    return this.add(`float:${buf.getUint32(0)}`, [4, ...new Uint8Array(buf.buffer)])
  }
  long(v) {
    const buf = new DataView(new ArrayBuffer(8))
    buf.setBigInt64(0, BigInt(v))
    return this.add(`long:${BigInt(v)}`, [5, ...new Uint8Array(buf.buffer)], true)
  }
  double(v) {
    const buf = new DataView(new ArrayBuffer(8))
    buf.setFloat64(0, v)
    return this.add(`double:${v}`, [6, ...new Uint8Array(buf.buffer)], true)
  }
  nat(name, desc) {
    const n = this.utf8(name)
    const d = this.utf8(desc)
    return this.add(`nat:${name}:${desc}`, [12, n >> 8, n & 0xff, d >> 8, d & 0xff])
  }
  ref(tag, owner, name, desc) {
    const c = this.cls(owner)
    const nt = this.nat(name, desc)
    return this.add(`ref${tag}:${owner}.${name}${desc}`, [
      tag,
      c >> 8,
      c & 0xff,
      nt >> 8,
      nt & 0xff
    ])
  }
  field(owner, name, desc) {
    return this.ref(9, owner, name, desc)
  }
  method(owner, name, desc) {
    return this.ref(10, owner, name, desc)
  }
  imethod(owner, name, desc) {
    return this.ref(11, owner, name, desc)
  }
  mhandle(kind, refIndex) {
    return this.add(`mh:${kind}:${refIndex}`, [15, kind, refIndex >> 8, refIndex & 0xff])
  }
  mtype(desc) {
    const d = this.utf8(desc)
    return this.add(`mt:${desc}`, [16, d >> 8, d & 0xff])
  }
  indy(bsm, name, desc) {
    const nt = this.nat(name, desc)
    return this.add(`indy:${bsm}:${name}:${desc}`, [18, bsm >> 8, bsm & 0xff, nt >> 8, nt & 0xff])
  }
  write(w) {
    w.u2(this.next)
    for (const e of this.entries) w.raw(e.bytes)
  }
}

/** Argument slot count of a method descriptor (for invokeinterface's count byte). */
function argSlots(desc) {
  let n = 0
  let i = 1
  while (desc[i] !== ')') {
    const c = desc[i]
    if (c === 'J' || c === 'D') {
      n += 2
      i++
    } else if (c === 'L') {
      n++
      i = desc.indexOf(';', i) + 1
    } else if (c === '[') {
      while (desc[i] === '[') i++
      if (desc[i] === 'L') i = desc.indexOf(';', i) + 1
      else i++
      n++
    } else {
      n++
      i++
    }
  }
  return n
}

export class CodeBuilder {
  /** @param {ClassBuilder} cls */
  constructor(cls) {
    this.cls = cls
    this.pool = cls.pool
    this.w = new ByteWriter()
    /** @type {Map<string, number>} */
    this.labels = new Map()
    /** @type {Array<{ at: number, from: number, label: string, wide: boolean }>} */
    this.fixups = []
  }
  op(...bytes) {
    this.w.raw(bytes)
    return this
  }
  // constants
  aconst_null() {
    return this.op(0x01)
  }
  iconst(v) {
    if (v >= -1 && v <= 5) return this.op(0x03 + v)
    if (v >= -128 && v <= 127) return this.op(0x10, v & 0xff)
    if (v >= -32768 && v <= 32767) return this.op(0x11, (v >> 8) & 0xff, v & 0xff)
    return this.ldcIndex(this.pool.int(v))
  }
  fconst(v) {
    if (v === 0 || v === 1 || v === 2) return this.op(0x0b + v)
    return this.ldcIndex(this.pool.float(v))
  }
  lconst(v) {
    const i = this.pool.long(v)
    return this.op(0x14, i >> 8, i & 0xff)
  }
  dconst(v) {
    const i = this.pool.double(v)
    return this.op(0x14, i >> 8, i & 0xff)
  }
  sconst(s) {
    return this.ldcIndex(this.pool.str(s))
  }
  ldcIndex(i) {
    return i < 256 ? this.op(0x12, i) : this.op(0x13, i >> 8, i & 0xff)
  }
  // locals
  iload(i) {
    return this.op(0x15, i)
  }
  fload(i) {
    return this.op(0x17, i)
  }
  aload(i) {
    return this.op(0x19, i)
  }
  istore(i) {
    return this.op(0x36, i)
  }
  fstore(i) {
    return this.op(0x38, i)
  }
  astore(i) {
    return this.op(0x3a, i)
  }
  iinc(i, n) {
    return this.op(0x84, i, n & 0xff)
  }
  // stack and math
  pop() {
    return this.op(0x57)
  }
  dup() {
    return this.op(0x59)
  }
  swap() {
    return this.op(0x5f)
  }
  iadd() {
    return this.op(0x60)
  }
  isub() {
    return this.op(0x64)
  }
  imul() {
    return this.op(0x68)
  }
  fadd() {
    return this.op(0x62)
  }
  fsub() {
    return this.op(0x66)
  }
  fmul() {
    return this.op(0x6a)
  }
  fdiv() {
    return this.op(0x6e)
  }
  fneg() {
    return this.op(0x76)
  }
  i2f() {
    return this.op(0x86)
  }
  f2i() {
    return this.op(0x8b)
  }
  // members
  memberOp(opcode, index) {
    return this.op(opcode, index >> 8, index & 0xff)
  }
  getstatic(owner, name, desc) {
    return this.memberOp(0xb2, this.pool.field(owner, name, desc))
  }
  putstatic(owner, name, desc) {
    return this.memberOp(0xb3, this.pool.field(owner, name, desc))
  }
  getfield(owner, name, desc) {
    return this.memberOp(0xb4, this.pool.field(owner, name, desc))
  }
  putfield(owner, name, desc) {
    return this.memberOp(0xb5, this.pool.field(owner, name, desc))
  }
  invokevirtual(owner, name, desc) {
    return this.memberOp(0xb6, this.pool.method(owner, name, desc))
  }
  invokespecial(owner, name, desc) {
    return this.memberOp(0xb7, this.pool.method(owner, name, desc))
  }
  invokestatic(owner, name, desc) {
    return this.memberOp(0xb8, this.pool.method(owner, name, desc))
  }
  invokeinterface(owner, name, desc) {
    const i = this.pool.imethod(owner, name, desc)
    return this.op(0xb9, i >> 8, i & 0xff, argSlots(desc) + 1, 0)
  }
  newObject(cls) {
    return this.memberOp(0xbb, this.pool.cls(cls))
  }
  anewarray(cls) {
    return this.memberOp(0xbd, this.pool.cls(cls))
  }
  aastore() {
    return this.op(0x53)
  }
  checkcast(cls) {
    return this.memberOp(0xc0, this.pool.cls(cls))
  }
  athrow() {
    return this.op(0xbf)
  }
  // returns
  ireturn() {
    return this.op(0xac)
  }
  freturn() {
    return this.op(0xae)
  }
  areturn() {
    return this.op(0xb0)
  }
  vreturn() {
    return this.op(0xb1)
  }
  // control flow
  label(name) {
    this.labels.set(name, this.w.length)
    return this
  }
  jump(opcode, label) {
    const from = this.w.length
    this.op(opcode, 0, 0)
    this.fixups.push({ at: from + 1, from, label, wide: false })
    return this
  }
  goto(label) {
    return this.jump(0xa7, label)
  }
  ifeq(label) {
    return this.jump(0x99, label)
  }
  ifne(label) {
    return this.jump(0x9a, label)
  }
  if_icmpge(label) {
    return this.jump(0xa2, label)
  }
  if_icmplt(label) {
    return this.jump(0xa1, label)
  }
  ifnull(label) {
    return this.jump(0xc6, label)
  }
  ifnonnull(label) {
    return this.jump(0xc7, label)
  }
  /**
   * A lambda: pushes an instance of `iface` whose single method calls `implOwner.implName` (static by default)
   * with the captured values (popped, described by `capturedDesc`) then the interface arguments.
   */
  lambda({
    iface,
    samName,
    samDesc,
    implOwner,
    implName,
    implDesc,
    implKind = 6,
    capturedDesc = '()'
  }) {
    const pool = this.pool
    const bsmRef = pool.method(
      'java/lang/invoke/LambdaMetafactory',
      'metafactory',
      '(Ljava/lang/invoke/MethodHandles$Lookup;Ljava/lang/String;Ljava/lang/invoke/MethodType;Ljava/lang/invoke/MethodType;Ljava/lang/invoke/MethodHandle;Ljava/lang/invoke/MethodType;)Ljava/lang/invoke/CallSite;'
    )
    const implRef =
      implKind === 9
        ? pool.imethod(implOwner, implName, implDesc)
        : pool.method(implOwner, implName, implDesc)
    const bsm = this.cls.bootstrap(pool.mhandle(6, bsmRef), [
      pool.mtype(samDesc),
      pool.mhandle(implKind, implRef),
      pool.mtype(samDesc)
    ])
    const i = pool.indy(bsm, samName, `${capturedDesc}L${iface};`)
    return this.op(0xba, i >> 8, i & 0xff, 0, 0)
  }
  /** String concatenation through StringConcatFactory (\u0001 = an argument). */
  concat(recipe, argsDesc) {
    const pool = this.pool
    const bsmRef = pool.method(
      'java/lang/invoke/StringConcatFactory',
      'makeConcatWithConstants',
      '(Ljava/lang/invoke/MethodHandles$Lookup;Ljava/lang/String;Ljava/lang/invoke/MethodType;Ljava/lang/String;[Ljava/lang/Object;)Ljava/lang/invoke/CallSite;'
    )
    const bsm = this.cls.bootstrap(pool.mhandle(6, bsmRef), [pool.str(recipe)])
    const i = pool.indy(bsm, 'makeConcatWithConstants', `${argsDesc}Ljava/lang/String;`)
    return this.op(0xba, i >> 8, i & 0xff, 0, 0)
  }
  finish() {
    for (const f of this.fixups) {
      const target = this.labels.get(f.label)
      if (target === undefined) throw new Error(`unknown label ${f.label}`)
      const off = target - f.from
      this.w.bytes[f.at] = (off >> 8) & 0xff
      this.w.bytes[f.at + 1] = off & 0xff
    }
    return this.w.bytes
  }
}

export class ClassBuilder {
  /**
   * @param {string} name internal name, e.g. "net/minecraft/client/model/Demo"
   * @param {{ superName?: string, access?: number, interfaces?: string[] }} [options]
   */
  constructor(name, options = {}) {
    this.name = name
    this.superName = options.superName ?? 'java/lang/Object'
    this.access = options.access ?? ACC_PUBLIC | ACC_SUPER
    this.interfaces = options.interfaces ?? []
    this.pool = new ConstantPool()
    /** @type {Array<{ access: number, name: string, desc: string, constant?: number | string }>} */
    this.fields = []
    /** @type {Array<{ access: number, name: string, desc: string, code?: number[], maxLocals: number }>} */
    this.methods = []
    /** @type {Array<{ mh: number, args: number[] }>} */
    this.bootstraps = []
  }
  field(name, desc, { access = ACC_PUBLIC, constant } = {}) {
    this.fields.push({ access, name, desc, constant })
    return this
  }
  /**
   * @param {(c: CodeBuilder) => void} [build] omit for abstract methods
   */
  method(name, desc, build, { access = ACC_PUBLIC, maxLocals = 16 } = {}) {
    let code
    if (build) {
      const c = new CodeBuilder(this)
      build(c)
      code = c.finish()
    }
    this.methods.push({ access, name, desc, code, maxLocals })
    return this
  }
  /** A no-arg constructor calling the superclass one. */
  defaultConstructor() {
    return this.method('<init>', '()V', (c) =>
      c.aload(0).invokespecial(this.superName, '<init>', '()V').vreturn()
    )
  }
  bootstrap(mh, args) {
    const key = `${mh}:${args.join(',')}`
    const found = this.bootstraps.findIndex((b) => `${b.mh}:${b.args.join(',')}` === key)
    if (found >= 0) return found
    this.bootstraps.push({ mh, args })
    return this.bootstraps.length - 1
  }
  build() {
    const pool = this.pool
    const thisIndex = pool.cls(this.name)
    const superIndex = pool.cls(this.superName)
    const ifaces = this.interfaces.map((i) => pool.cls(i))
    const fieldParts = this.fields.map((f) => {
      const name = pool.utf8(f.name)
      const desc = pool.utf8(f.desc)
      let attr = null
      if (f.constant !== undefined) {
        const cv = pool.utf8('ConstantValue')
        const idx =
          typeof f.constant === 'string'
            ? pool.str(f.constant)
            : f.desc === 'F'
              ? pool.float(f.constant)
              : pool.int(f.constant)
        attr = { cv, idx }
      }
      return { f, name, desc, attr }
    })
    const codeName = pool.utf8('Code')
    const methodParts = this.methods.map((m) => ({
      m,
      name: pool.utf8(m.name),
      desc: pool.utf8(m.desc)
    }))
    const bsmName = this.bootstraps.length ? pool.utf8('BootstrapMethods') : 0

    const w = new ByteWriter()
    w.u4(0xcafebabe).u2(0).u2(69)
    pool.write(w)
    w.u2(this.access).u2(thisIndex).u2(superIndex).u2(ifaces.length)
    for (const i of ifaces) w.u2(i)
    w.u2(fieldParts.length)
    for (const { f, name, desc, attr } of fieldParts) {
      w.u2(f.access).u2(name).u2(desc)
      if (attr) w.u2(1).u2(attr.cv).u4(2).u2(attr.idx)
      else w.u2(0)
    }
    w.u2(methodParts.length)
    for (const { m, name, desc } of methodParts) {
      w.u2(m.access).u2(name).u2(desc)
      if (!m.code) {
        w.u2(0)
        continue
      }
      w.u2(1).u2(codeName)
      w.u4(12 + m.code.length)
      w.u2(64).u2(m.maxLocals).u4(m.code.length).raw(m.code).u2(0).u2(0)
    }
    if (this.bootstraps.length) {
      const body = new ByteWriter().u2(this.bootstraps.length)
      for (const b of this.bootstraps) {
        body.u2(b.mh).u2(b.args.length)
        for (const a of b.args) body.u2(a)
      }
      w.u2(1).u2(bsmName).u4(body.length).raw(body.bytes)
    } else w.u2(0)
    return new Uint8Array(w.bytes)
  }
}
