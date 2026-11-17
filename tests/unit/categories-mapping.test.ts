import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CATEGORY_RULES,
  FALLBACK_CATEGORY,
  categorizePath,
  categoryRulesKey,
  countCategoryMatches,
  countGlobMatches,
  createCategoryEngine,
  globIssue,
  isBuiltinCategory,
  mergeCategoryRules,
  newCategoryId,
  resolveCategoryRules,
  userCategoryRules,
  validateCategoryRules,
  type CategoryRule
} from '@shared/categories'
import { ProjectSchema } from '@shared/model/pack'

const tex = (key: string): string => `assets/minecraft/textures/${key}`

const rule = (id: string, include: string[], extra: Partial<CategoryRule> = {}): CategoryRule => ({
  id,
  i18nKey: `category.${id}`,
  icon: '',
  include,
  order: 10,
  ...extra
})

const custom = (id: string, label: string, include: string[], order = 500): CategoryRule => ({
  id,
  label,
  icon: '',
  include,
  order
})

describe('category engine with custom and hidden categories', () => {
  it('keeps custom labels and leaves hidden categories out of matching and of the rules', () => {
    const engine = createCategoryEngine([
      rule('blocks', ['block/**'], { order: 10 }),
      rule('ores', ['block/*_ore.png'], { order: 20, hidden: true }),
      custom('swords', 'My swords', ['item/*_sword.png'], 30)
    ])
    expect(engine.rules.map((r) => r.id)).toEqual(['blocks', 'swords', FALLBACK_CATEGORY])
    expect(engine.rules[1]).toMatchObject({ label: 'My swords' })
    expect(engine.categorize(tex('block/diamond_ore.png'))).toEqual(['blocks'])
    expect(engine.categorize(tex('item/iron_sword.png'))).toEqual(['swords'])
    expect(engine.categorize(tex('item/apple.png'))).toEqual([FALLBACK_CATEGORY])
  })

  it('never hides the fallback category', () => {
    const engine = createCategoryEngine([
      rule('other', [], { order: 1000, hidden: true }),
      rule('blocks', ['block/**'])
    ])
    expect(engine.rules.map((r) => r.id)).toEqual(['blocks', 'other'])
    expect(engine.rules[1]!.hidden).toBeFalsy()
    expect(engine.categorize(tex('item/apple.png'))).toEqual(['other'])
  })

  it('ignores a glob that cannot compile instead of throwing', () => {
    const engine = createCategoryEngine([rule('a', ['x/(*.png', 'x/*.png'])])
    expect(engine.categorize(tex('x/y.png'))).toEqual(['a'])
  })
})

describe('scopes', () => {
  it('uses the defaults when there is no user mapping', () => {
    const rules = userCategoryRules(null)
    expect(rules).toEqual(DEFAULT_CATEGORY_RULES)
    expect(rules).not.toBe(DEFAULT_CATEGORY_RULES)
    expect(categoryRulesKey(rules)).toBe(categoryRulesKey(DEFAULT_CATEGORY_RULES))
  })

  it('appends built-in categories missing from a saved mapping (added by a newer version)', () => {
    const saved = [rule('blocks', ['block/stone.png']), custom('mine', 'Mine', ['item/**'])]
    const rules = userCategoryRules(saved)
    expect(rules.slice(0, 2)).toEqual(saved)
    expect(rules.map((r) => r.id)).toEqual([
      'blocks',
      'mine',
      ...DEFAULT_CATEGORY_RULES.map((r) => r.id).filter((id) => id !== 'blocks')
    ])
  })

  it('pack rules replace a category by id (same position) or add one at the end', () => {
    const base = [rule('blocks', ['block/**']), rule('tools', ['item/*_pickaxe.png'])]
    const merged = mergeCategoryRules(base, [
      rule('blocks', ['block/stone.png'], { icon: 'x' }),
      custom('fire', 'Fire', ['block/fire_*.png'])
    ])
    expect(merged.map((r) => r.id)).toEqual(['blocks', 'tools', 'fire'])
    expect(merged[0]).toMatchObject({ include: ['block/stone.png'], icon: 'x' })
    expect(mergeCategoryRules(base, undefined)).toEqual(base)
  })

  it('resolves user mapping + pack rules, and a pack can hide a category', () => {
    const rules = resolveCategoryRules(null, [
      { ...DEFAULT_CATEGORY_RULES.find((r) => r.id === 'ores')!, hidden: true },
      custom('fire', 'Fire', ['block/fire_*.png'])
    ])
    const engine = createCategoryEngine(rules)
    expect(engine.categorize(tex('block/diamond_ore.png'))).toEqual(['blocks'])
    expect(engine.categorize(tex('block/fire_0.png'))).toEqual(['blocks', 'fire'])
    expect(engine.rules.some((r) => r.id === 'ores')).toBe(false)
    expect(engine.rules.find((r) => r.id === 'fire')?.label).toBe('Fire')
  })
})

