<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NButtonGroup, NInputNumber, NSwitch, NText, NTooltip, useMessage } from 'naive-ui'
import type { RgbaImage } from '@shared/image'
import {
  MAX_FRAME_TICKS,
  TICK_MS,
  blendFrames,
  frameTicks,
  isPlainOrder,
  playbackAt,
  playbackSequence
} from '@shared/animation'
import { useEditorStore } from '../../stores/editor'
import { call } from '../../services/ipc'
import { useErrorMessage } from '../../composables/useErrorMessage'

/** Timeline of an animated texture (PLAN M9): frames, playback, onion skin, timing and frame operations. */
const props = defineProps<{ packId: string }>()
const { t, locale } = useI18n()
const message = useMessage()
const { showError } = useErrorMessage()
const editor = computed(() => useEditorStore(props.packId))

const frames = computed(() => {
  void editor.value.revision
  return editor.value.frames ?? []
})
const anim = computed(() => editor.value.animation)
const count = computed(() => frames.value.length)
const current = computed(() => editor.value.frameIndex)
const customOrder = computed(() => !!anim.value && !isPlainOrder(anim.value.frames, count.value))
const frameTime = computed(() => anim.value?.frametime ?? 1)
const currentTicks = computed(() => (anim.value ? frameTicks(anim.value, current.value) : 1))
/** The current frame's own duration, or null when it uses the frame time. */
const ownTicks = computed(() =>
  anim.value?.frames?.some((f) => f.index === current.value && f.time !== undefined)
    ? currentTicks.value
    : null
)

function seconds(ticks: number): string {
  return t('animation.seconds', {
    s: ((ticks * TICK_MS) / 1000).toLocaleString(locale.value, { maximumFractionDigits: 2 })
  })
}

// ---------- thumbnails ----------
const thumbs = ref<HTMLCanvasElement[]>([])
const preview = ref<HTMLCanvasElement | null>(null)

function draw(target: HTMLCanvasElement | null | undefined, img: RgbaImage | undefined): void {
  if (!target || !img) return
  if (target.width !== img.width || target.height !== img.height) {
    target.width = img.width
    target.height = img.height
  }
  target
    .getContext('2d')!
    .putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0)
}

let thumbRaf = 0
function drawThumbs(): void {
  if (thumbRaf) return
  thumbRaf = requestAnimationFrame(() => {
    thumbRaf = 0
    frames.value.forEach((f, i) => draw(thumbs.value[i], f))
    if (!editor.value.playing) draw(preview.value, frames.value[current.value])
  })
}
watch(
  () => [editor.value.revision, count.value],
  () => void nextTick(drawThumbs),
  {
    immediate: true
  }
)

// ---------- playback ----------
let playRaf = 0
let start = 0
function tick(now: number): void {
  const a = anim.value
  const list = frames.value
  if (!editor.value.playing || !a || !list.length) {
    playRaf = 0
    return
  }
  const at = playbackAt(playbackSequence(a, list.length), now - start)
  const img = list[at.index]
  const next = list[at.next]
  draw(preview.value, a.interpolate && img && next ? blendFrames(img, next, at.t) : img)
  playRaf = requestAnimationFrame(tick)
}
watch(
  () => editor.value.playing,
  (playing) => {
    if (playing && !playRaf) {
      start = performance.now()
      playRaf = requestAnimationFrame(tick)
    } else if (!playing) drawThumbs()
  }
)
onBeforeUnmount(() => {
  if (playRaf) cancelAnimationFrame(playRaf)
  if (thumbRaf) cancelAnimationFrame(thumbRaf)
  editor.value.playing = false
})

// ---------- actions ----------
function setFrametime(v: number | null): void {
  if (v && v >= 1) editor.value.setFrametime(Math.round(v))
}

function setOwnTicks(v: number | null): void {
  editor.value.setFrameDuration(current.value, v && v >= 1 ? Math.round(v) : null)
}

