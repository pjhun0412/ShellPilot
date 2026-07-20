import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  build: {
    // xterm 6.0.0's parser can be miscompiled by Vite's default esbuild
    // minifier in packaged builds, causing vi/full-screen TUI escape handling
    // to crash with `ReferenceError: i is not defined` inside requestMode.
    // Keep production code unminified until xterm/minifier versions are
    // upgraded together and vi/top/less are verified in the packaged app.
    minify: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return undefined;
          }

          if (id.includes('flexlayout-react')) {
            return 'vendor-workspace';
          }

          if (id.includes('@xterm')) {
            return 'vendor-terminal';
          }

          if (
            id.includes('@radix-ui') ||
            id.includes('@dnd-kit') ||
            id.includes('lucide-react') ||
            id.includes('class-variance-authority') ||
            id.includes('tailwind-merge') ||
            id.includes('clsx')
          ) {
            return 'vendor-ui';
          }

          return 'vendor';
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_'],
});
