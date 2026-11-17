<script setup lang="ts">
/** Minimal stroke icons for the editor toolbar (24x24 viewBox, currentColor). */
defineProps<{ name: keyof typeof ICONS }>()
</script>

<script lang="ts">
export const ICONS = {
  pencil: 'M4 20l4-1 11-11-3-3L5 16l-1 4zM14 6l3 3',
  eraser: 'M8 20h12M5 15l8-8 6 6-6 6H9l-4-4z',
  bucket:
    'M5 11l7-7 7 7-7 7-7-7zM5 11h14M20 16c0 1.5-1 2.5-1.5 2.5S17 17.5 17 16s1.5-3 1.5-3 1.5 1.5 1.5 3z',
  eyedropper: 'M14 4l6 6-2 2-6-6 2-2zM12 8l-8 8v4h4l8-8',
  line: 'M5 19L19 5',
  rect: 'M5 6h14v12H5z',
  select: 'M4 4h3M10 4h4M17 4h3v3M20 10v4M20 17v3h-3M14 20h-4M7 20H4v-3M4 14v-4M4 7V4',
  rotateCw: 'M20 12a8 8 0 1 1-3-6.2M20 4v5h-5',
  rotateCcw: 'M4 12a8 8 0 1 0 3-6.2M4 4v5h5',
  flipH: 'M12 3v18M9 7L4 12l5 5V7zM15 7l5 5-5 5V7z',
  flipV: 'M3 12h18M7 9l5-5 5 5H7zM7 15l5 5 5-5H7z',
  mirrorX: 'M12 3v18M8 8l-3 4 3 4M16 8l3 4-3 4',
  mirrorY: 'M3 12h18M8 8l4-3 4 3M8 16l4 3 4-3',
  grid: 'M4 4h16v16H4zM4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16',
  zoomIn: 'M10 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM20 20l-5.5-5.5M10 7v6M7 10h6',
  zoomOut: 'M10 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM20 20l-5.5-5.5M7 10h6',
  fit: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  swap: 'M7 4v12M4 7l3-3 3 3M17 20V8M14 17l3 3 3-3',
  compare: 'M12 3v18M4 6h6v12H4zM14 6h6v12h-6z',
  plus: 'M12 5v14M5 12h14',
  duplicate: 'M8 8h11v11H8zM5 16V5h11',
  trash: 'M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  merge: 'M7 4v5l5 5 5-5V4M12 14v6',
  flatten: 'M4 9l8-4 8 4-8 4-8-4zM4 15l8 4 8-4',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  eyeOff: 'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 3.9M6.6 6.6C3.8 8.4 2 12 2 12s4 7 10 7a9.6 9.6 0 0 0 4.2-1M9.9 9.9a3 3 0 0 0 4.2 4.2',
  rename: 'M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4'
} as const
</script>

<template>
  <svg
    class="icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="ICONS[name]" />
  </svg>
</template>

<style scoped>
.icon {
  width: 18px;
  height: 18px;
  display: block;
}
</style>
