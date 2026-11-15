<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NButton,
  NColorPicker,
  NDrawer,
  NDrawerContent,
  NDynamicInput,
  NEmpty,
  NForm,
  NFormItem,
  NInput,
  NSpace,
  NTag,
  NText,
  useMessage
} from 'naive-ui'
import type { StyleBrief } from '@shared/model/brief'
import { call } from '../../services/ipc'
import { useErrorMessage } from '../../composables/useErrorMessage'

/**
 * The pack's style brief: shared memory read by every agent (theme, palette, rules) plus the decisions and
 * request log they record. The user edits theme, palette and rules here.
 */
const show = defineModel<boolean>('show', { required: true })
const props = defineProps<{ packId: string }>()
const { t, d } = useI18n()
const message = useMessage()
const { showError } = useErrorMessage()

const brief = ref<StyleBrief | null>(null)
const theme = ref('')
const palette = ref<Array<{ hex: string; role?: string }>>([])
const rules = ref<string[]>([])
const saving = ref(false)

async function load(): Promise<void> {
  try {
    const b = await call('brief.get', { packId: props.packId })
    brief.value = b
    theme.value = b.theme
    palette.value = b.palette.map((p) => ({ ...p }))
    rules.value = [...b.rules]
  } catch (err) {
    showError(err)
  }
}

async function save(): Promise<void> {
  saving.value = true
  try {
    brief.value = await call('brief.update', {
      packId: props.packId,
      patch: {
        theme: theme.value.trim(),
        palette: palette.value.filter((p) => /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(p.hex)),
        rules: rules.value.map((r) => r.trim()).filter(Boolean)
      }
    })
    message.success(t('brief.saved'))
  } catch (err) {
    showError(err)
  } finally {
    saving.value = false
  }
}

watch(show, (open) => {
  if (open) void load()
})
</script>

<template>
  <n-drawer v-model:show="show" :width="420" placement="right" data-testid="brief-drawer">
    <n-drawer-content :title="t('brief.title')" closable>
      <n-text depth="3" class="intro">{{ t('brief.intro') }}</n-text>
      <n-form label-placement="top" size="small" class="form">
        <n-form-item :label="t('brief.theme')">
          <n-input
            v-model:value="theme"
            :maxlength="200"
            :placeholder="t('brief.themePlaceholder')"
            data-testid="brief-theme"
          />
        </n-form-item>
        <n-form-item :label="t('brief.palette')">
          <n-dynamic-input
            v-model:value="palette"
            :on-create="() => ({ hex: '#ff6a00', role: '' })"
            :max="32"
          >
            <template #default="{ value }">
              <n-space align="center" :wrap="false" style="width: 100%">
                <n-color-picker
                  v-model:value="value.hex"
                  :modes="['hex']"
                  :show-alpha="false"
                  size="small"
                  style="width: 110px"
                />
                <n-input
                  v-model:value="value.role"
                  size="small"
                  :placeholder="t('brief.rolePlaceholder')"
                />
              </n-space>
            </template>
          </n-dynamic-input>
        </n-form-item>
        <n-form-item :label="t('brief.rules')">
          <n-dynamic-input
            v-model:value="rules"
            :max="40"
            :placeholder="t('brief.rulePlaceholder')"
          />
        </n-form-item>
      </n-form>
      <n-space justify="end">
        <n-button
          type="primary"
          size="small"
          :loading="saving"
          data-testid="brief-save"
          @click="save"
        >
          {{ t('brief.save') }}
        </n-button>
      </n-space>

      <n-text strong class="section">{{ t('brief.decisions') }}</n-text>
      <n-empty v-if="!brief?.decisions.length" size="small" :description="t('brief.none')" />
      <ul v-else class="log">
        <li v-for="(dec, i) in [...brief.decisions].reverse()" :key="i">
          <n-tag size="tiny" :bordered="false">{{ t(`brief.by.${dec.by}`) }}</n-tag>
          {{ dec.text }}
          <n-text depth="3" class="when">{{ d(new Date(dec.at), 'short') }}</n-text>
        </li>
      </ul>

      <n-text strong class="section">{{ t('brief.requests') }}</n-text>
      <n-empty v-if="!brief?.requestLog.length" size="small" :description="t('brief.none')" />
      <ul v-else class="log">
        <li v-for="(req, i) in [...brief.requestLog].reverse()" :key="i">
          <n-tag size="tiny" :bordered="false" type="info">{{ t(`brief.by.${req.agent}`) }}</n-tag>
          {{ req.summary }}
        </li>
      </ul>
    </n-drawer-content>
  </n-drawer>
</template>

<style scoped>
.intro {
  font-size: 12px;
  display: block;
  margin-bottom: 12px;
}
.form {
  margin-bottom: 8px;
}
.section {
  display: block;
  margin: 18px 0 6px;
}
.log {
  margin: 0;
  padding-left: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
}
.when {
  font-size: 11px;
  margin-left: 4px;
}
</style>
