import { build } from 'vite'

// Build src/extensions/offscreen.ts into build/offscreen.js as an ES module (for offscreen.html)
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
        input: 'src/extensions/offscreen.ts',
        output: {
          format: 'es',
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

