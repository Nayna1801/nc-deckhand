"""Fase B del plan de sideboard con PAQUETES: movimientos de 1 copia (de las tablas de `side_plan.py`) y de 2-3 copias iguales (de `side_vs.py`).

Uso:  python tools/deckforge/side_plan_pkg.py decks/consistente_goro_wakako_v.json --vs bbg_control red_aggro out/ryy/ryy_smasher.json [--n-plan 2000] [--procs 2]

Hay cambios que solo funcionan con varias copias a la vez (Valentino Street Racer da Adrenaline a OTRA Unidad: con 1 copia casi no se nota y con 3 sí),
y el plan «de una en una» de `side_plan.py` no los ve. Aquí cada ronda prueba, con las mismas semillas, el plan actual + cada movimiento posible
(cambios de una copia y paquetes) y se queda el que más mejora POR HUECO de sideboard, hasta 7 huecos. Guarda out/plan2_<rival>.json.
"""
import argparse
import json
import re
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
import vs as VS  # noqa: E402
from side_plan import MIN_MARGINAL, SIDE_MAX, _wr  # noqa: E402

BY = DB.BY
BY_NAME = {c['name']: i for i, c in BY.items()}


def apply_moves(main, moves):
    """moves = [(entra, sale, copias)]."""
    deck = list(main)
    for cin, cout, n in moves:
        for _ in range(n):
            deck.remove(cout)
            deck.append(cin)
    return deck


def package_seeds(stem, top=8):
    """Paquetes (entra, sale, copias) que `side_vs.py` midió con la IA fuerte contra este rival, los mejores primero."""
    for name in (f'side_{stem}_ranked_r1.json', f'side_{stem}_ranked.json'):
        p = HERE / 'out' / name
        if p.exists():
            rows = json.load(open(p, encoding='utf8'))['ranked']
            return [(r['into'], r['out'], r['n']) for r in sorted(rows, key=lambda r: -r['delta']) if r['n'] >= 2][:top]
    txt = HERE / 'out' / f'side_vs_{stem}.txt'                       # sin JSON (Red Aggro): se lee del informe de texto
    if txt.exists():
        out = []
        for m in re.finditer(r'^\s+([+-][\d.]+)%\s+\+(\d) (.+?) / -\d (.+?)\s*$', txt.read_text(encoding='utf-8', errors='replace').split('2) IA')[-1], re.M):
            if m.group(3) in BY_NAME and m.group(4) in BY_NAME:
                out.append((float(m.group(1)), BY_NAME[m.group(3)], BY_NAME[m.group(4)], int(m.group(2))))
        return [(c, o, n) for _, c, o, n in sorted(out, reverse=True) if n >= 2][:top]
    return []


def auto_packages(table, top=6):
    """Sin paquetes medidos por `side_vs.py`: los mejores cambios de una copia de la tabla, probados también con 2 y 3 copias."""
    out = []
    for t in [t for t in table if t['delta'] > 0][:top]:
        out += [(t['into'], t['out'], 2), (t['into'], t['out'], 3)]
    return out


def legal(main, plan, move):
    cnt = Counter(main)
    ins, outs = Counter(), Counter()
    for c, o, n in plan:
        ins[c] += n
        outs[o] += n
    cin, cout, n = move
    return (sum(m[2] for m in plan) + n <= SIDE_MAX and cnt.get(cin, 0) + ins[cin] + n <= 3 and outs[cout] + n <= cnt[cout]
            and cin not in outs and cout not in ins)


def label(m):
    return f"+{m[2]} {BY[m[0]]['name']} / -{m[2]} {BY[m[1]]['name']}"


def run_rival(pool, main, legs, rival, a, log):
    stem = Path(rival['key']).stem
    base_plan = json.load(open(HERE / 'out' / f'plan_{stem}.json', encoding='utf8'))
    singles = [(t['into'], t['out'], 1) for t in base_plan['table'] if t["delta"] > 0][:20]
    pkgs = package_seeds(stem) or auto_packages(base_plan['table'])
    log(f"B) {rival['name']}: {len(singles)} cambios de una copia y {len(pkgs)} paquetes ({', '.join(label(m) for m in pkgs[:3])}...)")
    cur = dict(pool.imap_unordered(_wr, [(None, main, legs, rival['deck'], rival['legs'], a.n_plan, 91)]))[None]
    start, plan, gains, left = cur, [], [], singles + pkgs
    while sum(m[2] for m in plan) < SIDE_MAX:
        trial = [m for m in left if legal(main, plan, m)]
        if not trial:
            break
        jobs = [(m, apply_moves(main, plan + [m]), legs, rival['deck'], rival['legs'], a.n_plan, 91) for m in trial]
        got = dict(pool.imap_unordered(_wr, jobs))
        best = max(got, key=lambda m: (got[m] - cur) / m[2])           # mejora por hueco de sideboard
        if got[best] - cur < MIN_MARGINAL * best[2]:
            break
        plan.append(best)
        gains.append(got[best] - cur)
        print(f"   plan: {label(best)}  -> {got[best]:.1%} ({got[best] - cur:+.1%})", flush=True)
        left.remove(best)
        cur = got[best]
    log(f"   plan final: {sum(m[2] for m in plan)} huecos, IA rápida {start:.1%} -> {cur:.1%}")
    return dict(rival=stem, base_plan=start, final_plan=cur, n_plan=a.n_plan,
                plan=[dict(into=c, out=o, n=n, marginal=g) for (c, o, n), g in zip(plan, gains)], table=base_plan['table'])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('deck')
    ap.add_argument('--vs', nargs='+', required=True)
    ap.add_argument('--n-plan', type=int, default=2000)
    ap.add_argument('--procs', type=int, default=2)
    a = ap.parse_args()
    t0 = time.time()
    log = lambda *x: print(*x, f"[{time.time() - t0:.0f}s]", flush=True)
    d = VS.load(a.deck)
    with Pool(a.procs) as pool:
        for rival in VS.meta(a.vs):
            out = run_rival(pool, d['deck'], d['legs'], rival, a, log)
            path = HERE / 'out' / f"plan2_{out['rival']}.json"
            json.dump(dict(deck=a.deck, **out), open(path, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
            log(f"   -> {path}")
    log('fin')
    return 0


if __name__ == '__main__':
    sys.exit(main())
