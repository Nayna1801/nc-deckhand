"""Disparadores de reglas del motor v2 (inicio y fin de turno, dados, gasto, derrota, robo de Gigs...) y efecto de llamar a cada Legend."""
from collections import Counter

from fx2_base import (
    DRAW, HANAKO, JACKIE, JUDY, RIVER, ask_may, best_from, best_spend, by_human, can_hit, choose_mode, do_spend, free_unit_from, gs_cost, human_look,
    mins, n8, pairs, pick, pick_cards, uval,
)


# ----------------------------------------------------------------------------- disparadores de reglas
def start_turn(g, me, op):
    me.yori_def = op.yori_def = False
    if me.leg(HANAKO):
        n = pairs(me)
        if n:
            g.draw(me, n, HANAKO)
    g.ev(me, 'cond_ok' if pairs(me) else 'cond_no', 'pareja')
    g.ev(me, 'cond_ok' if mins(me) else 'cond_no', 'min')
    g.ev(me, 'cond_ok' if me.gigs and op.gigs and me.cred() < op.cred() else 'cond_no', 'menos_cred')
    g.ev(me, 'cond_ok' if n8(me) else 'cond_no', 'gig8')


def on_roll(g, me, d, v):
    if me.leg('kerry_eurodyne_axe_attitude_audience'):
        if v not in (1, d):
            v = g.rng.randint(1, d)
        if v in (1, d):
            g.draw(me, 3 if d == 20 else 1, 'kerry_eurodyne_axe_attitude_audience')
    return v


def jackie_blue(g, me):
    if me.jackie or not me.leg(JACKIE) or not me.gigs:
        return
    me.jackie = True
    ch = g.ai.gig_change(g, me, [(me, x, nv) for x in me.gigs for nv in range(max(1, x[1] - 2), x[1])], JACKIE,
                         bonus=lambda x, nv: DRAW if nv == 1 else 0.0)
    if ch is not None and ch[1] == 1:
        g.draw(me, 1, JACKIE)


def judy_bd(g, me):
    if me.leg(JUDY) and me.field:
        u = pick(g, me.field, lambda u: g.can_attack(u), key=lambda u: g.power(u)) or pick(g, me.field)
        u.tmp += 1
        g.ev(me, 'pump', JUDY)


def _radioport_by_hand(g, p, down):
    """Radioport elegido por una persona: si mira una Legend boca abajo, cuál y, si es Arasaka o tiene Go Solo, si la llama gratis."""
    why = 'Arasaka Emergency Radioport'
    if not ask_may(g, p, 'Mirar una Legend boca abajo (y llamarla gratis si es Arasaka o tiene Go Solo)', why):
        return
    l = human_look(g, p, down, why)
    if (l.c['gosolo'] or 'Arasaka' in l.c['tags']) and ask_may(g, p, f"Llamar gratis a {l.c['name']}", why):
        g.call(p, free=True, pick=l)


def on_spent_gear(g, p, holder):
    """Gear de «cuando esta Unidad o Legend se gasta» (holder = Unidad o Legend)."""
    if not holder.gear:
        return
    for x in list(holder.gear):
        cid = x['id']
        if cid == 'netwatch_netdriver':
            g.draw(p, 1, cid)
        elif cid == 'zetatech_faceplate':
            g.ai.gig_change(g, p, [(o, x2, x2[1] + dv) for o in (p, p.op) for x2 in o.gigs for dv in (-1, 1) if 1 <= x2[1] + dv <= x2[0]], cid)
            if len({v for _, v in p.gigs}) >= 3:
                g.draw(p, 1, cid)
        elif cid == 'tetratronic_rippler':
            if p.deck:
                trash = ask_may(g, p, f"Tirar {p.deck[-1]['name']} a la basura (si no, se queda encima del mazo)", 'Tetratronic Rippler')
                if trash is None:                       # decide el piloto
                    trash = g.ai.keep(g, p, p.deck[-1]) < 3.0
                if trash:
                    p.trash.append(p.deck.pop())
        elif cid == 'arasaka_emergency_radioport' and not p.called:
            down = [l for l in p.legs if not l.up and not l.gone]
            if down and by_human(g, p):
                _radioport_by_hand(g, p, down)
            elif down:
                l = g.rng.choice(down)
                if l.c['gosolo'] or 'Arasaka' in l.c['tags']:
                    g.call(p, free=True, pick=l)
    if p.has('alt_cunningham_mother_of_daemons'):
        g.draw(p, 1, 'alt_cunningham_mother_of_daemons')


def on_spent_unit(g, u):
    if u.c['id'] == 'rita_wheeler_no_stupid_questions' and not u.rita:
        u.rita = True
        if g.draw(u.owner, 1, None):
            g.discard(u.owner, 1)


