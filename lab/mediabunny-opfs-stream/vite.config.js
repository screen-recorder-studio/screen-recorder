import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      mediabunny: fileURLToPath(new URL('../../packages/extension/node_modules/mediabunny', import.meta.url))
    }
  }
})
