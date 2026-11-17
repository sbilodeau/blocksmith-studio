import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

const root = dirname(fileURLToPath(import.meta.url))

const alias = {
  '@shared': resolve(root, 'src/shared'),
  '@renderer': resolve(root, 'src/renderer')
}

// The live AI evaluation reads its key and options from the environment or .env.local (never committed).
const aiEnv = Object.fromEntries(
  Object.entries(loadEnv('test', root, ['OLLAMA_API_KEY', 'BLOCKSMITH_EVAL_'])).filter(
    ([k]) => k === 'OLLAMA_API_KEY' || k.startsWith('BLOCKSMITH_EVAL_')
  )
)

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts']
        }
      },
      {
        plugins: [vue()],
        resolve: { alias },
        test: {
          name: 'component',
          environment: 'happy-dom',
          include: ['tests/component/**/*.test.ts'],
          setupFiles: ['tests/component/setup.ts']
        }
      },
      {
        resolve: { alias },
        test: {
          name: 'real-jar',
          environment: 'node',
          include: ['tests/real-jar/**/*.test.ts'],
          env: Object.fromEntries(
            Object.entries(process.env).filter(([k]) => k.startsWith('BLOCKSMITH_REAL_JAR'))
          ) as Record<string, string>
        }
      },
      {
        resolve: { alias },
        test: {
          name: 'perf',
          environment: 'node',
          include: ['tests/perf/**/*.test.ts'],
          env: Object.fromEntries(
            Object.entries(process.env).filter(([k]) => k.startsWith('BLOCKSMITH_PERF'))
          ) as Record<string, string>
        }
      },
      {
        resolve: { alias },
        test: {
          name: 'ai-eval',
          environment: 'node',
          include: ['tests/ai-eval/**/*.test.ts'],
          env: aiEnv
        }
      }
    ]
  }
})
