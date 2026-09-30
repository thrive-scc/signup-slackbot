import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
export default defineConfig(({ mode }) => {
  const workerOrigin =
    mode === 'test' ? 'http://127.0.0.1:8788' : 'http://127.0.0.1:8787';
  return {
    plugins: [sveltekit()],
    server: {
      proxy: {
        '/api': {
          target: workerOrigin,
          // Preserve the browser's Host so the Worker can enforce same-origin writes.
          changeOrigin: false,
        },
        '/calendar': workerOrigin,
      },
      watch: { usePolling: true, interval: 300 },
    },
  };
});
