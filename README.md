# NC Deckhand — gestor de mazos y colección para Cyberpunk TCG

- **Sin sesión:** catálogo completo, constructor de mazos con validación de reglas, importar/exportar texto. Los mazos se guardan en el navegador.
- **Con sesión (Supabase):** mazos en tu cuenta, **colección** (qué cartas tienes / te faltan), y en cada mazo qué cartas no tienes.
- Estático: se hospeda en GitHub Pages. Datos en Supabase con RLS (cada usuario solo ve lo suyo).

## Funciones
- **Catálogo:** búsqueda y filtros combinables (tipo, color, coste, RAM, poder, etiquetas, rareza, set; casi todos admiten varias opciones a la vez), orden por set/coste/nombre/número, vista galería o lista, previsualización al pasar el ratón (o pulsación larga en móvil).
- **Constructor:** 3 ranuras de Legend, arrastrar y soltar (arrastrar fuera para quitar), tope de 3 copias que desactiva «Añadir», RAM calculada por color con las cartas que la superan atenuadas y con candado (y opción de ocultarlas), curva de coste y ratio de tipos. En el catálogo del constructor cada carta lleva **− n +** (también en el móvil); la lista del mazo va **dividida por tipo (Unidades, Gear, Programas) y ordenada por color e Id**, con miniatura y los botones − + siempre a la derecha, y las tres Legends miden lo mismo aunque los nombres sean de distinta longitud. **Escanear en el constructor:** el botón «Escanear» abre el escáner dentro del editor y cada carta que confirmes («Añadir al mazo») se añade al mazo o al sideboard con las mismas reglas que el botón +.
- **Álbum (Colección → Álbum, con sesión):** un archivador virtual con páginas de bolsillos (2×2, 3×3 o 4×3; a doble página en pantallas anchas, con una página y deslizar en el móvil) donde colocas las cartas que quieras enseñar, en el orden que quieras y con el arte alternativo o promo que prefieras. «Editar álbum»: toca un bolsillo vacío para elegir carta (buscador, «Solo las que tengo», «Solo artes alternativos y promos»; **la ventana recuerda dónde te quedaste** —búsqueda, filtros, página de resultados y posición del scroll—, también tras recargar, con «Empezar de cero» para limpiarla), toca una carta y luego otro bolsillo para moverla (o arrástrala en ordenador), vacía, quita o inserta bolsillos, añade o quita páginas y «Rellenar con mi colección» (tus cartas, tus artes y promos, o todo junto; añadiendo o reemplazando). Las cartas que colocas pero no tienes salen atenuadas con «No la tengo». **Se sincroniza con tu cuenta:** el álbum se guarda en el navegador y, con sesión, también en la tabla `tcg_album` de Supabase (una fila por usuario, con seguridad por usuario), así que se ve igual en el móvil y en el PC. Gana la copia modificada más recientemente (sin fusionar cambios: si lo editas a la vez en dos dispositivos, queda el último); los cambios se suben unos instantes después del último toque y al salir de la pantalla. Requiere **volver a ejecutar `supabase/schema.sql`** (es seguro repetirlo); sin la tabla, o si hay un error de conexión, el álbum sigue funcionando en el navegador y la pantalla lo explica (con «Reintentar»).
- **Compartir:** exportar/importar texto (formato del sim), CSV/JSON de faltantes, y código o enlace de mazo (`#/share/ncd1.…`) sin servidor.
- **Inventario (con sesión):** copias Normal y Foil (y un contador por cada arte alternativo o promo, sin fila genérica de «Promo»; las copias Promo antiguas se pueden repartir entre los artes), estado (Mint/Played/Damaged) y bulk automático (de la 4ª copia en adelante, calculado a partir del total), lista de compra cruzando mazos con inventario. En la pestaña Bulk, «Retirar» (una carta, con la cantidad elegida; si la carta tiene varias versiones o artes, un desplegable «Elegir qué retirar» deja marcar exactamente cuáles) y «Retirar seleccionadas» descuentan las copias vendidas, regaladas o cambiadas de la colección sin bajar nunca del playset.

