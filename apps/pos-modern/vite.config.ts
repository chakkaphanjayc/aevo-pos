import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig, loadEnv } from 'vite';

function tunnelEnabled(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(value?.trim().toLowerCase() ?? '');
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
  plugins: [react(), cloudflare({ tunnel: tunnelEnabled(env.AEVO_DEV_TUNNEL) })],
  server: {
    host: '0.0.0.0',
    port: 4332,
    proxy: {
      '/api': { target: 'http://localhost:3003', changeOrigin: true },
      '/health': { target: 'http://localhost:3003', changeOrigin: true },
      '/ready': { target: 'http://localhost:3003', changeOrigin: true }
    }
  }
  };
});
