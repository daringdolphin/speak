import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  root: 'src/renderer',
  base: './',
  server: {
    port: 5173,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/renderer/index.html'),
        recorder: resolve(__dirname, 'src/renderer/recorder.html'),
        overlay: resolve(__dirname, 'src/renderer/overlay.html'),
      },
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom'],
  },
}) 