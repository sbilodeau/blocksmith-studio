<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { NAlert } from 'naive-ui'
import UpdateActions from './UpdateActions.vue'
import { useUpdaterStore } from '../stores/updater'
import { useUpdaterMessage } from '../composables/useUpdaterMessage'

const { status } = storeToRefs(useUpdaterStore())
const message = useUpdaterMessage(status)
const visible = computed(() =>
  ['available', 'downloading', 'downloaded'].includes(status.value.state)
)
</script>

<template>
  <n-alert v-if="visible" type="info" :show-icon="false" class="banner" data-testid="update-banner">
    <div class="row">
      <span>{{ message }}</span>
      <update-actions />
    </div>
  </n-alert>
</template>

<style scoped>
.banner {
  border-radius: 0;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
</style>
