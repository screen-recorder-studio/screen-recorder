import adapter from 'sveltekit-adapter-chrome-extension';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),

	kit: {
		adapter: adapter({
			// default options are shown
			pages: 'build',
			assets: 'build',
			fallback: null,
			precompress: false,
			manifest: 'static/manifest.json'
		}),
		paths: {
			base: '',
			relative: true
		},
		appDir: 'app',
		prerender: {
			entries: ['/', '/sidepanel', '/studio', '/popup', '/opfs-drive', '/opfs-test', '/data-analyzer', '/keyframe-analyzer']
		}
	}
};

export default config;
