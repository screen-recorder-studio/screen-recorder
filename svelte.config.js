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
			entries: ['/', '/sidepanel', '/studio', '/popup', '/popup-demo', '/drive', '/opfs-drive', '/opfs-test', '/welcome',  '/data-analyzer', '/keyframe-analyzer', '/test-colors', '/test-gradients', '/lab/seek', '/lab/editor', '/lab/video', '/lab/ring-editor', '/countdown' ]
		}
	}
};

export default config;
