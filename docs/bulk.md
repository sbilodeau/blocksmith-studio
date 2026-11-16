# Bulk operations

M5 lets one change apply to many textures at once: from the grid without AI ("Edit selection..."), or through the
navigation agent (see [ai-agents.md](ai-agents.md#navigation-agent)). Both use the same engine and end the same
way: a review of every changed texture (before / after, each with a checkbox), then one undoable history entry.

| Part                | Code                                                                           |
| ------------------- | ------------------------------------------------------------------------------ |
| Operations          | `src/shared/bulk/operations.ts` (`applyOperations`, `parseOperation`)          |
| CPU work            | `src/main/services/bulk/compute.ts` (decode, apply, encode)                    |
| Worker thread       | `src/main/services/bulk/bulk-worker.ts`, `runner.ts`                           |
| Service             | `src/main/services/bulk/service.ts` (previews, apply, compute, write)          |
| Multi-file writes   | `saveMany` in `src/main/services/packs/textures-edit.ts`                       |
| IPC                 | `src/main/ipc/bulk-handlers.ts` (`bulk.preview`, `bulk.apply`, `bulk.discard`) |
| UI                  | `src/renderer/components/bulk/` (`BulkDialog.vue`, `BulkReview.vue`)           |
| Pack history (grid) | `src/renderer/components/pack/PackHistoryDrawer.vue`                           |

## Operations

An operation is `{ tool, args }`: a tool of the AI registry and its arguments, validated by the tool's own zod
schema. Only the mutate tools of the navigation scope are allowed: `replace_color`, `apply_palette`, `hue_shift`,
`saturation`, `brightness`, `outline`, `rotate`, `flip` and `shift`. Per-pixel drawing tools are refused. One
manual action chains up to 8 operations, run in order on each texture.

Animated textures (a vertical strip of frames, `TextureEntry.frameCount`) run every operation frame by frame: a
rotation turns each frame and an outline never crosses a frame border. Results keep the frames stacked
vertically.

## Flow

1. `bulk.preview { packId, paths, operations }` (at most 2000 textures): main reads each texture's current PNG
   (pack copy, else vanilla), then a worker thread decodes, applies and encodes, reporting `job.progress`
   (`bulk.preview`, phase `compute`). Nothing is written.
2. The result lists the textures that change (before and after PNG), the ones left identical, and the ones that
   could not be processed (unknown path, missing file, undecodable PNG), with an English reason.
3. The review shows the changed textures (first 120, more on demand). The user unticks textures, then applies.
4. `bulk.apply { previewId, paths }` writes the ticked textures through `saveMany`: one history entry,
   `source: 'bulk'`, label "Bulk edit of N textures". A texture that ends up identical to vanilla is removed from
   the pack instead of copied. A preview is applied once and expires after 30 minutes (`bulk.previewExpired`).
   `bulk.discard` drops it.

Undo / Redo for the whole change is one click in the pack's **History** drawer (header button), or in the
editor's history panel.

## Worker thread

`createWorkerBulkRunner` starts one `node:worker_threads` worker per job from the bundled `bulk-worker.js`
(electron-vite `?modulePath`), like the vanilla extraction. The worker posts `progress`, then `done` with the
results (PNG buffers transferred, not copied), or `error`. Aborting terminates the worker (`bulk.aborted`); a
crash or a non-zero exit is `bulk.failed { reason }`. Tests use `inProcessBulkRunner`, which runs the same
`computeBulk` in the test process.

## Error codes

| Code                  | When                                                        |
| --------------------- | ----------------------------------------------------------- |
| `bulk.previewExpired` | apply of an unknown, expired, discarded or applied preview  |
| `bulk.aborted`        | the job was stopped                                         |
| `bulk.failed`         | the worker failed (`params.reason`)                         |
| `texture.invalidPng`  | `saveMany` got a PNG that does not decode (nothing written) |
