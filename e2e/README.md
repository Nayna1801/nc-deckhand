# Pruebas de navegador (Playwright)

Abren la web en un Chromium real y hacen lo que haría una persona: buscar, filtrar, arrastrar cartas, pulsar `+` y `−` muy rápido, iniciar sesión, crear una cuenta, abrir el enlace del correo… Complementan a los tests de lógica (`npm test`), que no ven la interfaz.

## Uso

```bash
npx playwright install chromium     # solo la primera vez (descarga el navegador de pruebas)

npm run e2e                         # compila una copia de pruebas, la sirve y pasa todas las suites (~1 min)
npm run e2e:live                    # lo mismo contra la web publicada
npm run verify                      # build + tests de lógica + navegador (lo que conviene antes de subir)

node e2e/run.mjs --list             # lista las suites
node e2e/run.mjs --only stepper     # solo una (o varias: --only guest,search)
node e2e/run.mjs --no-build         # reutiliza dist-e2e si ya existe
node e2e/run.mjs --url https://…/   # otra dirección
```

Termina con código distinto de 0 si algo falla, así que sirve igual en CI (`.github/workflows/e2e.yml`).
Las capturas de pantalla van a la carpeta temporal del sistema (se muestra al final; se puede cambiar con `E2E_SHOTS`).

## Cómo funcionan

- **Nunca tocan una base de datos real.** `npm run e2e` compila la web contra un proyecto de Supabase *falso* (`e2e-test.supabase.co`) y cada suite intercepta toda la red de Supabase con un servidor simulado (`lib/mock.mjs` y `lib/backend.mjs`). No necesitan credenciales.
- `lib/backend.mjs` es el más fiel: guarda estado entre recargas, añade latencia aleatoria a cada petición y aplica las mismas restricciones que `supabase/schema.sql`. Con él se reproducen fallos que solo aparecen con red lenta o desordenada.
- Los resultados esperados se calculan a partir de los **datos reales** (`src/data/cards.json`), no de números escritos a mano: si cambia el catálogo, las pruebas se adaptan.
- Los mazos de ejemplo salen de `src/lib/__fixtures__/siteDecks.json` (anonimizados).

## Suites

| Suite | Qué comprueba |
|---|---|
| `guest` | Invitado: catálogo, filtros, constructor, arrastrar y soltar, tope de copias, compartir por código, móvil |
| `search` | Búsqueda con sintaxis (`t:unit c:red cost<=2`…), ayuda, errores, variantes |
| `sticky` | El filtro "me faltan" no hace saltar la lista al pulsar `+`; página de Colección |
| `logged` | Con sesión: inventario Normal/Foil/Promo, bulk, listas de compra, importación |
| `features` | Orden por sets, filtros, desplegables con teclado, debounce, bloqueo por RAM, tarjetas de mazo, deseos, móvil, seguridad (XSS, datos manipulados, bombas de descompresión) |
| `fixes` | El modal no salta al pulsar `+`, playset por tipo de carta, versiones que existen, `−` sobre el total |
| `altart` | Galería de artes alternativos y carga de las 102 imágenes |
| `visual` | Comprobación por **píxeles reales**: el fondo de los paneles con scroll (detalle de carta, desplegables, ayuda) cubre todo el contenido y no deja el texto sobre el color del borde |
| `auth` | Alta con email nuevo/existente, correo sin confirmar, reenvío, vuelta desde el enlace del correo |
| `stepper` | `+` y `−` con clics rápidos y latencia, versiones mezcladas, orden de las escrituras, carga lenta |
| `version` | Sello de versión en el pie y aviso de versión nueva (solo en local) |

## Escribir una prueba nueva

1. Crea `e2e/suites/mi-suite.mjs` y regístrala en `SUITES` de `run.mjs`.
2. Importa lo común de `config.mjs` (`BASE`, `CARDS`, `DECKS`, `SHOTS`) y los ayudantes de `lib/`.
3. Imprime una línea `PASS …` o `FAIL …` por comprobación y termina con `process.exit(failed ? 1 : 0)`.
4. Para esperar a que terminen las escrituras usa `settle()` de `lib/backend.mjs`: espera un **silencio sostenido** de red, no un instante sin tráfico (con la cola de escrituras hay huecos entre una petición y la siguiente).
5. En las pruebas de un cambio concreto, comprueba antes que **fallan sin el arreglo**: así sabes que detectan lo que dicen detectar.

## Pruebas visuales (píxeles)

`lib/pixels.mjs` hace una captura y lee el color de puntos concretos. Sirve para fallos que el DOM no refleja, como un fondo que no cubre todo el contenido. Regla de diseño que protege: **el borde y el relleno con esquinas cortadas van en una caja fija y el scroll en una caja interior** (si no, el relleno solo cubre la parte visible).

## Dos trampas conocidas

- Algunas etiquetas se escriben en mayúsculas con CSS (`text-transform`); `innerText` las devuelve en mayúsculas. Usa expresiones sin distinguir mayúsculas (`/…/i`).
- Cambiar solo el `#` de la dirección no recarga la página: si lees el resultado de una carga asíncrona, espera con `waitFor`.
