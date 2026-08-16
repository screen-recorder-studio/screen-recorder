import { describe, expect, it, vi } from 'vitest'
import {
  createRecordingCountdownSurface,
  type RecordingCountdownWindowDriver
} from './recording-countdown-surface'

function createDriver(windowId = 42): RecordingCountdownWindowDriver & {
  create: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
} {
  return {
    create: vi.fn(async () => ({ id: windowId })),
    remove: vi.fn(async () => undefined)
  }
}

describe('createRecordingCountdownSurface', () => {
  it('opens a focused temporary surface centered on the initiating browser window', async () => {
    const driver = createDriver()
    const surface = createRecordingCountdownSurface({
      driver,
      getUrl: (path) => `chrome-extension://test/${path}`
    })

    await surface.show({
      operationId: 'op-screen',
      mode: 'screen',
      remaining: 3,
      hostBounds: { left: -1920, top: 40, width: 1920, height: 1080 }
    })

    expect(driver.create).toHaveBeenCalledWith({
      url: 'chrome-extension://test/countdown.html?surface=recording&operationId=op-screen&seconds=3',
      type: 'popup',
      focused: true,
      width: 320,
      height: 320,
      left: -1120,
      top: 420
    })
  })

  it('does not create a second window for later ticks of the same operation', async () => {
    const driver = createDriver()
    const surface = createRecordingCountdownSurface({ driver, getUrl: (path) => path })

    await surface.show({ operationId: 'op-window', mode: 'window', remaining: 3 })
    await surface.show({ operationId: 'op-window', mode: 'window', remaining: 2 })
    await surface.show({ operationId: 'op-window', mode: 'window', remaining: 1 })

    expect(driver.create).toHaveBeenCalledTimes(1)
  })

  it('stays hidden for tab capture and zero-second countdowns', async () => {
    const driver = createDriver()
    const surface = createRecordingCountdownSurface({ driver, getUrl: (path) => path })

    await surface.show({ operationId: 'op-tab', mode: 'tab', remaining: 3 })
    await surface.show({ operationId: 'op-screen', mode: 'screen', remaining: 0 })

    expect(driver.create).not.toHaveBeenCalled()
  })

  it('closes the surface at the zero boundary', async () => {
    const driver = createDriver(77)
    const surface = createRecordingCountdownSurface({ driver, getUrl: (path) => path })

    await surface.show({ operationId: 'op-screen', mode: 'screen', remaining: 3 })
    await surface.hide('op-screen')

    expect(driver.remove).toHaveBeenCalledWith(77)
  })

  it('closes a window that finishes opening after its operation was cancelled', async () => {
    let finishCreate!: (value: { id: number }) => void
    const driver = createDriver()
    driver.create.mockImplementation(() => new Promise((resolve) => { finishCreate = resolve }))
    const surface = createRecordingCountdownSurface({ driver, getUrl: (path) => path })

    const showing = surface.show({ operationId: 'op-screen', mode: 'screen', remaining: 3 })
    await Promise.resolve()
    await surface.hide('op-screen')
    finishCreate({ id: 91 })
    await showing

    expect(driver.remove).toHaveBeenCalledWith(91)
  })
})
