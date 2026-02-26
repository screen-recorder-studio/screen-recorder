// Chrome API 封装类
import type { RecordingError } from '$lib/types/recording'

export interface ScreenCaptureResponse {
  success: boolean
  streamId?: string
  canRequestAudioTrack?: boolean
  error?: string
  details?: string
}

export interface SaveRecordingResponse {
  success: boolean
  downloadId?: number
  error?: string
  details?: string
}

export interface SettingsResponse {
  success: boolean
  settings?: UserSettings
  error?: string
}

export interface UserSettings {
  videoQuality: 'high' | 'medium' | 'low'
  audioEnabled: boolean
  autoDownload: boolean
  filenameTemplate: string
  maxDuration: number
  preferredSources: chrome.desktopCapture.DesktopCaptureSourceType[]
}

export class ChromeAPIWrapper {
  /**
   * 请求屏幕捕获权限
   */
  static async requestDesktopCapture(
    sources: chrome.desktopCapture.DesktopCaptureSourceType[] = ['screen', 'window', 'tab']
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!chrome?.runtime) {
        reject(new Error('Chrome runtime not available'))
        return
      }

      chrome.runtime.sendMessage(
        {
          action: 'requestScreenCapture',
          sources
        },
        (response: ScreenCaptureResponse) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message))
            return
          }

          if (response.success && response.streamId) {
            resolve(response.streamId)
          } else {
            reject(new Error(response.error || 'Desktop capture failed'))
          }
        }
      )
    })
  }

  /**
   * 开始录制（使用offscreen document）
   */
  static async startRecording(streamId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!chrome?.runtime) {
        reject(new Error('Chrome runtime not available'))
        return
      }

      chrome.runtime.sendMessage(
        {
          action: 'startRecording',
          streamId
        },
        (response: any) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message))
            return
          }

          if (response.success) {
            resolve()
          } else {
            reject(new Error(response.error || 'Failed to start recording'))
          }
        }
      )
    })
  }

  /**
   * 停止录制（使用offscreen document）
   */
  static async stopRecording(): Promise<{ videoUrl: string; videoSize: number; mimeType: string }> {
    return new Promise((resolve, reject) => {
      if (!chrome?.runtime) {
        reject(new Error('Chrome runtime not available'))
        return
      }

      chrome.runtime.sendMessage(
        {
          action: 'stopRecording'
        },
        (response: any) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message))
            return
          }

          if (response.success) {
            resolve({
              videoUrl: response.videoUrl,
              videoSize: response.videoSize,
              mimeType: response.mimeType
            })
          } else {
            reject(new Error(response.error || 'Failed to stop recording'))
          }
        }
      )
    })
  }

  /**
   * 从 streamId 获取 MediaStream（保留用于兼容性）
   */
  static async getUserMediaFromStreamId(streamId: string): Promise<MediaStream> {
    try {
      console.log('Getting media stream for streamId:', streamId)

      // Chrome扩展的正确约束格式（与工作版本保持一致）
      const constraints = {
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: streamId
          }
        }
      }

      console.log('Using constraints:', constraints)
      console.log('Calling navigator.mediaDevices.getUserMedia...')

      // 使用 getUserMedia 获取媒体流（与工作版本保持一致）
      const stream = await navigator.mediaDevices.getUserMedia(constraints as any)

      console.log('getUserMedia returned:', stream)

      if (!stream) {
        throw new Error('Failed to get media stream')
      }

      // 检查视频轨道
      const videoTracks = stream.getVideoTracks()
      if (videoTracks.length === 0) {
        throw new Error('No video tracks found in media stream')
      }

      // 检查视频轨道状态
      const videoTrack = videoTracks[0]
      if (videoTrack.readyState !== 'live') {
        throw new Error(`Video track not ready: ${videoTrack.readyState}`)
      }

      console.log('Media stream obtained successfully:', {
        id: stream.id,
        videoTracks: videoTracks.length,
        audioTracks: stream.getAudioTracks().length,
        videoTrackState: videoTrack.readyState,
        videoTrackLabel: videoTrack.label
      })

      return stream
    } catch (error) {
      console.error('Error getting media stream:', error)

      // 提供更详细的错误信息
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new Error(`AbortError: ${error.message}`)
        } else if (error.name === 'NotAllowedError') {
          throw new Error(`NotAllowedError: ${error.message}`)
        } else if (error.name === 'NotFoundError') {
          throw new Error(`NotFoundError: ${error.message}`)
        } else if (error.name === 'InvalidStateError') {
          throw new Error(`Invalid state: ${error.message}`)
        }
      }

      throw new Error(`Failed to get media stream: ${error}`)
    }
  }

  /**
   * 从URL保存视频文件
   */
  static async saveVideoFromUrl(url: string, filename: string): Promise<number> {
    return new Promise((resolve, reject) => {
      if (!chrome?.runtime) {
        reject(new Error('Chrome runtime not available'))
        return
      }

      chrome.runtime.sendMessage(
        {
          action: 'saveRecording',
          filename,
          url
        },
        (response: SaveRecordingResponse) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message))
            return
          }

          if (response.success && response.downloadId) {
            resolve(response.downloadId)
          } else {
            reject(new Error(response.error || 'Save failed'))
          }
        }
      )
    })
  }

  /**
   * 保存录制的视频文件
   */
  static async saveVideo(blob: Blob, filename: string): Promise<number> {
    return new Promise((resolve, reject) => {
      if (!chrome?.runtime) {
        reject(new Error('Chrome runtime not available'))
        return
      }

      // 创建 blob URL
      const url = URL.createObjectURL(blob)
      
      chrome.runtime.sendMessage(
        {
          action: 'saveRecording',
          filename,
          url
        },
        (response: SaveRecordingResponse) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message))
            return
          }

          if (response.success && response.downloadId) {
            resolve(response.downloadId)
            
            // 延迟清理 URL，确保下载开始
            setTimeout(() => URL.revokeObjectURL(url), 5000)
          } else {
            URL.revokeObjectURL(url)
            reject(new Error(response.error || 'Save failed'))
          }
        }
      )
    })
  }

  /**
   * 获取存储的数据
   */
  static async getStorageData<T>(key: string): Promise<T | null> {
    return new Promise((resolve, reject) => {
      if (!chrome?.storage) {
        reject(new Error('Chrome storage not available'))
        return
      }

      chrome.storage.local.get([key], (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
          return
        }

        resolve(result[key] || null)
      })
    })
  }

  /**
   * 设置存储数据
   */
  static async setStorageData<T>(key: string, value: T): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!chrome?.storage) {
        reject(new Error('Chrome storage not available'))
        return
      }

      chrome.storage.local.set({ [key]: value }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
          return
        }

        resolve()
      })
    })
  }

  /**
   * 获取用户设置
   */
  static async getSettings(): Promise<UserSettings> {
    return new Promise((resolve, reject) => {
      if (!chrome?.runtime) {
        reject(new Error('Chrome runtime not available'))
        return
      }

      chrome.runtime.sendMessage(
        { action: 'getSettings' },
        (response: SettingsResponse) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message))
            return
          }

          if (response.success) {
            // 提供默认设置
            const defaultSettings: UserSettings = {
              videoQuality: 'medium',
              audioEnabled: true,
              autoDownload: true,
              filenameTemplate: 'screen-recording-{timestamp}',
              maxDuration: 3600,
              preferredSources: ['screen', 'window', 'tab']
            }

            resolve({ ...defaultSettings, ...response.settings })
          } else {
            reject(new Error(response.error || 'Failed to get settings'))
          }
        }
      )
    })
  }

  /**
   * 更新用户设置
   */
  static async updateSettings(settings: Partial<UserSettings>): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!chrome?.runtime) {
        reject(new Error('Chrome runtime not available'))
        return
      }

      chrome.runtime.sendMessage(
        {
          action: 'updateSettings',
          settings
        },
        (response: SettingsResponse) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message))
            return
          }

          if (response.success) {
            resolve()
          } else {
            reject(new Error(response.error || 'Failed to update settings'))
          }
        }
      )
    })
  }

  /**
   * 打开 sidepanel
   */
  static async openSidePanel(tabId?: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!chrome?.runtime) {
        reject(new Error('Chrome runtime not available'))
        return
      }

      chrome.runtime.sendMessage(
        {
          action: 'openSidePanel',
          tabId
        },
        (response: { success: boolean; error?: string }) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message))
            return
          }

          if (response.success) {
            resolve()
          } else {
            reject(new Error(response.error || 'Failed to open sidepanel'))
          }
        }
      )
    })
  }

  /**
   * 生成带时间戳的文件名
   */
  static generateFilename(template: string = 'screen-recording-{timestamp}'): string {
    const now = new Date()
    const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, -5)
    const dateStr = now.toLocaleDateString('zh-CN').replace(/\//g, '-')
    const timeStr = now.toLocaleTimeString('zh-CN', { hour12: false }).replace(/:/g, '')

    return template
      .replace('{timestamp}', timestamp)
      .replace('{date}', dateStr)
      .replace('{time}', timeStr)
      .replace('{datetime}', `${dateStr}_${timeStr}`)
  }

  /**
   * 检查 Chrome 扩展环境
   */
  static isExtensionEnvironment(): boolean {
    return !!(chrome && chrome.runtime && chrome.runtime.id)
  }

  /**
   * 检查必要的权限
   */
  static async checkPermissions(): Promise<{
    desktopCapture: boolean
    downloads: boolean
    storage: boolean
    sidePanel: boolean
  }> {
    // 检查是否在浏览器环境中
    if (typeof window === 'undefined' || !chrome?.permissions) {
      return {
        desktopCapture: false,
        downloads: false,
        storage: false,
        sidePanel: false
      }
    }

    return new Promise((resolve) => {
      chrome.permissions.contains(
        {
          permissions: ['desktopCapture', 'downloads', 'storage', 'sidePanel']
        },
        (result) => {
          resolve({
            desktopCapture: result,
            downloads: result,
            storage: result,
            sidePanel: result
          })
        }
      )
    })
  }

  /**
   * 客户端下载备用方案（当 Chrome API 不可用时）
   */
  static downloadBlobDirectly(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.style.display = 'none'
    
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    
    // 清理 URL
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  /**
   * 智能保存方法（优先使用 Chrome API，降级到客户端下载）
   */
  static async saveVideoSmart(blob: Blob, filename: string): Promise<number | null> {
    try {
      // 优先尝试 Chrome API
      if (this.isExtensionEnvironment()) {
        return await this.saveVideo(blob, filename)
      }
    } catch (error) {
      console.warn('Chrome API save failed, falling back to direct download:', error)
    }
    
    // 降级到客户端下载
    this.downloadBlobDirectly(blob, filename)
    return null
  }

  /**
   * 监听下载完成事件
   */
  static onDownloadComplete(callback: (downloadId: number) => void): void {
    if (!chrome?.runtime) return

    chrome.runtime.onMessage.addListener((message) => {
      if (message.action === 'downloadComplete' && message.downloadId) {
        callback(message.downloadId)
      }
    })
  }
}