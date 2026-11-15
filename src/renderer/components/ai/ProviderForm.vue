<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NButton,
  NForm,
  NFormItem,
  NInput,
  NRadioButton,
  NRadioGroup,
  NSelect,
  NSpace
} from 'naive-ui'
import type { ProviderKind, ProviderStatus } from '@shared/ai/types'
import {
  PROVIDER_PRESETS,
  headerLines,
  parseHeaderLines,
  providerIdFor,
  type ProviderPreset
} from '@shared/ai/presets'
import { useAiStore } from '../../stores/ai'
import { useErrorMessage } from '../../composables/useErrorMessage'

/** Adds a provider from a preset, or edits one (name, URL, extra headers). PLAN 7.3. */
const props = defineProps<{ provider?: ProviderStatus }>()
const emit = defineEmits<{ done: [] }>()
const { t } = useI18n()
const ai = useAiStore()
const { showError } = useErrorMessage()

const editing = computed(() => props.provider !== undefined)
const preset = ref<ProviderPreset['id']>('openrouter')
const label = ref(props.provider?.label ?? 'OpenRouter')
const kind = ref<ProviderKind>(props.provider?.kind ?? 'openai-compatible')
const baseUrl = ref(props.provider?.baseUrl ?? 'https://openrouter.ai/api/v1')
const headers = ref(
  headerLines(props.provider ? props.provider.extraHeaders : PROVIDER_PRESETS[2]!.extraHeaders)
)
const headersError = ref(false)
const saving = ref(false)

const presetOptions = computed(() =>
  PROVIDER_PRESETS.map((p) => ({ value: p.id, label: t(`ai.presets.${p.id}`) }))
)

function choosePreset(id: ProviderPreset['id']): void {
  preset.value = id
  const p = PROVIDER_PRESETS.find((x) => x.id === id)!
  label.value = p.label
  kind.value = p.kind
  baseUrl.value = p.baseUrl
  headers.value = headerLines(p.extraHeaders)
}

async function save(): Promise<void> {
  let extraHeaders: Record<string, string> | undefined
  try {
    extraHeaders = parseHeaderLines(headers.value)
    headersError.value = false
  } catch {
    headersError.value = true
    return
  }
  saving.value = true
  try {
    const p = props.provider
    await ai.saveProvider({
      id:
        p?.id ??
        providerIdFor(
          label.value,
          ai.providers.map((x) => x.id)
        ),
      kind: kind.value,
      label: label.value.trim(),
      baseUrl: baseUrl.value.trim(),
      enabled: p?.enabled ?? true,
      ...(extraHeaders ? { extraHeaders } : {})
    })
    emit('done')
    await ai.loadModels(true).catch(() => undefined)
  } catch (err) {
    showError(err)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="provider-form" data-testid="provider-form">
    <n-form label-placement="left" label-width="130" size="small">
      <n-form-item v-if="!editing" :label="t('ai.preset')">
        <n-select
          :value="preset"
          :options="presetOptions"
          style="width: 280px"
          data-testid="provider-preset"
          @update:value="choosePreset"
        />
      </n-form-item>
      <n-form-item :label="t('ai.providerName')">
        <n-input v-model:value="label" data-testid="provider-label" />
      </n-form-item>
      <n-form-item v-if="!editing && preset === 'custom'" :label="t('ai.providerType')">
        <n-radio-group v-model:value="kind">
          <n-radio-button value="openai-compatible">{{
            t('ai.kind.openai-compatible')
          }}</n-radio-button>
          <n-radio-button value="ollama">{{ t('ai.kind.ollama') }}</n-radio-button>
        </n-radio-group>
      </n-form-item>
      <n-form-item :label="t('ai.baseUrl')" :feedback="t('ai.baseUrlHint')">
        <n-input
          v-model:value="baseUrl"
          placeholder="https://api.example.com/v1"
          data-testid="provider-url"
        />
      </n-form-item>
      <n-form-item
        :label="t('ai.extraHeaders')"
        :feedback="headersError ? t('ai.invalidHeaders') : t('ai.extraHeadersHint')"
        :validation-status="headersError ? 'error' : undefined"
      >
        <n-input
          v-model:value="headers"
          type="textarea"
          :autosize="{ minRows: 1, maxRows: 4 }"
          placeholder="HTTP-Referer: https://example.com"
          data-testid="provider-headers"
        />
      </n-form-item>
      <n-space>
        <n-button
          size="small"
          type="primary"
          :loading="saving"
          :disabled="!label.trim() || !baseUrl.trim()"
          data-testid="provider-form-save"
          @click="save"
        >
          {{ editing ? t('common.save') : t('ai.addProvider') }}
        </n-button>
        <n-button size="small" @click="emit('done')">{{ t('common.cancel') }}</n-button>
      </n-space>
    </n-form>
  </div>
</template>

<style scoped>
.provider-form {
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px dashed rgba(128, 128, 128, 0.4);
}
</style>
