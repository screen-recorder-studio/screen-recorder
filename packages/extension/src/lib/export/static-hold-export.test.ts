import { describe, expect, it, vi } from 'vitest'
import { writeStaticHoldVideoSample } from './static-hold-export'

describe('static hold video export', () => {
  it('renders once and writes one sample with the full wall-clock duration', async () => {
    const calls: string[] = []
    const add = vi.fn(async (timestampSeconds: number, durationSeconds: number) => {
      calls.push(`add:${timestampSeconds}:${durationSeconds}`)
    })

    const written = await writeStaticHoldVideoSample({
      plan: { durationMs: 25_223, sampleDurationSeconds: 25.223 },
      render: async () => { calls.push('render') },
      videoSource: { add }
    })

    expect(written).toBe(1)
    expect(calls).toEqual(['render', 'add:0:25.223'])
    expect(add).toHaveBeenCalledOnce()
  })
})
