"""Unidades y Gear en el motor v2: efecto al jugarlas y al atacar, y cuánto valen."""
from fx2_base import (
    DRAW, PEPE_READY, ask_may, best_from, best_spend, by_human, can_hit, do_spend, free_unit_from, kill_value, n8, pairs, pick,
    human_look, pick_cards, uval,
)
from fx2_programs import pval


# ----------------------------------------------------------------------------- Unidades: al jugarlas
def _kill_le(n, by_cost=False):
    def f(g, me, op, u):
        t = pick(g, op.field, (lambda t: t.c['cost'] <= n) if by_cost else (lambda t: g.power(t) <= n))
        if t is not None:
            g.defeat(t, u.c['id'], by=me)
    return f


def _p_royce(g, me, op, u):
    n = 3 if me.cred() > op.cred() else 2
    _kill_le(n)(g, me, op, u)


def _p_minotaur(g, me, op, u):
    if me.gigs and me.cred() > op.cred():
        _kill_le(5)(g, me, op, u)


def _p_yorinobu(g, me, op, u):
    free_unit_from(g, me, [me.hand, me.trash], 4, u.c['id'], atku=True)


def _p_delamain(g, me, op, u):
    g.draw(me, 2, u.c['id'])


def _p_mox(g, me, op, u):
    t = pick(g, op.field, lambda t: t.ready and not t.c['noatk'])
    if t is not None:
        t.must = True


def _p_hacked(g, me, op, u):
    got = g.mill(me, 3)
    x = best_from(g, me, got, lambda x: x['t'] == 'P')
    if x is not None:
        me.trash.remove(x)
        me.hand.append(x)
        g.ev(me, 'draw', u.c['id'])


def _p_westbrook(g, me, op, u):
    me.westbrook = g.turn + 1


def _p_fang(g, me, op, u):
    me.fang = g.turn + 1


def _p_lizzy(g, me, op, u):
    best = None
    for z in (me.trash, me.hand):
        for x in z:
            if x['t'] == 'P' and x['cost'] <= 3 and not x['quick']:
                v = pval(g, me, op, x)
                if best is None or v > best[0]:
                    best = (v, x, z)
    if best is not None and best[0] > 1.0:
        _, x, z = best
        z.remove(x)
        g.ev(me, 'free', u.c['id'])
        g.play_card(me, x, pay=False, bottom_after=True)


def _p_maman(g, me, op, u):
    if by_human(g, me):
        progs = [x for x in me.hand if x['t'] == 'P']
        if len(progs) >= 2 and any(not t.gear for t in op.field) and ask_may(
                g, me, 'Descartar 2 Programas para mandar al fondo del mazo una Unidad rival sin equipo', 'Maman Brigitte'):
            t = pick(g, op.field, lambda t: not t.gear)
            for x in pick_cards(g, progs, 2):
                me.hand.remove(x)
                me.trash.append(x)
            g.bottom(t, u.c['id'], by=me)
        return
    progs = sorted([x for x in me.hand if x['t'] == 'P'], key=lambda x: g.ai.keep(g, me, x))
    t = pick(g, op.field, lambda t: not t.gear)
    if t is not None and len(progs) >= 2 and uval(g, t) >= 5.0:
        for x in progs[:2]:
            me.hand.remove(x)
            me.trash.append(x)
        g.bottom(t, u.c['id'], by=me)


def _placide(g, me, op, u):
    progs = [x for x in me.hand if x['t'] == 'P']
    if by_human(g, me):
        if progs and op.field and ask_may(g, me, 'Descartar 1 Programa para mandar al fondo del mazo una Unidad rival', 'Placide'):
            t = pick(g, op.field)
            x = pick_cards(g, progs, 1)[0]
            me.hand.remove(x)
            me.trash.append(x)
            g.bottom(t, u.c['id'], by=me)
        return
    t = pick(g, op.field)
    if t is not None and progs and uval(g, t) >= 4.0:
        x = min(progs, key=lambda x: g.ai.keep(g, me, x))
        me.hand.remove(x)
        me.trash.append(x)
        g.bottom(t, u.c['id'], by=me)


