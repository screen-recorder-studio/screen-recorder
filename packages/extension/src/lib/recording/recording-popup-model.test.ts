import { describe, expect, it } from 'vitest'
import { deriveRecordingPopupModel, getDisplayedElapsedMs } from './recording-popup-model'
import { createIdleRecordingSession, type RecordingSessionState } from './recording-session'

function session(patch: Partial<RecordingSessionState>): RecordingSessionState {
  return { ...createIdleRecordingSession({ updatedAt: 100 }), ...patch }
}

describe('recording popup view model', () => {
  it('offers start and mode selection only while idle or failed', () => {
    expect(deriveRecordingPopupModel(session({ phase: 'idle' }))).toMatchObject({
      canSelectMode: true,
      canStart: true,
      canTogglePause: false,
      canStop: false,
      primaryAction: 'start'
    })
    expect(deriveRecordingPopupModel(session({ phase: 'failed', operationId: 'op-1', revision: 2, errorCode: 'CAPTURE_CANCELLED' }))).toMatchObject({
      canSelectMode: true,
      canStart: true,
      primaryAction: 'retry',
      tone: 'danger'
    })
  })

  it('exposes pause/resume and stop only for a live recording', () => {
    expect(deriveRecordingPopupModel(session({ phase: 'recording', operationId: 'op-1', revision: 2 }))).toMatchObject({
      canSelectMode: false,
      canTogglePause: true,
      canStop: true,
      primaryAction: 'pause',
      tone: 'live'
    })
    expect(deriveRecordingPopupModel(session({ phase: 'paused', operationId: 'op-1', revision: 3 }))).toMatchObject({
      canTogglePause: true,
      canStop: true,
      primaryAction: 'resume'
    })
  })

  it('treats source selection, countdown, stop, and finalization as busy', () => {
    for (const phase of ['requesting', 'countdown', 'stopping', 'finalizing'] as const) {
      expect(deriveRecordingPopupModel(session({ phase, operationId: 'op-1', revision: 1 }))).toMatchObject({
        canSelectMode: false,
        canStart: false,
        canTogglePause: false,
        canStop: false,
        tone: 'busy'
      })
    }
  })

  it('derives elapsed time without writing a session snapshot every second', () => {
    expect(getDisplayedElapsedMs(session({
      phase: 'recording', operationId: 'op-1', revision: 2, elapsedMs: 1_500, updatedAt: 10_000
    }), 12_250)).toBe(3_750)
    expect(getDisplayedElapsedMs(session({
      phase: 'paused', operationId: 'op-1', revision: 3, elapsedMs: 1_500, updatedAt: 10_000
    }), 12_250)).toBe(1_500)
  })
})
