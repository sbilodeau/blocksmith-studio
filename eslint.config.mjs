import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginVue from 'eslint-plugin-vue'
import vueI18n from '@intlify/eslint-plugin-vue-i18n'
import vueParser from 'vue-eslint-parser'

export default defineConfig(
  {
    ignores: [
      '**/node_modules',
      '**/dist',
      '**/out',
      '**/release',
      'coverage',
      'test-results',
      'playwright-report',
      '.worktrees',
      '.claude'
    ]
  },
  tseslint.configs.recommended,
  eslintPluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        extraFileExtensions: ['.vue'],
        parser: tseslint.parser
      }
    }
  },
  {
    files: ['**/*.{ts,mts,tsx,vue}'],
    rules: {
      'vue/require-default-prop': 'off',
      'vue/multi-word-component-names': 'off',
      'vue/block-lang': ['error', { script: { lang: 'ts' } }]
    }
  },
  // i18n: no hard-coded UI text in components; every key used must exist in the locale files.
  // Node scripts (.mjs) document their types with JSDoc instead of TypeScript annotations.
  {
    files: ['**/*.{js,mjs,cjs}'],
    rules: { '@typescript-eslint/explicit-function-return-type': 'off' }
  },
  // Only the plugin registration and its recommended rules; the plugin's JSON/YAML parser setups are not needed.
  {
    files: ['src/renderer/**/*.{vue,ts}'],
    plugins: { '@intlify/vue-i18n': vueI18n },
    rules: vueI18n.configs['flat/recommended'].find(
      (c) => c.name === '@intlify/vue-i18n:recommended:rules'
    ).rules
  },
  {
    files: ['src/renderer/**/*.{vue,ts}'],
    settings: {
      'vue-i18n': {
        localeDir: './src/shared/locales/*.json',
        messageSyntaxVersion: '^11.0.0'
      }
    },
    rules: {
      '@intlify/vue-i18n/no-raw-text': ['error', { ignorePattern: '^[-#:()&%/.,\\s\\d]+$' }],
      '@intlify/vue-i18n/no-missing-keys': 'error',
      '@intlify/vue-i18n/no-dynamic-keys': 'off',
      '@intlify/vue-i18n/no-unused-keys': 'off'
    }
  },
  eslintConfigPrettier
)
