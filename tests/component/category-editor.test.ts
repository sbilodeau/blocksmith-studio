import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, nextTick } from 'vue'
import { NMessageProvider } from 'naive-ui'
import { DEFAULT_CATEGORY_RULES, type CategoryRule } from '@shared/categories'
import type { CategorySummary } from '@shared/model/pack'
import CategoryEditorDialog from '@renderer/components/pack/CategoryEditorDialog.vue'
import CategorySidebar from '@renderer/components/pack/CategorySidebar.vue'
import CategoryOverview from '@renderer/components/pack/CategoryOverview.vue'
import { usePackStore } from '@renderer/stores/pack'
import { createAppI18n } from '@renderer/i18n'
import { fakeBridge } from './setup'
import { TEXTURES } from './fixtures'

/** Answers of the category channels (the shared fake bridge does not know them). */
const categoryState = {
  rules: [] as CategoryRule[],
  customized: false,
  overrides: [] as CategoryRule[]
}

type InvokeFn = (channel: string, payload?: unknown) => Promise<unknown>
const invoke = vi.mocked(window.blocksmith.invoke as unknown as InvokeFn)
const baseInvoke = invoke.getMockImplementation()!

function categoryHandler(channel: string, payload: unknown): unknown {
  switch (channel) {
    case 'categories.get':
      return { rules: categoryState.rules, customized: categoryState.customized }
    case 'categories.save':
      categoryState.rules = (payload as { rules: CategoryRule[] }).rules
      return { rules: categoryState.rules, customized: true }
    case 'categories.reset':
      return { rules: [...DEFAULT_CATEGORY_RULES], customized: false }
    case 'pack.categoryOverrides':
      return categoryState.overrides
    case 'pack.setCategoryOverrides':
      return (payload as { overrides: CategoryRule[] }).overrides
    default:
      return undefined
  }
}

function mountIn(component: unknown, props: Record<string, unknown>): VueWrapper {
  const pinia = createPinia()
  setActivePinia(pinia)
  usePackStore('fire').textures = TEXTURES
  const Host = defineComponent({
    setup: () => () => h(NMessageProvider, () => h(component as never, props))
  })
  return mount(Host, { global: { plugins: [pinia, createAppI18n()] }, attachTo: document.body })
}

const $ = <T extends Element = HTMLElement>(testId: string): T | null =>
  document.querySelector<T>(`[data-testid="${testId}"]`)

async function type(testId: string, value: string): Promise<void> {
  const input = $(testId)!.querySelector('input')!
  input.value = value
  input.dispatchEvent(new Event('input'))
  await nextTick()
}

/** Counts are debounced. */
async function settle(): Promise<void> {
  await flushPromises()
  await new Promise((r) => setTimeout(r, 200))
  await flushPromises()
}

function calls(channel: string): unknown[] {
  return fakeBridge.calls.filter((c) => c.channel === channel).map((c) => c.payload)
}

