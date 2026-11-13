"""Pone NÚMEROS a las uniones de la red: cuánto vale cada carta sola y cuánto sube cuando el mazo le da lo que pide.

Método: miles de mazos al azar (muchos sembrados con un paquete para que haya de todo), cada uno juega contra el meta y
contra otro mazo al azar; después una regresión cuya ESTRUCTURA la pone la red (qué carta cobra con qué concepto, quién lo
habilita) y cuyos PESOS salen de las partidas. Unidad de todos los coeficientes: puntos de % de victoria por juego completo
de 3 copias.

Necesita numpy solo para ajustar (`forge.py learn`); usar el modelo ya ajustado no necesita nada.
"""
import json
import random
from collections import Counter, defaultdict
from multiprocessing import Pool
from pathlib import Path

import cardgraph as CG
import cardsdb as DB
import engine2 as X

HERE = Path(__file__).resolve().parent
LEARNED = HERE / 'data' / 'learned.json'
BY = DB.BY
S0 = 12.0            # aporte con el que un concepto se considera plenamente cubierto (≈ dos juegos de habilitadores de peso 2)
SHAPE = ('units', 'units2', 'cost', 'cost2', 'heavy', 'early', 'sell')


def trios():
    import search as SR
    return SR.all_trios()


class Featurizer:
    """Convierte (Legends, mazo) en variables: cartas, Legends, carta×cobertura de lo que pide, carta×demanda de lo que da, forma del mazo."""

    def __init__(s, G=None):
        s.G = G or CG.Graph()
        nodes = s.G.nodes
        s.cards = sorted(i for i, n in nodes.items() if n['type'] != 'Legend')
        s.legs = sorted(i for i, n in nodes.items() if n['type'] == 'Legend')
        s.names = []
        s.ix = {}

        def reg(key):
            s.ix[key] = len(s.names)
            s.names.append(key)
        for i in s.cards:
            reg(('card', i))
        for l in s.legs:
            reg(('leg', l))
        s.pay, s.ena = defaultdict(list), defaultdict(list)
        for i in s.cards + s.legs:
            n = nodes[i]
            for c, (w, _) in n['need'].items():
                if w >= 2 and not c.startswith('vs_'):
                    reg(('pay', i, c))
                    s.pay[i].append(c)
            for c, (w, _) in n['give'].items():
                if c not in ('PROG', 'TRASHP', 'TRASHU', 'BLUE', 'CORPO_GANGER', 'ROCKER', 'CARDS', 'EDDIES', 'BLOCK') and not c.startswith('vs_') and s.G.needers[c]:
                    reg(('ena', i, c))
                    s.ena[i].append(c)
        for k in SHAPE:
            reg(('shape', k))

    def flows(s, legs, cnt):
        nodes = s.G.nodes
        sup, dem = defaultdict(float), defaultdict(float)
        for i, k in cnt.items():
            n = nodes[i]
            for c, (w, _) in n['give'].items():
                sup[c] += w * k
            for c, (w, _) in n['need'].items():
                if w >= 2:
                    dem[c] += w * k
        for l in legs:
            n = nodes[l]
            for c, (w, _) in n['give'].items():
                sup[c] += w * 2
            for c, (w, _) in n['need'].items():
                if w >= 2:
                    dem[c] += w * 3
        return sup, dem

    def vec(s, legs, cnt):
        """Variables no nulas: {índice: valor}."""
        nodes = s.G.nodes
        sup, dem = s.flows(legs, cnt)
        v = {}
        tot = max(1, sum(cnt.values()))
        for i, k in cnt.items():
            x = k / 3.0
            v[s.ix[('card', i)]] = x
            n = nodes[i]
            for c in s.pay[i]:
                own = n['give'].get(c, (0, 0))[0] * k
                v[s.ix[('pay', i, c)]] = x * min(1.0, max(0.0, sup[c] - own) / S0)
            for c in s.ena[i]:
                own = n['need'].get(c, (0, 0))[0] * k if n['need'].get(c, (0, 0))[0] >= 2 else 0
                v[s.ix[('ena', i, c)]] = x * min(1.0, max(0.0, dem[c] - own) / S0)
        for l in legs:
            v[s.ix[('leg', l)]] = 1.0
            for c in s.pay[l]:
                v[s.ix[('pay', l, c)]] = min(1.0, sup[c] / S0)
            for c in s.ena[l]:
                v[s.ix[('ena', l, c)]] = min(1.0, dem[c] / S0)
        units = sum(k for i, k in cnt.items() if nodes[i]['type'] == 'Unit') / tot
        cost = sum(nodes[i]['cost'] * k for i, k in cnt.items()) / tot
        sh = dict(units=units - 0.5, units2=(units - 0.5) ** 2, cost=(cost - 3.5) / 2, cost2=((cost - 3.5) / 2) ** 2,
                  heavy=sum(k for i, k in cnt.items() if nodes[i]['cost'] >= 6) / tot,
                  early=sum(k for i, k in cnt.items() if nodes[i]['type'] == 'Unit' and nodes[i]['cost'] <= 3 and nodes[i]['power'] >= 2) / tot,
                  sell=sum(k for i, k in cnt.items() if nodes[i]['type'] != 'Unit') / tot - 0.45)
        for k, x in sh.items():
            v[s.ix[('shape', k)]] = x
        return v


