"""Dados de Gig: qué dados cambiar, intercambiar, robar o tirar según lo que el mazo necesita (parejas, mínimos, Street Cred alto o bajo...)."""
from collections import Counter

from ai2_setup import DICE_CARE, DICE_NET, DICE_PARTS, keep


# ----------------------------------------------------------------------------- dados de Gig
def gobj(p):
    """Lo bien colocados que están los dados de p para SU mazo."""
    gs = p.gigs
    if not gs or not p.anyw:
        return 0.0
    w = p.w
    vals = [v for _, v in gs]
    cnt = Counter(vals)
    o = 0.0
    if w['pair']:
        o += w['pair'] * sum(n // 2 for n in cnt.values())
    if w['min']:
        o += w['min'] * min(3, cnt.get(1, 0))
    if w['d4min'] and any(d == 4 and v == 1 for d, v in gs):
        o += w['d4min']
    cred = sum(vals)
    if p.op.gigs and (w['low'] or w['high']):
        d = p.op.cred() - cred
        if w['low']:
            o += w['low'] * (1.0 if d > 0 else -0.5) + 0.02 * d
        if w['high']:
            o += w['high'] * (1.0 if d < 0 else -0.5) - 0.02 * d
    if w['g8']:
        o += w['g8'] * min(3, sum(1 for v in vals if v >= 8))
    if w['dist']:
        o += w['dist'] * min(3, len(cnt)) / 3.0
    if w['even']:
        o += w['even'] * 0.5 * sum(1 for v in vals if v % 2 == 0)
    if w['evencred'] and cred % 2 == 0:
        o += w['evencred']
    if w['mix'] and any(v % 2 for v in vals) and any(v % 2 == 0 for v in vals):
        o += w['mix']
    if w['d20']:
        o += w['d20'] * max([v for d, v in gs if d == 20], default=0) / 20.0
    if w['max'] and any(v == d for d, v in gs):
        o += w['max']
    return o


def steal_loss(p):
    """Cuánto empeora la colocación de dados de p si el rival le roba el dado que más le duele."""
    if not DICE_CARE or not p.anyw or len(p.gigs) < 2:
        return 0.0
    base = gobj(p)
    worst = base
    for i in range(len(p.gigs)):
        x = p.gigs.pop(i)
        worst = min(worst, gobj(p))
        p.gigs.insert(i, x)
    return base - worst


def _robust(p):
    """Valor de la colocación contando con que el rival, si tiene con qué atacar, se llevará el dado clave."""
    base = gobj(p)
    if DICE_CARE and base and any(u.c['pw'] > 0 or u.gear for u in p.op.field):
        return base - 0.4 * steal_loss(p)
    return base


def _score(me):
    return _robust(me) - 0.6 * gobj(me.op)


def _meredith(g, victim):
    if victim.has('meredith_stout_stone_cold_corpo') and victim.trash:
        x = max(victim.trash, key=lambda x: keep(g, victim, x))
        victim.trash.remove(x)
        victim.hand.append(x)
        g.ev(victim, 'draw', 'meredith_stout_stone_cold_corpo')


def _dscore(g, me, part):
    """Valor de la colocación de dados de `me`: por la red (que conoce qué piden las cartas) o por la fórmula a mano."""
    if _net_dice(g, me, part):
        import valfn
        vf = g.vf[me.pi]
        sc = valfn.score(g, me, vf.split('@', 1)[1] if '@' in vf else None)
        if sc is not None:
            return sc
    return _score(me)


def _net_dice(g, me, part):
    """¿Decide los dados la red? Solo con vf = action, en la partida real, y si la red conoce los dados."""
    if not DICE_NET or g.rollout or part not in DICE_PARTS:
        return False
    vf = g.vf[me.pi]
    if not vf.startswith('action'):
        return False
    import valfn
    return valfn.has_dice(vf.split('@', 1)[1] if '@' in vf else None)


def gig_change(g, me, cands, src, bonus=None, thr=0.05, dry=False):
    """cands = [(dueño, gig, nuevo_valor)]. Aplica el mejor cambio si mejora la posición. Devuelve (gig, valor) o None."""
    if not cands:
        return 0.0 if dry else None
    base = _dscore(g, me, 'change')
    best = None
    for owner, x, nv in cands:
        old = x[1]
        if nv == old:
            continue
        x[1] = nv
        sc = _dscore(g, me, 'change') + (bonus(x, nv) if bonus else 0.0)
        x[1] = old
        if sc > base + thr and (best is None or sc > best[0]):
            best = (sc, owner, x, nv)
    if dry:
        return 0.0 if best is None else best[0] - base
    if best is None:
        return None
    _, owner, x, nv = best
    x[1] = nv
    g.ev(me, 'gigadj', src)
    if owner is not me:
        _meredith(g, owner)
    return (x, nv)


def gig_swap(g, me, op, src, thr=0.3):
    if not me.gigs or not op.gigs:
        return False
    base = _dscore(g, me, 'swap')
    best = None
    for a in me.gigs:
        for b in op.gigs:
            if a[1] == b[1] and a[0] == b[0]:
                continue
            ia, ib = me.gigs.index(a), op.gigs.index(b)
            me.gigs[ia], op.gigs[ib] = b, a
            sc = _dscore(g, me, 'swap')
            me.gigs[ia], op.gigs[ib] = a, b
            if sc > base + thr and (best is None or sc > best[0]):
                best = (sc, ia, ib)
    if best is None:
        return False
    _, ia, ib = best
    me.gigs[ia], op.gigs[ib] = op.gigs[ib], me.gigs[ia]
    g.ev(me, 'gigadj', src)
    _meredith(g, op)
    return True


def pick_steal(g, me, op, cands):
    if not me.anyw and not op.anyw:
        return max(cands, key=lambda x: x[1])
    best = None
    for x in cands:
        op.gigs.remove(x)
        me.gigs.append(x)
        sc = _dscore(g, me, 'steal') + 0.01 * x[1]
        me.gigs.pop()
        op.gigs.append(x)
        if best is None or sc > best[0]:
            best = (sc, x)
    return best[1]


def pick_die(g, me):
    opts = sorted(d for d in me.fixer if d != 20) or me.fixer
    if len(opts) > 1 and _net_dice(g, me, 'die'):
        best = None
        for d in opts:
            tot = 0.0
            for v in range(1, d + 1):
                me.gigs.append([d, v])
                tot += _dscore(g, me, 'die')
                me.gigs.pop()
            e = tot / d
            if best is None or e > best[0] + 1e-9:
                best = (e, d)
        return best[1]
    if not DICE_CARE:
        return min(opts) if me.lowdice else max(opts)
    if not me.anyw:
        return max(opts)
    best = None
    for d in opts:
        tot = 0.0
        for v in range(1, d + 1):
            me.gigs.append([d, v])
            tot += gobj(me)
            me.gigs.pop()
        e = tot / d
        if best is None or e > best[0] + 1e-9:
            best = (e, d)
    return best[1]
