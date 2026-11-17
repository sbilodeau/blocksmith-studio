<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NButton,
  NModal,
  NPopconfirm,
  NSpace,
  NSpin,
  NTabPane,
  NTabs,
  NText,
  useMessage
} from 'naive-ui'
import {
  DEFAULT_CATEGORY_RULES,
  categoryRulesKey,
  validateCategoryRules,
  type CategoryRule
} from '@shared/categories'
import { call } from '../../services/ipc'
import { usePackStore } from '../../stores/pack'
import { useErrorMessage } from '../../composables/useErrorMessage'
import CategoryRulesEditor from './CategoryRulesEditor.vue'

/**
 * Category mapping editor (M11), opened from the pack's category sidebar. Two scopes as tabs: "All packs" (the
 * user's copy of the whole mapping) and "This pack" (rules stored in the pack's project.json, applied on top).
 * Save writes what changed; main then emits 'packs.changed' and the open tabs reload their categories.
 */
const props = defineProps<{ packId: string }>()
const show = defineModel<boolean>('show', { required: true })
const { t } = useI18n()
const message = useMessage()
const { showError } = useErrorMessage()
const pack = computed(() => usePackStore(props.packId))

const tab = ref<'global' | 'pack'>('global')
const loading = ref(false)
const saving = ref(false)
const globalRules = ref<CategoryRule[]>([])
const packRules = ref<CategoryRule[]>([])
/** What was loaded (to save only the scopes that changed). */
const loadedGlobal = ref('')
const loadedPack = ref('')
const customized = ref(false)
/** Bumped on every load so the editors start fresh (selection, new-name field). */
const generation = ref(0)

async function load(): Promise<void> {
  loading.value = true
  try {
    const [state, overrides] = await Promise.all([
      call('categories.get'),
      call('pack.categoryOverrides', { packId: props.packId })
    ])
    globalRules.value = structuredClone(state.rules)
    packRules.value = structuredClone(overrides)
    customized.value = state.customized
    loadedGlobal.value = categoryRulesKey(state.rules)
    loadedPack.value = categoryRulesKey(overrides)
    generation.value++
  } catch (err) {
    showError(err)
    show.value = false
  } finally {
    loading.value = false
  }
}

watch(
  show,
  (open) => {
    if (open) {
      tab.value = 'global'
      void load()
    }
  },
  { immediate: true }
)

const paths = computed(() => pack.value.textures.map((e) => e.path))
const urls = computed(() => new Map(pack.value.textures.map((e) => [e.path, e.url])))
function iconUrl(path: string): string | undefined {
  return urls.value.get(path)
}

const globalChanged = computed(() => categoryRulesKey(globalRules.value) !== loadedGlobal.value)
const packChanged = computed(() => categoryRulesKey(packRules.value) !== loadedPack.value)
const globalInvalid = computed(() => validateCategoryRules(globalRules.value).length > 0)
const packInvalid = computed(() => validateCategoryRules(packRules.value).length > 0)
const canSave = computed(
  () =>
    !saving.value &&
    !loading.value &&
    (globalChanged.value || packChanged.value) &&
    !globalInvalid.value &&
    !packInvalid.value
)

const defaultsKey = categoryRulesKey(DEFAULT_CATEGORY_RULES)
function resetToDefaults(): void {
  globalRules.value = structuredClone([...DEFAULT_CATEGORY_RULES])
  generation.value++
}

async function save(): Promise<void> {
  if (!canSave.value) return
  saving.value = true
  try {
    if (globalChanged.value) {
      // Back to exactly the defaults: remove the user file so future default changes apply.
      if (categoryRulesKey(globalRules.value) === defaultsKey) await call('categories.reset')
      else await call('categories.save', { rules: globalRules.value })
    }
    if (packChanged.value) {
      await call('pack.setCategoryOverrides', { packId: props.packId, overrides: packRules.value })
    }
    message.success(t('categoriesEditor.saved'))
    show.value = false
  } catch (err) {
    showError(err)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <n-modal
    v-model:show="show"
    preset="card"
    :title="t('categoriesEditor.title')"
    style="width: min(980px, 96vw)"
    :mask-closable="false"
    data-testid="cat-editor"
  >
    <n-spin :show="loading">
      <n-tabs v-model:value="tab" type="line" animated>
        <n-tab-pane name="global" :tab="t('categoriesEditor.tabs.all')">
          <category-rules-editor
            :key="`g${generation}`"
            v-model:rules="globalRules"
            scope="global"
            :paths="paths"
            :icon-url="iconUrl"
          />
        </n-tab-pane>
        <n-tab-pane name="pack" :tab="t('categoriesEditor.tabs.pack')">
          <category-rules-editor
            :key="`p${generation}`"
            v-model:rules="packRules"
            scope="pack"
            :base-rules="globalRules"
            :paths="paths"
            :icon-url="iconUrl"
          />
        </n-tab-pane>
      </n-tabs>
    </n-spin>
    <template #footer>
      <n-space justify="space-between" align="center">
        <n-popconfirm
          v-if="tab === 'global'"
          :positive-text="t('categoriesEditor.reset')"
          :negative-text="t('categoriesEditor.cancel')"
          @positive-click="resetToDefaults"
        >
          <template #trigger>
            <n-button
              size="small"
              :disabled="!customized && !globalChanged"
              data-testid="cat-reset"
            >
              {{ t('categoriesEditor.reset') }}
            </n-button>
          </template>
          {{ t('categoriesEditor.resetConfirm') }}
        </n-popconfirm>
        <span v-else />
        <n-space align="center">
          <n-text v-if="globalInvalid || packInvalid" type="error" class="issues">
            {{ t('categoriesEditor.hasIssues') }}
          </n-text>
          <n-button @click="show = false">{{ t('categoriesEditor.cancel') }}</n-button>
          <n-button
            type="primary"
            :disabled="!canSave"
            :loading="saving"
            data-testid="cat-save"
            @click="save"
          >
            {{ t('categoriesEditor.save') }}
          </n-button>
        </n-space>
      </n-space>
    </template>
  </n-modal>
</template>

<style scoped>
.issues {
  font-size: 12px;
}
</style>
