<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import {
  NAlert,
  NButton,
  NCheckbox,
  NCollapse,
  NCollapseItem,
  NForm,
  NFormItem,
  NInput,
  NModal,
  NRadio,
  NRadioGroup,
  NSelect,
  NSpace,
  NText,
  useMessage,
  type SelectOption
} from 'naive-ui'
import type { MergePlan, MergeTarget } from '@shared/model/merge'
import PngThumb from '../ai/PngThumb.vue'
import { call } from '../../services/ipc'
import { usePacksStore } from '../../stores/packs'
import { useTabsStore } from '../../stores/tabs'
import { useErrorMessage } from '../../composables/useErrorMessage'

/**
 * Merge packs / send to pack (PLAN 8.6, M8). Merge: sources in priority order (the first wins) into an existing or
 * new pack. Send: the selected files of one pack. The preview classifies every file (added, identical, merged JSON,
 * conflicts, skipped); conflicts are chosen side by side; applying writes one history entry in the target.
 */
const show = defineModel<boolean>('show', { required: true })
const props = withDefaults(
  defineProps<{
    mode: 'merge' | 'send'
    /** Send: the pack the files come from. Merge: preselected source. */
    sourcePackId?: string
    /** Send: the files to send (pack files only). */
    paths?: string[]
  }>(),
  { sourcePackId: undefined, paths: () => [] }
)
const { t } = useI18n()
const router = useRouter()
const message = useMessage()
const { showError } = useErrorMessage()
const packs = usePacksStore()
const tabs = useTabsStore()

const NEW = '__new__'
const sources = ref<string[]>([])
const targetChoice = ref<string | null>(null)
const newName = ref('')
const mergeBriefs = ref(false)
const plan = ref<MergePlan | null>(null)
const choices = ref<Record<string, string>>({})
const busy = ref(false)

watch(show, (open) => {
  if (!open) {
    if (plan.value) void call('merge.discard', { planId: plan.value.id }).catch(() => undefined)
    plan.value = null
    return
  }
  void packs.refresh().catch(showError)
  sources.value = props.sourcePackId ? [props.sourcePackId] : []
  targetChoice.value = null
  newName.value = ''
  mergeBriefs.value = false
  plan.value = null
})

const nameOf = (id: string): string => packs.find(id)?.name ?? id
const sourceOptions = computed<SelectOption[]>(() =>
  packs.packs.map((p) => ({ value: p.id, label: `${p.name} (${p.authoringVersion})` }))
)
const targetOptions = computed<SelectOption[]>(() => [
  { value: NEW, label: t('merge.newPack') },
  ...packs.packs
    .filter((p) => !sources.value.includes(p.id))
    .map((p) => ({ value: p.id, label: `${p.name} (${p.authoringVersion})` }))
])

function move(i: number, delta: number): void {
  const list = [...sources.value]
  const j = i + delta
  if (j < 0 || j >= list.length) return
  ;[list[i], list[j]] = [list[j]!, list[i]!]
  sources.value = list
}

const target = computed<MergeTarget | null>(() => {
  if (targetChoice.value === NEW) {
    return newName.value.trim()
      ? { kind: 'new', name: newName.value.trim(), description: '' }
      : null
  }
  return targetChoice.value ? { kind: 'pack', packId: targetChoice.value } : null
})
const canPreview = computed(
  () =>
    target.value !== null &&
    sources.value.length > 0 &&
    (props.mode === 'merge' || props.paths.length > 0)
)

async function preview(): Promise<void> {
  if (!target.value) return
  busy.value = true
  try {
    plan.value = await call('merge.preview', {
      sources: [...sources.value],
      target: { ...target.value },
      ...(props.mode === 'send' ? { paths: [...props.paths] } : {}),
      mergeBriefs: mergeBriefs.value
    })
    choices.value = Object.fromEntries(plan.value.conflicts.map((c) => [c.path, c.choice]))
  } catch (err) {
    showError(err)
  } finally {
    busy.value = false
  }
}

function back(): void {
  if (plan.value) void call('merge.discard', { planId: plan.value.id }).catch(() => undefined)
  plan.value = null
}

