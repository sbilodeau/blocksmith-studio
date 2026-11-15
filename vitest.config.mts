import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

const root = dirname(fileURLToPath(import.meta.url))

const alias = {
  '@shared': resolve(root, 'src/shared'),
  '@renderer': resolve(root, 'src/renderer')
}

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
      }
    ]
  }
})
