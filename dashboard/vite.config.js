import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev the dashboard runs on :5173 and proxies the WebSocket to the Node server on :8080,
// so the app always connects to `/ws` on its own origin (dev and production alike).
const target = process.env.CONTROL_SERVER || 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/ws': { target, ws: true },
      '/api': target,
      '/demo': target,
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
