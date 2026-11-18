<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NButton,
  NFormItem,
  NInput,
  NInputNumber,
  NSelect,
  NSwitch,
  NText,
  type SelectOption
} from 'naive-ui'
import {
  ARMOR_SLOTS,
  ITEM_KINDS,
  RARITIES,
  TOOL_TIERS,
  TOOL_TYPES,
  type CustomItemInput,
  type ItemKind
} from '@shared/items/schema'
import { itemPreset } from '@shared/items/presets'
import ItemIcon from './ItemIcon.vue'
import ItemPicker from './ItemPicker.vue'
import { useItemsStore } from '../../stores/items'
import { useItemIssues } from './issues'

/**
 * Properties of the open custom item (item page). It edits the store's draft directly; errors come from the
 * definition schema and show next to their field (Save stays disabled while there is one).
 */
const props = defineProps<{ packId: string }>()
const { t } = useI18n()
const store = computed(() => useItemsStore(props.packId))
const d = computed(() => store.value.draft as CustomItemInput)
const { fieldError } = useItemIssues(() => store.value.parsed)

/** Common effect ids offered in the effect lists (any id can be typed). */
const EFFECTS = [
  'absorption',
  'blindness',
  'conduit_power',
  'dolphins_grace',
  'fire_resistance',
  'glowing',
  'haste',
  'health_boost',
  'hunger',
  'instant_damage',
  'instant_health',
  'invisibility',
  'jump_boost',
  'levitation',
  'luck',
  'mining_fatigue',
  'nausea',
  'night_vision',
  'poison',
  'regeneration',
  'resistance',
  'saturation',
  'slow_falling',
  'slowness',
  'speed',
  'strength',
  'water_breathing',
  'weakness',
  'wither'
].map((e) => ({ value: `minecraft:${e}`, label: `minecraft:${e}` }))

/** Components of base items that custom items often remove (any id can be typed). */
const COMPONENTS = [
  'minecraft:food',
  'minecraft:consumable',
  'minecraft:tool',
  'minecraft:weapon',
  'minecraft:equippable',
  'minecraft:attribute_modifiers',
  'minecraft:max_damage',
  'minecraft:repairable',
  'minecraft:enchantable',
  'minecraft:use_remainder'
].map((c) => ({ value: c, label: c }))

const kindOptions = computed<SelectOption[]>(() =>
  ITEM_KINDS.map((k) => ({ value: k, label: t(`items.kinds.${k}`) }))
)
const rarityOptions = computed<SelectOption[]>(() => [
  { value: 'default', label: t('items.form.default') },
  ...RARITIES.map((r) => ({ value: r, label: t(`items.rarities.${r}`) }))
])
const glintOptions = computed<SelectOption[]>(() => [
  { value: 'default', label: t('items.form.default') },
  { value: 'on', label: t('items.form.glintOn') },
  { value: 'off', label: t('items.form.glintOff') }
])
const toolOptions = computed<SelectOption[]>(() =>
  TOOL_TYPES.map((v) => ({ value: v, label: t(`items.toolTypes.${v}`) }))
)
const tierOptions = computed<SelectOption[]>(() =>
  TOOL_TIERS.map((v) => ({ value: v, label: t(`items.tiers.${v}`) }))
)
const slotOptions = computed<SelectOption[]>(() =>
  ARMOR_SLOTS.map((v) => ({ value: v, label: t(`items.slots.${v}`) }))
)
const animationOptions = computed<SelectOption[]>(() =>
  (['eat', 'drink'] as const).map((v) => ({ value: v, label: t(`items.form.animations.${v}`) }))
)

/** Sets a field of `obj`; an optional field is removed when emptied. */
function setIn(obj: object, key: string, value: unknown, optional = false): void {
  const o = obj as Record<string, unknown>
  if (optional && (value === null || value === undefined || value === '')) delete o[key]
  else o[key] = value
}
const set = (key: keyof CustomItemInput, value: unknown, optional = true): void =>
  setIn(d.value, key, value, optional)

