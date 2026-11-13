"""Busca el mejor mazo combinando todo: valores medidos (learn) -> criba de todas las ternas -> partidas -> pulido -> validación con previsión.

Uso:  python tools/deckforge/best.py [--procs 3] [--keep 5]
      python tools/deckforge/best.py --units 12 16 --tag u12-16     (solo mazos con 12 a 16 Unidades)
      python tools/deckforge/best.py --vs red_aggro bbg_control --strong --tag vs    (el mejor mazo contra ESOS rivales, validado con la IA fuerte)
"""
import argparse
import json
import os
import sys
import time
from collections import Counter
from multiprocessing import Pool
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except (AttributeError, OSError, ValueError):
    pass  # salida sin reconfigure (redirigida a un objeto que no es un fichero de texto): se queda como está

import cardsdb as DB  # noqa: E402
import engine2 as X  # noqa: E402
import search as SR  # noqa: E402

BY = DB.BY
_M = None


def model():
    global _M
    if _M is None:
        import learn as LN
        _M = LN.Model()
    return _M


def bounds():
    """Rango de Unidades del mazo que monta el modelo: el de siempre o el de DECKFORGE_UNITS="12,16" (--units)."""
    v = os.environ.get('DECKFORGE_UNITS')
    return tuple(int(x) for x in v.split(',')) if v else (10, 26)


def _screen(trio):
    """Mazo voraz (sin intercambios) y su predicción: barato, para ordenar las 2.850 ternas."""
    M = model()
    cnt, pred = M.build(list(trio), units=bounds(), sweeps=0)
    return list(trio), pred


def _full(trio):
    M = model()
    cnt, pred = M.build(list(trio), units=bounds(), sweeps=3)
    return list(trio), pred, list(cnt.elements())


def _gaunt(args):
    ids, legs, field, games, seed, deep, strong = args
    out = []
    for f in field:
        w, _ = X.play(ids, legs, f['deck'], f['legs'], N=games, seed=seed, deep=(deep, deep) if deep else None,
                      vf=('action', 'action') if strong else None)
        out.append(w[0] / max(1, w[0] + w[1]))
    return out


def load(path):
    d = json.load(open(path, encoding='utf8'))
    return dict(name=d['name'], legs=d['legends'], deck=[i for i, n in d['main'].items() for _ in range(n)])


