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
| `providers/capabilities.ts`   | Capability hint table by model-name pattern                                  |
| `providers/cost.ts`           | `costTierFor(pricing)` (`$` / `$$` / `$$$`, PLAN 7.4)                        |
| `providers/registry.ts`       | `ProviderRegistry` implementation: adapter factory by kind, model list cache |
| `ipc/ai-provider-handlers.ts` | `ai.providers.*` and `ai.models.list` channels                               |

Provider configs (`{ id, kind, label, baseUrl, enabled, extraHeaders? }`) live in `settings.ai.providers`
(default: Ollama Cloud, `https://ollama.com`). Keys live in `userData/secrets.bin`, never in `settings.json`.

## Secrets

- `secrets.bin` is a JSON object `{ providerId: base64(safeStorage ciphertext) }`, written atomically (tmp + rename,
  mode 0600).
- When `safeStorage.isEncryptionAvailable()` is false, storing a key fails with `ai.secretsUnavailable`. There is
  no plain-text fallback.
- An empty (or blank) key deletes the entry; keys are trimmed. Deleting a provider deletes its key.
- Keys are never logged, never put in error params and never returned over IPC: the renderer only gets `hasKey`.
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
  models it is sent explicitly as `true` or `false`, because thinking models think by default.
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
  adds its flags. Add a row (or extend a pattern) for new families. User overrides arrive in M4 (`'user'`).
- Model lists are cached per provider for 10 minutes. `ai.models.list { refresh: true }` bypasses the cache; a
  failed refresh keeps the previous list. Saving a provider or changing its key drops its cache.
- `costTierFor(pricing, thresholds?)`: blended price `(in + 3 x out) / 4` per 1M tokens; `$` below $1, `$$` from $1
  to $10 (inclusive), `$$$` above $10. Undefined when prices are unknown or invalid. Used by M4 providers.

## IPC channels

| Channel               | Input                       | Output                                       |
| --------------------- | --------------------------- | -------------------------------------------- |
| `ai.providers.list`   |                             | `ProviderStatus[]` (config + `hasKey`)       |
| `ai.providers.save`   | `ProviderConfig`            | `ProviderStatus[]` (upsert by id)            |
| `ai.providers.delete` | `{ providerId }`            | `ProviderStatus[]` (also deletes the key)    |
| `ai.providers.setKey` | `{ providerId, key }`       | `ProviderStatus` (empty key = delete)        |
| `ai.providers.test`   | `{ providerId }`            | `{ ok, modelCount?, error? }` (never throws) |
| `ai.models.list`      | `{ providerId?, refresh? }` | `ModelInfo[]`                                |

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

Adapters are built by `DEFAULT_ADAPTER_FACTORIES[kind]`. M4 adds `'openai-compatible'` there; until then such a
provider fails with `ai.providerKindUnsupported`.

## Tests

- `tests/unit/secrets.test.ts`: fake `safeStorage`, round trip, refusal without encryption, ciphertext only.
- `tests/integration/ai-provider-ollama.test.ts`: adapter against a local `http.createServer` replaying
  `tests/fixtures/ai/ollama/*` (text, thinking, tool calls, images, usage, done reasons, 401/429/500/404, malformed
  line, stream error, abort mid-stream, redirects, `/api/show` concurrency and cache).
- `tests/unit/ai-provider-registry.test.ts`, `ai-provider-catalog.test.ts`, `ai-provider-handlers.test.ts`.
- `tests/integration/ai-provider-live.test.ts`: skipped unless `OLLAMA_API_KEY` is set; lists models on
  https://ollama.com and runs a one-line chat (`OLLAMA_TEST_MODEL` picks the model).
