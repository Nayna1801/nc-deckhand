"""Programas en el motor v2: efecto de cada uno y cuánto vale jugarlo ahora."""
from fx2_base import (
    DRAW, GIG, ON_SPENT_GEAR, ask_may, best_from, best_spend, by_human, can_hit, choose_mode, cost, d4min, do_spend, free_unit_from, gs_cost, mins,
    kill_value, n8, pairs, pick, pick_cards, pick_gear_target, pick_own, uval,
)
from fx2_rules import call_value


# ----------------------------------------------------------------------------- Programas: efecto
def _g_all(me, op):
    return [(o, x) for o in (me, op) for x in o.gigs]


def _pr_floor_it(g, me, op, c):
    t = pick(g, op.field, key=lambda t: g.power(t))
    if t is not None:
        t.tmp -= 1
    g.draw(me, 1, c['id'])


def _pr_trust(g, me, op, c):
    need = mins(me) == 0
    g.ai.gig_change(g, me, [(o, x, nv) for o, x in _g_all(me, op) for nv in range(max(1, x[1] - 3), x[1])], c['id'],
                    bonus=lambda x, nv: (DRAW if need and nv == 1 and x in me.gigs else 0.0))
    if mins(me):
        g.draw(me, 1, c['id'])


def _pr_three_mouths(g, me, op, c):
    top = [me.deck.pop() for _ in range(min(3, len(me.deck)))]
    k = min(len(top), 1 + mins(me))
    if by_human(g, me) and len(top) > k:         # la persona elige qué cartas se queda; el resto va al fondo
        chosen = pick_cards(g, top, k)
        rest = list(top)
        for x in chosen:
            rest.remove(x)
        top = chosen + rest
    else:
        top.sort(key=lambda x: -g.ai.keep(g, me, x))
    for x in top[:k]:
        me.hand.append(x)
        me.drawn.add(x['id'])
    if k:
        g.ev(me, 'draw', c['id'], k)
    g.to_bottom(me, top[k:])


def _lock_target(g, op):
    return pick(g, op.field, lambda t: not t.c['noatk'] and not t.noatk and g.power(t) > 0, key=lambda t: g.power(t) + (0 if t.ready else -2))


def _pr_chrome(g, me, op, c):
    t = _lock_target(g, op)
    if t is not None:
        t.noatk = True
        g.ev(me, 'lock', c['id'])
    if mins(me):
        g.call(me, free=True)


def _nocturne_mode(g, me, op):
    for l in me.legs:
        if l.up and not l.gone and l.c['gosolo']:
            k = gs_cost(g, me, l)
            if k - 2 <= g.avail(me, keep=(l,)) - cost(g, me, {'id': 'nocturne_op55_n1', 'cost': 3, 't': 'P'}) < k:
                return 'gs', 6.0
    t = _lock_target(g, op)
    if t is not None and g.power(t) >= 8 and len(me.hand) >= 3:
        return 'lock', _lockval(g, me, t)
    return 'draw', 2 * DRAW


def _pr_nocturne(g, me, op, c):
    modes = [('draw', 'Robar 2 cartas')]
    if any(not t.c['noatk'] and not t.noatk and g.power(t) > 0 for t in op.field):
        modes.append(('lock', 'Una Unidad rival no puede atacar hasta tu próximo turno'))
    if any(l.up and not l.gone and l.c['gosolo'] for l in me.legs):
        modes.append(('gs', 'Una Legend tuya puede hacer Go Solo por 2 € menos este turno (mínimo 1 €)'))
    mode = choose_mode(g, me, modes, 'Nocturne')                  # la persona elige; el piloto, su heurística
    if mode is None:
        mode, _ = _nocturne_mode(g, me, op)
    if mode == 'gs':
        me.gs_disc = 2
    elif mode == 'lock':
        t = _lock_target(g, op)
        t.noatk = True
        g.ev(me, 'lock', c['id'])
    else:
        g.draw(me, 2, c['id'])


