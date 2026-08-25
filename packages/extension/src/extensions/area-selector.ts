import { MIN_AREA_EDGE_CSS_PX, type AreaRect } from '../lib/recording/area-crop'
import { resolveAreaSelectorToolbarDock } from '../lib/recording/area-selector-layout'

interface OpenAreaSelectorMessage {
  type: 'AREA_SELECTOR_OPEN'
  operationId: string
}

interface CountdownMessage {
  type: 'AREA_SELECTOR_COUNTDOWN'
  operationId: string
  remaining: number
}

interface AbortMessage {
  type: 'AREA_SELECTOR_ABORT'
  operationId: string
}

type SelectorMessage = OpenAreaSelectorMessage | CountdownMessage | AbortMessage

interface SelectorController {
  onMessage(
    message: SelectorMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void
  ): boolean | void
}

declare global {
  interface Window {
    __screenRecorderGifAreaSelectorV1__?: SelectorController
  }
}

if (!window.__screenRecorderGifAreaSelectorV1__) {
  const controller = createSelectorController()
  window.__screenRecorderGifAreaSelectorV1__ = controller
  chrome.runtime.onMessage.addListener(controller.onMessage)
}

function createSelectorController(): SelectorController {
  let host: HTMLDivElement | null = null
  let root: HTMLDivElement | null = null
  let operationId: string | null = null
  let startPoint: { x: number; y: number } | null = null
  let selectedRect: AreaRect | null = null
  let confirmed = false
  let selectionBox: HTMLDivElement | null = null
  let toolbar: HTMLDivElement | null = null
  let hint: HTMLDivElement | null = null
  let countdown: HTMLDivElement | null = null

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !operationId) return
    event.preventDefault()
    void cancelSelection()
  }

  const onRootKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' || !selectedRect || confirmed) return
    const action = (event.target as HTMLElement | null)?.closest?.('button')?.dataset.action
    if (action) return
    event.preventDefault()
    void confirmSelection()
  }

  const preventPageMotion = (event: Event) => event.preventDefault()

  function open(nextOperationId: string) {
    destroyVisuals()
    operationId = nextOperationId
    confirmed = false
    selectedRect = null

    host = document.createElement('div')
    host.id = 'screen-recorder-gif-area-selector'
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;display:block;'
    const shadow = host.attachShadow({ mode: 'closed' })
    shadow.innerHTML = `<style>${selectorStyles}</style>`
    root = document.createElement('div')
    root.className = 'selector-root'
    root.tabIndex = -1
    root.setAttribute('role', 'dialog')
    root.setAttribute('aria-modal', 'true')
    root.setAttribute('aria-label', areaText('gifArea_selectorDialogLabel'))
    root.innerHTML = `
      <div class="hint" role="status" aria-live="polite">${escapeHtml(areaText('gifArea_selectorInstruction'))}</div>
      <div class="selection" hidden>
        <span class="size"></span>
      </div>
      <div class="toolbar" data-dock="bottom" role="group" aria-label="${escapeHtml(areaText('gifArea_selectorActions'))}" hidden>
        <button type="button" data-action="reset">${escapeHtml(areaText('gifArea_selectorReset'))}</button>
        <button type="button" class="primary" data-action="confirm" aria-keyshortcuts="Enter">${escapeHtml(areaText('gifArea_selectorConfirm'))}</button>
      </div>
      <button type="button" class="cancel" data-action="cancel" aria-label="${escapeHtml(areaText('gifArea_selectorCancel'))}" title="${escapeHtml(areaText('gifArea_selectorCancel'))}"><span aria-hidden="true">×</span></button>
      <div class="countdown" role="status" aria-live="assertive" hidden></div>
    `
    shadow.append(root)
    document.documentElement.append(host)

    selectionBox = root.querySelector('.selection')
    toolbar = root.querySelector('.toolbar')
    hint = root.querySelector('.hint')
    countdown = root.querySelector('.countdown')
    root.addEventListener('pointerdown', onPointerDown)
    root.addEventListener('pointermove', onPointerMove)
    root.addEventListener('pointerup', onPointerUp)
    root.addEventListener('pointercancel', onPointerUp)
    root.addEventListener('click', onClick)
    root.addEventListener('keydown', onRootKeyDown)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('wheel', preventPageMotion, { capture: true, passive: false })
    window.addEventListener('touchmove', preventPageMotion, { capture: true, passive: false })
  }

  function onPointerDown(event: PointerEvent) {
    if (confirmed || (event.target as HTMLElement).closest('button')) return
    event.preventDefault()
    startPoint = pointInViewport(event.clientX, event.clientY)
    selectedRect = null
    root?.setPointerCapture(event.pointerId)
    setRect({ x: startPoint.x, y: startPoint.y, width: 0, height: 0 })
  }

  function onPointerMove(event: PointerEvent) {
    if (!startPoint || confirmed) return
    event.preventDefault()
    selectedRect = rectFromPoints(startPoint, pointInViewport(event.clientX, event.clientY))
    setRect(selectedRect)
  }

  function onPointerUp(event: PointerEvent) {
    if (!startPoint || confirmed) return
    event.preventDefault()
    selectedRect = rectFromPoints(startPoint, pointInViewport(event.clientX, event.clientY))
    startPoint = null
    try { root?.releasePointerCapture(event.pointerId) } catch {}

    if (selectedRect.width < MIN_AREA_EDGE_CSS_PX || selectedRect.height < MIN_AREA_EDGE_CSS_PX) {
      selectedRect = null
      selectionBox?.setAttribute('hidden', '')
      if (toolbar) toolbar.hidden = true
      if (hint) hint.textContent = areaText('gifArea_selectorMinimum', String(MIN_AREA_EDGE_CSS_PX))
      return
    }
    setRect(selectedRect, true)
    if (hint) hint.textContent = areaText('gifArea_selectorConfirmHint')
    root?.querySelector<HTMLButtonElement>('[data-action="confirm"]')?.focus({ preventScroll: true })
  }

  function onClick(event: MouseEvent) {
    const action = (event.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.action
    if (!action) return
    event.preventDefault()
    event.stopPropagation()
    if (action === 'cancel') void cancelSelection()
    if (action === 'reset') resetSelection()
    if (action === 'confirm') void confirmSelection()
  }

  function resetSelection() {
    if (confirmed) return
    selectedRect = null
    startPoint = null
    selectionBox?.setAttribute('hidden', '')
    if (toolbar) toolbar.hidden = true
    if (hint) hint.textContent = areaText('gifArea_selectorInstruction')
    root?.focus({ preventScroll: true })
  }

  async function confirmSelection() {
    if (!operationId || !selectedRect || confirmed) return
    confirmed = true
    root?.classList.add('is-confirmed')
    if (toolbar) toolbar.hidden = true
    if (hint) hint.textContent = areaText('gifArea_selectorPreparing')
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'AREA_SELECTION_CONFIRMED',
        operationId,
        selection: {
          rectCss: selectedRect,
          viewportCss: { width: window.innerWidth, height: window.innerHeight },
          devicePixelRatio: window.devicePixelRatio || 1,
          selectedAt: Date.now()
        }
      })
      if (response?.ok !== true) throw new Error(response?.error || '无法开始区域录制')
    } catch (error) {
      confirmed = false
      root?.classList.remove('is-confirmed')
      if (toolbar) toolbar.hidden = false
      root?.querySelector<HTMLButtonElement>('[data-action="confirm"]')?.focus({ preventScroll: true })
      if (hint) hint.textContent = error instanceof Error ? error.message : areaText('gifArea_selectorStartFailed')
    }
  }

  async function cancelSelection() {
    const activeOperationId = operationId
    destroyVisuals()
    if (!activeOperationId) return
    try {
      await chrome.runtime.sendMessage({
        type: 'AREA_SELECTION_CANCELLED',
        operationId: activeOperationId
      })
    } catch {}
  }

  function showCountdown(remaining: number) {
    if (!countdown) return
    const safeRemaining = Math.max(0, Math.floor(remaining))
    if (safeRemaining <= 0) {
      destroyVisuals()
      return
    }
    countdown.hidden = false
    countdown.textContent = String(safeRemaining)
    if (hint) hint.textContent = areaText('gifArea_selectorStarting')
  }

  function setRect(rect: AreaRect, showToolbar = false) {
    if (!selectionBox) return
    selectionBox.hidden = false
    selectionBox.style.left = `${rect.x}px`
    selectionBox.style.top = `${rect.y}px`
    selectionBox.style.width = `${rect.width}px`
    selectionBox.style.height = `${rect.height}px`
    const size = selectionBox.querySelector('.size')
    if (size) size.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`
    if (toolbar) {
      toolbar.hidden = !showToolbar
      if (showToolbar) {
        toolbar.dataset.dock = resolveAreaSelectorToolbarDock(rect, {
          width: window.innerWidth,
          height: window.innerHeight
        })
      }
    }
  }

  function destroyVisuals() {
    window.removeEventListener('keydown', onKeyDown, true)
    window.removeEventListener('wheel', preventPageMotion, true)
    window.removeEventListener('touchmove', preventPageMotion, true)
    host?.remove()
    host = null
    root = null
    selectionBox = null
    toolbar = null
    hint = null
    countdown = null
    startPoint = null
    selectedRect = null
    confirmed = false
    operationId = null
  }

  return {
    onMessage(message, _sender, sendResponse) {
      if (message?.type === 'AREA_SELECTOR_OPEN') {
        if (!isOperationId(message.operationId)) {
          sendResponse({ ok: false, error: 'INVALID_OPERATION_ID' })
          return
        }
        open(message.operationId)
        sendResponse({ ok: true })
        return
      }
      if (message?.type === 'AREA_SELECTOR_COUNTDOWN') {
        if (message.operationId !== operationId) return
        showCountdown(message.remaining)
        sendResponse({ ok: true, dismissed: message.remaining <= 0 })
        return
      }
      if (message?.type === 'AREA_SELECTOR_ABORT') {
        if (message.operationId !== operationId) return
        destroyVisuals()
        sendResponse({ ok: true })
      }
    }
  }
}

function pointInViewport(x: number, y: number) {
  return {
    x: Math.min(window.innerWidth, Math.max(0, x)),
    y: Math.min(window.innerHeight, Math.max(0, y))
  }
}

function rectFromPoints(start: { x: number; y: number }, end: { x: number; y: number }): AreaRect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y)
  }
}

function isOperationId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

const areaFallbackMessages: Record<string, string> = {
  gifArea_selectorDialogLabel: 'Select a GIF recording area',
  gifArea_selectorInstruction: 'Drag to select a GIF recording area · Esc to cancel',
  gifArea_selectorActions: 'Area selection actions',
  gifArea_selectorReset: 'Select again',
  gifArea_selectorConfirm: 'Start recording',
  gifArea_selectorCancel: 'Cancel area selection',
  gifArea_selectorMinimum: 'Area must be at least $SIZE$ × $SIZE$px. Drag again.',
  gifArea_selectorConfirmHint: 'Press Enter or choose Start recording. The selection hides before capture.',
  gifArea_selectorPreparing: 'Preparing the recording…',
  gifArea_selectorStartFailed: 'Could not start area recording. Try again.',
  gifArea_selectorStarting: 'Recording starts soon'
}

function areaText(key: string, substitution?: string): string {
  try {
    const message = chrome.i18n?.getMessage(key, substitution)
    if (message) return message
  } catch {}
  const fallback = areaFallbackMessages[key] || key
  return substitution ? fallback.replaceAll('$SIZE$', substitution) : fallback
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  })[character] || character)
}

const selectorStyles = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  .selector-root {
    position: fixed; inset: 0; overflow: hidden; cursor: crosshair;
    font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: #fff; background: rgba(9, 13, 22, .48); user-select: none;
  }
  .selector-root.is-confirmed { cursor: wait; }
  .hint {
    position: fixed; top: 18px; left: 50%; transform: translateX(-50%);
    max-width: min(620px, calc(100vw - 96px)); padding: 10px 16px;
    border: 1px solid rgba(255,255,255,.18); border-radius: 12px;
    background: rgba(17,24,39,.94); box-shadow: 0 8px 30px rgba(0,0,0,.28);
    font-weight: 600; letter-spacing: .01em; pointer-events: none;
  }
  .cancel {
    position: fixed; top: 16px; right: 18px; width: 36px; height: 36px;
    border: 1px solid rgba(255,255,255,.22); border-radius: 10px;
    color: #fff; background: rgba(17,24,39,.94); font: 24px/30px sans-serif;
    cursor: pointer;
  }
  .cancel:hover { background: rgba(55,65,81,.98); }
  .cancel:focus-visible, .toolbar button:focus-visible {
    outline: 3px solid rgba(147,197,253,.95); outline-offset: 3px;
  }
  .selection {
    position: fixed; border: 2px solid #60a5fa; background: transparent;
    box-shadow: 0 0 0 99999px rgba(9,13,22,.58), 0 0 0 1px rgba(255,255,255,.7) inset;
  }
  .size {
    position: absolute; top: 8px; left: 8px; padding: 3px 7px; border-radius: 6px;
    background: rgba(17,24,39,.9); color: #fff; font-size: 11px; pointer-events: none;
  }
  .toolbar {
    position: fixed; left: 50%; z-index: 2; display: flex; gap: 8px;
    padding: 7px; border-radius: 12px; background: rgba(17,24,39,.96);
    box-shadow: 0 8px 30px rgba(0,0,0,.32);
  }
  .toolbar[data-dock="bottom"] { bottom: 22px; transform: translateX(-50%); }
  .toolbar[data-dock="top"] { top: 72px; transform: translateX(-50%); }
  .toolbar button {
    border: 0; border-radius: 8px; padding: 8px 12px; color: #e5e7eb;
    background: #374151; font: 600 12px/1 sans-serif; cursor: pointer;
  }
  .toolbar button.primary { color: #fff; background: #2563eb; }
  .toolbar button:hover { filter: brightness(1.1); }
  .countdown {
    position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%);
    width: 116px; height: 116px; border: 3px solid rgba(255,255,255,.9);
    border-radius: 999px; background: rgba(17,24,39,.9); color: #fff;
    font: 700 58px/110px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    text-align: center; box-shadow: 0 16px 48px rgba(0,0,0,.38); pointer-events: none;
  }
`
