"""Guía de juego de un mazo: cómo rinde contra cada rival, en qué situaciones va mejor o peor y qué conviene jugar o vender
en cada turno. Se mide en partidas completas, registrando cada turno propio:

  mano inicial -> (turno) qué había en mano, qué se vendió, qué se jugó, cómo quedó la mesa -> resultado.

Lo que sale son asociaciones medidas, no causas: una carta jugada pronto puede ir con más victorias porque se jugó con
la mesa ya ganada. Las diferencias se marcan solo si superan el ruido.
"""
import math
from collections import Counter, defaultdict
from multiprocessing import Pool

import ai2
import ai2_turn
import cardsdb as DB
import engine2 as X
from explain import _se

BY = DB.BY
TURNS = 6                 # turnos propios que se registran
MIN_N = 30                # muestras mínimas por grupo para comparar
_installed = False


# ----------------------------------------------------------------------------- registro de cada turno
def _power(g, p):
    return sum(g.power(u) for u in p.field)


def _install():
    """Envuelve el turno y la venta de la IA para anotar lo que hace el jugador observado (g.pb_pi) en la partida real."""
    global _installed
    if _installed:
        return
    orig_main, orig_sell = ai2.main, ai2_turn._sell

    def watched(g, me):
        return getattr(g, 'pb', None) is not None and not g.rollout and me.pi == g.pb_pi

    def sell(g, me):
        if not watched(g, me):
            return orig_sell(g, me)
        before = Counter(c['id'] for c in me.hand)
        orig_sell(g, me)
        gone = before - Counter(c['id'] for c in me.hand)
        g.pb['sold'] = next(iter(gone), None)

    def main(g, me, op):
        if not watched(g, me) or len(g.pb['turns']) >= TURNS:
            return orig_main(g, me, op)
        pl0, ev0 = Counter(me.played), Counter(g.st[me.pi])
        rec = dict(t=(g.turn + 1) // 2, hand=[c['id'] for c in me.hand], E=me.E, pw=_power(g, me), opw=_power(g, op),
                   gigs=len(me.gigs), ogigs=len(op.gigs))
        g.pb['sold'] = None
        orig_main(g, me, op)
        rec.update(sold=g.pb['sold'], played=list((Counter(me.played) - pl0).elements()),
                   calls=[k[1] for k in (Counter(g.st[me.pi]) - ev0) if k[0] == 'call'],
                   pw2=_power(g, me), opw2=_power(g, op), gigs2=len(me.gigs), ogigs2=len(op.gigs), hand2=len(me.hand), E2=me.E)
        g.pb['turns'].append(rec)

    ai2.main, ai2_turn._sell = main, sell
    _installed = True


def _job(args):
    ids, legs, rival, n, seed = args
    _install()
    out = []
    for i in range(n):
        first = i % 2 == 0
        a, b = (ids, legs), (rival['deck'], rival['legs'])
        g = X.Game(*(a + b if first else b + a), seed * 100003 + i)
        g.pb_pi = 0 if first else 1
        g.pb = dict(turns=[], sold=None)
        hand0 = [c['id'] for c in g.p[g.pb_pi].hand]
        r = g.run()
        out.append(dict(rival=rival['name'], first=first, won=r == g.pb_pi, hand0=hand0,
                        mull=g.st[g.pb_pi]['mulligan'], turns=g.pb['turns']))
    return out


def collect(ids, legs, field, games, seed, procs):
    """Partidas del mazo contra cada rival del campo (alternando quién empieza). Devuelve la lista de partidas registradas."""
    chunk = 20     # par: así cada trozo reparte por igual quién empieza
    jobs = [(ids, legs, f, min(chunk, games - k), seed * 1000 + 17 * j + k)
            for j, f in enumerate(field) for k in range(0, games, chunk)]
    with Pool(procs) as pool:
        return [rec for part in pool.map(_job, jobs) for rec in part]


# ----------------------------------------------------------------------------- análisis
def _rate(rows):
    return sum(r['won'] for r in rows) / max(1, len(rows))


def _fmt(rows):
    n = len(rows)
    return f"{_rate(rows):4.0%} (±{1.96 * _se(_rate(rows), n):.0%}, n={n})" if n else '   -'


def _nm(i):
    return BY[i]['displayName']


def _bucket(v, cuts, labels):
    for c, lab in zip(cuts, labels):
        if v <= c:
            return lab
    return labels[-1]


def sec_rivals(recs):
    L = ['1) CONTRA CADA RIVAL (victorias; empezando tú / de segundo)']
    for name in sorted({r['rival'] for r in recs}):
        rows = [r for r in recs if r['rival'] == name]
        f, s = [r for r in rows if r['first']], [r for r in rows if not r['first']]
        L.append(f"   {_fmt(rows):28s} {name}   |  empiezas {_rate(f):.0%} · de segundo {_rate(s):.0%}")
    return L