def _pyramid_plan(g, me, op):
    """Devuelve (valor, objetivo del -4, hacer fondo de mazo)."""
    both = d4min(me)
    if both:
        t = pick(g, op.field, lambda t: g.power(t) <= 4)
        if t is not None:
            return uval(g, t) + 2.0, t, True
    t0 = pick(g, op.field, lambda t: g.power(t) == 0)
    if t0 is not None:
        return uval(g, t0) + 2.0, None, True
    # solo el -4: sirve para ganar una pelea o apartar un Blocker este turno
    atk = can_hit(g, me)
    if atk:
        best = max(g.power(u, atk=True) for u in atk)
        t = pick(g, op.field, lambda t: best <= g.power(t) < best + 4 and (not t.ready and True or g.is_blocker(t)))
        if t is not None:
            return 0.5 * uval(g, t), t, False
    return 0.0, None, False


def _pyramid_by_hand(g, me, op, c):
    """Pyramid Song elegido por una persona: -4 de poder a una Unidad rival y/o fondo del mazo de una Unidad rival de poder 0 (las dos con un d4 mínimo)."""
    effects = []
    if op.field:
        effects.append(('debuff', 'Dar -4 de poder a una Unidad rival este turno'))
    if any(g.power(t) == 0 for t in op.field):
        effects.append(('bottom', 'Mandar al fondo del mazo una Unidad rival de poder 0'))
    chosen = [k for k, _ in effects] if d4min(me) else [choose_mode(g, me, effects, 'Pyramid Song') or (effects[0][0] if effects else None)]
    if 'debuff' in chosen:
        t = pick(g, op.field)
        t.tmp -= 4
        g.ev(me, 'debuff', c['id'])
    if 'bottom' in chosen:
        t0 = pick(g, op.field, lambda x: g.power(x) == 0)
        if t0 is not None:
            g.bottom(t0, c['id'], by=me)


def _pr_pyramid(g, me, op, c):
    if by_human(g, me):
        return _pyramid_by_hand(g, me, op, c)
    v, t, bot = _pyramid_plan(g, me, op)
    if t is not None:
        t.tmp -= 4
        g.ev(me, 'debuff', c['id'])
    if bot:
        t0 = pick(g, op.field, lambda x: g.power(x) == 0)
        if t0 is not None:
            g.bottom(t0, c['id'], by=me)


def _pr_bond(g, me, op, c):
    t = pick(g, op.field, lambda t: not t.ready)
    mine = pick(g, me.field, lambda u: u.ready, key=lambda u: -uval(g, u))
    if t is not None and mine is not None:
        g.bottom(mine, c['id'], by=None)
        g.bottom(t, c['id'], by=me)


def _lowest(g, op):
    if not op.field:
        return None
    lo = min(g.power(t) for t in op.field)
    return pick(g, op.field, lambda t: g.power(t) == lo)


def _pr_elemens(g, me, op, c):
    t = _lowest(g, op)
    if t is not None:
        g.bottom(t, c['id'], by=me)


def _tower_plan(g, me, op):
    both = bool(me.gigs and op.gigs and me.cred() < op.cred())
    if both:
        return sum(uval(g, t) + 2.0 for t in op.field if g.power(t) <= 5), 'both'
    zero = [t for t in op.field if g.power(t) == 0]
    if zero:
        return sum(uval(g, t) + 2.0 for t in zero), 'bottom'
    return 0.0, 'debuff'


def _pr_towerfall(g, me, op, c):
    if by_human(g, me):
        both = bool(me.gigs and op.gigs and me.cred() < op.cred())             # con menos Street Cred se eligen los dos
        mode = 'both' if both else choose_mode(g, me, [('debuff', 'Dar -5 de poder a todas las Unidades rivales este turno'),
                                                       ('bottom', 'Mandar al fondo del mazo todas las Unidades rivales de poder 0')], 'Towerfall')
    else:
        v, mode = _tower_plan(g, me, op)
    if mode in ('both', 'debuff'):
        for t in op.field:
            t.tmp -= 5
        g.ev(me, 'debuff', c['id'])
    if mode in ('both', 'bottom'):
        for t in list(op.field):
            if g.power(t) == 0:
                g.bottom(t, c['id'], by=me)


