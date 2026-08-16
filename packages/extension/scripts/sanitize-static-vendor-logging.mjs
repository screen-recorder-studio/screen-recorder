import { readFile, writeFile } from 'node:fs/promises'
import { transform } from 'esbuild'
import { createReleaseBuildPolicy } from './release-build-policy.mjs'

const gifLibrary = new URL('../build/gif/gif.js', import.meta.url)
const original = await readFile(gifLibrary, 'utf8')
const policy = createReleaseBuildPolicy({ debugLogs: false })
const originalCalls = original.match(/\bconsole\s*\./g)?.length ?? 0

if (originalCalls !== 4) {
  throw new Error(`Expected exactly 4 console references in build/gif/gif.js, found ${originalCalls}`)
}

const { code } = await transform(original, {
  loader: 'js',
  minify: true,
  define: policy.define,
  pure: policy.esbuild?.pure,
  drop: policy.esbuild?.drop,
  banner: policy.rollupBanner
})

// A second parse catches malformed vendor output before packaging.
await transform(code, { loader: 'js' })
await writeFile(gifLibrary, code)
