import type { ModelCapabilities } from '@shared/ai/types'

/**
 * Built-in capability hints by model-name pattern, used when the provider cannot tell (no /api/show, or an
 * OpenAI-compatible /v1/models list). Every matching row adds its capabilities. Keep patterns broad (family
 * names, not exact tags) and add a row for new families; the user can override per model in Settings (M4).
 */
export const CAPABILITY_HINTS: ReadonlyArray<{ pattern: RegExp; capabilities: ModelCapabilities }> =
  [
    // Vision: "vl" as its own token (qwen2.5vl, qwen3-vl), "vision", and known multimodal families.
    {
      pattern:
        /(^|[^a-z])vl([^a-z]|$)|vision|llava|bakllava|gemma[34]|llama4|minicpm-v|moondream|mistral-small3\.[12]|pixtral|granite3\.2-vision|gpt-4o|gpt-4\.1|gpt-5|claude|gemini/i,
      capabilities: { vision: true }
    },
    // Tool calling: recent families trained for function calling.
    {
      pattern:
        /qwen[23]|qwq|llama3\.[1-3]|llama4|mistral|mixtral|ministral|magistral|devstral|gpt-oss|deepseek-v3|deepseek-r1|kimi-k2|glm-4|command-r|granite3|granite4|hermes3|firefunction|nemotron|phi4-mini|smollm2|gemma4|gpt-4|gpt-5|claude|gemini/i,
      capabilities: { tools: true }
    },
    // Reasoning output (thinking).
    {
      pattern:
        /gpt-oss|deepseek-r1|deepseek-v3\.[12]|qwen3|qwq|magistral|kimi-k2-thinking|glm-4\.[5-9]|phi4-reasoning|cogito/i,
      capabilities: { thinking: true }
    }
  ]

/** Capabilities guessed from the model name (missing flags = unknown/false). */
export function capabilitiesFromHints(modelId: string): ModelCapabilities {
  const caps: ModelCapabilities = {}
  for (const hint of CAPABILITY_HINTS) {
    if (hint.pattern.test(modelId)) Object.assign(caps, hint.capabilities)
  }
  return caps
}

/** Maps Ollama /api/show `capabilities` (["completion", "tools", "vision", "thinking", ...]). */
export function capabilitiesFromOllama(list: readonly string[]): ModelCapabilities {
  return {
    vision: list.includes('vision'),
    tools: list.includes('tools'),
    thinking: list.includes('thinking')
  }
}
