/**
 * Long-running operations (vanilla extraction, import, export) resolve their invoke() when finished and
 * report progress meanwhile through the 'job.progress' event.
 */
export type JobKind = 'vanilla.prepare' | 'packs.import' | 'pack.export'

export interface JobProgress {
  jobId: string
  kind: JobKind
  /** i18n key suffix under `jobs.phase.*`: "download", "extract", "index", "write"... */
  phase: string
  done: number
  total: number
}
