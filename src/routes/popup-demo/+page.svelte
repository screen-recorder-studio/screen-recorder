<!-- Popup 演示页面 - 用于开发环境预览 -->
<script lang="ts">
  import PopupPage from '../popup/+page.svelte'
</script>

<svelte:head>
  <title>Popup 演示 - 屏幕录制扩展</title>
</svelte:head>

<div class="min-h-screen bg-gray-100 py-8">
  <div class="max-w-4xl mx-auto px-4">
    <div class="text-center mb-8">
      <h1 class="text-3xl font-bold text-gray-900 mb-2">屏幕录制扩展 Popup 演示</h1>
      <p class="text-gray-600">这是 Chrome 扩展 popup 页面的预览效果</p>
    </div>
    
    <div class="flex justify-center">
      <!-- 模拟浏览器扩展弹窗的容器 -->
      <div class="bg-white rounded-lg shadow-2xl border border-gray-300 overflow-hidden">
        <!-- 模拟浏览器扩展标题栏 -->
        <div class="bg-gray-100 px-3 py-2 border-b border-gray-300 flex items-center gap-2">
          <div class="flex gap-1">
            <div class="w-3 h-3 bg-red-400 rounded-full"></div>
            <div class="w-3 h-3 bg-yellow-400 rounded-full"></div>
            <div class="w-3 h-3 bg-green-400 rounded-full"></div>
          </div>
          <span class="text-xs text-gray-600 font-medium">屏幕录制扩展</span>
        </div>
        
        <!-- Popup 内容 -->
        <PopupPage />
      </div>
    </div>
    
    <!-- 功能说明 -->
    <div class="mt-12 max-w-2xl mx-auto">
      <h2 class="text-2xl font-bold text-gray-900 mb-6 text-center">功能特性</h2>
      <div class="grid md:grid-cols-2 gap-6">
        <div class="bg-white p-6 rounded-lg shadow-md">
          <h3 class="text-lg font-semibold text-gray-800 mb-3">🎯 六种录制模式</h3>
          <ul class="text-sm text-gray-600 space-y-2">
            <li>• <strong>区域</strong> - 选择屏幕区域录制</li>
            <li>• <strong>元素</strong> - 选择页面元素录制</li>
            <li>• <strong>摄像头</strong> - 录制摄像头画面</li>
            <li>• <strong>Tab</strong> - 录制当前标签页</li>
            <li>• <strong>Window</strong> - 录制整个窗口</li>
            <li>• <strong>Screen</strong> - 录制整个屏幕</li>
          </ul>
        </div>
        
        <div class="bg-white p-6 rounded-lg shadow-md">
          <h3 class="text-lg font-semibold text-gray-800 mb-3">🎮 智能控制</h3>
          <ul class="text-sm text-gray-600 space-y-2">
            <li>• <strong>开始录制</strong> - 一键开始录制</li>
            <li>• <strong>暂停/恢复</strong> - 灵活控制录制过程</li>
            <li>• <strong>停止录制</strong> - 安全结束录制</li>
            <li>• <strong>状态提示</strong> - 实时显示录制状态</li>
            <li>• <strong>模式锁定</strong> - 录制时锁定模式选择</li>
          </ul>
        </div>
        
        <div class="bg-white p-6 rounded-lg shadow-md">
          <h3 class="text-lg font-semibold text-gray-800 mb-3">🎨 现代设计</h3>
          <ul class="text-sm text-gray-600 space-y-2">
            <li>• <strong>Tailwind CSS</strong> - 现代化样式系统</li>
            <li>• <strong>Lucide 图标</strong> - 精美的矢量图标</li>
            <li>• <strong>响应式布局</strong> - 适配不同屏幕</li>
            <li>• <strong>平滑动画</strong> - 优雅的交互效果</li>
            <li>• <strong>无障碍访问</strong> - 完整的 a11y 支持</li>
          </ul>
        </div>
        
        <div class="bg-white p-6 rounded-lg shadow-md">
          <h3 class="text-lg font-semibold text-gray-800 mb-3">⚡ Svelte 5</h3>
          <ul class="text-sm text-gray-600 space-y-2">
            <li>• <strong>Runes 语法</strong> - 最新的响应式系统</li>
            <li>• <strong>TypeScript</strong> - 完整的类型安全</li>
            <li>• <strong>组件化</strong> - 清晰的代码结构</li>
            <li>• <strong>高性能</strong> - 优化的运行时性能</li>
            <li>• <strong>开发体验</strong> - 优秀的开发工具</li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</div>
