<script lang="ts">
  import { Check, X, RotateCcw, Crop } from '@lucide/svelte'
  import { videoCropStore } from '$lib/stores/video-crop.svelte'
  
  interface Props {
    // 当前帧的 ImageBitmap
    frameBitmap: ImageBitmap
    // 原始视频尺寸
    videoWidth: number
    videoHeight: number
    // 显示区域尺寸
    displayWidth: number
    displayHeight: number
    // 回调
    onConfirm?: () => void
    onCancel?: () => void
  }
  
  let {
    frameBitmap,
    videoWidth,
    videoHeight,
    displayWidth,
    displayHeight,
    onConfirm,
    onCancel
  }: Props = $props()
  
  // Canvas 用于显示当前帧
  let canvas: HTMLCanvasElement
  let ctx: CanvasRenderingContext2D | null = null
  
  // 计算适配后的显示尺寸（保持视频纵横比）
  const displayAspect = $derived(displayWidth / displayHeight)
  const videoAspect = $derived(videoWidth / videoHeight)
  
  const frameDisplaySize = $derived(() => {
    let width, height
    if (videoAspect > displayAspect) {
      // 视频更宽，以宽度为准
      width = displayWidth
      height = displayWidth / videoAspect
    } else {
      // 视频更高，以高度为准
      height = displayHeight
      width = displayHeight * videoAspect
    }
    return { width, height }
  })
  
  // Canvas 偏移（居中显示）
  const canvasOffset = $derived(() => {
    return {
      x: (displayWidth - frameDisplaySize().width) / 2,
      y: (displayHeight - frameDisplaySize().height) / 2
    }
  })
  
  // 裁剪框状态（Canvas 像素坐标，相对于 Canvas 左上角）
  let cropBox = $state({
    x: 0,
    y: 0,
    width: videoWidth,
    height: videoHeight
  })
  
  // 拖拽状态
  let isDragging = $state(false)
  let dragMode = $state<'move' | 'resize-nw' | 'resize-ne' | 'resize-sw' | 'resize-se' | 'resize-n' | 'resize-s' | 'resize-w' | 'resize-e' | null>(null)
  let dragStartX = $state(0)
  let dragStartY = $state(0)
  let dragStartBox = $state({ x: 0, y: 0, width: 0, height: 0 })
  
  // 初始化 Canvas 并绘制当前帧
  $effect(() => {
    if (canvas && frameBitmap) {
      canvas.width = videoWidth
      canvas.height = videoHeight
      
      ctx = canvas.getContext('2d')
      if (ctx) {
        // 绘制当前帧
        ctx.drawImage(frameBitmap, 0, 0, videoWidth, videoHeight)
        
        console.log('🎨 [VideoCrop] Frame rendered:', {
          videoSize: { width: videoWidth, height: videoHeight },
          bitmapSize: { width: frameBitmap.width, height: frameBitmap.height }
        })
      }
    }
  })
  
  // 初始化裁剪框（如果已有裁剪配置）
  $effect(() => {
    if (videoCropStore.enabled && videoCropStore.mode === 'percentage') {
      cropBox = {
        x: Math.round(videoCropStore.xPercent * videoWidth),
        y: Math.round(videoCropStore.yPercent * videoHeight),
        width: Math.round(videoCropStore.widthPercent * videoWidth),
        height: Math.round(videoCropStore.heightPercent * videoHeight)
      }
    } else {
      // 默认：居中 80% 区域
      const margin = 0.1
      cropBox = {
        x: Math.round(videoWidth * margin),
        y: Math.round(videoHeight * margin),
        width: Math.round(videoWidth * 0.8),
        height: Math.round(videoHeight * 0.8)
      }
    }
  })
  
  // 绘制裁剪框覆盖层
  $effect(() => {
    if (!ctx || !frameBitmap) return
    
    // 重绘当前帧
    ctx.clearRect(0, 0, videoWidth, videoHeight)
    ctx.drawImage(frameBitmap, 0, 0, videoWidth, videoHeight)
    
    // 绘制半透明遮罩（非裁剪区域）
    ctx.save()
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
    
    // 使用合成模式创建镂空效果
    ctx.fillRect(0, 0, videoWidth, videoHeight)
    ctx.globalCompositeOperation = 'destination-out'
    ctx.fillRect(cropBox.x, cropBox.y, cropBox.width, cropBox.height)
    ctx.globalCompositeOperation = 'source-over'
    
    // 绘制裁剪框边框
    ctx.strokeStyle = '#3b82f6'  // blue-500
    ctx.lineWidth = 2
    ctx.strokeRect(cropBox.x, cropBox.y, cropBox.width, cropBox.height)
    
    // 绘制九宫格辅助线
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)'
    ctx.lineWidth = 1
    
    // 横线
    ctx.beginPath()
    ctx.moveTo(cropBox.x, cropBox.y + cropBox.height / 3)
    ctx.lineTo(cropBox.x + cropBox.width, cropBox.y + cropBox.height / 3)
    ctx.stroke()
    
    ctx.beginPath()
    ctx.moveTo(cropBox.x, cropBox.y + cropBox.height * 2 / 3)
    ctx.lineTo(cropBox.x + cropBox.width, cropBox.y + cropBox.height * 2 / 3)
    ctx.stroke()
    
    // 竖线
    ctx.beginPath()
    ctx.moveTo(cropBox.x + cropBox.width / 3, cropBox.y)
    ctx.lineTo(cropBox.x + cropBox.width / 3, cropBox.y + cropBox.height)
    ctx.stroke()
    
    ctx.beginPath()
    ctx.moveTo(cropBox.x + cropBox.width * 2 / 3, cropBox.y)
    ctx.lineTo(cropBox.x + cropBox.width * 2 / 3, cropBox.y + cropBox.height)
    ctx.stroke()
    
    ctx.restore()
  })
  
  // Canvas 坐标 → 屏幕坐标（用于控制点定位）
  function canvasToScreen(canvasX: number, canvasY: number) {
    const scale = frameDisplaySize().width / videoWidth
    return {
      x: canvasOffset().x + canvasX * scale,
      y: canvasOffset().y + canvasY * scale
    }
  }
  
  // 屏幕坐标 → Canvas 坐标（用于拖拽计算）
  function screenToCanvas(screenX: number, screenY: number) {
    const scale = frameDisplaySize().width / videoWidth
    return {
      x: (screenX - canvasOffset().x) / scale,
      y: (screenY - canvasOffset().y) / scale
    }
  }
  
  // 拖拽处理
  function handleMouseDown(e: MouseEvent, mode: typeof dragMode) {
    e.preventDefault()
    e.stopPropagation()
    
    isDragging = true
    dragMode = mode
    
    // 获取相对于 Canvas 容器的坐标
    const rect = canvas.getBoundingClientRect()
    dragStartX = e.clientX - rect.left
    dragStartY = e.clientY - rect.top
    dragStartBox = { ...cropBox }
    
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }
  
  function handleMouseMove(e: MouseEvent) {
    if (!isDragging || !dragMode) return
    
    const rect = canvas.getBoundingClientRect()
    const currentX = e.clientX - rect.left
    const currentY = e.clientY - rect.top
    
    // 转换为 Canvas 坐标
    const startCanvas = screenToCanvas(dragStartX, dragStartY)
    const currentCanvas = screenToCanvas(currentX, currentY)
    
    const dx = currentCanvas.x - startCanvas.x
    const dy = currentCanvas.y - startCanvas.y
    
    if (dragMode === 'move') {
      // 移动裁剪框
      let newX = dragStartBox.x + dx
      let newY = dragStartBox.y + dy
      
      // 边界限制
      newX = Math.max(0, Math.min(newX, videoWidth - cropBox.width))
      newY = Math.max(0, Math.min(newY, videoHeight - cropBox.height))
      
      cropBox.x = Math.round(newX)
      cropBox.y = Math.round(newY)
    } else if (dragMode?.startsWith('resize-')) {
      // 调整大小
      const minSize = 100  // 最小尺寸（视频像素）
      
      let newBox = { ...dragStartBox }
      
      if (dragMode.includes('n')) {
        newBox.y = dragStartBox.y + dy
        newBox.height = dragStartBox.height - dy
      }
      if (dragMode.includes('s')) {
        newBox.height = dragStartBox.height + dy
      }
      if (dragMode.includes('w')) {
        newBox.x = dragStartBox.x + dx
        newBox.width = dragStartBox.width - dx
      }
      if (dragMode.includes('e')) {
        newBox.width = dragStartBox.width + dx
      }
      
      // 边界和最小尺寸限制
      if (newBox.width >= minSize && newBox.x >= 0 && newBox.x + newBox.width <= videoWidth) {
        cropBox.x = Math.round(newBox.x)
        cropBox.width = Math.round(newBox.width)
      }
      if (newBox.height >= minSize && newBox.y >= 0 && newBox.y + newBox.height <= videoHeight) {
        cropBox.y = Math.round(newBox.y)
        cropBox.height = Math.round(newBox.height)
      }
    }
  }
  
  function handleMouseUp() {
    isDragging = false
    dragMode = null
    
    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', handleMouseUp)
  }
  
  // 应用裁剪
  function applyCrop() {
    // 转换为百分比
    videoCropStore.enabled = true
    videoCropStore.mode = 'percentage'
    videoCropStore.xPercent = cropBox.x / videoWidth
    videoCropStore.yPercent = cropBox.y / videoHeight
    videoCropStore.widthPercent = cropBox.width / videoWidth
    videoCropStore.heightPercent = cropBox.height / videoHeight
    
    // 同步像素坐标
    videoCropStore.x = cropBox.x
    videoCropStore.y = cropBox.y
    videoCropStore.width = cropBox.width
    videoCropStore.height = cropBox.height
    
    console.log('✂️ [VideoCrop] Applied crop:', {
      pixels: cropBox,
      percent: {
        x: videoCropStore.xPercent,
        y: videoCropStore.yPercent,
        width: videoCropStore.widthPercent,
        height: videoCropStore.heightPercent
      }
    })
    
    onConfirm?.()
  }
  
  // 重置裁剪
  function resetCrop() {
    cropBox = {
      x: 0,
      y: 0,
      width: videoWidth,
      height: videoHeight
    }
  }
  
  // 应用预设比例
  function applyPreset(widthRatio: number, heightRatio: number) {
    const targetRatio = widthRatio / heightRatio
    const currentRatio = cropBox.width / cropBox.height
    
    if (targetRatio > currentRatio) {
      // 宽度受限
      const newHeight = cropBox.width / targetRatio
      cropBox.y += (cropBox.height - newHeight) / 2
      cropBox.height = newHeight
    } else {
      // 高度受限
      const newWidth = cropBox.height * targetRatio
      cropBox.x += (cropBox.width - newWidth) / 2
      cropBox.width = newWidth
    }
    
    // 确保在边界内
    cropBox.x = Math.max(0, Math.round(cropBox.x))
    cropBox.y = Math.max(0, Math.round(cropBox.y))
    cropBox.width = Math.round(cropBox.width)
    cropBox.height = Math.round(cropBox.height)
  }
  
  // 取消裁剪
  function cancelCrop() {
    onCancel?.()
  }
