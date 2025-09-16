import { build } from 'vite'

// Build src/lib/workers/opfs-writer-worker.ts into build/opfs-writer-worker.js as a module worker
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
        input: 'src/lib/workers/opfs-writer-worker.ts',
        output: {
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

