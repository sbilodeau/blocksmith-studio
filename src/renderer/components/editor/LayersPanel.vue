<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { NAlert, NButton, NInput, NSlider, NText, NTooltip } from 'naive-ui'
import type { RgbaImage } from '@shared/image'
import { MAX_LAYERS } from '@shared/model/layers'
import EditorIcon from './EditorIcon.vue'
import { useEditorStore } from '../../stores/editor'

/**
 * Optional layers of the open texture (M11). The pack keeps the composite PNG; the layers are saved next to the
 * project so editing can continue later. Layers are listed top first, like in most image editors.
 */
const props = defineProps<{ packId: string }>()
// Components resolve the per-pack editor store themselves (state is edited in the store, not via props).
const editor = computed(() => useEditorStore(props.packId))
const { t } = useI18n()

const layers = computed(() => {
  void editor.value.revision
  return editor.value.layers
})
/** Rows top first: [layer index, layer]. */
const rows = computed(() =>
  (layers.value ?? []).map((layer, index) => ({ index, layer })).reverse()
)
const active = computed(() => editor.value.activeLayer)
const activeLayer = computed(() => layers.value?.[active.value] ?? null)
const count = computed(() => layers.value?.length ?? 0)
const animated = computed(() => !!editor.value.frames)
const canAdd = computed(() => !!editor.value.image && !animated.value && count.value < MAX_LAYERS)

function nextName(): string {
  const names = new Set((layers.value ?? []).map((l) => l.name))
  for (let n = Math.max(2, count.value + 1); ; n++) {
    const name = t('layers.defaultName', { n })
    if (!names.has(name)) return name
  }
}

function add(): void {
  editor.value.addLayer(nextName(), t('layers.baseName'))
}

function duplicate(): void {
  const current = activeLayer.value
  if (current) editor.value.duplicateLayer(t('layers.copyName', { name: current.name }))
}

// ---------- rename ----------
const renaming = ref<number | null>(null)
const draftName = ref('')
const renameInput = ref<InstanceType<typeof NInput> | null>(null)

async function startRename(index: number): Promise<void> {
  const layer = layers.value?.[index]
  if (!layer) return
  editor.value.selectLayer(index)
  renaming.value = index
  draftName.value = layer.name
  await nextTick()
  renameInput.value?.focus()
  renameInput.value?.select()
}

function finishRename(): void {
  if (renaming.value !== null) editor.value.renameLayer(renaming.value, draftName.value)
  renaming.value = null
}

function onRenameKey(e: KeyboardEvent): void {
  if (e.key === 'Enter') finishRename()
  else if (e.key === 'Escape') renaming.value = null
  // Keep the editor's single-key shortcuts (tools, frames) out of the name field.
  e.stopPropagation()
}

/** Arrow keys move through the layers when the list has the focus. */
function onListKey(e: KeyboardEvent): void {
  if (renaming.value !== null) return
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault()
    e.stopPropagation()
    editor.value.selectLayer(active.value + (e.key === 'ArrowUp' ? 1 : -1))
  } else if (e.key === 'F2') {
    e.preventDefault()
    void startRename(active.value)
  }
}

// ---------- thumbnails ----------
const thumbs = new Map<number, HTMLCanvasElement>()
let raf = 0

function setThumb(index: number, el: unknown): void {
  if (el instanceof HTMLCanvasElement) thumbs.set(index, el)
  else thumbs.delete(index)
}

function drawThumb(canvas: HTMLCanvasElement, img: RgbaImage): void {
  if (canvas.width !== img.width || canvas.height !== img.height) {
    canvas.width = img.width
    canvas.height = img.height
  }
  canvas
    .getContext('2d')
    ?.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0)
}

function scheduleThumbs(): void {
  if (raf) return
  raf = requestAnimationFrame(() => {
    raf = 0
    const l = editor.value.layers
    if (!l) return
    for (const [index, canvas] of thumbs) {
      const layer = l[index]
      if (layer) drawThumb(canvas, layer.image)
    }
  })
}

watch(() => [editor.value.revision, count.value], scheduleThumbs, { immediate: true })
onBeforeUnmount(() => {
  if (raf) cancelAnimationFrame(raf)
})
</script>

