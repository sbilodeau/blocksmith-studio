/**
 * Synthetic "model code" classes for tests and the fixture jar: written for Blocksmith Studio with the assembler,
 * using the same package, class and field names as the Minecraft client's model builders (the shape the
 * interpreter reads), with simplified bodies. No Mojang code is copied.
 *
 * Layers registered by the synthetic LayerDefinitions.createRoots():
 *   demo#main       DemoModel: body with a rotated head child, 3 legs made in a loop, a mirrored inflated box,
 *                   a box with only two visible faces; texture 64 x 32
 *   demo_baby#main  the same mesh through MeshTransformer.scaling(0.5) (a lambda)
 *   zombie#main     the same mesh on a 64 x 64 texture (the fixture jar's zombie texture uses it)
 *   broken#main     BrokenModel: throws, so the layer is skipped
 */
import {
  ACC_INTERFACE,
  ACC_ABSTRACT,
  ACC_PUBLIC,
  ACC_STATIC,
  ClassBuilder
} from './class-assembler.mjs'

const G = 'net/minecraft/client/model/geom'
const B = `${G}/builders`
const PS = ACC_PUBLIC | ACC_STATIC

const T = {
  cubeDef: `${B}/CubeDefinition`,
  deform: `${B}/CubeDeformation`,
  uv: `${B}/UVPair`,
  list: `${B}/CubeListBuilder`,
  part: `${B}/PartDefinition`,
  mesh: `${B}/MeshDefinition`,
  material: `${B}/MaterialDefinition`,
  layer: `${B}/LayerDefinition`,
  transformer: `${B}/MeshTransformer`,
  pose: `${G}/PartPose`,
  location: `${G}/ModelLayerLocation`,
  layers: `${G}/ModelLayers`,
  roots: `${G}/LayerDefinitions`,
  demo: 'net/minecraft/client/model/demo/DemoModel',
  broken: 'net/minecraft/client/model/demo/BrokenModel'
}
const L = (t) => `L${t};`

function cubeDeformation() {
  const c = new ClassBuilder(T.deform)
  c.field('NONE', L(T.deform), { access: PS })
  for (const f of ['growX', 'growY', 'growZ']) c.field(f, 'F')
  c.method('<init>', '(FFF)V', (m) =>
    m
      .aload(0)
      .invokespecial('java/lang/Object', '<init>', '()V')
      .aload(0)
      .fload(1)
      .putfield(T.deform, 'growX', 'F')
      .aload(0)
      .fload(2)
      .putfield(T.deform, 'growY', 'F')
      .aload(0)
      .fload(3)
      .putfield(T.deform, 'growZ', 'F')
      .vreturn()
  )
  c.method('<init>', '(F)V', (m) =>
    m.aload(0).fload(1).fload(1).fload(1).invokespecial(T.deform, '<init>', '(FFF)V').vreturn()
  )
  c.method(
    '<clinit>',
    '()V',
    (m) =>
      m
        .newObject(T.deform)
        .dup()
        .fconst(0)
        .invokespecial(T.deform, '<init>', '(F)V')
        .putstatic(T.deform, 'NONE', L(T.deform))
        .vreturn(),
    { access: ACC_STATIC }
  )
  return c
}

function uvPair() {
  const c = new ClassBuilder(T.uv, { superName: 'java/lang/Record' })
  c.field('u', 'F').field('v', 'F')
  c.method('<init>', '(FF)V', (m) =>
    m
      .aload(0)
      .invokespecial('java/lang/Record', '<init>', '()V')
      .aload(0)
      .fload(1)
      .putfield(T.uv, 'u', 'F')
      .aload(0)
      .fload(2)
      .putfield(T.uv, 'v', 'F')
      .vreturn()
  )
  return c
}

