import math, random
from collections import Counter, defaultdict
from net_data import RAW_NET

from cardsdb import RAW
BY = {c['id']: c for c in RAW}


def parse_feats(s):
    if s.strip() in ('-', ''):
        return {}
    out = {}
    for t in s.split(','):
        k, w = t.split(':')
        out[k] = float(w)
    return out


def unit_base(c):
    p = c['power'] or 0
    co = c['cost'] or 0
    if p == 0:
        return 0.0
    v = 1.5 + 0.9 * p - 0.55 * co
    if co >= 7:
        v -= (co - 6) * 1.0
    return v


NODE = {}
for line in RAW_NET.strip().split('\n'):
    if line.startswith('#') or not line.strip():
        continue
    cid, val, give, want, ctr, weak = [x.strip() for x in line.split('|')]
    c = BY[cid]
    t = c['type']
    v = float(val) + (unit_base(c) if t == 'Unit' else 0)
    g = parse_feats(give)
    w = parse_feats(want)
    k = parse_feats(ctr)
    tags = set()
    if weak not in ('-', ''):
        tags.update(weak.split(','))
    # etiquetas / suministros automáticos
    if t == 'Unit':
        p = c['power'] or 0
        co = c['cost'] or 0
        if 8 <= p <= 9:
            g['P8'] = g.get('P8', 0) + 1
        if co <= 5 and p >= 5:
            g['BODY'] = g.get('BODY', 0) + 1
        if 1 <= p <= 5:
            tags.add('LOWP')
        if p >= 3 and cid not in ('corpo_security', 'misty_olszewski_mender_of_broken_spirits'):
            tags.add('ATKR')
        if '{Blocker}' in (c['rules'] or ''):
            tags.add('BLKD')
        if '{Adrenaline}' in (c['rules'] or '') and 'has {Adrenaline}' not in (c['rules'] or ''):
            tags.add('GSD')
        if p >= 8:
            tags.add('BIG')
    if t == 'Legend':
        if 'GS' in g:
            tags.add('GSD')
    if c['color'] == 'Blue' and t in ('Unit', 'Gear'):
        g['BLUE'] = g.get('BLUE', 0) + 1
    NODE[cid] = dict(id=cid, name=c['displayName'], type=t, color=c['color'], cost=c['cost'] or 0, ram=c['ram'] or 0,
                     power=c['power'] or 0, v=v, give=g, want=w, ctr=k, tags=tags, legal=c['legality'] == 'legal')

# cartas sin anotar -> valores por defecto (no debería haber ninguna)
for cid, c in BY.items():
    if cid not in NODE and c['legality'] == 'legal':
        NODE[cid] = dict(id=cid, name=c['displayName'], type=c['type'], color=c['color'], cost=c['cost'] or 0, ram=c['ram'] or 0,
                         power=c['power'] or 0, v=unit_base(c) if c['type'] == 'Unit' else 2.0, give={}, want={}, ctr={}, tags=set(), legal=True)

LEGENDS = [i for i, n in NODE.items() if n['type'] == 'Legend' and n['legal']]
NONLEG = [i for i, n in NODE.items() if n['type'] != 'Legend' and n['legal']]

# importancia de cada característica (calibrable)
LAMBDA = defaultdict(lambda: 1.0, MIN=1.0, PAIR=1.0, LOW=1.0, HIGH=0.8, G8=0.7, PROG=0.5, BD=0.7, GEAR=0.7, BLK=0.5, SPENT=1.0,
                     FUP=0.8, CALL=0.5, GS=0.5, ADR=0.7, P8=0.6, POW=0.8, BODY=0.5, TRASHP=0.7, TRASHU=0.8, QMANA=0.5, EVEN=0.6, ODD=0.6, BLUE=0.8)
K_SAT = 1.4   # cuánto suministro hace falta por cada punto de necesidad


def supplies(legs, deck):
    S = defaultdict(float)
    for cid, n in deck.items():
        for f, w in NODE[cid]['give'].items():
            S[f] += w * n
    for l in legs:
        for f, w in NODE[l]['give'].items():
            S[f] += w * 1.2
    return S


def card_value(cid, S, legs=None, gs_rank=0):
    n = NODE[cid]
    v = n['v']
    if n['want']:
        tot = sum(n['want'].values())
        if tot > 0:
            sat = 0.0
            for f, w in n['want'].items():
                if w <= 0:
                    continue
                own = S.get(f, 0.0)
                # una carta no se cuenta a sí misma como suministro
                own -= n['give'].get(f, 0.0)
                sat += w * min(1.0, max(0.0, own) / (K_SAT * w * 1.5))
            sat /= tot
            v = v * (0.40 + 0.60 * sat)
    return v


