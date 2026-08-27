import {
  createGifLabContract,
  listGifLabCases,
  normalizeGifLabSeed,
  resolveGifLabCase,
  type GifLabCaseId
} from './lab-contract'
import { createSceneSnapshot, type GifLabSceneSnapshot } from './scene-model'

declare global {
  interface Window {
    __GIF_LAB__: ReturnType<typeof buildPublicApi>
  }
}

const $ = <T extends HTMLElement>(selector: string) => {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error(`GIF Lab element missing: ${selector}`)
  return element
}

const params = new URLSearchParams(location.search)
let definition = resolveGifLabCase(params.get('case'))
let seed = normalizeGifLabSeed(params.get('seed'))
let running = params.get('autoplay') === '1'
let startedAt = performance.now()
let pausedElapsedMs = 0
let lastVisualKey = ''
let lifecycleOffset = false
let metadataRefreshRaf: number | null = null

const scene = $('#scene')
const target = $('#capture-target')
const caseSelect = $<HTMLSelectElement>('#case-select')
const seedInput = $<HTMLInputElement>('#seed-input')
const resetButton = $<HTMLButtonElement>('#reset-button')
const pauseButton = $<HTMLButtonElement>('#pause-button')
const scrollButton = $<HTMLButtonElement>('#scroll-button')
const runStatus = $<HTMLOutputElement>('#run-status')
const caseLabel = $('#case-label')
const phaseLabel = $('#phase-label')
const frameLabel = $('#frame-label')
const timeLabel = $('#time-label')
const contractOutput = $('#contract-output')
const caseSummary = $('#case-summary')
const readyChip = $('#ready-chip')
const motionChip = $('#motion-chip')
const environmentChip = $('#environment-chip')
const motionBanner = $('#motion-banner')
const scenarioCards = $('#scenario-cards')

for (const item of listGifLabCases()) {
  const option = document.createElement('option')
  option.value = item.id
  option.textContent = `${item.label} · ${item.id}`
  option.selected = item.id === definition.id
  caseSelect.append(option)
}
seedInput.value = String(seed)

caseSelect.addEventListener('change', () => updateLocation(caseSelect.value as GifLabCaseId, seed))
seedInput.addEventListener('change', () => updateLocation(definition.id, normalizeGifLabSeed(seedInput.value)))
resetButton.addEventListener('click', resetAndRun)
pauseButton.addEventListener('click', toggleRunning)
scrollButton.addEventListener('click', () => {
  lifecycleOffset = !lifecycleOffset
  document.body.classList.toggle('lifecycle-offset', lifecycleOffset)
  target.scrollIntoView({ block: lifecycleOffset ? 'start' : 'center', behavior: 'instant' })
  scrollButton.textContent = lifecycleOffset ? 'Restore page height' : 'Scroll target into view'
})
window.addEventListener('resize', scheduleFixtureMetadataRefresh)
window.addEventListener('scroll', scheduleFixtureMetadataRefresh, { passive: true })

document.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return
  if (event.key.toLowerCase() === 'r') {
    event.preventDefault()
    resetAndRun()
  } else if (event.code === 'Space') {
    event.preventDefault()
    toggleRunning()
  }
})

function resetAndRun() {
  pausedElapsedMs = 0
  startedAt = performance.now()
  running = true
  lastVisualKey = ''
  updateControlLabels()
}

function toggleRunning() {
  if (running) {
    pausedElapsedMs = currentElapsedMs()
    running = false
  } else {
    startedAt = performance.now() - pausedElapsedMs
    running = true
  }
  updateControlLabels()
}

function currentElapsedMs(now = performance.now()) {
  return running ? Math.max(0, now - startedAt) : pausedElapsedMs
}

function tick(now: number) {
  const snapshot = createSceneSnapshot(definition.id, seed, currentElapsedMs(now))
  if (snapshot.visualKey !== lastVisualKey) {
    render(snapshot)
    lastVisualKey = snapshot.visualKey
  }
  updateLiveStatus(snapshot)
  requestAnimationFrame(tick)
}

