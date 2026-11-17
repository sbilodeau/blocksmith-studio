import { readdirSync, readFileSync } from 'fs'
import { join, resolve } from 'path'
import { describe, expect, it } from 'vitest'
import type { EntityBox, EntityDefinition, EntityPart, Vec3 } from '@shared/model/preview'
import { boxUvExtent, boxUvRects, type UvRect } from '@shared/preview/box-uv'
import { entityDefinitions, findEntityDefinition } from '@shared/preview/entities'
import { EntityDefinitionSchema } from '@shared/preview/entity-schema'
import { globToRegExp } from '@shared/categories/glob'

const MODELS_DIR = resolve(__dirname, '../../resources/data/entity-models')

/**
 * Known vanilla entity textures (pack path -> PNG size) that the built-in definitions are expected to cover, read
 * from the 1.21.4 and 26.3 client jar listings (26.3 renamed or resized some: farm animal variants, equipment).
 * Paths only: no asset is copied into the repository.
 */
const GROUPS: [folder: string, size: [number, number], names: string[]][] = [
  ['entity', [64, 32], ['chicken', 'spider_eyes']],
  ['entity/armorstand', [64, 64], ['wood']],
  [
    'entity/cat',
    [64, 32],
    [
      'all_black',
      'black',
      'british_shorthair',
      'calico',
      'cat_collar',
      'jellie',
      'ocelot',
      'persian',
      'ragdoll',
      'red',
      'siamese',
      'tabby',
      'white'
    ]
  ],
  ['entity/cow', [64, 32], ['brown_mooshroom', 'cow', 'red_mooshroom']],
  ['entity/creeper', [64, 32], ['creeper']],
  ['entity/enderman', [64, 32], ['enderman', 'enderman_eyes']],
  [
    'entity/equipment/humanoid',
    [64, 32],
    [
      'chainmail',
      'diamond',
      'gold',
      'iron',
      'leather',
      'leather_overlay',
      'netherite',
      'turtle_scute'
    ]
  ],
  [
    'entity/equipment/humanoid_leggings',
    [64, 32],
    ['chainmail', 'diamond', 'gold', 'iron', 'leather', 'leather_overlay', 'netherite']
  ],
  ['entity/pig', [64, 32], ['pig', 'pig_saddle']],
  [
    'entity/player/slim',
    [64, 64],
    ['alex', 'ari', 'efe', 'kai', 'makena', 'noor', 'steve', 'sunny', 'zuri']
  ],
  [
    'entity/player/wide',
    [64, 64],
    ['alex', 'ari', 'efe', 'kai', 'makena', 'noor', 'steve', 'sunny', 'zuri']
  ],
  ['entity/sheep', [64, 32], ['sheep', 'sheep_fur']],
  [
    'entity/skeleton',
    [64, 32],
    ['bogged', 'bogged_overlay', 'skeleton', 'stray', 'stray_overlay', 'wither_skeleton']
  ],
  ['entity/spider', [64, 32], ['cave_spider', 'spider']],
  ['entity/villager', [64, 64], ['villager']],
  [
    'entity/villager/profession',
    [64, 64],
    [
      'armorer',
      'butcher',
      'cartographer',
      'cleric',
      'farmer',
      'fisherman',
      'fletcher',
      'leatherworker',
      'librarian',
      'mason',
      'nitwit',
      'shepherd',
      'toolsmith',
      'weaponsmith'
    ]
  ],
  ['entity/villager/profession_level', [64, 64], ['diamond', 'emerald', 'gold', 'iron', 'stone']],
  [
    'entity/villager/type',
    [64, 64],
    ['desert', 'jungle', 'plains', 'savanna', 'snow', 'swamp', 'taiga']
  ],
  [
    'entity/wolf',
    [64, 32],
    [
      'wolf',
      'wolf_angry',
      'wolf_armor_crackiness_high',
      'wolf_armor_crackiness_low',
      'wolf_armor_crackiness_medium',
      'wolf_ashen',
      'wolf_ashen_angry',
      'wolf_ashen_tame',
      'wolf_black',
      'wolf_black_angry',
      'wolf_black_tame',
      'wolf_chestnut',
      'wolf_chestnut_angry',
      'wolf_chestnut_tame',
      'wolf_collar',
      'wolf_rusty',
      'wolf_rusty_angry',
      'wolf_rusty_tame',
      'wolf_snowy',
      'wolf_snowy_angry',
      'wolf_snowy_tame',
      'wolf_spotted',
      'wolf_spotted_angry',
      'wolf_spotted_tame',
      'wolf_striped',
      'wolf_striped_angry',
      'wolf_striped_tame',
      'wolf_tame',
      'wolf_woods',
      'wolf_woods_angry',
      'wolf_woods_tame'
    ]
  ],
  ['entity/zombie', [64, 64], ['drowned', 'drowned_outer_layer', 'husk', 'zombie']],
  // 26.3
  ['entity/chicken', [64, 32], ['chicken_cold', 'chicken_temperate', 'chicken_warm']],
  [
    'entity/cow',
    [64, 64],
    ['cow_cold', 'cow_temperate', 'cow_warm', 'mooshroom_brown', 'mooshroom_red']
  ],
  ['entity/pig', [64, 64], ['pig_cold', 'pig_temperate', 'pig_warm']],
  ['entity/sheep', [64, 32], ['sheep_wool', 'sheep_wool_undercoat']],
  [
    'entity/horse',
    [64, 64],
    [
      'donkey',
      'horse_black',
      'horse_brown',
      'horse_chestnut',
      'horse_creamy',
      'horse_darkbrown',
      'horse_gray',
      'horse_markings_blackdots',
      'horse_markings_white',
      'horse_markings_whitedots',
      'horse_markings_whitefield',
      'horse_skeleton',
      'horse_white',
      'horse_zombie',
      'mule'
    ]
  ],
  [
    'entity/equipment/horse_body',
    [64, 64],
    ['copper', 'diamond', 'gold', 'iron', 'leather', 'leather_overlay', 'netherite']
  ],
  ['entity/equipment/horse_saddle', [64, 64], ['saddle']],
  ['entity/equipment/donkey_saddle', [64, 64], ['saddle']],
  ['entity/equipment/mule_saddle', [64, 64], ['saddle']],
  ['entity/equipment/skeleton_horse_saddle', [64, 64], ['saddle']],
  ['entity/equipment/zombie_horse_saddle', [64, 64], ['saddle']],
  ['entity/equipment/wolf_body', [64, 32], ['armadillo_scute', 'armadillo_scute_overlay']],
  ['entity/equipment/wings', [64, 32], ['elytra']],
  ['entity/equipment/pig_saddle', [64, 64], ['saddle']],
  ['entity', [64, 64], ['wandering_trader']],
  ['entity/wandering_trader', [64, 64], ['wandering_trader']],
  // M11 additions (1.21.4 and 26.3 paths)
  // zombie_villager
  [
    'entity/zombie_villager/profession',
    [64, 64],
    [
      'armorer',
      'butcher',
      'cartographer',
      'cleric',
      'farmer',
      'fisherman',
      'fletcher',
      'leatherworker',
      'librarian',
      'mason',
      'nitwit',
      'shepherd',
      'toolsmith',
      'weaponsmith'
    ]
  ],
  [
    'entity/zombie_villager/profession_level',
    [64, 64],
    ['diamond', 'emerald', 'gold', 'iron', 'stone']
  ],
  [
    'entity/zombie_villager/type',
    [64, 64],
    ['desert', 'jungle', 'plains', 'savanna', 'snow', 'swamp', 'taiga']
  ],
  ['entity/zombie_villager', [64, 64], ['zombie_villager']],
  // iron_golem
  [
    'entity/iron_golem',
    [128, 128],
    [
      'iron_golem',
      'iron_golem_crackiness_high',
      'iron_golem_crackiness_low',
      'iron_golem_crackiness_medium'
    ]
  ],
  // fox
  [
    'entity/fox',
    [48, 32],
    ['fox', 'fox_sleep', 'fox_snow', 'fox_snow_sleep', 'snow_fox', 'snow_fox_sleep']
  ],
  // bee
  ['entity/bee', [64, 64], ['bee', 'bee_angry', 'bee_angry_nectar', 'bee_nectar']],
  // llama
  [
    'entity/equipment/llama_body',
    [128, 64],
    [
      'black',
      'blue',
      'brown',
      'cyan',
      'gray',
      'green',
      'light_blue',
      'light_gray',
      'lime',
      'magenta',
      'orange',
      'pink',
      'purple',
      'red',
      'trader_llama',
      'white',
      'yellow'
    ]
  ],
  [
    'entity/llama',
    [128, 64],
    ['brown', 'creamy', 'gray', 'llama_brown', 'llama_creamy', 'llama_gray', 'llama_white', 'white']
  ],
  // panda
  [
    'entity/panda',
    [64, 64],
    [
      'aggressive_panda',
      'brown_panda',
      'lazy_panda',
      'panda',
      'panda_aggressive',
      'panda_brown',
      'panda_lazy',
      'panda_playful',
      'panda_weak',
      'panda_worried',
      'playful_panda',
      'weak_panda',
      'worried_panda'
    ]
  ],
  // rabbit
  [
    'entity/rabbit',
    [64, 32],
    ['black', 'brown', 'caerbannog', 'gold', 'salt', 'toast', 'white', 'white_splotched']
  ],
  // piglin
  ['entity/piglin', [64, 64], ['piglin', 'piglin_brute', 'zombified_piglin']],
  // illager
  ['entity/illager', [64, 64], ['evoker', 'illusioner', 'vindicator']],
  // pillager
  ['entity/illager', [64, 64], ['pillager']],
  // witch
  ['entity', [64, 128], ['witch']],
  ['entity/witch', [64, 128], ['witch']],
  // polar_bear
  ['entity/bear', [128, 64], ['polarbear']],
  // goat
  ['entity/goat', [64, 64], ['goat']],
  // frog
  [
    'entity/frog',
    [48, 48],
    ['cold_frog', 'frog_cold', 'frog_temperate', 'frog_warm', 'temperate_frog', 'warm_frog']
  ],
  // turtle
  ['entity/turtle', [128, 64], ['big_sea_turtle', 'turtle']],
  // dolphin
  ['entity', [64, 64], ['dolphin']],
  ['entity/dolphin', [64, 64], ['dolphin']],
  // squid
  ['entity/squid', [64, 32], ['glow_squid', 'squid']]
]

