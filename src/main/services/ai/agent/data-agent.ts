import { z } from 'zod'
import { dataContext, formatJson, validateData } from '@shared/datapack'
import { toolJsonSchema, type AnyTool } from '@shared/ai/tools'
import type {
  AgentSettings,
  ChatMessage,
  ConversationTurn,
  DataAgentRequest,
  ModelInfo,
  ToolCall,
  ToolKind,
  ToolSpec
} from '@shared/ai/types'
import type { DataEntry } from '@shared/model/data'
import { historyMessages } from './context'
import {
  DataDraft,
  LIST_DATA_DESCRIPTION,
  ListDataSchema,
  MAX_READ_CHARS,
  ReadJsonSchema,
  issuesForModel
} from './creation-data'
import {
  DATA_PACK_RULES,
  KIND_GUIDES,
  LANGUAGE_NAMES,
  VERSION_NOTES,
  fileContext,
  type ExplainSources
} from './explain'
import {
  argsOf,
  issues,
  runAgentLoop,
  unknownTool,
  type CallOutcome,
  type Emit,
  type LoopDeps,
  type RunReason
} from './loop'

/**
 * The data agent (M10): the chat of the data editor, about the ONE file open there. It reads other data files for
 * reference and proposes the whole new text of the open file with edit_file, checked like the editor checks it. The
 * proposal goes into the editor (unsaved) only when the user applies it; the user's save writes the file.
 */

export const EditFileSchema = z
  .object({
    json: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('JSON files: the WHOLE new file as a JSON object'),
    text: z
      .string()
      .max(1024 * 1024)
      .optional()
      .describe('Function files (.mcfunction): the WHOLE new file as text')
  })
  .strict()

export const EDIT_FILE_DESCRIPTION = `Propose the WHOLE new content of the file open in the editor (the only file you can change). The user reviews it
before it goes into the editor. JSON files: pass "json", the whole file as an object; keep everything the user did not
ask to change exactly as it is. Function files (.mcfunction): pass "text". The file is checked against Minecraft's
format: an invalid file is refused with the reasons, fix it and call edit_file again.
Examples:
- on a skeleton loot table, "fais tomber 2 à 4 flèches" / "drop 2 to 4 arrows" -> the same table with the arrow entry's
  set_count "count" changed to {"type":"minecraft:uniform","min":2,"max":4}
- on a recipe, "donne 8 au lieu de 6" / "make it give 8 instead of 6" -> the same recipe with "result" {"id": same id,
  "count": 8}
- on a block tag, "ajoute le basalte" / "add basalt" -> {"json":{"values":[...the current values..., "minecraft:basalt"]}}`

const READ_FILE_DESCRIPTION = `Read another data file of the pack (the pack's version, else vanilla's), for example a vanilla file to copy
from or a tag's content. The open file is already in the request. Example: {"path":"data/minecraft/tags/item/planks.json"}`

export const DATA_AGENT_INSTRUCTIONS = `You are the data pack assistant of Blocksmith Studio, a Minecraft Java Edition pack editor. You help the user refine
ONE data file: the one open in the editor (described in the request). You never write files: edit_file proposes the new
content, the user reviews it, puts it in the editor and saves it.

Reply in {{language}}. If the user writes in another language, reply in the user's language.
- When the user asks for a change, call edit_file with the WHOLE new file, then reply in one to three short sentences
  saying what changes in game, in simple terms (no JSON in your reply).
- When the user asks a question, answer it in simple terms without calling edit_file.
- When the request is ambiguous (which item? how many?), ask one short question instead of guessing.
- Use read_json to look at other files (a vanilla file to copy from, a tag's content) and list_data to find them. Ids
  must exist in this Minecraft version: read the warnings edit_file returns. Data packs cannot add new items or blocks.
- Only the open file can change. If the request needs another file (a new tag, another recipe), say so: the user can
  open or create it in the data browser.
- Write the file in the format of the pack's Minecraft version (see the format notes). Plain text replies only: no
  headings, no bold, no tables.`

/** Tool calls per request (each edit_file attempt counts). */
export const DATA_AGENT_MAX_ITERATIONS = 6

export interface DataAgentInput {
  runId: string
  request: DataAgentRequest
  sources: ExplainSources
  entries: DataEntry[]
  /** Another data file's text (the pack's, else vanilla's); null when it does not exist. */
  read(path: string): Promise<string | null>
  settings: AgentSettings
  history: ConversationTurn[]
  /** Model info when known (request cost). */
  modelInfo?: ModelInfo
}

export interface DataAgentResult {
  reason: RunReason
  error?: { code: string; params?: Record<string, string | number> }
  turns: ConversationTurn[]
  /** The last valid edit_file, when it differs from the editor text. */
  proposal?: { after: string; warnings: number }
}

function spec(name: string, description: string, schema: z.ZodType): ToolSpec {
  return {
    name,
    description,
    parameters: toolJsonSchema({ name, description, params: schema } as AnyTool)
  }
}