function render(snapshot: GifLabSceneSnapshot) {
  caseLabel.textContent = snapshot.caseId.toUpperCase()
  phaseLabel.textContent = snapshot.phaseId.toUpperCase()
  frameLabel.textContent = `F${String(snapshot.frameNumber).padStart(4, '0')}`
  timeLabel.textContent = formatTime(snapshot.elapsedMs)
  target.dataset.case = snapshot.caseId
  target.dataset.phase = snapshot.phaseId
  target.dataset.frame = String(snapshot.frameNumber)

  switch (snapshot.phaseId) {
    case 'geometry': renderGeometry(); break
    case 'cadence': renderCadence(snapshot); break
    case 'palette': renderPalette(snapshot); break
    case 'edit-motion': renderEditMotion(snapshot); break
    case 'edm': renderEdm(snapshot); break
    case 'lifecycle': renderLifecycle(); break
    case 'intro':
    case 'changed':
    case 'hold': renderStaticHold(snapshot.phaseId); break
    default: renderGeometry()
  }
}

function renderGeometry() {
  scene.innerHTML = `
    <div class="scene-full geometry-scene">
      <i class="fiducial tl" data-label="0,0"></i>
      <i class="fiducial tr" data-label="640,0"></i>
      <i class="fiducial bl" data-label="0,360"></i>
      <i class="fiducial br" data-label="640,360"></i>
      <div class="center-cross"></div>
      <div class="scene-title">GEOMETRY · 640×360</div>
    </div>`
}

function renderCadence(snapshot: GifLabSceneSnapshot) {
  scene.innerHTML = `
    <div class="scene-full cadence-scene">
      <div class="cadence-clock">${String(snapshot.frameNumber).padStart(4, '0')}</div>
      <div class="cadence-sub">10 FPS FIXED VISUAL CLOCK · ${formatTime(snapshot.phaseElapsedMs)}</div>
      <div class="blink-signal ${snapshot.blinkOn ? 'on' : ''}"></div>
      <div class="motion-line"></div>
      <div class="motion-dot" style="left:${snapshot.motion.x}px"></div>
      <div class="barcode">${[...snapshot.barcode].map((bit) => `<i class="${bit === '1' ? 'on' : ''}"></i>`).join('')}</div>
    </div>`
}

function renderPalette(snapshot: GifLabSceneSnapshot) {
  scene.innerHTML = `
    <div class="scene-full palette-scene">
      ${snapshot.palette.map((color) => `<div class="palette-cell" style="background:${color}"></div>`).join('')}
      <div class="palette-overlay">PALETTE · 48 SEEDED CELLS</div>
    </div>`
}

function renderEditMotion(snapshot: GifLabSceneSnapshot) {
  scene.innerHTML = `
    <div class="scene-full edit-scene">
      <div class="edit-caption">TRACK ME · preview/export parity</div>
      <div class="edit-path"></div>
      <div class="edit-target" style="left:${snapshot.motion.x}px;top:${snapshot.motion.y}px"></div>
    </div>`
}

function renderStaticHold(phase: string) {
  const state = phase === 'intro' ? 'A' : 'B'
  scene.innerHTML = `
    <div class="scene-full hold-scene">
      <div class="hold-card ${phase}">
        <span class="state">STATE ${state}</span>
        <p>${phase === 'hold' ? 'No further DOM or visual updates for the remainder of the run.' : 'A single explicit visual transition.'}</p>
      </div>
    </div>`
}

function renderEdm(snapshot: GifLabSceneSnapshot) {
  const angle = snapshot.progress * Math.PI * 2
  const dotX = 95 + Math.cos(angle) * 70
  const dotY = 150 + Math.sin(angle) * 70
  scene.innerHTML = `
    <div class="scene-full edm-scene">
      <article class="edm-card">
        <div class="edm-copy">
          <span class="tag">Product update</span>
          <h3>Show the value.<br>Keep it moving.</h3>
          <p>The first frame carries the complete message; motion only guides attention.</p>
          <span class="cta">Explore the release →</span>
        </div>
        <div class="edm-art">
          <div class="edm-orbit"></div>
          <div class="edm-dot" style="left:${dotX}px;top:${dotY}px"></div>
        </div>
      </article>
    </div>`
}

function renderLifecycle() {
  const iframeDocument = `<!doctype html><style>body{margin:0;display:grid;place-items:center;height:100vh;color:#07111e;background:repeating-conic-gradient(#facc15 0 25%,#22d3ee 0 50%) 0/24px 24px;font:900 12px monospace}b{padding:8px;background:white}</style><b>IFRAME</b>`
  scene.innerHTML = `
    <div class="scene-full lifecycle-scene">
      <div class="lifecycle-copy">
        <h3>Lifecycle boundary</h3>
        <p>Use this case to cancel and re-select, scroll the page, change browser zoom, and resize the viewport. A source-dimension change during capture must fail closed.</p>
      </div>
      <div class="iframe-shell"><iframe title="Cross-frame visual fixture" srcdoc="${escapeAttribute(iframeDocument)}"></iframe></div>
    </div>`
}

