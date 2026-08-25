import { describe, expect, it } from 'vitest'
import { createSceneSnapshot } from './scene-model'

describe('GIF Lab scene model', () => {
  it('advances the suite on a fixed 10 fps visual clock', () => {
    const geometry = createSceneSnapshot('suite', 7, 0)
    const cadence = createSceneSnapshot('suite', 7, 2_250)

    expect(geometry).toMatchObject({ phaseId: 'geometry', frameNumber: 0, visualKey: 'suite:geometry' })
    expect(cadence).toMatchObject({ phaseId: 'cadence', frameNumber: 2 })
    expect(cadence.visualKey).toBe('suite:cadence:2')
    expect(cadence.motion.x).toBeGreaterThan(32)
    expect(cadence.motion.x).toBeLessThan(608)
  })

  it('does not repaint while the static hold is unchanged', () => {
    const earlyHold = createSceneSnapshot('static-hold', 7, 2_100)
    const lateHold = createSceneSnapshot('static-hold', 7, 9_900)
    expect(earlyHold.phaseId).toBe('hold')
    expect(earlyHold.visualKey).toBe('static-hold:hold')
    expect(lateHold.visualKey).toBe(earlyHold.visualKey)
    expect(lateHold.frameNumber).toBe(earlyHold.frameNumber)
  })

  it('generates repeatable palette samples and motion for a seed', () => {
    const first = createSceneSnapshot('palette', 20260824, 4_200)
    const second = createSceneSnapshot('palette', 20260824, 4_200)
    const different = createSceneSnapshot('palette', 20260825, 4_200)

    expect(first.palette).toHaveLength(48)
    expect(first).toEqual(second)
    expect(different.palette).not.toEqual(first.palette)
    expect(first.motion.x).toBeGreaterThanOrEqual(32)
    expect(first.motion.y).toBeGreaterThanOrEqual(32)
  })

  it('freezes a non-looping case on its final visual state', () => {
    expect(createSceneSnapshot('static-hold', 1, 10_000).visualKey).toBe('static-hold:hold')
    expect(createSceneSnapshot('static-hold', 1, 60_000).visualKey).toBe('static-hold:hold')
  })
})
