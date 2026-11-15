<script setup lang="ts">
import { NSpin } from 'naive-ui'

/**
 * Centered spinner over the parent (which must be position: relative). Rendered only while `show` is true:
 * Naive UI's wrapping <n-spin> leaves an invisible spinner in the DOM that swallows pointer events.
 */
defineProps<{ show: boolean }>()
</script>

<template>
  <div v-if="show" class="overlay" data-testid="loading-overlay"><n-spin size="medium" /></div>
</template>

<style scoped>
.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
  pointer-events: none;
}
</style>