def jackie_mama_save(g, p, u):
    j = next((x for x in p.field if x.c['id'] == 'jackie_welles_mama_s_favorite' and x is not u), None)
    if j is None or g.avail(p) < 1 or uval(g, u) <= uval(g, j) + 1:
        return False
    g.pay(p, 1)
    g._leave(j)
    p.trash.extend(j.gear)
    g.ev(p, 'save', 'jackie_welles_mama_s_favorite')
    return True


def on_defeated(g, p, u, relic):
    op = p.op
    cid = u.c['id']
    if cid == 'screw_lovelorn_fool':
        x = best_from(g, p, p.trash, lambda x: x['t'] == 'U' and x is not u.c)
        if x is not None:
            p.trash.remove(x)
            p.hand.append(x)
            g.ev(p, 'draw', cid)
    elif cid == 't_bug_amateur_philosopher':
        g.call(p, free=True)
    elif cid == 'caliber_totentanz_s_top_dog':
        d = g.discard(op, 1, cid)
        if d and any(v == d[0]['cost'] for _, v in p.gigs):
            g.discard(op, 1, cid)
    elif cid == 'dexter_deshawn_one_last_chance':
        if p.gigs and op.gigs and abs(p.cred() - op.cred()) >= 10:
            g.draw(p, 2, cid)
    elif cid == 'jackie_welles_ride_or_die_choom':
        g.draw(p, sum(1 for _, v in p.gigs if v % 2 == 1), cid)
    elif cid == 'sasha_yakovleva_won_t_let_you_down':
        g.discard(op, 1, cid)
    if 'Arasaka' in u.c['tags'] and not p.yori_def and p.has('yorinobu_arasaka_steel_dragon'):
        p.yori_def = True
        g.draw(p, 1, 'yorinobu_arasaka_steel_dragon')
    if u.gear and p.leg(RIVER) and len(p.deck) >= 2:
        a, b = p.deck[-1], p.deck[-2]
        worse = a if g.ai.keep(g, p, a) <= g.ai.keep(g, p, b) else b
        p.deck.remove(worse)
        p.trash.append(worse)
        g.ev(p, 'filter', RIVER)
    if relic:
        free_unit_from(g, p, [p.trash], 9, 'the_relic_experimental_biochip')


def on_block(g, df, at, b):
    cid = b.c['id']
    if df.leg('goro_takemura_vengeful_bodyguard') and df.hand and df.deck:
        by_hand = ask_may(g, df, 'Descartar 1 carta para robar 1', 'Goro Takemura')
        if by_hand:                                     # la persona decide si lo hace y qué descarta
            g.discard(df, 1)
            g.draw(df, 1, None)
            g.ev(df, 'filter', 'goro_takemura_vengeful_bodyguard')
        elif by_hand is None:                           # el piloto: descarta su carta menos valiosa si es floja
            x = min(df.hand, key=lambda x: g.ai.keep(g, df, x))
            if g.ai.keep(g, df, x) < 3.2:
                df.hand.remove(x)
                df.trash.append(x)
                g.draw(df, 1, None)
                g.ev(df, 'filter', 'goro_takemura_vengeful_bodyguard')
    if cid == 'la_llorona_ghost_of_the_past':
        g.ai.gig_change(g, df, [(o, x, nv) for o in (df, at) for x in o.gigs for nv in range(x[1] + 1, min(x[0], x[1] + 3) + 1)], cid)
    elif cid == 'augmented_negotiators':
        g.discard(at, 1, cid)


def on_win_fight(g, me, op, u, margin):
    if any(x['id'] == 'satori_sword_of_saburo' for x in u.gear):
        g.draw(me, 1, 'satori_sword_of_saburo')
    if u.c['id'] == 'johnny_silverhand_never_stop_fighting' and not u.won:
        u.ready = True
        g.ev(me, 'ready', u.c['id'])
    u.won = True
    if me.appetite and margin >= 3 and g.cur is me and op.gigs:
        me.appetite = False
        g.steal(me, op, u, 1, src='appetite_for_destruction')


