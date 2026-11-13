/// <reference types="vitest/config" />
import { execSync } from 'node:child_process'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import labApi from './scripts/lab-api.mjs'

/**
 * Content-Security-Policy para la web publicada (GitHub Pages no permite cabeceras, así que va en <meta>).
 * Solo se inyecta al compilar: en desarrollo Vite necesita scripts en línea para el HMR.
 *  - scripts: solo los propios (nada en línea, nada de terceros)
 *  - conexiones: solo la propia web y Supabase
 *  - estilos: propios + Google Fonts; los atributos style="" de React se permiten solo como atributo
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "style-src-attr 'unsafe-inline'",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

const securityHeaders = (): Plugin => ({
  name: 'nc-security-meta',
  apply: 'build',
  transformIndexHtml(html) {
    const tags = `<meta http-equiv="Content-Security-Policy" content="${CSP}" />\n    <meta name="referrer" content="strict-origin-when-cross-origin" />\n    `
    return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    ${tags}`)
  },
})

// Versión de la compilación (commit corto): se enseña en el pie y permite avisar de que hay una versión nueva.
const version = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'dev'
  } catch {
    return 'dev'
  }
})()
const built = new Date().toISOString()

/** Publica version.json junto a la web: las pestañas ya abiertas lo consultan para saber si están desactualizadas. */
const versionFile = (): Plugin => ({
  name: 'nc-version-file',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version, built }) })
  },
})

// base './' + HashRouter => funciona en cualquier ruta de GitHub Pages sin tocar nada
export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(version), __APP_BUILT__: JSON.stringify(built) },
  plugins: [react(), securityHeaders(), versionFile(), labApi()],
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
