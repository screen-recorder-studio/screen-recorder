import { fileURLToPath } from 'node:url'

export default {
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL('../../packages/extension/src/lib', import.meta.url)),
      mediabunny: fileURLToPath(new URL(
        '../../packages/extension/node_modules/mediabunny/dist/modules/src/index.js',
        import.meta.url
      ))
    }
  }
}
