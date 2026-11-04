# NC Deckhand — gestor de mazos y colección para Cyberpunk TCG

- **Sin sesión:** catálogo completo, constructor de mazos con validación de reglas, importar/exportar texto. Los mazos se guardan en el navegador.
- **Con sesión (Supabase):** mazos en tu cuenta, **colección** (qué cartas tienes / te faltan), y en cada mazo qué cartas no tienes.
- Estático: se hospeda en GitHub Pages. Datos en Supabase con RLS (cada usuario solo ve lo suyo).

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
npm test           # parser, export y reglas
npm run build
```

## Actualizar el catálogo (cuando salgan sets nuevos)
```bash
npm run sync       # baja el catálogo y solo las imágenes nuevas
npm run sync -- --force   # re-descarga todas las imágenes
```
Genera `src/data/cards.json` y `public/cards/*.webp`.

## Configurar Supabase
1. Crea un proyecto en supabase.com, **o reutiliza el de otra app** (plan gratis = 2 proyectos): las tablas llevan prefijo `tcg_` y no tocan las existentes. Las cuentas (auth) se comparten entre apps; los datos no, gracias a RLS.
2. SQL Editor → pega y ejecuta `supabase/schema.sql`.
3. Authentication → Providers → Email activado. (Para pruebas puedes desactivar "Confirm email".)
4. Authentication → URL Configuration → *Site URL* = la URL de tu GitHub Pages.
5. Local: copia `.env.example` a `.env.local` con *Project URL* y *anon public key*.

## Desplegar en GitHub Pages
1. Sube el repo a GitHub (rama `main`).
2. Settings → Pages → Source: **GitHub Actions**.
3. Settings → Secrets and variables → Actions → añade `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`.
4. Cada push a `main` ejecuta tests, compila y publica.

La app usa `HashRouter` y `base: './'`, así que funciona bajo `usuario.github.io/repo/` sin más configuración.

## Aviso
Herramienta de fans, no oficial. Los datos e imágenes de las cartas pertenecen a sus propietarios; el catálogo se obtiene de cyberpunk-tcg-sim.online.