const tex = (key: string): string => `assets/minecraft/textures/${key}`

/** Pack path -> [width, height] of the vanilla PNG. */
const KNOWN_ENTITY_TEXTURES: ReadonlyMap<string, [number, number]> = new Map(
  GROUPS.flatMap(([folder, size, names]) =>
    names.map((name): [string, [number, number]] => [tex(`${folder}/${name}.png`), size])
  )
)

/** Vanilla entity textures that have no built-in definition yet (they must fall back to the flat view). */
const UNCOVERED_ENTITY_TEXTURES: readonly string[] = [
  tex('entity/creeper/creeper_armor.png'),
  tex('entity/ghast/ghast.png'),
  // 26.x rabbits use a new 64 x 64 layout.
  tex('entity/rabbit/rabbit_brown.png'),
  // Baby mobs have their own layouts since 26.1.
  tex('entity/wolf/wolf_baby.png'),
  tex('entity/cow/cow_temperate_baby.png'),
  tex('entity/villager/baby/plains.png'),
  tex('entity/zombie_villager/baby/plains.png'),
  tex('block/stone.png')
]

// ---------------------------------------------------------------- rest-pose geometry helpers

type Mat3 = [Vec3, Vec3, Vec3]

/** Axis-aligned bounds in entity space. */
interface Aabb {
  min: Vec3
  max: Vec3
}

