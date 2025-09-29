<script lang="ts">
  import { onMount } from 'svelte';
  let seconds = 3;
  let started = false;
  let done = false;

  // Read query param ?s=5
  onMount(() => {
    try {
      const url = new URL(window.location.href);
      const sParam = url.searchParams.get('s');
      const n = sParam ? parseInt(sParam, 10) : NaN;
      if (!isNaN(n) && n > 0 && n <= 99) seconds = n;
    } catch {}
  });

  function beep(final=false){
    try {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = final ? 880 : 440;
      gain.gain.setValueAtTime(0.001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.28, ctx.currentTime + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.30);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.32);
    } catch {}
  }

  function tick(){
    // Normal visible countdown all the way to 1
    if (seconds <= 0) {
      if (!done) {
        done = true;
        beep(true);
        // Send done after a tiny delay for final paint
        setTimeout(() => {
          try { chrome.runtime?.sendMessage?.({ type: 'COUNTDOWN_DONE' }); } catch {}
        }, 80);
      }
      return;
    }
    beep();
    seconds -= 1;
    setTimeout(tick, 1000);
  }

  onMount(() => {
    if (!started){
      started = true;
      tick();
    }
  });
</script>

<div class="w-screen h-screen flex items-center justify-center bg-neutral-900 text-white select-none">
  <div class="text-[5rem] font-semibold tracking-wide tabular-nums animate-pulse">
    {#if seconds > 0}{seconds}{:else}0{/if}
  </div>
</div>

<style>
  :global(html, body){ margin:0; padding:0; font-family: system-ui, sans-serif; }
</style>
