<script lang="ts">
  import { Play, Square, TriangleAlert, CircleCheck, Clock, Activity, Cpu } from '@lucide/svelte'

  // Props - 使用 Svelte 5 的类型化 props
  interface Props {
    isRecording: boolean
    status: 'idle' | 'requesting' | 'recording' | 'stopping' | 'error' | 'completed'
    disabled?: boolean
    onclick?: () => void
    class?: string
  }

  let {
    isRecording,
    status,
    disabled = false,
    onclick,
    class: className = ''
  }: Props = $props()

  // 计算属性 - 使用 $derived，正确的 Svelte 5 语法
  let buttonText = $derived(() => {
    switch (status) {
      case 'requesting':
        return '正在请求权限...'
      case 'stopping':
        return '正在停止录制...'
      case 'recording':
        return '停止录制'
      default:
        return '开始录制'
    }
  })

  let isLoading = $derived(status === 'requesting' || status === 'stopping')
  let isDisabled = $derived(disabled || isLoading)

  // 事件处理
  function handleClick() {
    if (!isDisabled && onclick) {
      onclick()
    }
  }
</script>

<!-- 录制控制区域 -->
<div class="flex flex-col gap-4 {className}">
  <!-- 主录制按钮 -->
  <button
    class="group relative flex items-center justify-center gap-4 px-8 py-5 rounded-2xl font-semibold text-base text-white transition-all duration-300 transform hover:scale-[1.02] active:scale-[0.98] shadow-xl hover:shadow-2xl disabled:opacity-60 disabled:cursor-not-allowed disabled:transform-none focus:outline-none focus:ring-4 focus:ring-opacity-50"
    class:bg-gradient-to-r={true}
    class:from-purple-600={!isRecording}
    class:to-purple-700={!isRecording}
    class:hover:from-purple-700={!isRecording}
    class:hover:to-purple-800={!isRecording}
    class:focus:ring-purple-300={!isRecording}
    class:from-red-500={isRecording}
    class:to-red-600={isRecording}
    class:hover:from-red-600={isRecording}
    class:hover:to-red-700={isRecording}
    class:focus:ring-red-300={isRecording}
    onclick={handleClick}
    disabled={isDisabled}
    type="button"
    aria-label={buttonText()}
  >
    <!-- 录制状态图标 -->
    <div class="flex items-center justify-center w-6 h-6">
      {#if isLoading}
        <div class="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
      {:else if isRecording}
        <Square class="w-6 h-6 fill-current drop-shadow-sm" />
      {:else}
        <Play class="w-6 h-6 fill-current drop-shadow-sm ml-0.5" />
      {/if}
    </div>

    <!-- 按钮文字 -->
    <span class="font-bold tracking-wide">
      {buttonText()}
    </span>

    <!-- 录制指示器 -->
    {#if isRecording}
      <div class="absolute -top-2 -right-2 w-4 h-4 bg-red-400 border-2 border-white rounded-full animate-pulse shadow-lg"></div>
    {/if}
  </button>

  <!-- 录制状态指示器 -->
  <div class="flex items-center justify-center">
    {#if status === 'idle'}
      <div class="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-full text-sm text-green-700">
        <CircleCheck class="w-4 h-4" />
        <span class="font-medium">系统就绪</span>
      </div>
    {:else if status === 'requesting'}
      <div class="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-full text-sm text-blue-700">
        <Clock class="w-4 h-4 animate-pulse" />
        <span class="font-medium">请求权限中</span>
      </div>
    {:else if status === 'recording'}
      <div class="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-full text-sm text-red-700">
        <Activity class="w-4 h-4 animate-pulse" />
        <span class="font-medium">正在录制</span>
      </div>
    {:else if status === 'stopping'}
      <div class="flex items-center gap-2 px-3 py-2 bg-orange-50 border border-orange-200 rounded-full text-sm text-orange-700">
        <Cpu class="w-4 h-4 animate-spin" />
        <span class="font-medium">处理中</span>
      </div>
    {:else if status === 'completed'}
      <div class="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-full text-sm text-green-700">
        <CircleCheck class="w-4 h-4" />
        <span class="font-medium">录制完成</span>
      </div>
    {:else if status === 'error'}
      <div class="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-full text-sm text-red-700">
        <TriangleAlert class="w-4 h-4" />
        <span class="font-medium">录制错误</span>
      </div>
    {/if}
  </div>
</div>