# ----------------------------------------------------------------------------- mazos de muestra
def random_deck(F, rng, all_trios):
    """Mazo legal al azar. La mitad se siembra con un paquete (cartas que cobran + habilitadores) para que haya ejemplos de todo."""
    G = F.G
    legs = list(rng.choice(all_trios))
    pool = G.legal_for(legs)
    cnt = Counter()
    if rng.random() < 0.6:
        cands = [c for c in CG.CONCEPTS if not c.startswith('vs_') and any(c in G.nodes[i]['need'] for i in pool + legs)]
        for c in rng.sample(cands, min(len(cands), rng.choice((1, 1, 2)))):
            pay = [i for i in pool if c in G.nodes[i]['need'] and G.nodes[i]['need'][c][0] >= 2]
            ena = [i for i in pool if c in G.nodes[i]['give']]
            for i in rng.sample(pay, min(len(pay), rng.randint(1, 3))) + rng.sample(ena, min(len(ena), rng.randint(0, 4))):
                cnt[i] = rng.randint(2, 3)
    units = [i for i in pool if G.nodes[i]['type'] == 'Unit']
    other = [i for i in pool if G.nodes[i]['type'] != 'Unit']
    target_u = rng.randint(12, 26)
    w = lambda i: 1.0 if G.nodes[i]['cost'] <= 5 else 0.45
    guard = 0
    while sum(cnt.values()) < 40 and guard < 600:
        guard += 1
        nu = sum(k for i, k in cnt.items() if G.nodes[i]['type'] == 'Unit')
        src = units if (nu < target_u and units) else (other or units)
        i = rng.choices(src, weights=[w(x) for x in src])[0]
        if cnt[i] < 3:
            cnt[i] += min(rng.choice((1, 2, 3, 3)), 3 - cnt[i], 40 - sum(cnt.values()))
    while sum(cnt.values()) > 40:
        i = rng.choice(list(cnt))
        cnt[i] -= 1
        cnt += Counter()
    return legs, cnt


def _play_job(args):
    decks, meta, g_meta, g_pair, seed = args
    out = []
    for k in range(0, len(decks), 2):
        (la, ca), (lb, cb) = decks[k], decks[k + 1]
        a, b = list(ca.elements()), list(cb.elements())
        w, _ = X.play(a, la, b, lb, N=g_pair, seed=seed + k)
        row = dict(pair=(w[0], w[1]), meta=[])
        for d, l in ((a, la), (b, lb)):
            res = []
            for mi, m in enumerate(meta):
                wm, _ = X.play(d, l, m['deck'], m['legs'], N=g_meta, seed=seed + k + mi)
                res.append((wm[0], wm[1]))
            row['meta'].append(res)
        out.append(row)
    return out


