import { build } from 'vite'
import { createReleaseBuildPolicy, isDebugLoggingBuild } from './release-build-policy.mjs'

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
        input: 'src/extensions/area-selector.ts',
        output: {
          banner: policy.rollupBanner,
          format: 'iife',
          entryFileNames: 'area-selector.js',
          inlineDynamicImports: true
        }
      }
    }
  })
}

main().catch((error) => {
  console.error('[build-area-selector] failed:', error)
  process.exit(1)
})
