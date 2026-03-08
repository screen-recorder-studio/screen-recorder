import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit(),
	],
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
