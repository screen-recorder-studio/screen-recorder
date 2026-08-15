import { build } from 'vite'
import { createReleaseBuildPolicy, isDebugLoggingBuild } from './release-build-policy.mjs'

// Build src/lib/workers/opfs-writer-worker.ts into build/opfs-writer-worker.js as a module worker
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
        input: 'src/lib/workers/opfs-writer-worker.ts',
        output: {
          banner: policy.rollupBanner,
          format: 'es',
          entryFileNames: 'opfs-writer-worker.js',
          inlineDynamicImports: true,
        }
      }
    }
  })
}

main().catch((err) => {
  console.error('[build-opfs-writer] failed:', err)
  process.exit(1)
})