def sample(F, n_decks, meta, g_meta=6, g_pair=20, seed=1, procs=3, progress=None):
    rng = random.Random(seed)
    T = trios()
    decks = [random_deck(F, rng, T) for _ in range(n_decks - n_decks % 2)]
    chunk = 40
    jobs = [(decks[i:i + chunk], meta, g_meta, g_pair, seed * 7919 + i) for i in range(0, len(decks), chunk)]
    rows = []
    with Pool(procs) as pool:
        for k, r in enumerate(pool.imap(_play_job, jobs)):
            rows += r
            if progress and k % 10 == 0:
                progress(len(rows) * 2, len(decks))
    return decks, rows


# ----------------------------------------------------------------------------- ajuste
def fit(F, decks, rows, n_meta, ridge=6.0, block=600):
    """Mínimos cuadrados ponderados con regularización. Acumula las ecuaciones normales por bloques para gastar poca memoria."""
    import numpy as np
    P = len(F.names)
    D = P + n_meta
    A = np.zeros((D, D), dtype=np.float64)
    bvec = np.zeros(D, dtype=np.float64)
    used = np.zeros(P, dtype=np.int64)
    syy = sw = swy = 0.0
    nobs = 0
    for b0 in range(0, len(rows), block):
        chunk = rows[b0:b0 + block]
        Xm = np.zeros((len(chunk) * (1 + 2 * n_meta), D), dtype=np.float32)
        y = np.zeros(Xm.shape[0], dtype=np.float32)
        wt = np.zeros(Xm.shape[0], dtype=np.float32)
        r = 0
        for k, row in enumerate(chunk):
            (la, ca), (lb, cb) = decks[2 * (b0 + k)], decks[2 * (b0 + k) + 1]
            va, vb = F.vec(la, ca), F.vec(lb, cb)
            wa, wb = row['pair']
            if wa + wb:
                for j, x in va.items():
                    Xm[r, j] += x
                for j, x in vb.items():
                    Xm[r, j] -= x
                y[r] = wa / (wa + wb) - 0.5
                wt[r] = wa + wb
            r += 1
            for v, res in ((va, row['meta'][0]), (vb, row['meta'][1])):
                for mi, (w1, w0) in enumerate(res):
                    if w1 + w0:
                        for j, x in v.items():
                            Xm[r, j] = x
                        Xm[r, P + mi] = 1.0
                        y[r] = w1 / (w1 + w0) - 0.5
                        wt[r] = w1 + w0
                    r += 1
        XW = Xm * wt[:, None]
        A += (XW.T @ Xm).astype(np.float64)
        bvec += (XW.T @ y).astype(np.float64)
        used += (np.abs(Xm[:, :P]) > 0).sum(axis=0)
        syy += float((wt * y * y).sum())
        sw += float(wt.sum())
        swy += float((wt * y).sum())
        nobs += int((wt > 0).sum())
    reg = np.full(D, ridge, dtype=np.float64)
    reg[P:] = 1e-3
    A += np.diag(reg)
    beta = np.linalg.solve(A, bvec)
    sse = syy - float(beta @ bvec)                 # suma de cuadrados residual (aprox. con regularización)
    sst = syy - swy * swy / max(1e-9, sw)
    cov = np.linalg.inv(A)
    se = np.sqrt(np.maximum(1e-12, np.diag(cov) * 0.25))    # 0,25 = varianza máxima de una partida ganada/perdida
    return beta[:P], se[:P], used, beta[P:], float(1 - sse / max(1e-9, sst))


def save(F, beta, se, used, meta_beta, r2, info):
    out = dict(info=info, r2=r2, meta=[float(x) for x in meta_beta], coef=[])
    for key, b, s_, u in zip(F.names, beta, se, used):
        out['coef'].append([list(key), round(float(b) * 100, 2), round(float(s_) * 100, 2), int(u)])
    LEARNED.parent.mkdir(exist_ok=True)
    json.dump(out, open(LEARNED, 'w', encoding='utf8'), ensure_ascii=False)


