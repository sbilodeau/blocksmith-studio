<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NButton,
  NCard,
  NForm,
  NFormItem,
  NInput,
  NRadioButton,
  NRadioGroup,
  NSpace,
  NSwitch,
  NTag,
  NText,
  useMessage
} from 'naive-ui'
import type { ProviderKind } from '@shared/ai/types'
import AgentSettingsForm from './AgentSettingsForm.vue'
import { useAiStore } from '../../stores/ai'
import { useErrorMessage } from '../../composables/useErrorMessage'

const { t, te } = useI18n()
const ai = useAiStore()
const message = useMessage()
const { showError, errorText } = useErrorMessage()

const keyInputs = ref<Record<string, string>>({})
const testing = ref<string | null>(null)
/** Form for adding a provider (shown while `adding`). */
const adding = ref(false)
function setAdding(on: boolean): void {
  adding.value = on
}
const draft = ref<{ label: string; baseUrl: string; kind: ProviderKind }>({
  label: '',
  baseUrl: '',
  kind: 'openai-compatible'
})

async function saveKey(providerId: string): Promise<void> {
  try {
    await ai.setKey(providerId, keyInputs.value[providerId] ?? '')
    keyInputs.value[providerId] = ''
    message.success(t('ai.keySaved'))
    await ai.loadModels(true).catch(() => undefined)
  } catch (err) {
    showError(err)
  }
}

async function removeKey(providerId: string): Promise<void> {
  try {
    await ai.setKey(providerId, '')
  } catch (err) {
    showError(err)
  }
}

async function test(providerId: string): Promise<void> {
  testing.value = providerId
  try {
    const r = await ai.testProvider(providerId)
    if (r.ok) message.success(t('ai.testOk', { count: r.modelCount ?? 0 }))
    else {
      const code = r.error?.code ?? 'unexpected'
      message.error(te(`errors.${code}`) ? t(`errors.${code}`, r.error?.params ?? {}) : code)
    }
  } catch (err) {
    message.error(errorText(err))
  } finally {
    testing.value = null
  }
}

async function addProvider(): Promise<void> {
  const p = draft.value
  const id = p.label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  try {
    await ai.saveProvider({
      id: id || `provider-${Date.now()}`,
      kind: p.kind,
      label: p.label,
      baseUrl: p.baseUrl,
      enabled: true
    })
    adding.value = false
    draft.value = { label: '', baseUrl: '', kind: 'openai-compatible' }
  } catch (err) {
    showError(err)
  }
}

async function toggle(providerId: string, enabled: boolean): Promise<void> {
  const p = ai.providers.find((x) => x.id === providerId)
  if (!p) return
  try {
    await ai.saveProvider({
      id: p.id,
      kind: p.kind,
      label: p.label,
      baseUrl: p.baseUrl,
      enabled,
      extraHeaders: p.extraHeaders
    })
  } catch (err) {
    showError(err)
  }
}

onMounted(async () => {
  try {
    await ai.loadProviders()
    if (ai.hasUsableProvider) await ai.loadModels()
  } catch (err) {
    showError(err)
  }
})
</script>

<template>
  <n-card :title="t('ai.title')" size="small" data-testid="ai-settings">
    <n-space vertical size="large">
      <div v-for="p in ai.providers" :key="p.id" class="provider" :data-testid="`provider-${p.id}`">
        <n-space justify="space-between" align="center">
          <n-space align="center" size="small">
            <n-text strong>{{ p.label }}</n-text>
            <n-tag size="tiny" :bordered="false">{{ t(`ai.kind.${p.kind}`) }}</n-tag>
            <n-tag v-if="!p.keyRequired && !p.hasKey" size="tiny" :bordered="false">
              {{ t('ai.keyNotNeeded') }}
            </n-tag>
            <n-tag v-else size="tiny" :bordered="false" :type="p.hasKey ? 'success' : 'warning'">
              {{ p.hasKey ? t('ai.keySet') : t('ai.keyMissing') }}
            </n-tag>
          </n-space>
          <n-switch
            :value="p.enabled"
            size="small"
            @update:value="(v: boolean) => toggle(p.id, v)"
          />
        </n-space>
        <n-text depth="3" code class="url">{{ p.baseUrl }}</n-text>
        <n-space align="center" size="small" class="key-row">
          <n-input
            v-model:value="keyInputs[p.id]"
            type="password"
            show-password-on="click"
            size="small"
            :placeholder="p.hasKey ? t('ai.replaceKey') : t('ai.enterKey')"
            style="width: 280px"
            :input-props="{ autocomplete: 'off' }"
            :data-testid="`provider-key-${p.id}`"
          />
          <n-button
            size="small"
            :disabled="!keyInputs[p.id]"
            :data-testid="`provider-save-key-${p.id}`"
            @click="saveKey(p.id)"
          >
            {{ t('ai.saveKey') }}
          </n-button>
          <n-button v-if="p.hasKey" size="small" quaternary @click="removeKey(p.id)">{{
            t('ai.removeKey')
          }}</n-button>
          <n-button
            size="small"
            :loading="testing === p.id"
            :disabled="p.keyRequired && !p.hasKey"
            :data-testid="`provider-test-${p.id}`"
            @click="test(p.id)"
          >
            {{ t('ai.test') }}
          </n-button>
          <n-button
            v-if="ai.providers.length > 1"
            size="small"
            quaternary
            type="error"
            @click="ai.deleteProvider(p.id).catch(showError)"
          >
            {{ t('ai.deleteProvider') }}
          </n-button>
        </n-space>
      </div>
      <n-text depth="3" class="hint">{{ t('ai.keyHint') }}</n-text>

      <div v-if="adding" class="provider">
        <n-form label-placement="left" label-width="110" size="small">
          <n-form-item :label="t('ai.providerName')">
            <n-input v-model:value="draft.label" placeholder="OpenRouter" />
          </n-form-item>
          <n-form-item :label="t('ai.providerType')">
            <n-radio-group v-model:value="draft.kind">
              <n-radio-button value="openai-compatible">{{
                t('ai.kind.openai-compatible')
              }}</n-radio-button>
              <n-radio-button value="ollama">{{ t('ai.kind.ollama') }}</n-radio-button>
            </n-radio-group>
          </n-form-item>
          <n-form-item :label="t('ai.baseUrl')">
            <n-input v-model:value="draft.baseUrl" placeholder="https://openrouter.ai/api/v1" />
          </n-form-item>
          <n-space>
            <n-button
              size="small"
              type="primary"
              :disabled="!draft.label || !draft.baseUrl"
              @click="addProvider"
            >
              {{ t('ai.addProvider') }}
            </n-button>
            <n-button size="small" @click="setAdding(false)">{{ t('common.cancel') }}</n-button>
          </n-space>
        </n-form>
      </div>
      <n-button v-else size="small" dashed @click="setAdding(true)">
        {{ t('ai.newProvider') }}
      </n-button>

      <agent-settings-form agent="editor" />
    </n-space>
  </n-card>
</template>

<style scoped>
.provider {
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid rgba(128, 128, 128, 0.25);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.url {
  font-size: 12px;
}
.hint {
  font-size: 12px;
  margin-top: -8px;
}
.agent-form {
  margin-top: 8px;
}
</style>