/** CubeDefinition(x, y, z, w, h, d, grow, mirror, u, v, faces) */
function cubeDefinition() {
  const c = new ClassBuilder(T.cubeDef)
  c.field('origin', 'Lorg/joml/Vector3fc;')
    .field('dimensions', 'Lorg/joml/Vector3fc;')
    .field('grow', L(T.deform))
    .field('mirror', 'Z')
    .field('texCoord', L(T.uv))
    .field('texScale', L(T.uv))
    .field('visibleFaces', 'Ljava/util/Set;')
  const desc = `(FFFFFF${L(T.deform)}ZFFLjava/util/Set;)V`
  c.method(
    '<init>',
    desc,
    (m) =>
      m
        .aload(0)
        .invokespecial('java/lang/Object', '<init>', '()V')
        // origin = new Vector3f(x, y, z)
        .aload(0)
        .newObject('org/joml/Vector3f')
        .dup()
        .fload(1)
        .fload(2)
        .fload(3)
        .invokespecial('org/joml/Vector3f', '<init>', '(FFF)V')
        .putfield(T.cubeDef, 'origin', 'Lorg/joml/Vector3fc;')
        .aload(0)
        .newObject('org/joml/Vector3f')
        .dup()
        .fload(4)
        .fload(5)
        .fload(6)
        .invokespecial('org/joml/Vector3f', '<init>', '(FFF)V')
        .putfield(T.cubeDef, 'dimensions', 'Lorg/joml/Vector3fc;')
        .aload(0)
        .aload(7)
        .putfield(T.cubeDef, 'grow', L(T.deform))
        .aload(0)
        .iload(8)
        .putfield(T.cubeDef, 'mirror', 'Z')
        .aload(0)
        .newObject(T.uv)
        .dup()
        .fload(9)
        .fload(10)
        .invokespecial(T.uv, '<init>', '(FF)V')
        .putfield(T.cubeDef, 'texCoord', L(T.uv))
        .aload(0)
        .newObject(T.uv)
        .dup()
        .fconst(1)
        .fconst(1)
        .invokespecial(T.uv, '<init>', '(FF)V')
        .putfield(T.cubeDef, 'texScale', L(T.uv))
        .aload(0)
        .aload(11)
        .putfield(T.cubeDef, 'visibleFaces', 'Ljava/util/Set;')
        .vreturn(),
    { maxLocals: 12 }
  )
  return c
}

function cubeListBuilder() {
  const c = new ClassBuilder(T.list)
  c.field('ALL', 'Ljava/util/Set;', { access: PS })
  c.field('cubes', 'Ljava/util/List;')
    .field('xTexOffs', 'I')
    .field('yTexOffs', 'I')
    .field('mirror', 'Z')
  c.method('<init>', '()V', (m) =>
    m
      .aload(0)
      .invokespecial('java/lang/Object', '<init>', '()V')
      .aload(0)
      .invokestatic('com/google/common/collect/Lists', 'newArrayList', '()Ljava/util/ArrayList;')
      .putfield(T.list, 'cubes', 'Ljava/util/List;')
      .vreturn()
  )
  c.method(
    'create',
    `()${L(T.list)}`,
    (m) => m.newObject(T.list).dup().invokespecial(T.list, '<init>', '()V').areturn(),
    {
      access: PS
    }
  )
  c.method('texOffs', `(II)${L(T.list)}`, (m) =>
    m
      .aload(0)
      .iload(1)
      .putfield(T.list, 'xTexOffs', 'I')
      .aload(0)
      .iload(2)
      .putfield(T.list, 'yTexOffs', 'I')
      .aload(0)
      .areturn()
  )
  c.method('mirror', `()${L(T.list)}`, (m) =>
    m.aload(0).iconst(1).putfield(T.list, 'mirror', 'Z').aload(0).areturn()
  )
  // addBox(x, y, z, w, h, d, deformation, faces): the general form the others delegate to.
  const add = (m, deformLoad, facesLoad) => {
    m.aload(0)
      .getfield(T.list, 'cubes', 'Ljava/util/List;')
      .newObject(T.cubeDef)
      .dup()
      .fload(1)
      .fload(2)
      .fload(3)
      .fload(4)
      .fload(5)
      .fload(6)
    deformLoad(m)
    m.aload(0)
      .getfield(T.list, 'mirror', 'Z')
      .aload(0)
      .getfield(T.list, 'xTexOffs', 'I')
      .i2f()
      .aload(0)
      .getfield(T.list, 'yTexOffs', 'I')
      .i2f()
    facesLoad(m)
    m.invokespecial(T.cubeDef, '<init>', `(FFFFFF${L(T.deform)}ZFFLjava/util/Set;)V`)
      .invokeinterface('java/util/List', 'add', '(Ljava/lang/Object;)Z')
      .pop()
      .aload(0)
      .areturn()
  }
  const all = (m) => m.getstatic(T.list, 'ALL', 'Ljava/util/Set;')
  c.method('addBox', `(FFFFFF)${L(T.list)}`, (m) =>
    add(m, (x) => x.getstatic(T.deform, 'NONE', L(T.deform)), all)
  )
  c.method('addBox', `(FFFFFF${L(T.deform)})${L(T.list)}`, (m) => add(m, (x) => x.aload(7), all), {
    maxLocals: 8
  })
  c.method('addBox', `(FFFFFFLjava/util/Set;)${L(T.list)}`, (m) =>
    add(
      m,
      (x) => x.getstatic(T.deform, 'NONE', L(T.deform)),
      (x) => x.aload(7)
    )
  )
  c.method('getCubes', '()Ljava/util/List;', (m) =>
    m.aload(0).getfield(T.list, 'cubes', 'Ljava/util/List;').areturn()
  )
  c.method(
    '<clinit>',
    '()V',
    (m) =>
      m
        .aconst_null() // Direction.class
        .invokestatic('java/util/EnumSet', 'allOf', '(Ljava/lang/Class;)Ljava/util/EnumSet;')
        .putstatic(T.list, 'ALL', 'Ljava/util/Set;')
        .vreturn(),
    { access: ACC_STATIC }
  )
  return c
}

