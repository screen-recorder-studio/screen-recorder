const DEFAULT_RETAINED_FRAME_BUDGET_BYTES = 384 * 1024 * 1024

export function assertGifExportWithinMemoryBudget(input: {
  width: number
  height: number
  frameCount: number
  budgetBytes?: number
}) {
  const width = positiveInteger(input.width)
  const height = positiveInteger(input.height)
  const frameCount = positiveInteger(input.frameCount)
  const budgetBytes = positiveInteger(input.budgetBytes ?? DEFAULT_RETAINED_FRAME_BUDGET_BYTES)
  if (!width || !height || !frameCount || !budgetBytes) throw new Error('GIF_EXPORT_PLAN_INVALID')

  // gif.js retains RGBA frame copies until render(), despite decode-side streaming.
  const estimatedRawBytes = width * height * 4 * frameCount
  if (!Number.isSafeInteger(estimatedRawBytes) || estimatedRawBytes > budgetBytes) {
    throw new Error('GIF_MEMORY_BUDGET_EXCEEDED')
  }
  return { estimatedRawBytes, budgetBytes }
}

export async function validateGifBlob(blob: Blob): Promise<Blob> {
  if (!(blob instanceof Blob) || blob.size < 11) throw new Error('GIF_OUTPUT_INVALID')
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const signature = String.fromCharCode(...bytes.subarray(0, 6))
  let logicalLength = bytes.length
  while (logicalLength > 0 && bytes[logicalLength - 1] === 0x00) logicalLength--
  if ((signature !== 'GIF87a' && signature !== 'GIF89a') || bytes[logicalLength - 1] !== 0x3b) {
    throw new Error('GIF_OUTPUT_INVALID')
  }
  if (logicalLength === bytes.length) return blob

  // gif.js writes complete 4 KiB pages and leaves zero-filled bytes after the
  // GIF trailer. Strip only that known padding so the delivered data stream
  // ends at the GIF89a trailer and does not carry avoidable bytes.
  return new Blob([bytes.subarray(0, logicalLength)], { type: blob.type || 'image/gif' })
}

function positiveInteger(value: number): number | null {
  return Number.isSafeInteger(value) && value > 0 ? value : null
}
