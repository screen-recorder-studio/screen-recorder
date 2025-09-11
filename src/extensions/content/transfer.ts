import { state } from './state'
import type { CapsReport, EncodedChunk, RecordingMetadata } from './types'

// Basic runtime helpers
function getExtId() {
  try { return chrome?.runtime?.id || '' } catch { return '' }
}

export function report(partial: Partial<CapsReport & { status?: string; message?: string }>) {
  try {
    chrome.runtime.sendMessage({ type: 'CONTENT_REPORT', ...partial }).catch(() => {})
  } catch {}
}

export function showEditingNotification() {
  try {
    chrome.runtime.sendMessage({ type: 'SHOW_EDITING_NOTIFICATION' }).catch(() => {})
  } catch {}
}

export async function transferToMainSystem(encoded: EncodedChunk[], meta: RecordingMetadata) {
  // Keep payload format compatible with existing sidepanel integration
  const safeChunks = encoded.map(ch => ({
    ...ch,
    data: Array.isArray(ch.data) ? ch.data : Array.from(ch.data as Uint8Array),
  }))
  const payload = { type: 'ELEMENT_RECORDING_COMPLETE', data: { encodedChunks: safeChunks, metadata: meta } }
  try {
    await chrome.runtime.sendMessage(payload)
    // Also broadcast a READY type (compat)
    await chrome.runtime.sendMessage({ type: 'ELEMENT_RECORDING_READY', data: { metadata: meta } })
  } catch (e) {
    console.warn('[content] transferToMainSystem failed', e)
  }
}

