import { z } from 'zod'
import { StyleBriefPatchSchema } from '../../model/brief'
import { defineTool, type AnyTool } from './define'

export const updateStyleBrief = defineTool({
  name: 'update_style_brief',
  kind: 'memory',
  scopes: ['editor', 'navigation', 'creation'],
  description: `Propose a change to the pack's style brief when the user states a LASTING preference (theme, palette, rule). The change is
shown to the user as a plan step and applied only if they accept it. Fields (all optional):
theme (short text), palette (FULL replacement list of {"hex":"#rrggbb","role":"..."}, max 32), rules (FULL replacement
list of short rules, max 40), addDecision (one line recording the decision).
Examples:
- "à partir de maintenant, toujours des contours noirs" / "from now on, always use black outlines" ->
  {"patch":{"rules":["<existing rules>","Items have a 1-pixel black outline"],"addDecision":"Black outlines on items"}}
- "le thème du pack est médiéval sombre" / "the pack theme is dark medieval" -> {"patch":{"theme":"Dark medieval"}}`,
  params: z.object({ patch: StyleBriefPatchSchema }).strict(),
  describe: (a) => ({
    key: 'ops.updateStyleBrief',
    params: { fields: Object.keys(a.patch).join(', ') }
  }),
  execute: (_ctx, a) => ({
    result: { proposed: true, note: 'The user will review this style brief change.' },
    summary: `Proposed a style brief change (${Object.keys(a.patch).join(', ') || 'nothing'})`
  })
})

export const MEMORY_TOOLS: AnyTool[] = [updateStyleBrief]
