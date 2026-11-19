import { beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, ref } from 'vue'
import { NDialogProvider, NMessageProvider, NSelect } from 'naive-ui'
import { createMemoryHistory, createRouter } from 'vue-router'
import { CustomItemSchema, type CustomItem } from '@shared/items/schema'
import { itemPreset } from '@shared/items/presets'
import { routes } from '@renderer/router'
import { createAppI18n } from '@renderer/i18n'
import { useItemsStore } from '@renderer/stores/items'
import { useDataStore } from '@renderer/stores/data'
import { packSections } from '@renderer/stores/pack'
import ItemList from '@renderer/components/items/ItemList.vue'
import NewItemDialog from '@renderer/components/items/NewItemDialog.vue'
import ItemEditor from '@renderer/components/items/ItemEditor.vue'
import ItemPicker from '@renderer/components/items/ItemPicker.vue'
import DataEditor from '@renderer/components/data/DataEditor.vue'
import PackDoctorDrawer from '@renderer/components/pack/PackDoctorDrawer.vue'
import { fakeBridge } from './setup'

function weapon(
  id = 'ruby_sword',
  names: Record<string, string> = { en_us: 'Ruby Sword' }
): CustomItem {
  return CustomItemSchema.parse({
    schemaVersion: 1,
    id,
    namespace: 'my_pack',
    names,
    ...itemPreset('weapon').item
  })
}

/** Mounts `component` in the providers it needs; `props` may be a getter (reactive props). */
function mountWith(
  component: unknown,
  props: Record<string, unknown> | (() => Record<string, unknown>),
  stubs: Record<string, boolean> = {}
): VueWrapper {
  const read = typeof props === 'function' ? props : () => props
  const Host = defineComponent({
    setup: () => () =>
      h(NDialogProvider, () => h(NMessageProvider, () => h(component as never, read())))
  })
  const router = createRouter({ history: createMemoryHistory(), routes })
  return mount(Host, {
    global: { plugins: [createAppI18n(), router], stubs },
    attachTo: document.body
  })
}

const $ = <T extends Element = HTMLElement>(testId: string): T | null =>
  document.querySelector<T>(`[data-testid="${testId}"]`)

function click(testId: string): void {
  const el = $(testId)
  if (!el) throw new Error(`no ${testId}`)
  el.click()
}

/** Types into the input of a Naive UI input / input-number wrapper. */
function type(testId: string, value: string): void {
  const input = document.querySelector(`[data-testid="${testId}"] input`) as HTMLInputElement
  input.value = value
  input.dispatchEvent(new Event('input'))
}

function blur(testId: string): void {
  const input = document.querySelector(
    `[data-testid="${testId}"] input, [data-testid="${testId}"] textarea`
  ) as HTMLInputElement
  input.dispatchEvent(new Event('blur'))
  input.dispatchEvent(new FocusEvent('focusout'))
}

/** Clicks the radio input inside a Naive UI radio button. */
function radio(testId: string): void {
  const input = document.querySelector(`[data-testid="${testId}"] input`) as HTMLInputElement
  input.click()
}

function buttonByText(text: string): HTMLButtonElement {
  const button = [...document.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === text
  )
  if (!button) throw new Error(`no button "${text}"`)
  return button as HTMLButtonElement
}

beforeEach(() => {
  setActivePinia(createPinia())
  fakeBridge.calls = []
  const sword = weapon()
  fakeBridge.itemDefs = { ruby_sword: sword }
  fakeBridge.itemList = {
    items: [
      {
        id: 'ruby_sword',
        namespace: 'my_pack',
        kind: 'weapon',
        base: sword.base,
        names: { en_us: 'Ruby Sword', fr_fr: 'Épée en rubis' },
        texture: 'assets/my_pack/textures/item/ruby_sword.png',
        hasTexture: true
      }
    ],
    invalid: [],
    namespace: 'my_pack'
  }
  fakeBridge.itemCatalog = {
    version: '26.3',
    items: [
      { id: 'minecraft:stick', name: 'Stick', icon: 'assets/minecraft/textures/item/stick.png' },
      { id: 'minecraft:apple', name: 'Apple', icon: 'assets/minecraft/textures/item/apple.png' },
      { id: 'minecraft:stone_sword', name: 'Stone Sword' }
    ],
    tags: ['#minecraft:planks']
  }
  fakeBridge.baseRecipeUses = []
  fakeBridge.dataList = { entries: [], vanillaData: true, ids: { items: [], blocks: [], tags: {} } }
  fakeBridge.dataFiles = {}
  fakeBridge.doctor = { issues: [], targets: [], files: 0 }
  document.body.innerHTML = ''
})