/** Affine transform (3x3 + translation) of a part in its rest pose. */
interface Transform {
  m: Mat3
  t: Vec3
}

const IDENTITY: Transform = {
  m: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1]
  ],
  t: [0, 0, 0]
}

function mul(a: Mat3, b: Mat3): Mat3 {
  const r: Mat3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0]
  ]
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) r[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j]
  return r
}

function apply(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]
  ]
}

/** Rotation applied around x first, then y, then z (matrix Rz * Ry * Rx, three.js Euler order 'ZYX'). */
function rotationMatrix(deg: Vec3): Mat3 {
  const [x, y, z] = deg.map((d) => (d * Math.PI) / 180)
  const rx: Mat3 = [
    [1, 0, 0],
    [0, Math.cos(x), -Math.sin(x)],
    [0, Math.sin(x), Math.cos(x)]
  ]
  const ry: Mat3 = [
    [Math.cos(y), 0, Math.sin(y)],
    [0, 1, 0],
    [-Math.sin(y), 0, Math.cos(y)]
  ]
  const rz: Mat3 = [
    [Math.cos(z), -Math.sin(z), 0],
    [Math.sin(z), Math.cos(z), 0],
    [0, 0, 1]
  ]
  return mul(rz, mul(ry, rx))
}

/** parent * (translate(pivot) * R * translate(-pivot)): pivots are absolute rest-pose coordinates. */
function partTransform(parent: Transform, part: EntityPart): Transform {
  if (!part.rotation) return parent
  const r = rotationMatrix(part.rotation)
  const rp = apply(r, part.pivot)
  const local: Transform = { m: r, t: [0, 1, 2].map((i) => part.pivot[i] - rp[i]) as Vec3 }
  const pt = apply(parent.m, local.t)
  return { m: mul(parent.m, local.m), t: [0, 1, 2].map((i) => pt[i] + parent.t[i]) as Vec3 }
}

