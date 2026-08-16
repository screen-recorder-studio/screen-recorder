import { build } from 'vite'
import { createReleaseBuildPolicy, isDebugLoggingBuild } from './release-build-policy.mjs'

// Build src/extensions/content.ts into build/content.js as a standalone IIFE
// - Ignores the root vite.config.ts (configFile:false) to avoid SvelteKit plugins
// - Does not empty the build dir (so the main app build remains intact)
// - Output file name/content script path expected by background.js: 'content.js'

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
        input: 'src/extensions/content.ts',
        output: {
          banner: policy.rollupBanner,
          format: 'iife',
          entryFileNames: 'content.js',
          inlineDynamicImports: true,
        }
      }
    }
  })
}

main().catch((err) => {
  console.error('[build-content] failed:', err)
  process.exit(1)
})
