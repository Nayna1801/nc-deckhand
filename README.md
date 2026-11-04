# NC Deckhand — gestor de mazos y colección para Cyberpunk TCG

- **Sin sesión:** catálogo completo, constructor de mazos con validación de reglas, importar/exportar texto. Los mazos se guardan en el navegador.
- **Con sesión (Supabase):** mazos en tu cuenta, **colección** (qué cartas tienes / te faltan), y en cada mazo qué cartas no tienes.
- Estático: se hospeda en GitHub Pages. Datos en Supabase con RLS (cada usuario solo ve lo suyo).

## Funciones
- **Catálogo:** búsqueda y filtros combinables (tipo, color, coste, RAM, facción, rareza, set), orden por set/coste/nombre/número, vista galería o lista, previsualización al pasar el ratón (o pulsación larga en móvil).
- **Constructor:** 3 ranuras de Legend, arrastrar y soltar (arrastrar fuera para quitar), tope de 3 copias que desactiva «Añadir», RAM calculada por color con las cartas que la superan atenuadas y con candado (y opción de ocultarlas), curva de coste y ratio de tipos.
- **Compartir:** exportar/importar texto (formato del sim), CSV/JSON de faltantes, y código o enlace de mazo (`#/share/ncd1.…`) sin servidor.
- **Inventario (con sesión):** copias Normal / Foil / Promo, estado (Mint/Played/Damaged) y bulk automático (de la 4ª copia en adelante, calculado a partir del total), lista de compra cruzando mazos con inventario.

- **Búsqueda avanzada** (botón `?` junto al buscador): `t:unit c:red cost<=2 o:"draw"`, `-t:legend`, `t:legend or t:gear`, `k:blocker`, `f:arasaka`, `s:beta`, `lang:fr`, `has:alt`… Los valores son siempre texto literal (nunca regex). Una condición inválida se avisa y se ignora, sin vaciar los resultados.
- **Variantes:** cada ficha lista sus impresiones por set (Beta, Retail, Pre-Release, Promos, Judge…, con idioma EN/FR) y sus artes alternativos (promos, Iconic, Nova…). Los 102 artes alternativos tienen su imagen: en el detalle de la carta se ven en grande con una galería de miniaturas. Las 17 impresiones con arte propio que solo existen en el CDN con firma no se pueden obtener y se muestran solo como información. El filtro de set considera todas las impresiones.

- **Orden y filtros:** por defecto las cartas salen divididas por set (con cabecera) y por número de coleccionista. Filtros por tipo, color, coste, RAM, poder, keyword, efecto, facción, rareza y set; buscador con debounce.
- **Lista de deseos (con sesión):** ♥ en cada carta (y en su detalle) para marcar las que quieres conseguir, estén o no en un mazo. Se ve y se exporta (CSV/JSON/texto) en Colección → Mis deseos, y se puede filtrar en Cartas.
- **Mazos:** cada tarjeta muestra la identidad de color en iniciales destacadas (`GGR`, `BBG`…) con los nombres completos, las 3 Legends completas y botones para copiar o exportar la lista.
- **Móvil:** filtros plegables, desplegables a pantalla, constructor con selector Catálogo / Mazo.

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
Herramienta de fans, no oficial. Los datos e imágenes de las cartas pertenecen a sus propietarios; el catálogo se obtiene de cyberpunk-tcg-sim.online.
