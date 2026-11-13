"""Fase principal, parte 1: qué vender, qué jugar y habilidades de las Legends y de las Unidades."""
from collections import Counter

import fx2 as fx
from fx2 import ALT, GIG, HANAKO, JUDY, RIVER, uval
from ai2_dice import gig_change, gig_swap, steal_loss
from ai2_setup import CANTRIPS, GS_MODE, HANAKO_THR, TUNERS, TUNE_THR, keep


# ----------------------------------------------------------------------------- fase principal
def call_avg(g, me):
    down = [l for l in me.legs if not l.up and not l.gone]
    if not down:
        return 0.0
    return sum(fx.call_value(g, me, l) for l in down) / len(down)


def spare(g, me):
    return me.phase == 'post' and g.avail(me) > me.reserve


def _hold(g, me, op):
    """Mejor reacción que merece la pena guardar para el turno rival: (valor, coste) o None."""
    threats = [t for t in op.field if g.power(t) > 0 and not t.c['noatk'] and not t.noatk]
    if not threats or not me.gigs:
        return None
    top = max(threats, key=lambda t: g.power(t))
    ids = {c['id'] for c in me.hand}
    blockers = any(g.is_blocker(u) for u in me.field)
    opts = []
    if 'take_control' in ids:
        opts.append((0.75 * GIG + 0.5 * steal_loss(me), 2))
    if 'safety_override' in ids and blockers:
        opts.append((0.5 * uval(g, top), 2))
    if 'reboot_optics' in ids and blockers:
        opts.append((0.7 * GIG, 2))
    if any(x['id'] == 'overwatch_panam_s_gift' for u in me.field for x in u.gear) and len(me.hand) >= 2:
        opts.append((0.6 * uval(g, top) + 0.5 * GIG, 1))
    if me.leg('goro_takemura_vengeful_bodyguard') and any(u.c['cost'] <= 4 for u in me.field):
        opts.append((2.5, 1))
    if me.has('rogue_amendiares_queen_of_the_afterlife'):
        opts.append((2.5, 2))
    if 'floor_it' in ids and g.power(top, atk=True) % 10 == 0:
        opts.append((0.6 * GIG, 1))
    if 'synapse_burnout' in ids and me.field:
        opts.append((1.5, 1))
    if 'detonate' in ids and any(u.gear for u in op.field):
        opts.append((2.0, 1))
    return max(opts) if opts else None


def _sell(g, me):
    if me.sold:
        return
    c = [x for x in me.hand if x['sell']]
    if not c:
        return
    x = min(c, key=lambda x: (keep(g, me, x) - 0.7 * (sum(1 for y in me.hand if y['id'] == x['id']) - 1), x['cost']))
    if g.slip(me):
        x = g.erng.choice(c)                              # fallo humano: vende otra carta (o se olvida de vender)
        if g.erng.random() < 0.3:
            return
    cap = max(5, min(9, me.maxcost - 2))
    if me.E < cap or (keep(g, me, x) < 3.0 and len(me.hand) >= 3):
        me.hand.remove(x)
        me.E += 1
        me.Eready += 1
        me.sold = True


def _gs_adjust(g, me, op, v):
    """Variantes de Go Solo (solo experimento, DECKFORGE_GS): la Legend que sale deja de dar 1 € cada turno y,
    si es tu única Unidad, cualquier eliminación a la de menor poder (Les Élémens) te la quita entera."""
    my_turn = (g.turn + 1) // 2
    if 'cost' in GS_MODE:
        v -= 2.0                      # 1 € menos cada turno que queda
    if 'late' in GS_MODE and my_turn < 3:
        return 0.0                    # no antes de tu 3.er turno
    if 'alone' in GS_MODE and not me.field:
        v -= 3.0                      # la única Unidad queda expuesta
    return v


def _gs_value(g, me, op, l):
    c = l.c
    v = c['pw'] + 1.5
    if op.gigs and not op.has('maxtac_suppression_team'):
        v += 3.0
    if c['blocker']:
        v += 1.5
    f = fx.UBON.get(c['id'])
    if f is not None:
        v += f(g, me, op)
    v += 1.2 * sum(x['pw'] for x in l.gear)
    if c['id'] == 'royce_psycho_on_the_edge':
        v += 2.0 * len(l.gear)
    return v


def _prio(kind, c):
    if kind == 'call':
        return 0
    if kind == 'gs':
        return 2
    if kind == 'alt':
        return 3
    if c['t'] == 'U':
        return 3.5 if c['id'] in ('valentino_street_racer', 'japantown_jonin') else 2
    if c['t'] == 'G':
        return 4
    return 1 if c['id'] in CANTRIPS else 3


