// Chrome API 类型定义
declare namespace chrome {
  namespace desktopCapture {
    type DesktopCaptureSourceType = 'screen' | 'window' | 'tab' | 'audio'
    
    interface ChooseDesktopMediaOptions {
      sources: DesktopCaptureSourceType[]
      targetTab?: chrome.tabs.Tab
    }
    
    function chooseDesktopMedia(
      sources: DesktopCaptureSourceType[],
      callback: (streamId: string, options: { canRequestAudioTrack: boolean }) => void
    ): number
    
    function cancelChooseDesktopMedia(desktopMediaRequestId: number): void
  }
  
  namespace sidePanel {
    interface OpenOptions {
      tabId?: number
      windowId?: number
    }

    function open(options: OpenOptions): Promise<void>
  }

  namespace downloads {
    interface DownloadOptions {
      url: string
      filename?: string
      saveAs?: boolean
    }

    function download(
      options: DownloadOptions,
      callback?: (downloadId: number) => void
    ): void
  }

  namespace storage {
    namespace local {
      function get(
        keys: string | string[] | { [key: string]: any } | null,
        callback: (items: { [key: string]: any }) => void
      ): void

      function set(
        items: { [key: string]: any },
        callback?: () => void
      ): void
    }
  }

  namespace runtime {
    interface MessageSender {
      tab?: chrome.tabs.Tab
      frameId?: number
      id?: string
      url?: string
      tlsChannelId?: string
    }

    function sendMessage(
      message: any,
      responseCallback?: (response: any) => void
    ): void

    const onMessage: {
      addListener(
        callback: (
          message: any,
          sender: MessageSender,
          sendResponse: (response?: any) => void
        ) => boolean | void
      ): void
      removeListener(
        callback: (
          message: any,
          sender: MessageSender,
          sendResponse: (response?: any) => void
        ) => boolean | void
      ): void
    }

    const lastError: chrome.runtime.LastError | undefined
  }

  namespace tabs {
    interface Tab {
      id?: number
      index: number
      windowId: number
      highlighted: boolean
      active: boolean
      pinned: boolean
      url?: string
      title?: string
      favIconUrl?: string
      status?: string
      incognito: boolean
      width?: number
      height?: number
      sessionId?: string
    }
  }

  namespace permissions {
    function contains(
      permissions: { permissions: string[] },
      callback: (result: boolean) => void
    ): void
  }
}

// WebCodecs API 类型定义
declare class VideoEncoder {
  constructor(init: VideoEncoderInit)
  configure(config: VideoEncoderConfig): void
  encode(frame: VideoFrame): void
  flush(): Promise<void>
  close(): void
  static isConfigSupported(config: VideoEncoderConfig): Promise<VideoEncoderSupport>
}

declare class MediaStreamTrackProcessor {
  constructor(init: { track: MediaStreamTrack })
  readonly readable: ReadableStream<VideoFrame>
}

declare class VideoFrame {
  close(): void
}

declare interface VideoEncoderInit {
  output: (chunk: EncodedVideoChunk, metadata?: EncodedVideoChunkMetadata) => void
  error: (error: Error) => void
}

declare interface VideoEncoderConfig {
  codec: string
  width: number
  height: number
  bitrate: number
  framerate: number
  latencyMode?: 'quality' | 'realtime'
  bitrateMode?: 'constant' | 'variable'
}

declare interface VideoEncoderSupport {
  supported: boolean
  config?: VideoEncoderConfig
}

declare class EncodedVideoChunk {
  readonly byteLength: number
  copyTo(destination: ArrayBuffer | ArrayBufferView): void
}

declare interface EncodedVideoChunkMetadata {
  [key: string]: any
}

// Navigator GPU 扩展
declare interface Navigator {
  gpu?: {
    requestAdapter(): Promise<any>
  }
}

// 扩展全局类型
interface Window {
  chrome: typeof chrome
}