import { build } from 'vite'
import { createReleaseBuildPolicy, isDebugLoggingBuild } from './release-build-policy.mjs'

// Build src/extensions/offscreen.ts into build/offscreen.js for the offscreen.html page
// Use IIFE so offscreen.html can include it without type="module"
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
        input: 'src/extensions/offscreen-main.ts',
        output: {
          banner: policy.rollupBanner,
          format: 'iife',
          entryFileNames: 'offscreen.js',
          inlineDynamicImports: true,
        }
      }
    }
  })
}

main().catch((err) => {
  console.error('[build-offscreen] failed:', err)
  process.exit(1)
})
