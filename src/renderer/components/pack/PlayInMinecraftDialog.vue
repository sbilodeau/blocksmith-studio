<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NAlert,
  NButton,
  NCheckbox,
  NCheckboxGroup,
  NDivider,
  NForm,
  NFormItem,
  NModal,
  NSelect,
  NSpace,
  NSwitch,
  NText,
  type SelectOption
} from 'naive-ui'
import type { ExportPackType } from '@shared/model/pack'
import type { InstallResult, MinecraftTarget } from '@shared/model/minecraft'
import { exportTargets, findVersion, isSnapshot, versionTable } from '@shared/versions'
import type { PackStore } from '../../stores/pack'
import { useMinecraftStore } from '../../stores/minecraft'
import { useErrorMessage } from '../../composables/useErrorMessage'
import { IpcError } from '../../services/ipc'

/**
 * Install in Minecraft and live mode (M13): puts the pack in the game's own folders, once (a zip) or kept in sync
 * while editing (an unzipped "[live]" folder).
 */
const show = defineModel<boolean>('show', { required: true })
const props = defineProps<{ store: PackStore }>()

const { t, d } = useI18n()
const { errorText, showError } = useErrorMessage()
const minecraft = useMinecraftStore()

const packId = computed(() => props.store.packId)
const kind = computed(() => props.store.summary?.kind ?? 'resource')
const authoring = computed(() => props.store.summary?.authoringVersion ?? null)
const status = computed(() => minecraft.statuses[packId.value] ?? null)
const liveOn = computed(() => (status.value?.live.state ?? 'off') !== 'off')

const gameDirId = ref<string | null>(null)
const version = ref<string | null>(null)
const parts = ref<ExportPackType[]>(['resource'])
const worldId = ref<string | null>(null)
const busy = ref(false)
const installed = ref<InstallResult | null>(null)

const gameDir = computed(() => minecraft.gameDirs.find((g) => g.id === gameDirId.value) ?? null)
const gameDirOptions = computed<SelectOption[]>(() =>
  minecraft.gameDirs.map((g) => ({
    value: g.id,
    label: `${g.kind === 'official' ? t('play.official') : t('play.custom')} - ${g.path}`
  }))
)
const versionOptions = computed<SelectOption[]>(() => {
  const v = authoring.value ? findVersion(versionTable, authoring.value) : undefined
  if (!v) return []
  return exportTargets(versionTable, v).map((target) => ({
    value: target.id,
    label: isSnapshot(target)
      ? t('export.snapshotLabel', { version: target.id })
      : target.id === v.id
        ? t('export.packVersionLabel', { version: target.id })
        : target.id
  }))
})
const worldOptions = computed<SelectOption[]>(() =>
  (gameDir.value?.worlds ?? []).map((w) => ({ value: w.id, label: w.id }))
)
const needsWorld = computed(() => parts.value.includes('data'))
const ready = computed(
  () =>
    gameDirId.value !== null &&
    version.value !== null &&
    parts.value.length > 0 &&
    (!needsWorld.value || worldId.value !== null)
)
const target = computed<MinecraftTarget | null>(() =>
  ready.value
    ? {
        packId: packId.value,
        gameDirId: gameDirId.value!,
        version: version.value!,
        parts: [...parts.value],
        ...(needsWorld.value && worldId.value ? { worldId: worldId.value } : {})
      }
    : null
)

const statusText = computed(() => {
  const live = status.value?.live
  if (!live || live.state === 'off') return ''
  if (live.state === 'syncing') return t('play.status.syncing')
  if (live.state === 'synced') {
    return t('play.status.synced', {
      time: d(new Date(live.at), 'timeSeconds'),
      count: live.changed
    })
  }
  return t('play.status.error', {
    reason: errorText(new IpcError({ code: live.code, params: live.params }))
  })
})
const liveHint = computed(() => {
  const names = status.value?.liveNames ?? []
  const name = names[0] ?? ''
  const hints: string[] = []
  if (parts.value.includes('resource')) hints.push(t('play.liveHint', { name }))
  if (parts.value.includes('data')) hints.push(t('play.liveHintData', { name }))
  return hints.join(' ')
})

function defaultParts(): ExportPackType[] {
  if (kind.value === 'data') return ['data']
  if (kind.value === 'resource') return ['resource']
  return ['resource', 'data']
}

async function load(): Promise<void> {
  installed.value = null
  try {
    const [dirs, current] = await Promise.all([
      minecraft.loadGameDirs(),
      minecraft.loadStatus(packId.value)
    ])
    const link = current.link
    const available = new Set(versionOptions.value.map((o) => o.value as string))
    gameDirId.value =
      link && dirs.some((g) => g.id === link.gameDirId) ? link.gameDirId : (dirs[0]?.id ?? null)
    const remembered = props.store.summary?.exportProfile?.targets.find((v) => available.has(v))
    version.value =
      link && available.has(link.version) ? link.version : (remembered ?? authoring.value)
    parts.value = link ? link.parts.filter((p) => defaultParts().includes(p)) : defaultParts()
    if (parts.value.length === 0) parts.value = defaultParts()
    worldId.value = link?.worldId ?? null
  } catch (err) {
    showError(err)
  }
}

