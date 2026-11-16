# AI providers

How Blocksmith Studio talks to model providers (PLAN section 7). Code: `src/main/services/ai/providers/`,
`src/main/services/secrets.ts` and `src/main/ipc/ai-provider-handlers.ts`. Everything runs in the main process:
the renderer has no network access (CSP `connect-src 'self'`) and never sees an API key.

## Pieces

| File                          | Role                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------- |
| `services/secrets.ts`         | Encrypted API key store (`safeStorage`), one key per provider id             |
| `providers/http.ts`           | Shared HTTP client: URL checks, Bearer auth, retries, error mapping, NDJSON  |
| `providers/ollama.ts`         | Ollama native adapter (Ollama Cloud and self-hosted)                         |
| `providers/openai.ts`         | OpenAI-compatible adapter (OpenAI, OpenRouter, vLLM, LM Studio, Groq...)     |
| `providers/sse.ts`            | Server-Sent Events reader for OpenAI-compatible streams                      |
| `providers/capabilities.ts`   | Capability hint table by model-name pattern                                  |
| `providers/pricing.ts`        | Price hints (`resources/data/model-prices.json`) and request cost            |
| `providers/cost.ts`           | `costTierFor(pricing)` (`$` / `$$` / `$$$`, PLAN 7.4)                        |
| `providers/registry.ts`       | `ProviderRegistry`: adapter factory by kind, model cache, user overrides     |
| `ipc/ai-provider-handlers.ts` | `ai.providers.*` and `ai.models.list` channels                               |
| `shared/ai/presets.ts`        | Provider presets offered by Settings > AI > "Add a provider"                 |

Provider configs (`{ id, kind, label, baseUrl, enabled, extraHeaders? }`) live in `settings.ai.providers`
(default: Ollama Cloud, `https://ollama.com`). Keys live in `userData/secrets.bin`, never in `settings.json`.

Presets in Settings > AI > "Add a provider":

| Preset                  | Kind                | Base URL                       | Notes                                      |
| ----------------------- | ------------------- | ------------------------------ | ------------------------------------------ |
| Ollama Cloud            | `ollama`            | `https://ollama.com`           | The default provider                       |
| OpenAI                  | `openai-compatible` | `https://api.openai.com/v1`    | Prices from the hint table                 |
| OpenRouter              | `openai-compatible` | `https://openrouter.ai/api/v1` | Prices, capabilities and cost per request  |
| Ollama on this computer | `ollama`            | `http://localhost:11434`       | No key needed                              |
| Other                   | either              | typed by the user              | Any OpenAI-compatible server, or Ollama    |

