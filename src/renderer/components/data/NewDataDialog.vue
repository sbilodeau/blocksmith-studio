<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NButton,
  NForm,
  NFormItem,
  NInput,
  NModal,
  NSelect,
  NSpace,
  NText,
  type SelectOption
} from 'naive-ui'
import {
  DATA_TEMPLATES,
  TAG_REGISTRIES,
  buildDataPath,
  dataTemplate,
  namespaceFor,
  parseDataPath,
  type DataKind,
  type DataTemplate
} from '@shared/datapack'
import { DATA_SECTIONS, useDataStore } from '../../stores/data'
import { useErrorMessage } from '../../composables/useErrorMessage'

const show = defineModel<boolean>('show', { required: true })
const props = defineProps<{ packId: string; packName: string }>()
const { t } = useI18n()
const { showError } = useErrorMessage()
const store = computed(() => useDataStore(props.packId))

const kind = ref<DataKind>('recipe')
const template = ref<DataTemplate>('shaped')
const registry = ref<string>('item')
const namespace = ref('')
const name = ref('')
const creating = ref(false)

watch(
  show,
  (open) => {
    if (!open) return
    kind.value = store.value.kind
    template.value = DATA_TEMPLATES[kind.value][0]
    registry.value = 'item'
    namespace.value = namespaceFor(props.packName)
    name.value = ''
  },
  { immediate: true }
)
watch(kind, (k) => {
  if (!(DATA_TEMPLATES[k] as readonly string[]).includes(template.value))
    template.value = DATA_TEMPLATES[k][0]
})

const kindOptions = computed<SelectOption[]>(() =>
  DATA_SECTIONS.map((k) => ({ value: k, label: t(`data.kinds.${k}`) }))
)
const templateOptions = computed<SelectOption[]>(() =>
  DATA_TEMPLATES[kind.value].map((v) => ({ value: v, label: t(`data.templates.${v}`) }))
)
const registryOptions = computed<SelectOption[]>(() =>
  TAG_REGISTRIES.map((r) => ({ value: r, label: r }))
)
const namespaceOptions = computed(() =>
  [...new Set([namespaceFor(props.packName), 'minecraft'])].map((v) => ({ value: v, label: v }))
)

const path = computed(() =>
  name.value.trim() ? buildDataPath(kind.value, namespace.value, name.value, registry.value) : null
)
const existing = computed(() => (path.value ? store.value.entry(path.value) : undefined))
const feedback = computed(() => {
  if (!name.value.trim()) return t('data.new.nameHint')
  if (!path.value) return t('data.new.invalidName')
  if (existing.value) return t('data.new.exists')
  return path.value
})

async function create(): Promise<void> {
  const p = path.value
  if (!p || existing.value) return
  creating.value = true
  try {
    const id = parseDataPath(p)!.id
    await store.value.create(p, dataTemplate(template.value, id))
    show.value = false
  } catch (err) {
    showError(err)
  } finally {
    creating.value = false
  }
}

function openExisting(): void {
  if (!path.value) return
  store.value.setKind(kind.value)
  store.value.open(path.value)
  show.value = false
}
</script>

<template>
  <n-modal
    v-model:show="show"
    preset="card"
    :title="t('data.new.title')"
    style="width: 520px"
    :mask-closable="!creating"
    data-testid="data-new-dialog"
  >
    <n-form label-placement="top" @submit.prevent="create">
      <n-space :wrap="false">
        <n-form-item :label="t('data.new.kind')" style="width: 200px">
          <n-select v-model:value="kind" :options="kindOptions" data-testid="data-new-kind" />
        </n-form-item>
        <n-form-item :label="t('data.new.template')" style="width: 260px">
          <n-select
            v-model:value="template"
            :options="templateOptions"
            data-testid="data-new-template"
          />
        </n-form-item>
      </n-space>
      <n-space :wrap="false">
        <n-form-item :label="t('data.new.namespace')" style="width: 200px">
          <n-select
            v-model:value="namespace"
            :options="namespaceOptions"
            filterable
            tag
            data-testid="data-new-namespace"
          />
        </n-form-item>
        <n-form-item v-if="kind === 'tag'" :label="t('data.new.registry')" style="width: 260px">
          <n-select
            v-model:value="registry"
            :options="registryOptions"
            filterable
            tag
            data-testid="data-new-registry"
          />
        </n-form-item>
      </n-space>
      <n-form-item
        :label="t('data.new.name')"
        :validation-status="name.trim() && (!path || existing) ? 'warning' : undefined"
        :feedback="feedback"
      >
        <n-input
          v-model:value="name"
          :placeholder="t('data.new.namePlaceholder')"
          data-testid="data-new-name"
        />
      </n-form-item>
      <n-text depth="3" class="hint">{{ t('data.new.namespaceHint') }}</n-text>
    </n-form>
    <template #footer>
      <n-space justify="end">
        <n-button :disabled="creating" @click="show = false">{{ t('common.cancel') }}</n-button>
        <n-button v-if="existing" data-testid="data-new-open" @click="openExisting">
          {{ t('data.new.openExisting') }}
        </n-button>
        <n-button
          v-else
          type="primary"
          :loading="creating"
          :disabled="!path"
          data-testid="data-new-create"
          @click="create"
        >
          {{ t('data.new.create') }}
        </n-button>
      </n-space>
    </template>
  </n-modal>
</template>

<style scoped>
.hint {
  font-size: 12px;
}
</style>