def on_steal(g, me, op, u, gig):
    cid = u.c['id']
    if gig[0] == 6 and me.has('6th_street_recruits'):
        g.ai.gig_change(g, me, [(o, x, nv) for o in (me, op) for x in o.gigs for nv in range(x[1] + 1, min(x[0], x[1] + 6) + 1)], '6th_street_recruits')
    if cid == 'v_roamer_of_the_badlands':
        g.ai.gig_change(g, me, [(me, gig, nv) for nv in range(gig[1] + 1, min(gig[0], gig[1] + 5) + 1)], cid)
    elif cid == 'wraith_marauders':
        t = pick(g, me.field, lambda x: x is not u and not x.ready and g.power(x) == gig[1])
        if t is not None:
            t.ready = True
            g.ev(me, 'ready', cid)
    elif cid == 'maelstrom_goons' and u.gear:
        g.discard(op, 1, cid)
    if u.leg is not None:
        r = 'rogue_amendiares_preem_solo'
        if me.has(r) or me.leg(r):
            if gig[1] % 2 == 0:
                g.draw(me, 1, r)
            else:
                g.discard(op, 1, r)
    if not me.rogueq and gig[1] < g.power(u, atk=True):
        q = next((x for x in me.field if x.c['id'] == 'rogue_amendiares_queen_of_the_afterlife' and x is not u), None)
        if q is not None:
            me.rogueq = True
            g.ready_eddies(me, 2)
            g.ev(me, 'eddie', q.c['id'], 2)


def on_first_steal(g, me, op, u):
    if not u.gor and any(x['id'] == 'gorilla_arms' for x in u.gear):
        u.gor = True
        mine = {v for _, v in me.gigs}
        cands = [x for x in g.stealable(me, op, u) if x[1] not in mine]
        if cands:
            x = g.ai.pick_steal(g, me, op, cands)
            op.gigs.remove(x)
            me.gigs.append(x)
            g.ev(me, 'steal', 'gorilla_arms')
            g.check_overtime()
    if me.leg('evelyn_parker_beautiful_enigma') and (u.c['tags'] & {'Corpo', 'Ganger'}):
        g.ready_eddies(me, 1)
        g.ev(me, 'eddie', 'evelyn_parker_beautiful_enigma')


def alt_mod_prevent(g, op, gig):
    if not op.has('alt_cunningham_mother_of_daemons'):
        return False
    c = [x for x in op.hand if x['cost'] == gig[1] and g.ai.keep(g, op, x) < 5.0]
    if not c:
        return False
    x = min(c, key=lambda x: g.ai.keep(g, op, x))
    op.hand.remove(x)
    op.trash.append(x)
    g.ev(op, 'save', 'alt_cunningham_mother_of_daemons')
    return True


def end_turn(g, me, op):
    for u in list(me.field) + list(op.field):
        if u.psy and u.acted:
            u.psy = False
            g.defeat(u, 'cyberpsychosis', by=None)
        u.psy = False
    for u in list(me.field):
        cid = u.c['id']
        if any(x['id'] == 'sandevistan' for x in u.gear) and not u.ready:
            u.ready = True
            g.ev(me, 'ready', 'sandevistan')
        if cid == 'modded_kusanagi':
            g.bounce(u)
        elif cid == 'modded_muramasa':
            if not u.ready and me.cred() < op.cred():
                u.ready = True
                g.ev(me, 'ready', cid)
        elif cid == 'delamain_cab':
            if u.stole:
                g.ready_eddies(me, 1)
        elif cid == 'v_roamer_of_the_badlands':
            if n8(me) >= 2:
                g.draw(me, 1, cid)
        elif cid == 'maxtac_squadron':
            if not u.ready:
                l = next((l for l in me.legs if l.up and not l.gone and not l.ready), None)
                if l is not None:
                    l.ready = True
        elif cid == 'misty_olszewski_mender_of_broken_spirits' and me.deck:
            kinds = Counter(x['t'] for x in me.deck)
            guess = kinds.most_common(1)[0][0]
            top = me.deck.pop()
            if top['t'] == guess:
                me.hand.append(top)
                me.drawn.add(top['id'])
                g.ev(me, 'draw', cid)
                g.ready_eddies(me, 1)
            else:
                me.trash.append(top)
        if any(x['id'] == 'dying_night_v_s_pistol' for x in u.gear) and u.c['name'].startswith('V:'):
            g.ready_eddies(me, 2)
    if me.has('saul_bright_stormrider'):
        sp = sorted([u for u in me.field if not u.ready], key=lambda u: -g.power(u))[:3]
        for u in sp:
            u.ready = True
        if sp:
            g.ev(me, 'ready', 'saul_bright_stormrider', len(sp))
    if me.leg('panam_palmer_nomad_cavalry'):
        eq = [u for u in me.field if u.gear]
        if len(eq) + sum(1 for l in me.legs if l.gear and not l.gone) >= 5:
            for u in eq:
                u.ready = True
            g.ev(me, 'ready', 'panam_palmer_nomad_cavalry', len(eq))