function partPose() {
  const c = new ClassBuilder(T.pose, { superName: 'java/lang/Record' })
  const f9 = ['x', 'y', 'z', 'xRot', 'yRot', 'zRot', 'xScale', 'yScale', 'zScale']
  for (const f of f9) c.field(f, 'F')
  c.field('ZERO', L(T.pose), { access: PS })
  c.method(
    '<init>',
    '(FFFFFFFFF)V',
    (m) => {
      m.aload(0).invokespecial('java/lang/Record', '<init>', '()V')
      f9.forEach((f, i) =>
        m
          .aload(0)
          .fload(i + 1)
          .putfield(T.pose, f, 'F')
      )
      m.vreturn()
    },
    { maxLocals: 10 }
  )
  c.method(
    'offsetAndRotation',
    `(FFFFFF)${L(T.pose)}`,
    (m) =>
      m
        .newObject(T.pose)
        .dup()
        .fload(0)
        .fload(1)
        .fload(2)
        .fload(3)
        .fload(4)
        .fload(5)
        .fconst(1)
        .fconst(1)
        .fconst(1)
        .invokespecial(T.pose, '<init>', '(FFFFFFFFF)V')
        .areturn(),
    { access: PS }
  )
  c.method(
    'offset',
    `(FFF)${L(T.pose)}`,
    (m) =>
      m
        .fload(0)
        .fload(1)
        .fload(2)
        .fconst(0)
        .fconst(0)
        .fconst(0)
        .invokestatic(T.pose, 'offsetAndRotation', `(FFFFFF)${L(T.pose)}`)
        .areturn(),
    { access: PS }
  )
  // scaled(f): offsets and scales multiplied, rotations kept.
  c.method('scaled', `(F)${L(T.pose)}`, (m) => {
    m.newObject(T.pose).dup()
    for (const f of f9) {
      m.aload(0).getfield(T.pose, f, 'F')
      if (!f.endsWith('Rot')) m.fload(1).fmul()
    }
    m.invokespecial(T.pose, '<init>', '(FFFFFFFFF)V').areturn()
  })
  c.method(
    '<clinit>',
    '()V',
    (m) =>
      m
        .fconst(0)
        .fconst(0)
        .fconst(0)
        .invokestatic(T.pose, 'offset', `(FFF)${L(T.pose)}`)
        .putstatic(T.pose, 'ZERO', L(T.pose))
        .vreturn(),
    { access: ACC_STATIC }
  )
  return c
}

