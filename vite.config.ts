/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' + HashRouter => funciona en cualquier ruta de GitHub Pages sin tocar nada
export default defineConfig({
  base: './',
  plugins: [react()],
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
