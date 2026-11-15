<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { NProgress, NText } from 'naive-ui'
import type { JobKind } from '@shared/model/jobs'
import { useJobsStore } from '../../stores/jobs'

const props = defineProps<{ kind: JobKind }>()
const { t, te } = useI18n()
const jobs = useJobsStore()

const current = computed(() => jobs.progress[props.kind])
const percent = computed(() => jobs.percent(props.kind))
const phase = computed(() => {
  const p = current.value?.phase
  if (!p) return ''
  return te(`jobs.phase.${p}`) ? t(`jobs.phase.${p}`) : p
})
</script>

<template>
  <div v-if="current" class="job" data-testid="job-progress">
    <n-text depth="3" class="phase">{{ phase }}</n-text>
    <n-progress
      type="line"
      :percentage="percent ?? 0"
      :processing="percent === null"
      :show-indicator="percent !== null"
    />
  </div>
</template>

<style scoped>
.job {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 220px;
}
.phase {
  font-size: 12px;
}
</style>