function chooseAll(origin: 'top' | 'target'): void {
  if (!plan.value) return
  choices.value = Object.fromEntries(
    plan.value.conflicts.map((c) => [
      c.path,
      origin === 'target' && c.candidates.some((x) => x.origin === 'target') ? 'target' : c.choice
    ])
  )
}

const hasTargetCandidates = computed(
  () => plan.value?.conflicts.some((c) => c.candidates.some((x) => x.origin === 'target')) ?? false
)
const nothingToDo = computed(
  () =>
    !!plan.value &&
    plan.value.added.length === 0 &&
    plan.value.merged.length === 0 &&
    plan.value.conflicts.length === 0 &&
    !plan.value.mergeBriefs
)

async function apply(): Promise<void> {
  if (!plan.value) return
  busy.value = true
  try {
    const result = await call('merge.apply', {
      planId: plan.value.id,
      choices: { ...choices.value }
    })
    plan.value = null
    show.value = false
    message.success(
      t('merge.done', { count: result.written, name: result.pack.name }, result.written) +
        (result.briefMerged ? ` ${t('merge.briefDone')}` : '')
    )
    await packs.refresh().catch(() => undefined)
    if (result.created) {
      tabs.openPack(result.pack.id, result.pack.name)
      void router.push({ name: 'pack', params: { packId: result.pack.id } })
    }
  } catch (err) {
    showError(err)
  } finally {
    busy.value = false
  }
}

