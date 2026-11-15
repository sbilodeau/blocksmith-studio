import { z } from 'zod'

export const LANGUAGES = ['en', 'fr'] as const
export const THEMES = ['system', 'light', 'dark'] as const

export const LanguageSchema = z.enum(LANGUAGES)
export const ThemeSchema = z.enum(THEMES)

export type Language = z.infer<typeof LanguageSchema>
export type Theme = z.infer<typeof ThemeSchema>

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
  allowMojangDownload: z.boolean().default(false)
})

export type Settings = z.infer<typeof SettingsSchema>

/** Partial update accepted from the renderer. Unknown keys are rejected. */
export const SettingsPatchSchema = z
  .object({
    language: LanguageSchema.optional(),
    theme: ThemeSchema.optional(),
    updates: z.object({ autoCheck: z.boolean().optional() }).strict().optional(),
    allowMojangDownload: z.boolean().optional()
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
    updates: { ...current.updates, ...(patch.updates ?? {}) }
  })
}
