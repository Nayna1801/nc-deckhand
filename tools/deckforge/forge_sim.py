"""Comandos de simulación de deckforge: sim, gauntlet, robust, valfn, evolve, hands, explain y matrix."""
import json
import math
import os
import time
from collections import defaultdict
from multiprocessing import Pool
from pathlib import Path

import cardsdb as DB
import engine2 as X
import explain as XP
import playbook as PB
import replay as RP
from deckio import BY, ids_of, load_deck
from forge_basic import deck_report


# ----------------------------------------------------------------------------- simulación
def build_side(d):
    return ids_of(d['main']), list(d['legends'])


def cmd_sim(a):
    A, B = load_deck(a.deck_a), load_deck(a.deck_b)
    da, la = build_side(A)
    db, lb = build_side(B)
    n = a.games
    first = second = 0
    wa = 0
    t0 = time.time()
    for i in range(n):
        if i % 2 == 0:
            g = X.Game(da, la, db, lb, a.seed * 100003 + i)
            r = g.run()
            wa += (r == 0)
            first += (r == 0)
        else:
            g = X.Game(db, lb, da, la, a.seed * 100003 + i)
            r = g.run()
            wa += (r == 1)
            second += (r == 1)
    h = n // 2
    print(f"{A['name']} vs {B['name']}: {wa}/{n} = {wa / n:.1%} victorias de A  (empezando: {first / max(1, h):.0%}, de segundo: {second / max(1, n - h):.0%})  [{time.time() - t0:.0f}s]")
    return 0


def set_vf(name):
    """Valoración de posición de la IA (hand | learned | action) en esta ejecución y en los procesos hijos."""
    os.environ['DECKFORGE_VF'] = name
    X.VF_DEFAULT = name


def set_deep(on):
    """Activa o desactiva la previsión del jugador automático (también en los procesos hijos)."""
    os.environ['DECKFORGE_DEEP'] = '1' if on else '0'
    X.DEEP_DEFAULT = bool(on)


def load_field(path):
    p = Path(path)
    if p.is_dir():
        out = []
        for f in sorted(p.glob('*.json')):
            d = load_deck(f)
            out.append(dict(name=d['name'], legs=d['legends'], deck=ids_of(d['main'])))
        return out
    data = json.load(open(p, encoding='utf8'))
    out = []
    for x in data:
        out.append(dict(name=x['name'], legs=x.get('legs') or x['legends'], deck=x['deck'] if isinstance(x['deck'], list) else ids_of(x['deck'])))
    return out


def _gaunt_one(args):
    ids, legs, fdeck, flegs, n, seed, err = args
    w, _ = X.play(ids, legs, fdeck, flegs, N=n, seed=seed, err=err)
    return w[0] / max(1, w[0] + w[1])


def gauntlet(ids, legs, field, n, seed, procs, err=None):
    """err = (fallo del mazo propio, fallo de los rivales) o None (sin fallos, salvo DECKFORGE_ERR)."""
    jobs = [(ids, legs, f['deck'], f['legs'], n, seed, err) for f in field]
    if procs > 1:
        with Pool(procs) as p:
            return p.map(_gaunt_one, jobs)
    return [_gaunt_one(j) for j in jobs]


def cmd_gauntlet(a):
    d = load_deck(a.deck)
    field = load_field(a.field)
    t0 = time.time()
    res = gauntlet(ids_of(d['main']), d['legends'], field, a.games, a.seed, a.procs,
                   err=(a.err, a.err_rival) if (a.err or a.err_rival) else None)
    avg = sum(res) / len(res)
    se = math.sqrt(sum((x - avg) ** 2 for x in res) / max(1, len(res) - 1) / len(res))
    print(f"{d['name']} contra {len(field)} mazos ({a.games} partidas c/u): {avg:.1%}  (±{se:.1%} entre rivales)  [{time.time() - t0:.0f}s]")
    for v, f in sorted(zip(res, field), key=lambda t: t[0]):
        print(f"  {v:5.0%}  vs {f['name']}")
    return 0


