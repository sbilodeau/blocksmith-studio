<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NButton,
  NTabs,
  NTabPane,
  NButtonGroup,
  NSpace,
  NTag,
  NText,
  NTooltip,
  useDialog
} from 'naive-ui'
import LoadingOverlay from '../common/LoadingOverlay.vue'
import { toHex, type Rgba } from '@shared/image'
import PixelCanvas from './PixelCanvas.vue'
import EditorToolbar from './EditorToolbar.vue'
import ColorPanel from './ColorPanel.vue'
import HistoryPanel from './HistoryPanel.vue'
import AnimationPanel from './AnimationPanel.vue'
import LayersPanel from './LayersPanel.vue'
import EditorIcon from './EditorIcon.vue'
import Preview3d from '../preview3d/Preview3D.vue'
import EditorAgentPanel from '../ai/EditorAgentPanel.vue'
import { useRouter } from 'vue-router'
import { useEditorStore, type EditorTool } from '../../stores/editor'
import { usePackStore } from '../../stores/pack'
import { useErrorMessage } from '../../composables/useErrorMessage'

const props = defineProps<{ packId: string }>()
const { t } = useI18n()
const dialog = useDialog()
const { showError } = useErrorMessage()

const pack = computed(() => usePackStore(props.packId))
const editor = computed(() => useEditorStore(props.packId))
const canvasRef = ref<InstanceType<typeof PixelCanvas> | null>(null)
const router = useRouter()
/** Right panel tab: drawing tools or the AI agent. */
const sideTab = ref<'draw' | 'ai'>('draw')

function openSettings(): void {
  guardUnsaved(() => void router.push({ name: 'settings' }))
}

/** Width of the 3D preview pane, adjusted with the drag handle. */
const previewWidth = ref(380)
function startResize(e: PointerEvent): void {
  const startX = e.clientX
  const startWidth = previewWidth.value
  const target = e.target as HTMLElement
  target.setPointerCapture(e.pointerId)
  const move = (ev: PointerEvent): void => {
    previewWidth.value = Math.min(900, Math.max(220, startWidth - (ev.clientX - startX)))
  }
  const up = (): void => {
    target.removeEventListener('pointermove', move)
    target.removeEventListener('pointerup', up)
  }
  target.addEventListener('pointermove', move)
  target.addEventListener('pointerup', up)
}
const hoverInfo = ref<{ x: number; y: number; color: Rgba } | null>(null)

const name = computed(() => editor.value.entry?.name ?? '')
const neighbors = computed(() => {
  const list = pack.value.visible.length ? pack.value.visible : pack.value.textures
  const i = list.findIndex((tex) => tex.path === editor.value.path)
  return {
    prev: i > 0 ? list[i - 1] : null,
    next: i >= 0 && i < list.length - 1 ? list[i + 1] : null
  }
})

/** Runs `action` after asking what to do with unsaved changes (save, discard or cancel). */
function guardUnsaved(action: () => void): void {
  if (!editor.value.dirty) {
    action()
    return
  }
  const d = dialog.warning({
    title: t('editor.unsavedTitle'),
    content: t('editor.unsavedBody', { name: name.value }),
    positiveText: t('editor.save'),
    negativeText: t('editor.discard'),
    closable: true,
    onPositiveClick: async () => {
      d.loading = true
      const ok = await save()
      if (ok) action()
    },
    onNegativeClick: () => action()
  })
}

async function save(): Promise<boolean> {
  try {
    await editor.value.save()
    return true
  } catch (err) {
    showError(err)
    return false
  }
}

function back(): void {
  guardUnsaved(() => {
    editor.value.close()
    pack.value.closeEditor()
  })
}

function go(direction: 'prev' | 'next'): void {
  const target = neighbors.value[direction]
  if (!target) return
  guardUnsaved(() => pack.value.openEditor(target.path))
}

function revert(): void {
  dialog.warning({
    title: t('editor.revertTitle'),
    content: t('editor.revertBody', { name: name.value }),
    positiveText: t('editor.revert'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      try {
        await editor.value.revertToVanilla()
      } catch (err) {
        showError(err)
      }
    }
  })
}

async function load(path: string | null): Promise<void> {
  if (!path) return
  const entry = pack.value.textures.find((tex) => tex.path === path)
  if (!entry) return
  try {
    if (editor.value.path !== path) await editor.value.open(entry)
  } catch (err) {
    showError(err)
  }
}

watch(() => pack.value.editing, load, { immediate: true })

// ---------- keyboard ----------
const TOOL_KEYS: Record<string, EditorTool> = {
  b: 'pencil',
  p: 'pencil',
  e: 'eraser',
  g: 'bucket',
  i: 'eyedropper',
  l: 'line',
  r: 'rect',
  m: 'select'
}

function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}