def _pr_peace(g, me, op, c):
    allg = _g_all(me, op)
    vals = {x[1] for _, x in allg}
    had_pair = pairs(me) > 0
    g.ai.gig_change(g, me, [(o, x, v) for o, x in allg for v in vals if v != x[1] and v <= x[0]], c['id'],
                    bonus=lambda x, nv: (DRAW if not had_pair and x in me.gigs and any(y is not x and y[1] == nv for y in me.gigs) else 0.0))
    if pairs(me):
        g.draw(me, 1, c['id'])


def _pr_surveillance(g, me, op, c):
    if by_human(g, me):
        t = pick(g, op.field, lambda t: t.ready and t.c['cost'] <= 4)
    else:
        t, _ = best_spend(g, me, op, lambda t: t.c['cost'] <= 4)
    if t is not None:
        do_spend(g, me, t, c['id'])


def _pr_fool(g, me, op, c):
    top = [me.deck.pop() for _ in range(min(2, len(me.deck)))]
    by_rival = None
    if top:                                  # el RIVAL decide: si es una persona, elige ella (aunque no sea su turno)
        names = ' y '.join(x['name'] for x in top)
        by_rival = choose_mode(g, op, [('hand', 'Añadírselas a su mano'), ('trash', 'Tirarlas a la basura: el piloto roba 2 cartas')],
                               f'Fool on the Hill (el piloto revela {names})')
    if by_rival == 'trash' or (by_rival is None and sum(g.ai.keep(g, me, x) for x in top) > 4.0 * len(top)):   # buenas cartas: el rival las tira
        me.trash.extend(top)
        g.draw(me, 2, c['id'])
    else:
        for x in top:
            me.hand.append(x)
            me.drawn.add(x['id'])
        if top:
            g.ev(me, 'draw', c['id'], len(top))


def _pr_relapse(g, me, op, c):
    if by_human(g, me):
        t = pick(g, op.field)
    else:
        t, _ = best_spend(g, me, op)
        if t is None:
            t = pick(g, op.field)
    if t is not None:
        do_spend(g, me, t, c['id'], lock=True)
        t.noready = True
    if me.gigs and me.cred() % 2 == 0:
        g.draw(me, 1, c['id'])


def _pr_wglt(g, me, op, c):
    for _ in range(2):
        free_unit_from(g, me, [me.trash], 3, c['id'])


def _pr_wild(g, me, op, c):
    t = pick(g, op.field, lambda t: not t.ready)
    if t is not None:
        g.defeat(t, c['id'], by=me)


def _pr_reaper(g, me, op, c):
    for t in list(op.field):
        if t.ready:
            do_spend(g, me, t, c['id'])
    _pr_wild(g, me, op, c)


def _pr_all_is_lost(g, me, op, c):
    got = g.mill(me, 3)
    x = best_from(g, me, got, lambda x: x['t'] == 'U')
    if x is not None:
        me.trash.remove(x)
        me.hand.append(x)
        g.ev(me, 'draw', c['id'])


def _detonate_gears(op):
    return [(x, h) for h in list(op.field) + [l for l in op.legs if not l.gone] for x in h.gear if x['pw'] <= 2]


def _detonate_target(g, op):
    gears = _detonate_gears(op)
    if not gears:
        return None
    return max(gears, key=lambda t: t[0]['pw'] * 1.2 + (2 if t[0]['blocker'] else 0) + (1.5 if t[0]['id'] in ON_SPENT_GEAR else 0))


def _pr_detonate(g, me, op, c):
    gears = _detonate_gears(op)
    if by_human(g, me) and len(gears) > 1:         # la persona elige qué Gear (también si lo juega como Quick en el turno del rival)
        x = pick_cards(g, [gx for gx, _ in gears], 1, who=me, why=c['name'])[0]
        t = next(t for t in gears if t[0] is x)
    else:
        t = _detonate_target(g, op)
    if t is not None:
        x, h = t
        h.gear.remove(x)
        op.trash.append(x)
        g.ev(me, 'gearkill', c['id'])