describe('items store', () => {
  it('loads the list, opens an item and tracks unsaved and invalid changes', async () => {
    const store = useItemsStore('p1')
    await store.load()
    expect(store.items.map((i) => i.id)).toEqual(['ruby_sword'])
    expect(store.namespace).toBe('my_pack')
    await store.open('ruby_sword')
    expect(store.editing).toBe('ruby_sword')
    expect(store.dirty).toBe(false)
    expect(store.valid).toBe(true)
    store.draft!.weapon!.attackDamage = 9
    expect(store.dirty).toBe(true)
    // Undoing the change by hand makes the form clean again.
    store.draft!.weapon!.attackDamage = 7
    expect(store.dirty).toBe(false)
    ;(store.draft!.weapon as Record<string, unknown>)['attackDamage'] = null
    expect(store.valid).toBe(false)
    await expect(store.save()).rejects.toThrow('items.invalid')
    expect(fakeBridge.calls.some((c) => c.channel === 'items.save')).toBe(false)
  })

  it('saves the parsed definition, renames, and closes when the item is gone', async () => {
    const store = useItemsStore('p1')
    await store.load()
    await store.open('ruby_sword')
    store.draft!.weapon!.attackDamage = 9
    store.draft!.id = 'great_sword'
    await store.save()
    const save = fakeBridge.calls.find((c) => c.channel === 'items.save')!.payload as {
      id: string
      item: CustomItem
    }
    expect(save.id).toBe('ruby_sword')
    expect(save.item.id).toBe('great_sword')
    expect(save.item.weapon).toEqual({ attackDamage: 9, attackSpeed: 1.6 })
    expect(store.editing).toBe('great_sword')
    expect(store.dirty).toBe(false)
    expect(store.items.map((i) => i.id)).toEqual(['great_sword'])
    // An undo removed the item: the page closes.
    delete fakeBridge.itemDefs['great_sword']
    await store.refresh()
    expect(store.editing).toBeNull()
  })

  it('fetches the catalog once', async () => {
    const store = useItemsStore('p1')
    await Promise.all([store.loadCatalog(), store.loadCatalog()])
    await store.loadCatalog()
    expect(fakeBridge.calls.filter((c) => c.channel === 'items.catalog')).toHaveLength(1)
    expect(store.vanillaName('minecraft:stick')).toBe('Stick')
    expect(store.iconUrl('minecraft:stick')).toContain('vanilla/26.3/assets/minecraft')
  })
})

describe('item list', () => {
  it('lists the items and opens one', async () => {
    const store = useItemsStore('p1')
    await store.load()
    const wrapper = mountWith(ItemList, { packId: 'p1', combined: true })
    await flushPromises()
    expect($('item-row-ruby_sword')!.textContent).toContain('Ruby Sword')
    expect($('item-row-ruby_sword')!.textContent).toContain('Weapon')
    expect($('items-needs-combined')).toBeNull()
    expect($('items-new')).not.toBeNull()
    click('item-row-ruby_sword')
    await flushPromises()
    expect(store.editing).toBe('ruby_sword')
    wrapper.unmount()
  })

  it('explains that items need a combined pack and offers to switch', async () => {
    fakeBridge.itemList = { items: [], invalid: ['blocksmith/items/bad.json'], namespace: 'x' }
    await useItemsStore('p1').load()
    let switched = 0
    const wrapper = mountWith(ItemList, {
      packId: 'p1',
      combined: false,
      onMakeCombined: () => switched++
    })
    await flushPromises()
    expect($('items-new')).toBeNull()
    expect($('items-needs-combined')!.textContent).toContain('Resource + data pack')
    expect($('items-invalid')!.textContent).toContain('blocksmith/items/bad.json')
    click('items-make-combined')
    expect(switched).toBe(1)
    wrapper.unmount()
  })
})