function onKeydown(e: KeyboardEvent): void {
  if (isTyping(e)) return
  const ed = editor.value
  const mod = e.metaKey || e.ctrlKey
  const key = e.key.toLowerCase()
  let handled = true
  if (mod && key === 'z' && !e.shiftKey) ed.undo()
  else if (mod && ((key === 'z' && e.shiftKey) || key === 'y')) ed.redo()
  else if (mod && key === 's') void save()
  else if (mod && key === 'c') ed.copy()
  else if (mod && key === 'x') ed.cut()
  else if (mod && key === 'v') ed.paste()
  else if (mod && key === 'a') ed.selectAll()
  else if (mod) handled = false
  else if (e.shiftKey && key === 'h') ed.flip('horizontal')
  else if (e.shiftKey && key === 'v') ed.flip('vertical')
  else if (key === ']') ed.rotate('clockwise')
  else if (key === '[') ed.rotate('counterclockwise')
  else if (TOOL_KEYS[key] && !e.shiftKey) {
    ed.commitFloating()
    ed.tool = TOOL_KEYS[key]
  } else if (key === 'x') ed.swapColors()
  else if (key === 'delete' || key === 'backspace') ed.deleteSelection()
  else if (key === 'escape') ed.deselect()
  else if (key === 'enter') ed.commitFloating()
  else if (key === '+' || key === '=') canvasRef.value?.zoomBy(1)
  else if (key === '-') canvasRef.value?.zoomBy(-1)
  else if (key === '0') canvasRef.value?.fit()
  else if (key === 'c' && ed.vanilla) ed.peekVanilla = true
  else if (key === '3') ed.show3d = !ed.show3d
  else if (key === ',' && ed.frames) ed.selectFrame(ed.frameIndex - 1)
  else if (key === '.' && ed.frames) ed.selectFrame(ed.frameIndex + 1)
  else if (key === 'pageup' || (e.altKey && key === 'arrowleft')) go('prev')
  else if (key === 'pagedown' || (e.altKey && key === 'arrowright')) go('next')
  else handled = false
  if (handled) e.preventDefault()
}

function onKeyup(e: KeyboardEvent): void {
  if (e.key.toLowerCase() === 'c') editor.value.peekVanilla = false
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('keyup', onKeyup)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('keyup', onKeyup)
  editor.value.peekVanilla = false
})

const statusTag = computed(() => {
  const s = editor.value.entry?.status ?? 'vanilla'
  return {
    label: t(`pack.status.${s}`),
    type: s === 'vanilla' ? 'default' : s === 'added' ? 'success' : 'warning'
  } as const
})
</script>