function partDefinition() {
  const c = new ClassBuilder(T.part)
  c.field('cubes', 'Ljava/util/List;')
    .field('partPose', L(T.pose))
    .field('children', 'Ljava/util/Map;')
  c.method('<init>', `(Ljava/util/List;${L(T.pose)})V`, (m) =>
    m
      .aload(0)
      .invokespecial('java/lang/Object', '<init>', '()V')
      .aload(0)
      .invokestatic('com/google/common/collect/Maps', 'newHashMap', '()Ljava/util/HashMap;')
      .putfield(T.part, 'children', 'Ljava/util/Map;')
      .aload(0)
      .aload(1)
      .putfield(T.part, 'cubes', 'Ljava/util/List;')
      .aload(0)
      .aload(2)
      .putfield(T.part, 'partPose', L(T.pose))
      .vreturn()
  )
  c.method('addOrReplaceChild', `(Ljava/lang/String;${L(T.list)}${L(T.pose)})${L(T.part)}`, (m) =>
    m
      .newObject(T.part)
      .dup()
      .aload(2)
      .invokevirtual(T.list, 'getCubes', '()Ljava/util/List;')
      .aload(3)
      .invokespecial(T.part, '<init>', `(Ljava/util/List;${L(T.pose)})V`)
      .astore(4)
      .aload(0)
      .getfield(T.part, 'children', 'Ljava/util/Map;')
      .aload(1)
      .aload(4)
      .invokeinterface(
        'java/util/Map',
        'put',
        '(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;'
      )
      .pop()
      .aload(4)
      .areturn()
  )
  return c
}

function meshDefinition() {
  const c = new ClassBuilder(T.mesh)
  c.field('root', L(T.part))
  c.method('<init>', '()V', (m) =>
    m
      .aload(0)
      .invokespecial('java/lang/Object', '<init>', '()V')
      .aload(0)
      .newObject(T.part)
      .dup()
      .invokestatic('java/util/List', 'of', '()Ljava/util/List;')
      .getstatic(T.pose, 'ZERO', L(T.pose))
      .invokespecial(T.part, '<init>', `(Ljava/util/List;${L(T.pose)})V`)
      .putfield(T.mesh, 'root', L(T.part))
      .vreturn()
  )
  c.method('getRoot', `()${L(T.part)}`, (m) =>
    m.aload(0).getfield(T.mesh, 'root', L(T.part)).areturn()
  )
  return c
}

function materialDefinition() {
  const c = new ClassBuilder(T.material)
  c.field('xTexSize', 'I').field('yTexSize', 'I')
  c.method('<init>', '(II)V', (m) =>
    m
      .aload(0)
      .invokespecial('java/lang/Object', '<init>', '()V')
      .aload(0)
      .iload(1)
      .putfield(T.material, 'xTexSize', 'I')
      .aload(0)
      .iload(2)
      .putfield(T.material, 'yTexSize', 'I')
      .vreturn()
  )
  return c
}

function layerDefinition() {
  const c = new ClassBuilder(T.layer)
  c.field('mesh', L(T.mesh)).field('material', L(T.material))
  c.method('<init>', `(${L(T.mesh)}${L(T.material)})V`, (m) =>
    m
      .aload(0)
      .invokespecial('java/lang/Object', '<init>', '()V')
      .aload(0)
      .aload(1)
      .putfield(T.layer, 'mesh', L(T.mesh))
      .aload(0)
      .aload(2)
      .putfield(T.layer, 'material', L(T.material))
      .vreturn()
  )
  c.method(
    'create',
    `(${L(T.mesh)}II)${L(T.layer)}`,
    (m) =>
      m
        .newObject(T.layer)
        .dup()
        .aload(0)
        .newObject(T.material)
        .dup()
        .iload(1)
        .iload(2)
        .invokespecial(T.material, '<init>', '(II)V')
        .invokespecial(T.layer, '<init>', `(${L(T.mesh)}${L(T.material)})V`)
        .areturn(),
    { access: PS }
  )
  c.method('apply', `(${L(T.transformer)})${L(T.layer)}`, (m) =>
    m
      .newObject(T.layer)
      .dup()
      .aload(1)
      .aload(0)
      .getfield(T.layer, 'mesh', L(T.mesh))
      .invokeinterface(T.transformer, 'apply', `(${L(T.mesh)})${L(T.mesh)}`)
      .aload(0)
      .getfield(T.layer, 'material', L(T.material))
      .invokespecial(T.layer, '<init>', `(${L(T.mesh)}${L(T.material)})V`)
      .areturn()
  )
  return c
}

