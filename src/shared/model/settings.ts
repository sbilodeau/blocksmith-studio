import { z } from 'zod'

export const LANGUAGES = ['en', 'fr'] as const
export const THEMES = ['system', 'light', 'dark'] as const

export const LanguageSchema = z.enum(LANGUAGES)
export const ThemeSchema = z.enum(THEMES)

export type Language = z.infer<typeof LanguageSchema>
export type Theme = z.infer<typeof ThemeSchema>

export const ProviderConfigSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
    kind: z.enum(['ollama', 'openai-compatible']),
    label: z.string().min(1).max(60),
    baseUrl: z.url({ protocol: /^https?$/ }),
    enabled: z.boolean().default(true),
    extraHeaders: z.record(z.string(), z.string()).optional()
  })
  .strict()

export const ModelRefSchema = z.object({ providerId: z.string(), modelId: z.string() }).strict()

/** Reasoning level asked of thinking models. 'off' disables it (thinking models think by default). */
export const ReasoningLevelSchema = z.enum(['off', 'low', 'medium', 'high'])

/** Settings saved before levels existed stored a boolean: true -> 'medium', false -> 'off'. */
const ThinkingSettingSchema = z.preprocess(
  (v) => (v === true ? 'medium' : v === false ? 'off' : v),
  ReasoningLevelSchema
)

export const AgentSettingsSchema = z.object({
  model: ModelRefSchema.optional(),
  thinking: ThinkingSettingSchema.default('off'),
  maxIterations: z.number().int().min(1).max(20).default(6),
  imageMode: z.enum(['vision+grid', 'grid', 'image']).default('vision+grid')
})

/** Ollama Cloud (native API) is the default provider. The key is stored separately, encrypted. */
export const DEFAULT_PROVIDERS = [
  {
    id: 'ollama-cloud',
    kind: 'ollama',
    label: 'Ollama Cloud',
    baseUrl: 'https://ollama.com',
    enabled: true
  }
] as const

const AiSettingsSchema = z
  .object({
    providers: z
      .array(ProviderConfigSchema)
      .default(() => DEFAULT_PROVIDERS.map((p) => ({ ...p }))),
    agents: z
      .object({
        creation: AgentSettingsSchema.prefault({}),
        navigation: AgentSettingsSchema.prefault({}),
        editor: AgentSettingsSchema.prefault({})
      })
      .prefault({})
  })
  .prefault({})

/** Persisted app settings (userData/settings.json). Never contains secrets. */
export const SettingsSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  language: LanguageSchema.default('en'),
  theme: ThemeSchema.default('system'),
  updates: z
    .object({
      autoCheck: z.boolean().default(true)
    })
    .prefault({}),
  /** Folder that holds the packs. Unset = default (~/Documents/Blocksmith Studio). */
  workspacePath: z.string().optional(),
  /** Extra Minecraft folders or jars added by hand (auto-detected launchers are not stored). */
  minecraftPaths: z.array(z.string()).default([]),
  /** User agreed to download client jars from Mojang when a version is missing locally. */
  allowMojangDownload: z.boolean().default(false),
  /** AI providers (no keys) and per-agent defaults. */
  ai: AiSettingsSchema
})

export type Settings = z.infer<typeof SettingsSchema>

/** Partial update accepted from the renderer. Unknown keys are rejected. */
export const SettingsPatchSchema = z
  .object({
    language: LanguageSchema.optional(),
    theme: ThemeSchema.optional(),
    updates: z.object({ autoCheck: z.boolean().optional() }).strict().optional(),
    allowMojangDownload: z.boolean().optional(),
    /** Per-agent defaults (providers are changed through the ai.providers.* channels). */
    aiAgents: z
      .object({
        creation: AgentSettingsSchema.partial().optional(),
        navigation: AgentSettingsSchema.partial().optional(),
        editor: AgentSettingsSchema.partial().optional()
      })
      .strict()
      .optional()
  })
  .strict()

export type SettingsPatch = z.infer<typeof SettingsPatchSchema>

export function defaultSettings(): Settings {
  return SettingsSchema.parse({})
}

/** Applies a validated patch to settings and returns a new, re-validated object. */
export function applySettingsPatch(current: Settings, patch: SettingsPatch): Settings {
  return SettingsSchema.parse({
    ...current,
    ...(patch.language !== undefined ? { language: patch.language } : {}),
    ...(patch.theme !== undefined ? { theme: patch.theme } : {}),
    ...(patch.allowMojangDownload !== undefined
      ? { allowMojangDownload: patch.allowMojangDownload }
      : {}),
    updates: { ...current.updates, ...(patch.updates ?? {}) },
    ai: {
      ...current.ai,
      agents: {
        creation: { ...current.ai.agents.creation, ...(patch.aiAgents?.creation ?? {}) },
        navigation: { ...current.ai.agents.navigation, ...(patch.aiAgents?.navigation ?? {}) },
        editor: { ...current.ai.agents.editor, ...(patch.aiAgents?.editor ?? {}) }
      }
    }
  })
}
