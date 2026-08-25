import { describe, expect, it } from 'vitest'
import { nudgeFocusPoint } from './focus-point'

describe('focus point keyboard adjustment', () => {
  it.each([
    ['ArrowLeft', { x: 0.49, y: 0.5 }],
    ['ArrowRight', { x: 0.51, y: 0.5 }],
    ['ArrowUp', { x: 0.5, y: 0.49 }],
    ['ArrowDown', { x: 0.5, y: 0.51 }]
  ] as const)('nudges with %s', (key, expected) => {
    expect(nudgeFocusPoint({ x: 0.5, y: 0.5 }, key)).toEqual(expected)
  })

  it('supports a larger shift-key step and clamps to the source bounds', () => {
    expect(nudgeFocusPoint({ x: 0.98, y: 0.02 }, 'ArrowRight', true)).toEqual({ x: 1, y: 0.02 })
    expect(nudgeFocusPoint({ x: 0.98, y: 0.02 }, 'ArrowUp', true)).toEqual({ x: 0.98, y: 0 })
  })

  it('ignores unrelated keys', () => {
    expect(nudgeFocusPoint({ x: 0.25, y: 0.75 }, 'Enter')).toEqual({ x: 0.25, y: 0.75 })
  })
})