function meshTransformer() {
  const c = new ClassBuilder(T.transformer, {
    access: ACC_PUBLIC | ACC_INTERFACE | ACC_ABSTRACT
  })
  c.method('apply', `(${L(T.mesh)})${L(T.mesh)}`, undefined, { access: ACC_PUBLIC | ACC_ABSTRACT })
  // scaling(f) = mesh -> { mesh.root.partPose = mesh.root.partPose.scaled(f); return mesh }
  c.method(
    'scaling',
    `(F)${L(T.transformer)}`,
    (m) =>
      m
        .fload(0)
        .lambda({
          iface: T.transformer,
          samName: 'apply',
          samDesc: `(${L(T.mesh)})${L(T.mesh)}`,
          implOwner: T.transformer,
          implName: 'lambda$scaling$0',
          implDesc: `(F${L(T.mesh)})${L(T.mesh)}`,
          capturedDesc: '(F)'
        })
        .areturn(),
    { access: PS }
  )
  c.method(
    'lambda$scaling$0',
    `(F${L(T.mesh)})${L(T.mesh)}`,
    (m) =>
      m
        .aload(1)
        .getfield(T.mesh, 'root', L(T.part))
        .astore(2)
        .aload(2)
        .aload(2)
        .getfield(T.part, 'partPose', L(T.pose))
        .fload(0)
        .invokevirtual(T.pose, 'scaled', `(F)${L(T.pose)}`)
        .putfield(T.part, 'partPose', L(T.pose))
        .aload(1)
        .areturn(),
    { access: PS }
  )
  return c
}

function modelLayerLocation() {
  const c = new ClassBuilder(T.location, { superName: 'java/lang/Record' })
  c.field('model', 'Lnet/minecraft/resources/Identifier;').field('layer', 'Ljava/lang/String;')
  c.method('<init>', '(Lnet/minecraft/resources/Identifier;Ljava/lang/String;)V', (m) =>
    m
      .aload(0)
      .invokespecial('java/lang/Record', '<init>', '()V')
      .aload(0)
      .aload(1)
      .putfield(T.location, 'model', 'Lnet/minecraft/resources/Identifier;')
      .aload(0)
      .aload(2)
      .putfield(T.location, 'layer', 'Ljava/lang/String;')
      .vreturn()
  )
  return c
}

function modelLayers() {
  const c = new ClassBuilder(T.layers)
  for (const f of ['DEMO', 'DEMO_BABY', 'BROKEN', 'ZOMBIE'])
    c.field(f, L(T.location), { access: PS })
  c.method(
    'register',
    `(Ljava/lang/String;)${L(T.location)}`,
    (m) =>
      m
        .newObject(T.location)
        .dup()
        .aload(0)
        .invokestatic(
          'net/minecraft/resources/Identifier',
          'withDefaultNamespace',
          '(Ljava/lang/String;)Lnet/minecraft/resources/Identifier;'
        )
        .sconst('main')
        .invokespecial(
          T.location,
          '<init>',
          '(Lnet/minecraft/resources/Identifier;Ljava/lang/String;)V'
        )
        .areturn(),
    { access: PS }
  )
  c.method(
    '<clinit>',
    '()V',
    (m) => {
      for (const [f, name] of [
        ['DEMO', 'demo'],
        ['DEMO_BABY', 'demo_baby'],
        ['BROKEN', 'broken'],
        ['ZOMBIE', 'zombie']
      ]) {
        m.sconst(name)
          .invokestatic(T.layers, 'register', `(Ljava/lang/String;)${L(T.location)}`)
          .putstatic(T.layers, f, L(T.location))
      }
      m.vreturn()
    },
    { access: ACC_STATIC }
  )
  return c
}