const TOOLS = [
  {
    name: 'edit_file',
    kind: 'mutate' as ToolKind,
    schema: EditFileSchema,
    spec: spec('edit_file', EDIT_FILE_DESCRIPTION, EditFileSchema)
  },
  {
    name: 'read_json',
    kind: 'read' as ToolKind,
    schema: ReadJsonSchema,
    spec: spec('read_json', READ_FILE_DESCRIPTION, ReadJsonSchema)
  },
  {
    name: 'list_data',
    kind: 'read' as ToolKind,
    schema: ListDataSchema,
    spec: spec('list_data', LIST_DATA_DESCRIPTION, ListDataSchema)
  }
]

/** Tool names of the data agent (tests, docs). */
export const DATA_AGENT_TOOLS = TOOLS.map((t) => t.name)

/** System prompt and messages: instructions, history, then the open file's context and the request. */
export function buildDataAgentMessages(input: DataAgentInput): ChatMessage[] {
  const { request, sources } = input
  const system = [
    DATA_AGENT_INSTRUCTIONS.replaceAll('{{language}}', LANGUAGE_NAMES[request.language]),
    DATA_PACK_RULES,
    KIND_GUIDES[sources.info.kind],
    VERSION_NOTES
  ].join('\n\n')
  return [
    { role: 'system', text: system },
    ...historyMessages(input.history),
    {
      role: 'user',
      text: `[Open file]\n${fileContext(sources).join('\n\n')}\n\nUser request:\n${request.message}`
    }
  ]
}

export async function runDataAgent(
  input: DataAgentInput,
  deps: LoopDeps,
  emit: Emit,
  signal: AbortSignal
): Promise<DataAgentResult> {
  const { request, sources } = input
  const { info } = sources
  const ctx = dataContext(sources.ids)
  const draft = new DataDraft({ entries: input.entries, ids: sources.ids, read: input.read })
  let proposal: DataAgentResult['proposal']
  const byName = new Map(TOOLS.map((t) => [t.name, t]))
  const specs = TOOLS.map((t) => t.spec)

  const fail = (kind: ToolKind, message: string): CallOutcome => ({
    ok: false,
    kind,
    summary: message,
    content: JSON.stringify({ ok: false, error: message })
  })
  const ok = (kind: ToolKind, summary: string, result: unknown, mutated = false): CallOutcome => ({
    ok: true,
    kind,
    summary,
    mutated,
    content: JSON.stringify({ ok: true, result })
  })

  function editFile(args: z.output<typeof EditFileSchema>): CallOutcome {
    let after: string
    let warnings = 0
    let note = ''
    if (info.text) {
      if (args.text === undefined) return fail('mutate', 'This is a function file: pass "text".')
      after = args.text.endsWith('\n') ? args.text : `${args.text}\n`
    } else {
      if (!args.json) return fail('mutate', 'This is a JSON file: pass "json", the whole file.')
      const found = validateData(info.kind, args.json, ctx, info.registry)
      const errors = found.filter((i) => i.severity === 'error')
      if (errors.length) {
        return fail(
          'mutate',
          `Minecraft would reject this file, nothing was proposed. Fix: ${issuesForModel(errors)}`
        )
      }
      warnings = found.length
      if (warnings) note = issuesForModel(found)
      after = formatJson(args.json)
    }
    proposal = { after, warnings }
    return ok(
      'mutate',
      `Proposed a new version of ${info.path}`,
      {
        proposed: true,
        ...(note ? { warnings: note } : {}),
        note: 'The user will review the file before it goes into the editor.'
      },
      true
    )
  }

  async function readFile(path: string): Promise<CallOutcome> {
    if (path === info.path) {
      const text = proposal?.after ?? request.text
      return ok('read', `Read ${path}`, {
        path,
        text: text.slice(0, MAX_READ_CHARS),
        ...(text.length > MAX_READ_CHARS ? { truncated: true } : {})
      })
    }
    const file = await draft.read(path)
    if (!file) return fail('read', `No data file at ${path} (use list_data to find it).`)
    return ok('read', `Read ${path}`, file)
  }

  async function execute(call: ToolCall): Promise<CallOutcome> {
    const tool = byName.get(call.name)
    if (!tool) return unknownTool(call, specs)
    const parsed = tool.schema.safeParse(argsOf(call))
    if (!parsed.success) {
      return fail(tool.kind, `Invalid arguments for ${tool.name}: ${issues(parsed.error)}`)
    }
    switch (tool.name) {
      case 'edit_file':
        return editFile(parsed.data as z.output<typeof EditFileSchema>)
      case 'read_json':
        return readFile((parsed.data as z.output<typeof ReadJsonSchema>).path)
      default: {
        const listed = draft.list(parsed.data as z.output<typeof ListDataSchema>)
        return ok('read', `Listed ${listed.files.length} of ${listed.count} file(s)`, listed)
      }
    }
  }

  const result = await runAgentLoop(
    {
      agent: 'data',
      tools: specs,
      messages: buildDataAgentMessages(input),
      execute,
      kindOf: (name) => byName.get(name)?.kind ?? 'read'
    },
    {
      runId: input.runId,
      model: request.model,
      ...(input.modelInfo ? { modelInfo: input.modelInfo } : {}),
      thinking: request.thinking ?? input.settings.thinking,
      maxIterations: Math.min(input.settings.maxIterations, DATA_AGENT_MAX_ITERATIONS)
    },
    deps,
    emit,
    signal
  )
  const changed = proposal && proposal.after !== request.text ? proposal : undefined
  return { ...result, ...(changed ? { proposal: changed } : {}) }
}