def cmd_robust(a):
    """¿Cuánto pierde el mazo si quien lo juega falla decisiones (mulligan, venta, jugadas, ataques, bloqueos)?"""
    d = load_deck(a.deck)
    field = load_field(a.field)
    levels = [float(x) for x in a.levels.split(',')]
    modes = [('solo', 'solo falla el piloto del mazo'), ('both', 'fallan los dos pilotos')]
    modes = [m for m in modes if a.mode in ('all', m[0])]
    t0 = time.time()
    lines = [f"{d['name']} - robustez frente a fallos humanos ({a.games} partidas por rival, {len(field)} rivales)"]
    for key, label in modes:
        lines.append(f"  {label}:")
        base = None
        for e in levels:
            res = gauntlet(ids_of(d['main']), d['legends'], field, a.games, a.seed, a.procs, err=(e, e if key == 'both' else 0.0))
            avg = sum(res) / len(res)
            base = avg if base is None else base
            cruces = '  '.join(f"{v:4.0%}" for v in res)
            lines.append(f"    fallo {e:4.0%}: {avg:5.1%}  ({avg - base:+.1%})   por rival: {cruces}")
            print(lines[-1], flush=True)
    lines.append(f"  orden de rivales: {', '.join(f['name'][:28] for f in field)}  [{time.time() - t0:.0f}s]")
    print(lines[-1])
    if a.out:
        Path(a.out).write_text('\n'.join(lines) + '\n', encoding='utf8')
    return 0


def cmd_valfn(a):
    import valfn as V
    if a.action == 'collect':
        V.collect(a.fast_games, a.deep_games, a.procs, out=a.data, vf=a.vf)
    elif a.action == 'train':
        V.train(epochs=a.epochs, out=a.out, data=a.data)
    else:
        decks = [(d['name'], ids_of(d['main']), list(d['legends'])) for d in
                 (load_deck(p) for p in sorted(Path(a.field).glob('*.json')) + [Path(a.deck)])]
        set_deep(True)
        V.compare(decks, a.games, a.procs, variant=a.variant, other=a.other)
    return 0


def cmd_evolve(a):
    import evolve
    return evolve.run(cycles=a.cycles, hours=a.hours, procs=a.procs, quick=a.quick)


def cmd_hands(a):
    d = load_deck(a.deck)
    deck, L = build_side(d)
    agg = {True: defaultdict(lambda: [0.0, 0.0, 0.0, 0, 0]), False: defaultdict(lambda: [0.0, 0.0, 0.0, 0, 0])}
    for i in range(a.n):
        g = X.Game(deck, L, deck, L, 9000 + i)
        g.run(maxturns=10)
        for p in g.p:
            for t, (pw, hand, e, _mg, _og) in g.snap[p.pi].items():
                x = agg[p.first][t]
                x[0] += pw
                x[1] += hand
                x[2] += e
                x[3] += pw == 0
                x[4] += 1
    print(f"{d['name']} - desarrollo en el espejo ({a.n} partidas, ambos asientos), al final de cada turno propio:")
    for first in (True, False):
        for t in (1, 2, 3, 4):
            x = agg[first].get(t)
            if not x or not x[4]:
                continue
            n = x[4]
            print(f"  {'1º' if first else '2º'} jugador, turno {t}: {x[2] / n:.1f} Eddies | {x[0] / n:.1f} de poder en mesa | {x[1] / n:.1f} cartas en mano | mesa vacía {x[3] / n:.0%}")
    n40 = sum(d['main'].values())
    k = sum(1 for i in ids_of(d['main']) if BY[i]['type'] != 'Unit' or i in DB.SELL_UNITS)
    hyp = lambda N, K, n, j: math.comb(K, j) * math.comb(N - K, n - j) / math.comb(N, n)
    print(f"\nMano inicial de 6 con {k} vendibles de {n40}: P(0)={hyp(n40, k, 6, 0):.1%}  P(1)={hyp(n40, k, 6, 1):.1%}  P(>=2)={1 - hyp(n40, k, 6, 0) - hyp(n40, k, 6, 1):.1%}")
    return 0