interface PlacedBox {
  part: EntityPart
  box: EntityPart['boxes'][number]
  /** Rest-pose bounds of the box without inflate. */
  bounds: Aabb
}

const round = (n: number): number => Math.round(n * 1000) / 1000 + 0

/** Every box of a definition with its rest-pose bounds (part rotations applied, inflate ignored). */
function placedBoxes(def: EntityDefinition): PlacedBox[] {
  const out: PlacedBox[] = []
  const visit = (part: EntityPart, parent: Transform): void => {
    const tr = partTransform(parent, part)
    for (const box of part.boxes) {
      const min: Vec3 = [Infinity, Infinity, Infinity]
      const max: Vec3 = [-Infinity, -Infinity, -Infinity]
      for (let c = 0; c < 8; c++) {
        const corner: Vec3 = [0, 1, 2].map(
          (i) => box.origin[i] + (c & (1 << i) ? box.size[i] : 0)
        ) as Vec3
        const p = apply(tr.m, corner)
        for (let i = 0; i < 3; i++) {
          const v = round(p[i] + tr.t[i])
          min[i] = Math.min(min[i], v)
          max[i] = Math.max(max[i], v)
        }
      }
      out.push({ part, box, bounds: { min, max } })
    }
    for (const child of part.children ?? []) visit(child, tr)
  }
  for (const part of def.parts) visit(part, IDENTITY)
  return out
}

function unionBounds(boxes: PlacedBox[]): Aabb {
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const { bounds } of boxes) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], bounds.min[i])
      max[i] = Math.max(max[i], bounds.max[i])
    }
  }
  return { min, max }
}

/** Parts of a definition, depth first. */
function allParts(def: EntityDefinition): EntityPart[] {
  const out: EntityPart[] = []
  const visit = (p: EntityPart): void => {
    out.push(p)
    p.children?.forEach(visit)
  }
  def.parts.forEach(visit)
  return out
}

// ---------------------------------------------------------------- tests

const definitions = entityDefinitions()
const byId = (id: string): EntityDefinition => {
  const def = definitions.find((d) => d.id === id)
  if (!def) throw new Error(`missing definition ${id}`)
  return def
}

