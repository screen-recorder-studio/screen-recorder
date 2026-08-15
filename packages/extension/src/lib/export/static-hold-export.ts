import type { StaticHoldPlan } from '../recording/static-hold-plan'

interface StaticHoldVideoSource {
  add(timestampSeconds: number, durationSeconds: number): Promise<void>
}

export async function writeStaticHoldVideoSample(input: {
  plan: StaticHoldPlan
  render: () => Promise<void>
  videoSource: StaticHoldVideoSource
}): Promise<number> {
  await input.render()
  await input.videoSource.add(0, input.plan.sampleDurationSeconds)
  return 1
}
