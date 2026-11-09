# deckforge

Herramienta para **analizar, optimizar y comparar mazos del Cyberpunk TCG** con las reglas reales del juego.
Solo usa la biblioteca estándar de Python 3.10+ (no hay que instalar nada) y lee el catálogo de la propia web
(`src/data/cards.json`), así que se relanza cada vez que cambie el catálogo.

```
python tools/deckforge/forge.py <comando> --help
```

## Qué contiene (la «cadena de montaje»)

| Pieza | Dónde | Qué hace |
|---|---|---|
| **Árbitro** (código, sin LLM) | `cardsdb.py` + `forge.py validate` | 3 Legends de nombre único, 40-50 cartas, máx. 3 copias (mazo + sideboard), sideboard ≤ 7, RAM por color |
| **Base de conocimiento** | `net_data.py` | Las 151 cartas y Legends legales anotadas: qué *producen*, qué *necesitan*, qué *contrarrestan* y a qué son *vulnerables* |
| **Red de sinergias** | `net_model.py` | Valor de cada carta según lo que el mazo realmente le da; enlaces productor → consumidor; ranking de ternas de Legends |
| **Simulador** | `engine.py` + `engine_x.py` | Partidas completas: Gigs, robo por poder, Blockers, Lag, muerte súbita, venta de cartas, Legends (Call, Go Solo), manipulación de dados, habilidades de Jackie (Pour One Out), Hanako, Alt, Judy y Lucyna, reacciones Take Control / Floor It |
| **Optimizador** | `forge.py optimize` | Búsqueda local (cambia una carta cada vez) midiendo victorias contra un campo de mazos, con reinicios y validación con semillas nuevas |
| **Nodo de manos** | `forge.py hands` | ¿Se atasca el mazo en los primeros turnos? |

## Flujo habitual

```bash
# 1) ¿ha cambiado el catálogo? (cartas nuevas sin anotar, mecánicas desconocidas)
python tools/deckforge/forge.py check

# 2) validar un mazo y ver su red de sinergias y counters
python tools/deckforge/forge.py validate tools/deckforge/decks/green_blue_judy.json
python tools/deckforge/forge.py score    tools/deckforge/decks/green_blue_judy.json

# 3) medirlo contra el campo (por defecto data/field_default.json, 21 mazos)
python tools/deckforge/forge.py gauntlet tools/deckforge/decks/green_blue_judy.json
python tools/deckforge/forge.py sim tools/deckforge/decks/green_blue_judy.json tools/deckforge/decks/bbg_jackie_alt_hanako.json --games 600
python tools/deckforge/forge.py hands    tools/deckforge/decks/green_blue_judy.json

# 4) buscar el mejor mazo para tres Legends (usa los IDs del catálogo)
python tools/deckforge/forge.py optimize \
  --legends goro_takemura_hands_unclean jackie_welles_mama_s_favorite judy_alvarez_braindance_maestro \
  --start tools/deckforge/decks/green_blue_judy.json --iters 150 --restarts 4

# 5) ranking de ternas de Legends con la red (tarda ~1-2 min con 4 procesos)
python tools/deckforge/forge.py trios --top 20

# 6) pasar de/hacia la web
python tools/deckforge/forge.py export decks/mi_mazo.json --out mi_mazo.txt     # pegar en «Importar»
python tools/deckforge/forge.py import-text mi_mazo.txt --out decks/mi_mazo.json
```

Los resultados nuevos se guardan en `tools/deckforge/out/` (no se sube al repositorio). `--procs` fija los procesos
en paralelo (4 por defecto, para no ahogar el equipo).

## Formato de un mazo (JSON)

```json
{ "name": "Mi mazo",
  "legends": ["goro_takemura_hands_unclean", "jackie_welles_mama_s_favorite", "judy_alvarez_braindance_maestro"],
  "main": { "valentino_street_racer": 3, "...": 2 },
  "side": { "riot_shield": 1 } }
```

Siempre **IDs** de carta (el campo `id` de `cards.json`), nunca nombres.

## Cuando salgan cartas nuevas

1. `python tools/deckforge/forge.py check` lista las cartas legales sin anotar y cualquier palabra clave nueva.
2. Añade una línea por carta en `net_data.py` (el formato está explicado en la cabecera del fichero):
   `id | valor | produce | necesita | contrarresta | vulnerable`.
3. Si la carta tiene un efecto que el simulador debe jugar (eliminar, gastar, robar, Blocker, Adrenaline…), añádela a `fxtable.py`.
   Las cartas sin efecto modelado se simulan solo con su coste y su poder.
4. Si una Unidad nueva lleva la etiqueta de venta, añade su `id` a `SELL_UNITS` en `cardsdb.py`.
5. Vuelve a lanzar `gauntlet` / `optimize` con el campo actualizado (`--field` acepta un JSON o una carpeta de mazos).

## Reglas que asume (y de dónde salen)

- Guía oficial de juego y resúmenes de las Reglas Completas: gana quien empieza su turno con 7 Gigs; tras recibir ambos sus 6 dados
  hay muerte súbita; Eddies solo por venta de cartas con etiqueta (todo Gear y Programa; de las Unidades, solo MT0D12 Flathead).
- Aclaraciones del usuario: Go Solo exige la Legend boca arriba (hay que hacer Call, 1 €, al azar) y el poder impreso de un Gear se suma.

## Límites (léelos antes de fiarte de un número)

- Es un **modelo**, no partidas reales: la IA es sencilla, no juega todas las reacciones Quick y varias cartas están aproximadas.
- Solo se modelan a fondo las Legends de Jackie (Pour One Out), Hanako, Alt, Judy, Lucyna y las de Go Solo; el resto (Dum Dum, River Ward, Royce…)
  tienen versiones simples.
- Las anotaciones de `net_data.py` son criterio humano; la red es un **filtro**, no una verdad (su orden coincide poco con el del simulador).
- Los porcentajes sirven para **comparar** mazos entre sí, no como probabilidad real de ganar. Varían unos puntos entre semillas
  (más en los mazos con mucha manipulación de dados).