The OpenRouter preset adds the optional attribution headers `HTTP-Referer` (the project's GitHub page) and
`X-Title: Blocksmith Studio`; no user data is sent in them. Every provider can be edited (name, URL, extra
headers as `Name: value` lines).

## Secrets

- `secrets.bin` is a JSON object `{ providerId: base64(safeStorage ciphertext) }`, written atomically (tmp + rename,
  mode 0600).
- When `safeStorage.isEncryptionAvailable()` is false, storing a key fails with `ai.secretsUnavailable`. There is
  no plain-text fallback.
- An empty (or blank) key deletes the entry; keys are trimmed. Deleting a provider deletes its key.
- Keys are never logged, never put in error params and never returned over IPC: the renderer only gets `hasKey`, plus `keyRequired: false` for loopback providers that work without a key.
- A corrupted file is kept as `secrets.bin.bak` and the store starts empty. A key that cannot be decrypted (other
  machine, keychain reset) reports `ai.secretsUnavailable`; setting the key again fixes it.

## Ollama native API

Verified against https://docs.ollama.com/api (chat, tags, errors, streaming), https://docs.ollama.com/cloud and
`api/types.go` in github.com/ollama/ollama (tool call and `/api/show` structs).

| Endpoint         | Use                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------- |
| `GET /api/tags`  | Model list: `{ models: [{ name, model, details, ... }] }`                                    |
| `POST /api/show` | `{ model }` -> `capabilities` (`completion`, `tools`, `vision`, `thinking`...), `model_info` |
| `POST /api/chat` | `stream: true`, NDJSON chunks `{ message: { content, thinking, tool_calls }, done, ... }`    |

- Auth: `Authorization: Bearer <key>` (Ollama Cloud). Self-hosted servers on a loopback URL need no key.
- Request: images as raw base64 (no `data:` prefix) in `message.images`; assistant tool calls as
  `tool_calls: [{ id, function: { name, arguments: <object> } }]`; tool results as
  `{ role: 'tool', content, tool_name, tool_call_id }` (`tool_call_id` is optional for Ollama, sent when known);
  tools as `[{ type: 'function', function: { name, description, parameters } }]`; `temperature` goes in `options`.
- `think`: sent only when `/api/show` lists `thinking` for the model (Ollama answers 400 otherwise). For those
  models it is always sent, because thinking models think by default: `false` for the reasoning level "off";
  for "low" / "medium" / "high", the level itself on models that accept levels (gpt-oss family, `ollamaThink`),
  `true` on the others.
- Stream mapping: `message.thinking` -> `thinking`, `message.content` -> `text`, each `message.tool_calls` entry ->
  `tool_call`, final chunk `prompt_eval_count` / `eval_count` -> `usage`, then `done` with `tool_calls` when calls
  were emitted, `length` for `done_reason: "length"`, else `end`.
- Tool calls: ids are synthesized (`call_<uuid hex>`) when absent. Arguments may be an object or a JSON string;
  a string that is not valid JSON is passed through as is, so the tool's schema validation reports it to the model.
- An `{ "error": "..." }` line inside a stream (errors after the response started keep HTTP 200) becomes
  `ai.providerError`. A stream that ends without `done: true` is `ai.invalidResponse`.
- `/api/show` results are fetched with at most 4 requests in flight and cached for the adapter's lifetime;
  a failing `/api/show` falls back to the hint table for that model and is retried on the next listing.
- Context length comes from the `model_info` key ending in `.context_length` (the prefix is the architecture).
- Ollama returns no prices, so `pricing` and `costTier` stay undefined (the badge is hidden, never guessed).

## OpenAI-compatible API

Checked against the OpenAI chat completions reference and OpenRouter's docs (models list, reasoning tokens, usage
accounting). The base URL includes the version prefix (`https://api.openai.com/v1`).

| Endpoint                 | Use                                                                                     |
| ------------------------ | --------------------------------------------------------------------------------------- |
| `GET /models`            | `{ data: [{ id, ... }] }`; OpenRouter adds `name`, `context_length`, `pricing`, ...     |
| `POST /chat/completions` | `stream: true`, `stream_options: { include_usage: true }`, SSE `data:` chunks, `[DONE]` |

- Request: images as `{ type: 'image_url', image_url: { url: 'data:image/png;base64,...' } }` content parts;
  assistant tool calls as `tool_calls: [{ id, type: 'function', function: { name, arguments: <JSON string> } }]`
  (with `content: null`); tool results as `{ role: 'tool', tool_call_id, content }`. Reasoning text is never sent
  back (some servers reject it).