def _pr_assembly(g, me, op, c):
    need = n8(me) == 0
    g.ai.gig_change(g, me, [(o, x, nv) for o, x in _g_all(me, op) for nv in range(x[1] + 1, min(x[0], x[1] + 4) + 1)], c['id'],
                    bonus=lambda x, nv: (DRAW if need and nv >= 8 and x in me.gigs else 0.0))
    if n8(me):
        g.draw(me, 1, c['id'])


def _appetite_ok(g, me, op):
    for u in can_hit(g, me):
        P = g.power(u, atk=True)
        if any((not t.ready) and P >= g.power(t) + 3 for t in op.field):
            return True
    return False


def _pr_appetite(g, me, op, c):
    me.appetite = True


def _bonnie_targets(g, me, op):
    n = 2 if len(op.gigs) >= len(me.gigs) + 2 else 1
    return sorted([t for t in op.field if g.power(t) <= 4], key=lambda t: -uval(g, t))[:n]


def _bonnie_by_hand(g, me, op, c):
    """Bonnie and Clyde elegido por una persona: qué Unidad rival de poder 4 o menos y, con 2 Gigs de ventaja del rival, si derrota una segunda."""
    cands = [t for t in op.field if g.power(t) <= 4]
    if not cands:
        return
    first = pick(g, cands)
    g.defeat(first, c['id'], by=me)
    rest = [t for t in cands if t is not first]
    if rest and len(op.gigs) >= len(me.gigs) + 2 and ask_may(g, me, 'Derrotar una segunda Unidad rival de poder 4 o menos', c['name']):
        g.defeat(pick(g, rest), c['id'], by=me)


def _pr_bonnie(g, me, op, c):
    if by_human(g, me):
        _bonnie_by_hand(g, me, op, c)
        return
    for t in _bonnie_targets(g, me, op):
        g.defeat(t, c['id'], by=me)


def _edge_target(g, me, op):
    d20 = max([v for d, v in me.gigs if d == 20], default=0)
    return pick(g, op.field, lambda t: g.power(t) <= d20) if d20 else None


def _pr_edge(g, me, op, c):
    t = _edge_target(g, me, op)
    if t is not None:
        g.defeat(t, c['id'], by=me)


def _gunpoint_plan(g, me, op):
    best = (0.0, None, None)
    if me.gigs and op.gigs and me.cred() < op.cred():
        return best
    for u in can_hit(g, me):
        P = g.power(u, atk=True)
        if op.gigs and P < 10 <= P + 3:
            best = max(best, (GIG - 1, u, None), key=lambda t: t[0])
        for t in op.field:
            if t.ready and g.power(t) < P + 3:
                v = uval(g, t) * 0.9
                if v > best[0]:
                    best = (v, u, t)
    return best


def _gunpoint_rival_gives(g, op, u):
    """Con menos Street Cred el rival elige UN efecto para ti y da el que menos te sirve: el +3 solo vale si cruza un tramo de 10 de poder
    (roba un Gig más); poder atacar Unidades preparadas, si hay una a la que ganar. Con empate te deja poder atacar Unidades (sin el +3)."""
    P = g.power(u, atk=True)
    pump = GIG - 1 if op.gigs and P < 10 <= P + 3 else 0.0
    atk = max([uval(g, t) * 0.9 for t in op.field if t.ready and g.power(t) < P], default=0.0)
    return 'atkr' if pump >= atk else 'pump'


def _gunpoint_by_hand(g, me, op, c):
    """Gunpoint Diplomacy elegido por una persona: la Unidad que lo recibe. Con menos Street Cred el rival elige UNO de los dos efectos."""
    u = pick(g, me.field, lambda x: g.can_attack(x))
    if u is None:
        return
    rival_chooses = me.gigs and op.gigs and me.cred() < op.cred()
    effect = _gunpoint_rival_gives(g, op, u) if rival_chooses else 'both'
    if effect in ('both', 'pump'):
        u.tmp += 3
        g.ev(me, 'pump', c['id'])
    if effect in ('both', 'atkr'):
        u.atkr = True