describe('validation', () => {
  it('flags glob mistakes', () => {
    expect(globIssue('block/*.png')).toBeNull()
    expect(globIssue('item/{apple,bread}.png')).toBeNull()
    expect(globIssue('')).toBe('empty')
    expect(globIssue('   ')).toBe('empty')
    expect(globIssue('item/{apple,bread.png')).toBe('braces')
    expect(globIssue('item/apple}.png')).toBe('braces')
    expect(globIssue('/block/*.png')).toBe('absolute')
    expect(globIssue('block\\stone.png')).toBe('backslash')
    expect(globIssue(`block/${'a'.repeat(600)}`)).toBe('tooLong')
  })

  it('accepts the default mapping', () => {
    expect(validateCategoryRules(DEFAULT_CATEGORY_RULES)).toEqual([])
  })

  it('reports ids, labels, hidden fallback and globs with their position', () => {
    const issues = validateCategoryRules([
      rule('blocks', ['block/**', 'block/{a']),
      rule('blocks', ['x/**']),
      { id: 'mine', icon: '', include: [], order: 1, label: '  ' },
      rule('other', [], { hidden: true, exclude: ['/abs'] }),
      { ...rule('Bad Id', []) }
    ])
    expect(issues.map((i) => [i.code, i.index, i.field, i.globIndex, i.globIssue])).toEqual([
      ['glob', 0, 'include', 1, 'braces'],
      ['duplicateId', 1, undefined, undefined, undefined],
      ['labelRequired', 2, undefined, undefined, undefined],
      ['fallbackHidden', 3, undefined, undefined, undefined],
      ['glob', 3, 'exclude', 0, 'absolute'],
      ['invalidId', 4, undefined, undefined, undefined]
    ])
  })

  it('built-in categories do not need a label', () => {
    expect(isBuiltinCategory('ores')).toBe(true)
    expect(isBuiltinCategory('mine')).toBe(false)
    expect(
      validateCategoryRules([{ id: 'ores', icon: '', include: [], order: 1, label: 'x' }])
    ).toEqual([])
  })
})

describe('live feedback helpers', () => {
  const paths = [
    tex('block/stone.png'),
    tex('block/diamond_ore.png'),
    tex('item/iron_sword.png'),
    tex('item/apple.png')
  ]
  const rules = [
    rule('blocks', ['block/**'], { order: 1 }),
    custom('swords', 'Swords', ['item/*_sword.png'], 2)
  ]

  it('counts textures per category, fallback included', () => {
    expect(countCategoryMatches(rules, paths)).toEqual({ blocks: 2, swords: 1, other: 1 })
  })

  it('counts the paths one glob matches (0 when invalid)', () => {
    expect(countGlobMatches('block/*', paths)).toBe(2)
    expect(countGlobMatches('**/*_sword.png', paths)).toBe(1)
    expect(countGlobMatches('block/{a', paths)).toBe(0)
  })

  it('categorizes a typed key or pack path', () => {
    expect(categorizePath(rules, 'item/gold_sword.png')).toEqual(['swords'])
    expect(categorizePath(rules, ' assets/mymod/textures/block/x.png ')).toEqual(['blocks'])
    expect(categorizePath(rules, 'misc/x.png')).toEqual(['other'])
  })

  it('derives unique ids from labels', () => {
    expect(newCategoryId('Épées de feu', [])).toBe('epees_de_feu')
    expect(newCategoryId('Tools', ['tools'])).toBe('tools_2')
    expect(newCategoryId('Tools', ['tools', 'tools_2'])).toBe('tools_3')
    expect(newCategoryId('!!!', [])).toBe('custom')
  })
})

describe('project categoryOverrides', () => {
  const project = {
    schemaVersion: 1,
    id: 'p',
    name: 'P',
    description: '',
    authoringVersion: '26.3',
    base: 'vanilla',
    createdAt: 'x',
    updatedAt: 'x'
  }

  it('is optional and keeps valid rules', () => {
    expect(ProjectSchema.parse(project).categoryOverrides).toBeUndefined()
    const overrides = [custom('fire', 'Fire', ['block/fire_*.png'])]
    expect(
      ProjectSchema.parse({ ...project, categoryOverrides: overrides }).categoryOverrides
    ).toEqual(overrides)
  })

  it('drops an invalid value instead of rejecting the whole project', () => {
    const parsed = ProjectSchema.safeParse({
      ...project,
      categoryOverrides: [{ id: 'NOPE', include: 3 }]
    })
    expect(parsed.success).toBe(true)
    expect(parsed.data?.categoryOverrides).toBeUndefined()
  })
})
