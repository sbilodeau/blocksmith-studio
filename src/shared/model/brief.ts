import { z } from 'zod'

/** Shared agent memory per pack (.blocksmith/style-brief.json), readable and editable by the user and every agent. */
export const StyleBriefSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  theme: z.string().max(200).default(''),
  palette: z
    .array(
      z.object({
        hex: z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/),
        role: z.string().max(60).optional()
      })
    )
    .max(32)
    .default([]),
  rules: z.array(z.string().max(300)).max(40).default([]),
  decisions: z
    .array(
      z.object({
        at: z.string(),
        by: z.enum(['user', 'creation', 'navigation', 'editor']),
        text: z.string().max(300)
      })
    )
    .max(100)
    .default([]),
  requestLog: z
    .array(
      z.object({
        at: z.string(),
        agent: z.enum(['creation', 'navigation', 'editor']),
        summary: z.string().max(300)
      })
    )
    .max(60)
    .default([]),
  updatedAt: z.string().default('')
})

export type StyleBrief = z.infer<typeof StyleBriefSchema>

/** What the user (or an agent, through update_style_brief) may change. */
export const StyleBriefPatchSchema = z
  .object({
    theme: z.string().max(200).optional(),
    // unwrap(): the brief defaults ([]) must not apply to a patch, or every patch would clear these fields.
    palette: StyleBriefSchema.shape.palette.unwrap().optional(),
    rules: StyleBriefSchema.shape.rules.unwrap().optional(),
    addDecision: z.string().max(300).optional()
  })
  .strict()

export type StyleBriefPatch = z.infer<typeof StyleBriefPatchSchema>

export function emptyBrief(): StyleBrief {
  return StyleBriefSchema.parse({})
}