// ---------- names and lore ----------
function setName(lang: 'en_us' | 'fr_fr', value: string): void {
  setIn(d.value.names, lang, lang === 'fr_fr' ? value.trim() && value : value, lang === 'fr_fr')
}
function addLore(): void {
  d.value.lore = [...(d.value.lore ?? []), { en_us: '' }]
}
function setLore(index: number, lang: 'en_us' | 'fr_fr', value: string): void {
  const line = d.value.lore?.[index]
  if (line) setIn(line, lang, value, lang === 'fr_fr')
}
function removeLore(index: number): void {
  d.value.lore = (d.value.lore ?? []).filter((_, i) => i !== index)
}

// ---------- kind ----------
type Section = 'food' | 'weapon' | 'tool' | 'armor'
const SECTION_OF: Partial<Record<ItemKind, Section>> = {
  food: 'food',
  weapon: 'weapon',
  tool: 'tool',
  armor: 'armor'
}
/** Changing the kind adds that kind's properties from its preset when the item has none. */
function setKind(kind: ItemKind): void {
  d.value.kind = kind
  const section = SECTION_OF[kind]
  if (section && d.value[section] === undefined) {
    const preset = itemPreset(kind).item
    setIn(d.value, section, structuredClone(preset[section]))
    if (kind === 'tool' && d.value.weapon === undefined && preset.weapon) {
      d.value.weapon = structuredClone(preset.weapon)
    }
  }
}
const shows = (section: Section): boolean =>
  d.value.kind === section || d.value[section] !== undefined

function toggleWeapon(on: boolean): void {
  if (on) d.value.weapon = structuredClone(itemPreset('weapon').item.weapon)
  else delete d.value.weapon
}

// ---------- food effects ----------
function addEffect(): void {
  const food = d.value.food
  if (!food) return
  food.effects = [
    ...(food.effects ?? []),
    { effect: 'minecraft:night_vision', seconds: 30, level: 1, chance: 1 }
  ]
}
function removeEffect(index: number): void {
  const food = d.value.food
  if (food) food.effects = (food.effects ?? []).filter((_, i) => i !== index)
}

// ---------- pickers ----------
const picking = ref<'base' | 'repair' | null>(null)
const showPicker = computed({
  get: () => picking.value !== null,
  set: (v: boolean) => {
    if (!v) picking.value = null
  }
})
function onPick(id: string): void {
  if (picking.value === 'base') d.value.base = id
  if (picking.value === 'repair') d.value.repairWith = id
}
const baseName = computed(() => store.value.vanillaName(d.value.base) ?? d.value.base)

