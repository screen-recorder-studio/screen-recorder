import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const suiteDir = path.dirname(fileURLToPath(import.meta.url))
const requiredFiles = [
  'README.md',
  'USER-STORIES.md',
  'IMPLEMENTATION-ASSESSMENT.md',
  'COVERAGE-MATRIX.md',
  'TEST-CASES.md',
  'TEST-DATA-AND-ENVIRONMENTS.md',
  'RELEASE-RUNBOOK.md',
  'EXECUTION-REPORT-TEMPLATE.md',
  'CASE-CATALOG.json'
]

const contents = Object.fromEntries(await Promise.all(requiredFiles.map(async (name) => {
  const content = await readFile(path.join(suiteDir, name), 'utf8')
  return [name, content]
})))

const catalog = JSON.parse(contents['CASE-CATALOG.json'])
const failures = []
const validPriorities = new Set(['P0', 'P1', 'P2'])
const validCadences = new Set(['smoke', 'full', 'extended'])
const validExecutions = new Set(['automated', 'assisted', 'manual'])
const validImplementation = new Set(['implemented', 'partial', 'planned'])

if (catalog.schemaVersion !== 1) failures.push('schemaVersion must be 1')
if (catalog.suite !== 'extension-release-e2e') failures.push('unexpected suite name')
if (!Array.isArray(catalog.stories) || catalog.stories.length === 0) failures.push('stories must be non-empty')
if (!Array.isArray(catalog.cases) || catalog.cases.length === 0) failures.push('cases must be non-empty')

const duplicateValues = (values) => values.filter((value, index) => values.indexOf(value) !== index)
const storyIds = catalog.stories.map((story) => story.id)
const caseIds = catalog.cases.map((testCase) => testCase.id)
const storyIdSet = new Set(storyIds)

for (const duplicate of new Set(duplicateValues(storyIds))) failures.push(`duplicate story id: ${duplicate}`)
for (const duplicate of new Set(duplicateValues(caseIds))) failures.push(`duplicate case id: ${duplicate}`)

for (const story of catalog.stories) {
  if (!/^US-\d{2}$/.test(story.id)) failures.push(`invalid story id: ${story.id}`)
  if (!story.title?.trim()) failures.push(`story title missing: ${story.id}`)
  if (!validPriorities.has(story.priority)) failures.push(`invalid story priority: ${story.id}`)
  if (!validImplementation.has(story.implementation)) failures.push(`invalid implementation status: ${story.id}`)
  if (!contents['USER-STORIES.md'].includes(`### ${story.id} `)) failures.push(`story missing from USER-STORIES.md: ${story.id}`)
}

for (const testCase of catalog.cases) {
  if (!/^[A-Z][A-Z0-9]*-\d{3}$/.test(testCase.id)) failures.push(`invalid case id: ${testCase.id}`)
  if (!testCase.title?.trim()) failures.push(`case title missing: ${testCase.id}`)
  if (!validPriorities.has(testCase.priority)) failures.push(`invalid case priority: ${testCase.id}`)
  if (!validExecutions.has(testCase.execution)) failures.push(`invalid execution type: ${testCase.id}`)
  if (!Array.isArray(testCase.storyIds) || testCase.storyIds.length === 0) failures.push(`storyIds missing: ${testCase.id}`)
  if (!Array.isArray(testCase.cadence) || testCase.cadence.length === 0) failures.push(`cadence missing: ${testCase.id}`)
  if (!Array.isArray(testCase.environments) || testCase.environments.length === 0) failures.push(`environments missing: ${testCase.id}`)
  if (!Array.isArray(testCase.data) || testCase.data.length === 0) failures.push(`data missing: ${testCase.id}`)
  for (const storyId of testCase.storyIds ?? []) {
    if (!storyIdSet.has(storyId)) failures.push(`unknown story ${storyId} in ${testCase.id}`)
  }
  for (const cadence of testCase.cadence ?? []) {
    if (!validCadences.has(cadence)) failures.push(`invalid cadence ${cadence} in ${testCase.id}`)
  }
  if (!contents['TEST-CASES.md'].includes(`### ${testCase.id} `)) failures.push(`case missing from TEST-CASES.md: ${testCase.id}`)
}

for (const story of catalog.stories) {
  const linked = catalog.cases.filter((testCase) => testCase.storyIds.includes(story.id))
  if (linked.length === 0) failures.push(`story has no test cases: ${story.id}`)
  if (story.priority === 'P0') {
    const hasP0Smoke = linked.some((testCase) => testCase.priority === 'P0' && testCase.cadence.includes('smoke'))
    if (!hasP0Smoke) failures.push(`P0 story lacks a P0 smoke case: ${story.id}`)
  }
}

const documentedCaseIds = [...contents['TEST-CASES.md'].matchAll(/^### ([A-Z][A-Z0-9]*-\d{3})\s/gm)].map((match) => match[1])
for (const documented of documentedCaseIds) {
  if (!caseIds.includes(documented)) failures.push(`documented case missing from catalog: ${documented}`)
}

if (failures.length > 0) {
  console.error(`E2E suite validation failed (${failures.length})`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

const counts = catalog.cases.reduce((result, testCase) => {
  result[testCase.priority] = (result[testCase.priority] ?? 0) + 1
  return result
}, {})

console.log(`E2E suite valid: ${catalog.stories.length} stories, ${catalog.cases.length} cases`)
console.log(`Priorities: P0=${counts.P0 ?? 0}, P1=${counts.P1 ?? 0}, P2=${counts.P2 ?? 0}`)
console.log(`Smoke cases: ${catalog.cases.filter((testCase) => testCase.cadence.includes('smoke')).length}`)
