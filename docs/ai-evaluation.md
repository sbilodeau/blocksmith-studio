# AI FR/EN evaluation

The editor agent must understand requests in French and in English equally well. The evaluation sends a fixed set
of phrases to a real model and checks that it calls the right tools with the right arguments (PLAN 6.8 and 9.4).

## What is tested

- `resources/data/ai-eval/phrases.json`: 42 concepts, each with a French and an English phrase, so 84 requests.
  30 are editor cases (one texture), 6 are navigation cases (a selection of 4 textures: stone, iron ore,
  gold ore, oak planks), such as "assombris seulement les minerais" / "darken only the ores", which must call
  `brightness` with a negative delta and a `textures` filter that picks the ores (`*ore*` glob or numbers 2 and 3),
  and 6 are creation cases (the `sample_pack`: those 4 blocks plus an iron pickaxe and a diamond sword, in the
  categories blocks, ores, tools and weapons), such as "rends tous les minerais du pack plus rouges", which must call
  `apply_to_all` with a hue or color operation and a filter on the ores category (or an `ore` glob).
  Examples: "tourne de 90 à gauche" / "rotate it 90 degrees to the left" must call
  `rotate {degrees: 90, direction: "counterclockwise"}`.
- Every request runs through the same runtime as the agent of its context: `runEditorAgent` with the image and
  grid of a 16x16 test texture (`sample16`), or `runNavigationAgent` with the selection list and contact sheet of
  `sample_selection`, or `runCreationAgent` with the categories and samples of `sample_pack`; system prompt and tool
  list as in the app, up to 3 round trips. There is no conversation
  history, the style brief is empty, and nothing is written to disk.
- A case passes when the tool calls the model made satisfy every matcher in `expect`. Read tools the model calls on
  the way are ignored.

## Pass criteria

| Measure      | Threshold                         |
| ------------ | --------------------------------- |
| Overall rate | at least 90% of the requests pass |
| FR - EN gap  | at most 10 percentage points      |

Defaults live in `DEFAULT_THRESHOLDS` (`src/main/services/ai/eval/report.ts`).

## Running it

### From the app

Settings > AI > **Test models**: pick one or more models, then **Quick test** (9 cases, 18 phrases per model) or
**Full test** (72 phrases per model). Models run one after the other; progress is shown live and **Stop** cancels.

- One model: the scores per language, the missed phrases with the calls the model made, tokens, latency and cost
  (when the price is known).
- Several models: a side-by-side table, best first (highest overall rate, then the smallest FR-EN gap, then the
  lowest cost, then the fastest), with a verdict per model and the requests each model missed.

**Copy the report** copies the Markdown (the comparison table first, then each model's report). The providers'
tokens are used.

### From the command line

Needs at least one provider key in the environment or in `.env.local` (git-ignored) at the repo root:

```bash
echo "OLLAMA_API_KEY=..." >> .env.local
npm run test:ai                                              # default model (gpt-oss:120b)
BLOCKSMITH_EVAL_MODEL=qwen3-coder:480b npm run test:ai        # another Ollama Cloud model
BLOCKSMITH_EVAL_MODEL="gpt-oss:120b,openrouter/qwen/qwen3-32b,openai/gpt-4o-mini" npm run test:ai   # compare
BLOCKSMITH_EVAL_CASES=rotate-left-90,flip-horizontal npm run test:ai
```

| Variable                      | Meaning                                                                |
| ----------------------------- | ---------------------------------------------------------------------- |
| `OLLAMA_API_KEY`              | Ollama Cloud key (provider `ollama-cloud`, the default)                |
| `OPENAI_API_KEY`              | OpenAI key (provider `openai`)                                         |
| `OPENROUTER_API_KEY`          | OpenRouter key (provider `openrouter`)                                 |
| `BLOCKSMITH_EVAL_MODEL`       | `model` (Ollama Cloud) or `provider/model`; comma-separated to compare |
| `BLOCKSMITH_EVAL_CASES`       | Comma-separated case ids to run (default: all)                         |
| `BLOCKSMITH_EVAL_CONCURRENCY` | Parallel requests (default 3; lower it if you get rate limits)         |

Without any key the suite is skipped. The report is printed and written to `ai-eval-report.md` (with the
side-by-side table first when several models ran); each model must meet the pass criteria. `npm test` also runs
the suite when a key is set.

### In CI

The `ai-eval` job in `.github/workflows/ci.yml` runs on pull requests that change AI code (`src/main/services/ai/`,
`src/shared/ai/`, `src/main/ipc/ai-*`, `resources/data/ai-eval/`, `tests/ai-eval/`), and on demand from the Actions
tab ("Run workflow", with an optional model). It needs the repository secret `OLLAMA_API_KEY`; without it, or on
pull requests from forks, it skips. The default model can be set with the repository variable `AI_EVAL_MODEL`.
The report goes to the job summary and to a comment on the pull request.

## Adding a case

Add an entry to `phrases.json`:

```json
{
  "id": "flip-vertical",
  "context": "editor",
  "fixture": "sample16",
  "fr": "retourne-la de haut en bas",
  "en": "flip it upside down vertically",
  "expect": [{ "tool": "flip", "args": { "axis": "vertical" } }]
}
```

Matchers (`src/main/services/ai/eval/match.ts`): each entry of `expect` must be satisfied by at least one call.

| Matcher                               | Meaning                         |
| ------------------------------------- | ------------------------------- |
| `{ "tool": "rotate", "args": {...} }` | that tool, with these arguments |
| `{ "anyTool": ["hue_shift", "..."] }` | any of these tools              |
| `{ "anyOf": [matcher, matcher] }`     | any of these matchers           |

Argument keys are dot paths (`pixels.0.x`, `patch.theme`). Values are literals or predicates:
`{ "color": "red" }` (compared by hue and lightness), `{ "gt": 0 }` / `gte` / `lt` / `lte`,
`{ "containsAny": ["fire", "feu"] }` and `{ "containsAll": [...] }` (case-insensitive).

Keep expectations tolerant: several answers are often right ("make it redder" can be a hue shift, a palette or a
color replacement).