def cost_factor(n):
    c = n['cost']
    if n['type'] == 'Legend':
        return 1.0
    return 1.0 if c <= 5 else (0.9 if c == 6 else 0.8 if c == 7 else 0.7)


def score_deck(legs, deck, detail=False):
    S = supplies(legs, deck)
    total = 0.0
    parts = {}
    # Legends (el tercer Go Solo vale menos)
    gs_seen = 0
    legv = 0.0
    for l in sorted(legs, key=lambda x: -NODE[x]['v']):
        v = card_value(l, S) * 0.95
        if 'GS' in NODE[l]['give']:
            gs_seen += 1
            if gs_seen >= 3:
                v *= 0.55
        legv += v
    parts['legends'] = legv
    cardv = 0.0
    ncost6 = 0
    nonunits = 0
    for cid, n in deck.items():
        nd = NODE[cid]
        val = card_value(cid, S) * cost_factor(nd)
        cardv += n * val
        if nd['cost'] >= 6:
            ncost6 += n
        if nd['type'] != 'Unit':
            nonunits += n
    parts['cards'] = cardv / 4.0   # escala comparable a Legends
    # economía: cartas vendibles
    econ = -0.35 * max(0, 13 - nonunits) ** 2 - 0.20 * max(0, nonunits - 21) ** 2
    parts['economia'] = econ / 4.0
    parts['curva'] = -0.6 * max(0, ncost6 - 4) / 4.0
    # bonus de cluster: lo que se conecta de verdad
    syn = 0.0
    D = defaultdict(float)
    for cid, n in deck.items():
        for f, w in NODE[cid]['want'].items():
            D[f] += w * n
    for l in legs:
        for f, w in NODE[l]['want'].items():
            D[f] += w * 1.2
    for f in D:
        if f in S:
            syn += LAMBDA[f] * math.sqrt(min(S[f], D[f]))
    parts['cluster'] = syn * 0.6
    total = sum(parts.values())
    return (total, parts) if detail else total


def ram_of(legs):
    ram = defaultdict(int)
    for l in legs:
        ram[NODE[l]['color']] += NODE[l]['ram']
    return ram


def pool_for(legs):
    ram = ram_of(legs)
    return [i for i in NONLEG if NODE[i]['ram'] <= ram.get(NODE[i]['color'], 0)]


def init_deck(legs, rng):
    pool = pool_for(legs)
    S0 = supplies(legs, {})
    ranked = sorted(pool, key=lambda i: -NODE[i]['v'] * (1.0 if NODE[i]['cost'] <= 6 else 0.7))
    deck = Counter()
    n = 0
    for i in ranked:
        k = 3 if NODE[i]['v'] > 4 else 2
        add = min(k, 40 - n)
        deck[i] += add
        n += add
        if n >= 40:
            break
    return deck


def optimize(legs, iters=400, seed=0, start=None):
    rng = random.Random(seed)
    pool = pool_for(legs)
    deck = Counter(start) if start else init_deck(legs, rng)
    best = score_deck(legs, deck)
    cur = list(deck.elements())
    for _ in range(iters):
        new = Counter(deck)
        r = rng.choice(list(new.elements()))
        new[r] -= 1
        if new[r] == 0:
            del new[r]
        a = rng.choice(pool)
        if new[a] >= 3:
            continue
        new[a] += 1
        s = score_deck(legs, new)
        if s > best + 1e-9:
            best, deck = s, new
    return deck, best


def edges(pool_ids, extra_legs=()):
    """aristas productor -> consumidor sobre un conjunto de nodos"""
    E = []
    nodes = list(pool_ids) + list(extra_legs)
    for a in nodes:
        for f, g in NODE[a]['give'].items():
            for b in nodes:
                if a == b:
                    continue
                w = NODE[b]['want'].get(f, 0)
                if w > 0:
                    E.append((a, b, f, g * w * LAMBDA[f]))
    return E


if __name__ == '__main__':
    print('nodos', len(NODE), 'legends', len(LEGENDS), 'no-legend', len(NONLEG))
    miss = [i for i, c in BY.items() if c['legality'] == 'legal' and i not in NODE]
    print('sin anotar', miss)
