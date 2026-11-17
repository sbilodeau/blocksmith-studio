<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NCheckbox, NColorPicker, NSlider, NText, NTooltip } from 'naive-ui'
import { extractPalette, parseHex, toHex, type Rgba } from '@shared/image'
import EditorIcon from './EditorIcon.vue'
import { useEditorStore } from '../../stores/editor'

const props = defineProps<{ packId: string }>()
// Components resolve the per-pack editor store themselves (state is edited in the store, not via props).
const editor = computed(() => useEditorStore(props.packId))
const { t } = useI18n()

const palette = computed(() => {
  void editor.value.revision
  // With layers, the colors of what is shown (all visible layers).
  const img = editor.value.view
  return img ? extractPalette(img, { max: 64 }).map((e) => toHex(e.color)) : []
})

const primaryHex = computed({
  get: () => toHex(editor.value.primary),
  set: (hex: string) => editor.value.setColor(normalize(hex), 'primary')
})
const secondaryHex = computed({
  get: () => toHex(editor.value.secondary),
  set: (hex: string) => editor.value.setColor(normalize(hex), 'secondary')
})

function normalize(hex: string): Rgba {
  try {
    return parseHex(hex)
  } catch {
    return [0, 0, 0, 255]
  }
}

/** The picker updates the color live while dragging; it joins recent colors only once the picker closes. */
function onPickerShow(open: boolean, which: 'primary' | 'secondary'): void {
  if (!open)
    editor.value.rememberColor(which === 'primary' ? editor.value.primary : editor.value.secondary)
}

function pick(hex: string, e: MouseEvent): void {
  editor.value.useColor(parseHex(hex), e.button === 2 ? 'secondary' : 'primary')
}

function swatchStyle(hex: string): Record<string, string> {
  return {
    '--swatch': `#${hex.slice(1, 7)}`,
    '--alpha': String(parseInt(hex.slice(7, 9) || 'ff', 16) / 255)
  }
}
</script>

<template>
  <div class="panel" data-testid="color-panel">
    <div class="current">
      <div class="pickers">
        <n-color-picker
          v-model:value="primaryHex"
          :modes="['hex']"
          :show-alpha="true"
          size="small"
          class="picker"
          data-testid="color-primary"
          @update:show="(open: boolean) => onPickerShow(open, 'primary')"
        />
        <n-color-picker
          v-model:value="secondaryHex"
          :modes="['hex']"
          :show-alpha="true"
          size="small"
          class="picker"
          data-testid="color-secondary"
          @update:show="(open: boolean) => onPickerShow(open, 'secondary')"
        />
      </div>
      <n-tooltip>
        <template #trigger>
          <n-button quaternary size="small" data-testid="swap-colors" @click="editor.swapColors()">
            <editor-icon name="swap" />
          </n-button>
        </template>
        {{ t('editor.shortcut', { label: t('editor.swapColors'), key: 'X' }) }}
      </n-tooltip>
    </div>
    <n-text depth="3" class="hint">{{ t('editor.colorHint') }}</n-text>

    <div v-if="editor.tool === 'rect'" class="options">
      <n-checkbox v-model:checked="editor.fillShapes" size="small">{{
        t('editor.fillShapes')
      }}</n-checkbox>
    </div>
    <div v-if="editor.tool === 'bucket'" class="options">
      <n-text depth="3" class="label">{{
        t('editor.tolerance', { value: editor.bucketTolerance })
      }}</n-text>
      <n-slider v-model:value="editor.bucketTolerance" :min="0" :max="128" :step="1" />
      <n-checkbox v-model:checked="editor.bucketContiguous" size="small">{{
        t('editor.contiguous')
      }}</n-checkbox>
    </div>

    <n-text strong class="title">{{ t('editor.palette') }}</n-text>
    <div class="swatches" data-testid="texture-palette">
      <button
        v-for="hex in palette"
        :key="hex"
        class="swatch"
        :style="swatchStyle(hex)"
        :title="hex"
        @mousedown.prevent="pick(hex, $event)"
        @contextmenu.prevent
      />
    </div>

    <template v-if="editor.recentColors.length">
      <n-text strong class="title">{{ t('editor.recent') }}</n-text>
      <div class="swatches">
        <button
          v-for="hex in editor.recentColors"
          :key="hex"
          class="swatch"
          :style="swatchStyle(hex)"
          :title="hex"
          @mousedown.prevent="pick(hex, $event)"
          @contextmenu.prevent
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.current {
  display: flex;
  align-items: center;
  gap: 8px;
}
.pickers {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}
.hint,
.label {
  font-size: 11px;
}
.options {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  border-radius: 6px;
  background: rgba(128, 128, 128, 0.08);
}
.title {
  font-size: 12px;
  margin-top: 4px;
}
.swatches {
  display: grid;
  grid-template-columns: repeat(auto-fill, 20px);
  gap: 3px;
}
.swatch {
  width: 20px;
  height: 20px;
  padding: 0;
  border: 1px solid rgba(128, 128, 128, 0.4);
  border-radius: 3px;
  cursor: pointer;
  background:
    linear-gradient(
      rgb(from var(--swatch) r g b / var(--alpha)),
      rgb(from var(--swatch) r g b / var(--alpha))
    ),
    repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 50% / 8px 8px;
}
</style>