function layerDefinitionsRegistry() {
  const c = new ClassBuilder(T.roots)
  const MB = 'com/google/common/collect/ImmutableMap$Builder'
  const put = (m) =>
    m.invokevirtual(MB, 'put', `(Ljava/lang/Object;Ljava/lang/Object;)L${MB};`).pop()
  c.method(
    'createRoots',
    '()Ljava/util/Map;',
    (m) => {
      m.invokestatic('com/google/common/collect/ImmutableMap', 'builder', `()L${MB};`).astore(0)
      m.aload(0).getstatic(T.layers, 'DEMO', L(T.location))
      m.invokestatic(T.demo, 'createBodyLayer', `()${L(T.layer)}`)
      put(m)
      m.aload(0).getstatic(T.layers, 'DEMO_BABY', L(T.location))
      m.invokestatic(T.demo, 'createBodyLayer', `()${L(T.layer)}`)
        .ldcIndex(m.pool.float(0.5))
        .invokestatic(T.transformer, 'scaling', `(F)${L(T.transformer)}`)
        .invokevirtual(T.layer, 'apply', `(${L(T.transformer)})${L(T.layer)}`)
      put(m)
      m.aload(0).getstatic(T.layers, 'ZOMBIE', L(T.location))
      m.invokestatic(T.demo, 'createSquareLayer', `()${L(T.layer)}`)
      put(m)
      m.aload(0).getstatic(T.layers, 'BROKEN', L(T.location))
      m.invokestatic(T.broken, 'createBodyLayer', `()${L(T.layer)}`)
      put(m)
      m.aload(0)
        .invokevirtual(MB, 'buildOrThrow', '()Lcom/google/common/collect/ImmutableMap;')
        .areturn()
    },
    { access: PS }
  )
  return c
}