function updateLiveStatus(snapshot: GifLabSceneSnapshot) {
  runStatus.textContent = `${running ? 'Running' : 'Paused'} at ${formatTime(snapshot.elapsedMs)} · ${snapshot.phaseId}`
  if (!running) {
    timeLabel.textContent = formatTime(snapshot.elapsedMs)
  }
}

function updateControlLabels() {
  pauseButton.innerHTML = running ? 'Pause <kbd>Space</kbd>' : 'Resume <kbd>Space</kbd>'
}

function renderFixtureMetadata() {
  const contract = createGifLabContract(definition.id, seed)
  const motion = contract.expected.motion
  const rect = target.getBoundingClientRect()
  caseSummary.innerHTML = `
    <dt>Case</dt><dd>${definition.label} · <code>${definition.id}</code></dd>
    <dt>Duration</dt><dd>${(definition.durationMs / 1000).toFixed(1)} s · ${definition.loop ? 'looping' : 'finite'}</dd>
    <dt>Motion</dt><dd>${motionLabel(motion.expectation)} · ${motion.fullFlowEligible ? 'full-flow eligible' : 'fixture-specific only'}</dd>
    <dt>Target</dt><dd>${rect.width}×${rect.height} CSS px at (${Math.round(rect.x)}, ${Math.round(rect.y)})</dd>
    <dt>Seed</dt><dd>${seed}</dd>
    <dt>Protocol</dt><dd>${motion.fullFlowEligible
      ? 'select → countdown → press R → record → stop → Studio play → GIF export'
      : 'fixture-specific check only; use cadence for motion acceptance'}</dd>`
  contractOutput.textContent = JSON.stringify(contract, null, 2)
  readyChip.textContent = 'LAB READY'
  motionChip.textContent = motionChipLabel(motion.expectation)
  motionChip.dataset.expectation = motion.expectation
  motionBanner.textContent = motionChipLabel(motion.expectation)
  motionBanner.dataset.expectation = motion.expectation
  environmentChip.textContent = `DPR ${devicePixelRatio} · ${innerWidth}×${innerHeight}`
  document.documentElement.dataset.gifLabReady = 'true'

  scenarioCards.innerHTML = listGifLabCases().map((item) => `
    <article class="scenario-card" data-active="${item.id === definition.id}">
      <strong>${item.label}</strong>
      <p>${item.description}</p>
    </article>`).join('')
}

function scheduleFixtureMetadataRefresh() {
  if (metadataRefreshRaf !== null) cancelAnimationFrame(metadataRefreshRaf)
  metadataRefreshRaf = requestAnimationFrame(() => {
    metadataRefreshRaf = null
    renderFixtureMetadata()
  })
}

function motionLabel(expectation: 'static' | 'animated' | 'mixed') {
  switch (expectation) {
    case 'animated': return 'animated motion required'
    case 'static': return 'intentionally static'
    case 'mixed': return 'mixed static and animated phases'
  }
}

function motionChipLabel(expectation: 'static' | 'animated' | 'mixed') {
  switch (expectation) {
    case 'animated': return 'MOTION REQUIRED'
    case 'static': return 'STATIC BY DESIGN'
    case 'mixed': return 'MIXED PHASES'
  }
}

function buildPublicApi() {
  const contract = createGifLabContract(definition.id, seed)
  return {
    ...contract,
    getRegion: () => {
      const rect = target.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, devicePixelRatio }
    },
    getState: () => {
      const snapshot = createSceneSnapshot(definition.id, seed, currentElapsedMs())
      return { running, ...snapshot }
    },
    reset: resetAndRun,
    play: () => { if (!running) toggleRunning() },
    pause: () => { if (running) toggleRunning() }
  }
}

function updateLocation(caseId: GifLabCaseId, nextSeed: number) {
  const next = new URL(location.href)
  next.searchParams.set('case', caseId)
  next.searchParams.set('seed', String(nextSeed))
  next.searchParams.delete('autoplay')
  location.assign(next)
}

function formatTime(ms: number): string {
  const totalTenths = Math.max(0, Math.floor(ms / 100))
  const minutes = Math.floor(totalTenths / 600)
  const seconds = Math.floor((totalTenths % 600) / 10)
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${totalTenths % 10}`
}

function escapeAttribute(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
}

renderFixtureMetadata()
updateControlLabels()
window.__GIF_LAB__ = buildPublicApi()
render(createSceneSnapshot(definition.id, seed, 0))
requestAnimationFrame(tick)
