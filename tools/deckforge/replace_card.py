"""¿Qué carta poner en lugar de una que no tienes (o de la que solo tienes menos copias)? Criba rápida y confirmación con la IA fuerte.

Uso:  python tools/deckforge/replace_card.py decks/consistente_goro_wakako_v.json --out towerfall [--n 1] \
          --vs bbg_control:0.35 out/ryy/ryy_royce_muamar.json:0.35 red_aggro:0.15 rivers_closet:0.10 judy_mono_blue:0.05 [--strong-vs bbg_control red_aggro ...]

  1) criba rápida: cada carta legal que cabe (máx. 3 copias) entra en lugar de `--n` copias de la carta que sale; se mide contra todos los rivales con
     las MISMAS semillas que el mazo original (mide diferencias, no niveles) y se ordena por la media ponderada;
  2) las `--top` mejores se miden con la IA fuerte (con el mazo original como referencia) contra los rivales de `--strong-vs`.
La IA rápida solo criba; manda la fuerte. No sabe qué cartas tienes: da varias opciones para que elijas la que te falte menos.
"""
import argparse
import math
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
    pass  # salida redirigida a algo sin reconfigure: se queda como está

import cardsdb as DB  # noqa: E402
import search as SR  # noqa: E402
import vs as VS  # noqa: E402
from side_plan import _wr  # noqa: E402

BY = DB.BY


def parse(items):
    out = []
    for it in items:
        spec, sep, w = it.rpartition(':')
        out.append((spec, float(w)) if sep and not it.endswith('.json') else (it, 1.0))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('deck')
    ap.add_argument('--out', required=True, help='id de la carta que sale (p. ej. towerfall)')
    ap.add_argument('--n', type=int, default=1, help='copias que salen y se sustituyen por UNA misma carta nueva')
    ap.add_argument('--vs', nargs='+', required=True, help='rival[:peso] ...')
    ap.add_argument('--strong-vs', nargs='+', help='rivales de la confirmación con la IA fuerte (por defecto todos los de --vs)')
    ap.add_argument('--fast-games', type=int, default=600)
    ap.add_argument('--top', type=int, default=4)
    ap.add_argument('--games', type=int, default=200, help='partidas con la IA fuerte por mazo y rival')
    ap.add_argument('--procs', type=int, default=2)
    a = ap.parse_args()
    t0 = time.time()
    log = lambda *x: print(*x, f"[{time.time() - t0:.0f}s]", flush=True)
    d = VS.load(a.deck)
    main_ids, legs = d['deck'], d['legs']
    cnt = Counter(main_ids)
    assert cnt[a.out] >= a.n, f'el mazo no lleva {a.n} copias de {a.out}'
    specs = parse(a.vs)
    rivals = VS.meta([s for s, _ in specs])
    wts = [w for _, w in specs]
    cands = [c for c in SR.allowed(legs) if c != a.out and cnt.get(c, 0) + a.n <= 3]

    def swapped(cin):
        deck = list(main_ids)
        for _ in range(a.n):
            deck.remove(a.out)
            deck.append(cin)
        return deck

    log(f"1) Criba rápida: {len(cands)} cartas en lugar de {a.n} {BY[a.out]['name']}, contra {len(rivals)} rivales ({a.fast_games} partidas, mismas semillas)...")
    jobs = [((k, None), main_ids, legs, r['deck'], r['legs'], a.fast_games, 51) for k, r in enumerate(rivals)] + [
        ((k, c), swapped(c), legs, r['deck'], r['legs'], a.fast_games, 51) for c in cands for k, r in enumerate(rivals)]
    with Pool(a.procs) as pool:
        res = dict(pool.imap_unordered(_wr, jobs, chunksize=8))
    wmean = lambda c: sum(res[(k, c)] * w for k, w in enumerate(wts)) / sum(wts)
    base = wmean(None)
    ranked = sorted(cands, key=lambda c: -wmean(c))
    print(f"   mazo original (IA rápida) {base:.1%}; las 8 mejores cartas (diferencia ponderada) y las 3 peores:")
    for c in ranked[:8] + ranked[-3:]:
        print(f"   {wmean(c) - base:+.1%}  {BY[c]['name']}  ·  " + ' '.join(f"{res[(k, c)] - res[(k, None)]:+.0%}" for k in range(len(rivals))))
    top = ranked[:a.top]

    strong = [(s, w) for s, w in specs if not a.strong_vs or Path(s).stem in {Path(x).stem for x in a.strong_vs}]
    srivals = VS.meta([s for s, _ in strong])
    log(f"2) IA FUERTE: el mazo original y las {len(top)} mejores, {a.games} partidas contra {', '.join(Path(s).stem for s, _ in strong)} (±{50 / math.sqrt(a.games):.1f} por cruce)...")
    decks = [dict(name=f"original (con {cnt[a.out]} {BY[a.out]['name']})", deck=main_ids, legs=legs)] + [
        dict(name=f"+{a.n} {BY[c]['name']}", deck=swapped(c), legs=legs) for c in top]
    wins = VS.evaluate(decks, srivals, a.games, a.procs, True, 4400)
    sw = [w for _, w in strong]
    print('  ' + ' '.join(f"{r['key'][:12]:>12s}" for r in srivals) + '  | ponderada')
    for dk, row in zip(decks, wins):
        p = [w / max(1, n) for w, n in row]
        print('  ' + ' '.join(f'{x:12.1%}' for x in p) + f"  | {sum(x * w for x, w in zip(p, sw)) / sum(sw):5.1%}  {dk['name']}")
    log('fin')
    return 0


if __name__ == '__main__':
    sys.exit(main())