/** The sample model: exercises children, rotation, a loop, string concatenation, mirror, inflate, faces. */
function demoModel() {
  const c = new ClassBuilder(T.demo)
  const addChild = `(Ljava/lang/String;${L(T.list)}${L(T.pose)})${L(T.part)}`
  c.method(
    'createMesh',
    `()${L(T.mesh)}`,
    (m) => {
      m.newObject(T.mesh).dup().invokespecial(T.mesh, '<init>', '()V').astore(0)
      m.aload(0)
        .invokevirtual(T.mesh, 'getRoot', `()${L(T.part)}`)
        .astore(1)
      // body: 8x12x4 at uv(16,16), pivot (0, 12, 0)
      m.aload(1)
        .sconst('body')
        .invokestatic(T.list, 'create', `()${L(T.list)}`)
        .iconst(16)
        .iconst(16)
        .invokevirtual(T.list, 'texOffs', `(II)${L(T.list)}`)
        .fconst(-4)
        .fconst(0)
        .fconst(-2)
        .fconst(8)
        .fconst(12)
        .fconst(4)
        .invokevirtual(T.list, 'addBox', `(FFFFFF)${L(T.list)}`)
        .fconst(0)
        .fconst(12)
        .fconst(0)
        .invokestatic(T.pose, 'offset', `(FFF)${L(T.pose)}`)
        .invokevirtual(T.part, 'addOrReplaceChild', addChild)
        .astore(2)
      // head (child of body): 8x8x8 at uv(0,0), rotated 0.5 rad around x, plus a mirrored hat inflated 0.5
      m.aload(2)
        .sconst('head')
        .invokestatic(T.list, 'create', `()${L(T.list)}`)
        .fconst(-4)
        .fconst(-8)
        .fconst(-4)
        .fconst(8)
        .fconst(8)
        .fconst(8)
        .invokevirtual(T.list, 'addBox', `(FFFFFF)${L(T.list)}`)
        .iconst(32)
        .iconst(0)
        .invokevirtual(T.list, 'texOffs', `(II)${L(T.list)}`)
        .invokevirtual(T.list, 'mirror', `()${L(T.list)}`)
        .fconst(-4)
        .fconst(-8)
        .fconst(-4)
        .fconst(8)
        .fconst(8)
        .fconst(8)
        .newObject(T.deform)
        .dup()
        .ldcIndex(m.pool.float(0.5))
        .invokespecial(T.deform, '<init>', '(F)V')
        .invokevirtual(T.list, 'addBox', `(FFFFFF${L(T.deform)})${L(T.list)}`)
        .fconst(0)
        .fconst(0)
        .fconst(0)
        .ldcIndex(m.pool.float(0.5))
        .fconst(0)
        .fconst(0)
        .invokestatic(T.pose, 'offsetAndRotation', `(FFFFFF)${L(T.pose)}`)
        .invokevirtual(T.part, 'addOrReplaceChild', addChild)
        .pop()
      // legs: for (i = 0; i < 3; i++) root.addOrReplaceChild("leg" + i, 2x6x2 at uv(0,16), offset(i*3 - 3, 18, 0))
      m.iconst(0).istore(3)
      m.label('loop').iload(3).iconst(3).if_icmpge('done')
      m.aload(1)
        .iload(3)
        .concat('leg\u0001', '(I)')
        .invokestatic(T.list, 'create', `()${L(T.list)}`)
        .iconst(0)
        .iconst(16)
        .invokevirtual(T.list, 'texOffs', `(II)${L(T.list)}`)
        .fconst(-1)
        .fconst(0)
        .fconst(-1)
        .fconst(2)
        .ldcIndex(m.pool.float(6))
        .fconst(2)
        .invokevirtual(T.list, 'addBox', `(FFFFFF)${L(T.list)}`)
        .iload(3)
        .iconst(3)
        .imul()
        .iconst(3)
        .isub()
        .i2f()
        .ldcIndex(m.pool.float(18))
        .fconst(0)
        .invokestatic(T.pose, 'offset', `(FFF)${L(T.pose)}`)
        .invokevirtual(T.part, 'addOrReplaceChild', addChild)
        .pop()
        .iinc(3, 1)
        .goto('loop')
      m.label('done')
      // plate: a flat box that only shows its top and front faces
      m.aload(1)
        .sconst('plate')
        .invokestatic(T.list, 'create', `()${L(T.list)}`)
        .fconst(-2)
        .fconst(0)
        .fconst(-2)
        .ldcIndex(m.pool.float(4))
        .fconst(0)
        .ldcIndex(m.pool.float(4))
        .getstatic('net/minecraft/core/Direction', 'UP', 'Lnet/minecraft/core/Direction;')
        .getstatic('net/minecraft/core/Direction', 'NORTH', 'Lnet/minecraft/core/Direction;')
        .invokestatic(
          'java/util/Set',
          'of',
          '(Ljava/lang/Object;Ljava/lang/Object;)Ljava/util/Set;'
        )
        .invokevirtual(T.list, 'addBox', `(FFFFFFLjava/util/Set;)${L(T.list)}`)
        .fconst(0)
        .ldcIndex(m.pool.float(24))
        .fconst(0)
        .invokestatic(T.pose, 'offset', `(FFF)${L(T.pose)}`)
        .invokevirtual(T.part, 'addOrReplaceChild', addChild)
        .pop()
      m.aload(0).areturn()
    },
    { access: PS }
  )
  c.method(
    'createBodyLayer',
    `()${L(T.layer)}`,
    (m) =>
      m
        .invokestatic(T.demo, 'createMesh', `()${L(T.mesh)}`)
        .iconst(64)
        .iconst(32)
        .invokestatic(T.layer, 'create', `(${L(T.mesh)}II)${L(T.layer)}`)
        .areturn(),
    { access: PS }
  )
  c.method(
    'createSquareLayer',
    `()${L(T.layer)}`,
    (m) =>
      m
        .invokestatic(T.demo, 'createMesh', `()${L(T.mesh)}`)
        .iconst(64)
        .iconst(64)
        .invokestatic(T.layer, 'create', `(${L(T.mesh)}II)${L(T.layer)}`)
        .areturn(),
    { access: PS }
  )
  return c
}

function brokenModel() {
  const c = new ClassBuilder(T.broken)
  c.method(
    'createBodyLayer',
    `()${L(T.layer)}`,
    (m) =>
      m
        .newObject('java/lang/IllegalStateException')
        .dup()
        .invokespecial('java/lang/IllegalStateException', '<init>', '()V')
        .athrow(),
    { access: PS }
  )
  return c
}

/** Jar entries (path -> class bytes) of the synthetic model code. */
export function syntheticModelClasses() {
  const classes = [
    cubeDeformation(),
    uvPair(),
    cubeDefinition(),
    cubeListBuilder(),
    partPose(),
    partDefinition(),
    meshDefinition(),
    materialDefinition(),
    layerDefinition(),
    meshTransformer(),
    modelLayerLocation(),
    modelLayers(),
    layerDefinitionsRegistry(),
    demoModel(),
    brokenModel()
  ]
  /** @type {Record<string, Uint8Array>} */
  const out = {}
  for (const c of classes) out[`${c.name}.class`] = c.build()
  return out
}
