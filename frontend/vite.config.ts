import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 4100,
    proxy: {
      '/api': {
        target: 'http://localhost:4101',
        changeOrigin: true
      },
      '/v1': {
        target: 'http://localhost:4101',
        changeOrigin: true
      }
    }
  }
});