<template>
  <div class="editor" data-testid="texture-editor">
    <n-space justify="space-between" align="center" class="head" :wrap="false">
      <n-space align="center" :wrap="false">
        <n-button size="small" data-testid="editor-back" @click="back">{{
          t('editor.back')
        }}</n-button>
        <n-button-group size="small">
          <n-button :disabled="!neighbors.prev" data-testid="editor-prev" @click="go('prev')">
            {{ t('editor.prev') }}
          </n-button>
          <n-button :disabled="!neighbors.next" data-testid="editor-next" @click="go('next')">
            {{ t('editor.next') }}
          </n-button>
        </n-button-group>
        <div class="title">
          <n-text strong data-testid="editor-name">{{ name }}</n-text>
          <n-tag size="tiny" :type="statusTag.type" :bordered="false">{{ statusTag.label }}</n-tag>
          <n-tag
            v-if="editor.dirty"
            size="tiny"
            type="info"
            :bordered="false"
            data-testid="editor-dirty"
          >
            {{ t('editor.unsaved') }}
          </n-tag>
          <n-text depth="3" class="path">{{ editor.path }}</n-text>
        </div>
      </n-space>
      <n-space align="center" :wrap="false">
        <n-tooltip v-if="editor.vanilla">
          <template #trigger>
            <n-button
              size="small"
              :type="editor.compare ? 'primary' : 'default'"
              data-testid="editor-compare"
              @click="editor.compare = !editor.compare"
            >
              <template #icon><editor-icon name="compare" /></template>
              {{ t('editor.compare') }}
            </n-button>
          </template>
          {{ t('editor.compareHint') }}
        </n-tooltip>
        <n-tooltip>
          <template #trigger>
            <n-button
              size="small"
              :type="editor.show3d ? 'primary' : 'default'"
              data-testid="editor-3d"
              @click="editor.show3d = !editor.show3d"
            >
              {{ t('preview.toggle') }}
            </n-button>
          </template>
          {{ t('editor.shortcut', { label: t('preview.toggleHint'), key: '3' }) }}
        </n-tooltip>
        <n-tooltip v-if="editor.image && !editor.frames && !editor.animation && !editor.layers">
          <template #trigger>
            <n-button size="small" data-testid="editor-animate" @click="editor.animate()">
              {{ t('animation.animate') }}
            </n-button>
          </template>
          {{ t('animation.animateHint') }}
        </n-tooltip>
        <n-button
          v-if="editor.vanilla && editor.entry?.status === 'modified'"
          size="small"
          data-testid="editor-revert"
          @click="revert"
        >
          {{ t('editor.revert') }}
        </n-button>
        <n-button
          size="small"
          type="primary"
          :disabled="!editor.dirty"
          :loading="editor.saving"
          data-testid="editor-save"
          @click="save"
        >
          {{ t('editor.save') }}
        </n-button>
      </n-space>
    </n-space>

    <div class="body">
      <editor-toolbar
        class="tools"
        :pack-id="packId"
        @zoom="(s) => canvasRef?.zoomBy(s)"
        @fit="canvasRef?.fit()"
      />
      <div class="center">
        <loading-overlay :show="editor.loading" />
        <div class="canvases" :class="{ split: editor.compare && editor.vanilla }">
          <div v-if="editor.compare && editor.vanilla" class="pane">
            <n-text depth="3" class="pane-label">{{ t('editor.vanilla') }}</n-text>
            <pixel-canvas :pack-id="packId" source="vanilla" readonly />
          </div>
          <div class="pane">
            <n-text v-if="editor.compare && editor.vanilla" depth="3" class="pane-label">
              {{ t('editor.yours') }}
            </n-text>
            <pixel-canvas ref="canvasRef" :pack-id="packId" @hover="(h) => (hoverInfo = h)" />
          </div>
          <template v-if="editor.show3d">
            <div class="resizer" data-testid="preview3d-resizer" @pointerdown="startResize" />
            <div class="pane preview-pane" :style="{ flex: `0 0 ${previewWidth}px` }">
              <preview3d :pack-id="packId" />
            </div>
          </template>
        </div>
        <animation-panel v-if="editor.frames" :pack-id="packId" />
        <div class="status" data-testid="editor-status">
          <n-text v-if="editor.image" depth="3">
            {{ t('editor.size', { width: editor.image.width, height: editor.image.height }) }}
          </n-text>
          <n-text v-if="editor.frames" depth="3" data-testid="editor-frames">
            {{ t('editor.frameOf', { n: editor.frameIndex + 1, count: editor.frameCount }) }}
          </n-text>
          <n-text v-else-if="editor.animation" depth="3">{{ t('animation.unsupported') }}</n-text>
          <n-text depth="3" data-testid="editor-hover">
            <template v-if="hoverInfo">
              {{
                t('editor.hoverInfo', {
                  x: hoverInfo.x,
                  y: hoverInfo.y,
                  color: toHex(hoverInfo.color)
                })
              }}
            </template>
          </n-text>
          <n-text depth="3">{{ t('editor.zoomLevel', { zoom: editor.zoom }) }}</n-text>
          <n-text v-if="editor.peekVanilla" type="warning">{{ t('editor.showingVanilla') }}</n-text>
          <n-text depth="3" class="nav-hint">{{ t('editor.navHint') }}</n-text>
        </div>
      </div>
      <aside class="side">
        <n-tabs v-model:value="sideTab" type="segment" size="small" class="side-tabs" animated>
          <n-tab-pane name="draw" :tab="t('editor.tabDraw')" display-directive="show">
            <div class="side-scroll">
              <color-panel :pack-id="packId" />
              <layers-panel :pack-id="packId" />
              <history-panel :pack-id="packId" />
            </div>
          </n-tab-pane>
          <n-tab-pane
            name="ai"
            :tab="t('editor.tabAi')"
            display-directive="show:lazy"
            data-testid="side-tab-ai"
          >
            <editor-agent-panel :pack-id="packId" @open-settings="openSettings" />
          </n-tab-pane>
        </n-tabs>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.head {
  margin-bottom: 8px;
}
.title {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.path {
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 320px;
}
.body {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 8px;
}
.tools {
  flex: none;
  border-right: 1px solid rgba(128, 128, 128, 0.2);
  overflow-y: auto;
}
.center {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.center {
  position: relative;
}

.canvases {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 8px;
}
.pane {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.resizer {
  flex: 0 0 6px;
  cursor: col-resize;
  border-radius: 3px;
  background: rgba(128, 128, 128, 0.15);
}
.resizer:hover {
  background: rgba(24, 160, 88, 0.4);
}
.preview-pane {
  min-width: 220px;
}
.pane-label {
  font-size: 11px;
}
.status {
  display: flex;
  gap: 16px;
  padding: 4px 2px 0;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.nav-hint {
  margin-left: auto;
  font-size: 11px;
}
.side {
  width: 310px;
  flex: none;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding-left: 8px;
  border-left: 1px solid rgba(128, 128, 128, 0.2);
}
.side-tabs {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.side-tabs :deep(.n-tabs-pane-wrapper),
.side-tabs :deep(.n-tab-pane) {
  flex: 1;
  min-height: 0;
  height: 100%;
}
.side-tabs :deep(.n-tab-pane) {
  box-sizing: border-box;
}
.side-scroll {
  height: 100%;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
</style>
