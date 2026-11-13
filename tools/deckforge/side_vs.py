"""Busca el sideboard (hasta 7 cartas) de un mazo contra UN rival concreto y lo valida con la IA fuerte.

Uso:  python tools/deckforge/side_vs.py decks/consistente_goro_wakako_v.json --vs red_aggro [--top 12] [--games 150] [--final-games 400] [--procs 2]

Tres fases:
  1) criba rápida (IA rápida, barata): cada cambio posible «k copias de una carta legal entran, k de las del mazo salen» (k = 2 o 3);
  2) las mejores cartas (una por carta que entra, con su mejor carta que sale) se miden con la IA FUERTE y se comparan con el mazo sin cambios;
  3) se combinan las que mejoran (sin pisarse, hasta 7 cartas de sideboard) y cada combinación se valida con más partidas.
La IA rápida es mal árbitro contra Red Aggro (juega peor defensa), por eso solo sirve de criba: el veredicto es el de la IA fuerte.
Guarda el plan en out/side_<rival>.json. No toca el mazo: copia el sideboard a un JSON de mazo nuevo solo si tú lo decides.
"""
import argparse
import json
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
import engine2 as X  # noqa: E402
import search as SR  # noqa: E402
import vs as VS  # noqa: E402

BY = DB.BY
SIDE_MAX = 7


def swapped(main, cin, cout, k):
    new = list(main)
    for _ in range(k):
        new.remove(cout)
        new.append(cin)
    return new


def _fast(args):
    ids, legs, rids, rlegs, n, seed, tag = args
    w, _ = X.play(ids, legs, rids, rlegs, N=n, seed=seed)
    return tag, w[0] / max(1, w[0] + w[1])


def candidates(main, legs, ks=(2, 3), exclude_in=(), exclude_out=()):
    """Todos los cambios (carta que entra, carta que sale, copias) que dejan el mazo legal."""
    cnt = Counter(main)
    out = []
    for cin in SR.allowed(legs):
        if cin in exclude_in:
            continue
        room = 3 - cnt.get(cin, 0)
        for cout in cnt:
            if cout == cin or cout in exclude_out:
                continue
            for k in ks:
                if k <= room and k <= cnt[cout]:
                    out.append((cin, cout, k))
    return out


def combine(main, ranked):
    """Combinaciones voraces de los cambios que mejoran (sin pisarse, hasta 7 cartas de sideboard). Devuelve [(lista de cambios, mazo)]."""
    cnt = Counter(main)
    used_out, used_in, side, picked, combos = Counter(), set(), 0, [], []
    for cin, cout, k, delta in ranked:
        if delta <= 0 or cin in used_in or side + k > SIDE_MAX or used_out[cout] + k > cnt[cout]:
            continue
        used_in.add(cin)
        used_out[cout] += k
        side += k
        picked.append((cin, cout, k))
        deck = list(main)
        for c, o, n in picked:
            deck = swapped(deck, c, o, n)
        combos.append((list(picked), deck))
    return combos


