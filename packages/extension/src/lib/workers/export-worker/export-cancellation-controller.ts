export interface CancellableOutput {
  cancel(): Promise<void>
}

export interface ActiveExportResource {
  output: Promise<CancellableOutput>
  closeVideoSource?(): void | Promise<void>
  discardPartialOutput?(): Promise<void>
}

export class ExportCancellationController {
  private requested = false
  private activeResource: ActiveExportResource | null = null
  private cancellationPromise: Promise<void> | null = null

  get isRequested(): boolean {
    return this.requested
  }

  reset(): void {
    this.requested = false
    this.activeResource = null
    this.cancellationPromise = null
  }

  register(resource: ActiveExportResource): Promise<void> | null {
    if (this.activeResource && this.activeResource !== resource) {
      throw new Error('Another export output is already active')
    }
    this.activeResource = resource
    return this.requested ? this.cancelActive() : null
  }

  release(resource: ActiveExportResource): void {
    if (this.activeResource === resource && !this.cancellationPromise) {
      this.activeResource = null
    }
  }

  request(): Promise<void> {
    this.requested = true
    return this.cancelActive()
  }

  private cancelActive(): Promise<void> {
    if (this.cancellationPromise) return this.cancellationPromise
    const resource = this.activeResource
    if (!resource) return Promise.resolve()

    const trackedCancellation = this.cancelResource(resource)
    this.cancellationPromise = trackedCancellation
    void trackedCancellation.then(
      () => {
        if (this.activeResource === resource) this.activeResource = null
        if (this.cancellationPromise === trackedCancellation) this.cancellationPromise = null
      },
      () => {
        // Keep the active resource so a transient cleanup failure can be retried.
        if (this.cancellationPromise === trackedCancellation) this.cancellationPromise = null
      }
    )
    return trackedCancellation
  }

  private async cancelResource(resource: ActiveExportResource): Promise<void> {
    let firstError: unknown = null
    let output: CancellableOutput | null = null

    try {
      output = await resource.output
    } catch (error) {
      firstError = error
    }

    if (output) {
      try {
        await output.cancel()
      } catch (error) {
        firstError ??= error
      }
    }

    try {
      await resource.closeVideoSource?.()
    } catch (error) {
      firstError ??= error
    }

    try {
      await resource.discardPartialOutput?.()
    } catch (error) {
      firstError ??= error
    }

    if (firstError) throw firstError
  }
}
