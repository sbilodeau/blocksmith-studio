# AI agents

The editor agent (M3) turns a chat message about the open texture into a reviewable plan. The AI never touches
files: tools run against an in-memory draft, the user reviews the resulting proposal, and only the renderer puts
the accepted result into the editor as one undoable edit (saved like any other edit). PLAN.md section 6 is the
design; this page describes what the code does.

| Part                  | Code                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------ |
| Tool registry         | `src/shared/ai/tools/` (`defineTool`, `getTool`, `toolSpecs`, grid encoding)               |
| System prompts        | `src/main/services/ai/agent/prompts.ts`                                                    |
| Context builder       | `src/main/services/ai/agent/context.ts`, upscaled image in `render.ts`                     |
| Runtime loop          | `src/main/services/ai/agent/runtime.ts`                                                    |
| Runs and proposals    | `src/main/services/ai/agent/service.ts`, `proposals.ts`                                    |
| Conversation files    | `src/main/services/ai/agent/conversation.ts`                                               |
| Style brief           | `src/main/services/brief.ts`                                                               |
| IPC                   | `src/main/ipc/ai-agent-handlers.ts` (`ai.agent.*`, `ai.proposal.*`, `brief.*`, `ai.event`) |
| Providers (consumed)  | `ProviderRegistry` in `src/main/services/contracts.ts`                                     |

## Tools

Each tool is defined once with a zod schema. `toolSpecs(scope)` sends `z.toJSONSchema(params, { io: 'input' })`
without `$schema` (fields with defaults are optional). Descriptions are English and state the conventions with FR
and EN phrase examples. Colors are `#rrggbb` or `#rrggbbaa`; coordinates are integers with the origin at the
top-left pixel (x right, y down); out-of-range pixels are skipped and rects clamped, following the image core
(`docs/image-core.md`). `execute(ctx, args)` receives `{ image, vanilla, brief }`, never mutates its inputs and
returns `{ image?, result, summary }`. A `ToolError` becomes an error tool result for the model.

| Group     | Tools                                                                                   | Kind   |
| --------- | --------------------------------------------------------------------------------------- | ------ |
| Transform | `rotate`, `flip`, `shift` (wrap defaults to true), `resize` (nearest-neighbor)          | mutate |
| Drawing   | `set_pixels` (max 4096 per call), `draw_line`, `draw_rect`, `fill_rect`, `fill`, `erase` | mutate |
| Color     | `replace_color`, `apply_palette`, `hue_shift`, `saturation`, `brightness`, `outline`    | mutate |
| Read      | `get_pixels` (max 128x128 per call), `get_palette`, `get_texture`, `read_style_brief`   | read   |
| Memory    | `update_style_brief`                                                                    | memory |

`get_texture({ source: 'vanilla' })` returns the vanilla version of the open texture as a grid, or an
explanatory error when there is none (texture added by the pack, or a pack not based on vanilla).

### Plan descriptions (`describe()`)

The plan UI never shows tool names: `describe(args)` returns an i18n key under `ops.*` and its params. Enum
params keep their raw value (`direction`: `clockwise` / `counterclockwise`, `axis`: `horizontal` / `vertical`,
`mode`: `inside` / `outside`) for the renderer to translate. Signed params (`degrees` of `hue_shift`, `percent`)
are strings with an explicit sign (`"+20"`, `"-15"`, `"0"`). Colors are lowercase hex.

| Key                        | Params                                    |
| -------------------------- | ----------------------------------------- |
| `ops.rotate`               | `degrees`, `direction`                    |
| `ops.flip`                 | `axis`                                    |
| `ops.shift`                | `dx`, `dy` (no wrap)                      |
| `ops.shiftWrap`            | `dx`, `dy`                                |
| `ops.resize`               | `width`, `height`                         |
| `ops.setPixels`            | `count`                                   |
| `ops.drawLine`             | `x1`, `y1`, `x2`, `y2`, `color`           |
| `ops.drawRect`             | `x`, `y`, `width`, `height`, `color`      |
| `ops.fillRect`             | `x`, `y`, `width`, `height`, `color`      |
| `ops.fill`                 | `x`, `y`, `color`, `tolerance`            |
| `ops.fillAll`              | `x`, `y`, `color`, `tolerance`            |
| `ops.erasePixels`          | `count`                                   |
| `ops.eraseRect`            | `x`, `y`, `width`, `height`               |
| `ops.erasePixelsAndRect`   | `count`, `x`, `y`, `width`, `height`      |
| `ops.replaceColor`         | `from`, `to`, `tolerance`                 |
| `ops.applyPalette`         | `count`                                   |
| `ops.applyPaletteRegion`   | `count`, `x`, `y`, `width`, `height`      |
| `ops.hueShift`             | `degrees`                                 |
| `ops.hueShiftRegion`       | `degrees`, `x`, `y`, `width`, `height`    |
| `ops.saturation`           | `percent`                                 |
| `ops.saturationRegion`     | `percent`, `x`, `y`, `width`, `height`    |
| `ops.brightness`           | `percent`                                 |
| `ops.brightnessRegion`     | `percent`, `x`, `y`, `width`, `height`    |
| `ops.outline`              | `color`, `mode`                           |
| `ops.getPixels`            | none                                      |
| `ops.getPixelsRect`        | `x`, `y`, `width`, `height`               |
| `ops.getPalette`           | none                                      |
| `ops.getTexture`           | `source`                                  |
| `ops.readStyleBrief`       | none                                      |
| `ops.updateStyleBrief`     | `fields` (e.g. `"theme, rules"`)          |

