export interface NormalizedFocusPoint {
  x: number
  y: number
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

export function nudgeFocusPoint(
  focus: NormalizedFocusPoint,
  key: string,
  accelerated = false
): NormalizedFocusPoint {
  const step = accelerated ? 0.05 : 0.01
  switch (key) {
    case 'ArrowLeft': return { x: clamp01(focus.x - step), y: focus.y }
    case 'ArrowRight': return { x: clamp01(focus.x + step), y: focus.y }
    case 'ArrowUp': return { x: focus.x, y: clamp01(focus.y - step) }
    case 'ArrowDown': return { x: focus.x, y: clamp01(focus.y + step) }
    default: return { ...focus }
  }
}
