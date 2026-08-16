<script lang="ts">
  import { onMount } from 'svelte'
  import { _t as t } from '$lib/utils/i18n'

  let seconds = $state(3)
  let operationId = $state('')

  function applyCountdown(value: unknown, incomingOperationId?: unknown) {
    if (incomingOperationId && operationId && incomingOperationId !== operationId) return
    if (typeof value !== 'number' || !Number.isFinite(value)) return
    seconds = Math.max(0, Math.floor(value))
  }

  onMount(() => {
    try {
      const url = new URL(window.location.href)
      operationId = url.searchParams.get('operationId') || ''
      applyCountdown(Number(url.searchParams.get('seconds')))
    } catch {}

    const handler = (message: any) => {
      if (message?.type === 'STREAM_META' && message?.meta?.preparing) {
        applyCountdown(message.meta.countdown, message.operationId)
      }
      if (message?.type === 'RECORDING_SESSION_UPDATED') {
        const state = message.state
        if (state?.operationId === operationId && state.phase === 'countdown') {
          applyCountdown(state.countdownRemaining, state.operationId)
        }
      }
    }
    chrome.runtime.onMessage.addListener(handler)

    chrome.runtime.sendMessage({ type: 'REQUEST_RECORDING_SESSION' })
      .then((response) => {
        const state = response?.state
        if (state?.operationId === operationId && state.phase === 'countdown') {
          applyCountdown(state.countdownRemaining, state.operationId)
        }
      })
      .catch(() => {})

    return () => chrome.runtime.onMessage.removeListener(handler)
  })
</script>

<svelte:head>
  <title>{t('control_countdownLabel')}</title>
</svelte:head>

<main aria-live="assertive" aria-atomic="true">
  <div class="halo" aria-hidden="true"></div>
  <p>{t('control_overlayRecordingStarts')}</p>
  <strong>{seconds}</strong>
  <span>{t('control_btnStarting', String(seconds))}</span>
</main>

<style>
  :global(html, body) {
    width: 100%;
    height: 100%;
    margin: 0;
    overflow: hidden;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #090f1f;
  }

  main {
    position: relative;
    display: grid;
    width: 100%;
    height: 100%;
    place-content: center;
    justify-items: center;
    color: white;
    background:
      radial-gradient(circle at 50% 38%, rgb(59 130 246 / 32%), transparent 48%),
      linear-gradient(145deg, #111a32, #070b15);
    user-select: none;
  }

  .halo {
    position: absolute;
    width: 180px;
    height: 180px;
    border: 2px solid rgb(96 165 250 / 55%);
    border-radius: 999px;
    box-shadow: 0 0 60px rgb(59 130 246 / 28%);
    animation: breathe 1s ease-in-out infinite;
  }

  p,
  span {
    z-index: 1;
    margin: 0;
    color: #cbd5e1;
    text-align: center;
  }

  p {
    margin-bottom: 4px;
    font-size: 15px;
    font-weight: 600;
  }

  strong {
    z-index: 1;
    min-width: 1.2em;
    font-size: 112px;
    font-weight: 800;
    line-height: 1.25;
    text-align: center;
    text-shadow: 0 10px 36px rgb(0 0 0 / 35%);
  }

  span {
    font-size: 13px;
  }

  @keyframes breathe {
    0%, 100% { transform: scale(.92); opacity: .55; }
    50% { transform: scale(1.04); opacity: 1; }
  }

  @media (prefers-reduced-motion: reduce) {
    .halo { animation: none; }
  }
</style>
