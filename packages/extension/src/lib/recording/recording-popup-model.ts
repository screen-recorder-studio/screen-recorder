import type { RecordingSessionState } from './recording-session'

export type RecordingPopupAction = 'start' | 'retry' | 'pause' | 'resume' | 'cancel-selection' | 'none'
export type RecordingPopupTone = 'neutral' | 'busy' | 'live' | 'danger'
export type RecordingPopupWorkflow = 'video' | 'gif-area'

export interface RecordingPopupModel {
  canSelectMode: boolean
  canStart: boolean
  canTogglePause: boolean
  canStop: boolean
  canCancelSelection: boolean
  primaryAction: RecordingPopupAction
  tone: RecordingPopupTone
  showSetup: boolean
  activeWorkflow: RecordingPopupWorkflow | null
}
export function deriveRecordingPopupModel(state: RecordingSessionState): RecordingPopupModel {
  switch (state.phase) {
    case 'idle':
      return availableModel('start', 'neutral')
    case 'failed':
      return availableModel('retry', 'danger')
    case 'selecting':
      return selectionModel(state)
    case 'recording':
      return liveModel('pause', state)
    case 'paused':
      return liveModel('resume', state)
    default:
      return busyModel(state)
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
    canCancelSelection: false,
    primaryAction,
    tone,
    showSetup: true,
    activeWorkflow: null
  }
}

function liveModel(
  primaryAction: 'pause' | 'resume',
  state: RecordingSessionState
): RecordingPopupModel {
  return {
    canSelectMode: false,
    canStart: false,
    canTogglePause: true,
    canStop: true,
    canCancelSelection: false,
    primaryAction,
    tone: 'live',
    showSetup: false,
    activeWorkflow: resolveActiveWorkflow(state)
  }
}

function selectionModel(state: RecordingSessionState): RecordingPopupModel {
  return {
    canSelectMode: false,
    canStart: false,
    canTogglePause: false,
    canStop: false,
    canCancelSelection: true,
    primaryAction: 'cancel-selection',
    tone: 'busy',
    showSetup: false,
    activeWorkflow: resolveActiveWorkflow(state)
  }
}

function busyModel(state: RecordingSessionState): RecordingPopupModel {
  return {
    canSelectMode: false,
    canStart: false,
    canTogglePause: false,
    canStop: false,
    canCancelSelection: false,
    primaryAction: 'none',
    tone: 'busy',
    showSetup: false,
    activeWorkflow: resolveActiveWorkflow(state)
  }
}

function resolveActiveWorkflow(state: RecordingSessionState): RecordingPopupWorkflow {
  return state.mode === 'area' && state.intent === 'gif' ? 'gif-area' : 'video'
}

function normalizeCounter(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}