- **Búsqueda avanzada** (botón `?` junto al buscador): `t:unit c:red cost<=2 o:"draw"`, `-t:legend`, `t:legend or t:gear`, `k:blocker`, `f:arasaka`, `s:beta`, `lang:fr`, `has:alt`… Los valores son siempre texto literal (nunca regex). Una condición inválida se avisa y se ignora, sin vaciar los resultados.
- **Variantes:** cada ficha lista sus impresiones por set (Beta, Retail, Pre-Release, Promos, Judge…, con idioma EN/FR) y sus artes alternativos (promos, Iconic, Nova…). Los 102 artes alternativos tienen su imagen: en el detalle de la carta se ven en grande con una galería de miniaturas. Las 17 impresiones con arte propio que solo existen en el CDN con firma no se pueden obtener y se muestran solo como información. El filtro de set considera todas las impresiones. **Por impresión:** el botón «Por impresión» de Cartas lista una ficha por cada set y número en que se imprimió una carta (389 en inglés), agrupadas por set; al elegir un Set en los filtros se ve siempre así (así «Set 1 Promos» muestra las cartas de ese set y no sus versiones base). Cada ficha usa la imagen de esa impresión cuando existe; si no, se marca con «≈» y se explica de dónde sale (misma ilustración que la original, arte probable del mismo ilustrador o la original como referencia). En el detalle se salta entre las impresiones de la carta. **Catálogo completo de impresiones:** `npm run sync` trae el catálogo del simulador, que no incluye las promos sin versión base ni las ediciones Beta de los mazos de inicio. `node scripts/merge-official-prints.mjs --from .local-data/official-sets --apply` completa `src/data/cards.json` (cartas nuevas, impresiones y los artes con su imagen real, p. ej. las Judge con su marca) a partir de los listados por set ya guardados en `.local-data/` (carpeta ignorada por Git); no hace peticiones de red y se puede repetir tras un `sync`. Después, `python scripts/make-thumbs.py`. **Escáner de cartas (prueba):** `#/scan` (botón «Escanear» en Cartas; también dentro del constructor de mazos) reconoce una carta con la cámara o con una foto subida y propone las 3 cartas más parecidas; no añade nada solo: eliges la correcta y abre su detalle. Todo se calcula en el dispositivo (nada se envía). Técnica: huella de la carta = rejilla de 12×16 en color Lab con cada canal normalizado, comparada por coseno con un atlas de 315 imágenes diminutas (`public/scan/`, `python scripts/make-scan-atlas.py`). En el experimento con fotos simuladas (`scripts/scan-experiment.py`) acierta a la primera ~91 % y entre las 3 primeras ~99,4 %; en el navegador (`e2e/suites/scan.mjs`) 100 % con fotos normales y ~97 % a la primera con fotos difíciles y con la carta desplazada o a otra escala (la comparación prueba 15 recortes —3 escalas × 5 posiciones— y se queda con el mejor parecido de cada carta; tarda ~50 ms). La precisión real se mide en el propio dispositivo («Es esta» / «Ninguna es» → estadísticas locales). No distingue artes idénticos (Beta/Retail con la misma ilustración, que ya cuentan juntos); en cartas con artes alternativos hay que confirmar el arte en el detalle. **Paginación y miniaturas:** Cartas muestra 48 fichas por página (con encabezados de set que cuentan todo el grupo) y usa miniaturas de 360 px (`public/cards/t/`, generadas con `python scripts/make-thumbs.py`, requiere Pillow) en fichas y listas; el detalle y la previsualización usan la imagen completa. Si falta una miniatura se cae a la completa. Las impresiones promocionales (Judge, Set 1 Promos) con la ilustración normal se marcan con «≈» y se cuentan aparte; los **Pre-Release** (Beta y Retail, mismo diseño con marca de promoción) también cuentan como diseño propio —un solo contador para los dos— y salen con «Solo artes alternativos». **Artes alternativos y promos:** el diseño base de una carta (da igual si es Beta o Retail) se cuenta con las copias Normal/Promo/Foil de siempre; cada arte alternativo o promo con diseño propio (Iconic, Nova, Alpha, promos…, 156 en total) tiene su propio contador, en el detalle de la carta y en las fichas de «Por impresión» (con «Solo artes alternativos» y el filtro de colección se ve cuáles tienes). Las copias de arte suman al total de la carta (playset, bulk, mazos). Requiere re-ejecutar `supabase/schema.sql` (añade la columna `arts`); sin ella la app sigue funcionando y avisa.

- **Orden y filtros:** por defecto las cartas salen divididas por set (con cabecera) y por número de coleccionista. Filtros por tipo, color, coste, RAM, poder, keyword, efecto, etiquetas (facciones y clasificaciones como Quickhack o Braindance, con modo «cualquiera / todas a la vez»), rareza y set. Tipo, color, coste, RAM, poder, etiquetas, rareza y set son de selección múltiple (dentro de uno se suman, entre filtros se cruzan); buscador con debounce.
- **Lista de deseos (con sesión):** ♥ en cada carta (y en su detalle) para marcar las que quieres conseguir, estén o no en un mazo. Se ve y se exporta (CSV/JSON/texto) en Colección → Mis deseos, y se puede filtrar en Cartas.
- **Mazos:** cada tarjeta muestra la identidad de color en iniciales destacadas (`GGR`, `BBG`…) con los nombres completos, las 3 Legends completas y botones para copiar o exportar la lista.
- **Móvil:** filtros plegables, desplegables a pantalla, constructor con selector Catálogo / Mazo, listas de cartas en dos líneas (nombre completo y debajo tipo · coste · RAM) y botón «Escanear» con icono junto al título.

## Seguridad
- **CSP** en la web compilada: scripts solo propios (sin `unsafe-inline` ni `eval`), conexiones solo a la propia web y a Supabase.
- **Entradas no fiables validadas:** códigos de mazo (tope de tamaño y lectura limitada contra "bombas" de descompresión), texto importado (tope de caracteres y cantidades), mazos guardados en el navegador (se sanean al cargar) y consultas de búsqueda (siempre literales, nunca regex).
- **Servidor:** Row Level Security en todas las tablas `tcg_*` y restricciones de forma y tamaño en `schema.sql`.
- Dependencias sin vulnerabilidades conocidas (`npm audit`). Pendiente de decidir por el titular del proyecto: activar la confirmación de email en Supabase (ahora entra sin confirmar).

