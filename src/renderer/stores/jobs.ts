import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { JobKind, JobProgress } from '@shared/model/jobs'

/** Latest progress per job kind, fed by the 'job.progress' event. */
export const useJobsStore = defineStore('jobs', () => {
  const progress = ref<Partial<Record<JobKind, JobProgress>>>({})
  let listening = false

  function init(): void {
    if (listening) return
    listening = true
    window.blocksmith.on('job.progress', (p) => {
      progress.value = { ...progress.value, [p.kind]: p }
    })
  }

  function clear(kind: JobKind): void {
    const next = { ...progress.value }
    delete next[kind]
    progress.value = next
  }

  function percent(kind: JobKind): number | null {
    const p = progress.value[kind]
    if (!p || p.total <= 0) return null
    return Math.min(100, Math.round((p.done / p.total) * 100))
  }

  return { progress, init, clear, percent }
})
