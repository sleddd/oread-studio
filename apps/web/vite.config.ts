import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Proxy API calls to the Fastify server in dev so cookies are same-origin.
      '/api': {
        target: process.env.OREAD_API ?? 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
});