def _p_whisper(g, me, op, u):
    g.call(me, free=True)


def _p_field_op(g, me, op, u):
    if me.gigs and me.cred() % 2 == 0:
        g.draw(me, 1, u.c['id'])


def _p_racer(g, me, op, u):
    t = pick(g, me.field, lambda x: x is not u and x.lag and x.ready and x.c['cost'] <= 5 and not x.c['noatk'], key=lambda x: g.power(x))
    if t is not None:
        t.adr = True


def _p_pacifica(g, me, op, u):
    if me.gigs and me.cred() % 2 == 0:
        t = pick(g, op.field, lambda t: not t.ready) or pick(g, op.field)
        if t is not None:
            t.noready = True
            g.ev(me, 'spend', u.c['id'])


def _p_av(g, me, op, u):
    g.ai.gig_swap(g, me, op, u.c['id'])


def _p_sandayu(g, me, op, u):
    for _ in range(pairs(me)):
        if by_human(g, me):
            t = pick(g, op.field, lambda t: t.ready)
        else:
            t, _v = best_spend(g, me, op)
        if t is None:
            break
        do_spend(g, me, t, u.c['id'])


def _p_jonin(g, me, op, u):
    t = pick(g, me.field, lambda x: x is not u and g.can_attack(x), key=lambda x: (8 <= g.power(x, atk=True) < 10, g.power(x)))
    if t is not None:
        t.tmp += 2
        g.ev(me, 'pump', u.c['id'])


def _p_dexter(g, me, op, u):
    g.ai.gig_change(g, me, [(o, x, x[1] + dv) for o in (me, op) for x in o.gigs for dv in (-1, 1) if 1 <= x[1] + dv <= x[0]], u.c['id'])


def _p_viktor(g, me, op, u):
    others = [x for x in me.field if x is not u]
    x = best_from(g, me, me.trash, lambda x: x['t'] == 'G' and x['cost'] <= 2 and 'Cyberware' in x['tags'])
    if x is not None and others:
        me.trash.remove(x)
        g.ev(me, 'free', u.c['id'])
        g.play_card(me, x, pay=False, target=g.ai.gear_target(g, me, x, among=others))


def _p_maton(g, me, op, u):
    if by_human(g, me):
        gears = [(x, h) for h in list(me.field) + [l for l in me.legs if not l.gone] for x in h.gear]
        if gears and any(t.c['cost'] <= 3 for t in op.field) and ask_may(
                g, me, 'Derrotar un Gear tuyo para derrotar una Unidad rival de coste 3 o menos', 'Gilded Matón'):
            t = pick(g, op.field, lambda t: t.c['cost'] <= 3)
            x = pick_cards(g, [gx for gx, _ in gears], 1)[0]
            h = next(h for gx, h in gears if gx is x)
            h.gear.remove(x)
            me.trash.append(x)
            g.defeat(t, u.c['id'], by=me)
        return
    t = pick(g, op.field, lambda t: t.c['cost'] <= 3)
    if t is None or uval(g, t) < 4.0:
        return
    gears = [(x, h) for h in list(me.field) + [l for l in me.legs if not l.gone] for x in h.gear]
    if not gears:
        return
    x, h = min(gears, key=lambda t2: t2[0]['pw'] + t2[0]['cost'])
    if x['pw'] + x['cost'] > 4:
        return
    h.gear.remove(x)
    me.trash.append(x)
    g.defeat(t, u.c['id'], by=me)


def _p_hanako_unit(g, me, op, u):
    vals = {v for _, v in me.gigs}
    top = [me.deck.pop() for _ in range(min(4, len(me.deck)))]
    take = [x for x in top if x['cost'] in vals]
    for x in take:
        top.remove(x)
        me.hand.append(x)
        me.drawn.add(x['id'])
    if take:
        g.ev(me, 'draw', u.c['id'], len(take))
    g.to_bottom(me, top)