Decisión de diseño: los mazos se **autoguardan como borrador** aunque no sean legales (como hace la web original), y se marcan Legal / Ilegal / Borrador. Bloquear el guardado haría perder trabajo a mitad de construcción.

## Formato de mazos
El mismo que `cyberpunk-tcg-sim.online/deck-builder`:

```
# Name: Custom Deck 1

# Legends
1x 012 Goro Takemura: Hands Unclean

# Main Deck
1x 089 Saul Bright: Stormrider
```
El código (`012`) se repite entre sets, así que al importar se resuelve por nombre (igual que hace el sim). También acepta solo el nombre y secciones `#L` / `#D` / `#S` (sideboard).

Reglas validadas (Standard): 3 Legends únicas, 40–50 cartas, máx. 3 copias (mazo + sideboard), sideboard ≤ 7, y RAM de cada color ≥ RAM de la carta (suma de tus Legends).

## Desarrollo
```bash
npm install
npm run dev        # http://localhost:5173
npm test           # lógica: parser, export, reglas, seguridad, orden de escrituras…
npm run build
npm run e2e        # pruebas de navegador (Playwright): la web entera, con red simulada (~1 min)
npm run verify     # build + tests + navegador: lo que conviene pasar antes de subir
```
La primera vez, `npx playwright install chromium`. Detalles y lista de suites en [`e2e/README.md`](e2e/README.md); `npm run e2e:live` las pasa contra la web publicada.

## Actualizar el catálogo (cuando salgan sets nuevos)
```bash
npm run sync       # baja el catálogo y solo las imágenes nuevas
npm run sync -- --force   # re-descarga todas las imágenes
npm run sync -- --from catalogo.json   # regenera cards.json desde un catálogo ya descargado (sin red ni imágenes)
npm run sync -- --alt-images           # descarga también las imágenes de artes alternativos (public/cards/alt, solo las que falten)
```
Genera `src/data/cards.json` (con impresiones y artes alternativos), `public/cards/*.webp` y, con `--alt-images`, `public/cards/alt/*.webp`. La extensión de cada imagen se decide por su contenido real y se descarta todo lo que no sea una imagen. Revisa antes los términos de la web de origen.

## Configurar Supabase
1. Crea un proyecto en supabase.com, **o reutiliza el de otra app** (plan gratis = 2 proyectos): las tablas llevan prefijo `tcg_` y no tocan las existentes. Las cuentas (auth) se comparten entre apps; los datos no, gracias a RLS.
2. SQL Editor → pega **el contenido** de `supabase/schema.sql` (no el nombre del fichero) y ejecútalo. Si ya lo habías ejecutado antes, vuelve a ejecutarlo: añade las columnas de Foil/Promo/estado (es idempotente). Sin esa actualización la app sigue funcionando, pero solo con copias Normal.
3. Authentication → Providers → Email activado. Recomendado: **activar "Confirm email"** para que nadie pueda crear cuentas con emails ajenos.
4. Authentication → URL Configuration:
   - *Site URL*: solo hay una por proyecto. Si el proyecto lo comparte otra app, déjala como está.
   - **Redirect URLs**: añade `https://TU-USUARIO.github.io/nc-deckhand/**` (y `http://localhost:5173/**` para desarrollo). La app envía esa dirección en cada alta, y Supabase solo la respeta si está en esta lista; si no está, el enlace del correo llevaría a la *Site URL* (otra app).

### Cuentas compartidas con otra app
Los usuarios (`auth.users`) son comunes a todas las apps del proyecto: un email que ya existe en la otra app **ya tiene cuenta aquí**. Al crear cuenta con él, la web lo explica y ofrece ir a iniciar sesión con la contraseña de siempre (no se exige longitud mínima al iniciar sesión, porque la otra app puede admitir contraseñas más cortas).

Para **probar el alta y la confirmación del correo** sin chocar con una cuenta existente, usa un email nuevo o un alias del tuyo: en Gmail, `tunombre+tcg@gmail.com` llega a tu bandeja pero cuenta como usuario distinto.
5. Local: copia `.env.example` a `.env.local` con *Project URL* y *anon public key*.

## Desplegar en GitHub Pages
1. Sube el repo a GitHub (rama `main`).
2. Settings → Pages → Source: **GitHub Actions**.
3. Settings → Secrets and variables → Actions → añade `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`.
4. Cada push a `main` ejecuta tests, compila y publica.

La app usa `HashRouter` y `base: './'`, así que funciona bajo `usuario.github.io/repo/` sin más configuración.

## Aviso
Herramienta de fans, no oficial. Los datos e imágenes de las cartas pertenecen a sus propietarios; el catálogo base se obtiene de cyberpunk-tcg-sim.online y las promos, las ediciones Beta y sus imágenes de cyberpunktcg.com (web oficial).
