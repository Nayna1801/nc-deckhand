"""Explica POR QUÉ un mazo gana o pierde, midiendo lo que ocurre de verdad en las partidas simuladas.

No usa valoraciones a ojo: cada número sale de contar eventos en miles de partidas contra el campo
(quién roba cartas, quién elimina, qué carta provoca cada robo de Gig, qué pasa cuando robas una carta
y cuando no, qué pareja de cartas rinde más junta que por separado, qué cartas del rival te hunden).
"""
import math
from collections import Counter, defaultdict
from multiprocessing import Pool

import engine2 as E

NAME = {i: c['name'] for i, c in E.CARD.items()}
LABEL = {'pareja': 'tener una pareja de Gigs', 'min': 'tener un Gig al mínimo', 'menos_cred': 'tener menos Street Cred',
         'gig8': 'tener un Gig de 8+', 'rebajar_a_menos_de_10': 'bajar al atacante de 10 de poder'}

# factor -> (título, tipos de evento que lo miden)
FACTORS = [
    ('cartas', 'Ventaja de cartas (robos extra)', ('draw',)),
    ('gratis', 'Cartas jugadas gratis', ('free',)),
    ('elim', 'Eliminación (derrotar + fondo de mazo)', ('kill', 'bottom')),
    ('tempo', 'Control de tempo (gastar/bloquear rivales)', ('spend', 'lock', 'debuff')),
    ('gigs', 'Gigs robados', ('steal',)),
    ('doble', 'Ataques de doble robo (poder 10+)', ('steal2',)),
    ('defensa', 'Defensa (bloqueos, reacciones, Gigs salvados)', ('block', 'react', 'save')),
    ('dados', 'Manipulación de dados', ('gigadj',)),
    ('descarte', 'Descartes forzados al rival', ('discard',)),
    ('pump', 'Subidas de poder', ('pump',)),
    ('ready', 'Unidades/Eddies preparados de más', ('ready', 'eddie')),
    ('legends', 'Calls y Go Solo', ('call', 'gosolo')),
]


def nm(src):
    return NAME.get(src) or LABEL.get(src) or str(src)


class Acc:
    """Acumulador de las partidas de un cruce (mazo A contra un rival)."""

    def __init__(s):
        s.n = 0
        s.w = 0
        s.first = [0, 0]
        s.second = [0, 0]
        s.turns = 0
        s.ev = [Counter(), Counter()]          # eventos de A y del rival
        s.ev_w = Counter()                     # eventos de A solo en victorias
        s.snap = [defaultdict(lambda: [0, 0, 0, 0, 0, 0]), defaultdict(lambda: [0, 0, 0, 0, 0, 0])]
        s.dn = Counter()                       # partidas en que A robó la carta
        s.dw = Counter()
        s.pn = Counter()                       # partidas en que A la jugó
        s.pair_n = Counter()
        s.pair_w = Counter()
        s.on = Counter()                       # partidas en que el rival jugó la carta
        s.ow = Counter()                       # ... y aun así ganó A

    def add(s, g, ai, res):
        me, op = g.p[ai], g.p[1 - ai]
        won = res == 0
        s.n += 1
        s.w += won
        slot = s.first if ai == 0 else s.second
        slot[0] += 1
        slot[1] += won
        s.turns += g.turn
        s.ev[0].update(g.st[ai])
        s.ev[1].update(g.st[1 - ai])
        if won:
            s.ev_w.update(g.st[ai])
        for k, p in ((0, me), (1, op)):
            for t, v in g.snap[p.pi].items():
                a = s.snap[k][t]
                for i in range(5):
                    a[i] += v[i]
                a[5] += 1
        ids = sorted(i for i in me.early if i in me.ids)
        for i in ids:
            s.dn[i] += 1
            s.dw[i] += won
            if me.played[i]:
                s.pn[i] += 1
        for x in range(len(ids)):
            for y in range(x + 1, len(ids)):
                k = (ids[x], ids[y])
                s.pair_n[k] += 1
                s.pair_w[k] += won
        for i in op.played:
            s.on[i] += 1
            s.ow[i] += won

    def merge(s, o):
        s.n += o.n
        s.w += o.w
        s.turns += o.turns
        for i in (0, 1):
            s.first[i] += o.first[i]
            s.second[i] += o.second[i]
            s.ev[i].update(o.ev[i])
            for t, v in o.snap[i].items():
                a = s.snap[i][t]
                for k in range(6):
                    a[k] += v[k]
        s.ev_w.update(o.ev_w)
        for a, b in ((s.dn, o.dn), (s.dw, o.dw), (s.pn, o.pn), (s.pair_n, o.pair_n), (s.pair_w, o.pair_w), (s.on, o.on), (s.ow, o.ow)):
            a.update(b)

    def freeze(s):
        s.snap = [dict(x) for x in s.snap]
        return s


def _job(args):
    ids, legs, fids, flegs, n, seed = args
    acc = Acc()
    E.play(ids, legs, fids, flegs, N=n, seed=seed, collect=acc.add)
    return acc.freeze()