def _p_malfini(g, me, op, u):
    u.ready = False
    if by_human(g, me):
        t = pick(g, op.field, lambda t: t.ready)
    else:
        t, _ = best_spend(g, me, op)
    if t is not None:
        do_spend(g, me, t, u.c['id'])


def _p_heywood(g, me, op, u):
    gears = [(x, h) for h in list(op.field) + [l for l in op.legs if not l.gone] for x in h.gear]
    if gears and by_human(g, me):
        if ask_may(g, me, 'Derrotar un Gear del rival', 'Heywood Ripperdoc'):
            x = pick_cards(g, [gx for gx, _ in gears], 1)[0]
            h = next(h for gx, h in gears if gx is x)
            h.gear.remove(x)
            op.trash.append(x)
            g.ev(me, 'gearkill', u.c['id'])
            if any(v == x['cost'] for _, v in me.gigs):
                g.draw(me, 1, u.c['id'])
    elif gears:
        x, h = max(gears, key=lambda t2: t2[0]['pw'] * 1.2 + t2[0]['cost'])
        h.gear.remove(x)
        op.trash.append(x)
        g.ev(me, 'gearkill', u.c['id'])
        if any(v == x['cost'] for _, v in me.gigs):
            g.draw(me, 1, u.c['id'])


def _p_smasher_mom(g, me, op, u):
    for t in list(op.field):
        g.defeat(t, u.c['id'], by=me)
    for t in list(me.field):
        if t is not u:
            g.defeat(t, u.c['id'], by=None)


def _p_adam(g, me, op, u):
    t = pick(g, op.field)
    if t is not None:
        g.defeat(t, u.c['id'], by=me)


ONPLAY = {
    'royce_don_t_call_me_simon': _p_royce, 'minotaur': _p_minotaur, 'yorinobu_arasaka_steel_dragon': _p_yorinobu,
    'delamain_rideshare_ai': _p_delamain, 'mox_inciters': _p_mox, 'hacked_corpo': _p_hacked, 'westbrook_netrunner': _p_westbrook,
    'chrome_fang': _p_fang, 'lizzy_wizzy_delicate_weapon': _p_lizzy, 'maman_brigitte_spirit_of_death': _p_maman,
    'placide_voodoo_sentinel': _placide, 'tyger_s_whisper': _p_whisper, 'field_operator': _p_field_op,
    'valentino_street_racer': _p_racer, 'pacifica_netrunner': _p_pacifica, 'maxtac_av': _p_av,
    'sandayu_oda_hanako_s_guardian': _p_sandayu, 'japantown_jonin': _p_jonin, 'dexter_deshawn_one_last_chance': _p_dexter,
    'viktor_vektor_you_might_feel_a_little_pinch': _p_viktor, 'gilded_maton': _p_maton, 'hanako_arasaka_in_a_gilded_cage': _p_hanako_unit,
    'offduty_malfini': _p_malfini, 'heywood_ripperdoc': _p_heywood, 'adam_smasher_metal_over_meat': _p_smasher_mom,
    'adam_smasher_ender_of_legends': _p_adam, 'caliber_totentanz_s_top_dog': _kill_le(2, by_cost=True),
}


def on_play_unit(g, me, op, u):
    f = ONPLAY.get(u.c['id'])
    if f is not None:
        f(g, me, op, u)


