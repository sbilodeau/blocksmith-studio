<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NDivider, NTooltip } from 'naive-ui'
import EditorIcon, { ICONS } from './EditorIcon.vue'
import { useEditorStore, type EditorTool } from '../../stores/editor'

const props = defineProps<{ packId: string }>()
// Components resolve the per-pack editor store themselves (state is edited in the store, not via props).
const editor = computed(() => useEditorStore(props.packId))
const emit = defineEmits<{ zoom: [step: 1 | -1]; fit: [] }>()
const { t } = useI18n()

const tools: Array<{ id: EditorTool; icon: keyof typeof ICONS; key: string }> = [
  { id: 'pencil', icon: 'pencil', key: 'B' },
  { id: 'eraser', icon: 'eraser', key: 'E' },
  { id: 'bucket', icon: 'bucket', key: 'G' },
  { id: 'eyedropper', icon: 'eyedropper', key: 'I' },
  { id: 'line', icon: 'line', key: 'L' },
  { id: 'rect', icon: 'rect', key: 'R' },
  { id: 'select', icon: 'select', key: 'M' }
]

function pick(tool: EditorTool): void {
  editor.value.commitFloating()
  editor.value.tool = tool
}
</script>

<template>
  <div class="toolbar" data-testid="editor-toolbar">
    <n-tooltip v-for="tool in tools" :key="tool.id" placement="right">
      <template #trigger>
        <n-button
          quaternary
          size="small"
          class="tool"
          :type="editor.tool === tool.id ? 'primary' : 'default'"
          :class="{ active: editor.tool === tool.id }"
          :aria-label="t(`editor.tools.${tool.id}`)"
          :aria-pressed="editor.tool === tool.id"
          :data-testid="`tool-${tool.id}`"
          @click="pick(tool.id)"
        >
          <editor-icon :name="tool.icon" />
        </n-button>
      </template>
      {{ t('editor.shortcut', { label: t(`editor.tools.${tool.id}`), key: tool.key }) }}
    </n-tooltip>

    <n-divider class="sep" />

    <n-tooltip placement="right">
      <template #trigger>
        <n-button
          quaternary
          size="small"
          class="tool"
          :class="{ active: editor.mirrorX }"
          :aria-label="t('editor.mirrorX')"
          :aria-pressed="editor.mirrorX"
          data-testid="toggle-mirror-x"
          @click="editor.mirrorX = !editor.mirrorX"
        >
          <editor-icon name="mirrorX" />
        </n-button>
      </template>
      {{ t('editor.mirrorX') }}
    </n-tooltip>
    <n-tooltip placement="right">
      <template #trigger>
        <n-button
          quaternary
          size="small"
          class="tool"
          :class="{ active: editor.mirrorY }"
          :aria-label="t('editor.mirrorY')"
          :aria-pressed="editor.mirrorY"
          data-testid="toggle-mirror-y"
          @click="editor.mirrorY = !editor.mirrorY"
        >
          <editor-icon name="mirrorY" />
        </n-button>
      </template>
      {{ t('editor.mirrorY') }}
    </n-tooltip>

    <n-divider class="sep" />

    <n-tooltip placement="right">
      <template #trigger>
        <n-button
          quaternary
          size="small"
          class="tool"
          :aria-label="t('editor.rotateCcw')"
          data-testid="rotate-ccw"
          @click="editor.rotate('counterclockwise')"
        >
          <editor-icon name="rotateCcw" />
        </n-button>
      </template>
      {{ t('editor.rotateCcw') }}
    </n-tooltip>
    <n-tooltip placement="right">
      <template #trigger>
        <n-button
          quaternary
          size="small"
          class="tool"
          :aria-label="t('editor.rotateCw')"
          data-testid="rotate-cw"
          @click="editor.rotate('clockwise')"
        >
          <editor-icon name="rotateCw" />
        </n-button>
      </template>
      {{ t('editor.rotateCw') }}
    </n-tooltip>
    <n-tooltip placement="right">
      <template #trigger>
        <n-button
          quaternary
          size="small"
          class="tool"
          :aria-label="t('editor.flipH')"
          data-testid="flip-h"
          @click="editor.flip('horizontal')"
        >
          <editor-icon name="flipH" />
        </n-button>
      </template>
      {{ t('editor.flipH') }}
    </n-tooltip>
    <n-tooltip placement="right">
      <template #trigger>
        <n-button
          quaternary
          size="small"
          class="tool"
          :aria-label="t('editor.flipV')"
          data-testid="flip-v"
          @click="editor.flip('vertical')"
        >
          <editor-icon name="flipV" />
        </n-button>
      </template>
      {{ t('editor.flipV') }}
    </n-tooltip>

    <n-divider class="sep" />

    <n-tooltip placement="right">
      <template #trigger>
        <n-button
          quaternary
          size="small"
          class="tool"
          :class="{ active: editor.showGrid }"
          :aria-label="t('editor.grid')"
          :aria-pressed="editor.showGrid"
          data-testid="toggle-grid"
          @click="editor.showGrid = !editor.showGrid"
        >
          <editor-icon name="grid" />
        </n-button>
      </template>
      {{ t('editor.grid') }}
    </n-tooltip>
    <n-tooltip placement="right">
      <template #trigger>
        <n-button
          quaternary
          size="small"
          class="tool"
          :aria-label="t('editor.zoomIn')"
          data-testid="zoom-in"
          @click="emit('zoom', 1)"
        >
          <editor-icon name="zoomIn" />
        </n-button>
      </template>
      {{ t('editor.shortcut', { label: t('editor.zoomIn'), key: '+' }) }}
    </n-tooltip>
    <n-tooltip placement="right">
      <template #trigger>
        <n-button
          quaternary
          size="small"
          class="tool"
          :aria-label="t('editor.zoomOut')"
          data-testid="zoom-out"
          @click="emit('zoom', -1)"
        >
          <editor-icon name="zoomOut" />
        </n-button>
      </template>
      {{ t('editor.shortcut', { label: t('editor.zoomOut'), key: '-' }) }}
    </n-tooltip>
    <n-tooltip placement="right">
      <template #trigger>
        <n-button
          quaternary
          size="small"
          class="tool"
          :aria-label="t('editor.fit')"
          data-testid="zoom-fit"
          @click="emit('fit')"
        >
          <editor-icon name="fit" />
        </n-button>
      </template>
      {{ t('editor.shortcut', { label: t('editor.fit'), key: '0' }) }}
    </n-tooltip>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 4px;
}
.tool {
  width: 34px;
  height: 34px;
  padding: 0;
}
.tool.active {
  background: rgba(24, 160, 88, 0.16);
}
.sep {
  margin: 6px 0;
  width: 24px;
  min-width: 24px;
}
</style>
