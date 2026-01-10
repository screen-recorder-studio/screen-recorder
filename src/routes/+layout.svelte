<script lang="ts">
	import { onMount } from 'svelte';
	import favicon from '$lib/assets/icon.svg';
	import '../app.css';
	import { initI18n } from '$lib/utils/i18n';

	let { children } = $props();

	// Initialize i18n for web mode (non-extension)
	onMount(() => {
		initI18n().catch(e => console.error('[Layout] i18n init failed:', e));
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children?.()}