# ----------------------------------------------------------------------------- Unidades: al atacar
def on_attack(g, me, op, u, tgt):
    cid = u.c['id']
    if 'Arasaka' in u.c['tags'] and not me.yori_atk and me.leg('yorinobu_arasaka_embracing_destruction'):
        me.yori_atk = True
        g.draw(me, 1, 'yorinobu_arasaka_embracing_destruction')
        if me.cred() < 20:
            g.discard(me, 1)
    for x in u.gear:
        if x['id'] == 'kiroshi_optics':
            down = [l for l in me.legs if not l.up and not l.gone and not l.known]
            if down and by_human(g, me):
                human_look(g, me, down, 'Kiroshi Optics')
            elif down:
                g.rng.choice(down).known = True
        if x['id'] == 'dying_night_v_s_pistol':
            g.ai.gig_change(g, me, [(o, y, nv) for o in (me, op) for y in o.gigs for nv in range(max(1, y[1] - 2), y[1])], x['id'])
    if cid == 'goro_takemura_losing_his_way':
        if all(l.up for l in me.legs):
            u.tmp += 5
            g.ev(me, 'pump', cid)
    elif cid == 'pepe_najarro_working_doubles':
        if pairs(me) and PEPE_READY:
            n = 0
            for l in me.legs:
                if n < 2 and not l.ready and not l.gone and 'Merc' in l.c['tags']:
                    l.ready = True
                    n += 1
            if n:
                g.ev(me, 'ready', cid, n)
    elif cid == 'swordwise_huscle':
        if g.power(u, atk=True) >= 5:
            g.draw(me, 1, cid)
    elif cid == 'el_sombreron_la_venganza_lenta':
        mx = max([v for d, v in me.gigs if v == d], default=0)
        P = g.power(u, atk=True)
        if mx and g.avail(me) >= 2 + me.reserve and (P < 10 <= P + mx or tgt is not None):
            g.pay(me, 2)
            u.tmp += mx
            g.ev(me, 'pump', cid)
    elif cid == 'jackie_welles_ride_or_die_choom':
        n = sum(1 for _, v in me.gigs if v % 2 == 0)
        if n:
            u.tmp += 2 * n
            g.ev(me, 'pump', cid)
    elif cid == 'dexter_deshawn_one_last_chance':
        _p_dexter(g, me, op, u)
    elif cid == 'placide_voodoo_sentinel':
        _placide(g, me, op, u)
    elif cid == 'evelyn_parker_scheming_siren':
        g.draw(me, 1, cid)
        if me.cred() > op.cred():
            g.discard(me, 1)
    elif cid == 'sketchy_ripper':
        top = [me.deck.pop() for _ in range(min(3, len(me.deck)))]
        x = best_from(g, me, top, lambda x: x['t'] == 'G')
        if x is not None:
            top.remove(x)
            me.hand.append(x)
            me.drawn.add(x['id'])
            g.ev(me, 'draw', cid)
        g.to_bottom(me, top)
    elif cid == 'sasha_yakovleva_won_t_let_you_down':
        if me.deck:
            x = me.deck.pop()
            me.hand.append(x)
            me.drawn.add(x['id'])
            u.tmp += x['cost']
            g.ev(me, 'draw', cid)
    elif cid == 'panam_palmer_strength_through_family':
        n = sum(1 for l in me.legs if l.up and not l.gone)
        if n >= 2 and me.hand:
            g.discard(me, 1)
            g.draw(me, n, cid)


# ----------------------------------------------------------------------------- Unidades y Gear: valor
def _ub_kill(n, by_cost=False):
    return lambda g, me, op: kill_value(g, pick(g, op.field, (lambda t: t.c['cost'] <= n) if by_cost else (lambda t: g.power(t) <= n)))


def _ub_maman(g, me, op):
    t = pick(g, op.field, lambda t: not t.gear)
    return kill_value(g, t) - 2.5 if t is not None and uval(g, t) >= 5.0 and sum(1 for x in me.hand if x['t'] == 'P') >= 2 else 0.0


def _ub_placide(g, me, op):
    t = pick(g, op.field)
    return kill_value(g, t) - 1.2 if t is not None and any(x['t'] == 'P' for x in me.hand) else 0.0


def _ub_lizzy(g, me, op):
    best = 0.0
    for z in (me.trash, me.hand):
        for x in z:
            if x['t'] == 'P' and x['cost'] <= 3 and not x['quick']:
                best = max(best, pval(g, me, op, x))
    return best


def _ub_yori(g, me, op):
    c = [x['pw'] + 1.5 for z in (me.hand, me.trash) for x in z if x['t'] == 'U' and x['cost'] <= 4]
    return max(c, default=0.0)


def _ub_racer(g, me, op):
    if not op.gigs:
        return 0.0
    c = [x for x in me.hand if x['t'] == 'U' and x['cost'] <= 5 and x['pw'] > 0] + [u.c for u in me.field if u.lag and u.c['cost'] <= 5]
    return 2.5 if c else 0.0


