import { build } from 'vite'

// Build src/extensions/encoder-worker.ts into build/encoder-worker.js as a classic worker script (IIFE)

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
        input: 'src/extensions/encoder-worker.ts',
        output: {
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

