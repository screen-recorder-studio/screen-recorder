<script lang="ts">
	import { onMount } from 'svelte';
	import favicon from '$lib/assets/icon.svg';
	import '../app.css';
	import { initI18n, isI18nInitialized } from '$lib/utils/i18n';

	let { children } = $props();

	// Track i18n initialization state
	let i18nReady = $state(isI18nInitialized());

	// Initialize i18n for web mode (non-extension) and wait for completion
	onMount(() => {
		if (!i18nReady) {
			initI18n().then(() => {
				i18nReady = true;
			}).catch(e => {
				console.error('[Layout] i18n init failed:', e);
				// Still render even if i18n fails
				i18nReady = true;
			});
		}
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{#if i18nReady}
	{@render children?.()}
{:else}
	<!-- Loading state while i18n initializes -->
  <div class="app-loading-surface min-h-screen flex items-center justify-center" role="status">
    <div class="app-loading-label">Loading…</div>
  </div>
{/if}
