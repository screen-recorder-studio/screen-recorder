import { build } from 'vite'
import { createReleaseBuildPolicy, isDebugLoggingBuild } from './release-build-policy.mjs'

// Build src/extensions/opfs-writer.ts into build/opfs-writer.js as an ES module (for opfs-writer.html)
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
        input: 'src/extensions/opfs-writer.ts',
        output: {
          banner: policy.rollupBanner,
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
