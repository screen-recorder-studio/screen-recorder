import type { RecordingPhase, RecordingSessionState } from './recording-session'

export type RecordingPopupAction = 'start' | 'retry' | 'pause' | 'resume' | 'none'
export type RecordingPopupTone = 'neutral' | 'busy' | 'live' | 'danger'

export interface RecordingPopupModel {
  canSelectMode: boolean
  canStart: boolean
  canTogglePause: boolean
  canStop: boolean
  primaryAction: RecordingPopupAction
  tone: RecordingPopupTone
}
export function deriveRecordingPopupModel(state: RecordingSessionState): RecordingPopupModel {
  switch (state.phase) {
    case 'idle':
      return availableModel('start', 'neutral')
    case 'failed':
      return availableModel('retry', 'danger')
    case 'recording':
      return liveModel('pause')
    case 'paused':
      return liveModel('resume')
    default:
      return busyModel(state.phase)
  }
}

export function getDisplayedElapsedMs(state: RecordingSessionState, now = Date.now()): number {
  const elapsed = normalizeCounter(state.elapsedMs)
  if (state.phase !== 'recording') return elapsed
  return elapsed + Math.max(0, normalizeCounter(now) - normalizeCounter(state.updatedAt))
}

function availableModel(
  primaryAction: 'start' | 'retry',
  tone: 'neutral' | 'danger'
): RecordingPopupModel {
  return {
    canSelectMode: true,
    canStart: true,
    canTogglePause: false,
    canStop: false,
    primaryAction,
    tone
  }
}

function liveModel(primaryAction: 'pause' | 'resume'): RecordingPopupModel {
  return {
    canSelectMode: false,
    canStart: false,
    canTogglePause: true,
    canStop: true,
    primaryAction,
    tone: 'live'
  }
}

function busyModel(_phase: Exclude<RecordingPhase, 'idle' | 'failed' | 'recording' | 'paused'>): RecordingPopupModel {
  return {
    canSelectMode: false,
    canStart: false,
    canTogglePause: false,
    canStop: false,
    primaryAction: 'none',
    tone: 'busy'
  }
}

function normalizeCounter(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}