def names(legs):
    return ' + '.join(BY[l]['displayName'] for l in legs)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--procs', type=int, default=3)
    ap.add_argument('--keep', type=int, default=5)
    ap.add_argument('--shortlist', type=int, default=30)
    ap.add_argument('--units', type=int, nargs=2, metavar=('MIN', 'MAX'), help='rango de Unidades del mazo (por defecto 10-26 al montar y 12-28 al pulir)')
    ap.add_argument('--tag', default='', help='se añade al nombre de los ficheros de salida (mejor_<tag>_N.json)')
    ap.add_argument('--iters', type=int, default=120, help='cambios que se prueban al pulir cada mazo')
    ap.add_argument('--polish-games', type=int, default=40, help='partidas por rival en cada prueba del pulido')
    ap.add_argument('--deep-games', type=int, default=200, help='partidas por rival de la validación final con previsión')
    ap.add_argument('--vs', nargs='+', metavar='META', help='solo estos rivales del meta (nombre del fichero de meta/, sin .json); sin mazos de referencia')
    ap.add_argument('--weights', type=float, nargs='+', help='peso de cada rival de --vs (mismo orden) para ordenar por media ponderada en vez de por el cruce más flojo')
    ap.add_argument('--also', nargs='+', default=[], metavar='MAZO.json', help='mazos ya hechos que se validan en las mismas condiciones')
    ap.add_argument('--strong', action='store_true', help='la validación final usa la IA fuerte (valoración aprendida en cada jugada) en vez de la previsión')
    a = ap.parse_args()
    if a.units:
        os.environ['DECKFORGE_UNITS'] = f'{a.units[0]},{a.units[1]}'      # lo heredan los procesos hijos
    t0 = time.time()
    log = lambda *x: print(*x, f"[{time.time() - t0:.0f}s]", flush=True)
    refs_paths = [p for p in (HERE / 'decks' / 'tempo_jackie_v_wakako.json', HERE / 'decks' / 'tempo_jackie_lucyna_v.json')
                  if not set(json.load(open(p, encoding='utf8'))['legends']) & DB.UNAVAILABLE]
    meta_paths = [Path(n) if n.endswith('.json') else HERE / 'meta' / f'{n}.json' for n in a.vs] if a.vs else sorted((HERE / 'meta').glob('*.json'))
    wts = a.weights or [1.0] * n_vs if (n_vs := len(a.vs or [])) else None
    field = [load(p) for p in meta_paths] + ([] if a.vs else [load(p) for p in refs_paths])
    n_meta = len(meta_paths)
    trios = SR.all_trios()
    with Pool(a.procs) as pool:
        log(f"1) Criba de {len(trios)} ternas con el modelo medido...")
        res = sorted(pool.imap_unordered(_screen, trios, chunksize=25), key=lambda r: -r[1])
        log('   mejores por predicción: ' + ' | '.join(f"{names(l)} {p:+.0f}" for l, p in res[:5]))
        log(f"2) Mazo completo (con intercambios) de las {a.shortlist} mejores...")
        full = sorted(pool.map(_full, [tuple(r[0]) for r in res[:a.shortlist]]), key=lambda r: -r[1])
        log(f"3) Partidas sin previsión contra {len(field)} mazos (300 por rival)...")
        g = pool.map(_gaunt, [(d, l, field, 300, 5, False, False) for l, p, d in full])
        ranked = sorted(zip(full, g), key=lambda t: -sum(t[1]) / len(t[1]))
        for (l, p, d), r in ranked[:10]:
            log(f"   {sum(r) / len(r):5.1%} (predicción {p:+.0f})  {names(l)}")
        top = ranked[:a.keep]
        log(f"4) Pulido carta a carta de las {len(top)} mejores ({a.iters} cambios)...")
        pol = pool.map(SR.climb, [(l, field, d, a.iters, a.polish_games, 300 + k) for k, ((l, p, d), r) in enumerate(top)])
        cands = [(l, dk) for ((l, p, d), r), (dk, f) in zip(top, pol)] + [(l, d) for (l, p, d), r in top[:2]]
        seen, uniq = set(), []
        for l, dk in cands:                                    # sin duplicados (con --iters 0 el pulido deja el mazo igual)
            if (key := (tuple(sorted(l)), tuple(sorted(dk)))) not in seen:
                seen.add(key)
                uniq.append((l, dk))
        cands = uniq
        extra = [load(p) for p in a.also]
        cands += [(e['legs'], e['deck']) for e in extra]
        log(f"5) Validación CON previsión ({len(cands)} mazos y 2 de referencia, {a.deep_games} partidas por rival)...")
        refs = [(f['legs'], f['deck']) for f in field[n_meta:]]
        val = pool.map(_gaunt, [(d, l, field, a.deep_games, 777, True, a.strong) for l, d in cands + refs])
    out = HERE / 'out'
    out.mkdir(exist_ok=True)
    rows = []
    for k, ((l, d), r) in enumerate(zip(cands + refs, val)):
        kind = 'añadido' if len(cands) - len(extra) <= k < len(cands) else ('pulido' if k < len(top) else ('sin pulir' if k < len(cands) else 'referencia'))
        rows.append((sum(r[:n_meta]) / n_meta, sum(r) / len(r), kind, l, d, r))
    if a.vs and a.weights:
        rows.sort(key=lambda t: -sum(x * w for x, w in zip(t[5][:n_meta], wts)) / sum(wts))      # con --weights manda la media ponderada
    else:
        rows.sort(key=lambda t: -min(t[5][:n_meta]) if a.vs else -t[1])                     # con --vs manda el cruce más flojo
    print('\nResultado con previsión (media contra el meta · media contra los 6 · por rival):')
    for k, (m4, m6, kind, l, d, r) in enumerate(rows, 1):
        print(f"{k}. meta {m4:.1%} · todos {m6:.1%} [{kind}]  {names(l)}")
        print('      ' + ' · '.join(f"{f['name'].replace('Meta · ', '')[:22]} {x:.0%}" for f, x in zip(field, r)))
        if kind != 'referencia':
            p = out / f"mejor{'_' + a.tag if a.tag else ''}_{k}.json"
            json.dump(dict(name=f"mejor {k}: " + ' + '.join(BY[x]['name'].split(':')[0] for x in l), legends=l, main=dict(Counter(d)), side={}),
                      open(p, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
            print(f"      -> {p}")
    log('fin')


if __name__ == '__main__':
    main()
