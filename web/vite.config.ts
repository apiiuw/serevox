import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/console/api': 'http://localhost:8080',
      '/v1': 'http://localhost:8080',
      '/s3': 'http://localhost:8080',
      '/health': 'http://localhost:8080',
    },
  },
});

