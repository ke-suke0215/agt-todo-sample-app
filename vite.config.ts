import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { apiPort } from './src/server/local.ts';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    proxy: { '/api': `http://127.0.0.1:${apiPort}` },
  },
});
