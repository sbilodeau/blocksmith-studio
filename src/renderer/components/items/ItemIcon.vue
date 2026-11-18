<script setup lang="ts">
import { computed } from 'vue'

/** A pixelated item icon (an empty square when there is none). */
const props = withDefaults(defineProps<{ url?: string; size?: number }>(), { size: 24 })
const style = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  ...(props.url ? { backgroundImage: `url("${props.url}")` } : {})
}))
</script>

<template>
  <span class="icon" :class="{ empty: !url }" :style="style" />
</template>

<style scoped>
.icon {
  display: inline-block;
  flex: none;
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
  image-rendering: pixelated;
}
.empty {
  border-radius: 4px;
  background: rgba(128, 128, 128, 0.12);
}
</style>
