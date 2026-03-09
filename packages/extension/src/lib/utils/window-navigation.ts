export async function openControlWindow(): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: 'OPEN_CONTROL_WINDOW' })
    return
  } catch {
    window.open('/control.html', '_blank', 'noopener')
  }
}

export async function openDrivePage(): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: 'OPEN_DRIVE' })
    return
  } catch {
    window.open('/drive.html', '_blank', 'noopener')
  }
}