def _items(g, me, op):
    items = []
    seen = Counter()
    for c in me.hand:
        seen[c['id']] += 1
        if seen[c['id']] > 2:
            continue
        if me.mode == 'hold' and c['t'] == 'P' and c['id'] not in CANTRIPS:
            continue
        v = fx.value(g, me, op, c)
        if seen[c['id']] == 2:
            v *= 0.5 if c['t'] == 'P' else 0.85
        if v > 0.9:
            items.append((v, g.ccost(me, c), _prio('card', c), 'card', c))
    if not me.called:
        v = call_avg(g, me)
        if v > 0.9:
            items.append((v, 1, 0, 'call', None))
    for l in me.legs:
        if l.up and not l.gone and l.c['gosolo']:
            # la propia Legend no puede pagar su Go Solo: si está preparada cuenta como 1 € menos de presupuesto
            gv = _gs_value(g, me, op, l)
            if GS_MODE != 'base':
                gv = _gs_adjust(g, me, op, gv)
            items.append((gv, fx.gs_cost(g, me, l) + (1 if l.ready else 0), 2, 'gs', l))
    alt = me.leg(ALT)
    if alt is not None and alt.ready:
        best = None
        for x in me.trash:
            if x['t'] == 'P' and not x['quick']:
                v = fx.pval(g, me, op, x)
                if best is None or v > best[0]:
                    best = (v, x)
        if best is not None and best[0] > 3.0:
            items.append((best[0] - 0.3, 2 + g.ccost(me, best[1]), 3, 'alt', best[1]))
    ow = _overwatch_plan(g, me, op)
    if ow is not None:
        items.append((ow[0], 1, 3, 'ow', ow))
    items.sort(key=lambda t: -t[0])
    items = items[:9]
    h = _hold(g, me, op)
    if h is not None:
        items.append((h[0], h[1], 9, 'hold', None))
    return items


def _choose(items, budget):
    n = len(items)
    best = (0.0, 0)
    vals = [t[0] + 0.1 * t[1] for t in items]
    costs = [t[1] for t in items]
    for m in range(1, 1 << n):
        cst = 0
        val = 0.0
        i = 0
        mm = m
        while mm:
            if mm & 1:
                cst += costs[i]
                val += vals[i]
            mm >>= 1
            i += 1
        if cst <= budget and val > best[0]:
            best = (val, m)
    return [items[i] for i in range(n) if best[1] >> i & 1]


def _overwatch_plan(g, me, op):
    """(valor, Unidad con Overwatch, objetivo gastado, carta a descartar) o None."""
    u = next((u for u in me.field if u.ready and not u.lag and any(x['id'] == 'overwatch_panam_s_gift' for x in u.gear)), None)
    if u is None or not me.hand:
        return None
    best = None
    for t in op.field:
        if t.ready:
            continue
        c = [x for x in me.hand if x['cost'] >= t.c['cost']]
        if not c:
            continue
        x = min(c, key=lambda x: keep(g, me, x))
        v = uval(g, t) + 2.0 - 0.6 * keep(g, me, x)
        if v > 1.5 and (best is None or v > best[0]):
            best = (v, u, t, x)
    return best


def _alt_discount(g, me, op):
    alt = me.leg(ALT)
    if alt is None or not alt.ready or me.alt_disc:
        return
    m = fx.mins(me)
    if m >= 2 and any(c['t'] == 'P' and c['cost'] >= 3 and fx.pval(g, me, op, c) > 2.0 for c in me.hand):
        g.spend_leg(me, alt)
        me.alt_disc = m
        g.ev(me, 'discount', ALT, m)


def _unit_abilities(g, me, op):
    for u in list(me.field):
        if not u.ready or u.lag:
            continue
        cid = u.c['id']
        blocked = not op.gigs or any(t.ready and g.is_blocker(t) and g.power(t) >= g.power(u) for t in op.field)
        if cid == 'judy_alvarez_nothing_to_doubt' and me.deck and g.avail(me) >= 1:
            if blocked or len(me.gigs) < 6:
                g.pay(me, 1)
                g.spend_unit(u)
                x = me.deck.pop()
                me.drawn.add(x['id'])
                g.ev(me, 'free', cid)
                if not x['quick'] and fx.value(g, me, op, x) > 1.0:
                    g.play_card(me, x, pay=False)
                else:
                    me.hand.append(x)
        elif cid == 'kerry_eurodyne_the_last_rockerboy' and fx.n8(me) and (blocked or g.turn <= 8):
            g.spend_unit(u)
            g.draw(me, 2, cid)


def _hanako(g, me, op):
    h = me.leg(HANAKO)
    if h is not None and h.ready and gig_swap(g, me, op, HANAKO, thr=HANAKO_THR):
        g.spend_leg(me, h)


