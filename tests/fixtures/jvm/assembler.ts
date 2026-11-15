/** Typed access to the test class assembler (scripts/lib/class-assembler.mjs) and the synthetic model classes. */
export interface CodeBuilder {
  pool: { float(v: number): number; str(s: string): number; int(v: number): number }
  [op: string]: unknown
}

type AnyCode = Record<string, (...args: unknown[]) => AnyCode> & { pool: CodeBuilder['pool'] }

export interface ClassBuilderLike {
  name: string
  field(
    name: string,
    desc: string,
    options?: { access?: number; constant?: number | string }
  ): ClassBuilderLike
  method(
    name: string,
    desc: string,
    build?: (c: AnyCode) => unknown,
    options?: { access?: number; maxLocals?: number }
  ): ClassBuilderLike
  defaultConstructor(): ClassBuilderLike
  build(): Uint8Array
}

interface AssemblerModule {
  ACC_PUBLIC: number
  ACC_STATIC: number
  ACC_INTERFACE: number
  ACC_ABSTRACT: number
  ClassBuilder: new (
    name: string,
    options?: { superName?: string; access?: number; interfaces?: string[] }
  ) => ClassBuilderLike
}

export async function loadAssembler(): Promise<AssemblerModule> {
  return (await import('../../../scripts/lib/class-assembler.mjs' as string)) as AssemblerModule
}

export async function loadSyntheticModels(): Promise<Record<string, Uint8Array>> {
  const mod = (await import('../../../scripts/lib/synthetic-models.mjs' as string)) as {
    syntheticModelClasses: () => Record<string, Uint8Array>
  }
  return mod.syntheticModelClasses()
}