def sec_opening(recs):
    cheap = lambda h: sum(1 for i in h if X.CARD[i]['t'] == 'U' and X.CARD[i]['cost'] <= 3)
    sell = lambda h: sum(1 for i in h if X.CARD[i]['sell'])
    L = ['2) MANO INICIAL: qué manos van mejor (todos los rivales juntos)']
    for title, fn, cuts, labels in (('cartas vendibles', sell, (1, 2, 3), ('0-1', '2', '3', '4 o más')),
                                    ('Unidades baratas (coste 3 o menos)', cheap, (0, 1, 2), ('0', '1', '2', '3 o más'))):
        for lab in labels:
            rows = [r for r in recs if _bucket(fn(r['hand0']), cuts, labels) == lab]
            L.append(f"   {title:36s} {lab:8s} {_fmt(rows)}")
    mu = [r for r in recs if r['mull']]
    L.append(f"   {'con mulligan':36s} {'':8s} {_fmt(mu)}   frente a sin mulligan {_fmt([r for r in recs if not r['mull']])}")
    return L


def sec_turns(recs):
    L = ['3) TURNO A TURNO: lo que hace el piloto (jugar / vender) y cuántas veces se queda sin poder hacerlo']
    for t in range(1, 6):
        rows = [x for r in recs for x in r['turns'] if x['t'] == t]
        if not rows:
            continue
        n = len(rows)
        sold = Counter(x['sold'] for x in rows if x['sold'])
        plays = Counter(c for x in rows for c in set(x['played']))
        idle = sum(1 for x in rows if not x['played'])
        nosell = sum(1 for x in rows if not x['sold'])
        units = sum(1 for x in rows for i in x['hand'] if X.CARD[i]['t'] == 'U') / n
        sellable = sum(1 for x in rows for i in x['hand'] if X.CARD[i]['sell']) / n
        L.append(f"   Turno {t}: mano {sum(len(x['hand']) for x in rows) / n:.1f} (Unidades {units:.1f}, vendibles {sellable:.1f}) · "
                 f"Eddies {sum(x['E'] for x in rows) / n:.1f} · sin jugar nada {idle / n:.0%} · sin vender {nosell / n:.0%}")
        L.append('      juega: ' + '; '.join(f"{_nm(c)} {k / n:.0%}" for c, k in plays.most_common(5)))
        L.append('      vende: ' + '; '.join(f"{_nm(c)} {k / n:.0%}" for c, k in sold.most_common(3)))
    return L


def _stratified(groups):
    """groups = {rival: (no_jugada, jugada)} con listas de 0/1. Diferencia de victorias dentro de cada rival, combinada.
    Devuelve (z, diferencia, victorias jugándola, n jugada, n sin jugar) o None si hay pocas muestras."""
    num = den = 0.0
    ny = nn = wy = 0
    for no, yes in groups.values():
        if len(no) < 8 or len(yes) < 8:
            continue
        py, pn = (sum(yes) + 0.5) / (len(yes) + 1), (sum(no) + 0.5) / (len(no) + 1)
        w = 1.0 / (_se(py, len(yes)) ** 2 + _se(pn, len(no)) ** 2)
        num += w * (py - pn)
        den += w
        ny, nn, wy = ny + len(yes), nn + len(no), wy + sum(yes)
    if ny < MIN_N or nn < MIN_N:
        return None
    d = num / den
    return d * math.sqrt(den), d, wy / ny, ny, nn


def sec_decisions(recs, top=6, z_min=2.4):
    """Para cada carta que había en mano al empezar un turno: ¿se ganó más cuando se jugó ese turno que cuando no?
    La comparación se hace dentro de cada rival (un rival fácil no infla ninguna carta)."""
    groups = defaultdict(lambda: defaultdict(lambda: ([], [])))
    for r in recs:
        for x in r['turns']:
            if x['t'] <= 4:
                for c in set(x['hand']):
                    groups[(x['t'], c)][r['rival']][c in x['played']].append(r['won'])
    rows = [(res, t, c) for (t, c), g in groups.items() for res in [_stratified(g)] if res]
    rows.sort(key=lambda x: -x[0][0])
    L = ['4) CUÁNDO JUGAR QUÉ: victorias cuando se juega la carta ese turno frente a cuando se queda en mano '
         '(dentro de cada rival; solo diferencias claras)']
    for (z, d, py, ny, nn), t, c in [x for x in rows if x[0][0] > z_min][:top]:
        L.append(f"   + turno {t}: JUGAR {_nm(c)} (coste {X.CARD[c]['cost']}): {d:+.0%}  ({py:.0%} jugándola, n={ny}; sin jugarla n={nn})")
    for (z, d, py, ny, nn), t, c in [x for x in reversed(rows) if x[0][0] < -z_min][:top]:
        L.append(f"   - turno {t}: mejor GUARDAR/VENDER {_nm(c)} (coste {X.CARD[c]['cost']}): {d:+.0%} si se juega  ({py:.0%} jugándola, n={ny}; sin jugarla n={nn})")
    if len(L) == 1:
        L.append('   Ninguna se separa del ruido con estas partidas (sube --games).')
    return L


