import { build } from 'vite'
import { createReleaseBuildPolicy, isDebugLoggingBuild } from './release-build-policy.mjs'

// Build src/extensions/encoder-worker.ts into build/encoder-worker.js as a classic worker script (IIFE)

async function main() {
  const policy = createReleaseBuildPolicy({ debugLogs: isDebugLoggingBuild() })
  await build({
    configFile: false,
    plugins: [],
    define: policy.define,
    esbuild: policy.esbuild,
    build: {
      outDir: 'build',
      emptyOutDir: false,
      target: 'es2020',
      minify: policy.minify,
      sourcemap: false,
      rollupOptions: {
        input: 'src/extensions/encoder-worker.ts',
        output: {
          banner: policy.rollupBanner,
          format: 'iife',
          entryFileNames: 'encoder-worker.js',
          inlineDynamicImports: true,
        }
      }
    }
  })
}

main().catch((err) => {
  console.error('[build-worker] failed:', err)
  process.exit(1)
})
