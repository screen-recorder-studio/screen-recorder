import { build } from 'vite'

// Build src/extensions/content.ts into build/content.js as a standalone IIFE
// - Ignores the root vite.config.ts (configFile:false) to avoid SvelteKit plugins
// - Does not empty the build dir (so the main app build remains intact)
// - Output file name/content script path expected by background.js: 'content.js'

async function main() {
  await build({
    configFile: false,
    plugins: [],
    build: {
      outDir: 'build',
      emptyOutDir: false,
      target: 'es2020',
      minify: false,
      sourcemap: false,
      rollupOptions: {
        input: 'src/extensions/content.ts',
        output: {
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