describe('new item dialog', () => {
  it('builds the id from the English name and creates the kind preset', async () => {
    const store = useItemsStore('p1')
    await store.load()
    const show = ref(true)
    const wrapper = mountWith(NewItemDialog, {
      show: show.value,
      'onUpdate:show': (v: boolean) => (show.value = v),
      packId: 'p1'
    })
    await flushPromises()
    radio('item-new-kind-weapon')
    type('item-new-name-en', 'Ruby Sword')
    await flushPromises()
    // The id of an existing item is refused.
    expect(($('item-new-id')!.querySelector('input') as HTMLInputElement).value).toBe('ruby_sword')
    expect(document.body.textContent).toContain('already has an item with this id')
    expect($<HTMLButtonElement>('item-new-create')!.disabled).toBe(true)
    type('item-new-name-en', 'Émeraude Blade!')
    type('item-new-name-fr', 'Lame en émeraude')
    await flushPromises()
    expect(document.body.textContent).toContain('my_pack:emeraude_blade')
    expect($('item-new-texture-path')!.textContent).toContain(
      'assets/minecraft/textures/item/diamond_sword.png'
    )
    click('item-new-create')
    await flushPromises()
    const create = fakeBridge.calls.find((c) => c.channel === 'items.create')!.payload as {
      item: CustomItem
      textureFrom: string | null
    }
    expect(create.item).toMatchObject({
      id: 'emeraude_blade',
      namespace: 'my_pack',
      kind: 'weapon',
      base: 'minecraft:stone_sword',
      handheld: true,
      names: { en_us: 'Émeraude Blade!', fr_fr: 'Lame en émeraude' },
      weapon: { attackDamage: 7, attackSpeed: 1.6 }
    })
    expect(create.textureFrom).toBe('assets/minecraft/textures/item/diamond_sword.png')
    expect(store.editing).toBe('emeraude_blade')
    expect(show.value).toBe(false)
    wrapper.unmount()
  })

  it('starts from a blank texture on request', async () => {
    await useItemsStore('p1').load()
    const wrapper = mountWith(NewItemDialog, { show: true, packId: 'p1' })
    await flushPromises()
    type('item-new-name-en', 'Coin')
    radio('item-new-texture-blank')
    await flushPromises()
    click('item-new-create')
    await flushPromises()
    const create = fakeBridge.calls.find((c) => c.channel === 'items.create')!.payload as {
      item: CustomItem
      textureFrom: string | null
    }
    expect(create.item).toMatchObject({ id: 'coin', kind: 'simple', maxStack: 64 })
    expect(create.textureFrom).toBeNull()
    wrapper.unmount()
  })
})

