import { ensureRoot, resetRecordingState, setMode } from './state'
import { enterElementSelection, enterRegionSelection, exitSelection } from './selection'
import { startCapture, stopCapture } from './capture'
import { report } from './transfer'

// Guard multiple injections
declare global { interface Window { __mcp_injected?: boolean } }
if (window.__mcp_injected) {
  // already injected
} else {
  window.__mcp_injected = true
  ensureRoot()
  // initial capability report
  report({
    getDisplayMedia: !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia),
    restrictionTarget: typeof (window as any).RestrictionTarget !== 'undefined',
    cropTarget: typeof (window as any).CropTarget !== 'undefined',
    status: 'ready'
  })

  // runtime message handler
  chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
    switch (message?.type) {
      case 'ENTER_SELECTION':
        setMode(message.mode || 'element')
        exitSelection()
        if (message.mode === 'region') enterRegionSelection(); else enterElementSelection()
        break
      case 'START_CAPTURE':
        startCapture(); break
      case 'STOP_CAPTURE':
        stopCapture(); break
      case 'EXIT_SELECTION':
        exitSelection(); break
    }
  })

  // ESC to exit selection
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') exitSelection()
  }, true)

  // Cleanup on unload
  window.addEventListener('beforeunload', () => {
    resetRecordingState()
  })
}

