import { state, ensureRoot, setSelecting } from './state'
import { report } from './transfer'

// ---- Element selection UI ----

function clearHighlight() {
  const prev = document.querySelector('.mcp-element-highlight') as HTMLDivElement | null
  if (prev) prev.remove()
}

function highlightElement(el: Element) {
  clearHighlight()
  const rect = el.getBoundingClientRect()
  const box = document.createElement('div')
  box.className = 'mcp-element-highlight'
  Object.assign(box.style, {
    position: 'fixed',
    left: rect.left + 'px',
    top: rect.top + 'px',
    width: rect.width + 'px',
    height: rect.height + 'px',
    border: '2px dashed #06f',
    background: 'rgba(0,128,255,0.06)',
    pointerEvents: 'none',
    zIndex: String(2 ** 31 - 1),
  } as CSSStyleDeclaration)
  ensureRoot().appendChild(box)
}

function selectElement(el: Element) {
  state.selectedElement = el
  report({ status: 'element-selected' })
}

export function enterElementSelection() {
  setSelecting(true)
  const onMove = (e: MouseEvent) => {
    if (!state.selecting) return
    const el = document.elementFromPoint(e.clientX, e.clientY)
    if (el) highlightElement(el)
  }
  const onClick = (e: MouseEvent) => {
    if (!state.selecting) return
    e.preventDefault(); e.stopPropagation()
    const el = document.elementFromPoint(e.clientX, e.clientY)
    if (el) {
      selectElement(el)
      clearHighlight()
      exitSelection()
    }
  }
  window.addEventListener('mousemove', onMove, true)
  window.addEventListener('click', onClick, true)
  ;(window as any).__mcp_el_handlers = { onMove, onClick }
}

function removeElementSelectionHandlers() {
  const h = (window as any).__mcp_el_handlers
  if (h) {
    window.removeEventListener('mousemove', h.onMove, true)
    window.removeEventListener('click', h.onClick, true)
  }
  ;(window as any).__mcp_el_handlers = null
}

// ---- Region selection (drag) ----

export function enterRegionSelection() {
  setSelecting(true)
  const root = ensureRoot()
  if (!state.selectionBox) {
    const box = document.createElement('div')
    state.selectionBox = box
    Object.assign(box.style, {
      position: 'fixed', border: '2px solid #06f', background: 'rgba(0,128,255,0.06)', pointerEvents: 'none', zIndex: String(2 ** 31 - 1)
    } as CSSStyleDeclaration)
  }
  const onDown = (e: MouseEvent) => {
    if (!state.selecting) return
    state.isDragging = true
    state.startX = e.clientX; state.startY = e.clientY
    Object.assign(state.selectionBox!.style, { left: e.clientX + 'px', top: e.clientY + 'px', width: '0px', height: '0px' })
    root.appendChild(state.selectionBox!)
  }
  const onMove = (e: MouseEvent) => {
    if (!state.isDragging || !state.selectionBox) return
    const x = Math.min(e.clientX, state.startX)
    const y = Math.min(e.clientY, state.startY)
    const w = Math.abs(e.clientX - state.startX)
    const h = Math.abs(e.clientY - state.startY)
    Object.assign(state.selectionBox.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' })
  }
  const onUp = () => {
    if (!state.isDragging) return
    state.isDragging = false
    exitSelection()
  }
  window.addEventListener('mousedown', onDown, true)
  window.addEventListener('mousemove', onMove, true)
  window.addEventListener('mouseup', onUp, true)
  ;(window as any).__mcp_rg_handlers = { onDown, onMove, onUp }
}

function removeRegionSelectionHandlers() {
  const h = (window as any).__mcp_rg_handlers
  if (h) {
    window.removeEventListener('mousedown', h.onDown, true)
    window.removeEventListener('mousemove', h.onMove, true)
    window.removeEventListener('mouseup', h.onUp, true)
  }
  ;(window as any).__mcp_rg_handlers = null
}

export function exitSelection() {
  setSelecting(false)
  clearHighlight()
  if (state.selectionBox && state.selectionBox.parentElement) state.selectionBox.parentElement.removeChild(state.selectionBox)
  removeElementSelectionHandlers()
  removeRegionSelectionHandlers()
}

export function getSelectedRegion() {
  if (!state.selectionBox) return null
  const rect = state.selectionBox.getBoundingClientRect()
  if (rect.width <= 2 || rect.height <= 2) return null
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
}