/** Expected rest-pose height (top of the highest non-inflated box), in pixels. */
const EXPECTED_HEIGHTS: Record<string, number> = {
  armor_stand: 30,
  cat: 12,
  chicken: 15,
  cow: 25,
  cow_variants: 24,
  donkey: 36.334,
  elytra: 24.5,
  horse: 34.624,
  pig_variants: 16,
  creeper: 26,
  drowned: 32,
  enderman: 46,
  humanoid_armor: 32,
  humanoid_leggings: 24,
  pig: 16,
  player_slim: 32,
  player_wide: 32,
  sheep: 22,
  sheep_wool: 22,
  skeleton: 32,
  skeleton_overlay: 32,
  spider: 13,
  villager: 34,
  wolf: 15.5,
  zombie: 32,
  bee: 9,
  dolphin: 13.722,
  fox: 11.5,
  frog: 8.01,
  goat: 26,
  illager: 34,
  iron_golem: 43,
  llama: 36,
  panda: 20.5,
  piglin: 32,
  pillager: 34,
  polar_bear: 19,
  rabbit: 17,
  squid: 33,
  turtle: 9,
  witch: 43.394,
  zombie_villager: 34
}

describe('entity model files', () => {
  const files = readdirSync(MODELS_DIR).filter((f) => f.endsWith('.json'))

  it('loads every JSON file of the folder, named after its id', () => {
    expect(definitions.map((d) => `${d.id}.json`).sort()).toEqual([...files].sort())
  })

  it.each(files)('%s validates against the schema', (file) => {
    const raw: unknown = JSON.parse(readFileSync(join(MODELS_DIR, file), 'utf8'))
    const result = EntityDefinitionSchema.safeParse(raw)
    expect(result.success, result.error?.message).toBe(true)
  })

  it('has unique ids, unique part names and unique roles (except wings)', () => {
    expect(new Set(definitions.map((d) => d.id)).size).toBe(definitions.length)
    for (const def of definitions) {
      const parts = allParts(def)
      expect(new Set(parts.map((p) => p.name)).size, def.id).toBe(parts.length)
      const roles = parts.map((p) => p.role).filter((r) => r && r !== 'wing')
      expect(new Set(roles).size, def.id).toBe(roles.length)
    }
  })

  it('declares the leg roles its animation needs', () => {
    const quadLegs = ['frontRightLeg', 'frontLeftLeg', 'backRightLeg', 'backLeftLeg'] as const
    for (const def of definitions) {
      const roles = new Set(allParts(def).map((p) => p.role))
      if (def.animation === 'biped') {
        expect(roles.has('rightLeg') && roles.has('leftLeg'), def.id).toBe(true)
      }
      if (def.animation === 'quadruped') {
        for (const role of quadLegs) expect(roles.has(role), `${def.id} ${role}`).toBe(true)
      }
    }
  })
})

describe('entity textures', () => {
  const known = [...KNOWN_ENTITY_TEXTURES.keys()]

  it('every texture glob matches at least one known vanilla texture', () => {
    for (const def of definitions) {
      for (const glob of def.textures) {
        const re = globToRegExp(glob)
        expect(
          known.some((p) => re.test(p)),
          `${def.id}: ${glob}`
        ).toBe(true)
      }
    }
  })

  it('every known texture resolves to exactly one definition with a matching texture size', () => {
    for (const [path, size] of KNOWN_ENTITY_TEXTURES) {
      const matching = definitions.filter((d) => d.textures.some((g) => globToRegExp(g).test(path)))
      expect(
        matching.map((d) => d.id),
        path
      ).toHaveLength(1)
      expect(matching[0].textureSize, path).toEqual(size)
      expect(findEntityDefinition(path)?.id, path).toBe(matching[0].id)
    }
  })
})

/** Non-empty face rectangles of a box layout, normalized (u1 < u2, v1 < v2). */
function faceRects(box: EntityBox): UvRect[] {
  return Object.values(boxUvRects(box))
    .map((r) => ({
      u1: Math.min(r.u1, r.u2),
      v1: Math.min(r.v1, r.v2),
      u2: Math.max(r.u1, r.u2),
      v2: Math.max(r.v1, r.v2)
    }))
    .filter((r) => r.u2 > r.u1 && r.v2 > r.v1)
}

const overlaps = (a: UvRect, b: UvRect): boolean =>
  a.u1 < b.u2 && b.u1 < a.u2 && a.v1 < b.v2 && b.v1 < a.v2