const importing = ref(false)
async function importGif(): Promise<void> {
  const img = editor.value.image
  if (!img) return
  importing.value = true
  try {
    const gif = await call('texture.importGif', { frameWidth: img.width, frameHeight: img.height })
    if (!gif) return
    editor.value.importFrames(gif.png, gif.delaysMs)
    message.success(t('animation.imported', { count: gif.frames, name: gif.name }, gif.frames))
    if (gif.truncated) message.warning(t('animation.truncated'))
  } catch (err) {
    showError(err)
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <div class="timeline" data-testid="animation-panel">
    <div class="frames-row">
      <div class="player">
        <canvas ref="preview" class="preview" data-testid="anim-preview" />
        <n-button
          size="tiny"
          :type="editor.playing ? 'primary' : 'default'"
          data-testid="anim-play"
          @click="editor.playing = !editor.playing"
        >
          {{ editor.playing ? t('animation.pause') : t('animation.play') }}
        </n-button>
      </div>
      <div class="strip" data-testid="anim-frames">
        <button
          v-for="(_, i) in frames"
          :key="i"
          type="button"
          class="frame"
          :class="{ current: i === current }"
          :title="t('animation.frame', { n: i + 1 })"
          :data-testid="`anim-frame-${i}`"
          @click="editor.selectFrame(i)"
        >
          <canvas
            :ref="
              (el) => {
                if (el) thumbs[i] = el as HTMLCanvasElement
              }
            "
            class="thumb"
          />
          <span class="frame-label">{{ i + 1 }}</span>
          <span class="frame-time">{{ seconds(anim ? frameTicks(anim, i) : 1) }}</span>
        </button>
      </div>
    </div>

    <div class="controls">
      <n-button-group size="tiny">
        <n-button
          :disabled="!editor.canAddFrame"
          data-testid="anim-add"
          @click="editor.addFrame(false)"
        >
          {{ t('animation.add') }}
        </n-button>
        <n-button
          :disabled="!editor.canAddFrame"
          data-testid="anim-duplicate"
          @click="editor.addFrame(true)"
        >
          {{ t('animation.duplicate') }}
        </n-button>
        <n-button :disabled="count < 2" data-testid="anim-delete" @click="editor.deleteFrame()">
          {{ t('animation.delete') }}
        </n-button>
      </n-button-group>
      <n-button-group size="tiny">
        <n-button
          :disabled="current === 0"
          :title="t('animation.moveLeft')"
          data-testid="anim-move-left"
          @click="editor.moveFrame(current - 1)"
        >
          {{ t('animation.moveLeftShort') }}
        </n-button>
        <n-button
          :disabled="current >= count - 1"
          :title="t('animation.moveRight')"
          data-testid="anim-move-right"
          @click="editor.moveFrame(current + 1)"
        >
          {{ t('animation.moveRightShort') }}
        </n-button>
      </n-button-group>

      <n-tooltip>
        <template #trigger>
          <label class="field">
            <n-switch
              v-model:value="editor.onionSkin"
              size="small"
              :aria-label="t('animation.onion')"
              data-testid="anim-onion"
            />
            <n-text>{{ t('animation.onion') }}</n-text>
          </label>
        </template>
        {{ t('animation.onionHint') }}
      </n-tooltip>

      <n-tooltip>
        <template #trigger>
          <label class="field">
            <n-text>{{ t('animation.frametime') }}</n-text>
            <n-input-number
              size="tiny"
              class="ticks"
              :value="frameTime"
              :min="1"
              :max="MAX_FRAME_TICKS"
              :precision="0"
              data-testid="anim-frametime"
              @update:value="setFrametime"
            />
          </label>
        </template>
        {{ t('animation.ticksHint') }}
      </n-tooltip>

      <n-tooltip>
        <template #trigger>
          <label class="field">
            <n-text>{{ t('animation.frameDuration', { n: current + 1 }) }}</n-text>
            <n-input-number
              size="tiny"
              class="ticks"
              clearable
              :value="ownTicks"
              :placeholder="String(frameTime)"
              :min="1"
              :max="MAX_FRAME_TICKS"
              :precision="0"
              data-testid="anim-frame-ticks"
              @update:value="setOwnTicks"
            />
          </label>
        </template>
        {{ t('animation.frameDurationHint') }}
      </n-tooltip>

      <n-tooltip>
        <template #trigger>
          <label class="field">
            <n-switch
              :value="anim?.interpolate ?? false"
              :aria-label="t('animation.interpolate')"
              size="small"
              data-testid="anim-interpolate"
              @update:value="editor.setInterpolate"
            />
            <n-text>{{ t('animation.interpolate') }}</n-text>
          </label>
        </template>
        {{ t('animation.interpolateHint') }}
      </n-tooltip>

      <span class="spacer" />
      <n-button size="tiny" :loading="importing" data-testid="anim-import-gif" @click="importGif">
        {{ t('animation.importGif') }}
      </n-button>
      <n-button size="tiny" quaternary data-testid="anim-remove" @click="editor.removeAnimation()">
        {{ t('animation.remove') }}
      </n-button>
    </div>
    <n-text v-if="customOrder" depth="3" class="note">{{ t('animation.customOrder') }}</n-text>
  </div>
</template>

<style scoped>
.timeline {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 0 0;
  border-top: 1px solid rgba(128, 128, 128, 0.2);
  margin-top: 6px;
}
.frames-row {
  display: flex;
  gap: 8px;
  align-items: stretch;
  min-width: 0;
}
.player {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  flex: none;
}
.preview {
  width: 56px;
  height: 56px;
  image-rendering: pixelated;
  object-fit: contain;
  background: repeating-conic-gradient(#d8d8d8 0% 25%, #f4f4f4 0% 50%) 0 0 / 8px 8px;
  border-radius: 4px;
}
.strip {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  min-width: 0;
  flex: 1;
  padding-bottom: 2px;
}
.frame {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  padding: 3px;
  border: 2px solid transparent;
  border-radius: 6px;
  background: rgba(128, 128, 128, 0.08);
  cursor: pointer;
  color: inherit;
  font: inherit;
}
.frame.current {
  border-color: #18a058;
  background: rgba(24, 160, 88, 0.12);
}
.thumb {
  width: 40px;
  height: 40px;
  image-rendering: pixelated;
  object-fit: contain;
  background: repeating-conic-gradient(#d8d8d8 0% 25%, #f4f4f4 0% 50%) 0 0 / 6px 6px;
}
.frame-label {
  font-size: 11px;
  font-weight: 600;
}
.frame-time {
  font-size: 10px;
  opacity: 0.7;
  font-variant-numeric: tabular-nums;
}
.controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  font-size: 12px;
}
.field {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}
.ticks {
  width: 84px;
}
.spacer {
  flex: 1;
}
.note {
  font-size: 11px;
}
</style>
