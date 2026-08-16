import { describe, expect, it, vi } from 'vitest'
import {
  normalizeRecordingCountdown,
  persistRecordingCountdownSetting,
  readFirstFormalFrameAfterWarmup,
  startRecordingWarmup,
  type RecordingWarmupReader
} from './recording-startup'

type FakeFrame = {
  id: string
  close(): void
}

function createReader(frames: FakeFrame[]): RecordingWarmupReader<FakeFrame> & {
  cancel: ReturnType<typeof vi.fn>
  releaseLock: ReturnType<typeof vi.fn>
} {
  let index = 0
  let pendingRead: ((result: ReadableStreamReadResult<FakeFrame>) => void) | null = null
  const cancel = vi.fn(async () => {
    pendingRead?.({ done: true, value: undefined })
    pendingRead = null
  })
  const releaseLock = vi.fn()

  return {
    read: vi.fn(async () => {
      if (index < frames.length) {
        const value = frames[index++]
        return { done: false as const, value }
      }
      return new Promise<ReadableStreamReadResult<FakeFrame>>((resolve) => {
        pendingRead = resolve
      })
    }),
    cancel,
    releaseLock
  }
}

describe('normalizeRecordingCountdown', () => {
  it('accepts Off and integer seconds inside the supported range', () => {
    expect(normalizeRecordingCountdown(0)).toBe(0)
    expect(normalizeRecordingCountdown(3)).toBe(3)
    expect(normalizeRecordingCountdown(5)).toBe(5)
    expect(normalizeRecordingCountdown(4.9)).toBe(4)
  })

  it('falls back instead of silently clamping invalid persisted values', () => {
    expect(normalizeRecordingCountdown(-1)).toBe(3)
    expect(normalizeRecordingCountdown(6)).toBe(3)
    expect(normalizeRecordingCountdown(Number.NaN)).toBe(3)
    expect(normalizeRecordingCountdown(undefined)).toBe(3)
    expect(normalizeRecordingCountdown('0')).toBe(3)
  })
})

describe('persistRecordingCountdownSetting', () => {
  it('persists from the long-lived owner without discarding unrelated settings', async () => {
    let stored: Record<string, unknown> = {
      settings: { videoQuality: 'medium', countdownSeconds: 3 }
    }
    const storage = {
      async get() { return stored },
      async set(value: Record<string, unknown>) { stored = { ...stored, ...value } }
    }

    await persistRecordingCountdownSetting(storage, 5)

    expect(stored).toEqual({
      settings: { videoQuality: 'medium', countdownSeconds: 5 }
    })
  })
})

describe('startRecordingWarmup', () => {
  it('prepares from the first frame while continuously draining and closing warm-up frames', async () => {
    const frames = [
      { id: 'countdown-3', close: vi.fn() },
      { id: 'countdown-2', close: vi.fn() },
      { id: 'countdown-1', close: vi.fn() }
    ]
    const reader = createReader(frames)
    let resolvePreparation!: (value: string) => void
    const preparation = new Promise<string>((resolve) => { resolvePreparation = resolve })
    const prepareFromFrame = vi.fn(() => preparation)

    const warmup = startRecordingWarmup({ reader, prepareFromFrame })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(prepareFromFrame).toHaveBeenCalledTimes(1)
    expect(prepareFromFrame).toHaveBeenCalledWith(frames[0])
    expect(frames.every((frame) => vi.mocked(frame.close).mock.calls.length === 1)).toBe(true)

    resolvePreparation('ready')
    await expect(warmup.prepared).resolves.toBe('ready')
    await warmup.stop()
    expect(reader.cancel).toHaveBeenCalledTimes(1)
    expect(reader.releaseLock).toHaveBeenCalledTimes(1)
  })

  it('creates the formal reader only after preparation and warm-up ownership end', async () => {
    const events: string[] = []
    const formalFrame = { id: 'formal', close: vi.fn() }
    const formalReader: RecordingWarmupReader<FakeFrame> = {
      read: vi.fn(async () => {
        events.push('formal-read')
        return { done: false as const, value: formalFrame }
      })
    }
    const warmup = {
      prepared: Promise.resolve().then(() => { events.push('prepared') }),
      stop: vi.fn(async () => { events.push('warmup-stopped') })
    }

    const result = await readFirstFormalFrameAfterWarmup({
      warmup,
      createFormalReader: () => {
        events.push('formal-reader-created')
        return formalReader
      }
    })

    expect(events).toEqual(['prepared', 'warmup-stopped', 'formal-reader-created', 'formal-read'])
    expect(result.frame).toBe(formalFrame)
    expect(result.reader).toBe(formalReader)
    expect(formalFrame.close).not.toHaveBeenCalled()
  })

  it('closes the preparation frame even when preparation fails', async () => {
    const frame = { id: 'countdown', close: vi.fn() }
    const reader = createReader([frame])
    const warmup = startRecordingWarmup({
      reader,
      prepareFromFrame: () => { throw new Error('configure failed') }
    })

    await expect(warmup.prepared).rejects.toThrow('configure failed')
    expect(frame.close).toHaveBeenCalledTimes(1)
    await warmup.stop()
  })

  it('rejects when capture ends before a warm-up frame exists', async () => {
    const reader: RecordingWarmupReader<FakeFrame> = {
      read: vi.fn(async () => ({ done: true as const, value: undefined })),
      cancel: vi.fn(async () => undefined),
      releaseLock: vi.fn()
    }
    const warmup = startRecordingWarmup({
      reader,
      prepareFromFrame: vi.fn(async () => 'ready')
    })

    await expect(warmup.prepared).rejects.toThrow('Capture ended before a warm-up frame arrived')
    await warmup.stop()
  })
})
