export class WindowProcessingGenerationGate {
  #activeGeneration = 0

  get activeGeneration(): number {
    return this.#activeGeneration
  }

  resolveIncoming(candidate: unknown): number {
    return Number.isInteger(candidate) && Number(candidate) > 0
      ? Number(candidate)
      : this.#activeGeneration + 1
  }

  activate(candidate: unknown): boolean {
    const generation = this.resolveIncoming(candidate)
    if (generation <= this.#activeGeneration) return false
    this.#activeGeneration = generation
    return true
  }

  isCurrent(candidate: unknown): boolean {
    return Number.isInteger(candidate) && Number(candidate) === this.#activeGeneration
  }
}

export function isExpectedDecoderCancellation(args: {
  activeGeneration: number
  settledGeneration: number
  errorName?: string
}): boolean {
  return args.settledGeneration !== args.activeGeneration || args.errorName === 'AbortError'
}