def cmd_explain(a):
    d = load_deck(a.deck)
    errs, _ = deck_report(d)
    if errs:
        print('AVISO: el mazo no es legal:', errs)
    field = load_field(a.field)
    ids = ids_of(d['main'])
    t0 = time.time()
    accs = XP.run(ids, d['legends'], field, a.games, a.seed, a.procs)
    text, _ = XP.report(d['name'], field, accs, ids, top=a.top)
    print(text)
    print(f"\n[{time.time() - t0:.0f}s · {a.games} partidas por rival · es un modelo: sirve para comparar y entender, no como probabilidad real]")
    if a.out:
        open(a.out, 'w', encoding='utf8').write(text + '\n')
        print(f'Informe guardado en {a.out}')
    return 0


def cmd_playbook(a):
    """Guía de juego: victorias por rival, por tipo de mano y por situación, y qué jugar o vender en cada turno."""
    d = load_deck(a.deck)
    errs, _ = deck_report(d)
    if errs:
        print('AVISO: el mazo no es legal:', errs)
    field = load_field(a.field)
    t0 = time.time()
    recs = PB.collect(ids_of(d['main']), d['legends'], field, a.games, a.seed, a.procs)
    names = sorted({r['rival'] for r in recs}) if a.per_rival else [a.rival]
    text = ('\n\n' + '=' * 100 + '\n\n').join(PB.report(d['name'], recs, n) for n in names)
    print(text)
    print(f"\n[{time.time() - t0:.0f}s · {a.games} partidas por rival]")
    if a.out:
        open(a.out, 'w', encoding='utf8').write(text + '\n')
        print(f'Guía guardada en {a.out}')
    return 0


def _as_replay_deck(path):
    d = load_deck(path)
    return dict(name=d['name'], legs=list(d['legends']), main=ids_of(d['main']))


def cmd_replay(a):
    """Graba partidas completas (estado del tablero y texto de cada acción) para verlas en la página visor."""
    pairs = [(_as_replay_deck(a.deck_a), _as_replay_deck(a.deck_b))]
    data = RP.build(pairs, a.games, a.seed, a.out, deep=not a.fast, append=a.append)
    for g in data['games'][-a.games:]:
        print(f"{g['title']}: ganó J{g['winner'] + 1} en el turno {g['turns']} ({len(g['steps'])} pasos)")
    print(f"Guardado en {a.out} ({len(data['games'])} partidas en total, {len(data['cards'])} cartas)")
    return 0


def _matrix_row(args):
    i, field, n, seed = args
    return [X.play(field[i]['deck'], field[i]['legs'], f['deck'], f['legs'], N=n, seed=seed)[0] for f in field]


def cmd_matrix(a):
    field = load_field(a.field)
    for extra in a.also or []:
        d = load_deck(extra)
        field.append(dict(name=d['name'], legs=d['legends'], deck=ids_of(d['main'])))
    t0 = time.time()
    with Pool(min(a.procs, len(field))) as p:
        rows = p.map(_matrix_row, [(i, field, a.games, a.seed) for i in range(len(field))])
    print(f"Todos contra todos ({a.games} partidas por cruce). Fila = % de victorias de ese mazo contra cada columna.")
    print(' ' * 46 + ''.join(f'{j + 1:>6}' for j in range(len(field))) + '   media')
    avg = []
    for i, r in enumerate(rows):
        v = [w[0] / max(1, w[0] + w[1]) for w in r]
        m = sum(x for j, x in enumerate(v) if j != i) / max(1, len(v) - 1)
        avg.append((m, field[i]['name']))
        print(f"{i + 1:>2} {field[i]['name'][:42]:42s} " + ''.join(f'{x:6.0%}' for x in v) + f'  {m:6.1%}')
    print('\nClasificación: ' + ' > '.join(f"{n} ({m:.0%})" for m, n in sorted(avg, reverse=True)) + f"  [{time.time() - t0:.0f}s]")
    return 0
