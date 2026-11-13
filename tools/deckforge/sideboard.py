"""Sideboard: qué cambiar contra cada rival, cómo montar un sideboard de 7 cartas y partidas al mejor de tres."""
from collections import Counter
from multiprocessing import Pool

import cardsdb as DB
import engine2 as X
import search as SR

BY = DB.BY
MIN_GAIN = 0.02      # mejora mínima (2 puntos) para aceptar un cambio


def wr(ids, legs, rival, games, seed, deep=None):
    w, _ = X.play(ids, legs, rival['deck'], rival['legs'], N=games, seed=seed, deep=deep)
    return w[0] / max(1, w[0] + w[1])


def _swap(main, cin, n, cout):
    new = list(main)
    for _ in range(n):
        new.remove(cout)
        new.append(cin)
    return new


def _eval_swap(args):
    main, legs, rival, games, seed, cin, n, cout = args
    return cin, n, cout, wr(_swap(main, cin, n, cout), legs, rival, games, seed)


def plan_vs(main, legs, side, rival, games=100, seed=41, pool=None):
    """Búsqueda voraz: mete cada carta del sideboard (todas sus copias) por la carta del mazo que más convenga quitar.
    Devuelve (mazo tras el sideboard, [(entra, n, sale, ganancia)], % antes, % después), todo sin previsión."""
    cur = list(main)
    left = Counter(side)
    base = wr(cur, legs, rival, games, seed)
    start = base
    moves = []
    for _ in range(4):
        cnt = Counter(cur)
        jobs = []
        for cin, n_side in left.items():
            for cout, n_main in cnt.items():
                n = min(n_side, n_main, 3 - cnt.get(cin, 0))
                if n > 0 and cout != cin:
                    jobs.append((cur, legs, rival, games, seed, cin, n, cout))
        if not jobs:
            break
        res = pool.map(_eval_swap, jobs, chunksize=4) if pool is not None else [_eval_swap(j) for j in jobs]
        cin, n, cout, best = max(res, key=lambda r: r[3])
        if best < base + MIN_GAIN:
            break
        cur = _swap(cur, cin, n, cout)
        left[cin] -= n
        if left[cin] <= 0:
            del left[cin]
        moves.append((cin, n, cout, best - base))
        base = best
    return cur, moves, start, base


def _eval_in(args):
    main, legs, rival, games, seed, cin, outs = args
    new = list(main)
    for o in outs:
        new.remove(o)
        new.append(cin)
    return cin, wr(new, legs, rival, games, seed)


def build_side(main, legs, field, games=80, seed=43, procs=2):
    """Propone un sideboard de 7 cartas: para cada rival, qué cartas del pool legal mejoran más el cruce
    cuando sustituyen a las que peor rinden en él."""
    allowed = SR.allowed(legs)
    cnt = Counter(main)
    gains = {}
    per_rival = []
    with Pool(procs) as pool:
        for rival in field:
            base = wr(main, legs, rival, games, seed)
            # las 2 cartas del mazo que menos se echan de menos contra este rival
            drop = pool.map(_eval_in, [(main, legs, rival, games, seed, 'psycho_squad' if c != 'psycho_squad' else 'emergency_atlus', [c] * min(2, n))
                                       for c, n in cnt.items()], chunksize=2)
            order = sorted(zip(cnt, drop), key=lambda t: -t[1][1])
            outs = []
            for c, _ in order:
                for _k in range(min(2, cnt[c])):
                    if len(outs) < 2:
                        outs.append(c)
            cands = [c for c in allowed if cnt.get(c, 0) + 2 <= 3]
            res = pool.map(_eval_in, [(main, legs, rival, games, seed, c, outs) for c in cands], chunksize=4)
            top = sorted(res, key=lambda r: -r[1])[:4]
            per_rival.append((rival['name'], base, outs, [(c, w - base) for c, w in top]))
            need = 1.0 if base < 0.55 else (0.5 if base < 0.65 else 0.0)
            for c, w in top:
                if need and (w - base) * need >= MIN_GAIN:
                    gains[c] = max(gains.get(c, 0.0), (w - base) * need) + 0.3 * min(gains.get(c, 0.0), (w - base) * need)
    side = Counter()
    for c, _ in sorted(gains.items(), key=lambda t: -t[1]):
        n = min(2, 7 - sum(side.values()), 3 - cnt.get(c, 0))
        if n > 0:
            side[c] = n
    return dict(side), per_rival


def bo3(A, B, matches, seed, deep=None):
    """A y B = dict(legs, main, post) donde post es el mazo tras el sideboard contra el otro.
    Partida 1 con los mazos principales; 2 y 3 con sideboard; empieza quien perdió la anterior."""
    wins = 0
    g1 = 0
    for m in range(matches):
        a_first = m % 2 == 0
        sa = sb = 0
        for k in range(3):
            da, db = (A['main'], B['main']) if k == 0 else (A['post'], B['post'])
            s = seed * 7919 + m * 3 + k
            if a_first:
                g = X.Game(da, A['legs'], db, B['legs'], s, deep=deep)
                r = g.run()
                a_won = r == 0
            else:
                g = X.Game(db, B['legs'], da, A['legs'], s, deep=None if deep is None else (deep[1], deep[0]))
                r = g.run()
                a_won = r == 1
            if r < 0:
                a_won = g.rng.random() < 0.5
            sa += a_won
            sb += not a_won
            if k == 0:
                g1 += a_won
            a_first = not a_won
            if sa == 2 or sb == 2:
                break
        wins += sa == 2
    return wins / matches, g1 / matches
