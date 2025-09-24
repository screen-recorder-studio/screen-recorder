<script lang="ts">
  import { onMount } from 'svelte';

  let svgPath = '';
  let pinElement: HTMLElement | null = null;
  let selectModeElement: HTMLElement | null = null;

  function drawLine() {
    if (pinElement && selectModeElement) {
      const pinRect = pinElement.getBoundingClientRect();
      const selectModeImage = selectModeElement.querySelector('img');
      if (!selectModeImage) return;
      const selectModeImageRect = selectModeImage.getBoundingClientRect();

      const startX = pinRect.left;
      const startY = pinRect.top + pinRect.height / 2;
      const endX = selectModeImageRect.right;
      const endY = selectModeImageRect.top + selectModeImageRect.height / 2;

      const offset = 250;

      const controlX1 = startX - offset;
      const controlY1 = startY;
      const controlX2 = endX + offset;
      const controlY2 = endY;

      svgPath = `M ${startX} ${startY} C ${controlX1} ${controlY1}, ${controlX2} ${controlY2}, ${endX} ${endY}`;
    }
  }

  onMount(() => {
    drawLine();
    window.addEventListener('resize', drawLine);

    return () => {
      window.removeEventListener('resize', drawLine);
    };
  });
</script>

<div class="relative w-full h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 dark:from-gray-900 dark:via-blue-900 dark:to-purple-900 text-gray-900 dark:text-gray-100 overflow-hidden">
  <div class="absolute top-4 left-4 z-20 flex items-center space-x-2">
    <img src="/assets/icon.svg" alt="Screen Recorder Studio" class="w-8 h-8" />
    <span class="text-lg font-semibold">Screen Recorder Studio</span>
  </div>
  <!-- Animated background elements -->
  <div class="absolute inset-0 overflow-hidden">
    <!-- Large flowing circle 1 -->
    <div class="absolute -top-40 -left-40 w-80 h-80 bg-gradient-to-r from-blue-400/20 to-purple-400/20 rounded-full blur-3xl animate-pulse"></div>
    <!-- Large flowing circle 2 -->
    <div class="absolute top-1/2 -right-40 w-96 h-96 bg-gradient-to-r from-purple-400/20 to-pink-400/20 rounded-full blur-3xl animate-pulse" style="animation-delay: 1s;"></div>
    <!-- Large flowing circle 3 -->
    <div class="absolute -bottom-40 left-1/3 w-72 h-72 bg-gradient-to-r from-pink-400/20 to-blue-400/20 rounded-full blur-3xl animate-pulse" style="animation-delay: 2s;"></div>
    <!-- Floating particles -->
    <div class="absolute top-1/4 left-1/4 w-4 h-4 bg-blue-400/40 rounded-full animate-bounce" style="animation-delay: 0.5s;"></div>
    <div class="absolute top-3/4 right-1/4 w-3 h-3 bg-purple-400/40 rounded-full animate-bounce" style="animation-delay: 1.5s;"></div>
    <div class="absolute top-1/2 left-3/4 w-2 h-2 bg-pink-400/40 rounded-full animate-bounce" style="animation-delay: 2.5s;"></div>
  </div>
  <div bind:this={pinElement} class="absolute top-4 right-4 z-10">
    <img src="/assets/pin.webp" alt="Pin extension" class="w-[32rem] rounded-lg" />
    <div class="text-center mt-2">
      <p class="text-lg font-semibold flex items-center justify-center gap-2">
        <span class="inline-flex items-center justify-center w-8 h-8 bg-blue-500 text-white rounded-full text-sm font-bold">1</span>
        Pin the Extension
      </p>
      <p class="text-sm text-gray-600 dark:text-gray-400 mt-1">Click the puzzle icon and pin this extension to your toolbar for easy access</p>
      <div class="flex items-center justify-center mt-2 text-sm text-gray-500">
        <img src="/assets/icon.svg" alt="Chrome" class="w-32 h-32" />
      </div>
    </div>
  </div>

  <svg class="absolute top-0 left-0 w-full h-full pointer-events-none" style="z-index: 5;">
    <path d={svgPath} stroke="currentColor" stroke-width="2" fill="none" stroke-dasharray="5,5" />
  </svg>

  <div class="absolute inset-0 flex items-center justify-center">
    <div bind:this={selectModeElement}>
      <img src="/assets/mode.webp" alt="Select mode" class="w-[25rem] rounded-lg" />
      <div class="text-center mt-2">
        <p class="text-lg font-semibold flex items-center justify-center gap-2">
          <span class="inline-flex items-center justify-center w-8 h-8 bg-green-500 text-white rounded-full text-sm font-bold">2</span>
          Choose Recording Mode
        </p>
        <p class="text-sm text-gray-600 dark:text-gray-400 mt-1">Select your preferred recording mode: screen, tab, or region capture</p>
      </div>
    </div>
  </div>
</div>