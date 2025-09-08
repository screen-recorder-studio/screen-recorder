<!-- 视频导出面板组件 -->
<script lang="ts">
  import { ExportManager } from '$lib/services/export-manager'
  import { backgroundConfigStore } from '$lib/stores/background-config.svelte'

  // Props
  interface Props {
    encodedChunks?: any[]
    isRecordingComplete?: boolean
    className?: string
  }

  let {
    encodedChunks = [],
    isRecordingComplete = false,
    className = ''
  }: Props = $props()

  // 使用全局背景配置
  const backgroundConfig = $derived(backgroundConfigStore.config)

  // 导出状态
  let isExportingWebM = $state(false)
  let isExportingMP4 = $state(false)
  let exportProgress = $state<{
    type: 'webm' | 'mp4'
    stage: 'preparing' | 'compositing' | 'encoding' | 'muxing' | 'finalizing'
    progress: number
    currentFrame: number
    totalFrames: number
    estimatedTimeRemaining: number
  } | null>(null)

  // 导出管理器
  const exportManager = new ExportManager()

  // 检查是否可以导出
  const canExport = $derived(
    isRecordingComplete && 
    encodedChunks.length > 0 && 
    !isExportingWebM && 
    !isExportingMP4
  )

  // 导出 WebM
  async function exportWebM() {
    if (!canExport) return

    try {
      isExportingWebM = true
      exportProgress = {
        type: 'webm',
        stage: 'preparing',
        progress: 0,
        currentFrame: 0,
        totalFrames: encodedChunks.length,
        estimatedTimeRemaining: 0
      }

      console.log('🎬 [Export] Starting WebM export with', encodedChunks.length, 'chunks')

      // 将 Svelte 5 的 Proxy 对象转换为普通对象
      const plainBackgroundConfig = backgroundConfig ? {
        type: backgroundConfig.type,
        color: backgroundConfig.color,
        padding: backgroundConfig.padding,
        outputRatio: backgroundConfig.outputRatio,
        videoPosition: backgroundConfig.videoPosition,
        borderRadius: backgroundConfig.borderRadius,
        inset: backgroundConfig.inset,
        // 深度转换 shadow 对象
        shadow: backgroundConfig.shadow ? {
          offsetX: backgroundConfig.shadow.offsetX,
          offsetY: backgroundConfig.shadow.offsetY,
          blur: backgroundConfig.shadow.blur,
          color: backgroundConfig.shadow.color
        } : undefined
      } : undefined

      const videoBlob = await exportManager.exportEditedVideo(
        encodedChunks,
        {
          format: 'webm',
          includeBackground: !!plainBackgroundConfig,
          backgroundConfig: plainBackgroundConfig,
          quality: 'medium'
        },
        (progress) => {
          exportProgress = { ...progress, type: 'webm' }
        }
      )

      // 下载文件
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const filename = `edited-video-${timestamp}.webm`
      
      await downloadBlob(videoBlob, filename)
      
      console.log('✅ [Export] WebM export completed:', filename)

    } catch (error) {
      console.error('❌ [Export] WebM export failed:', error)
      // TODO: 显示错误提示
    } finally {
      isExportingWebM = false
      exportProgress = null
    }
  }

  // 导出 MP4
  async function exportMP4() {
    if (!canExport) return

    try {
      isExportingMP4 = true
      exportProgress = {
        type: 'mp4',
        stage: 'preparing',
        progress: 0,
        currentFrame: 0,
        totalFrames: encodedChunks.length,
        estimatedTimeRemaining: 0
      }

      console.log('🎬 [Export] Starting MP4 export with', encodedChunks.length, 'chunks')

      // 将 Svelte 5 的 Proxy 对象转换为普通对象
      const plainBackgroundConfig = backgroundConfig ? {
        type: backgroundConfig.type,
        color: backgroundConfig.color,
        padding: backgroundConfig.padding,
        outputRatio: backgroundConfig.outputRatio,
        videoPosition: backgroundConfig.videoPosition,
        borderRadius: backgroundConfig.borderRadius,
        inset: backgroundConfig.inset,
        // 深度转换 shadow 对象
        shadow: backgroundConfig.shadow ? {
          offsetX: backgroundConfig.shadow.offsetX,
          offsetY: backgroundConfig.shadow.offsetY,
          blur: backgroundConfig.shadow.blur,
          color: backgroundConfig.shadow.color
        } : undefined
      } : undefined

      const videoBlob = await exportManager.exportEditedVideo(
        encodedChunks,
        {
          format: 'mp4',
          includeBackground: !!plainBackgroundConfig,
          backgroundConfig: plainBackgroundConfig,
          quality: 'medium'
        },
        (progress) => {
          exportProgress = { ...progress, type: 'mp4' }
        }
      )

      // 下载文件
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const filename = `edited-video-${timestamp}.mp4`
      
      await downloadBlob(videoBlob, filename)
      
      console.log('✅ [Export] MP4 export completed:', filename)

    } catch (error) {
      console.error('❌ [Export] MP4 export failed:', error)
      // TODO: 显示错误提示
    } finally {
      isExportingMP4 = false
      exportProgress = null
    }
  }

  // 下载 Blob 文件
  async function downloadBlob(blob: Blob, filename: string) {
    try {
      // 尝试使用 Chrome API
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        const url = URL.createObjectURL(blob)
        
        chrome.runtime.sendMessage({
          action: 'saveRecording',
          filename,
          url
        }, (response) => {
          URL.revokeObjectURL(url)
          if (!response?.success) {
            // 降级到直接下载
            directDownload(blob, filename)
          }
        })
      } else {
        // 直接下载
        directDownload(blob, filename)
      }
    } catch (error) {
      console.error('Download failed:', error)
      directDownload(blob, filename)
    }
  }

  // 直接下载
  function directDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.style.display = 'none'
    
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  // 格式化进度阶段
  function formatStage(stage: string): string {
    const stageMap = {
      'preparing': '准备中',
      'compositing': '合成背景',
      'encoding': '编码中',
      'muxing': '封装容器',
      'finalizing': '完成中'
    }
    return stageMap[stage as keyof typeof stageMap] || stage
  }

  // 格式化时间
  function formatTime(seconds: number): string {
    if (seconds < 60) return `${Math.round(seconds)}秒`
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = Math.round(seconds % 60)
    return `${minutes}分${remainingSeconds}秒`
  }