def _pr_gunpoint(g, me, op, c):
    if by_human(g, me):
        return _gunpoint_by_hand(g, me, op, c)
    v, u, t = _gunpoint_plan(g, me, op)
    if u is not None:
        u.tmp += 3
        g.ev(me, 'pump', c['id'])
        if t is not None:
            u.atkr = True


def _pr_shattered(g, me, op, c):
    n = len(me.hand) + len(op.hand)
    for p in (me, op):
        p.trash.extend(p.hand)
        p.hand = []
    for p, src in ((me, c['id']), (op, None)):     # «puede robar 5»: el piloto roba siempre; la persona decide
        if ask_may(g, p, 'Robar 5 cartas', c['name']) is not False:
            g.draw(p, 5, src)
    if any(v == n for _, v in me.gigs):
        g.draw(me, 2, c['id'])


def _carnage_target(g, me, op):
    top = max([g.power(u) for u in me.field], default=0)
    return pick(g, op.field, lambda t: g.power(t) < top)


def _pr_carnage(g, me, op, c):
    t = _carnage_target(g, me, op)
    if t is not None:
        g.defeat(t, c['id'], by=me)


def _pr_afterparty(g, me, op, c):
    g.ai.gig_change(g, me, [(o, x, x[1] + dv) for o, x in _g_all(me, op) for dv in (-1, 1) if 1 <= x[1] + dv <= x[0]], c['id'])
    if len({v for _, v in me.gigs}) >= 2:
        g.draw(me, 1, c['id'])


def _pr_heist(g, me, op, c):
    got = g.mill(me, 4)
    x = best_from(g, me, got, lambda x: x['t'] == 'G')
    if x is None:
        return
    me.trash.remove(x)
    g.ev(me, 'draw', c['id'])
    free = any(v == x['cost'] for _, v in me.gigs) and g.ai.gear_target(g, me, x) is not None
    if free and choose_mode(g, me, [('free', f"Jugar {x['name']} gratis"), ('hand', f"Añadir {x['name']} a tu mano")], c['name']) == 'hand':
        free = False
    if free:
        g.ev(me, 'free', c['id'])
        g.play_card(me, x, pay=False, target=pick_gear_target(g, me, x))
    else:
        me.hand.append(x)


def _pr_aftermath(g, me, op, c):
    for p, by in ((op, me), (me, None)):
        if p.field:
            t = pick_own(g, p, p.field, 'Live with the Aftermath (se derrota una Unidad tuya)')
            g.defeat(t, c['id'], by=by)


def _pr_bootleg(g, me, op, c):
    if me.deck:
        me.deck.pop()
        me.E += 1
        me.Eready += 1
        g.ev(me, 'eddie', c['id'])
    vals = [v for _, v in me.gigs]
    if any(v % 2 == 0 for v in vals) and any(v % 2 == 1 for v in vals):
        g.draw(me, 2, c['id'])


def _noop(g, me, op, c):
    pass


PROG = {
    'floor_it': _pr_floor_it, 'trust_no_one': _pr_trust, 'three_mouths_one_desire': _pr_three_mouths, 'chrome_reverie': _pr_chrome,
    'nocturne_op55_n1': _pr_nocturne, 'pyramid_song': _pr_pyramid, 'unlikely_bond': _pr_bond, 'les_elemens': _pr_elemens,
    'towerfall': _pr_towerfall, 'peace_offering': _pr_peace, 'corporate_surveillance': _pr_surveillance, 'fool_on_the_hill': _pr_fool,
    'memory_relapse': _pr_relapse, 'we_gotta_live_together': _pr_wglt, 'wild_in_the_streets': _pr_wild, 'don_t_fear_the_reaper': _pr_reaper,
    'all_is_lost': _pr_all_is_lost, 'detonate': _pr_detonate, 'industrial_assembly': _pr_assembly, 'appetite_for_destruction': _pr_appetite,
    'bonnie_and_clyde': _pr_bonnie, 'over_the_edge': _pr_edge, 'gunpoint_diplomacy': _pr_gunpoint, 'shattered_memories': _pr_shattered,
    'carnage_at_the_colosseum': _pr_carnage, 'afterparty_at_lizzie_s': _pr_afterparty, 'the_heist': _pr_heist,
    'live_with_the_aftermath': _pr_aftermath, 'bootleg_black_sapphire_show': _pr_bootleg,
}