## Context sent to the model

1. **System prompt**: the common preamble of PLAN 6.4 (coordinates, colors, rotation and flip vocabulary, style
   brief rules, "Reply in {language}. If the user writes in another language, reply in the user's language.")
   with the brief as compact JSON (theme, palette, rules, last 20 decisions, last 10 requests), then the editor
   instructions with the texture size. Text in `prompts.ts`.
2. **History**: previous turns of `editor.jsonl`, newest first, within 30 turns and about 6000 tokens (4
   characters per token). Assistant tool calls are summarized as "(Tools called: ...)", tool results are dropped,
   proposal decisions become "[App note]" user messages. Dropped turns are replaced by one note listing the last
   few earlier requests.
3. **User message**: `[Open texture: <path> (W x H px)]`, the texture state, the 3D model layout when the texture
   has one, then the request.

### 3D model layout

The texture is wrapped around the same model as the 3D preview (`previewModel` dependency, see
[preview.md](preview.md) and [entity-models.md](entity-models.md)), so the agent knows which pixels are which body
part or block face. `src/shared/preview/layout.ts` turns the model into a short text block starting with
`3D MODEL LAYOUT:` (about 400 tokens for a mob):

- **Entities** (jar or built-in model, only when the texture's aspect ratio fits it): one line per cube with its
  part path, size and flags (mirrored, overlay, rest rotation), then each visible face as `face x,y wxh` in this
  texture's pixels (scaled for high-resolution packs). Faces with no area are skipped; at most 80 cubes are
  listed.
- **Blocks**: the texture rectangles of every element face that uses this texture, grouped by rectangle, with
  rotation and tint notes; UVs refer to one frame for animated strips.
- **Items**: one line about the extruded in-hand sprite. Flat textures (GUI, particles) get nothing.

A failing preview never fails the run; the block is simply left out. The editor instructions tell the model to use
the rectangles before drawing and to edit every face a change should appear on.

### Image and grid strategy

| Model / setting                          | First message                         | After mutate tools                                    |
| ---------------------------------------- | ------------------------------------- | ----------------------------------------------------- |
| No vision, or vision unknown             | grid                                  | grid in each tool result                              |
| Vision, `vision+grid` (default)          | upscaled image + grid                 | grid in each result, fresh image every 3 mutate steps |
| Vision, `grid`                           | grid                                  | grid                                                  |
| Vision, `image`                          | upscaled image                        | fresh image after each iteration with changes         |
| Vision, texture side above 64 px         | image + "use get_pixels(rect)" note   | fresh image after each iteration with changes         |
| No vision, more than 128x128 pixels      | palette summary + get_pixels note     | same                                                  |

- **Grid**: `{ w, h, origin: 'top-left', palette: { '.': '#00000000', a: '#rrggbbaa', ... }, rows }`, one
  character per pixel (`a-z`, `A-Z`, `0-9` by decreasing use, ties by hex), `.` for alpha 0. Above 62 visible
  colors there is no palette and each row is an array of `#rrggbbaa`.
- **Upscaled image**: nearest-neighbor to about 512 px on the long side, transparent pixels composited on a
  white / light gray checkerboard, 1-px grid lines (35% darker) when a texture pixel is at least 4 px, axis
  labels in a white margin drawn with a 3x5 bitmap digit font (2x when a texture pixel is at least 24 px). Every
  n-th column/row is labeled (n a power of two) when cells are too small for the numbers.
- Fresh images are sent as an "[App note] Current texture after your changes" user message; before each request
  only the most recent image is kept.

## Runtime loop

`runEditorAgent` (one call per user message):

- One provider round trip per iteration. `thinking`, `text` and `usage` events are forwarded as `ai.event`.
- Reasoning level: `request.thinking` (the AI tab's selector) or else the agent setting `thinking`
  (`off` | `low` | `medium` | `high`; older boolean settings load as `medium` / `off`), sent as `ChatRequest.think`.
- Tool calls are validated with zod. Invalid arguments, unknown tools and tool errors are returned to the model as
  `{ ok: false, error }` tool results (the iteration still counts toward the budget). String arguments are parsed
  as JSON first.
- **Read** tools run immediately and return `{ ok: true, result }`; they create no step.
- **Mutate** tools run on the draft and record a `ProposalStep` (`describe()`, parsed args with defaults, preview
  PNG). The result is `{ ok, summary, result, texture }` where `texture` is the new grid (or the note when the
  grid is not inline). `dependsOn` lists **all earlier mutate steps**: coordinates and colors of a step refer to
  the state the earlier steps produced, so this is always correct, if conservative.
- **Memory** (`update_style_brief`) records a step with `briefPatch` and no preview; the draft brief is updated
  so a later `read_style_brief` sees it. Nothing is written.
- The loop ends when the model answers without tool calls (`end`), after `maxIterations` round trips (agent
  setting, default 6) or when the token budget (150 000 per request; provider usage, else the 4-characters
  estimate) is reached (`budget`), or on abort (`stopped`). Errors end with `error` and the AppError code. Tool
  calls of the last iteration are executed before stopping for a budget.

The service wraps the loop: `ai.agent.send` validates the texture and the pack, returns `{ runId }` and runs in the
background. There is one active run per pack + agent: a new send aborts the previous run and waits for it to end.
`ai.agent.stop` aborts by run id. Event order: `started`, streamed events, `proposal` (when there is at least one
step, whatever the reason, so the work done before a stop or budget can still be reviewed), `done`.

## Proposals

- Kept in memory by id; pending ones expire after one hour, or when a new run starts for the same pack + agent.
- `ai.proposal.apply { proposalId, acceptedStepIds }` decodes `basePng` and re-executes ONLY the accepted mutate
  steps in proposal order (deterministic). Steps whose dependencies were unchecked still run (the UI warns).
  Unknown step ids are ignored. Returns `{ png, appliedStepIds, briefUpdated }`; main never writes the texture.
- Accepted memory steps apply their patches to the brief in one write, attributed to the agent. When none of them
  carries `addDecision`, a decision line "Style brief change accepted by the user (fields)" is added. Every apply
  with at least one accepted step appends an app-generated `requestLog` line:
  `block/stone.png: "<request>" -> rotate, set_pixels (2 of 3 steps)`.
- Status becomes `applied`, `partially-applied` or `rejected` (no accepted step). `ai.proposal.reject` marks it
  rejected. Deciding twice fails with `ai.proposalNotPending`.
- Each decision appends a note to the conversation ("The user applied 3 of 4 steps (...); not applied: ...").

## Conversation files

`.blocksmith/conversations/<agent>.jsonl`, one `ConversationTurn` per line, append-only, writes serialized per
file. Unreadable or invalid lines are skipped; a cut last line gets a newline before the next append. A run
appends the user turn first, then its assistant and tool turns at the end (the last assistant turn carries the
`proposalId`). Proposal decisions are `tool` turns with `proposalId` and `text` but no `toolResult`.
`ai.agent.clear` stops the active run, drops pending proposals and deletes the file.

## Style brief

`.blocksmith/style-brief.json`, validated with `StyleBriefSchema`. A missing file reads as the empty brief; an
invalid one too, after a copy to `style-brief.json.bak`. Patches replace `theme`, `palette` and `rules`;
`addDecision` appends a decision (`by: 'user'` from `brief.update`, the agent kind for accepted proposals).
`decisions` keeps the last 100 entries and `requestLog` the last 30; texts are clipped to 300 characters. Writes
are atomic (temp file + rename) and serialized per pack. `updatedAt` is set on every write.

## Error codes

| Code                     | When                                                                    |
| ------------------------ | ----------------------------------------------------------------------- |
| `ai.invalidTexture`      | `ai.agent.send` with a PNG that does not decode                         |
| `ai.textureTooLarge`     | texture side above 1024 (`params.max`)                                  |
| `ai.proposalNotFound`    | unknown or expired proposal id (`params.proposalId`)                    |
| `ai.proposalNotPending`  | proposal already applied or rejected (`params.proposalId`, `status`)    |
| `ai.replayFailed`        | a step could not be re-executed (`params.step`, `tool`)                 |
| `ai.agentFailed`         | unexpected error without a code during a run (in `done.error`)          |
| `packs.notFound`         | unknown pack id (`params.packId`)                                       |

Errors thrown by the provider layer (`ai.providerNotFound`, `ai.noApiKey`, `ai.providerDisabled` and the
adapters' `ai.*` codes) are passed through unchanged in `done.error`.
