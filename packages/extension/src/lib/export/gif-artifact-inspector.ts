export interface GifArtifactInspection {
  version: 'GIF87a' | 'GIF89a'
  width: number
  height: number
  frameCount: number
  frameDelaysCentiseconds: number[]
  totalDelayCentiseconds: number
  repeat: number | null
  logicalLength: number
  physicalLength: number
  trailingPaddingBytes: number
}

const decoder = new TextDecoder('ascii')

/**
 * Parse the delivery-critical GIF container fields without decoding pixels.
 * The parser is intentionally strict so a Lab artifact cannot pass on a
 * signature alone while carrying a truncated block or non-zero tail.
 */
export function inspectGifBytes(bytes: Uint8Array): GifArtifactInspection {
  if (!(bytes instanceof Uint8Array) || bytes.length < 6) throw new Error('GIF_SIGNATURE_INVALID')
  const signature = decoder.decode(bytes.subarray(0, 6))
  if (signature !== 'GIF87a' && signature !== 'GIF89a') throw new Error('GIF_SIGNATURE_INVALID')
  if (bytes.length < 13) throw new Error('GIF_HEADER_TRUNCATED')

  const width = readUint16(bytes, 6)
  const height = readUint16(bytes, 8)
  const packed = bytes[10]
  let offset = 13
  if (packed & 0x80) {
    offset = requireAvailable(bytes, offset, colorTableBytes(packed), 'GIF_GLOBAL_COLOR_TABLE_TRUNCATED')
  }

  let repeat: number | null = null
  let pendingDelay = 0
  const frameDelaysCentiseconds: number[] = []

  while (offset < bytes.length) {
    const introducer = bytes[offset++]
    if (introducer === 0x3b) {
      const logicalLength = offset
      for (let index = offset; index < bytes.length; index++) {
        if (bytes[index] !== 0) throw new Error('GIF_TRAILING_DATA_INVALID')
      }
      return {
        version: signature,
        width,
        height,
        frameCount: frameDelaysCentiseconds.length,
        frameDelaysCentiseconds,
        totalDelayCentiseconds: frameDelaysCentiseconds.reduce((sum, delay) => sum + delay, 0),
        repeat,
        logicalLength,
        physicalLength: bytes.length,
        trailingPaddingBytes: bytes.length - logicalLength
      }
    }

    if (introducer === 0x21) {
      offset = requireAvailable(bytes, offset, 1, 'GIF_EXTENSION_TRUNCATED')
      const label = bytes[offset - 1]
      if (label === 0xf9) {
        const blockSizeOffset = requireAvailable(bytes, offset, 1, 'GIF_GCE_TRUNCATED')
        const blockSize = bytes[offset]
        if (blockSize !== 4) throw new Error('GIF_GCE_INVALID')
        offset = requireAvailable(bytes, blockSizeOffset, blockSize + 1, 'GIF_GCE_TRUNCATED')
        pendingDelay = readUint16(bytes, blockSizeOffset + 1)
        if (bytes[offset - 1] !== 0) throw new Error('GIF_GCE_INVALID')
        continue
      }

      if (label === 0xff || label === 0x01) {
        offset = requireAvailable(bytes, offset, 1, 'GIF_EXTENSION_TRUNCATED')
        const headerSize = bytes[offset - 1]
        const headerStart = offset
        offset = requireAvailable(bytes, offset, headerSize, 'GIF_EXTENSION_TRUNCATED')
        const applicationId = label === 0xff
          ? decoder.decode(bytes.subarray(headerStart, headerStart + headerSize))
          : ''
        const blocks = readSubBlocks(bytes, offset)
        offset = blocks.offset
        if ((applicationId === 'NETSCAPE2.0' || applicationId === 'ANIMEXTS1.0')
          && blocks.first?.length === 3 && blocks.first[0] === 1) {
          repeat = blocks.first[1] | (blocks.first[2] << 8)
        }
        continue
      }

      offset = readSubBlocks(bytes, offset).offset
      continue
    }

    if (introducer === 0x2c) {
      const descriptorStart = offset
      offset = requireAvailable(bytes, offset, 9, 'GIF_IMAGE_DESCRIPTOR_TRUNCATED')
      const imagePacked = bytes[descriptorStart + 8]
      if (imagePacked & 0x80) {
        offset = requireAvailable(bytes, offset, colorTableBytes(imagePacked), 'GIF_LOCAL_COLOR_TABLE_TRUNCATED')
      }
      offset = requireAvailable(bytes, offset, 1, 'GIF_IMAGE_DATA_TRUNCATED') // LZW minimum code size
      offset = readSubBlocks(bytes, offset).offset
      frameDelaysCentiseconds.push(pendingDelay)
      pendingDelay = 0
      continue
    }

    throw new Error('GIF_BLOCK_INVALID')
  }

  throw new Error('GIF_TRAILER_MISSING')
}

export async function inspectGifBlob(blob: Blob): Promise<GifArtifactInspection> {
  if (!(blob instanceof Blob)) throw new Error('GIF_BLOB_INVALID')
  return inspectGifBytes(new Uint8Array(await blob.arrayBuffer()))
}

function colorTableBytes(packed: number): number {
  return 3 * (2 ** ((packed & 0x07) + 1))
}

function readUint16(bytes: Uint8Array, offset: number): number {
  if (offset + 2 > bytes.length) throw new Error('GIF_UINT16_TRUNCATED')
  return bytes[offset] | (bytes[offset + 1] << 8)
}

function requireAvailable(bytes: Uint8Array, offset: number, length: number, code: string): number {
  if (length < 0 || offset < 0 || offset + length > bytes.length) throw new Error(code)
  return offset + length
}

function readSubBlocks(bytes: Uint8Array, initialOffset: number): { offset: number; first: Uint8Array | null } {
  let offset = initialOffset
  let first: Uint8Array | null = null
  while (true) {
    offset = requireAvailable(bytes, offset, 1, 'GIF_SUB_BLOCK_TRUNCATED')
    const length = bytes[offset - 1]
    if (length === 0) return { offset, first }
    const start = offset
    offset = requireAvailable(bytes, offset, length, 'GIF_SUB_BLOCK_TRUNCATED')
    if (!first) first = bytes.subarray(start, offset)
  }
}
