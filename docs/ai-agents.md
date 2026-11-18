# AI agents

The editor agent (M3) turns a chat message about the open texture into a reviewable plan; the navigation agent
(M5) does the same for the textures selected in the grid, and the creation agent (M6) for the whole pack. The AI
never touches files: tools run against in-memory drafts and the user reviews the resulting proposal. The editor
agent's accepted result goes into the editor as one undoable edit; the navigation agent's is written as one history
entry; the creation agent's as one history entry per step. PLAN.md section 6 is the
design; this page describes what the code does.

| Part                 | Code                                                                                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tool registry        | `src/shared/ai/tools/` (`defineTool`, `getTool`, `toolSpecs`, grid encoding)                                                                             |
| System prompts       | `src/main/services/ai/agent/prompts.ts`                                                                                                                  |
| Context builder      | `src/main/services/ai/agent/context.ts`, upscaled image in `render.ts`                                                                                   |
| Agent loop (shared)  | `src/main/services/ai/agent/loop.ts`                                                                                                                     |
| Editor agent         | `src/main/services/ai/agent/runtime.ts`                                                                                                                  |
| Navigation agent     | `src/main/services/ai/agent/navigation.ts`, contact sheets in `contact-sheet.ts`                                                                         |
| Creation agent       | `src/main/services/ai/agent/creation.ts`                                                                                                                 |
| Item agent           | `src/main/services/ai/agent/item-agent.ts`, shared item checks in `item-ai.ts`                                                                           |
| Runs and proposals   | `src/main/services/ai/agent/service.ts`, `proposals.ts`                                                                                                  |
| Conversation files   | `src/main/services/ai/agent/conversation.ts`                                                                                                             |
| Style brief          | `src/main/services/brief.ts`                                                                                                                             |
| IPC                  | `src/main/ipc/ai-agent-handlers.ts` (`ai.agent.*`, `ai.navigation.*`, `ai.creation.*`, `ai.item.*`, `ai.proposal.*`, `brief.*`, `ai.event`)              |
| Chat UI              | `src/renderer/components/ai/AgentChat.vue` (shared), `EditorAgentPanel.vue`, `NavigationAgentPanel.vue`, `CreationAgentPanel.vue` + `CreationReview.vue` |
| Item chat UI         | `src/renderer/components/items/ItemAgentPanel.vue` + `ItemReview.vue`, `ItemExplain.vue`                                                                 |
| Providers (consumed) | `ProviderRegistry` in `src/main/services/contracts.ts`                                                                                                   |

## Tools

Each tool is defined once with a zod schema. `toolSpecs(scope)` sends `z.toJSONSchema(params, { io: 'input' })`
without `$schema` (fields with defaults are optional). Descriptions are English and state the conventions with FR
and EN phrase examples. Colors are `#rrggbb` or `#rrggbbaa`; coordinates are integers with the origin at the
top-left pixel (x right, y down); out-of-range pixels are skipped and rects clamped, following the image core
(`docs/image-core.md`). `execute(ctx, args)` receives `{ image, vanilla, brief }`, never mutates its inputs and
returns `{ image?, result, summary }`. A `ToolError` becomes an error tool result for the model.

| Group     | Tools                                                                                    | Kind   |
| --------- | ---------------------------------------------------------------------------------------- | ------ |
| Transform | `rotate`, `flip`, `shift` (wrap defaults to true), `resize` (nearest-neighbor)           | mutate |
| Drawing   | `set_pixels` (max 4096 per call), `draw_line`, `draw_rect`, `fill_rect`, `fill`, `erase` | mutate |
| Color     | `replace_color`, `apply_palette`, `hue_shift`, `saturation`, `brightness`, `outline`     | mutate |
| Read      | `get_pixels` (max 128x128 per call), `get_palette`, `get_texture`, `read_style_brief`    | read   |
| Memory    | `update_style_brief`                                                                     | memory |

