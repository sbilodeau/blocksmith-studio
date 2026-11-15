<script setup lang="ts">
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NCard, NEmpty, NSpace, NSwitch, NTable, NTag, NText, NFormItem } from 'naive-ui'
import { useVanillaStore } from '../../stores/vanilla'
import { useSettingsStore } from '../../stores/settings'
import { useErrorMessage } from '../../composables/useErrorMessage'
import JobProgressBar from '../common/JobProgressBar.vue'

const { t } = useI18n()
const vanilla = useVanillaStore()
const settings = useSettingsStore()
const { showError } = useErrorMessage()

const stateType = { ready: 'success', local: 'info', downloadable: 'default' } as const

async function addPath(): Promise<void> {
  try {
    await vanilla.addPath()
  } catch (err) {
    showError(err)
  }
}

async function prepare(versionId: string): Promise<void> {
  try {
    await vanilla.prepare(versionId)
  } catch (err) {
    showError(err)
  }
}

onMounted(() => {
  vanilla.refresh().catch(showError)
})
</script>

<template>
  <n-card :title="t('minecraft.title')" size="small" data-testid="minecraft-settings">
    <n-space vertical size="large">
      <div>
        <n-space justify="space-between" align="center">
          <n-text strong>{{ t('minecraft.installs') }}</n-text>
          <n-button size="small" data-testid="minecraft-add" @click="addPath">
            {{ t('minecraft.addFolder') }}
          </n-button>
        </n-space>
        <n-empty
          v-if="vanilla.installs.length === 0"
          size="small"
          :description="t('minecraft.noInstalls')"
          class="empty"
        />
        <ul v-else class="installs">
          <li v-for="inst in vanilla.installs" :key="inst.path">
            <n-tag size="small" :bordered="false">{{
              t(`minecraft.launchers.${inst.launcher}`)
            }}</n-tag>
            <n-text code class="path">{{ inst.path }}</n-text>
            <n-text depth="3">{{ inst.versions.map((v) => v.id).join(', ') || '-' }}</n-text>
          </li>
        </ul>
      </div>

      <n-form-item
        :label="t('vanilla.allowDownload')"
        label-placement="left"
        :show-feedback="false"
      >
        <n-switch
          :value="settings.settings.allowMojangDownload"
          data-testid="settings-mojang-consent"
          @update:value="(v: boolean) => settings.update({ allowMojangDownload: v })"
        />
      </n-form-item>
      <n-text depth="3" class="hint">{{ t('vanilla.downloadHint') }}</n-text>

      <n-table size="small" :single-line="false">
        <thead>
          <tr>
            <th>{{ t('vanilla.version') }}</th>
            <th>{{ t('vanilla.status') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="v in vanilla.versions"
            :key="v.versionId"
            :data-testid="`vanilla-row-${v.versionId}`"
          >
            <td>
              {{ v.versionId }}
              <n-tag v-if="v.isLatest" size="tiny" type="primary" :bordered="false">
                {{ t('vanilla.latest') }}
              </n-tag>
            </td>
            <td>
              <n-tag size="small" :type="stateType[v.state]" :bordered="false">
                {{ t(`vanilla.state.${v.state}`) }}
              </n-tag>
            </td>
            <td class="actions">
              <job-progress-bar v-if="vanilla.preparing === v.versionId" kind="vanilla.prepare" />
              <n-button
                v-else-if="v.state !== 'ready'"
                size="tiny"
                :disabled="
                  !!vanilla.preparing ||
                  (v.state === 'downloadable' && !settings.settings.allowMojangDownload)
                "
                @click="prepare(v.versionId)"
              >
                {{ v.state === 'local' ? t('vanilla.extract') : t('vanilla.download') }}
              </n-button>
            </td>
          </tr>
        </tbody>
      </n-table>
    </n-space>
  </n-card>
</template>

<style scoped>
.installs {
  list-style: none;
  padding: 0;
  margin: 8px 0 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.installs li {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.path {
  font-size: 12px;
}
.empty {
  margin-top: 8px;
}
.hint {
  font-size: 12px;
  margin-top: -12px;
}
.actions {
  width: 240px;
}
</style>
