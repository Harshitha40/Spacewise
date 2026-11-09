import { defineConfig } from 'vite';
export default defineConfig({
  server: { port: 5173, open: false },
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 2500 }
});