</script>

<div class="flex flex-col h-full bg-gray-900 rounded-lg overflow-hidden">
  <!-- Header -->
  <div class="flex-shrink-0 flex justify-between items-center p-3 border-b border-gray-700 bg-gray-800">
    <div class="flex items-center gap-2">
      <Crop class="w-4 h-4 text-blue-400" />
      <span class="text-sm font-semibold text-gray-100">Crop Video</span>
      <span class="text-xs text-gray-400">Drag to adjust crop area</span>
    </div>
    
    <!-- Current dimensions display -->
    <div class="text-xs font-mono text-gray-300 bg-gray-900 px-3 py-1.5 rounded">
      {cropBox.width} × {cropBox.height}
      <span class="text-gray-500 ml-1">
        ({((cropBox.width / videoWidth) * 100).toFixed(0)}% × {((cropBox.height / videoHeight) * 100).toFixed(0)}%)
      </span>
    </div>
  </div>
  
  <!-- Canvas display area -->
  <div class="flex-1 flex items-center justify-center p-4 min-h-0 relative">
    <div 
      class="relative bg-black flex items-center justify-center"
      style="width: {displayWidth}px; height: {displayHeight}px;"
    >
      <!-- Canvas displays current frame + crop overlay -->
      <canvas
        bind:this={canvas}
        class="block rounded cursor-move"
        style="
          width: {frameDisplaySize().width}px; 
          height: {frameDisplaySize().height}px;
          position: absolute;
          left: {canvasOffset().x}px;
          top: {canvasOffset().y}px;
        "
        onmousedown={(e) => {
          // 检查是否点击在裁剪框内
          const rect = canvas.getBoundingClientRect()
          const clickX = e.clientX - rect.left
          const clickY = e.clientY - rect.top
          const canvasClick = screenToCanvas(clickX, clickY)
          
          if (
            canvasClick.x >= cropBox.x &&
            canvasClick.x <= cropBox.x + cropBox.width &&
            canvasClick.y >= cropBox.y &&
            canvasClick.y <= cropBox.y + cropBox.height
          ) {
            handleMouseDown(e, 'move')
          }
        }}
      ></canvas>
      
      <!-- 8 resize handles (overlaid on Canvas) -->
      {#each [
        { pos: 'nw', cursor: 'nw-resize', x: cropBox.x, y: cropBox.y },
        { pos: 'n', cursor: 'n-resize', x: cropBox.x + cropBox.width / 2, y: cropBox.y },
        { pos: 'ne', cursor: 'ne-resize', x: cropBox.x + cropBox.width, y: cropBox.y },
        { pos: 'w', cursor: 'w-resize', x: cropBox.x, y: cropBox.y + cropBox.height / 2 },
        { pos: 'e', cursor: 'e-resize', x: cropBox.x + cropBox.width, y: cropBox.y + cropBox.height / 2 },
        { pos: 'sw', cursor: 'sw-resize', x: cropBox.x, y: cropBox.y + cropBox.height },
        { pos: 's', cursor: 's-resize', x: cropBox.x + cropBox.width / 2, y: cropBox.y + cropBox.height },
        { pos: 'se', cursor: 'se-resize', x: cropBox.x + cropBox.width, y: cropBox.y + cropBox.height }
      ] as handle}
        {@const screenPos = canvasToScreen(handle.x, handle.y)}
        <div
          role="button"
          tabindex="0"
          class="absolute w-3 h-3 bg-white border-2 border-blue-500 rounded-full hover:scale-125 transition-transform z-10"
          style="
            left: {screenPos.x - 6}px;
            top: {screenPos.y - 6}px;
            cursor: {handle.cursor};
          "
          onmousedown={(e) => handleMouseDown(e, `resize-${handle.pos}`)}
          onkeydown={(e) => e.key === 'Enter' && handleMouseDown(e as any, `resize-${handle.pos}`)}
        ></div>
      {/each}
    </div>
  </div>
  
  <!-- Toolbar -->
  <div class="flex-shrink-0 p-4 border-t border-gray-700 bg-gray-800">
    <div class="flex items-center justify-between gap-4">
      <!-- Aspect ratio presets -->
      <div class="flex items-center gap-2">
        <span class="text-xs text-gray-400">Aspect Ratio:</span>
        <div class="flex gap-1">
          <button 
            class="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-white rounded transition"
            onclick={() => applyPreset(16, 9)}
          >
            16:9
          </button>
          <button 
            class="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-white rounded transition"
            onclick={() => applyPreset(1, 1)}
          >
            1:1
          </button>
          <button 
            class="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-white rounded transition"
            onclick={() => applyPreset(4, 3)}
          >
            4:3
          </button>
          <button 
            class="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-white rounded transition"
            onclick={() => applyPreset(9, 16)}
          >
            9:16
          </button>
        </div>
      </div>
      
      <!-- Action buttons -->
      <div class="flex items-center gap-2">
        <!-- Reset -->
        <button 
          class="px-3 py-1.5 text-sm text-gray-400 hover:text-white hover:bg-gray-700 rounded transition flex items-center gap-1"
          onclick={resetCrop}
        >
          <RotateCcw class="w-4 h-4" />
          Reset
        </button>
        
        <!-- Cancel -->
        <button 
          class="px-4 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 text-white rounded transition flex items-center gap-1"
          onclick={cancelCrop}
        >
          <X class="w-4 h-4" />
          Cancel
        </button>
        
        <!-- Apply -->
        <button 
          class="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded transition flex items-center gap-1"
          onclick={applyCrop}
        >
          <Check class="w-4 h-4" />
          Apply
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  canvas {
    image-rendering: -webkit-optimize-contrast;
    image-rendering: crisp-edges;
  }
</style>
