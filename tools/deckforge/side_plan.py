"""Plan de sideboard LIBRE contra uno o varios rivales: hasta 7 intercambios de UNA copia, cada uno con su carta que entra y su carta que sale.

Uso:  python tools/deckforge/side_plan.py decks/consistente_goro_wakako_v.json --vs bbg_control red_aggro out/ryy/ryy_smasher.json [--n-fast 500] [--procs 2]

A diferencia de `side_vs.py` (paquetes de 2-3 copias iguales), aquí cada cambio es una copia por otra copia y cada uno puede ser de cartas
distintas: se pueden quitar 1 o 2 copias de una carta y no hace falta llenar el sideboard de copias de la misma carta.
  A) tabla: TODOS los cambios de una copia (carta que entra, carta que sale) con muchas partidas rápidas y las MISMAS semillas para el mazo
     base y los cambiados (el ruido de las diferencias baja mucho);
  B) plan: se añaden los cambios de uno en uno (el mejor de cada ronda, probando el plan entero con más partidas) hasta 7 o hasta que ya no ayuden.
La IA rápida solo criba (se equivoca con los rivales agresivos): los planes se confirman después con la IA fuerte (`side_assemble.py`).
Guarda out/plan_<rival>.json con la tabla y el plan.
"""
import argparse
import json
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
import engine2 as X  # noqa: E402
import search as SR  # noqa: E402
import vs as VS  # noqa: E402

BY = DB.BY
SIDE_MAX = 7
MIN_MARGINAL = 0.004     # un cambio entra en el plan si mejora al menos 0,4 puntos (con las mismas semillas)


def apply_swaps(main, swaps):
    """swaps = [(carta que entra, carta que sale)], una copia cada uno."""
    deck = list(main)
    for cin, cout in swaps:
        deck.remove(cout)
        deck.append(cin)
    return deck


def _wr(args):
    tag, ids, legs, rids, rlegs, n, seed = args
    w, _ = X.play(ids, legs, rids, rlegs, N=n, seed=seed)
    return tag, w[0] / max(1, w[0] + w[1])


def singles(main, legs):
    cnt = Counter(main)
    return [(cin, cout) for cin in SR.allowed(legs) if cnt.get(cin, 0) < 3 for cout in cnt if cout != cin]


def legal_add(main, plan, cand):
    """¿Se puede añadir el cambio `cand` al plan sin romper copias ni deshacer otro cambio?"""
    cnt = Counter(main)
    ins, outs = Counter(c for c, _ in plan), Counter(o for _, o in plan)
    cin, cout = cand
    return (len(plan) < SIDE_MAX and cnt.get(cin, 0) + ins[cin] + 1 <= 3 and outs[cout] + 1 <= cnt[cout]
            and cin not in outs and cout not in ins)


def label(cin, cout):
    return f"+1 {BY[cin]['name']} / -1 {BY[cout]['name']}"


def run_rival(pool, main, legs, rival, a, log):
    cands = singles(main, legs)
    log(f"A) {rival['name']}: tabla de {len(cands)} cambios de una copia, {a.n_fast} partidas rápidas cada uno (mismas semillas)...")
    jobs = [(None, main, legs, rival['deck'], rival['legs'], a.n_fast, 77)] + [
        ((c, o), apply_swaps(main, [(c, o)]), legs, rival['deck'], rival['legs'], a.n_fast, 77) for c, o in cands]
    res = dict(pool.imap_unordered(_wr, jobs, chunksize=8))
    base = res[None]
    table = sorted(((res[c] - base, c) for c in cands), reverse=True)
    log(f"   sin cambios (IA rápida) {base:.1%}; los 8 mejores y los 3 peores:")
    for d, (c, o) in table[:8] + table[-3:]:
        print(f"   {d:+.1%}  {label(c, o)}")
    log(f"B) plan: se añaden cambios de uno en uno (hasta {SIDE_MAX}), probando el plan entero con {a.n_plan} partidas...")
    plan, cur = [], None
    jobs = [(None, main, legs, rival['deck'], rival['legs'], a.n_plan, 91)]
    cur = dict(pool.imap_unordered(_wr, jobs))[None]
    start = cur
    pool_c = [c for d, c in table if d > 0][:40]
    while len(plan) < SIDE_MAX:
        trial = [c for c in pool_c if legal_add(main, [p[:2] for p in plan], c)][:10]
        if not trial:
            break
        jobs = [(c, apply_swaps(main, [p[:2] for p in plan] + [c]), legs, rival['deck'], rival['legs'], a.n_plan, 91) for c in trial]
        got = dict(pool.imap_unordered(_wr, jobs))
        best = max(got, key=got.get)
        if got[best] < cur + MIN_MARGINAL:
            break
        plan.append((best[0], best[1], got[best], got[best] - cur))
        print(f"   plan {len(plan)}: {label(*best)}  -> {got[best]:.1%} ({got[best] - cur:+.1%})", flush=True)
        cur = got[best]
        pool_c.remove(best)
    log(f"   plan final: {len(plan)} cambios, IA rápida {start:.1%} -> {cur:.1%}")
    return dict(rival=Path(rival['key']).stem, base_fast=base, base_plan=start, final_plan=cur, n_fast=a.n_fast, n_plan=a.n_plan,
                plan=[dict(into=c, out=o, value=v, marginal=m) for c, o, v, m in plan],
                table=[dict(into=c, out=o, delta=d) for d, (c, o) in table[:40]])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('deck')
    ap.add_argument('--vs', nargs='+', required=True, help='rivales: nombre de meta/ (sin .json) o ruta a un mazo JSON')
    ap.add_argument('--n-fast', type=int, default=500, help='partidas rápidas por cambio en la tabla')
    ap.add_argument('--n-plan', type=int, default=2500, help='partidas rápidas por prueba del plan entero')
    ap.add_argument('--procs', type=int, default=2)
    a = ap.parse_args()
    t0 = time.time()
    log = lambda *x: print(*x, f"[{time.time() - t0:.0f}s]", flush=True)
    d = VS.load(a.deck)
    with Pool(a.procs) as pool:
        for rival in VS.meta(a.vs):
            out = run_rival(pool, d['deck'], d['legs'], rival, a, log)
            path = HERE / 'out' / f"plan_{out['rival']}.json"
            json.dump(dict(deck=a.deck, **out), open(path, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
            log(f"   -> {path}")
    log('fin')
    return 0


if __name__ == '__main__':
    sys.exit(main())
