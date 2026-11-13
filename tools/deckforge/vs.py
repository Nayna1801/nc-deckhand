"""Mide uno o varios mazos contra rivales concretos del meta (por defecto Red Aggro y BBG), con la IA fuerte o la rápida.

Uso:  python tools/deckforge/vs.py mazo1.json [mazo2.json ...] [--vs red_aggro bbg_control] [--games 100] [--procs 3] [--fast]

El trabajo se reparte por (mazo, rival, bloque de semillas), así que con varios mazos usa bien todos los procesos. Da el porcentaje de
victorias por rival con su ruido (±, error típico binomial), la media y el mínimo (el cruce más flojo): para «ganar a X y a Y» manda el mínimo.
"""
import argparse
import json
import math
import sys
import time
from multiprocessing import Pool
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except (AttributeError, OSError, ValueError):
    pass  # salida redirigida a algo sin reconfigure: se queda como está

import cardsdb as DB  # noqa: E402
import engine2 as X  # noqa: E402

BLOCK = 25          # partidas por tarea (cada una con su semilla): reparte bien el trabajo y permite ver el avance


def load(path):
    d = json.load(open(path, encoding='utf8'))
    return dict(name=d['name'], legs=d['legends'], deck=[i for i, n in d['main'].items() for _ in range(n)], main=d['main'])


def meta(names):
    """Rivales por nombre de meta/ (sin .json) o por ruta a un mazo JSON."""
    paths = [Path(n) if n.endswith('.json') else HERE / 'meta' / f'{n}.json' for n in names]
    return [dict(load(p), key=p.stem) for p in paths]


def _task(args):
    di, ri, ids, legs, rids, rlegs, n, seed, strong = args
    vf = ('action', 'action') if strong else None
    w, _ = X.play(ids, legs, rids, rlegs, N=n, seed=seed, vf=vf, deep=(True, True) if strong else None)
    return di, ri, w[0], w[1]


def evaluate(decks, rivals, games, procs, strong, seed=11):
    """Devuelve wins[deck][rival] = (victorias, partidas decididas)."""
    jobs = []
    for di, d in enumerate(decks):
        for ri, r in enumerate(rivals):
            for b in range(math.ceil(games / BLOCK)):
                jobs.append((di, ri, d['deck'], d['legs'], r['deck'], r['legs'], min(BLOCK, games - b * BLOCK), seed + b, strong))
    wins = [[[0, 0] for _ in rivals] for _ in decks]
    with Pool(procs) as pool:
        for di, ri, a, b in pool.imap_unordered(_task, jobs):
            wins[di][ri][0] += a
            wins[di][ri][1] += a + b
    return wins


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('decks', nargs='+')
    ap.add_argument('--vs', nargs='+', default=['red_aggro', 'bbg_control'])
    ap.add_argument('--games', type=int, default=100)
    ap.add_argument('--procs', type=int, default=3)
    ap.add_argument('--seed', type=int, default=11, help='semilla base (otra semilla = partidas distintas, para confirmar sin repetir las de antes)')
    ap.add_argument('--weights', type=float, nargs='+', help='peso de cada rival (mismo orden que --vs) para la media ponderada')
    ap.add_argument('--fast', action='store_true', help='IA rápida en vez de la fuerte (juega peor defensa y control)')
    a = ap.parse_args()
    decks = [load(p) for p in a.decks]
    rivals = meta(a.vs)
    t0 = time.time()
    wins = evaluate(decks, rivals, a.games, a.procs, not a.fast, a.seed)
    print(f"IA {'rápida' if a.fast else 'fuerte'} · {a.games} partidas por rival (error típico ≈ ±{50 / math.sqrt(a.games):.1f} puntos por cruce) [{time.time() - t0:.0f}s]")
    wts = a.weights or [1.0] * len(rivals)
    assert len(wts) == len(rivals), '--weights necesita un peso por rival'
    print('  ' + ' · '.join(r['key'] for r in rivals) + '  | ponderada · mínimo')
    for d, row in zip(decks, wins):
        p = [w / max(1, n) for w, n in row]
        print(f"  {' '.join(f'{x:5.1%}' for x in p)}  | {sum(x * w for x, w in zip(p, wts)) / sum(wts):5.1%} · {min(p):5.1%}  {d['name']}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