`get_texture({ source: 'vanilla' })` returns the vanilla version of the open texture as a grid, or an
explanatory error when there is none (texture added by the pack, or a pack not based on vanilla).

### Plan descriptions (`describe()`)

The plan UI never shows tool names: `describe(args)` returns an i18n key under `ops.*` and its params. Enum
params keep their raw value (`direction`: `clockwise` / `counterclockwise`, `axis`: `horizontal` / `vertical`,
`mode`: `inside` / `outside`) for the renderer to translate. Signed params (`degrees` of `hue_shift`, `percent`)
are strings with an explicit sign (`"+20"`, `"-15"`, `"0"`). Colors are lowercase hex.

| Key                      | Params                                 |
| ------------------------ | -------------------------------------- |
| `ops.rotate`             | `degrees`, `direction`                 |
| `ops.flip`               | `axis`                                 |
| `ops.shift`              | `dx`, `dy` (no wrap)                   |
| `ops.shiftWrap`          | `dx`, `dy`                             |
| `ops.resize`             | `width`, `height`                      |
| `ops.setPixels`          | `count`                                |
| `ops.drawLine`           | `x1`, `y1`, `x2`, `y2`, `color`        |
| `ops.drawRect`           | `x`, `y`, `width`, `height`, `color`   |
| `ops.fillRect`           | `x`, `y`, `width`, `height`, `color`   |
| `ops.fill`               | `x`, `y`, `color`, `tolerance`         |
| `ops.fillAll`            | `x`, `y`, `color`, `tolerance`         |
| `ops.erasePixels`        | `count`                                |
| `ops.eraseRect`          | `x`, `y`, `width`, `height`            |
| `ops.erasePixelsAndRect` | `count`, `x`, `y`, `width`, `height`   |
| `ops.replaceColor`       | `from`, `to`, `tolerance`              |
| `ops.applyPalette`       | `count`                                |
| `ops.applyPaletteRegion` | `count`, `x`, `y`, `width`, `height`   |
| `ops.hueShift`           | `degrees`                              |
| `ops.hueShiftRegion`     | `degrees`, `x`, `y`, `width`, `height` |
| `ops.saturation`         | `percent`                              |
| `ops.saturationRegion`   | `percent`, `x`, `y`, `width`, `height` |
| `ops.brightness`         | `percent`                              |
| `ops.brightnessRegion`   | `percent`, `x`, `y`, `width`, `height` |
| `ops.outline`            | `color`, `mode`                        |
| `ops.getPixels`          | none                                   |
| `ops.getPixelsRect`      | `x`, `y`, `width`, `height`            |
| `ops.getPalette`         | none                                   |
| `ops.getTexture`         | `source`                               |
| `ops.readStyleBrief`     | none                                   |
| `ops.updateStyleBrief`   | `fields` (e.g. `"theme, rules"`)       |

## Context sent to the model

1. **System prompt**: the common preamble of PLAN 6.4 (coordinates, colors, rotation and flip vocabulary, style
   brief rules, "Reply in {language}. If the user writes in another language, reply in the user's language.")
   with the brief as compact JSON (theme, palette, rules, last 20 decisions, last 10 requests), then the editor
   instructions with the texture size. Text in `prompts.ts`.
2. **History**: previous turns of `editor.jsonl`, newest first, within 30 turns and about 6000 tokens (4
   characters per token). Assistant tool calls are summarized as "(Tools called: ...)", tool results are dropped,
   proposal decisions become "[App note]" user messages. Dropped turns are replaced by one note listing the last
   few earlier requests.