watch(
  show,
  (open) => {
    if (open) void load()
  },
  { immediate: true }
)
watch(gameDir, (dir) => {
  if (worldId.value && !dir?.worlds.some((w) => w.id === worldId.value)) worldId.value = null
  if (!worldId.value && dir?.worlds.length === 1) worldId.value = dir.worlds[0].id
})

async function addFolder(): Promise<void> {
  try {
    const added = await minecraft.addGameDir()
    if (added) gameDirId.value = added.id
  } catch (err) {
    showError(err)
  }
}

async function install(): Promise<void> {
  if (!target.value) return
  busy.value = true
  try {
    installed.value = await minecraft.install(target.value)
  } catch (err) {
    showError(err)
  } finally {
    busy.value = false
  }
}

async function setLive(on: boolean): Promise<void> {
  busy.value = true
  try {
    if (on && target.value) await minecraft.startLive(target.value)
    else if (!on) await minecraft.stopLive(packId.value)
  } catch (err) {
    showError(err)
  } finally {
    busy.value = false
  }
}

const installedText = computed(() => {
  const result = installed.value
  if (!result) return ''
  const names = [...new Set(result.written.map((w) => w.name))].join(', ')
  const hints = result.written.map((w) =>
    w.part === 'resource' ? t('play.installHint') : t('play.installHintData')
  )
  return [t('play.installed', { names }), ...new Set(hints)].join(' ')
})
</script>

<template>
  <n-modal
    v-model:show="show"
    preset="card"
    :title="t('play.title')"
    style="width: 560px; max-width: calc(100vw - 32px)"
    data-testid="play-dialog"
  >
    <n-alert
      v-if="minecraft.gameDirs.length === 0"
      type="warning"
      :show-icon="false"
      class="block"
      data-testid="play-no-game-dir"
    >
      {{ t('play.noGameDir') }}
    </n-alert>
    <n-form label-placement="top" :disabled="liveOn || busy">
      <n-form-item :label="t('play.gameDir')">
        <n-space vertical style="width: 100%">
          <n-select
            v-model:value="gameDirId"
            :options="gameDirOptions"
            :placeholder="t('play.gameDir')"
            data-testid="play-game-dir"
          />
          <n-button size="small" data-testid="play-add-folder" @click="addFolder">
            {{ t('play.addFolder') }}
          </n-button>
        </n-space>
      </n-form-item>
      <n-form-item :label="t('play.version')" :feedback="t('play.versionHint')">
        <n-select v-model:value="version" :options="versionOptions" data-testid="play-version" />
      </n-form-item>
      <n-form-item v-if="kind === 'combined'" :label="t('play.parts')">
        <n-checkbox-group v-model:value="parts">
          <n-space>
            <n-checkbox value="resource" :label="t('play.partResource')" />
            <n-checkbox value="data" :label="t('play.partData')" />
          </n-space>
        </n-checkbox-group>
      </n-form-item>
      <n-form-item v-if="needsWorld" :label="t('play.world')">
        <n-select
          v-model:value="worldId"
          :options="worldOptions"
          :placeholder="worldOptions.length ? t('play.world') : t('play.noWorlds')"
          data-testid="play-world"
        />
      </n-form-item>
    </n-form>

    <n-space vertical>
      <n-space align="center">
        <n-button
          type="primary"
          :disabled="!ready || liveOn"
          :loading="busy && !liveOn"
          data-testid="play-install"
          @click="install"
        >
          {{ t('play.install') }}
        </n-button>
        <n-button
          v-if="status?.link"
          :disabled="busy"
          data-testid="play-reveal"
          @click="minecraft.reveal(packId).catch(showError)"
        >
          {{ t('play.reveal') }}
        </n-button>
      </n-space>
      <n-text v-if="installed" depth="3" data-testid="play-installed">{{ installedText }}</n-text>
      <n-alert v-if="installed?.warnings.length" type="warning" :show-icon="false">
        {{ t('play.warnings', { count: installed.warnings.length }) }}
      </n-alert>
    </n-space>

    <n-divider />

    <n-space vertical>
      <n-space align="center" justify="space-between">
        <n-space vertical :size="2">
          <n-text strong>{{ t('play.live') }}</n-text>
          <n-text depth="3">{{ t('play.liveIntro') }}</n-text>
        </n-space>
        <n-switch
          :value="liveOn"
          :disabled="busy || (!liveOn && !ready)"
          :loading="busy"
          :aria-label="t('play.live')"
          data-testid="play-live"
          @update:value="setLive"
        />
      </n-space>
      <n-text
        v-if="statusText"
        :type="status?.live.state === 'error' ? 'error' : 'success'"
        data-testid="play-live-status"
      >
        {{ statusText }}
      </n-text>
      <n-text v-if="liveOn" depth="3" data-testid="play-live-hint">{{ liveHint }}</n-text>
      <n-text v-if="liveOn" depth="3">{{ t('play.liveLocked') }}</n-text>
    </n-space>
  </n-modal>
</template>

<style scoped>
.block {
  margin-bottom: 12px;
}
</style>
