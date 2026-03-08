import { build } from 'vite'

// Build src/extensions/offscreen.ts into build/offscreen.js for the offscreen.html page
// Use IIFE so offscreen.html can include it without type="module"
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
        input: 'src/extensions/offscreen-main.ts',
        output: {
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