describe('item page', () => {
  async function openEditor(): Promise<VueWrapper> {
    const store = useItemsStore('p1')
    await store.load()
    await store.open('ruby_sword')
    const wrapper = mountWith(ItemEditor, { packId: 'p1' }, { ItemPreview: true })
    await flushPromises()
    return wrapper
  }

  it('shows validation errors next to the fields and keeps Save disabled while invalid', async () => {
    const wrapper = await openEditor()
    expect($('item-name')!.textContent).toBe('Ruby Sword')
    expect($<HTMLButtonElement>('item-save')!.disabled).toBe(true)
    type('item-attack-damage', '')
    await flushPromises()
    expect($('item-weapon')!.textContent).toContain('Required')
    expect($('item-error-count')!.textContent).toContain('1 error to fix')
    expect($<HTMLButtonElement>('item-save')!.disabled).toBe(true)
    type('item-attack-damage', '9')
    await flushPromises()
    expect($('item-error-count')).toBeNull()
    expect($('item-dirty')).not.toBeNull()
    expect($<HTMLButtonElement>('item-save')!.disabled).toBe(false)
    // Durability and a stack above 1 do not go together.
    type('item-max-stack', '16')
    await flushPromises()
    expect(document.body.textContent).toContain('An item with durability cannot stack')
    type('item-max-stack', '')
    await flushPromises()
    click('item-save')
    await flushPromises()
    const save = fakeBridge.calls.find((c) => c.channel === 'items.save')!.payload as {
      item: CustomItem
    }
    expect(save.item.weapon?.attackDamage).toBe(9)
    expect(save.item.maxStack).toBeUndefined()
    expect($('item-dirty')).toBeNull()
    wrapper.unmount()
  })

  it('checks the extra components on blur', async () => {
    const wrapper = await openEditor()
    const store = useItemsStore('p1')
    const area = document.querySelector(
      '[data-testid="item-extra"] textarea'
    ) as HTMLTextAreaElement
    area.value = '{"minecraft:fire_resistant": '
    area.dispatchEvent(new Event('input'))
    blur('item-extra')
    await flushPromises()
    expect(document.body.textContent).toContain('This is not valid JSON.')
    expect(store.valid).toBe(false)
    area.value = '{"minecraft:fire_resistant": {}}'
    area.dispatchEvent(new Event('input'))
    blur('item-extra')
    await flushPromises()
    expect(store.valid).toBe(true)
    expect(store.draft!.extraComponents).toEqual({ 'minecraft:fire_resistant': {} })
    wrapper.unmount()
  })

  it('asks before leaving with unsaved changes', async () => {
    const wrapper = await openEditor()
    const store = useItemsStore('p1')
    store.draft!.weapon!.attackDamage = 12
    await flushPromises()
    click('item-back')
    await flushPromises()
    expect(document.body.textContent).toContain('Unsaved changes')
    expect(store.editing).toBe('ruby_sword')
    buttonByText('Discard').click()
    await flushPromises()
    expect(store.editing).toBeNull()
    expect(fakeBridge.calls.some((c) => c.channel === 'items.save')).toBe(false)
    wrapper.unmount()
  })

  it('edits a shaped recipe with the item picker', async () => {
    const wrapper = await openEditor()
    const store = useItemsStore('p1')
    radio('recipe-mode-shaped')
    await flushPromises()
    expect(store.draft!.recipe).toMatchObject({ type: 'shaped', count: 1 })
    // An empty grid is not a recipe.
    expect($('recipe-error')!.textContent).toContain('at least one item')
    click('recipe-slot-4')
    await flushPromises()
    // Ingredients: vanilla items and item tags, never the pack's custom items.
    expect($('item-picker-row-#minecraft:planks')).not.toBeNull()
    expect($('item-picker-row-my_pack:ruby_sword')).toBeNull()
    type('item-picker-search', 'stic')
    await flushPromises()
    expect($('item-picker-row-minecraft:apple')).toBeNull()
    click('item-picker-row-minecraft:stick')
    await flushPromises()
    expect($('recipe-slot-4')!.getAttribute('data-value')).toBe('minecraft:stick')
    expect($('recipe-error')).toBeNull()
    type('recipe-count', '3')
    await flushPromises()
    expect(store.draft!.recipe).toEqual({
      type: 'shaped',
      grid: [null, null, null, null, 'minecraft:stick', null, null, null, null],
      count: 3
    })
    // Shapeless keeps the ingredients.
    radio('recipe-mode-shapeless')
    await flushPromises()
    expect(store.draft!.recipe).toEqual({
      type: 'shapeless',
      ingredients: ['minecraft:stick'],
      count: 3
    })
    radio('recipe-mode-none')
    await flushPromises()
    expect(store.draft!.recipe).toBeNull()
    wrapper.unmount()
  })

  it('adds the properties of a new kind and lets the old ones be removed', async () => {
    const wrapper = await openEditor()
    const store = useItemsStore('p1')
    const kind = wrapper
      .findAllComponents(NSelect)
      .find((s) => s.attributes('data-testid') === 'item-kind')!
    kind.vm.$emit('update:value', 'food')
    await flushPromises()
    expect(store.draft!.kind).toBe('food')
    expect(store.draft!.food).toMatchObject({ nutrition: 4, saturation: 2.4 })
    expect($('item-food')).not.toBeNull()
    expect($('item-section-remove-food')).toBeNull()
    click('item-section-remove-weapon')
    await flushPromises()
    expect(store.draft!.weapon).toBeUndefined()
    expect($('item-weapon')).toBeNull()
    expect(store.valid).toBe(true)
    wrapper.unmount()
  })

  it('warns when vanilla recipes use the base item, and shows the commands', async () => {
    fakeBridge.baseRecipeUses = ['minecraft:golden_apple']
    const wrapper = await openEditor()
    await new Promise((r) => setTimeout(r, 250))
    await flushPromises()
    expect($('item-base-warning')!.textContent).toContain(
      'Minecraft also treats this item as Stone Sword: 1 vanilla recipe uses it.'
    )
    expect($('item-base-warning')!.textContent).toContain('minecraft:golden_apple')
    expect($('item-how-to-function')!.textContent).toBe('/function my_pack:give/ruby_sword')
    expect($('item-how-to-give')!.textContent).toContain(
      '/give @s minecraft:stone_sword[minecraft:item_model="my_pack:ruby_sword"'
    )
    expect($('item-how-to-all')!.textContent).toBe('/function my_pack:give_all')
    ;($('item-how-to-copy-all') as HTMLElement).click()
    await flushPromises()
    expect(fakeBridge.calls).toContainEqual({
      channel: 'app.copyText',
      payload: { text: '/function my_pack:give_all' }
    })
    wrapper.unmount()
  })
})