def _ub_sandayu(g, me, op):
    n = min(pairs(me), sum(1 for t in op.field if t.ready))
    return 2.2 * n + (2.0 if any(not t.ready for t in op.field) or n else 0.0)


UBON = {
    'royce_don_t_call_me_simon': lambda g, me, op: _ub_kill(3 if me.cred() > op.cred() else 2)(g, me, op),
    'minotaur': lambda g, me, op: _ub_kill(5)(g, me, op) if me.gigs and me.cred() > op.cred() else 0.0,
    'caliber_totentanz_s_top_dog': _ub_kill(2, by_cost=True),
    'adam_smasher_ender_of_legends': lambda g, me, op: kill_value(g, pick(g, op.field)),
    'adam_smasher_metal_over_meat': lambda g, me, op: sum(kill_value(g, t) for t in op.field) - sum(uval(g, t) for t in me.field),
    'yorinobu_arasaka_steel_dragon': _ub_yori, 'delamain_rideshare_ai': lambda g, me, op: 2 * DRAW,
    'mox_inciters': lambda g, me, op: 1.0 if op.field else 0.0, 'hacked_corpo': lambda g, me, op: 1.4,
    'westbrook_netrunner': lambda g, me, op: 1.5 if any(l.c['gosolo'] and not l.gone for l in op.legs) else 0.0,
    'chrome_fang': lambda g, me, op: 1.5 if op.field else 0.5,
    'lizzy_wizzy_delicate_weapon': _ub_lizzy, 'maman_brigitte_spirit_of_death': _ub_maman, 'placide_voodoo_sentinel': _ub_placide,
    'tyger_s_whisper': lambda g, me, op: 0.0 if me.called else g.ai.call_avg(g, me) + 0.8,
    'field_operator': lambda g, me, op: DRAW if me.gigs and me.cred() % 2 == 0 else 0.0,
    'valentino_street_racer': _ub_racer,
    'pacifica_netrunner': lambda g, me, op: 2.5 if me.gigs and me.cred() % 2 == 0 and any(not t.ready for t in op.field) else 0.0,
    'maxtac_av': lambda g, me, op: 0.8, 'sandayu_oda_hanako_s_guardian': _ub_sandayu,
    'japantown_jonin': lambda g, me, op: 3.0 if any(8 <= g.power(u, atk=True) < 10 for u in can_hit(g, me)) and op.gigs else 0.6,
    'dexter_deshawn_one_last_chance': lambda g, me, op: 0.6,
    'viktor_vektor_you_might_feel_a_little_pinch': lambda g, me, op: 2.5 if me.field and any(x['t'] == 'G' and x['cost'] <= 2 and 'Cyberware' in x['tags'] for x in me.trash) else 0.0,
    'gilded_maton': lambda g, me, op: 0.0,
    'hanako_arasaka_in_a_gilded_cage': lambda g, me, op: 2.2 if me.gigs else 0.0,
    'offduty_malfini': lambda g, me, op: best_spend(g, me, op)[1] - 1.0,
    'heywood_ripperdoc': lambda g, me, op: 3.0 if any(h.gear for h in list(op.field) + op.legs) else 0.0,
    'evelyn_parker_scheming_siren': lambda g, me, op: 2.2, 'sketchy_ripper': lambda g, me, op: 1.8 if me.w['gearn'] >= 6 else 0.3,
    'misty_olszewski_mender_of_broken_spirits': lambda g, me, op: 2.8,
    'judy_alvarez_nothing_to_doubt': lambda g, me, op: 3.0, 'kerry_eurodyne_the_last_rockerboy': lambda g, me, op: 1.5 if n8(me) else 0.3,
    'jacked_in_voodoo_boy': lambda g, me, op: -0.8, 'ruthless_lowlife': lambda g, me, op: -1.5,
    'maxtac_suppression_team': lambda g, me, op: 1.5, 'saul_bright_stormrider': lambda g, me, op: 3.0 + len(me.field),
    'modded_kusanagi': lambda g, me, op: -4.0 if not op.gigs else -1.0,
    'alt_cunningham_mother_of_daemons': lambda g, me, op: 2.0, 'rogue_amendiares_queen_of_the_afterlife': lambda g, me, op: 1.5,
    'goro_takemura_losing_his_way': lambda g, me, op: 2.5 if all(l.up for l in me.legs) else 0.3,
    'panam_palmer_strength_through_family': lambda g, me, op: 1.5, 'wraith_marauders': lambda g, me, op: 0.3,
    'jackie_welles_ride_or_die_choom': lambda g, me, op: 1.0 * sum(1 for _, v in me.gigs if v % 2 == 0),
    'screw_lovelorn_fool': lambda g, me, op: 1.0, 't_bug_amateur_philosopher': lambda g, me, op: 0.8,
    'johnny_silverhand_never_stop_fighting': lambda g, me, op: 1.5, 'meredith_stout_stone_cold_corpo': lambda g, me, op: 0.5,
    'la_llorona_ghost_of_the_past': lambda g, me, op: 0.4, 'augmented_negotiators': lambda g, me, op: 0.8,
    'maelstrom_zealots': lambda g, me, op: 2.5, 'rita_wheeler_no_stupid_questions': lambda g, me, op: 0.6,
    'nadia_fighting_through_grief': lambda g, me, op: 3.0 if len(op.gigs) > len(me.gigs) else 0.0,
    '6th_street_recruits': lambda g, me, op: 0.3, 'swordwise_huscle': lambda g, me, op: 0.5,
    'maxtac_squadron': lambda g, me, op: 0.4, 'el_sombreron_la_venganza_lenta': lambda g, me, op: 0.5,
    'v_roamer_of_the_badlands': lambda g, me, op: 0.6,
}


