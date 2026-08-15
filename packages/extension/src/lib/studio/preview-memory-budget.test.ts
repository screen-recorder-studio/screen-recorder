import { describe, expect, it } from 'vitest'
import {
  createPreviewMemoryTelemetry,
  planPreviewMemoryBudget
} from './preview-memory-budget'

const MiB = 1024 * 1024

describe('preview memory budget planner', () => {
  it.each([undefined, null, 0, 2, 4, 6])(
    'uses the conservative 256 MiB retained budget when device memory is %s',
    (deviceMemoryGB) => {
      const plan = planPreviewMemoryBudget({
        sourceWidth: 3840,
        sourceHeight: 2160,
        fps: 30,
        deviceMemoryGB
      })

      expect(plan).not.toBeNull()
      expect(plan).toMatchObject({
        memoryTier: 'conservative',
        retainedBudgetBytes: 256 * MiB,
        transientHeadroomBytes: 64 * MiB,
        totalWorkingSetBudgetBytes: 320 * MiB
      })
      expect(plan!.estimatedRetainedBytes).toBeLessThanOrEqual(256 * MiB)
    }
  )

  it.each([8, 16, 32])(
    'uses the 512 MiB retained budget when device memory is %s GiB',
    (deviceMemoryGB) => {
      const plan = planPreviewMemoryBudget({
        sourceWidth: 3840,
        sourceHeight: 2160,
        fps: 30,
        deviceMemoryGB
      })

      expect(plan).not.toBeNull()
      expect(plan).toMatchObject({
        memoryTier: 'standard',
        retainedBudgetBytes: 512 * MiB,
        transientHeadroomBytes: 128 * MiB,
        totalWorkingSetBudgetBytes: 640 * MiB
      })
      expect(plan!.estimatedRetainedBytes).toBeLessThanOrEqual(512 * MiB)
    }
  )

  it('preserves two seconds for both main and next windows so cutovers never shrink the runway', () => {
    const plan = planPreviewMemoryBudget({
      sourceWidth: 3840,
      sourceHeight: 2160,
      fps: 30,
      deviceMemoryGB: undefined,
      mainRunwaySeconds: 0.5,
      nextRunwaySeconds: 0.25
    })

    expect(plan).not.toBeNull()
    expect(plan).toMatchObject({
      mainRunwaySeconds: 2,
      nextRunwaySeconds: 2,
      mainFrameCapacity: 60,
      nextFrameCapacity: 60,
      retainedFrameCapacity: 120,
      usesProxy: true
    })
    expect(plan!.previewWidth).toBeLessThan(3840)
    expect(plan!.previewHeight).toBeLessThan(2160)
    expect(plan!.estimatedRetainedBytes).toBeLessThanOrEqual(plan!.retainedBudgetBytes)
  })

  it('keeps longer requested runways instead of silently shortening them', () => {
    const plan = planPreviewMemoryBudget({
      sourceWidth: 1920,
      sourceHeight: 1080,
      fps: 29.97,
      deviceMemoryGB: 8,
      mainRunwaySeconds: 3.5,
      nextRunwaySeconds: 2.5
    })

    expect(plan).not.toBeNull()
    expect(plan).toMatchObject({
      mainRunwaySeconds: 3.5,
      nextRunwaySeconds: 2.5,
      mainFrameCapacity: 105,
      nextFrameCapacity: 75,
      retainedFrameCapacity: 180
    })
    expect(plan!.estimatedRetainedBytes).toBeLessThanOrEqual(plan!.retainedBudgetBytes)
  })

  it('keeps a two-second prefetch window reusable as the next main window', () => {
    const plan = planPreviewMemoryBudget({
      sourceWidth: 3840,
      sourceHeight: 2160,
      fps: 30,
      deviceMemoryGB: 4,
      nextRunwaySeconds: 2
    })

    expect(plan).toMatchObject({
      mainFrameCapacity: 60,
      nextFrameCapacity: 60,
      retainedFrameCapacity: 120,
      usesProxy: true
    })
    expect(plan!.estimatedRetainedBytes).toBeLessThanOrEqual(plan!.retainedBudgetBytes)
  })

  it('does not upscale a source that already fits the retained budget', () => {
    const plan = planPreviewMemoryBudget({
      sourceWidth: 640,
      sourceHeight: 360,
      fps: 30,
      deviceMemoryGB: 4
    })

    expect(plan).toMatchObject({
      previewWidth: 640,
      previewHeight: 360,
      usesProxy: false
    })
  })

  it.each([
    { sourceWidth: 3840, sourceHeight: 2160 },
    { sourceWidth: 2160, sourceHeight: 3840 },
    { sourceWidth: 1921, sourceHeight: 1081 }
  ])('returns even, bounded dimensions with the source aspect ratio for $sourceWidth x $sourceHeight', (source) => {
    const plan = planPreviewMemoryBudget({
      ...source,
      fps: 60,
      deviceMemoryGB: 4
    })

    expect(plan).not.toBeNull()
    expect(plan!.previewWidth % 2).toBe(0)
    expect(plan!.previewHeight % 2).toBe(0)
    expect(plan!.previewWidth).toBeLessThanOrEqual(source.sourceWidth)
    expect(plan!.previewHeight).toBeLessThanOrEqual(source.sourceHeight)
    expect(plan!.estimatedRetainedBytes).toBeLessThanOrEqual(plan!.retainedBudgetBytes)

    const sourceAspect = source.sourceWidth / source.sourceHeight
    const previewAspect = plan!.previewWidth / plan!.previewHeight
    expect(Math.abs(previewAspect - sourceAspect) / sourceAspect).toBeLessThan(0.005)
  })

  it.each([
    { sourceWidth: 0, sourceHeight: 1080, fps: 30 },
    { sourceWidth: 1920, sourceHeight: 1, fps: 30 },
    { sourceWidth: 1920, sourceHeight: 1080, fps: 0 },
    { sourceWidth: Number.NaN, sourceHeight: 1080, fps: 30 }
  ])('rejects invalid source input %#', (input) => {
    expect(planPreviewMemoryBudget(input)).toBeNull()
  })

  it('publishes the active source geometry and decoder queue watermarks', () => {
    const plan = planPreviewMemoryBudget({
      sourceWidth: 3840,
      sourceHeight: 2160,
      fps: 30,
      deviceMemoryGB: 4
    })!

    expect(createPreviewMemoryTelemetry({
      plan,
      sourceDisplayWidth: 3840,
      sourceDisplayHeight: 2160,
      decodeQueueHighWatermark: 2,
      decodeQueueLowWatermark: 1,
      windowGeneration: 9
    })).toMatchObject({
      sourceDisplayWidth: 3840,
      sourceDisplayHeight: 2160,
      decodeQueueHighWatermark: 2,
      decodeQueueLowWatermark: 1,
      windowGeneration: 9
    })
  })
})
