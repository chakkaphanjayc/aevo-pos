import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig, loadEnv } from 'vite';

function tunnelEnabled(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(value?.trim().toLowerCase() ?? '');
}

function tunnelOption(value: string | undefined, autoStartValue: string | undefined): boolean | { autoStart: true } {
  if (!tunnelEnabled(value)) return false;
  return tunnelEnabled(autoStartValue) ? { autoStart: true } : true;
}

function inspectorPort(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
  plugins: [react(), cloudflare({ tunnel: tunnelOption(env.AEVO_DEV_TUNNEL, env.AEVO_DEV_TUNNEL_AUTOSTART), inspectorPort: inspectorPort(env.AEVO_CLOUDFLARE_INSPECTOR_PORT, 9232) })],
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
