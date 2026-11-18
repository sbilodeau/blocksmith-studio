<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NAlert,
  NButton,
  NCollapse,
  NCollapseItem,
  NDrawer,
  NDrawerContent,
  NSpin,
  NTable,
  NText
} from 'naive-ui'
import type { DoctorReport } from '@shared/model/pack'
import { call } from '../../services/ipc'
import { usePackStore } from '../../stores/pack'
import { useErrorMessage } from '../../composables/useErrorMessage'

/**
 * Pack Doctor (PLAN 8.5, M7): every problem found in the pack's files (the export checks plus texture proportions
 * against vanilla), and, for each Minecraft version the pack can be exported to, how many textures would be renamed
 * or skipped. Clicking a texture opens it in the editor. Custom item issues (M14) open the item, and the ones about
 * generated files offer to regenerate them.
 */
const props = defineProps<{ packId: string }>()
const show = defineModel<boolean>('show', { required: true })
const emit = defineEmits<{ 'open-item': [id: string] }>()
const { t, te } = useI18n()
const { showError } = useErrorMessage()
const pack = computed(() => usePackStore(props.packId))
const report = ref<DoctorReport | null>(null)
const loading = ref(false)
/** Item being regenerated (its button spins). */
const regenerating = ref<string | null>(null)
/** Issues fixed by writing the item's generated files again. */
const REGENERATE = new Set([
  'items.generatedEdited',
  'items.generatedMissing',
  'items.langOutdated'
])

async function refresh(): Promise<void> {
  loading.value = true
  try {
    report.value = await call('pack.doctor', { packId: props.packId })
  } catch (err) {
    showError(err)
  } finally {
    loading.value = false
  }
}

watch(show, (open) => {
  if (open) void refresh()
})

type Issue = DoctorReport['issues'][number]

/** Issues grouped by code, in a stable order. */
const groups = computed(() => {
  const map = new Map<string, Issue[]>()
  for (const issue of report.value?.issues ?? []) {
    const list = map.get(issue.code) ?? []
    if (issue.path || issue.itemId) list.push(issue)
    map.set(issue.code, list)
  }
  return [...map].map(([code, issues]) => ({ code, issues }))
})

function label(code: string): string {
  return te(`warnings.${code}`) ? t(`warnings.${code}`) : code
}

function short(path: string): string {
  return path.replace(/^assets\/minecraft\/textures\//, '')
}

function isTexture(path: string): boolean {
  return /^assets\/[^/]+\/textures\/.+\.png$/.test(path)
}

function open(path: string): void {
  show.value = false
  pack.value.openEditor(path)
}

function openItem(id: string): void {
  show.value = false
  emit('open-item', id)
}

async function regenerate(id: string): Promise<void> {
  regenerating.value = id
  try {
    await call('items.regenerate', { packId: props.packId, id })
    await refresh()
  } catch (err) {
    showError(err)
  } finally {
    regenerating.value = null
  }
}
</script>

<template>
  <n-drawer v-model:show="show" :width="520" placement="right">
    <n-drawer-content :title="t('doctor.title')" closable>
      <div class="doctor" data-testid="pack-doctor">
        <n-spin :show="loading">
          <template v-if="report">
            <n-text depth="3" class="intro">{{
              t('doctor.checked', { count: report.files }, report.files)
            }}</n-text>

            <h4>{{ t('doctor.problems') }}</h4>
            <n-alert
              v-if="groups.length === 0"
              type="success"
              :show-icon="false"
              data-testid="doctor-ok"
            >
              {{ t('doctor.none') }}
            </n-alert>
            <n-collapse v-else data-testid="doctor-issues">
              <n-collapse-item
                v-for="group in groups"
                :key="group.code"
                :name="group.code"
                :title="
                  group.issues.length
                    ? `${label(group.code)} (${group.issues.length})`
                    : label(group.code)
                "
              >
                <ul class="paths">
                  <li
                    v-for="(issue, i) in group.issues"
                    :key="`${issue.path ?? ''}#${issue.itemId ?? ''}#${i}`"
                    class="issue"
                  >
                    <template v-if="issue.path">
                      <n-button
                        v-if="isTexture(issue.path) && !issue.itemId"
                        text
                        size="tiny"
                        type="primary"
                        @click="open(issue.path)"
                      >
                        {{ short(issue.path) }}
                      </n-button>
                      <n-text v-else code>{{ issue.path }}</n-text>
                    </template>
                    <span v-if="issue.itemId" class="actions">
                      <n-button
                        size="tiny"
                        secondary
                        :data-testid="`doctor-open-item-${issue.itemId}`"
                        @click="openItem(issue.itemId)"
                      >
                        {{ t('doctor.openItem') }}
                      </n-button>
                      <n-button
                        v-if="REGENERATE.has(issue.code)"
                        size="tiny"
                        type="primary"
                        secondary
                        :loading="regenerating === issue.itemId"
                        :disabled="regenerating !== null"
                        :data-testid="`doctor-regenerate-${issue.itemId}`"
                        @click="regenerate(issue.itemId)"
                      >
                        {{ t('doctor.regenerate') }}
                      </n-button>
                    </span>
                  </li>
                </ul>
              </n-collapse-item>
            </n-collapse>

            <h4>{{ t('doctor.targets') }}</h4>
            <n-text depth="3" class="intro">{{ t('doctor.targetsHint') }}</n-text>
            <n-table size="small" :bordered="false" data-testid="doctor-targets">
              <thead>
                <tr>
                  <th>{{ t('doctor.version') }}</th>
                  <th>{{ t('doctor.renamed') }}</th>
                  <th>{{ t('doctor.skipped') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="target in report.targets" :key="target.version">
                  <td>{{ target.version }}</td>
                  <td>{{ target.renamed }}</td>
                  <td :title="target.missing.map(short).join('\n')">
                    <n-text :type="target.missing.length ? 'warning' : 'default'">
                      {{ target.missing.length }}
                    </n-text>
                  </td>
                </tr>
              </tbody>
            </n-table>
          </template>
        </n-spin>
      </div>
    </n-drawer-content>
  </n-drawer>
</template>

<style scoped>
.doctor h4 {
  margin: 16px 0 6px;
}
.intro {
  font-size: 12px;
  display: block;
  margin-bottom: 6px;
}
.paths {
  margin: 0;
  padding-left: 16px;
  font-size: 12px;
}
.issue {
  margin-bottom: 4px;
}
.actions {
  display: inline-flex;
  gap: 6px;
  margin-left: 8px;
}
</style>
