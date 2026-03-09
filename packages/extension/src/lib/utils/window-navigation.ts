/**
 * Open the recording Control page through the background entry when available.
 *
 * This preserves the existing extension behavior of focusing an existing control
 * window instead of spawning duplicates. In non-extension contexts or when the
 * runtime message fails, it falls back to opening `control.html` directly.
 */
export async function openControlWindow(): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: 'OPEN_CONTROL_WINDOW' })
    return
  } catch (error) {
    console.warn('Failed to open control window via runtime message, falling back to direct window open:', error)
    window.open('/control.html', '_blank', 'noopener')
  }
}

/**
 * Open the Drive page through the background entry when available.
 *
 * This keeps Drive navigation aligned with the extension's tab-opening flow.
 * In non-extension contexts or when the runtime message fails, it falls back
 * to opening `drive.html` directly.
 */
export async function openDrivePage(): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: 'OPEN_DRIVE' })
    return
  } catch (error) {
    console.warn('Failed to open drive via runtime message, falling back to direct window open:', error)
    window.open('/drive.html', '_blank', 'noopener')
  }
}