function short(path: string): string {
  return path.replace(/^assets\/minecraft\/textures\//, '')
}
</script>

<template>
  <n-modal
    v-model:show="show"
    preset="card"
    :title="mode === 'merge' ? t('merge.title') : t('merge.sendTitle')"
    style="width: 640px"
    :mask-closable="!busy"
    data-testid="merge-dialog"
  >
    <!-- Step 1: sources and target -->
    <n-form v-if="!plan" label-placement="top">
      <n-form-item
        v-if="mode === 'merge'"
        :label="t('merge.sources')"
        :feedback="t('merge.sourcesHint')"
      >
        <div class="sources">
          <n-select
            v-model:value="sources"
            multiple
            filterable
            :options="sourceOptions"
            data-testid="merge-sources"
          />
          <ol v-if="sources.length > 1" class="order" data-testid="merge-order">
            <li v-for="(id, i) in sources" :key="id">
              <span class="rank">{{ i + 1 }}.</span>
              <span class="name">{{ nameOf(id) }}</span>
              <n-button
                size="tiny"
                quaternary
                :disabled="i === 0"
                :aria-label="t('merge.moveUp')"
                @click="move(i, -1)"
                >{{ t('merge.up') }}</n-button
              >
              <n-button
                size="tiny"
                quaternary
                :disabled="i === sources.length - 1"
                :aria-label="t('merge.moveDown')"
                @click="move(i, 1)"
                >{{ t('merge.down') }}</n-button
              >
            </li>
          </ol>
        </div>
      </n-form-item>
      <n-alert v-else type="info" :show-icon="false" class="send">
        {{
          t(
            'merge.sendSummary',
            { count: paths.length, name: nameOf(sourcePackId ?? '') },
            paths.length
          )
        }}
      </n-alert>
      <n-form-item :label="t('merge.target')">
        <n-select
          v-model:value="targetChoice"
          :options="targetOptions"
          filterable
          data-testid="merge-target"
        />
      </n-form-item>
      <n-form-item v-if="targetChoice === NEW" :label="t('merge.newName')">
        <n-input v-model:value="newName" data-testid="merge-new-name" />
      </n-form-item>
      <n-checkbox v-model:checked="mergeBriefs" data-testid="merge-briefs">
        {{ t('merge.mergeBriefs') }}
      </n-checkbox>
    </n-form>

    <!-- Step 2: review -->
    <div v-else class="review" data-testid="merge-review">
      <ul class="counts">
        <li data-testid="merge-added">
          {{ t('merge.added', { count: plan.added.length }, plan.added.length) }}
        </li>
        <li>{{ t('merge.identical', { count: plan.identical }, plan.identical) }}</li>
        <li v-if="plan.merged.length">
          {{ t('merge.merged', { count: plan.merged.length }, plan.merged.length) }}
        </li>
        <li v-if="plan.renamed">
          {{
            t(
              'merge.renamed',
              { count: plan.renamed, version: plan.target.authoringVersion },
              plan.renamed
            )
          }}
        </li>
        <li v-if="plan.skipped.length" :title="plan.skipped.map((s) => short(s.path)).join('\n')">
          <n-text type="warning">{{
            t(
              'merge.skipped',
              { count: plan.skipped.length, version: plan.target.authoringVersion },
              plan.skipped.length
            )
          }}</n-text>
        </li>
        <li v-if="plan.target.created">
          {{
            t('merge.willCreate', { name: plan.target.name, version: plan.target.authoringVersion })
          }}
        </li>
      </ul>

      <template v-if="plan.conflicts.length">
        <n-space justify="space-between" align="center">
          <n-text strong>{{
            t('merge.conflicts', { count: plan.conflicts.length }, plan.conflicts.length)
          }}</n-text>
          <n-space size="small">
            <n-button size="tiny" quaternary @click="chooseAll('top')">{{
              t('merge.allTop')
            }}</n-button>
            <n-button
              v-if="hasTargetCandidates"
              size="tiny"
              quaternary
              @click="chooseAll('target')"
            >
              {{ t('merge.allTarget') }}
            </n-button>
          </n-space>
        </n-space>
        <div class="conflicts" data-testid="merge-conflicts">
          <div v-for="conflict in plan.conflicts" :key="conflict.path" class="conflict">
            <n-text code class="path">{{ short(conflict.path) }}</n-text>
            <n-radio-group v-model:value="choices[conflict.path]" size="small">
              <n-space>
                <n-radio
                  v-for="c in conflict.candidates"
                  :key="c.origin"
                  :value="c.origin"
                  :data-testid="`merge-choice-${c.origin === 'target' ? 'target' : c.originName}`"
                >
                  <span class="candidate">
                    <png-thumb v-if="c.png" :png="c.png" :size="40" />
                    <span>{{ c.origin === 'target' ? t('merge.keepTarget') : c.originName }}</span>
                  </span>
                </n-radio>
              </n-space>
            </n-radio-group>
            <n-collapse v-if="conflict.kind !== 'png'">
              <n-collapse-item :title="t('merge.showText')" :name="conflict.path">
                <div v-for="c in conflict.candidates" :key="c.origin" class="text">
                  <n-text depth="3">{{
                    c.origin === 'target' ? t('merge.keepTarget') : c.originName
                  }}</n-text>
                  <pre>{{ c.text ?? '' }}</pre>
                </div>
              </n-collapse-item>
            </n-collapse>
          </div>
        </div>
      </template>
      <n-alert v-if="nothingToDo" type="success" :show-icon="false">{{
        t('merge.nothing')
      }}</n-alert>
    </div>

    <template #footer>
      <n-space justify="end">
        <n-button v-if="plan" :disabled="busy" @click="back">{{ t('merge.back') }}</n-button>
        <n-button v-else :disabled="busy" @click="show = false">{{ t('common.cancel') }}</n-button>
        <n-button
          v-if="!plan"
          type="primary"
          :loading="busy"
          :disabled="!canPreview"
          data-testid="merge-preview"
          @click="preview"
        >
          {{ t('merge.preview') }}
        </n-button>
        <n-button
          v-else
          type="primary"
          :loading="busy"
          :disabled="nothingToDo"
          data-testid="merge-apply"
          @click="apply"
        >
          {{ t('merge.apply') }}
        </n-button>
      </n-space>
    </template>
  </n-modal>
</template>

<style scoped>
.sources {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}
.order {
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 12px;
}
.order li {
  display: flex;
  align-items: center;
  gap: 6px;
}
.rank {
  width: 18px;
}
.name {
  flex: 1;
}
.send {
  margin-bottom: 12px;
}
.counts {
  margin: 0 0 12px;
  padding-left: 18px;
  font-size: 13px;
}
.conflicts {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 360px;
  overflow-y: auto;
  margin-top: 8px;
}
.conflict {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.path {
  font-size: 12px;
}
.candidate {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.text pre {
  margin: 2px 0 6px;
  max-height: 140px;
  overflow: auto;
  font-size: 11px;
}
</style>
