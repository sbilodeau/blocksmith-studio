# AI FR/EN evaluation

The editor agent must understand requests in French and in English equally well. The evaluation sends a fixed set
of phrases to a real model and checks that it calls the right tools with the right arguments (PLAN 6.8 and 9.4).

## What is tested

- `resources/data/ai-eval/phrases.json`: 30 concepts, each with a French and an English phrase, so 60 requests.
  Examples: "tourne de 90 à gauche" / "rotate it 90 degrees to the left" must call
  `rotate {degrees: 90, direction: "counterclockwise"}`.
- Every request runs through the same runtime as the editor agent (`runEditorAgent`): system prompt, tool list,
  image and grid of a 16x16 test texture (`sample16`), up to 3 round trips. There is no conversation history, the
  style brief is empty, and nothing is written to disk.
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

Settings > AI > **Test a model**: pick a model, then **Quick test** (8 cases, 16 phrases) or **Full test**
(60 phrases). Progress is shown live, **Stop** cancels, and the result shows the scores per language, the missed
phrases with the calls the model made, and a button to copy the Markdown report. The provider's tokens are used.

### From the command line

Needs an Ollama Cloud key in the environment or in `.env.local` (git-ignored) at the repo root:

```bash
echo "OLLAMA_API_KEY=..." >> .env.local
npm run test:ai                                              # default model (gpt-oss:120b)
BLOCKSMITH_EVAL_MODEL=qwen3-coder:480b npm run test:ai        # another Ollama Cloud model
BLOCKSMITH_EVAL_CASES=rotate-left-90,flip-horizontal npm run test:ai
```

| Variable                      | Meaning                                                        |
| ----------------------------- | -------------------------------------------------------------- |
| `OLLAMA_API_KEY`              | Ollama Cloud key. Without it the suite is skipped              |
| `BLOCKSMITH_EVAL_MODEL`       | `model` (Ollama Cloud) or `provider/model`                     |
| `BLOCKSMITH_EVAL_CASES`       | Comma-separated case ids to run (default: all)                 |
| `BLOCKSMITH_EVAL_CONCURRENCY` | Parallel requests (default 3; lower it if you get rate limits) |

The report is printed and written to `ai-eval-report.md`. `npm test` also runs the suite when the key is set.

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