/**
 * Boxes that reuse the exact same layout (same uv and size) share their texture by design: mirrored left limbs,
 * the four legs of a quadruped, cow horns, spider legs. Any other overlap between face rectangles is an error,
 * unless listed here as "<definition id>:<box uv>:<box uv>".
 */
const ALLOWED_UV_OVERLAPS = new Set<string>([
  // Vanilla packs the two 1 x 2 x 3 antennae so that their layouts overlap by two rows.
  'bee:2,0:2,3'
])

describe('entity box UVs', () => {
  it('keeps every used face of a box UV layout inside the texture', () => {
    // Faces only: a flat plane (the frog's belly, 7 x 0 x 9) has empty side faces, and its layout may run past
    // the texture edge as in vanilla.
    for (const def of definitions) {
      const [tw, th] = def.textureSize
      for (const { part, box } of placedBoxes(def)) {
        const where = `${def.id}/${part.name} uv ${box.uv.join(',')}`
        for (const r of faceRects(box)) {
          expect(r.u1 >= 0 && r.v1 >= 0, where).toBe(true)
          expect(r.u2 <= tw && r.v2 <= th, where).toBe(true)
        }
      }
    }
  })

  it('keeps solid box layouts inside the texture', () => {
    for (const def of definitions) {
      const [tw, th] = def.textureSize
      for (const { part, box } of placedBoxes(def)) {
        if (box.size.some((n) => n === 0)) continue
        const e = boxUvExtent(box)
        const where = `${def.id}/${part.name} uv ${box.uv.join(',')}`
        expect(e.u1 >= 0 && e.v1 >= 0, where).toBe(true)
        expect(e.u2 <= tw && e.v2 <= th, where).toBe(true)
      }
    }
  })

  it('detects overlaps on used faces only (not in the unused corners of a layout)', () => {
    const hits = (a: EntityBox, b: EntityBox): boolean =>
      faceRects(a).some((ra) => faceRects(b).some((rb) => overlaps(ra, rb)))
    const head: EntityBox = { origin: [0, 0, 0], size: [8, 8, 6], uv: [0, 0] }
    // Cow horns live in the unused top-right corner of the head layout.
    expect(hits(head, { origin: [0, 0, 0], size: [1, 3, 1], uv: [22, 0] })).toBe(false)
    expect(hits(head, { origin: [0, 0, 0], size: [1, 3, 1], uv: [20, 0] })).toBe(true)
  })

  it('does not overlap the UV faces of different box layouts', () => {
    for (const def of definitions) {
      const boxes = placedBoxes(def).map((p) => p.box)
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]
          const b = boxes[j]
          const sameLayout = a.uv.join() === b.uv.join() && a.size.join() === b.size.join()
          if (sameLayout) continue
          if (ALLOWED_UV_OVERLAPS.has(`${def.id}:${a.uv.join(',')}:${b.uv.join(',')}`)) continue
          const hit = faceRects(a).some((ra) => faceRects(b).some((rb) => overlaps(ra, rb)))
          expect(hit, `${def.id}: uv ${a.uv.join(',')} vs ${b.uv.join(',')}`).toBe(false)
        }
      }
    }
  })
})

/** Parts that are off-center in vanilla too, as "<definition id>/<part name>". */
const ASYMMETRIC_PARTS = new Set<string>([
  'slime/mouth',
  // The witch's hat leans to one side; the mole sits on one side of the nose.
  'witch/hat2',
  'witch/hat3',
  'witch/hat4',
  'witch/mole',
  // Vanilla sets the strider's left bristles 1 px higher than the right ones.
  'strider/right_bottom_bristle',
  'strider/right_middle_bristle',
  'strider/right_top_bristle',
  'strider/left_top_bristle',
  'strider/left_middle_bristle',
  'strider/left_bottom_bristle'
])