def sec_sell(recs, top=5):
    """Qué carta venderse en los primeros turnos: victorias según la carta vendida."""
    by = defaultdict(list)
    for r in recs:
        for x in r['turns']:
            if x['t'] <= 3 and x['sold']:
                by[x['sold']].append(r['won'])
    base = _rate(recs)
    rows = sorted(((sum(v) / len(v) - base, c, len(v)) for c, v in by.items() if len(v) >= 3 * MIN_N), reverse=True)
    L = ['5) QUÉ VENDER en los turnos 1-3 (victorias de las partidas donde se vendió esa carta, frente a la media)']
    shown = rows if len(rows) <= 2 * top else rows[:top] + [None] + rows[-top:]
    for row in shown:
        L.append('   ...' if row is None else f"{row[0]:+.0%}  {_nm(row[1])} (n={row[2]})")
    return L


def _terciles(vals):
    """Tres tramos con el mismo número de partidas aprox.: devuelve (corte bajo, corte alto) sobre los valores dados."""
    v = sorted(vals)
    return v[len(v) // 3], v[(2 * len(v)) // 3]


def sec_situations(recs):
    L = ['6) SITUACIONES: cómo vas al terminar tu turno 2, 3 y 4 y cómo acaba la partida (tramos con las mismas partidas cada uno)']
    defs = (('poder en mesa (tú - rival)', lambda x: x['pw2'] - x['opw2']),
            ('Gigs (tú - rival)', lambda x: x['gigs2'] - x['ogigs2']),
            ('cartas en mano', lambda x: x['hand2']))
    for t in (2, 3, 4):
        for title, fn in defs:
            pts = [(fn(x), r['won']) for r in recs for x in r['turns'] if x['t'] == t]
            if len(pts) < 3 * MIN_N:
                continue
            lo, hi = _terciles([v for v, _ in pts])
            tramos = ((f'<= {lo}', [w for v, w in pts if v <= lo]), (f'{lo + 1} a {hi}' if hi > lo + 1 else f'{hi}',[w for v, w in pts if lo < v <= hi]),
                      (f'> {hi}', [w for v, w in pts if v > hi]))
            cells = [f"{lab}: {sum(w) / len(w):.0%} (n={len(w)})" for lab, w in tramos if len(w) >= MIN_N]
            L.append(f"   turno {t}, {title:26s} " + ' | '.join(cells))
    return L


def sec_legends(recs):
    """En qué turno se baja cada Legend (Go Solo) y cuándo se hace el primer Call, con las victorias de cada caso."""
    L = ['7) LEGENDS: en qué turno bajar cada una (Go Solo) y cuándo hacer el primer Call']
    first, calls = defaultdict(list), []
    legend_ids = {c for r in recs for x in r['turns'] for c in x['played'] if BY[c]['type'] == 'Legend'}
    for r in recs:
        seen, call_t = {}, None
        for x in r['turns']:
            for c in set(x['played']):
                if BY[c]['type'] == 'Legend':
                    seen.setdefault(c, x['t'])
            if x['calls'] and call_t is None:
                call_t = x['t']
        for c in legend_ids:
            first[c].append((seen.get(c), r['won']))
        calls.append((call_t, r['won']))

    def line(title, pairs, cuts, labels):
        cells = []
        for lab, ok in zip(labels, cuts):
            w = [won for t, won in pairs if ok(t)]
            if len(w) >= MIN_N:
                cells.append(f"{lab}: {sum(w) / len(w):.0%} (n={len(w)})")
        return f"   {title:34s} " + ' | '.join(cells)

    for c, pairs in sorted(first.items(), key=lambda kv: _nm(kv[0])):
        L.append(line(f"{_nm(c)[:34]}", pairs,
                      (lambda t: t is not None and t <= 3, lambda t: t == 4, lambda t: t == 5, lambda t: t == 6, lambda t: t is None),
                      ('turno 3 o antes', 'turno 4', 'turno 5', 'turno 6', 'no la bajas en 6 turnos')))
    L.append(line('Primer Call (cualquier Legend)', calls, (lambda t: t is not None and t <= 2, lambda t: t == 3, lambda t: t == 4, lambda t: t is not None and t >= 5, lambda t: t is None),
                  ('turno 1-2', 'turno 3', 'turno 4', 'turno 5 o más', 'ninguno')))
    return L


def report(name, recs, rival=None):
    rows = [r for r in recs if rival is None or rival.lower() in r['rival'].lower()]
    head = f"=== Guía de juego: {name} ===\n{len(rows)} partidas" + (f" contra «{rival}»" if rival else '') + f": {_fmt(rows)}"
    parts = [sec_rivals(recs), sec_opening(rows), sec_turns(rows), sec_decisions(rows), sec_sell(rows), sec_situations(rows), sec_legends(rows)]
    return '\n\n'.join([head] + ['\n'.join(p) for p in parts]) + \
        '\n\n(Asociaciones medidas en un simulador, no causas ni partidas reales: úsalas para decidir con criterio, no como reglas fijas.)'
