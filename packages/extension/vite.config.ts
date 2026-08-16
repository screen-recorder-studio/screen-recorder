import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { createReleaseBuildPolicy } from './scripts/release-build-policy.mjs';

export default defineConfig(({ mode, command }) => {
	// Dev servers and Vitest keep diagnostics. Only an explicit Vite build uses
	// the release replacement; `--mode debug` remains the readable build escape hatch.
	const loggingPolicy = createReleaseBuildPolicy({ debugLogs: command !== 'build' || mode === 'debug' });

	return {
		plugins: [
			tailwindcss(),
			sveltekit(),
		],
		define: loggingPolicy.define,
		esbuild: loggingPolicy.esbuild,
		build: {
			minify: loggingPolicy.minify,
			rollupOptions: {
				output: {
					banner: loggingPolicy.rollupBanner,
					inlineDynamicImports: false,
					manualChunks: undefined
				}
			},
			target: 'es2020'
		}
	};
});
