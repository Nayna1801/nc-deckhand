/**
 * Comprobaciones por PÍXELES REALES: hacen una captura y leen el color de puntos concretos.
 * Sirven para fallos visuales que el DOM no refleja (p. ej. un fondo que no cubre todo el contenido).
 */

/** Color [r,g,b,a] de cada punto (en píxeles CSS de la ventana) de la captura actual. */
export async function pixelsAt(page, points) {
  const png = await page.screenshot({ type: 'png' })
  const b64 = png.toString('base64')
  return page.evaluate(
    async ({ b64, points }) => {
      const img = new Image()
      img.src = `data:image/png;base64,${b64}`
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const g = canvas.getContext('2d', { willReadFrequently: true })
      g.drawImage(img, 0, 0)
      const k = img.width / window.innerWidth // la captura va a la resolución real de la pantalla
      return points.map((p) => Array.from(g.getImageData(Math.round(p.x * k), Math.round(p.y * k), 1, 1).data))
    },
    { b64, points },
  )
}

/** Amarillo de neón del borde (#fcee0a). */
export const isYellow = ([r, g, b]) => r > 170 && g > 160 && b < 130
/** Cian de neón del borde (#00f0ff). */
export const isCyan = ([r, g, b]) => r < 90 && g > 170 && b > 170
/** Fondo oscuro de la interfaz. */
export const isDark = ([r, g, b]) => r < 60 && g < 60 && b < 70

/**
 * Puntos a lo largo de una franja vertical vacía (el relleno interior de un panel), desde `from` hasta `to`.
 * Se escoge una franja sin contenido: junto al borde izquierdo, dentro del relleno.
 */
export function stripPoints(x, from, to, step = 24) {
  const pts = []
  for (let y = from; y <= to; y += step) pts.push({ x, y })
  return pts
}
