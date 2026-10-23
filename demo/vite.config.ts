import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { readerPlugin } from './tools/reader/plugin.mjs';

// SPEC "Dialogue reader and notes (dev only)": the reader page is left out of the public build entirely
const isPublicBuild = process.env.VITE_PUBLIC === '1';

export default defineConfig({
  // public base path: '/' locally, '/upgraded-octo-disco/' for GitHub Pages (BASE=/upgraded-octo-disco/ npm run build)
  base: process.env.BASE || '/',
  // the reader's notes / HEAD middleware (serve mode only)
  plugins: [readerPlugin({ demoDir: __dirname })],
  build: {
    outDir: 'dist',
    // keep Vite's hashed bundles out of /assets/, which belongs to the asset pipeline
    assetsDir: '_app',
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        researcher: resolve(__dirname, 'researcher.html'),
        editor: resolve(__dirname, 'editor.html'),
        ...(isPublicBuild ? {} : { reader: resolve(__dirname, 'reader.html') }),
      },
    },
  },
  server: { port: 5173 },
  preview: { port: 4173 },
});
