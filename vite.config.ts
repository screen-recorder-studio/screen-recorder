import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	build: {
		rollupOptions: {
			output: {
				inlineDynamicImports: false,
				manualChunks: undefined
			}
		},
		target: 'es2020'
	}
});
