import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL('../../packages/extension/src/lib', import.meta.url)),
      mediabunny: fileURLToPath(new URL(
        '../../packages/extension/node_modules/mediabunny/dist/modules/src/index.js',
        import.meta.url
      ))
    }
  },
  server: { fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] } }
})
