import { build } from 'vite'

// Build src/extensions/background.ts into build/background.js as an ES module
// Chrome manifest sets background.type = 'module'

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
        input: 'src/extensions/background.ts',
        output: {
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

