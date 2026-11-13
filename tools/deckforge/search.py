"""Búsqueda del mejor mazo que permiten las cartas: criba de TODAS las ternas de Legends con partidas reales
contra el campo, y afinado carta a carta (búsqueda local) de las mejores."""
import itertools
import os
import random
from collections import Counter, defaultdict
from multiprocessing import Pool

import cardsdb as DB
import engine2 as X
import net_model as NM

BY = DB.BY
MIN_UNITS, MAX_UNITS = 12, 28


def unit_bounds():
    """Rango de Unidades que admite la búsqueda local: el de siempre, o el de la variable DECKFORGE_UNITS="12,16"."""
    v = os.environ.get('DECKFORGE_UNITS')
    return tuple(int(x) for x in v.split(',')) if v else (MIN_UNITS, MAX_UNITS)


def allowed(legs):
    ram = defaultdict(int)
    for l in legs:
        ram[BY[l]['color']] += BY[l]['ram'] or 0
    return [i for i, c in BY.items() if c['type'] != 'Legend' and c['legality'] == 'legal' and i not in DB.UNAVAILABLE
            and (c['ram'] or 0) <= ram.get(c['color'], 0)]


def all_trios():
    legs = [i for i, c in BY.items() if c['type'] == 'Legend' and c['legality'] == 'legal' and i not in DB.UNAVAILABLE]
    return [t for t in itertools.combinations(sorted(legs), 3) if len({BY[x]['name'] for x in t}) == 3]


def start_deck(legs):
    """Mazo de partida razonable: las mejores cartas del pool según la red, 22 Unidades + 18 vendibles."""
    pool = sorted(allowed(legs), key=lambda i: -NM.NODE[i]['v'] if i in NM.NODE else 0)
    units = [i for i in pool if BY[i]['type'] == 'Unit' and (BY[i]['cost'] or 0) <= 7]
    other = [i for i in pool if BY[i]['type'] != 'Unit']
    deck = []
    for src, n in ((units, 22), (other, 18)):
        k = 0
        for i in src:
            for _ in range(3):
                if k < n:
                    deck.append(i)
                    k += 1
    rest = [i for i in pool if deck.count(i) < 3]
    while len(deck) < 40 and rest:
        deck.append(rest.pop(0))
    return deck


def fit(ids, legs, field, games, seed):
    tot = 0.0
    for f in field:
        w, _ = X.play(ids, legs, f['deck'], f['legs'], N=games, seed=seed)
        tot += w[0] / max(1, w[0] + w[1])
    return tot / len(field)


def _screen_one(args):
    legs, field, games, seed = args
    deck = start_deck(legs)
    if len(deck) < 40:
        return legs, -1.0, deck
    return legs, fit(deck, legs, field, games, seed), deck


def screen(trios, field, games, seed, procs):
    jobs = [(list(t), field, games, seed) for t in trios]
    with Pool(procs) as p:
        res = p.map(_screen_one, jobs, chunksize=8)
    return sorted(res, key=lambda r: -r[1])


def climb(args):
    """Búsqueda local: cambia una carta cada vez y se queda el cambio si gana más partidas (mismas semillas)."""
    legs, field, start, iters, games, seed = args
    rng = random.Random(seed)
    lo, hi = unit_bounds()
    pool = allowed(legs)
    deck = list(start)
    s = 1000 + seed
    best = fit(deck, legs, field, games, s)
    for it in range(1, iters + 1):
        if it % 30 == 0:                     # semillas nuevas: evita casarse con una racha de suerte
            s += 1
            best = fit(deck, legs, field, games, s)
        cnt = Counter(deck)
        new = list(deck)
        out = new.pop(rng.randrange(len(new)))
        cand = [c for c in pool if c != out and cnt[c] < 3]
        if not cand:
            continue
        new.append(rng.choice(cand))
        units = sum(1 for i in new if BY[i]['type'] == 'Unit')
        if not lo <= units <= hi:
            continue
        f = fit(new, legs, field, games, s)
        if f > best + 0.004:
            best, deck = f, new
    return deck, best


def optimize(legs, field, start, iters, games, restarts, procs):
    tasks = [(legs, field, start, iters, games, 100 + i) for i in range(restarts)]
    if procs > 1 and restarts > 1:
        with Pool(min(procs, restarts)) as p:
            return p.map(climb, tasks)
    return [climb(t) for t in tasks]
