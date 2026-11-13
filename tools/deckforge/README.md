# deckforge

Herramienta para **analizar, explicar, comparar y optimizar mazos del Cyberpunk TCG** jugando partidas completas
con las reglas reales. Solo usa la biblioteca estándar de Python 3.10+ (no hay que instalar nada) y lee el catálogo
de la propia web (`src/data/cards.json`), así que se relanza cada vez que cambie el catálogo.

```
python tools/deckforge/forge.py <comando> --help
```

## Qué contiene

| Pieza | Dónde | Qué hace |
|---|---|---|
| **Árbitro** | `cardsdb.py` + `forge.py validate` | 3 Legends de nombre único, 40-50 cartas, máx. 3 copias (mazo + sideboard), sideboard ≤ 7, RAM por color |
| **Motor v2** | `engine2.py` | Reglas: Eddies por venta, Legends (Call, Go Solo, gastarlas como dinero), Lag, peleas, Blocker, robo de Gigs por poder (10+ roba 2), Overtime, derrota frente a «fondo de mazo» |
| **Cartas** | `fx2.py` (entrada) → `fx2_base`, `fx2_rules`, `fx2_units`, `fx2_programs` | Las 151 cartas legales modeladas una a una (efecto y cuánto vale jugarla en cada situación) |
| **Jugador** | `ai2.py` (entrada) → `ai2_setup`, `ai2_dice`, `ai2_cards`, `ai2_turn`, `ai2_react` | Mulligan, venta, Calls, qué jugar, ataques, reacciones Quick (Take Control, Overwatch, River Ward...), manipulación de dados según lo que el mazo necesita |
| **Informe** | `explain.py` + `forge.py explain` | **Por qué** gana o pierde un mazo, midiendo eventos de miles de partidas |
| **Visor de partidas** | `replay.py` + `forge.py replay` | Graba partidas completas paso a paso (estado del tablero y texto de cada acción) en `out/replay.json`; una página visor las reproduce con tablero y consola (`replay <mazoA> <mazoB> --games 2 --seed 3 [--append] [--fast]`) |
| **Jugar tú contra el piloto** | `human.py`, `human_react.py`, `human_pilot.py`, `live.py`, `lab_play.py`, `humanlog.py` + `forge.py humanlog` | Una persona ocupa un asiento y el piloto el otro, desde la página Laboratorio de la web (`npm run dev`); se guardan tus decisiones y se comparan con las del piloto (sección «Jugar tú contra el piloto») |
| **Guía de juego** | `playbook.py` + `forge.py playbook` | Cómo rinde un mazo contra cada rival, qué manos y situaciones van mejor o peor, y qué conviene jugar o vender en cada turno (asociaciones medidas, no causas) |
| **Buscador** | `search.py` + `forge.py search` / `optimize` | Criba de todas las ternas de Legends y afinado carta a carta |
| **Meta** | `meta/*.json` | Los cuatro mazos de referencia publicados (BBG Control, River's Closet, Red Aggro, Judy Mono-Blue) |
| **Red de cartas** | `cardgraph.py`, `graph_html.py` + `forge.py graph` | Cada carta con su lógica, unida a las demás por conceptos; razona sobre cartas y mazos y monta mazos siguiendo las conexiones |
| **Sideboard** | `sideboard.py` + `forge.py sideboard` / `match` | Qué meter y quitar contra cada rival, propuesta de sideboard y partidas al mejor de tres |
| **Mazo contra rivales concretos** | `vs.py`, `best.py --vs ... --strong`, `replace_card.py` | `vs.py mazo1.json mazo2.json [--vs red_aggro bbg_control] [--games 300] [--seed N] [--procs 2]` mide mazos contra rivales del meta con la IA fuerte (o `--fast`) y da el % por rival con su ruido y el MÍNIMO (para «ganar a X y a Y» manda el cruce más flojo). `best.py --vs red_aggro bbg_control --strong --units 12 18` busca el mejor mazo solo contra esos rivales (criba de ternas → mazo completo → pulido → validación con la IA fuerte). Ojo: el pulido usa la IA rápida y suele EMPEORAR el cruce con Red Aggro; confirmar siempre con ≥300 partidas y otra semilla. Con 3 procesos y otras aplicaciones abiertas el sistema ha matado la tanda por memoria: usar `--procs 2`. `replace_card.py mazo.json --out <carta> --vs rival:peso ...` busca qué carta poner en lugar de una que no tienes (criba rápida de todas las cartas legales y confirmación con la IA fuerte). Rivales extra, como la lista real de RYY, en `rivals/` |
| **Sideboard contra un rival** | `side_vs.py` | `side_vs.py mazo.json --vs red_aggro [--top 12] [--games 150] [--final-games 400] [--procs 2]` busca las cartas de sideboard (hasta 7) contra UN rival: criba rápida de todos los cambios «k copias entran, k salen», medición con la IA fuerte de los mejores y validación de las combinaciones; guarda el plan en `out/side_<rival>.json`. La IA rápida solo criba (es mal árbitro contra Red Aggro); ~20 min con 2 procesos. Confirmar siempre el ganador con otra semilla: el mejor de 12 cambios sale inflado. `--final-games 0` hace solo las fases 1-2 y guarda el ranking en `out/side_<rival>_ranked.json`; `--vs` acepta también la ruta a un mazo JSON. Reglas: sideboard de EXACTAMENTE 7 cartas (o 0), el cambio es un intercambio y el sideboard vuelve a tener 7 tras cambiar |
| **Sideboard libre y único** | `side_plan.py`, `side_plan_pkg.py`, `side_assemble.py` | Sideboard de 7 cartas DISTINTAS para varios rivales a la vez: `side_plan.py mazo.json --vs bbg_control red_aggro ...` mide todos los cambios de UNA copia (cada uno con su carta que sale; mismas semillas para el mazo base y el cambiado) y arma un plan por rival; `side_plan_pkg.py` añade como opciones los paquetes de 2-3 copias iguales (los cambios que solo funcionan con varias copias, como Valentino Street Racer); `side_assemble.py mazo.json --vs rival:peso ... --save salida.json` elige UN sideboard de exactamente 7 cartas (una carta que sirve a varios planes cuesta un solo hueco), arma el plan de cada rival con solo esas cartas y lo valida con la IA fuerte (400 partidas, mismas semillas), con la probabilidad estimada de ganar el Bo3. La IA rápida solo criba; con 2 procesos todo el flujo (4 rivales) tarda ~1,5 h |
| **Pruebas** | `tests2.py`, `tests_cards.py`, `tests_choices.py`, `golden.py` | Reglas generales (también del jugador humano), unas 90 cartas comprobadas una a una y las cartas donde decide la persona (cada prueba hace elegir a la persona lo contrario que el piloto; las lanza `selftest`). `golden.py` comprueba que el motor y el piloto siguen dando EXACTAMENTE los mismos resultados que la referencia guardada en `golden/` (siete comandos con semilla fija, ~1 min): se lanza tras tocar `engine2`, `fx2_*` o `ai2_*`; `--update` guarda una referencia nueva solo si el cambio de comportamiento es intencionado |
| **Línea de comandos** | `forge.py` (entrada) → `forge_cli` (argumentos), `forge_basic`, `forge_sim`, `forge_search`, `forge_graph`, `forge_selftest`, `deckio` | Cada comando vive en el módulo de su familia; `forge.py` reexporta lo que usan `evolve.py`, `valfn.py` y `tweak.py` |
| Red de sinergias (v1) | `net_data.py`, `net_model.py` | Anotación manual produce/necesita/contrarresta. Solo la usan `score`, `trios` y el mazo de partida de `search` |

## Flujo habitual

```bash
# 0) ¿todo en orden? ¿hay cartas nuevas?
python tools/deckforge/forge.py selftest
python tools/deckforge/forge.py check

# 1) traer un mazo de la web (texto de «Exportar») y validarlo
python tools/deckforge/forge.py import-text mi_mazo.txt --out tools/deckforge/decks/mi_mazo.json
python tools/deckforge/forge.py validate tools/deckforge/decks/mi_mazo.json

# 2) POR QUÉ gana o pierde contra el meta
python tools/deckforge/forge.py explain tools/deckforge/decks/mi_mazo.json --games 800

# 2b) GUÍA DE JUEGO: victorias por rival, por tipo de mano y por situación; qué jugar y qué vender en cada turno
python tools/deckforge/forge.py playbook tools/deckforge/decks/mi_mazo.json --games 300 [--rival River] [--fast]

# 3) tabla de todos contra todos (el meta + los mazos que añadas)
python tools/deckforge/forge.py matrix --also tools/deckforge/decks/mi_mazo.json

# 4) afinar un mazo con sus tres Legends
python tools/deckforge/forge.py optimize --legends <id1> <id2> <id3> --start tools/deckforge/decks/mi_mazo.json

# 5) buscar el mejor mazo que permiten las cartas (criba todas las ternas; ~30-40 min)
python tools/deckforge/forge.py search --field tools/deckforge/meta tools/deckforge/decks

# 6) sideboard: plan contra cada rival (o propuesta de 7 cartas con --build) y al mejor de tres
python tools/deckforge/forge.py sideboard tools/deckforge/meta/bbg_control.json
python tools/deckforge/forge.py sideboard tools/deckforge/decks/mi_mazo.json --build --save
python tools/deckforge/forge.py match tools/deckforge/decks/mi_mazo.json tools/deckforge/meta/red_aggro.json

# 7) devolverlo a la web
python tools/deckforge/forge.py export tools/deckforge/out/busqueda_1_....json --out mi_mazo.txt
```

Los resultados nuevos se guardan en `tools/deckforge/out/` (no se sube al repositorio). `--procs` fija los procesos en paralelo
(con poca memoria libre usa `--procs 2`).

## Jugar tú contra el piloto (Laboratorio)

En la web, `npm run dev` → menú **Laboratorio** → pestaña **Jugar contra el piloto**: eliges tu mazo y el del piloto, quién empieza y si el piloto es el fuerte (red aprendida)
o el básico. Es el mismo motor y el mismo piloto de las simulaciones; solo cambia quién decide en un asiento.

**Qué decides tú:** mulligan, qué dado tiras del fixer, vender, jugar (y a qué se equipa un Gear), **con qué Legends pagas** (los Eddies sueltos no se distinguen; se puede
desactivar), Call (a ciegas, salvo las Legends que conoces), Go Solo, a quién atacas,
cómo defiendes (bloquear, Overwatch, Take Control, Synapse Burnout, Floor It, Detonate, Safety Override, Reboot Optics, Dum Dum, River Ward, Goro, Rogue), cómo refuerzas
un ataque (Dum Dum, Synapse Burnout, Cyberpsychosis), los cambios y robos de dados, las habilidades de Hanako, los Tuners, River, Judy, Alt Cunningham y Overwatch en tu turno,
el objetivo de los efectos que eligen entre varias Unidades o cartas y **qué efecto aplicas en las cartas de «elige uno»** (Nocturne, Pyramid Song, Towerfall y el Call de
Dexter, Muamar, Padre y Wakako). También eliges si haces los efectos opcionales («puedes descartar…»: Maman Brigitte, Placide, Gilded Matón, Heywood) y lo que te quedas de las
cartas reveladas (Three Mouths, el Call de Viktor), si robas con Shattered Memories, qué Gear derribas con Detonate, qué Unidad(es) con Bonnie and Clyde, si juegas gratis el Gear de The Heist,
el Gear que sacrificas con Dum Dum, a quién se equipa un Gear que entra gratis (The Heist, Judy), qué Legend boca abajo miras con Kiroshi Optics y el Radioport (y si la llamas gratis), si tiras la carta
de Tetratronic Rippler, si descartas 1 para robar 1 con el Bodyguard de Goro y **qué carta descartas** cada vez que un efecto te lo exige (tuyo o del rival). Panam, Evelyn, Judy Alvarez y Kerry
Eurodyne (Unidades) son acciones propias, ya no hay botón de «habilidades fijas». Cuando juega el piloto, lo que le toca decidir al rival o a cada jugador lo decides tú (Fool on the Hill, Live with the Aftermath).

**Qué sigue automático:** lo que decide el piloto como rival (el efecto de Gunpoint Diplomacy cuando elige por ti: da el que menos te sirve, el +3 solo si cruza un tramo de 10 de poder y atacar
Unidades solo si hay una a la que ganar), lo que la regla no deja elegir (Hanako unidad: te llevas todas las cartas que valen; el Call al azar de una Legend desconocida; Panam al final del turno) y los
objetivos de los efectos que el motor ya reduce a un único candidato. Tu partida se parece mucho a la del piloto
pero **no es idéntica a jugar con las cartas reales**: si algo te parece mal, es un dato (y probablemente un fallo del modelo) que merece anotarse.

**Cómo está hecho** (para no romper nada del piloto): `human.py` sustituye a `ai2` como `Game.ai` solo para tu asiento; las copias de previsión (`g.rollout`) siempre las
decide el piloto, así que nunca te pregunta dentro de sus simulaciones (hay un test). Los objetivos de los efectos pasan por el gancho `Game.chooser` y el pago por `Game.payer` (apagados por defecto;
con ellos apagados las partidas son idénticas a las de siempre). Cada opción que se le ofrece a la persona lleva su origen (`src`: mano, Unidad o Legend), su destino (`to`) o
la carta que elige (`ref`): con eso la interfaz muestra solo las acciones de la carta tocada y traduce cada arrastre a una opción. `live.py` corre la partida en un hilo, enmascara lo que no ves (`replay.snapshot(..., viewer=)`) y guarda todo en
`data/human/`; `lab_play.py` habla JSON por líneas con el servidor de desarrollo (`scripts/lab-api.mjs`).

**Qué se guarda** por partida (`data/human/AAAAMMDD-HHMMSS_seedN.json`): tus decisiones con el tablero de cada momento, **el turno que habría jugado el piloto** al empezar cada uno
de tus turnos (calculado en una copia, sin tocar tu partida), la partida completa con las manos de los dos y las posiciones al final de cada turno en el mismo formato que usa `valfn.py`.

```bash
python tools/deckforge/forge.py humanlog                       # resultados por pareja de mazos y turnos en que haces algo distinto al piloto
python tools/deckforge/forge.py humanlog --sim 100             # añade lo que predice el simulador (piloto contra piloto) para cada pareja
python tools/deckforge/forge.py humanlog --export-rows f.json  # tus posiciones, para entrenar valfn
```

**Cómo leerlo:** una diferencia con el piloto no es un error tuyo ni suyo; es una jugada que merece una mirada, sobre todo en las partidas que ganas. Con pocas partidas sirve
para encontrar fallos concretos del piloto o reglas mal modeladas, **no** para estimar porcentajes: unas decenas de partidas no mueven una red entrenada con miles, y un solo
jugador contra un solo piloto no es una medida de qué mazo es mejor. Si el simulador da a tu mazo un 70 % y tú pierdes casi siempre, eso sí es una señal de calibración.

Comprobaciones: `tests2.py` incluye un jugador aleatorio que completa partidas sin romper reglas ni preguntar en simulaciones, y un jugador que copia el plan del piloto (≈ 92-95 % de
sus turnos salen idénticos: lo que el piloto sabe hacer, tú también puedes hacerlo; los huecos que quedan son azar y habilidades automáticas).

## Previsión del jugador automático

`sim`, `gauntlet`, `explain`, `matrix` y `match` juegan **con previsión**: antes de cada turno el jugador prueba varios planes
(normal, conservador, sin atacar, a por todas, guardarse los Programas) en copias de la partida, con la mano y el mazo del rival
barajados porque no los conoce, simula cuatro turnos más y elige el que deja mejor posición. Con el mismo mazo en los dos lados,
el jugador con previsión gana el 55 % al que no la tiene (794 partidas), y donde más mejora es en los mazos de control.
Cuesta unas 30-40 veces más tiempo (unos 0,2 s por partida), así que `optimize` y `search` criban sin previsión y solo la usan
para validar el resultado final. `--fast` la desactiva en cualquier comando.

## La red de cartas (`graph`)

Cada carta es un nodo con su lógica y se une a las demás a través de **conceptos** del juego (Gig al mínimo, pareja de Gigs,
menos Street Cred, Unidad rival gastada, Gear equipado, llegar a poder 10, Programas en la basura...). De cada carta se guarda
qué **aporta**, qué **necesita**, a qué **responde** y contra qué **flojea**. Cada unión lleva su origen:
`TEXTO` (sale del texto de la carta con reglas fijas), `ANOTADO` (manual, de `net_data.py`) o `MEDIDO` (partidas simuladas).

```bash
python tools/deckforge/forge.py graph export                      # out/graph.html (interactiva), GRAPH_REPORT.md y graph.json
python tools/deckforge/forge.py graph card "Towerfall"            # la lógica de una carta: quién le da lo que pide y quién la aprovecha
python tools/deckforge/forge.py graph path "Wakako" "Towerfall"   # cadena «A aporta lo que B necesita»
python tools/deckforge/forge.py graph deck decks/mi_mazo.json     # razonamiento sobre un mazo
python tools/deckforge/forge.py graph build --legends "Wakako" "Alt Cunningham: Soulkiller" "Hanako Arasaka: Daughter"
python tools/deckforge/forge.py graph measure                     # rellena la capa MEDIDO con los mazos de meta/ y decks/
```

`graph deck` contesta, sin simular nada: qué motores tiene el mazo y si están cubiertos (quién pide cada cosa y quién la da),
qué cartas se quedan sin lo que necesitan, qué respuestas lleva y a qué está expuesto, qué trae cada rival del meta contra
esos puntos débiles, qué cartas legales encajarían y cuáles sobran. `graph build` monta un mazo siguiendo la red a partir de
tres Legends. La red **propone y explica**; el simulador (`explain`, `optimize`) **comprueba**. Una unión `TEXTO` dice que dos
cartas se hablan, no cuánto ganan juntas: para eso está la capa `MEDIDO`.

Las reglas que leen el texto están en `RULES` (`cardgraph.py`). Cuando salgan cartas con una mecánica nueva, añade ahí su
patrón y, si hace falta, un concepto nuevo en `CONCEPTS`.

## Construir razonando (`reason`)

Sigue el orden en que piensa un jugador (ver `razonamiento_cognitivo_tcg.md` del usuario), apoyado en la red de cartas:

1. **Estratega**: elige el plan y escribe la condición de victoria antes de mirar cartas (`PLANS` en `reason.py`).
2. **Ensamblador**: reserva la curva temprana, instala paquetes (primero quien habilita, luego quien cobra; nadie cobra sin
   habilitadores) y cubre eliminación, defensa y valor. Cada carta entra con su motivo.
3. **Analista**: mide tempo temprano y valor y los compara con lo que pide el plan.
4. **Analista de metajuego**: prueba de estrés con partidas, localiza al depredador, explica el porqué con la red y prueba
   cartas de respuesta; las que ayudan en un cruce pero no en la media van al sideboard.
5. **Pulido** opcional (`--polish N`): búsqueda local corta; lo que cambia enseña dónde falló el razonamiento.

```bash
python tools/deckforge/forge.py reason --legends "Wakako" "Alt Cunningham: Soulkiller" "Hanako Arasaka: Daughter" --polish 120
python tools/deckforge/forge.py reason --plan tempo_gosolo        # el plan elige las Legends
```

### Valores medidos (`learn`)

`forge.py learn` juega 30.000 mazos al azar (algo más de un millón de partidas, unos 35 minutos con 3 procesos; necesita numpy)
y ajusta un modelo cuya estructura es la red: cuánto vale cada carta **sola**, cuánto **sube cuando el mazo le da lo que pide**
y cuánto suma cada **habilitador** cuando hay quien lo aproveche. Se guarda en `data/learned.json` y `forge.py learn --show` lo
enseña. Ejemplo real: Maman Brigitte sola resta 10 puntos y con Programas suma 14,6.

Con ese fichero, `reason` monta el mazo con los valores medidos y cada carta sale con su desglose (sola, lo que cobra, lo que
habilita). `--heuristic` vuelve a las reglas a mano. Para Wakako + Alt + Hanako el mazo medido gana el 55,8 % con previsión
(240 partidas por rival), frente al 52,6 % de la lista de BBG con esas Legends y al 15-37 % del ensamblador a mano.

Límites: los valores salen de mazos al azar jugados por la máquina, así que heredan sus defectos (no premia los planes de
dados ni el Gear de River porque no los juega bien) y el margen de cada carta sola es de unos ±4 puntos. Relanza `learn`
cuando cambien las cartas o el jugador automático.

## Fallos humanos y robustez (`robust`)

El jugador automático puede fallar decisiones con una probabilidad dada (mulligan al revés, vender otra carta, perder la mejor
jugada, atacar con otra Unidad, no bloquear ni reaccionar, no usar la previsión). `gauntlet --err 0.1 --err-rival 0.1` lo aplica
y `forge.py robust <mazo>` mide cuánto baja el resultado con 0/10/20/30 % de fallo, ya sea solo en tu piloto o en los dos.
Ojo: el porcentaje es **por decisión** (hay decenas por partida), mucho más duro que «un jugador que falla el 10 %»; sirve para
comparar mazos entre sí, no está calibrado con humanos. Con fallo 0 las partidas son idénticas a las de siempre.

## La IA que aprende (`valfn`, `evolve`)

`valfn.py` entrena una red pequeña (31 variables de la posición → probabilidad de ganar) con posiciones de partidas simuladas.
Con `DECKFORGE_VF=action` (o `vf=` en `Game`) la IA, en cada jugada de su turno, prueba cada opción en copias de la partida
(con la información oculta del rival barajada), termina el turno con su criterio habitual y se queda con la que deja mejor
posición según la red. Medido: gana el 64-65 % de las partidas contra la IA de siempre, también con mazos que no estaban en el
entrenamiento. Queda **apagada por defecto**. Comandos: `valfn collect|train|compare [--variant action]`.

`forge.py evolve` repite el ciclo solo: recoge partidas con la red vigente, entrena una candidata, la enfrenta a la actual y solo
la adopta si gana con claridad (≥52 %); después afina con búsqueda local el mejor mazo de cada situación (contra cada mazo del
meta y contra todos) y vuelve a medir el «salón de mazos» con la IA vigente. Estado en `data/evolve/` (informe.md, redes, salón,
historial); registro en `out/evolve.log`; para pararlo, crear `out/evolve.STOP`. `--quick` hace una vuelta diminuta de prueba
que no adopta redes. Una vuelta completa tarda unos 45 minutos con 4 procesos.

**Búsqueda de secuencias** (`vf='action+plan'`, o `DECKFORGE_PLAN=4` para todos): en cada jugada y cada ataque la IA prueba, en copias de la
partida, la secuencia habitual y varias al azar (orden de pago —Legends antes que Eddies o al revés—, qué jugar, con qué atacar) y se
queda con la mejor según la red; así descubre combos que dependen del orden (p. ej. gastar Legends MERC antes de que Pepe las
prepare) sin programarlos uno a uno. Medido: 52,4 % contra la misma IA sin buscar secuencias (2.393 partidas, ±1,0), a costa de
unas 2 veces más tiempo por partida.

**Variables de dados**: la red también ve la colocación de los dados (parejas, mínimos, d4, Street Cred menor o mayor que el
rival) y qué piden las cartas de la mano, la mesa, las Legends y el mazo, LEÍDO del texto de cada carta (`valfn.CATS`), así que
sirve para cartas nuevas. Acierta más (80,8 % frente a 78,6 %), pero usarla para decidir los dados (`DECKFORGE_DICENET=1`,
`DECKFORGE_DICEPARTS=die,change,swap,steal`) NO mejora el juego (47-50 % contra la IA con las reglas de dados de siempre), así
que está apagado. La red vigente (`data/valfn.json`) es la de 31 variables; la de dados está en `data/valfn_dice.json`.

Límite: aprende jugando contra sí misma, así que mejora contra esa IA, no contra personas; si el simulador modela mal una regla,
la IA aprende a explotar ese fallo.

## Cómo leer `explain`

1. **Factores**: media por partida, tú / rival, y tú cuando ganas / cuando pierdes. Los factores salen de lo que tienen
   los mazos del meta: ventaja de cartas, cartas gratis, eliminación, control de tempo (gastar o inmovilizar), Gigs robados,
   ataques de doble robo (poder 10+), defensa (bloqueos y reacciones), manipulación de dados, descartes, subidas de poder,
   y el desarrollo por turnos (poder en mesa, mano, Eddies).
2. **De dónde sale cada cosa**: qué cartas generan esos robos, eliminaciones y Gigs.
3. **Cartas**: diferencia de victorias cuando ves la carta pronto (mano inicial o tus tres primeros turnos) frente a cuando no.
   `**` = diferencia clara. Una carta con Δ negativo y poco jugada es candidata a salir.
4. **Sinergias**: parejas que juntas ganan más (o menos) de lo esperado por separado. Necesita muchas partidas (`--games 1500+`).
5. **Cruces**: contra cada mazo del campo, qué factor te da ventaja, cuál te supera, qué cartas del rival te hunden
   cuando las juega y con qué te elimina y te roba Gigs. Es la parte de *counters*.

## El meta de referencia (`meta/`)

Listas publicadas en las guías de cyberpunk-tcg-news.de (octubre de 2026), antes de los primeros torneos oficiales:
no hay resultados de torneo, son los mazos que la comunidad considera más fuertes.

- **BBG Control** (Alt + Hanako + Jackie Pour One Out): 29 Programas; eliminación por fondo de mazo, robo de cartas por parejas de Gigs.
- **River's Closet** (River Ward + Muamar + Dexter): 15 Gear; llegar a poder 10 para robar 2 Gigs, Gorilla Arms.
- **Red Aggro** (Adam Smasher + V Streetkid + Dum Dum): cuerpos grandes desde el turno 4, Yorinobu, Go Solo de Smasher.
- **Judy Mono-Blue** (Alt + Jackie + Judy): Judy: Nothing to Doubt, Placide, Towerfall.

Para añadir listas reales: copia el texto de «Exportar» del constructor de mazos, pásalo por `import-text` y guarda el JSON en `meta/`.
`meta_src/` guarda el texto original de las cuatro.

## Formato de un mazo (JSON)

```json
{ "name": "Mi mazo",
  "legends": ["goro_takemura_hands_unclean", "jackie_welles_mama_s_favorite", "judy_alvarez_braindance_maestro"],
  "main": { "valentino_street_racer": 3, "...": 2 },
  "side": { "riot_shield": 1 } }
```

Siempre **IDs** de carta (el campo `id` de `cards.json`), nunca nombres.

## Cuando salgan cartas nuevas

1. `forge.py check` lista las cartas legales sin anotar y cualquier palabra clave nueva.
2. **Efecto**: Unidad → `ONPLAY` (al jugarla) / `on_attack` en `fx2_units.py`, `on_defeated` en `fx2_rules.py` y su valor en `UBON`;
   Programa → `PROG` (efecto) y `PVAL` (valor) en `fx2_programs.py`; Gear → `GBON` (`fx2_units.py`) y, si tiene disparador,
   `on_spent_gear` / `on_steal`... (`fx2_rules.py`).
   Una carta sin efecto modelado se juega solo con su coste y su poder.
3. Si depende de los dados (parejas, mínimos, Street Cred, 8+...), añade su preferencia a `GW` en `ai2_setup.py`.
4. Si una Unidad nueva lleva etiqueta de venta, añade su `id` a `SELL_UNITS` en `cardsdb.py`.
5. Para `score`/`trios`, una línea en `net_data.py` (`id | valor | produce | necesita | contrarresta | vulnerable`).
6. Añade una comprobación a `tests_cards.py` (y a `tests2.py` si trae una regla nueva) y relanza `selftest`, `matrix` y `search`.

## Reglas que asume (y de dónde salen)

- Guía oficial y resumen de las Reglas Completas: gana quien empieza su turno con 7 Gigs; Overtime tras 7 turnos de cada jugador
  (7 Gigs ganan al instante); Eddies solo por venta (todo Gear y Programa; de las Unidades, solo MT0D12 Flathead); las Legends
  se gastan como 1 €; solo se ataca a Unidades gastadas o al área de Gigs; empate de poder = mueren las dos; poder 0 no derrota;
  un ataque bloqueado no roba; «fondo de mazo» no es derrota (no dispara «Defeated», River Ward ni Yorinobu).
- Aclaraciones del usuario: Go Solo exige la Legend boca arriba; el Call da la vuelta a una Legend al azar; el poder del Gear se suma.

## Límites (léelos antes de fiarte de un número)

- Es un **modelo**. El jugador automático prevé unos turnos con planes generales, pero no razona jugada a jugada como un experto
  ni juega alrededor de cartas concretas que el rival pueda tener. Sigue jugando mejor los mazos de mesa que los de control,
  y cambiar una regla de decisión mueve los resultados varios puntos: los porcentajes sirven para **comparar y entender**.
- Sideboard: los cambios se eligen probando cada uno sin previsión (rápido) y se validan con previsión; con pocas partidas
  una mejora de 2-3 puntos puede ser ruido. Se supone que empieza quien perdió la partida anterior.
- Simplificaciones que quedan: Cyberpsychosis solo se usa para rematar o contra una atacante equipada; Gunpoint Diplomacy no se
  juega con menos Street Cred; Evelyn (Legend) solo fuerza ataques si hay forma de castigar a la Unidad gastada.
- Las pruebas cubren unas 90 de las 151 cartas; el resto son Unidades sin texto o efectos menores no comprobados uno a uno.
- No hay datos de torneos con los que calibrar: el meta de referencia es opinión de la comunidad.