def play_program(g, me, op, c):
    PROG.get(c['id'], _noop)(g, me, op, c)


# ----------------------------------------------------------------------------- Programas: valor de jugarlos ahora
def _v_spend(pred=None, mult=1.0, extra=0.0):
    def f(g, me, op):
        t, v = best_spend(g, me, op, pred)
        return v * mult + (extra if t is not None else 0.0)
    return f


def _v_trust(g, me, op):
    if not me.gigs:
        return 0.3 if not op.gigs else 1.0
    if not g.ai.DICE_CARE:
        can_min = mins(me) or any(v <= 4 for _, v in me.gigs)
        return (DRAW + 0.6 if can_min else 0.8) + me.w['min'] * 0.4 + me.w['low'] * 0.3
    need = mins(me) == 0
    gain = g.ai.gig_change(g, me, [(o, x, nv) for o, x in _g_all(me, op) for nv in range(max(1, x[1] - 3), x[1])], None, dry=True,
                           bonus=lambda x, nv: (DRAW if need and nv == 1 and x in me.gigs else 0.0))
    return 0.4 + (DRAW if not need else 0.0) + 0.9 * gain


def _v_three(g, me, op):
    return 0.0 if not me.deck else 1.5 + 1.3 * min(3, 1 + mins(me))


def _lockval(g, me, t):
    """Valor de impedir que t ataque el próximo turno rival (un Gig salvado, dos si pega con 10+)."""
    if t is None or not me.gigs:
        return 0.0
    P = g.power(t, atk=True)
    return 2.6 + 0.15 * P + (3.0 if P >= 10 else 0.0)


def _v_chrome(g, me, op):
    t = _lock_target(g, op)
    v = _lockval(g, me, t)
    if mins(me) and not me.called:
        down = [l for l in me.legs if not l.up and not l.gone]
        if down:
            v += sum(call_value(g, me, l) for l in down) / len(down) + 1.0
    return v


def _v_bond(g, me, op):
    t = pick(g, op.field, lambda t: not t.ready)
    mine = pick(g, me.field, lambda u: u.ready, key=lambda u: -uval(g, u))
    if t is None or mine is None:
        return 0.0
    return kill_value(g, t) - uval(g, mine)


def _v_peace(g, me, op):
    if not me.gigs or len(me.gigs) + len(op.gigs) < 2:
        return 0.2
    if not g.ai.DICE_CARE:
        return DRAW + 0.4 + me.w['pair'] * 0.5
    allg = _g_all(me, op)
    vals = {x[1] for _, x in allg}
    had = pairs(me) > 0
    gain = g.ai.gig_change(g, me, [(o, x, v) for o, x in allg for v in vals if v != x[1] and v <= x[0]], None, dry=True,
                           bonus=lambda x, nv: (DRAW if not had and x in me.gigs and any(y is not x and y[1] == nv for y in me.gigs) else 0.0))
    return 0.4 + (DRAW if had else 0.0) + 0.9 * gain


def _v_relapse(g, me, op):
    t, v = best_spend(g, me, op)
    if t is None:
        t = pick(g, op.field)
        v = 1.0 if t is not None else 0.0
    if t is None:
        return 0.0
    return v + _lockval(g, me, t) + (DRAW if me.gigs and me.cred() % 2 == 0 else 0.0)


def _v_wglt(g, me, op):
    us = sorted([x['pw'] + 1.5 for x in me.trash if x['t'] == 'U' and x['cost'] <= 3], reverse=True)[:2]
    return sum(us)


def _v_reaper(g, me, op):
    if not op.field:
        return 0.0
    ready = sum(1 for t in op.field if t.ready)
    return kill_value(g, pick(g, op.field)) + 1.2 * ready + (2.0 if can_hit(g, me) and ready else 0.0)