// ---------- extra components (raw JSON) ----------
const extraText = ref('')
const extraError = ref<string | null>(null)
watch(
  () => store.value.draft,
  (draft) => {
    const extra = draft?.extraComponents ?? {}
    extraText.value = Object.keys(extra).length ? JSON.stringify(extra, null, 2) : ''
    extraError.value = null
  },
  { immediate: true }
)
function onExtraInput(value: string): void {
  extraText.value = value
  // Flags the change at once (dirty, Save disabled) until the text is checked on blur.
  store.value.extraInvalid = true
}
function checkExtra(): void {
  const text = extraText.value.trim()
  let value: unknown = {}
  if (text) {
    try {
      value = JSON.parse(text)
    } catch {
      extraError.value = t('items.form.extraNotJson')
      store.value.extraInvalid = true
      return
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    extraError.value = t('items.form.extraNotObject')
    store.value.extraInvalid = true
    return
  }
  extraError.value = null
  d.value.extraComponents = value as Record<string, unknown>
  store.value.extraInvalid = false
}
const extraFeedback = computed(
  () => extraError.value ?? fieldError('extraComponents') ?? t('items.form.extraHint')
)

/** NFormItem props for a field: its error, if any. */
function status(path: string): { validationStatus?: 'error'; feedback?: string } {
  const e = fieldError(path)
  return e ? { validationStatus: 'error', feedback: e } : {}
}
</script>

<template>
  <div v-if="store.draft" class="form" data-testid="item-form">
    <section>
      <h4>{{ t('items.form.general') }}</h4>
      <div class="fields">
        <n-form-item :label="t('items.form.nameEn')" v-bind="status('names.en_us')">
          <n-input
            :value="d.names['en_us'] ?? ''"
            data-testid="item-name-en"
            @update:value="(v: string) => setName('en_us', v)"
          />
        </n-form-item>
        <n-form-item :label="t('items.form.nameFr')" v-bind="status('names.fr_fr')">
          <n-input
            :value="d.names['fr_fr'] ?? ''"
            :placeholder="t('items.form.nameFrPlaceholder')"
            data-testid="item-name-fr"
            @update:value="(v: string) => setName('fr_fr', v)"
          />
        </n-form-item>
        <n-form-item :label="t('items.form.kind')" v-bind="status('kind')">
          <n-select
            :value="d.kind"
            :options="kindOptions"
            data-testid="item-kind"
            @update:value="setKind"
          />
        </n-form-item>
        <n-form-item :label="t('items.form.base')" v-bind="status('base')" class="wide">
          <div class="picked">
            <item-icon :url="store.iconUrl(d.base)" />
            <span class="picked-name" data-testid="item-base">{{ baseName }}</span>
            <n-text depth="3" class="mono">{{ d.base }}</n-text>
            <n-button size="tiny" data-testid="item-base-change" @click="picking = 'base'">
              {{ t('items.form.change') }}
            </n-button>
          </div>
        </n-form-item>
      </div>
      <n-text depth="3" class="hint">{{ t('items.form.baseHint') }}</n-text>
      <div class="fields">
        <n-form-item :label="t('items.form.maxStack')" v-bind="status('maxStack')">
          <n-input-number
            :value="d.maxStack ?? null"
            :min="1"
            :max="99"
            clearable
            :placeholder="t('items.form.default')"
            data-testid="item-max-stack"
            @update:value="(v: number | null) => set('maxStack', v)"
          />
        </n-form-item>
        <n-form-item :label="t('items.form.durability')" v-bind="status('durability')">
          <n-input-number
            :value="d.durability ?? null"
            :min="1"
            :max="100000"
            clearable
            :placeholder="t('items.form.default')"
            data-testid="item-durability"
            @update:value="(v: number | null) => set('durability', v)"
          />
        </n-form-item>
        <n-form-item :label="t('items.form.rarity')" v-bind="status('rarity')">
          <n-select
            :value="d.rarity ?? 'default'"
            :options="rarityOptions"
            data-testid="item-rarity"
            @update:value="(v: string) => set('rarity', v === 'default' ? undefined : v)"
          />
        </n-form-item>
        <n-form-item :label="t('items.form.glint')" v-bind="status('glint')">
          <n-select
            :value="d.glint === undefined ? 'default' : d.glint ? 'on' : 'off'"
            :options="glintOptions"
            data-testid="item-glint"
            @update:value="(v: string) => set('glint', v === 'default' ? undefined : v === 'on')"
          />
        </n-form-item>
        <n-form-item :label="t('items.form.enchantability')" v-bind="status('enchantability')">
          <n-input-number
            :value="d.enchantability ?? null"
            :min="1"
            :max="255"
            clearable
            :placeholder="t('items.form.none')"
            data-testid="item-enchantability"
            @update:value="(v: number | null) => set('enchantability', v)"
          />
        </n-form-item>
        <n-form-item :label="t('items.form.repairWith')" v-bind="status('repairWith')">
          <div class="picked">
            <item-icon v-if="d.repairWith" :url="store.iconUrl(d.repairWith)" />
            <span class="picked-name" data-testid="item-repair">{{
              d.repairWith
                ? (store.vanillaName(d.repairWith) ?? d.repairWith)
                : t('items.form.none')
            }}</span>
            <n-button size="tiny" data-testid="item-repair-change" @click="picking = 'repair'">
              {{ t('items.form.change') }}
            </n-button>
            <n-button
              v-if="d.repairWith"
              size="tiny"
              quaternary
              data-testid="item-repair-clear"
              @click="set('repairWith', undefined)"
            >
              {{ t('items.form.clear') }}
            </n-button>
          </div>
        </n-form-item>
        <n-form-item :label="t('items.form.handheld')">
          <n-switch
            :value="d.handheld ?? false"
            data-testid="item-handheld"
            @update:value="(v: boolean) => set('handheld', v, false)"
          />
        </n-form-item>
      </div>
      <n-text depth="3" class="hint">{{ t('items.form.handheldHint') }}</n-text>
    </section>

    <section>
      <h4>{{ t('items.form.lore') }}</h4>
      <div v-for="(line, i) in d.lore ?? []" :key="i" class="lore">
        <n-input
          :value="line['en_us'] ?? ''"
          size="small"
          :placeholder="t('items.form.loreEn')"
          :data-testid="`item-lore-en-${i}`"
          @update:value="(v: string) => setLore(i, 'en_us', v)"
        />
        <n-input
          :value="line['fr_fr'] ?? ''"
          size="small"
          :placeholder="t('items.form.loreFr')"
          :data-testid="`item-lore-fr-${i}`"
          @update:value="(v: string) => setLore(i, 'fr_fr', v)"
        />
        <n-button size="small" quaternary @click="removeLore(i)">
          {{ t('items.form.remove') }}
        </n-button>
      </div>
      <n-button
        size="small"
        :disabled="(d.lore ?? []).length >= 8"
        data-testid="item-lore-add"
        @click="addLore"
      >
        {{ t('items.form.loreAdd') }}
      </n-button>
    </section>

    <section v-if="shows('food') && d.food" data-testid="item-food">
      <h4>{{ t('items.form.food') }}</h4>
      <div class="fields">
        <n-form-item :label="t('items.form.nutrition')" v-bind="status('food.nutrition')">
          <n-input-number
            :value="d.food.nutrition ?? null"
            :min="0"
            :max="100"
            data-testid="item-food-nutrition"
            @update:value="(v: number | null) => setIn(d.food!, 'nutrition', v)"
          />
        </n-form-item>
        <n-form-item :label="t('items.form.saturation')" v-bind="status('food.saturation')">
          <n-input-number
            :value="d.food.saturation ?? null"
            :min="0"
            :max="100"
            :step="0.1"
            data-testid="item-food-saturation"
            @update:value="(v: number | null) => setIn(d.food!, 'saturation', v)"
          />
        </n-form-item>
        <n-form-item :label="t('items.form.eatSeconds')" v-bind="status('food.eatSeconds')">
          <n-input-number
            :value="d.food.eatSeconds ?? null"
            :min="0.05"
            :max="60"
            :step="0.1"
            data-testid="item-food-seconds"
            @update:value="(v: number | null) => setIn(d.food!, 'eatSeconds', v, true)"
          />
        </n-form-item>
        <n-form-item :label="t('items.form.animation')">
          <n-select
            :value="d.food.animation ?? 'eat'"
            :options="animationOptions"
            data-testid="item-food-animation"
            @update:value="(v: string) => setIn(d.food!, 'animation', v)"
          />
        </n-form-item>
        <n-form-item :label="t('items.form.alwaysEdible')">
          <n-switch
            :value="d.food.alwaysEdible ?? false"
            data-testid="item-food-always"
            @update:value="(v: boolean) => setIn(d.food!, 'alwaysEdible', v)"
          />
        </n-form-item>
      </div>
      <n-text depth="3" class="hint">{{ t('items.form.nutritionHint') }}</n-text>
      <h5>{{ t('items.form.effects') }}</h5>
      <div
        v-for="(effect, i) in d.food.effects ?? []"
        :key="i"
        class="effect"
        :data-testid="`item-effect-${i}`"
      >
        <n-form-item :label="t('items.form.effect')" v-bind="status(`food.effects.${i}.effect`)">
          <n-select
            :value="effect.effect"
            :options="EFFECTS"
            filterable
            tag
            style="width: 220px"
            @update:value="(v: string) => setIn(effect, 'effect', v)"
          />
        </n-form-item>
        <n-form-item :label="t('items.form.seconds')" v-bind="status(`food.effects.${i}.seconds`)">
          <n-input-number
            :value="effect.seconds ?? null"
            :min="0.05"
            :max="3600"
            style="width: 110px"
            @update:value="(v: number | null) => setIn(effect, 'seconds', v)"
          />
        </n-form-item>
        <n-form-item :label="t('items.form.level')" v-bind="status(`food.effects.${i}.level`)">
          <n-input-number
            :value="effect.level ?? null"
            :min="1"
            :max="10"
            style="width: 90px"
            @update:value="(v: number | null) => setIn(effect, 'level', v, true)"
          />
        </n-form-item>
        <n-form-item :label="t('items.form.chance')" v-bind="status(`food.effects.${i}.chance`)">
          <n-input-number
            :value="effect.chance ?? null"
            :min="0"
            :max="1"
            :step="0.1"
            style="width: 100px"
            @update:value="(v: number | null) => setIn(effect, 'chance', v, true)"
          />
        </n-form-item>
        <n-button size="small" quaternary class="effect-remove" @click="removeEffect(i)">
          {{ t('items.form.remove') }}
        </n-button>
      </div>
      <n-button
        size="small"
        :disabled="(d.food.effects ?? []).length >= 8"
        data-testid="item-effect-add"
        @click="addEffect"
      >
        {{ t('items.form.effectAdd') }}
      </n-button>
    </section>

    <section v-if="shows('tool') && d.tool" data-testid="item-tool">
      <h4>{{ t('items.form.tool') }}</h4>
      <div class="fields">
        <n-form-item :label="t('items.form.toolType')" v-bind="status('tool.type')">
          <n-select
            :value="d.tool.type"
            :options="toolOptions"
            data-testid="item-tool-type"
            @update:value="(v: string) => setIn(d.tool!, 'type', v)"
          />
        </n-form-item>
        <n-form-item :label="t('items.form.tier')" v-bind="status('tool.tier')">
          <n-select
            :value="d.tool.tier"
            :options="tierOptions"
            data-testid="item-tool-tier"
            @update:value="(v: string) => setIn(d.tool!, 'tier', v)"
          />
        </n-form-item>
        <n-form-item :label="t('items.form.miningSpeed')" v-bind="status('tool.miningSpeed')">
          <n-input-number
            :value="d.tool.miningSpeed ?? null"
            :min="0.1"
            :max="1000"
            data-testid="item-tool-speed"
            @update:value="(v: number | null) => setIn(d.tool!, 'miningSpeed', v)"
          />
        </n-form-item>
      </div>
      <n-text depth="3" class="hint">{{ t('items.form.tierHint') }}</n-text>
      <n-form-item :label="t('items.form.attackStats')" label-placement="left">
        <n-switch
          :value="d.weapon !== undefined"
          data-testid="item-weapon-toggle"
          @update:value="toggleWeapon"
        />
      </n-form-item>
    </section>

    <section v-if="shows('weapon') && d.weapon" data-testid="item-weapon">
      <h4>{{ t('items.form.weapon') }}</h4>
      <div class="fields">
        <n-form-item :label="t('items.form.attackDamage')" v-bind="status('weapon.attackDamage')">
          <n-input-number
            :value="d.weapon.attackDamage ?? null"
            :min="0"
            :max="1000"
            :step="0.5"
            data-testid="item-attack-damage"
            @update:value="(v: number | null) => setIn(d.weapon!, 'attackDamage', v)"
          />
        </n-form-item>
        <n-form-item :label="t('items.form.attackSpeed')" v-bind="status('weapon.attackSpeed')">
          <n-input-number
            :value="d.weapon.attackSpeed ?? null"
            :min="0.1"
            :max="100"
            :step="0.1"
            data-testid="item-attack-speed"
            @update:value="(v: number | null) => setIn(d.weapon!, 'attackSpeed', v)"
          />
        </n-form-item>
      </div>
      <n-text depth="3" class="hint">{{ t('items.form.weaponHint') }}</n-text>
    </section>

    <section v-if="shows('armor') && d.armor" data-testid="item-armor">
      <h4>{{ t('items.form.armor') }}</h4>
      <div class="fields">
        <n-form-item :label="t('items.form.slot')" v-bind="status('armor.slot')">
          <n-select
            :value="d.armor.slot"
            :options="slotOptions"
            data-testid="item-armor-slot"
            @update:value="(v: string) => setIn(d.armor!, 'slot', v)"
          />
        </n-form-item>
        <n-form-item :label="t('items.form.armorPoints')" v-bind="status('armor.armor')">
          <n-input-number
            :value="d.armor.armor ?? null"
            :min="0"
            :max="30"
            data-testid="item-armor-points"
            @update:value="(v: number | null) => setIn(d.armor!, 'armor', v)"
          />
        </n-form-item>
        <n-form-item :label="t('items.form.toughness')" v-bind="status('armor.toughness')">
          <n-input-number
            :value="d.armor.toughness ?? null"
            :min="0"
            :max="20"
            data-testid="item-armor-toughness"
            @update:value="(v: number | null) => setIn(d.armor!, 'toughness', v, true)"
          />
        </n-form-item>
        <n-form-item
          :label="t('items.form.knockbackResistance')"
          v-bind="status('armor.knockbackResistance')"
        >
          <n-input-number
            :value="d.armor.knockbackResistance ?? null"
            :min="0"
            :max="1"
            :step="0.1"
            data-testid="item-armor-knockback"
            @update:value="(v: number | null) => setIn(d.armor!, 'knockbackResistance', v, true)"
          />
        </n-form-item>
      </div>
    </section>

    <section>
      <h4>{{ t('items.form.advanced') }}</h4>
      <n-form-item :label="t('items.form.removeComponents')" v-bind="status('removeComponents')">
        <n-select
          :value="d.removeComponents ?? []"
          :options="COMPONENTS"
          multiple
          filterable
          tag
          :placeholder="t('items.form.none')"
          data-testid="item-remove-components"
          @update:value="(v: string[]) => set('removeComponents', v, false)"
        />
      </n-form-item>
      <n-form-item
        :label="t('items.form.extraComponents')"
        :validation-status="extraError || fieldError('extraComponents') ? 'error' : undefined"
        :feedback="extraFeedback"
      >
        <n-input
          :value="extraText"
          type="textarea"
          :autosize="{ minRows: 3, maxRows: 14 }"
          class="mono"
          data-testid="item-extra"
          @update:value="onExtraInput"
          @blur="checkExtra"
        />
      </n-form-item>
    </section>

    <item-picker
      v-model:show="showPicker"
      :pack-id="packId"
      :tags="picking === 'repair'"
      :title="picking === 'repair' ? t('items.form.repairWith') : t('items.form.base')"
      @pick="onPick"
    />
  </div>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
h4 {
  margin: 12px 0 6px;
}
h5 {
  margin: 8px 0 4px;
}
section:first-child h4 {
  margin-top: 0;
}
.fields {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 0 12px;
}
.wide {
  grid-column: 1 / -1;
}
.hint {
  display: block;
  font-size: 12px;
  margin: -8px 0 8px;
}
.picked {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.picked-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mono,
.mono :deep(textarea) {
  font-family: var(--n-font-family-mono, monospace);
  font-size: 12px;
}
.lore {
  display: flex;
  gap: 8px;
  margin-bottom: 6px;
}
.effect {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  flex-wrap: wrap;
}
.effect-remove {
  margin-top: 26px;
}
</style>