3. **User message**: `[Open texture: <path> (W x H px)]`, then `[Custom item: <name> (<kind>, base <base>)]` when
   the texture is a custom item's texture or worn texture (M14, `ItemService.forTexture`), the texture state, the 3D
   model layout when the texture has one, then the request.

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
- **Animated textures** (M9): the request carries the whole strip with its frame height and the frame the user is
  editing. The model sees that frame only (image and grid) and an animation note in the system prompt. Image tools
  (every mutate tool, `get_pixels`, `get_palette`, `get_texture`) get an optional `frame` (0-based) in their JSON
  Schema: with it a step changes or reads that frame; without it a change applies to every frame and a read looks at
  the user's frame. A change that would resize a frame is refused. Each step records its `frame` (number or `all`,
  shown in the plan) and the apply replays it on the same frame (`src/shared/ai/tools/frames.ts`).
- **Items**: one line about the extruded in-hand sprite. Flat textures (GUI, particles) get nothing.

A failing preview never fails the run; the block is simply left out. The editor instructions tell the model to use
the rectangles before drawing and to edit every face a change should appear on.

### Image and grid strategy

| Model / setting                     | First message                       | After mutate tools                                    |
| ----------------------------------- | ----------------------------------- | ----------------------------------------------------- |
| No vision, or vision unknown        | grid                                | grid in each tool result                              |
| Vision, `vision+grid` (default)     | upscaled image + grid               | grid in each result, fresh image every 3 mutate steps |
| Vision, `grid`                      | grid                                | grid                                                  |
| Vision, `image`                     | upscaled image                      | fresh image after each iteration with changes         |
| Vision, texture side above 64 px    | image + "use get_pixels(rect)" note | fresh image after each iteration with changes         |
| No vision, more than 128x128 pixels | palette summary + get_pixels note   | same                                                  |

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

`runAgentLoop` (`loop.ts`) is shared by both agents; an agent supplies its tools, its first messages, an
`execute(call)` function and an optional message after each iteration (a fresh image). `runEditorAgent` (one call
per user message):

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

## Navigation agent

Lives next to the grid (**AI assistant** in the pack header, or **Ask the AI** in the selection bar). One
conversation per pack tab (`navigation.jsonl`); every request carries the current selection, in pack order.

- **Tools**: the color and transform tools of the registry (`hue_shift`, `saturation`, `brightness`,
  `replace_color`, `apply_palette`, `outline`, `rotate`, `flip`, `shift`) apply to EVERY selected texture. Each
  takes an optional `textures` filter: `{ indices: [numbers from the list], match: "glob" }` (union; the glob is
  matched on "folder/name", or on the name alone when it has no slash: `*_ore`, `block/*_planks`). `get_palette`
  and `get_pixels` take an `index` to read one texture. `read_style_brief` and `update_style_brief` work as in the
  editor. There are no drawing tools in this scope. These tools are the selection-limited `apply_to_all` of PLAN
  6.3.
- **Context**: the system prompt states the selection size and the scope rules. The user message lists the
  selection as `#n folder/name WxH: main colors` (first 300 textures, then a count per folder). Vision models also
  get up to 3 contact sheets (6 x 6 tiles of 64 px, each labelled with its number; animated textures show their
  first frame).
- **Execution**: drafts of every selected texture stay in memory. A bulk call runs on its targets (per frame for
  animated textures) and becomes one step with `targets` (the resolved paths). The tool result says how many
  textures changed, and lists their numbers. After an iteration with changes, vision models get a contact sheet
  of the textures the last step changed.
- **Proposal** (`kind: 'bulk'`): the steps, and the changed textures with their before PNG (as the agent saw
  them) and after PNG (all steps). The review grid ([bulk.md](bulk.md)) lets the user untick steps and textures.
- **Apply** (`ai.navigation.apply { proposalId, acceptedStepIds, acceptedPaths }`): the accepted steps are
  replayed, in order, on the accepted textures, starting from the pixels the agent saw (in the bulk worker), then
  written as one history entry (`source: 'ai'`, label "AI plan on N textures"). Accepted brief patches, the
  request log line (`N selected textures: "<request>" -> tools (k of n steps)`) and the conversation note work as
  for the editor.

