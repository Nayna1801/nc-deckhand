/**
 * Ruta de la miniatura (360 px de ancho) de una imagen de carta: `cards/x.webp` -> `cards/t/x.webp` y
 * `cards/alt/x.webp` -> `cards/t/alt/x.webp`. Las genera `scripts/make-thumbs.py`.
 * Las galerías y listas usan miniaturas porque una imagen completa (733x1024) ocupa ~3 MB decodificada.
 */
export const thumbOf = (path: string): string => path.replace(/^cards\//, 'cards/t/')