describe('item picker', () => {
  it('offers the extra entries and no tags outside ingredients', async () => {
    let picked: [string, string | undefined] | null = null
    const wrapper = mountWith(ItemPicker, {
      show: true,
      packId: 'p1',
      extra: [{ id: 'my_pack:coin', name: 'Coin', icon: 'assets/my_pack/textures/item/coin.png' }],
      onPick: (id: string, icon?: string) => (picked = [id, icon])
    })
    await flushPromises()
    expect($('item-picker-row-#minecraft:planks')).toBeNull()
    expect($('item-picker-row-minecraft:stone_sword')!.textContent).toContain('Stone Sword')
    click('item-picker-row-my_pack:coin')
    expect(picked).toEqual(['my_pack:coin', 'assets/my_pack/textures/item/coin.png'])
    wrapper.unmount()
  })
})

describe('generated data files', () => {
  it('are read-only, with a button that opens their item', async () => {
    const path = 'data/my_pack/recipe/ruby_sword.json'
    fakeBridge.dataFiles[path] = {
      path,
      text: '{"type": "minecraft:crafting_shaped"}',
      origin: 'pack',
      vanillaText: null,
      generatedBy: 'ruby_sword'
    }
    useDataStore('p1').open(path)
    const opened: string[] = []
    const wrapper = mountWith(DataEditor, {
      packId: 'p1',
      onOpenItem: (id: string) => opened.push(id)
    })
    await flushPromises()
    expect($('data-generated')!.textContent).toContain(
      'generated from the custom item "ruby_sword"'
    )
    expect($('data-save')).toBeNull()
    expect($('data-format')).toBeNull()
    click('data-open-item')
    expect(opened).toEqual(['ruby_sword'])
    wrapper.unmount()
  })
})

describe('pack doctor', () => {
  it('opens and regenerates items with generated file issues', async () => {
    fakeBridge.doctor = {
      issues: [
        {
          code: 'items.generatedEdited',
          path: 'data/my_pack/recipe/ruby_sword.json',
          itemId: 'ruby_sword'
        },
        { code: 'items.unknownBase', path: 'blocksmith/items/coin.json', itemId: 'coin' }
      ],
      targets: [],
      files: 4
    }
    const opened: string[] = []
    const show = ref(false)
    const wrapper = mountWith(PackDoctorDrawer, () => ({
      show: show.value,
      'onUpdate:show': (v: boolean) => (show.value = v),
      packId: 'p1',
      onOpenItem: (id: string) => opened.push(id)
    }))
    // Opening the drawer runs the doctor.
    show.value = true
    await flushPromises()
    for (const header of document.querySelectorAll<HTMLElement>('.n-collapse-item__header-main')) {
      header.click()
    }
    await flushPromises()
    expect($('doctor-regenerate-coin')).toBeNull()
    click('doctor-regenerate-ruby_sword')
    await flushPromises()
    expect(fakeBridge.calls.find((c) => c.channel === 'items.regenerate')!.payload).toEqual({
      packId: 'p1',
      id: 'ruby_sword'
    })
    expect(fakeBridge.calls.filter((c) => c.channel === 'pack.doctor')).toHaveLength(2)
    click('doctor-open-item-coin')
    expect(opened).toEqual(['coin'])
    wrapper.unmount()
  })
})

describe('pack sections', () => {
  it('offers Items on every pack kind', () => {
    expect(packSections('resource')).toEqual(['textures', 'items'])
    expect(packSections('data')).toEqual(['data', 'items'])
    expect(packSections('combined')).toEqual(['textures', 'data', 'items'])
  })
})