def label(cin, cout, k):
    return f"+{k} {BY[cin]['name']} / -{k} {BY[cout]['name']}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('deck')
    ap.add_argument('--vs', default='red_aggro', help='rival del meta (nombre del fichero de meta/, sin .json) o ruta a un mazo JSON')
    ap.add_argument('--top', type=int, default=12, help='cuántas cartas pasan a la medición con la IA fuerte')
    ap.add_argument('--fast-games', type=int, default=150)
    ap.add_argument('--games', type=int, default=150, help='partidas con la IA fuerte por cambio')
    ap.add_argument('--final-games', type=int, default=400, help='partidas con la IA fuerte por combinación final (0 = solo las fases 1 y 2)')
    ap.add_argument('--procs', type=int, default=2)
    ap.add_argument('--seed', type=int, default=9100)
    ap.add_argument('--ks', type=int, nargs='+', default=[2, 3], help='cuántas copias se cambian a la vez (por defecto 2 y 3)')
    ap.add_argument('--budget', type=int, default=7, help='cartas de sideboard que aún se pueden gastar (7 menos las ya cambiadas en una ronda anterior)')
    ap.add_argument('--exclude-in', nargs='+', default=[], help='cartas que NO pueden entrar (p. ej. las que salieron en una ronda anterior)')
    ap.add_argument('--exclude-out', nargs='+', default=[], help='cartas que NO pueden salir (p. ej. las que entraron en una ronda anterior)')
    a = ap.parse_args()
    t0 = time.time()
    log = lambda *x: print(*x, f"[{time.time() - t0:.0f}s]", flush=True)
    d = VS.load(a.deck)
    legs, main_ids = d['legs'], d['deck']
    rival = VS.meta([a.vs])[0]
    cands = candidates(main_ids, legs, tuple(k for k in a.ks if k <= a.budget), a.exclude_in, a.exclude_out)

    log(f"1) Criba rápida: {len(cands)} cambios contra {rival['name']} ({a.fast_games} partidas cada uno)...")
    jobs = [(main_ids, legs, rival['deck'], rival['legs'], a.fast_games, 77, None)] + [
        (swapped(main_ids, cin, cout, k), legs, rival['deck'], rival['legs'], a.fast_games, 77, (cin, cout, k)) for cin, cout, k in cands]
    with Pool(a.procs) as pool:
        res = list(pool.imap_unordered(_fast, jobs, chunksize=8))
    base_fast = next(w for tag, w in res if tag is None)
    best = {}
    for tag, w in res:
        if tag is not None and (tag[0] not in best or w > best[tag[0]][1]):
            best[tag[0]] = (tag, w)
    top = sorted(best.values(), key=lambda t: -t[1])[:a.top]
    log(f"   sin cambios (IA rápida) {base_fast:.1%}; mejores cambios:")
    for tag, w in top:
        print(f"   {w - base_fast:+.1%}  {label(*tag)}")

    log(f"2) IA FUERTE: mazo sin cambios y los {len(top)} cambios, {a.games} partidas cada uno (error típico ≈ ±{50 / math.sqrt(a.games):.1f})...")
    decks = [dict(name='sin cambios', deck=main_ids, legs=legs)] + [
        dict(name=label(*tag), deck=swapped(main_ids, *tag[:2], tag[2]), legs=legs) for tag, _ in top]
    wins = VS.evaluate(decks, [rival], a.games, a.procs, True, a.seed)
    p = [w[0][0] / max(1, w[0][1]) for w in wins]
    ranked = sorted(((tag[0], tag[1], tag[2], p[i + 1] - p[0]) for i, (tag, _) in enumerate(top)), key=lambda t: -t[3])
    log(f"   sin cambios {p[0]:.1%}:")
    for cin, cout, k, delta in ranked:
        print(f"   {delta:+.1%}  {label(cin, cout, k)}")

    tag = Path(a.vs).stem
    json.dump(dict(rival=tag, deck=a.deck, base=p[0], games=a.games, ranked=[dict(into=c, out=o, n=k, delta=dl) for c, o, k, dl in ranked]),
              open(HERE / 'out' / f'side_{tag}_ranked.json', 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    if a.final_games == 0:
        log('fin (solo fases 1 y 2)')
        return 0
    combos = combine(main_ids, ranked)
    if not combos:
        log('3) Ningún cambio mejora con la IA fuerte: no hay sideboard que proponer contra este rival.')
        return 0
    chosen = [combos[i] for i in sorted({0, len(combos) // 2, len(combos) - 1})]
    log(f"3) Combinaciones ({len(chosen)}), IA fuerte, {a.final_games} partidas cada una y el mazo sin cambios...")
    decks = [dict(name='sin cambios', deck=main_ids, legs=legs)] + [
        dict(name=' · '.join(label(*c) for c in picked), deck=deck, legs=legs) for picked, deck in chosen]
    wins = VS.evaluate(decks, [rival], a.final_games, a.procs, True, a.seed + 1)
    p = [w[0][0] / max(1, w[0][1]) for w in wins]
    log(f"   error típico ≈ ±{50 / math.sqrt(a.final_games):.1f} puntos")
    print(f"   {p[0]:.1%}  mazo sin cambios")
    for (picked, _), x in zip(chosen, p[1:]):
        print(f"   {x:.1%} ({x - p[0]:+.1%})  " + ' · '.join(label(*c) for c in picked))
    out = HERE / 'out' / f"side_{tag}.json"
    json.dump(dict(rival=tag, deck=a.deck, base=p[0], final_games=a.final_games,
                   combos=[dict(swaps=[dict(into=c, out=o, n=n) for c, o, n in picked], win=x) for (picked, _), x in zip(chosen, p[1:])]),
              open(out, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    log(f"fin -> {out}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