def run(ids, legs, field, games, seed, procs):
    jobs = [(ids, legs, f['deck'], f['legs'], games, seed) for f in field]
    if procs > 1 and len(jobs) > 1:
        with Pool(min(procs, len(jobs))) as p:
            return p.map(_job, jobs)
    return [_job(j) for j in jobs]


# ----------------------------------------------------------------------------- informe
def _per(acc, who, kinds, only_w=False):
    ev = acc.ev_w if only_w else acc.ev[who]
    n = acc.w if only_w else acc.n
    return sum(v for key, v in ev.items() if isinstance(key, tuple) and key[0] in kinds) / max(1, n)


def _sources(acc, who, kinds, top=4):
    c = Counter()
    for key, v in acc.ev[who].items():
        if isinstance(key, tuple) and key[0] in kinds:
            c[key[1]] += v
    return [(nm(src), v / max(1, acc.n)) for src, v in c.most_common(top)]


def _se(p, n):
    return math.sqrt(max(p * (1 - p), 1e-9) / max(1, n))


def factor_table(acc):
    """[(clave, título, yo, rival, yo_en_victorias, yo_en_derrotas)]"""
    out = []
    nl = max(1, acc.n - acc.w)
    for key, title, kinds in FACTORS:
        me = _per(acc, 0, kinds)
        op = _per(acc, 1, kinds)
        mw = _per(acc, 0, kinds, only_w=True)
        ml = (me * acc.n - mw * acc.w) / nl
        out.append((key, title, me, op, mw, ml))
    return out


def _section_factors(tot):
    """1) Factores: media por partida (tú / rival; ganando / perdiendo) y desarrollo de los primeros turnos."""
    L = []
    L.append('\n1) FACTORES (media por partida: tú / rival; y tú cuando ganas / cuando pierdes)')
    rows = factor_table(tot)
    for key, title, me, op, mw, ml in rows:
        flag = ''
        if me > op * 1.25 + 0.15:
            flag = '  <- ventaja'
        elif op > me * 1.25 + 0.15:
            flag = '  <- desventaja'
        L.append(f"   {title:48s} {me:5.2f} / {op:5.2f}   (ganando {mw:5.2f} · perdiendo {ml:5.2f}){flag}")
    L.append('   Desarrollo (final de tu turno N): poder en mesa · cartas en mano · Eddies · Gigs tuyos-rival')
    for t in (2, 3, 4, 5):
        a, b = tot.snap[0].get(t), tot.snap[1].get(t)
        if a and b and a[5] and b[5]:
            L.append(f"     turno {t}: tú {a[0] / a[5]:4.1f} poder, {a[1] / a[5]:.1f} cartas, {a[2] / a[5]:.1f} €, Gigs {a[3] / a[5]:.1f}-{a[4] / a[5]:.1f}"
                     f"   | rival {b[0] / b[5]:4.1f} poder, {b[1] / b[5]:.1f} cartas, {b[2] / b[5]:.1f} €")
    conds = []
    for c in ('pareja', 'min', 'menos_cred', 'gig8'):
        ok, no = tot.ev[0][('cond_ok', c)], tot.ev[0][('cond_no', c)]
        if ok + no:
            conds.append(f"{LABEL[c]} {ok / (ok + no):.0%}")
    L.append('   Condiciones de dados cumplidas al empezar tus turnos: ' + ' · '.join(conds))
    return L


def _section_sources(tot):
    """2) De dónde sale cada cosa: tus fuentes principales por partida."""
    L = []
    L.append('\n2) DE DÓNDE SALE CADA COSA (tus fuentes principales, por partida)')
    for key, title, kinds in FACTORS[:7]:
        src = _sources(tot, 0, kinds)
        if src:
            L.append(f"   {title}: " + '; '.join(f"{n} {v:.2f}" for n, v in src))
    return L


def _section_cards(tot, deck_ids):
    """3) Cartas: victorias cuando la ves pronto frente a cuando no."""
    L = []
    L.append('\n3) CARTAS: victorias cuando la ves pronto (mano inicial o tus 3 primeros turnos) frente a cuando no (Δ), y cuántas veces se juega')
    cards = []
    for i in sorted(set(deck_ids)):
        n1, w1 = tot.dn[i], tot.dw[i]
        n0, w0 = tot.n - n1, tot.w - w1
        if n1 < 30 or n0 < 30:
            continue
        d = w1 / n1 - w0 / n0
        se = math.sqrt(_se(w1 / n1, n1) ** 2 + _se(w0 / n0, n0) ** 2)
        cards.append((d, se, i, n1, tot.pn[i] / n1))
    cards.sort(reverse=True)
    for d, se, i, n1, pl in cards:
        mark = '**' if abs(d) > 2.5 * se else ('* ' if abs(d) > 1.6 * se else '  ')
        L.append(f"   {mark} {d:+6.1%} (±{1.96 * se:.1%})  {deck_ids.count(i)}x {nm(i):42s} jugada el {pl:.0%} de las veces")
    L.append('   (** = diferencia clara, * = probable; sin marca = dentro del ruido)')
    return L