describe('entity rest-pose geometry', () => {
  it('stands on y = 0 (spider legs end within a pixel of the ground)', () => {
    for (const def of definitions) {
      const { min } = unionBounds(placedBoxes(def))
      if (def.id === 'sheep_wool') {
        // The wool only covers the upper half of the 12 px legs.
        expect(min[1], def.id).toBe(6)
      } else if (def.id === 'elytra') {
        // Worn on the back: hangs from the shoulders (y = 24), tilted, so it ends above the ground.
        expect(min[1], def.id).toBeGreaterThan(0)
      } else if (def.id === 'rabbit') {
        // The front paws are tilted 10 degrees and dip 0.07 px into the ground, as in vanilla.
        expect(min[1], def.id).toBeGreaterThan(-0.1)
        expect(min[1], def.id).toBeLessThanOrEqual(0)
      } else if (def.id === 'spider') {
        expect(min[1], def.id).toBeGreaterThanOrEqual(0)
        expect(min[1], def.id).toBeLessThan(1)
      } else {
        expect(min[1], def.id).toBe(0)
      }
    }
  })

  it.each(Object.entries(EXPECTED_HEIGHTS))('%s is %d px tall', (id, height) => {
    expect(unionBounds(placedBoxes(byId(id))).max[1]).toBe(height)
  })

  it('has a height expectation for every definition', () => {
    expect(Object.keys(EXPECTED_HEIGHTS).sort()).toEqual(definitions.map((d) => d.id).sort())
  })

  it('is symmetric around x = 0 (every box has a mirror twin, or is centered)', () => {
    const key = (min: Vec3, max: Vec3): string => [...min, ...max].map((n) => n + 0).join(',')
    for (const def of definitions) {
      const placed = placedBoxes(def)
      const all = new Set(placed.map((p) => key(p.bounds.min, p.bounds.max)))
      for (const { part, bounds } of placed) {
        if (ASYMMETRIC_PARTS.has(`${def.id}/${part.name}`)) continue
        const mirrored = key(
          [-bounds.max[0], bounds.min[1], bounds.min[2]],
          [-bounds.min[0], bounds.max[1], bounds.max[2]]
        )
        expect(all.has(mirrored), `${def.id}/${part.name}`).toBe(true)
      }
    }
  })

  it('faces +z: the head is in front of the body for animals', () => {
    for (const id of [
      'cat',
      'chicken',
      'cow',
      'pig',
      'sheep',
      'sheep_wool',
      'spider',
      'wolf',
      'dolphin',
      'fox',
      'goat',
      'llama',
      'panda',
      'polar_bear',
      'rabbit',
      'turtle'
    ]) {
      const placed = placedBoxes(byId(id))
      const head = unionBounds(placed.filter((p) => p.part.role === 'head'))
      const body = unionBounds(placed.filter((p) => p.part.role === 'body'))
      expect(head.max[2], id).toBeGreaterThan(body.max[2])
    }
  })

  describe.each(definitions.filter((d) => d.animation === 'biped').map((d) => d.id))(
    'biped %s',
    (id) => {
      const placed = placedBoxes(byId(id))
      const role = (r: EntityPart['role']): Aabb =>
        unionBounds(placed.filter((p) => p.part.role === r && !p.box.inflate))
      const has = (r: EntityPart['role']): boolean => placed.some((p) => p.part.role === r)
      // Armor layers are all inflated: use every box for them.
      const roleAny = (r: EntityPart['role']): Aabb =>
        unionBounds(placed.filter((p) => p.part.role === r))
      const bounds = (r: EntityPart['role']): Aabb =>
        placed.some((p) => p.part.role === r && !p.box.inflate) ? role(r) : roleAny(r)
      const body = bounds('body')

      it('puts the head on top of the body', () => {
        if (!has('head')) return
        const head = bounds('head')
        // The enderman's head overlaps its body by 1 px (as in vanilla).
        expect(head.min[1]).toBeGreaterThanOrEqual(body.max[1] - 1)
        expect(head.min[1]).toBeLessThanOrEqual(body.max[1])
      })

      it('puts the legs under the body, on the ground, right leg at -x', () => {
        for (const r of ['rightLeg', 'leftLeg'] as const) {
          const leg = bounds(r)
          expect(leg.min[1]).toBe(0)
          expect(leg.max[1]).toBeLessThanOrEqual(body.min[1] + 3)
        }
        expect(bounds('rightLeg').max[0]).toBeLessThanOrEqual(0.1)
        expect(bounds('leftLeg').min[0]).toBeGreaterThanOrEqual(-0.1)
      })

      it('puts the arms beside the body, right arm at -x', () => {
        if (!has('rightArm')) return
        expect(bounds('rightArm').max[0]).toBeLessThanOrEqual(body.min[0])
        expect(bounds('leftArm').min[0]).toBeGreaterThanOrEqual(body.max[0])
      })
    }
  )

  it('matches the classic biped numbers', () => {
    const part = (def: EntityDefinition, name: string): EntityPart => {
      const p = def.parts.find((q) => q.name === name)
      if (!p) throw new Error(`${def.id} has no part ${name}`)
      return p
    }
    const zombie = byId('zombie')
    expect(part(zombie, 'head').boxes).toEqual([
      { origin: [-4, 24, -4], size: [8, 8, 8], uv: [0, 0] },
      { origin: [-4, 24, -4], size: [8, 8, 8], uv: [32, 0], inflate: 0.5 }
    ])
    expect(part(zombie, 'body').boxes).toEqual([
      { origin: [-4, 12, -2], size: [8, 12, 4], uv: [16, 16] }
    ])
    expect(part(zombie, 'right_arm').boxes).toEqual([
      { origin: [-8, 12, -2], size: [4, 12, 4], uv: [40, 16] }
    ])
    expect(part(zombie, 'left_arm').boxes).toEqual([
      { origin: [4, 12, -2], size: [4, 12, 4], uv: [40, 16], mirror: true }
    ])
    expect(part(zombie, 'right_leg').boxes).toEqual([
      { origin: [-3.9, 0, -2], size: [4, 12, 4], uv: [0, 16] }
    ])
    expect(part(zombie, 'left_leg').boxes).toEqual([
      { origin: [-0.1, 0, -2], size: [4, 12, 4], uv: [0, 16], mirror: true }
    ])

    const steve = byId('player_wide')
    expect(part(steve, 'left_arm').boxes).toEqual([
      { origin: [4, 12, -2], size: [4, 12, 4], uv: [32, 48] },
      { origin: [4, 12, -2], size: [4, 12, 4], uv: [48, 48], inflate: 0.25 }
    ])
    expect(part(steve, 'left_leg').boxes.map((b) => b.uv)).toEqual([
      [16, 48],
      [0, 48]
    ])
    expect(part(byId('player_slim'), 'right_arm').boxes[0].size).toEqual([3, 12, 4])
    expect(part(byId('skeleton'), 'right_arm').boxes[0].size).toEqual([2, 12, 2])
  })

  it('lays the animal bodies down with the back texture on top and the belly below', () => {
    // Bodies are authored standing (as their texture layout requires) and rotated 90 degrees around x.
    // With that rotation the layout's "back" face ends up on top, "front" on the belly, "top" at the neck.
    for (const id of [
      'pig',
      'cow',
      'sheep',
      'sheep_wool',
      'wolf',
      'cat',
      'chicken',
      'fox',
      'llama',
      'panda',
      'polar_bear',
      'turtle'
    ]) {
      const body = byId(id).parts.find((p) => p.name === 'body')
      expect(body?.rotation, id).toEqual([90, 0, 0])
      const r = rotationMatrix([90, 0, 0])
      const up = (n: Vec3): number => round(apply(r, n)[1])
      const forward = (n: Vec3): number => round(apply(r, n)[2])
      expect(up([0, 0, -1]), `${id}: back face (-z) points up`).toBe(1)
      expect(up([0, 0, 1]), `${id}: front face (+z) points down`).toBe(-1)
      expect(forward([0, 1, 0]), `${id}: top face (+y) points forward`).toBe(1)
    }
  })
})

describe('findEntityDefinition (uncovered textures)', () => {
  it('returns undefined for textures without a definition', () => {
    for (const path of UNCOVERED_ENTITY_TEXTURES) {
      expect(findEntityDefinition(path), path).toBeUndefined()
    }
  })
})
