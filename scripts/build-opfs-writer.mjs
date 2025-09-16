import { build } from 'vite'

// Build src/extensions/opfs-writer.ts into build/opfs-writer.js as an ES module (for opfs-writer.html)
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
        input: 'src/extensions/opfs-writer.ts',
        output: {
          format: 'es',
          entryFileNames: 'opfs-writer.js',
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

