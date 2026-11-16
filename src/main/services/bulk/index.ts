/** Production wiring of the bulk service (worker thread). Tests import service.ts and runner.ts directly. */
import bulkWorkerPath from './bulk-worker?modulePath'
import { createWorkerBulkRunner } from './runner'

export { createBulkService, BULK_PREVIEW_TTL_MS } from './service'
export type { BulkService, BulkServiceDeps, BulkTarget, BulkComputed } from './service'
export { inProcessBulkRunner, createWorkerBulkRunner, type BulkRunner } from './runner'
export { computeBulk, computeBulkItem } from './compute'

/** The bulk runner of the app: a worker thread per job. */
export function createDefaultBulkRunner(): ReturnType<typeof createWorkerBulkRunner> {
  return createWorkerBulkRunner(bulkWorkerPath)
}
