(function () {
  'use strict'

  const elapsed = document.querySelector('#elapsed')
  const frameCount = document.querySelector('#frame-count')
  const fps = document.querySelector('#fps')
  const toggleMotion = document.querySelector('#toggle-motion')
  const toggleFreeze = document.querySelector('#toggle-freeze')
  const motionState = document.querySelector('#motion-state')
  const viewportSize = document.querySelector('#viewport-size')
  const tracks = Array.from(document.querySelectorAll('.track'))

  if (!elapsed || !frameCount || !fps || !toggleMotion || !toggleFreeze || !motionState || !viewportSize) {
    throw new Error('Recording quality page is missing required controls')
  }

  const startedAt = performance.now()
  let frames = 0
  let sampleStartedAt = startedAt
  let sampleFrames = 0
  let animationFrameId = null
  let frozen = false
  let pendingLayoutUpdate = false

  function pad(value, size) {
    return String(value).padStart(size, '0')
  }

  function formatElapsed(milliseconds) {
    const hours = Math.floor(milliseconds / 3_600_000)
    const minutes = Math.floor((milliseconds % 3_600_000) / 60_000)
    const seconds = Math.floor((milliseconds % 60_000) / 1_000)
    const remainder = Math.floor(milliseconds % 1_000)
    return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}.${pad(remainder, 3)}`
  }

  function updateTrackWidths() {
    if (frozen) {
      pendingLayoutUpdate = true
      return
    }
    for (const track of tracks) {
      track.style.setProperty('--track-width', `${track.clientWidth}px`)
    }
    viewportSize.textContent = `Viewport ${window.innerWidth} × ${window.innerHeight}`
    pendingLayoutUpdate = false
  }

  function scheduleRender() {
    if (frozen || animationFrameId !== null) return
    animationFrameId = requestAnimationFrame(render)
  }

  function render(now) {
    animationFrameId = null
    if (frozen) return

    frames += 1
    sampleFrames += 1
    elapsed.textContent = formatElapsed(now - startedAt)
    frameCount.textContent = frames.toLocaleString('en-US')

    const sampleDuration = now - sampleStartedAt
    if (sampleDuration >= 500) {
      fps.textContent = ((sampleFrames * 1_000) / sampleDuration).toFixed(1)
      sampleStartedAt = now
      sampleFrames = 0
    }

    scheduleRender()
  }

  function renderMotionState() {
    if (frozen) {
      motionState.textContent = 'FROZEN'
      return
    }
    motionState.textContent = document.body.dataset.motion === 'paused' ? 'PAUSED' : 'RUNNING'
  }

  toggleMotion.addEventListener('click', function () {
    const paused = document.body.dataset.motion !== 'paused'
    document.body.dataset.motion = paused ? 'paused' : 'running'
    toggleMotion.setAttribute('aria-pressed', String(paused))
    toggleMotion.textContent = paused ? '继续动画' : '暂停动画'
    renderMotionState()
  })

  toggleFreeze.addEventListener('click', function () {
    frozen = !frozen
    document.body.dataset.frozen = String(frozen)
    toggleFreeze.setAttribute('aria-pressed', String(frozen))
    toggleFreeze.textContent = frozen ? '解除冻结' : '冻结画面'
    toggleMotion.disabled = frozen
    renderMotionState()

    if (frozen) {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId)
        animationFrameId = null
      }
      return
    }

    // The elapsed clock is wall time. It therefore jumps forward by the real
    // frozen interval instead of resuming from a stale value or moving back.
    const resumedAt = performance.now()
    elapsed.textContent = formatElapsed(resumedAt - startedAt)
    sampleStartedAt = resumedAt
    sampleFrames = 0
    fps.textContent = '0.0'
    if (pendingLayoutUpdate) updateTrackWidths()
    scheduleRender()
  })

  window.addEventListener('resize', updateTrackWidths)
  updateTrackWidths()
  scheduleRender()
})()
