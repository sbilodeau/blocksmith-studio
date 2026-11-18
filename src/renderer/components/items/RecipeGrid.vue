<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NInputNumber, NRadioButton, NRadioGroup, NText, NTooltip } from 'naive-ui'
import type { ItemRecipe } from '@shared/items/schema'
import ItemIcon from './ItemIcon.vue'
import ItemPicker from './ItemPicker.vue'
import { useItemsStore } from '../../stores/items'

/** A recipe as the form holds it (the count may still be empty). */
type RecipeDraft =
  | { type: 'shaped'; grid: Array<string | null>; count?: number | null }
  | { type: 'shapeless'; ingredients: string[]; count?: number | null }

/**
 * Crafting recipe of a custom item: none, a shaped 3x3 grid or a shapeless list, and how many items it makes.
 * Each slot opens the item picker (vanilla items and item #tags).
 */
const recipe = defineModel<RecipeDraft | ItemRecipe | null>('recipe', { required: true })
const props = defineProps<{ packId: string; resultIcon?: string; error?: string }>()
const { t } = useI18n()
const store = computed(() => useItemsStore(props.packId))

const mode = computed(() => recipe.value?.type ?? 'none')
const showPicker = ref(false)
/** Slot being picked: a grid index, or -1 to add a shapeless ingredient. */
const target = ref(-1)

function setMode(next: 'none' | 'shaped' | 'shapeless'): void {
  const r = recipe.value
  const count = r?.count ?? 1
  const items =
    r?.type === 'shaped'
      ? r.grid.filter((s): s is string => s !== null)
      : r?.type === 'shapeless'
        ? r.ingredients
        : []
  if (next === 'none') recipe.value = null
  else if (next === 'shaped') {
    const grid: Array<string | null> = Array.from({ length: 9 }, (_, i) => items[i] ?? null)
    recipe.value = { type: 'shaped', grid, count }
  } else recipe.value = { type: 'shapeless', ingredients: items.slice(0, 9), count }
}

function pickFor(index: number): void {
  target.value = index
  showPicker.value = true
}

function onPick(id: string): void {
  const r = recipe.value
  if (!r) return
  if (r.type === 'shaped') {
    const grid = [...r.grid]
    grid[target.value] = id
    recipe.value = { ...r, grid }
  } else if (r.ingredients.length < 9) {
    recipe.value = { ...r, ingredients: [...r.ingredients, id] }
  }
}

function clearSlot(index: number): void {
  const r = recipe.value
  if (r?.type !== 'shaped') return
  const grid = [...r.grid]
  grid[index] = null
  recipe.value = { ...r, grid }
}

function removeIngredient(index: number): void {
  const r = recipe.value
  if (r?.type !== 'shapeless') return
  recipe.value = { ...r, ingredients: r.ingredients.filter((_, i) => i !== index) }
}

function setCount(count: number | null): void {
  const r = recipe.value
  if (r) recipe.value = { ...r, count: count ?? undefined }
}

function label(id: string): string {
  return store.value.vanillaName(id) ?? id
}

function tooltip(slot: string | null): string {
  return slot ? `${label(slot)} (${slot})` : ''
}
</script>

<template>
  <div class="recipe" data-testid="recipe-editor">
    <n-radio-group :value="mode" size="small" @update:value="setMode">
      <n-radio-button value="none" data-testid="recipe-mode-none">
        {{ t('items.recipe.none') }}
      </n-radio-button>
      <n-radio-button value="shaped" data-testid="recipe-mode-shaped">
        {{ t('items.recipe.shaped') }}
      </n-radio-button>
      <n-radio-button value="shapeless" data-testid="recipe-mode-shapeless">
        {{ t('items.recipe.shapeless') }}
      </n-radio-button>
    </n-radio-group>

    <n-text v-if="!recipe" depth="3" class="hint">{{ t('items.recipe.noneHint') }}</n-text>
    <div v-else class="craft">
      <div v-if="recipe.type === 'shaped'" class="grid" data-testid="recipe-grid">
        <div v-for="(slot, i) in recipe.grid" :key="i" class="slot-wrap">
          <n-tooltip :disabled="!slot">
            <template #trigger>
              <button
                class="slot"
                :class="{ filled: !!slot }"
                :aria-label="slot ? label(slot) : t('items.recipe.emptySlot')"
                :data-testid="`recipe-slot-${i}`"
                :data-value="slot ?? ''"
                @click="pickFor(i)"
              >
                <item-icon v-if="slot" :url="store.iconUrl(slot)" :size="32" />
                <span v-if="slot && slot.startsWith('#')" class="tag-mark">#</span>
              </button>
            </template>
            {{ tooltip(slot) }}
          </n-tooltip>
          <button
            v-if="slot"
            class="clear"
            :aria-label="t('items.recipe.clear')"
            :data-testid="`recipe-clear-${i}`"
            @click="clearSlot(i)"
          />
        </div>
      </div>
      <div v-else class="shapeless" data-testid="recipe-shapeless">
        <div v-for="(id, i) in recipe.ingredients" :key="i" class="ingredient">
          <item-icon :url="store.iconUrl(id)" :size="24" />
          <span class="ingredient-name">{{ label(id) }}</span>
          <n-button
            size="tiny"
            quaternary
            :data-testid="`recipe-remove-${i}`"
            @click="removeIngredient(i)"
          >
            {{ t('items.recipe.remove') }}
          </n-button>
        </div>
        <n-button
          size="small"
          :disabled="recipe.ingredients.length >= 9"
          data-testid="recipe-add"
          @click="pickFor(-1)"
        >
          {{ t('items.recipe.add') }}
        </n-button>
      </div>
      <div class="result">
        <span class="arrow" aria-hidden="true" />
        <item-icon :url="resultIcon" :size="40" />
        <n-input-number
          :value="recipe.count ?? null"
          :min="1"
          :max="99"
          size="small"
          style="width: 110px"
          :aria-label="t('items.recipe.count')"
          data-testid="recipe-count"
          @update:value="setCount"
        />
      </div>
    </div>
    <n-text v-if="error" type="error" class="hint" data-testid="recipe-error">{{ error }}</n-text>
    <n-text v-if="recipe" depth="3" class="hint">{{ t('items.recipe.hint') }}</n-text>
    <item-picker
      v-model:show="showPicker"
      :pack-id="packId"
      :title="t('items.recipe.pickTitle')"
      tags
      @pick="onPick"
    />
  </div>
</template>

<style scoped>
.recipe {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.hint {
  font-size: 12px;
}
.craft {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.grid {
  display: grid;
  grid-template-columns: repeat(3, 44px);
  gap: 4px;
}
.slot-wrap {
  position: relative;
}
.slot {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(128, 128, 128, 0.35);
  border-radius: 4px;
  background: rgba(128, 128, 128, 0.1);
  color: inherit;
  cursor: pointer;
  position: relative;
}
.slot:hover {
  border-color: #18a058;
}
.tag-mark {
  position: absolute;
  right: 2px;
  bottom: 0;
  font-size: 10px;
  font-weight: 700;
}
.clear {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 16px;
  height: 16px;
  line-height: 14px;
  padding: 0;
  font-size: 12px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  background: rgba(128, 128, 128, 0.6);
  color: #fff;
  display: none;
}
.clear::before {
  content: '×';
}
.slot-wrap:hover .clear,
.clear:focus-visible {
  display: block;
}
.shapeless {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 200px;
}
.ingredient {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ingredient-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.result {
  display: flex;
  align-items: center;
  gap: 8px;
}
.arrow::before {
  content: '→';
  font-size: 20px;
  opacity: 0.6;
}
</style>
