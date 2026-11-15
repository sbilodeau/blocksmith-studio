<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'

/** Pixelated thumbnail of PNG bytes (blob URL, revoked when replaced or unmounted). */
const props = defineProps<{ png: Uint8Array; size?: number }>()
const url = ref('')

watch(
  () => props.png,
  (png) => {
    if (url.value) URL.revokeObjectURL(url.value)
    url.value = URL.createObjectURL(new Blob([new Uint8Array(png)], { type: 'image/png' }))
  },
  { immediate: true }
)
onBeforeUnmount(() => {
  if (url.value) URL.revokeObjectURL(url.value)
})
</script>

<template>
  <img
    :src="url"
    class="thumb pixelated"
    :style="{ width: `${size ?? 48}px`, height: `${size ?? 48}px` }"
    alt=""
  />
</template>

<style scoped>
.thumb {
  object-fit: contain;
  border-radius: 4px;
  background: repeating-conic-gradient(#d0d0d0 0% 25%, #f4f4f4 0% 50%) 50% / 8px 8px;
  flex: none;
}
</style>
