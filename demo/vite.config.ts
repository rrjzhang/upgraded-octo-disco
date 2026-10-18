import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    outDir: 'dist',
    // keep Vite's hashed bundles out of /assets/, which belongs to the asset pipeline
    assetsDir: '_app',
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        researcher: resolve(__dirname, 'researcher.html'),
        editor: resolve(__dirname, 'editor.html'),
      },
    },
  },
  server: { port: 5173 },
  preview: { port: 4173 },
});
