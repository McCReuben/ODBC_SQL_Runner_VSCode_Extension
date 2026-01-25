import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite config for VS Code webview
// Outputs a single JS + CSS bundle suitable for webview injection
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        // Single file output for easy webview integration
        entryFileNames: 'webview.js',
        assetFileNames: 'webview.[ext]',
      },
    },
    // Inline assets under 100kb to reduce file count
    assetsInlineLimit: 100000,
  },
  // Base path for VS Code webview resource URIs
  base: './',
});