# ----------------------------------------------------------------------------- Legends: efecto al llamarlas
def on_call(g, me, op, l):
    cid = l.c['id']
    why = f"{l.c['name'].split(':')[0]} (Call)"
    if cid == 'lucyna_kushinada_fresh_beginnings':
        g.draw(me, 2 if mins(me) >= 2 else 1, cid)
    elif cid == 'wakako_okada_peace_and_harmony':
        if choose_mode(g, me, [('debuff', 'Dar -2 de poder a una Unidad rival este turno'), ('draw', 'Robar 1 carta')] if op.field else [], why) == 'debuff':
            pick(g, op.field).tmp -= 2
            g.ev(me, 'debuff', cid)
        else:
            g.draw(me, 1, cid)
    elif cid == 'padre_man_of_the_cross':
        by_hand = choose_mode(g, me, [('spend', 'Gastar una Unidad rival'), ('draw', 'Robar 1 carta')] if any(t.ready for t in op.field) else [], why)
        t, v = best_spend(g, me, op)
        if by_hand == 'spend':
            do_spend(g, me, pick(g, op.field, lambda t: t.ready), cid)
        elif by_hand == 'draw':
            g.draw(me, 1, cid)
        elif t is not None and v > 3.0:
            do_spend(g, me, t, cid)
        else:
            g.draw(me, 1, cid)
    elif cid == 'dexter_deshawn_off_the_grid':
        by_hand = choose_mode(g, me, [('pump', 'Dar +2 de poder a una Unidad tuya este turno'), ('draw', 'Robar 1 carta')] if me.field else [], why)
        if by_hand == 'pump':
            pick(g, me.field).tmp += 2
            g.ev(me, 'pump', cid)
        elif by_hand == 'draw':
            g.draw(me, 1, cid)
        else:
            u = pick(g, me.field, lambda u: g.can_attack(u) and 8 <= g.power(u, atk=True) < 10)
            if u is not None and op.gigs:
                u.tmp += 2
                g.ev(me, 'pump', cid)
            else:
                g.draw(me, 1, cid)
    elif cid == 'muamar_reyes_el_capitan':
        by_hand = choose_mode(g, me, [('guard', 'Una Unidad tuya no puede ser derrotada en una pelea este turno'), ('draw', 'Robar 1 carta')] if me.field else [], why)
        if by_hand == 'guard':
            pick(g, me.field).nodef = True
            g.ev(me, 'pump', cid)
            return
        if by_hand == 'draw':
            g.draw(me, 1, cid)
            return
        u = None
        for x in can_hit(g, me):
            P = g.power(x, atk=True)
            if P > 0 and any((not t.ready) and g.power(t, vs=x) == P and uval(g, t) >= 5.0 for t in op.field):
                u = x
        if u is not None:
            u.nodef = True
            g.ev(me, 'pump', cid)
        else:
            g.draw(me, 1, cid)
    elif cid == 'viktor_vektor_sit_down_and_relax':
        top = [me.deck.pop() for _ in range(min(5, len(me.deck)))]
        cands = [x for x in top if x['t'] == 'G' and x['cost'] <= 2]
        if by_human(g, me) and len(cands) > 2:      # la persona elige cuáles de los Gears se queda
            take = pick_cards(g, cands, 2, why='Viktor Vektor')
        else:
            take = sorted(cands, key=lambda x: -x['pw'])[:2]
        for x in take:
            top.remove(x)
            me.hand.append(x)
            me.drawn.add(x['id'])
        if take:
            g.ev(me, 'draw', cid, len(take))
        g.to_bottom(me, top)
    elif cid == 'dum_dum_maelstrom_triggerman':
        gears = [(x, h) for h in list(me.field) + [l for l in me.legs if not l.gone] for x in h.gear]
        mode = choose_mode(g, me, [('gear', 'Derrotar un Gear tuyo y robar 2 cartas'), ('draw', 'Robar 1 carta')] if gears else [], 'Dum Dum')
        if mode == 'gear':                           # «puedes derrotar un Gear tuyo: si lo haces, roba 2; si no, 1»
            x = pick_cards(g, [gx for gx, _ in gears], 1, why='Dum Dum')[0]
            h = next(h for gx, h in gears if gx is x)
            h.gear.remove(x)
            me.trash.append(x)
            g.draw(me, 2, cid)
        else:
            g.draw(me, 1, cid)
    elif cid == 'v_streetkid':
        g.mill(me, 3)
        x = best_from(g, me, me.trash, lambda x: x['bd'])
        if x is not None:
            me.trash.remove(x)
            me.hand.append(x)
            g.ev(me, 'draw', cid)


def call_value(g, me, l):
    """Valor esperado de dar la vuelta a esa Legend (efecto de Call + lo que desbloquea)."""
    cid = l.c['id']
    if l.c['gosolo']:
        v = 3.5 if gs_cost(g, me, l) <= me.E + 3 else 1.5
        return v + (2.0 if cid == 'v_streetkid' and me.w['bd'] else 0.0)
    return me.callv.get(cid, 1.0)