# ----------------------------------------------------------------------------- usar el modelo
class Model:
    def __init__(s, G=None):
        if not LEARNED.exists():
            raise SystemExit('Aún no hay modelo medido: lanza primero  forge.py learn')
        s.F = Featurizer(G)
        s.G = s.F.G
        d = json.load(open(LEARNED, encoding='utf8'))
        s.info = d['info']
        s.r2 = d['r2']
        s.beta = [0.0] * len(s.F.names)
        s.se = [9.9] * len(s.F.names)
        s.used = [0] * len(s.F.names)
        for key, b, se, u in d['coef']:
            j = s.F.ix.get(tuple(key))
            if j is not None:
                s.beta[j], s.se[j], s.used[j] = b, se, u

    def coef(s, *key):
        j = s.F.ix.get(key)
        return (s.beta[j], s.se[j], s.used[j]) if j is not None else (0.0, 9.9, 0)

    def predict(s, legs, cnt):
        """Puntos de % de victoria respecto a un mazo medio (solo sirve para comparar mazos entre sí)."""
        return sum(s.beta[j] * x for j, x in s.F.vec(legs, cnt).items())

    def breakdown(s, legs, cnt):
        """Por carta: (aporte total, base, {concepto: (aporte por cobrar, cobertura)}, {concepto: aporte por habilitar})."""
        v = s.F.vec(legs, cnt)
        out = {}
        for i in list(cnt) + list(legs):
            kind = 'leg' if s.G.nodes[i]['type'] == 'Legend' else 'card'
            j = s.F.ix[(kind, i)]
            base = s.beta[j] * v.get(j, 0.0)
            pay = {c: (s.beta[s.F.ix[('pay', i, c)]] * v.get(s.F.ix[('pay', i, c)], 0.0), v.get(s.F.ix[('pay', i, c)], 0.0) / max(1e-9, v.get(j, 1.0)))
                   for c in s.F.pay[i]}
            ena = {c: s.beta[s.F.ix[('ena', i, c)]] * v.get(s.F.ix[('ena', i, c)], 0.0) for c in s.F.ena[i]}
            out[i] = (base + sum(p for p, _ in pay.values()) + sum(ena.values()), base, pay, ena)
        return out

    def build(s, legs, units=(10, 26), fixed=None, sweeps=3):
        """Mazo de 40 que maximiza la predicción: subida voraz carta a carta y luego intercambios hasta que nada mejora."""
        pool = s.G.legal_for(legs)
        nodes = s.G.nodes
        cnt = Counter(fixed or {})

        def ok(c):
            nu = sum(k for i, k in c.items() if nodes[i]['type'] == 'Unit')
            return units[0] <= nu <= units[1] or sum(c.values()) < 40

        while sum(cnt.values()) < 40:
            best = None
            for i in pool:
                if cnt[i] >= 3:
                    continue
                cnt[i] += 1
                nu = sum(k for j, k in cnt.items() if nodes[j]['type'] == 'Unit')
                left = 40 - sum(cnt.values())
                feasible = nu <= units[1] and nu + left >= units[0]
                p = s.predict(legs, cnt) if feasible else None
                cnt[i] -= 1
                if cnt[i] == 0:
                    del cnt[i]
                if p is not None and (best is None or p > best[0]):
                    best = (p, i)
            if best is None:
                break
            cnt[best[1]] += 1
        cur = s.predict(legs, cnt)
        for _ in range(sweeps):
            improved = False
            for out in list(cnt):
                if fixed and out in fixed:
                    continue
                for i in pool:
                    if i == out or cnt[i] >= 3 or cnt[out] <= 0:
                        continue
                    cnt[out] -= 1
                    cnt[i] += 1
                    nu = sum(k for j, k in cnt.items() if nodes[j]['type'] == 'Unit')
                    p = s.predict(legs, cnt) if units[0] <= nu <= units[1] else -1e9
                    if p > cur + 0.05:
                        cur = p
                        improved = True
                    else:
                        cnt[out] += 1
                        cnt[i] -= 1
                    cnt += Counter()
            if not improved:
                break
        return cnt, cur