## Creation agent

Lives next to the pack overview (**Ask the AI (whole pack)** in the pack header when no category is open). One
conversation per pack tab (`creation.jsonl`); it works on the whole pack, which can hold thousands of textures, so a
run never decodes them all.

What it can change is the pack's **catalog** (`packs.catalog`): the pack's textures plus every vanilla texture of
its authoring version, whatever the base. For a vanilla-based pack that is the grid's list; for an empty pack it is
all of Minecraft's textures, so "un squelette en glace" finds `entity/skeleton/*` and the accepted steps ADD the
transformed textures to the pack (starting from vanilla keeps entity UV layouts right). Pixels come from
`textures.readCatalog`: the pack's file, else the vanilla file. The user message says when the pack started empty.

- **Tools** (scope-specific, in `creation.ts`):
  - `apply_to_all { operation: { tool, args }, filter: { categories?, folders?, match? } }`: one color or transform
    operation (the bulk tools: `hue_shift`, `saturation`, `brightness`, `replace_color`, `apply_palette`,
    `outline`, `rotate`, `flip`, `shift`) on every texture matching the filter. A texture matches when it is in ANY
    of the categories, in one of the folders (subfolders included) and matches the glob (same glob rules as the
    navigation agent); an empty filter is the whole pack. `args` are validated against that tool's schema.
  - `list_textures { filter, limit }`: the matching textures (`folder/name WxH (status)`), to check a filter.
  - `set_pack_meta { name?, description? }`: a new pack name and/or description, as a plan step.
  - `update_style_brief`: as in the other agents. The prompt asks for a brief (theme, 4-12 color palette with roles,
    rules) first, then a few category steps.
- **Context**: the system prompt states the pack size. The user message gives the pack name and description, the
  categories with texture and modified counts, the top folders, and up to 36 representative textures
  (`pickSamples`: 3 per category, modified first, at most 64 px) as `#n folder/name WxH: main colors`. Vision models
  also get one contact sheet of them.
- **Execution**: an `apply_to_all` call resolves its filter over the texture index (no decoding), runs the operation
  on the drafts of the matched samples only, and becomes one step with `targets` (every matched path), `scope`
  (filter, count, count per category) and `samples` (up to 6 before / after pairs, after this step on top of the
  earlier ones). At most 24 steps per plan. After an iteration with changes, vision models see the samples the last
  step changed.
- **Proposal** (`kind: 'plan'`): reviewed step by step (`CreationReview.vue`): what each step covers, its samples,
  brief and pack name changes. There is no per-texture checkbox. Unticking a step that later ones were previewed on
  shows a warning.
- **Apply** (`ai.creation.apply { proposalId, acceptedStepIds }`): brief patches and pack meta (`packs.updateMeta`:
  project.json and the pack folder's pack.mcmeta description) first, then each accepted texture step in order on
  the CURRENT pixels of its targets (catalog read, so vanilla for textures an empty pack does not have yet; bulk
  worker), written as its own history entry ("AI plan, step k of n (N
  textures)"): these are the checkpoints, so the last steps can be undone without losing the first ones.
  Progress: `job.progress` `ai.plan.apply` (one tick per step) and `bulk.apply` (textures of the current step).
  `ai.creation.stopApply { proposalId }` stops after the current step; the result says `stopped`. The request log
  line is `whole pack (N texture writes): "<request>" -> tools (k of n steps)`.

### Data pack tools

On data packs and combined packs (M10, see [datapacks.md](datapacks.md)) the creation agent also works on data
files (`creation-data.ts`). The tools depend on the pack kind: a resource pack keeps the texture tools only, a data
pack gets only the data tools (no `apply_to_all` / `list_textures`, no textures loaded, no contact sheet), a combined
pack gets both. Each set comes with its own system prompt text (`CREATION_DATA_INSTRUCTIONS`, or
`COMBINED_DATA_ADDENDUM` added to the texture instructions).

- `list_data { kind?, match?, namespace?, changedOnly?, limit }`: files of the pack and vanilla's (`path (status)`;
  `planned` for files this plan writes). `match` is a glob on the name, or on the id path when it has a `/`.