<template>
  <div class="layers" data-testid="layers-panel">
    <div class="head">
      <n-text strong class="title">{{ t('layers.title') }}</n-text>
      <div class="actions">
        <n-tooltip>
          <template #trigger>
            <n-button
              size="tiny"
              quaternary
              :disabled="!canAdd"
              :aria-label="t('layers.add')"
              data-testid="layer-add"
              @click="add"
            >
              <template #icon><editor-icon name="plus" /></template>
            </n-button>
          </template>
          {{ t('layers.add') }}
        </n-tooltip>
        <template v-if="layers">
          <n-tooltip>
            <template #trigger>
              <n-button
                size="tiny"
                quaternary
                :disabled="count >= MAX_LAYERS"
                :aria-label="t('layers.duplicate')"
                data-testid="layer-duplicate"
                @click="duplicate"
              >
                <template #icon><editor-icon name="duplicate" /></template>
              </n-button>
            </template>
            {{ t('layers.duplicate') }}
          </n-tooltip>
          <n-tooltip>
            <template #trigger>
              <n-button
                size="tiny"
                quaternary
                :disabled="active >= count - 1"
                :aria-label="t('layers.up')"
                data-testid="layer-up"
                @click="editor.moveLayer(1)"
              >
                <template #icon><editor-icon name="up" /></template>
              </n-button>
            </template>
            {{ t('layers.up') }}
          </n-tooltip>
          <n-tooltip>
            <template #trigger>
              <n-button
                size="tiny"
                quaternary
                :disabled="active <= 0"
                :aria-label="t('layers.down')"
                data-testid="layer-down"
                @click="editor.moveLayer(-1)"
              >
                <template #icon><editor-icon name="down" /></template>
              </n-button>
            </template>
            {{ t('layers.down') }}
          </n-tooltip>
          <n-tooltip>
            <template #trigger>
              <n-button
                size="tiny"
                quaternary
                :disabled="active <= 0"
                :aria-label="t('layers.mergeDown')"
                data-testid="layer-merge"
                @click="editor.mergeDown()"
              >
                <template #icon><editor-icon name="merge" /></template>
              </n-button>
            </template>
            {{ t('layers.mergeDown') }}
          </n-tooltip>
          <n-tooltip>
            <template #trigger>
              <n-button
                size="tiny"
                quaternary
                :disabled="count < 2"
                :aria-label="t('layers.delete')"
                data-testid="layer-delete"
                @click="editor.deleteLayer()"
              >
                <template #icon><editor-icon name="trash" /></template>
              </n-button>
            </template>
            {{ t('layers.delete') }}
          </n-tooltip>
          <n-tooltip>
            <template #trigger>
              <n-button
                size="tiny"
                quaternary
                :aria-label="t('layers.flatten')"
                data-testid="layer-flatten"
                @click="editor.flattenLayers()"
              >
                <template #icon><editor-icon name="flatten" /></template>
              </n-button>
            </template>
            {{ t('layers.flattenHint') }}
          </n-tooltip>
        </template>
      </div>
    </div>

    <n-alert
      v-if="editor.layersStale"
      type="warning"
      :show-icon="false"
      class="note"
      data-testid="layers-stale"
    >
      {{ t('layers.stale') }}
    </n-alert>
    <n-text v-if="animated" depth="3" class="hint">{{ t('layers.animated') }}</n-text>
    <n-text v-else-if="!layers" depth="3" class="hint" data-testid="layers-hint">
      {{ t('layers.hint') }}
    </n-text>

    <template v-if="layers">
      <ul
        class="list"
        role="listbox"
        tabindex="0"
        :aria-label="t('layers.title')"
        :aria-activedescendant="`layer-${packId}-${active}`"
        data-testid="layer-list"
        @keydown="onListKey"
      >
        <li
          v-for="{ index, layer } in rows"
          :id="`layer-${packId}-${index}`"
          :key="index"
          role="option"
          :aria-selected="index === active"
          class="row"
          :class="{ active: index === active, hidden: !layer.visible }"
          :data-testid="`layer-${index}`"
          @click="editor.selectLayer(index)"
          @dblclick="startRename(index)"
        >
          <n-button
            size="tiny"
            quaternary
            circle
            :aria-label="t(layer.visible ? 'layers.hide' : 'layers.show', { name: layer.name })"
            :aria-pressed="layer.visible"
            :data-testid="`layer-visible-${index}`"
            @click.stop="editor.setLayerVisible(index, !layer.visible)"
          >
            <template #icon><editor-icon :name="layer.visible ? 'eye' : 'eyeOff'" /></template>
          </n-button>
          <canvas :ref="(el) => setThumb(index, el)" class="thumb" aria-hidden="true" />
          <n-input
            v-if="renaming === index"
            ref="renameInput"
            v-model:value="draftName"
            size="tiny"
            :maxlength="40"
            class="rename"
            :aria-label="t('layers.rename')"
            data-testid="layer-rename-input"
            @blur="finishRename"
            @keydown="onRenameKey"
            @click.stop
          />
          <span v-else class="name">{{ layer.name }}</span>
          <span v-if="layer.opacity < 100" class="opacity">{{ layer.opacity }}%</span>
        </li>
      </ul>
      <div v-if="activeLayer" class="opacity-row">
        <n-text depth="3" class="label">{{ t('layers.opacity') }}</n-text>
        <n-slider
          :value="activeLayer.opacity"
          :min="0"
          :max="100"
          :step="5"
          :format-tooltip="(v: number) => `${v}%`"
          data-testid="layer-opacity"
          @update:value="(v: number) => editor.setLayerOpacity(active, v)"
        />
        <n-button
          size="tiny"
          quaternary
          :aria-label="t('layers.rename')"
          data-testid="layer-rename"
          @click="startRename(active)"
        >
          <template #icon><editor-icon name="rename" /></template>
        </n-button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.layers {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}
.title {
  font-size: 13px;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.hint {
  font-size: 12px;
}
.note {
  font-size: 12px;
}
.list {
  list-style: none;
  margin: 0;
  padding: 2px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 220px;
  overflow-y: auto;
  border-radius: 6px;
  outline: none;
}
.list:focus-visible {
  box-shadow: 0 0 0 2px rgba(24, 160, 88, 0.6);
}
.row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 6px 2px 2px;
  border-radius: 4px;
  cursor: pointer;
  border: 1px solid transparent;
  font-size: 12px;
}
.row:hover {
  background: rgba(128, 128, 128, 0.12);
}
.row.active {
  border-color: #18a058;
  background: rgba(24, 160, 88, 0.14);
}
.row.hidden .name,
.row.hidden .thumb {
  opacity: 0.45;
}
.thumb {
  width: 24px;
  height: 24px;
  flex: none;
  image-rendering: pixelated;
  background: repeating-conic-gradient(#d0d0d0 0% 25%, #f4f4f4 0% 50%) 50% / 8px 8px;
  border-radius: 2px;
}
.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rename {
  flex: 1;
}
.opacity {
  font-size: 11px;
  opacity: 0.7;
  font-variant-numeric: tabular-nums;
}
.opacity-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.opacity-row .label {
  font-size: 12px;
  flex: none;
}
</style>