- Stream mapping: `delta.content` -> `text`; `delta.reasoning_content` (DeepSeek, vLLM), `delta.reasoning`
  (OpenRouter, Ollama `/v1`) or the text of `delta.reasoning_details` -> `thinking` (only one of them per chunk, so
  OpenRouter's duplicated fields are not shown twice); `delta.tool_calls` fragments are assembled by `index`
  (arguments concatenated) and emitted as complete `tool_call` events when the stream ends; `usage.prompt_tokens`
  / `completion_tokens` -> `usage`. `finish_reason: "length"` -> `length`, calls -> `tool_calls`, else `end`.
- SSE parsing (`sse.ts`): comment lines (`: OPENROUTER PROCESSING`) and fields other than `data` are ignored,
  multi-line `data` is joined, CRLF is accepted, reading stops at `data: [DONE]`.
- An `{ "error": ... }` event inside the stream is `ai.providerError` with the provider's message; a stream that
  ends with no finished choice, no tool call and no usage is `ai.invalidResponse`.
- Server flavors (`flavorOf`), because api.openai.com answers 400 to fields it does not know:

| Flavor       | Host                 | Reasoning request (level != off)                       | Cost                   |
| ------------ | -------------------- | ------------------------------------------------------ | ---------------------- |
| `openai`     | `api.openai.com`     | `reasoning_effort`, for `o1`/`o3`/`o4`/`gpt-5` models   | price table            |
| `openrouter` | `openrouter.ai`      | `reasoning: { effort }` when `/models` lists reasoning | `usage.cost` (credits) |
| `generic`    | anything else        | `reasoning_effort` when the model can think            | price table            |

  The reasoning level "off" sends nothing (the model's default), since some models cannot turn reasoning off.
  OpenRouter credits are US dollars.
- Model list: entries whose id names a non-chat model (embeddings, whisper, tts, dall-e, moderation, image,
  realtime, audio...) are dropped, duplicates removed, ids sorted. Capabilities come from OpenRouter's
  `architecture.input_modalities` (`image` = vision) and `supported_parameters` (`tools`, `reasoning`) with
  `capabilitySource: 'provider'`; plain `/models` lists use the hint table. Prices from OpenRouter's per-token
  strings become $ per 1M tokens (`source: 'provider'`); `"-1"` (variable routers such as `openrouter/auto`) means
  unknown, `"0"` (free models) is a price of 0.

## Prices, overrides and cost tiers (PLAN 7.4)

- Price source, in priority order: the user's price (Settings > AI > Models > Adjust, `source: 'user'`), the
  provider's price (OpenRouter, `'provider'`), then the hint table `resources/data/model-prices.json` (`'hint'`,
  shown as "estimated"). The hint table is a list of case-insensitive regular expressions matched against the
  model id without its `vendor/` prefix, first match wins; check the providers' pricing pages when updating it.
- User overrides live in `settings.ai.modelOverrides` (`{ providerId, modelId, capabilities?, pricing? }`). An
  override with neither capabilities nor price is removed. Capabilities set by the user get
  `capabilitySource: 'user'`.
- `decorateModels` applies the overrides and computes `costTier` with `settings.ai.costTiers` (`{ low, high }`,
  default $1 / $10) every time a list is returned, so a change takes effect without refreshing the provider.
- Request cost: the provider's cost when it gives one (OpenRouter), otherwise tokens x the model's known price
  (`costFromUsage`, in the agent runtime). Without a price the usage badge shows tokens only.
- `settings.ai.showAllModels` also offers models without tool support in the model pickers (marked "no tools").

## Errors, retries and aborts

| Situation                              | Code                         | Params               |
| -------------------------------------- | ---------------------------- | -------------------- |
| HTTP 401 / 403                         | `ai.unauthorized`            |                      |
| HTTP 429 (after retries)               | `ai.rateLimited`             | `retryAfter?` (s)    |
| HTTP 404 on a model request            | `ai.modelNotFound`           | `model`              |
| Other HTTP status (5xx, 3xx, 400...)   | `ai.providerError`           | `status`, `message?` |
| Error line inside a stream             | `ai.providerError`           | `status`, `message`  |
| fetch failure (DNS, refused, TLS)      | `ai.network`                 |                      |
| Unparsable body or stream line         | `ai.invalidResponse`         |                      |
| "Test connection" timeout              | `ai.timeout`                 |                      |
| Stopped through the AbortSignal        | `ai.aborted`                 |                      |
| Unknown provider id                    | `ai.providerNotFound`        | `providerId`         |
| Provider disabled                      | `ai.providerDisabled`        | `providerId`         |
| No key stored (non-loopback provider)  | `ai.noApiKey`                | `providerId`         |
| Kind without an adapter yet            | `ai.providerKindUnsupported` | `kind`               |
| Base URL not https (or loopback http)  | `ai.insecureBaseUrl`         |                      |
| Invalid or reserved extra header       | `ai.invalidHeader`           | `name`               |
| Encryption unavailable / undecryptable | `ai.secretsUnavailable`      |                      |

- `message` is the provider's own error text, truncated to 300 characters, with the key redacted if it ever
  appears.
- Retries: 429 and 5xx are retried at most twice with exponential backoff (1 s, 2 s), or after `Retry-After`
  (capped at 30 s). Retries only happen before the response body is read, so no streamed data is ever replayed.
- Abort: `chat(request, signal)` throws `ai.aborted` when the signal fires (Stop button); the response body is
  cancelled, which closes the connection. Breaking out of the `for await` loop also cancels the body.

## Security

- `baseUrl` must be `https://`, or `http://` on `localhost`, `127.0.0.1` or `[::1]` only. Credentials, query strings
  and fragments are refused. Checked on save and again when an adapter is built.
- Request URLs are built from the base URL and must keep its origin; redirects are not followed
  (`redirect: 'manual'`, a 3xx is an `ai.providerError`), so the key cannot be forwarded to another host.
- Extra headers cannot override `Authorization`, `Host`, `Content-Type`, `Content-Length` or `Cookie`.
- Logged request failures contain the method, URL, status and code only; `Authorization` is replaced by `***` and
  the key is redacted from any error text.
- `fetch` is Electron's `net.fetch` (Chromium network stack, system proxy), injected so tests use a local server.

## Model catalog

- `ModelInfo.capabilities` come from `/api/show` (`capabilitySource: 'provider'`), else from the hint table
  (`'hint'`). The hint table in `capabilities.ts` is a list of `{ pattern, capabilities }` rows; every matching row
  adds its flags. Add a row (or extend a pattern) for new families. User overrides win (`'user'`).
- Model lists are cached per provider for 10 minutes. `ai.models.list { refresh: true }` bypasses the cache; a
  failed refresh keeps the previous list. Saving a provider or changing its key drops its cache.
- `costTierFor(pricing, thresholds?)`: blended price `(in + 3 x out) / 4` per 1M tokens; `$` below $1, `$$` from $1
  to $10 (inclusive), `$$$` above $10 by default (limits in `settings.ai.costTiers`). Undefined when prices are
  unknown or invalid.

## IPC channels

| Channel               | Input                       | Output                                                |
| --------------------- | --------------------------- | ----------------------------------------------------- |
| `ai.providers.list`   |                             | `ProviderStatus[]` (config + `hasKey`, `keyRequired`) |
| `ai.providers.save`   | `ProviderConfig`            | `ProviderStatus[]` (upsert by id)                     |
| `ai.providers.delete` | `{ providerId }`            | `ProviderStatus[]` (also deletes the key)             |
| `ai.providers.setKey` | `{ providerId, key }`       | `ProviderStatus` (empty key = delete)                 |
| `ai.providers.test`   | `{ providerId }`            | `{ ok, modelCount?, error? }` (never throws)          |
| `ai.models.list`      | `{ providerId?, refresh? }` | `ModelInfo[]`                                         |

- Deleting the last provider is allowed: the settings UI can add a preset (Ollama Cloud...) again with `save`.
- `test` builds a fresh adapter (also for a disabled provider), lists `/api/tags` only (no `/api/show`) with a
  15 s timeout and returns the error code instead of throwing.
- `ai.models.list` without `providerId` merges every enabled provider that has a key (or a loopback URL); a
  failing provider is skipped and logged.

## Registry (agent runtime)

`createProviderRegistry({ getProviders, secrets, fetch })` implements `ProviderRegistry` from
`services/contracts.ts`:

- `getAdapter(providerId)` returns a cached adapter (rebuilt when the config or key changes), or throws
  `ai.providerNotFound`, `ai.providerDisabled`, `ai.noApiKey`, `ai.insecureBaseUrl`, `ai.providerKindUnsupported`.
- `getModel(ref)` looks the model up in the cached list (loading it if needed); undefined when unknown or when the
  list cannot be loaded.

Adapters are built by `DEFAULT_ADAPTER_FACTORIES[kind]`: `ollama` and `openai-compatible`. The optional
`getModelSettings()` dependency gives the user overrides and cost tier limits applied to every returned list.

## Tests

- `tests/unit/secrets.test.ts`: fake `safeStorage`, round trip, refusal without encryption, ciphertext only.
- `tests/integration/ai-provider-ollama.test.ts`: adapter against a local `http.createServer` replaying
  `tests/fixtures/ai/ollama/*` (text, thinking, tool calls, images, usage, done reasons, 401/429/500/404, malformed
  line, stream error, abort mid-stream, redirects, `/api/show` concurrency and cache).
- `tests/integration/ai-provider-openai.test.ts`: the OpenAI-compatible adapter against the same server replaying
  `tests/fixtures/ai/openai/*` (text, tool call fragments, OpenRouter reasoning and cost, DeepSeek
  `reasoning_content`, wire format, stream errors, flavors, model lists).
- `tests/unit/ai-provider-models.test.ts`: SSE reader, price hints, overrides and tiers, model settings.
- `tests/unit/ai-provider-registry.test.ts`, `ai-provider-catalog.test.ts`, `ai-provider-handlers.test.ts`.
- `tests/e2e/ai-openai.spec.ts`: a custom OpenAI-compatible provider runs the editor agent in the real app.
- `tests/integration/ai-provider-live.test.ts`: skipped unless `OLLAMA_API_KEY` is set; lists models on
  https://ollama.com and runs a one-line chat (`OLLAMA_TEST_MODEL` picks the model).