- `read_json { path }`: the current text (the file this plan writes, else the pack's, else vanilla's), cut at
  12,000 characters (`truncated`).
- `write_json { path, json }`: the WHOLE file as a JSON object. The path must be a data JSON file
  (`parseDataPath`); the content goes through the same checks as the editor (`validateData` with the game's ids).
  Errors refuse the file and return the reasons to the model (`required {"key":"result"} at result; ...`) so it can
  fix it; warnings (unknown items...) are returned with the step. A step stores `json: { path, text, previous,
  warnings }` (`previous` null for a new file); writing the same path again replaces the step. At most 24 files per
  plan. The tool description gives the 1.21.4+ formats and FR/EN examples (a new recipe, a changed vanilla loot table,
  a tag addition).

The user message of a data pack lists the data files per kind (total, changed or added) and the pack's own files.
In the plan review a data step shows its path, **New file** / **Changed file**, the warning count and the file text
(collapsed). On apply, all accepted data files are written first as ONE history entry ("AI plan: N data files",
`DataService.saveMany`), then the texture steps as before; the result has `filesWritten`. The FR/EN evaluation has 3
data cases on the `sample_datapack` fixture (a recipe, a loot table change, a tag addition).

### Data agent (data editor)

The data editor's **AI** panel has a chat with the data agent (`data-agent.ts`, agent kind `data`): it refines the
ONE open data file with `edit_file` (the whole new file, checked like the editor; errors refuse it), `read_json` and
`list_data`. Its proposal (`DataFileProposal`, `kind: 'file'`) is emitted but not kept in the proposal store: the
renderer applies it to the editor, unsaved, and the user's save writes it. The FR/EN evaluation has a `data` context
(3 cases on files of `sample_datapack`: a recipe count, a tag addition, a loot table change). See
[datapacks.md](datapacks.md#data-agent).

### Explain (data editor)

The data editor's **Explain** tab reuses the agent loop for one answer without tools (`explain.ts`, agent
`explain` in the `started` event): no proposal, no conversation file. See [datapacks.md](datapacks.md#explain) for
the context it sends.

### Custom item tools (M14)

On combined packs the creation agent also gets the custom item tools, with `COMBINED_DATA_ADDENDUM` explaining the
base item idea; on resource and data packs the prompt says that custom items need a "Resource + data pack". The user
message lists the pack's items (`id: English name (kind, base ...)`) and the namespace of new items.

- `list_items {}` and `read_item { id }`: the pack's items as this plan leaves them.
- `write_item { item, textureFrom? }`: the WHOLE definition (`schemaVersion` and `namespace` are filled in when left
  out), checked by `checkDefinition` (`item-ai.ts`): `CustomItemSchema`, both `en_us` and `fr_fr` names for a new or
  renamed item, the namespace unchanged; ids this version does not have are warnings. An id the pack has replaces
  that item (`isNew: false`); otherwise it is a new item whose texture is copied from `textureFrom` (a vanilla or
  pack texture, default: the preset texture of its kind). The new texture (and the worn texture of armor) joins the
  run's texture list and samples, so a later `apply_to_all` on `{"match": "<id>"}` previews on it; that step's
  `dependsOn` includes the item step. The step stores `item: { op: 'write', id, item, textureFrom?, isNew }`.
- `delete_item { id }`: removes an item of the pack (`item: { op: 'delete', id }`).

Writing or deleting the same id again replaces the earlier step and keeps its id. At most 12 item steps per plan.
The plan review shows **New item** / **Changed item** / **Deleted item**, the kind and base, the texture source and
the definition. On apply, item steps are written after the data files and BEFORE the catalog is read for the texture
steps, as ONE history entry ("AI plan: N items", `ItemService.applyMany`), so a step recoloring a new item's texture
finds it; the result has `itemsWritten`.

### Item agent (item page)

The item page's **AI** pane has a chat with the item agent (`item-agent.ts`, agent kind `item`, conversation
`item.jsonl`, past messages tagged `[Item: <id>]`) and an **Explain** tab.

- **Request** (`ai.item.send { packId, id, item, message, model, language, thinking? }`): `item` is the form's
  definition, unsaved and possibly not valid (only its size is checked at the IPC boundary); `id` is the id the item
  is saved under. Run key `<packId>:item`; stop with `ai.agent.stop`.
- **Context** (`gatherItemSources`, `itemContext`): the pack and version, whether the form has unsaved edits, the
  definition as JSON, the checks (schema errors, or ids the version does not have), the files the item generates,
  how to get it (recipe, `/function <ns>:give/<id>`), the base item and the vanilla recipes that use it (the
  custom item also works in them), the starting values of its kind as a reference, the English names of the ids
  involved, and the pack's other items. The system prompt adds `ITEM_DEFINITION_GUIDE`, the field guide shared with
  `write_item`.
- **Tools**: `edit_item { item }` (the WHOLE new definition; the definition alone is accepted too), checked by
  `checkDefinition` against the item it replaces: errors are returned to the model so it fixes them; a rename is
  allowed (to an id no other item has) and needs both names. `get_texture { worn? }` returns the item texture as a
  palette grid (read only). `list_items`, `read_item`, `read_json` and `list_data` read the pack.
- **Proposal** (`ItemDefinitionProposal`, `kind: 'item'`): `before` (the form's definition), `after` (valid,
  defaults filled in) and `unknownIds`. Like the data agent's, it is emitted but never stored or written by main:
  `ItemReview.vue` lists the changed fields (`itemChangesBetween` in `src/shared/ai/item-changes.ts`: names, stats,
  effects, recipe) and the whole definition, and **Apply to form** puts it in the form, unsaved.
- **Explain** (`ai.item.explain { packId, id, item, model, language, thinking? }`, run key `<packId>:itemExplain`,
  session `itemExplain` so it does not replace the data editor's explanation): one answer without tools, from the
  same context, in the UI language: how to get the item, its stats compared with its base item, effects, stacking
  and the base item caveat.
- **Settings**: Settings > AI has an **Item agent** entry (model, reasoning, round trips, at most 6); without a
  default model the chat and Explain use the creation agent's.

The FR/EN evaluation has an `item` context (fixture = an item id of the combined test pack, see `evalItem`: damage,
stack size, an effect when eaten, a recipe, a rename, the shimmer, durability) and creation cases on the
`sample_combined` fixture (a sword, a food with an effect, a helmet, a pickaxe, a delete).

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

| Code                    | When                                                                 |
| ----------------------- | -------------------------------------------------------------------- |
| `ai.invalidTexture`     | `ai.agent.send` with a PNG that does not decode                      |
| `ai.textureTooLarge`    | texture side above 1024 (`params.max`)                               |
| `ai.proposalNotFound`   | unknown or expired proposal id (`params.proposalId`)                 |
| `ai.proposalNotPending` | proposal already applied or rejected (`params.proposalId`, `status`) |
| `ai.replayFailed`       | a step could not be re-executed (`params.step`, `tool`)              |
| `ai.agentFailed`        | unexpected error without a code during a run (in `done.error`)       |
| `ai.emptySelection`     | none of the selected textures could be read (navigation agent)       |
| `packs.notFound`        | unknown pack id (`params.packId`)                                    |

Errors thrown by the provider layer (`ai.providerNotFound`, `ai.noApiKey`, `ai.providerDisabled` and the
adapters' `ai.*` codes) are passed through unchanged in `done.error`.