def _v_detonate(g, me, op):
    t = _detonate_target(g, op)
    if t is None:
        return 0.0
    x = t[0]
    v = x['pw'] * 1.2 + (2 if x['blocker'] else 0) + (1.5 if x['id'] in ON_SPENT_GEAR else 0) + 0.5
    return v if v >= 2.5 else 0.0


def _v_assembly(g, me, op):
    if not me.gigs:
        return 0.2
    ok = n8(me) or any(v + 4 >= 8 and d >= 8 for d, v in me.gigs)
    return (DRAW + 0.5 if ok else 0.6) + me.w['g8'] * 0.5


def _v_shattered(g, me, op):
    mine = len(me.hand) - 1
    return 1.6 * ((5 - mine) - (5 - len(op.hand)))


def _v_afterparty(g, me, op):
    if not me.gigs:
        return 0.2
    return (DRAW + 0.3) if len(me.gigs) >= 2 else 0.6


def _v_aftermath(g, me, op):
    if not op.field:
        return 0.0
    theirs = min(uval(g, t) for t in op.field) + 2.0
    mine = min([uval(g, t) for t in me.field], default=0.0)
    return theirs - mine


def _v_bootleg(g, me, op):
    vals = [v for _, v in me.gigs]
    mix = any(v % 2 == 0 for v in vals) and any(v % 2 == 1 for v in vals)
    return 1.2 + (2 * DRAW if mix else 0.0)


def _v_floor(g, me, op):
    return 1.6 if g.ai.spare(g, me) else 0.0


PVAL = {
    'floor_it': _v_floor,
    'trust_no_one': _v_trust, 'three_mouths_one_desire': _v_three, 'chrome_reverie': _v_chrome,
    'nocturne_op55_n1': lambda g, me, op: _nocturne_mode(g, me, op)[1],
    'pyramid_song': lambda g, me, op: _pyramid_plan(g, me, op)[0],
    'unlikely_bond': _v_bond, 'les_elemens': lambda g, me, op: kill_value(g, _lowest(g, op)),
    'towerfall': lambda g, me, op: (lambda v: v if v >= 5.0 else 0.0)(_tower_plan(g, me, op)[0]),
    'peace_offering': _v_peace, 'corporate_surveillance': _v_spend(lambda t: t.c['cost'] <= 4),
    'fool_on_the_hill': lambda g, me, op: 2 * DRAW - 0.4 if len(me.deck) >= 2 else 0.0,
    'memory_relapse': _v_relapse, 'we_gotta_live_together': _v_wglt,
    'wild_in_the_streets': lambda g, me, op: kill_value(g, pick(g, op.field, lambda t: not t.ready)),
    'don_t_fear_the_reaper': _v_reaper,
    'all_is_lost': lambda g, me, op: 2.3 if len(me.deck) >= 3 else 0.0,
    'detonate': _v_detonate, 'industrial_assembly': _v_assembly,
    'appetite_for_destruction': lambda g, me, op: GIG - 0.5 if _appetite_ok(g, me, op) and op.gigs else 0.0,
    'bonnie_and_clyde': lambda g, me, op: sum(kill_value(g, t) for t in _bonnie_targets(g, me, op)),
    'over_the_edge': lambda g, me, op: kill_value(g, _edge_target(g, me, op)),
    'gunpoint_diplomacy': lambda g, me, op: _gunpoint_plan(g, me, op)[0],
    'shattered_memories': _v_shattered,
    'carnage_at_the_colosseum': lambda g, me, op: kill_value(g, _carnage_target(g, me, op)),
    'afterparty_at_lizzie_s': _v_afterparty,
    'the_heist': lambda g, me, op: 2.2 if len(me.deck) >= 4 and me.w['gearn'] >= 6 else 0.0,
    'live_with_the_aftermath': _v_aftermath, 'bootleg_black_sapphire_show': _v_bootleg,
}


def pval(g, me, op, c):
    f = PVAL.get(c['id'])
    return f(g, me, op) if f is not None else 0.0