describe('CategoryEditorDialog', () => {
  let wrapper: VueWrapper | undefined

  beforeEach(() => {
    fakeBridge.calls = []
    categoryState.rules = DEFAULT_CATEGORY_RULES.map((r) => ({ ...r }))
    categoryState.customized = false
    categoryState.overrides = []
    invoke.mockImplementation(async (channel: string, payload?: unknown) => {
      const value = categoryHandler(channel, payload)
      if (value === undefined) return baseInvoke(channel, payload)
      fakeBridge.calls.push({ channel, payload })
      return { ok: true, value }
    })
  })

  afterEach(() => {
    wrapper?.unmount()
    invoke.mockImplementation(baseInvoke)
  })

  it('loads both scopes and shows live counts for the pack', async () => {
    wrapper = mountIn(CategoryEditorDialog, { packId: 'fire', show: true })
    await settle()
    expect(calls('categories.get')).toHaveLength(1)
    expect(calls('pack.categoryOverrides')).toEqual([{ packId: 'fire' }])
    // stone, dirt and diamond_ore are blocks; the overview counts them for this pack.
    expect($('cat-rule-blocks')!.textContent).toContain('Blocks')
    expect($('cat-rule-blocks')!.textContent).toContain('3')
    expect($('cat-rule-ores')!.textContent).toContain('1')
    // Nothing changed yet.
    expect($<HTMLButtonElement>('cat-save')!.disabled).toBe(true)
  })

  it('adds a custom category, flags an invalid pattern inline and saves "All packs"', async () => {
    wrapper = mountIn(CategoryEditorDialog, { packId: 'fire', show: true })
    await settle()
    await type('cat-new-name', 'Shiny things')
    $<HTMLButtonElement>('cat-add')!.click()
    await settle()
    expect($('cat-rule-shiny_things')!.textContent).toContain('Shiny things')
    expect(($('cat-edit-label')!.querySelector('input') as HTMLInputElement).value).toBe(
      'Shiny things'
    )

    $<HTMLButtonElement>('glob-add-include')!.click()
    await nextTick()
    await type('glob-include-0', 'block/{diamond')
    await settle()
    expect($('glob-include-0')!.textContent).toContain('Unbalanced')
    expect($('cat-rule-shiny_things')!.classList.contains('invalid')).toBe(true)
    expect($<HTMLButtonElement>('cat-save')!.disabled).toBe(true)
    expect(document.body.textContent).toContain('Fix the highlighted problems before saving.')

    await type('glob-include-0', 'block/*_ore.png')
    await settle()
    expect($('glob-include-0')!.textContent).toContain('1 texture')
    expect($('cat-rule-shiny_things')!.textContent).toContain('1')

    // Test a path against the edited mapping.
    await type('cat-test-path', 'block/diamond_ore.png')
    expect($('cat-test-result')!.textContent).toContain('Blocks')
    expect($('cat-test-result')!.textContent).toContain('Ores')
    expect($('cat-test-result')!.textContent).toContain('Shiny things')

    $<HTMLButtonElement>('cat-save')!.click()
    await flushPromises()
    const [saved] = calls('categories.save') as Array<{ rules: CategoryRule[] }>
    expect(saved!.rules.at(-1)).toEqual({
      id: 'shiny_things',
      label: 'Shiny things',
      icon: '',
      include: ['block/*_ore.png'],
      order: 120
    })
    expect(saved!.rules).toHaveLength(DEFAULT_CATEGORY_RULES.length + 1)
    expect(calls('pack.setCategoryOverrides')).toEqual([])
  })

  it('built-in categories can be hidden but not deleted; custom ones can be deleted', async () => {
    categoryState.rules = [
      ...DEFAULT_CATEGORY_RULES,
      { id: 'mine', label: 'Mine', icon: '', include: ['item/**'], order: 120 }
    ]
    categoryState.customized = true
    wrapper = mountIn(CategoryEditorDialog, { packId: 'fire', show: true })
    await settle()
    $<HTMLButtonElement>('cat-rule-ores')!.click()
    await nextTick()
    expect($('cat-delete')).toBeNull()
    $<HTMLElement>('cat-edit-hidden')!.click()
    await settle()
    expect($('cat-rule-ores')!.textContent).toContain('Hidden')

    $<HTMLButtonElement>('cat-rule-other')!.click()
    await nextTick()
    expect($('cat-delete')).toBeNull()
    expect($('cat-edit-hidden')).toBeNull()

    $<HTMLButtonElement>('cat-rule-mine')!.click()
    await nextTick()
    $<HTMLButtonElement>('cat-delete')!.click()
    await nextTick()
    expect($('cat-rule-mine')).toBeNull()

    $<HTMLButtonElement>('cat-save')!.click()
    await flushPromises()
    const [saved] = calls('categories.save') as Array<{ rules: CategoryRule[] }>
    expect(saved!.rules.some((r) => r.id === 'mine')).toBe(false)
    expect(saved!.rules.find((r) => r.id === 'ores')?.hidden).toBe(true)
  })

  it('"This pack" replaces a category for the pack only', async () => {
    wrapper = mountIn(CategoryEditorDialog, { packId: 'fire', show: true })
    await settle()
    ;(document.querySelectorAll('.n-tabs-tab')[1] as HTMLElement).click()
    await settle()
    expect(document.body.textContent).toContain('This pack uses the "All packs" categories')
    await type('cat-new-name', 'Pack only')
    const addButtons = document.querySelectorAll<HTMLButtonElement>('[data-testid="cat-add"]')
    addButtons[addButtons.length - 1]!.click()
    await settle()
    const pane = $('cat-editor-pack')!
    expect(pane.querySelector('[data-testid="cat-rule-pack_only"]')!.textContent).toContain(
      'This pack only'
    )
    pane.querySelector<HTMLButtonElement>('[data-testid="glob-add-include"]')!.click()
    await nextTick()
    const input = pane.querySelector('[data-testid="glob-include-0"] input') as HTMLInputElement
    input.value = 'item/**'
    input.dispatchEvent(new Event('input'))
    await settle()

    $<HTMLButtonElement>('cat-save')!.click()
    await flushPromises()
    expect(calls('categories.save')).toEqual([])
    expect(calls('pack.setCategoryOverrides')).toEqual([
      {
        packId: 'fire',
        overrides: [
          { id: 'pack_only', label: 'Pack only', icon: '', include: ['item/**'], order: 120 }
        ]
      }
    ])
  })

  it('reset to defaults removes the user mapping', async () => {
    categoryState.rules = [
      ...DEFAULT_CATEGORY_RULES,
      { id: 'mine', label: 'Mine', icon: '', include: ['item/**'], order: 120 }
    ]
    categoryState.customized = true
    wrapper = mountIn(CategoryEditorDialog, { packId: 'fire', show: true })
    await settle()
    $<HTMLButtonElement>('cat-reset')!.click()
    await settle()
    const confirm = [...document.querySelectorAll<HTMLButtonElement>('.n-popconfirm button')].at(
      -1
    )!
    confirm.click()
    await settle()
    expect($('cat-rule-mine')).toBeNull()
    $<HTMLButtonElement>('cat-save')!.click()
    await flushPromises()
    expect(calls('categories.reset')).toHaveLength(1)
    expect(calls('categories.save')).toEqual([])
  })
})

describe('category names in the navigator', () => {
  const categories: CategorySummary[] = [
    { id: 'blocks', i18nKey: 'category.blocks', count: 3, changedCount: 0 },
    { id: 'shiny', label: 'Shiny things', count: 1, changedCount: 0 }
  ]

  it('show the custom label, else the translated name, and the edit button opens the editor', async () => {
    const sidebar = mountIn(CategorySidebar, {
      categories,
      active: null,
      total: 4,
      changed: 0,
      packId: 'fire'
    })
    expect($('cat-blocks')!.textContent).toContain('Blocks')
    expect($('cat-shiny')!.textContent).toContain('Shiny things')
    $<HTMLButtonElement>('edit-categories')!.click()
    await settle()
    expect($('cat-editor-global')).not.toBeNull()
    sidebar.unmount()

    const overview = mountIn(CategoryOverview, { categories })
    expect($('overview-shiny')!.textContent).toContain('Shiny things')
    overview.unmount()
  })
})
