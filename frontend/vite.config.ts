import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (/[\\/](recharts|d3-[^\\/]+|victory-vendor)[\\/]/.test(id)) {
            return 'charts';
          }
          if (/[\\/](react|react-dom|scheduler)[\\/]/.test(id)) {
            return 'react-vendor';
          }
        }
      }
    }
  },
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

