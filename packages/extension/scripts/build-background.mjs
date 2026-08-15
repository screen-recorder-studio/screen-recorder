import { build } from 'vite'
import { createReleaseBuildPolicy, isDebugLoggingBuild } from './release-build-policy.mjs'

// Build src/extensions/background.ts into build/background.js as an ES module
// Chrome manifest sets background.type = 'module'

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
        input: 'src/extensions/background.ts',
        output: {
          banner: policy.rollupBanner,
          format: 'es',
          entryFileNames: 'background.js',
          inlineDynamicImports: true,
        }
      }
    }
  })
}

main().catch((err) => {
  console.error('[build-background] failed:', err)
  process.exit(1)
})
