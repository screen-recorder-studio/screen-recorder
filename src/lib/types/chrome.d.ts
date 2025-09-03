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
}