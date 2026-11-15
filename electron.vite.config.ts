import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import type { Plugin } from 'vite'
import { buildCsp } from './src/main/security-policy'

/**
 * Injects the Content-Security-Policy meta tag. A response header alone is not enough: production loads
 * the renderer from file://, where session header hooks do not apply.
 */
function cspMetaPlugin(): Plugin {
  let isDev = false
  return {
    name: 'blocksmith-csp-meta',
    configResolved(config) {
      isDev = config.command === 'serve'
    },
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: buildCsp(isDev) },
          injectTo: 'head-prepend'
        }
      ]
    }
  }
}

const shared = resolve('src/shared')

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': shared } }
  },
  preload: {
    resolve: { alias: { '@shared': shared } }
  },
  renderer: {
    root: resolve('src/renderer'),
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer'),
        '@shared': shared
      }
    },
    build: {
      rollupOptions: { input: resolve('src/renderer/index.html') }
    },
    plugins: [vue(), cspMetaPlugin()]
  }
})