def unit_value(g, me, op, c):
    p = c['pw']
    v = (p + 1.5) if p > 0 else 0.3
    if c['blocker']:
        v += 1.5 + (1.0 if any(g.power(t) > 0 for t in op.field) else 0.0)
    if c['adr'] and op.gigs and not op.has('maxtac_suppression_team'):
        v += 3.0
    f = UBON.get(c['id'])
    if f is not None:
        v += f(g, me, op)
    return v


GBON = {
    'tetratronic_rippler': 0.6, 'dying_night_v_s_pistol': 0.8, 'netwatch_netdriver': 2.0, 'riot_shield': 1.5, 'sandevistan': 2.5,
    'overwatch_panam_s_gift': 3.0, 'arasaka_emergency_radioport': 1.0, 'satori_sword_of_saburo': 0.8, 'deadman_transmitter': 2.5,
    'kiroshi_optics': 0.2, 'mandibular_upgrade': 2.0, 'adrenaline_converter': 0.8, 'zetatech_faceplate': 1.8, 'gorilla_arms': 2.5,
    'the_relic_experimental_biochip': 1.5,
}


def gear_value(g, me, op, c):
    tgt = g.ai.gear_target(g, me, c)
    if tgt is None:
        return 0.0
    v = c['pw'] * 1.1 + GBON.get(c['id'], 0.0)
    if hasattr(tgt, 'owner'):
        P = g.power(tgt, atk=True)
        if P < 10 <= P + c['pw'] and g.can_attack(tgt) and op.gigs:
            v += 4.0
        if c['id'] == 'adrenaline_converter' and tgt.lag and len(op.gigs) >= len(me.gigs) + 2:
            v += 4.0
    else:
        v -= c['pw'] * 0.8       # en una Legend del área el poder no cuenta (salvo Go Solo)
        if tgt.c['gosolo']:
            v += c['pw'] * 1.0 + (2.0 if tgt.c['id'] == 'royce_psycho_on_the_edge' else 0.0)
    return v


def value(g, me, op, c):
    t = c['t']
    if t == 'U':
        return unit_value(g, me, op, c)
    if t == 'G':
        return gear_value(g, me, op, c)
    return pval(g, me, op, c)