</script>

<!-- 导出面板 -->
<div class="video-export-panel {className}">
  <div class="export-header">
    <h3 class="export-title">导出视频</h3>
    <div class="export-info">
      {#if encodedChunks.length > 0}
        <span class="chunk-count">{encodedChunks.length} 帧</span>
        {#if backgroundConfig}
          <span class="background-indicator">包含背景</span>
        {/if}
      {:else}
        <span class="no-data">暂无录制数据</span>
      {/if}
    </div>
  </div>

  <!-- 导出按钮 -->
  <div class="export-buttons">
    <button
      class="export-btn webm-btn"
      class:loading={isExportingWebM}
      disabled={!canExport}
      onclick={exportWebM}
    >
      {#if isExportingWebM}
        <div class="btn-spinner"></div>
        导出 WebM...
      {:else}
        📹 导出 WebM
      {/if}
    </button>

    <button
      class="export-btn mp4-btn"
      class:loading={isExportingMP4}
      disabled={!canExport}
      onclick={exportMP4}
    >
      {#if isExportingMP4}
        <div class="btn-spinner"></div>
        导出 MP4...
      {:else}
        🎥 导出 MP4
      {/if}
    </button>
  </div>

  <!-- 导出进度 -->
  {#if exportProgress}
    <div class="export-progress">
      <div class="progress-header">
        <span class="progress-title">
          导出 {exportProgress.type.toUpperCase()} - {formatStage(exportProgress.stage)}
        </span>
        <span class="progress-percentage">
          {Math.round(exportProgress.progress)}%
        </span>
      </div>
      
      <div class="progress-bar">
        <div 
          class="progress-fill {exportProgress.type}"
          style="width: {exportProgress.progress}%"
        ></div>
      </div>
      
      <div class="progress-details">
        <span class="frame-info">
          {exportProgress.currentFrame} / {exportProgress.totalFrames} 帧
        </span>
        {#if exportProgress.estimatedTimeRemaining > 0}
          <span class="time-remaining">
            剩余 {formatTime(exportProgress.estimatedTimeRemaining)}
          </span>
        {/if}
      </div>
    </div>
  {/if}

  <!-- 提示信息 -->
  {#if !isRecordingComplete}
    <div class="export-hint">
      <span class="hint-icon">ℹ️</span>
      请先完成录制后再导出视频
    </div>
  {:else if encodedChunks.length === 0}
    <div class="export-hint">
      <span class="hint-icon">⚠️</span>
      没有可导出的视频数据
    </div>
  {/if}
</div>

<style>
  .video-export-panel {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem;
    background-color: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
  }

  .export-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .export-title {
    font-size: 1rem;
    font-weight: 600;
    color: #1e293b;
    margin: 0;
  }

  .export-info {
    display: flex;
    gap: 0.5rem;
    font-size: 0.75rem;
  }

  .chunk-count {
    background-color: #3b82f6;
    color: white;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
  }

  .background-indicator {
    background-color: #10b981;
    color: white;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
  }

  .no-data {
    color: #64748b;
  }

  .export-buttons {
    display: flex;
    gap: 0.75rem;
  }

  .export-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    border: none;
    border-radius: 6px;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .webm-btn {
    background-color: #3b82f6;
    color: white;
  }

  .webm-btn:hover:not(:disabled) {
    background-color: #2563eb;
  }

  .mp4-btn {
    background-color: #10b981;
    color: white;
  }

  .mp4-btn:hover:not(:disabled) {
    background-color: #059669;
  }

  .export-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .export-btn.loading {
    opacity: 0.8;
  }

  .btn-spinner {
    width: 1rem;
    height: 1rem;
    border: 2px solid transparent;
    border-top-color: currentColor;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .export-progress {
    background-color: white;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 0.75rem;
  }

  .progress-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
  }

  .progress-title {
    font-size: 0.875rem;
    font-weight: 500;
    color: #374151;
  }

  .progress-percentage {
    font-size: 0.875rem;
    font-weight: 600;
    color: #1f2937;
  }

  .progress-bar {
    width: 100%;
    height: 6px;
    background-color: #f1f5f9;
    border-radius: 3px;
    overflow: hidden;
    margin-bottom: 0.5rem;
  }

  .progress-fill {
    height: 100%;
    transition: width 0.3s ease;
  }

  .progress-fill.webm {
    background-color: #3b82f6;
  }

  .progress-fill.mp4 {
    background-color: #10b981;
  }

  .progress-details {
    display: flex;
    justify-content: space-between;
    font-size: 0.75rem;
    color: #64748b;
  }

  .export-hint {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem;
    background-color: #fef3c7;
    border: 1px solid #f59e0b;
    border-radius: 6px;
    font-size: 0.875rem;
    color: #92400e;
  }

  .hint-icon {
    font-size: 1rem;
  }
</style>
