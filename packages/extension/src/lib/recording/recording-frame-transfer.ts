export interface ClosableFrame {
  close(): void
}

export interface EncoderWorkerPort {
  postMessage(message: unknown, transfer: unknown[]): void
}

/**
 * Transfers the only sender-owned VideoFrame reference to the encoder worker.
 * A synchronous post failure leaves ownership with the sender, so it must close.
 */
export function transferFrameToEncoderWorker<T extends ClosableFrame>(
  worker: EncoderWorkerPort,
  frame: T,
  keyFrame: boolean
): void {
  try {
    worker.postMessage({ type: 'encode', frame, keyFrame }, [frame])
  } catch (error) {
    try { frame.close() } catch {}
    throw error
  }
}
