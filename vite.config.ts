/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

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

// base './' + HashRouter => funciona en cualquier ruta de GitHub Pages sin tocar nada
export default defineConfig({
  base: './',
  plugins: [react(), securityHeaders()],
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