def _tunable(g, me, l):
    """¿Puede gastarse ahora este Tuner (Legend boca arriba, lista, con dinero libre) para cambiar un Gig?"""
    return l.up and l.ready and not l.gone and l.c['id'] in TUNERS and g.avail(me) - me.reserve >= 1


def _tune_cands(me, op, l):
    """Cambios de Gig que permite el Tuner `l` al gastarse: [(dueño, gig, valor nuevo)]."""
    cid = l.c['id']
    allg = [(o, x) for o in (me, op) for x in o.gigs]
    if cid == 'dexter_deshawn_off_the_grid':
        return [(o, x, nv) for o, x in allg for nv in range(x[1] + 1, min(x[0], x[1] + 2) + 1)]
    if cid == 'muamar_reyes_el_capitan':
        return [(o, x, x[1] + dv) for o, x in allg for dv in (-1, 1) if 1 <= x[1] + dv <= x[0]]
    if cid == 'wakako_okada_peace_and_harmony':
        return [(o, x, nv) for o, x in allg for nv in range(max(1, x[1] - 2), x[1])]
    return [(o, x, y[1]) for o, x in allg for o2, y in allg if o2 is not o and y[1] <= x[0]]


def tune_leg(g, me, op, l):
    """Gasta el Tuner `l` para cambiar el Gig que más mejora la colocación de dados. True si lo ha gastado."""
    if gig_change(g, me, _tune_cands(me, op, l), l.c['id'], thr=TUNE_THR) is None:
        return False
    g.spend_leg(me, l)
    return True


def tune_gain(g, me, op, l):
    """Cuánto mejoraría la colocación de dados si se gastara el Tuner `l` ahora (0 si no compensa)."""
    return gig_change(g, me, _tune_cands(me, op, l), l.c['id'], thr=TUNE_THR, dry=True)


def _tuning(g, me, op):
    for l in me.legs:
        if _tunable(g, me, l):
            tune_leg(g, me, op, l)


def _panam(g, me, op):
    """2 €, Spend: mover un Gear de Panam a una Unidad sin equipo y prepararla (un ataque extra)."""
    pn = me.leg('panam_palmer_nomad_cavalry')
    if pn is None or not pn.ready or not pn.gear or g.avail(me, keep=(pn,)) < 2 or not op.gigs:
        return False
    c = [u for u in me.field if not u.gear and not u.ready and not u.c['noatk'] and g.power(u) > 0]
    if not c:
        return False
    u = max(c, key=lambda u: g.power(u))
    x = max(pn.gear, key=lambda x: x['pw'])
    g.pay(me, 2, keep=(pn,))
    g.spend_leg(me, pn)
    pn.gear.remove(x)
    u.gear.append(x)
    u.ready = True
    g.ev(me, 'ready', 'panam_palmer_nomad_cavalry')
    return True


def _evelyn(g, me, op):
    """1 €, Spend: una Unidad rival debe atacar el próximo turno (queda gastada y a tiro)."""
    ev = me.leg('evelyn_parker_beautiful_enigma')
    if ev is None or not ev.ready or g.avail(me, keep=(ev,)) < 1:
        return
    mine = max([g.power(u) for u in me.field], default=0)
    c = [t for t in op.field if t.ready and not t.must and not t.c['noatk'] and (me.kill_spent or g.power(t) < mine)]
    if c and (me.kill_spent or any(g.is_blocker(u) and g.power(u) >= g.power(t) for u in me.field for t in c)):
        t = max(c, key=lambda t: uval(g, t))
        g.pay(me, 1, keep=(ev,))
        g.spend_leg(me, ev)
        t.must = True
        g.ev(me, 'lock', 'evelyn_parker_beautiful_enigma')


def _judy_leg(g, me):
    j = me.leg(JUDY)
    if j is not None and j.ready and me.deck:
        g.spend_leg(me, j)
        c = me.deck.pop()
        if c['t'] == 'P':
            me.hand.append(c)
            me.drawn.add(c['id'])
            g.ev(me, 'draw', JUDY)
        else:
            me.trash.append(c)


def _river_own_turn(g, me, op):
    r = me.leg(RIVER)
    if r is None or not r.ready or not me.field:
        return
    gears = [c for c in me.hand if c['t'] == 'G' and c['cost'] <= 2]
    if not gears:
        return
    best = max(gears, key=lambda c: fx.gear_value(g, me, op, c))
    brk = any(g.power(u, atk=True) < 10 <= g.power(u, atk=True) + best['pw'] and g.can_attack(u) for u in me.field)
    if brk or len(gears) >= 3 or not any(g.power(t) > 0 for t in op.field):
        me.hand.remove(best)
        g.spend_leg(me, r)
        g.ev(me, 'free', RIVER)
        g.play_card(me, best, pay=False)