def _section_synergies(tot, top):
    """4) Sinergias y antisinergias entre pares de cartas."""
    L = []
    L.append('\n4) SINERGIAS Y ANTISINERGIAS entre pares de cartas (cuánto rinden JUNTAS por encima de lo esperado por separado)')
    inter = []
    for (a, b), n11 in tot.pair_n.items():
        w11 = tot.pair_w[(a, b)]
        n10, w10 = tot.dn[a] - n11, tot.dw[a] - w11
        n01, w01 = tot.dn[b] - n11, tot.dw[b] - w11
        n00, w00 = tot.n - n11 - n10 - n01, tot.w - w11 - w10 - w01
        if min(n11, n10, n01, n00) < 60:
            continue
        x = w11 / n11 - w10 / n10 - w01 / n01 + w00 / n00
        se = math.sqrt(sum(_se(w / n, n) ** 2 for w, n in ((w11, n11), (w10, n10), (w01, n01), (w00, n00))))
        inter.append((x / se, x, a, b, w11 / n11))
    inter.sort(reverse=True)
    pos = [t for t in inter if t[0] > 2.6][:top]
    neg = [t for t in reversed(inter) if t[0] < -2.6][:top // 2]
    if not pos and not neg:
        L.append('   Ninguna pareja se separa del ruido con estas partidas (sube --games para afinar).')
    for z, x, a, b, w in pos:
        L.append(f"   + {x:+6.1%}  {nm(a)} + {nm(b)}  (juntas ganan el {w:.0%})")
    for z, x, a, b, w in neg:
        L.append(f"   - {x:+6.1%}  {nm(a)} + {nm(b)}  (juntas ganan el {w:.0%})")
    return L


def _section_matchups(accs, field):
    """5) Cruces: contra quién ganas o pierdes y qué factor lo decide."""
    L = []
    L.append('\n5) CRUCES: contra quién ganas o pierdes y qué factor lo decide')
    for acc, f in sorted(zip(accs, field), key=lambda t: t[0].w / max(1, t[0].n)):
        w = acc.w / max(1, acc.n)
        rows = factor_table(acc)
        diffs = sorted(rows, key=lambda r: (r[3] - r[2]) / (max(r[2], r[3]) + 0.3), reverse=True)
        bad = [f"{r[1].split(' (')[0].lower()} ({r[2]:.1f} vs {r[3]:.1f})" for r in diffs[:2] if r[3] > r[2] * 1.15 + 0.1]
        good = [f"{r[1].split(' (')[0].lower()} ({r[2]:.1f} vs {r[3]:.1f})" for r in reversed(diffs[-2:]) if r[2] > r[3] * 1.15 + 0.1]
        L.append(f"   {w:4.0%}  vs {f['name']}")
        if good:
            L.append('          te da ventaja: ' + '; '.join(good))
        if bad:
            L.append('          te supera en: ' + '; '.join(bad))
        hurt = []
        for i, n1 in acc.on.items():
            n0 = acc.n - n1
            if n1 < 25 or n0 < 25:
                continue
            d = acc.ow[i] / n1 - (acc.w - acc.ow[i]) / n0
            se = math.sqrt(_se(acc.ow[i] / n1, n1) ** 2 + _se((acc.w - acc.ow[i]) / n0, n0) ** 2)
            if d < -1.8 * se:
                hurt.append((d, i))
        hurt.sort()
        if hurt:
            L.append('          sus cartas que más te hunden cuando las juega: ' + '; '.join(f"{nm(i)} ({d:+.0%})" for d, i in hurt[:3]))
        ks = _sources(acc, 1, ('kill', 'bottom'), top=3)
        ss = _sources(acc, 1, ('steal',), top=3)
        if ks:
            L.append('          te elimina con: ' + '; '.join(f"{n} {v:.1f}" for n, v in ks) + ' · te roba Gigs con: ' + '; '.join(f"{n} {v:.1f}" for n, v in ss))
    return L


def report(name, field, accs, deck_ids, top=8):
    L = []
    tot = Acc()
    for a in accs:
        tot.merge(a)
    wr = tot.w / max(1, tot.n)
    L.append(f"=== {name}: {wr:.1%} de victorias en {tot.n} partidas contra {len(field)} mazos (±{1.96 * _se(wr, tot.n):.1%}) ===")
    L.append(f"Empezando {tot.first[1] / max(1, tot.first[0]):.0%} · de segundo {tot.second[1] / max(1, tot.second[0]):.0%} · duración media {tot.turns / max(1, tot.n) / 2:.1f} turnos por jugador")
    L += _section_factors(tot)
    L += _section_sources(tot)
    L += _section_cards(tot, deck_ids)
    L += _section_synergies(tot, top)
    L += _section_matchups(accs, field)
    return '\n'.join(L), tot
