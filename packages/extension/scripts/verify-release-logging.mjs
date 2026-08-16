import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const buildDirectory = fileURLToPath(new URL('../build/', import.meta.url))
const consoleMethods = 'log|debug|info|trace|warn|error|time|timeEnd'
const consoleCalls = [
  new RegExp(`\\bconsole\\s*(?:\\?\\.)?\\s*\\.\\s*(?:${consoleMethods})\\s*(?:\\?\\.)?\\s*(?:\\(|\\.(?:apply|call)\\s*\\()`, 'g'),
  new RegExp(`\\bconsole\\s*(?:\\?\\.)?\\s*\\[\\s*['\"](?:${consoleMethods})['\"]\\s*\\]\\s*(?:\\?\\.)?\\s*(?:\\(|\\.(?:apply|call)\\s*\\()`, 'g')
]

async function collectJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await collectJavaScriptFiles(path))
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(path)
  }
  return files
}

const offenders = []
for (const file of await collectJavaScriptFiles(buildDirectory)) {
  const source = await readFile(file, 'utf8')
  if (consoleCalls.some(pattern => pattern.test(source))) offenders.push(file)
  for (const pattern of consoleCalls) pattern.lastIndex = 0
}

if (offenders.length > 0) {
  throw new Error(`Release bundle still contains console calls:\n${offenders.join('\n')}`)
}

console.log(`Release logging policy verified across ${await collectJavaScriptFiles(buildDirectory).then(files => files.length)} JavaScript bundles.`)
