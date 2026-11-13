"""Defensa y refuerzo de ataque para la persona que juega en el Laboratorio (human.py).

Las mismas jugadas rápidas y habilidades que usa el piloto (ai2_react.py / ai2_turn.attacker_pump), pero cada una se ofrece como
opción y decide la persona. Los efectos son los mismos que escribió el piloto: si cambia uno allí, cambia aquí.
"""
from collections import Counter

import fx2 as fx
from fx2 import RIVER
from ai2_turn import _quick

OVERWATCH = 'overwatch_panam_s_gift'
GORO = 'goro_takemura_vengeful_bodyguard'
DUMDUM = 'dum_dum_maelstrom_triggerman'
ROGUE = 'rogue_amendiares_queen_of_the_afterlife'
STEAL_BONUS_TAGS = ('AI', 'Drone', 'Vehicle')


def unit_ref(u):
    """Dónde está una Unidad en el tablero: la interfaz la resalta y deja elegirla con un clic."""
    return dict(z='f', side=u.owner.pi, i=u.owner.field.index(u))


def unit_label(g, u, me):
    side = 'tuya' if u.owner is me else 'rival'
    state = '' if u.ready else ', gastada'
    return f"{u.c['name']} ({side}, poder {g.power(u)}{state})"


def _faceup_legends(p):
    return sum(1 for l in p.legs if l.up and not l.gone)


def _unblockable(df, at, a):
    return a.c['id'] == 'mt0d12_flathead' and at.cred() < df.cred()


def _blockers(g, df, at, a, tgt):
    if _unblockable(df, at, a):
        return []
    return [b for b in df.field if b.ready and b is not tgt and g.is_blocker(b)]


def defense_tricks(g, df, at, a, tgt, fighter):
    """Jugadas rápidas y habilidades de defensa posibles ahora: [(etiqueta, función, termina_el_ataque)]."""
    out = []
    ids = Counter(c['id'] for c in df.hand)
    money = g.avail(df)
    d = fighter
    k = _faceup_legends(df)

    def add(label, fn, ends=False):
        out.append((label, fn, ends))

    ow = next((u for u in df.field if u.ready and u is not tgt and any(x['id'] == OVERWATCH for x in u.gear)), None)
    if ow is not None and money >= 1:
        seen = set()
        for x in df.hand:
            if x['cost'] >= a.c['cost'] and x['id'] not in seen:
                seen.add(x['id'])

                def f_ow(x=x):
                    df.hand.remove(x)
                    df.trash.append(x)
                    g.pay(df, 1)
                    g.spend_unit(ow)
                    g.ev(df, 'react', OVERWATCH)
                    g.defeat(a, OVERWATCH, by=df)
                add(f"Overwatch (1 €): descartar {x['name']} y derrotar a {a.c['name']}", f_ow, ends=True)
    if ids['synapse_burnout'] and money >= 1 and d is not None and k:
        def f_syn():
            _quick(g, df, 'synapse_burnout', 1)
            d.tmp += k
        add(f"Synapse Burnout (1 €): +{k} de poder a {d.c['name']}", f_syn)
    if ids['floor_it'] and money >= 1:
        def f_floor():
            _quick(g, df, 'floor_it', 1)
            a.tmp -= 1
            g.draw(df, 1, 'floor_it')
        add(f"Floor It (1 €): -1 de poder a {a.c['name']} y robas 1 carta", f_floor)
    weak_gear = {x['id']: x for x in a.gear if 0 < x['pw'] <= 2} if ids['detonate'] and money >= 1 else {}
    for x in weak_gear.values():
        def f_det(x=x):
            _quick(g, df, 'detonate', 1)
            a.gear.remove(x)
            a.owner.trash.append(x)
            g.ev(df, 'gearkill', 'detonate')
        add(f"Detonate (1 €): destruir {x['name']} del atacante", f_det)
    if ids['take_control'] and money >= 2 and tgt is None:
        def f_tc():
            _quick(g, df, 'take_control', 2)
            a.tc += 1
            if any(t in a.c['tags'] for t in STEAL_BONUS_TAGS):
                g.draw(df, 1, 'take_control')
            g.ev(df, 'save', 'take_control')
        add(f"Take Control (2 €): {a.c['name']} roba 1 Gig menos", f_tc)
    if ids['safety_override'] and money >= 2 and d is not None:
        def f_so():
            _quick(g, df, 'safety_override', 2)
            d.safety = True
        add(f"Safety Override (2 €): si {d.c['name']} pierde la pelea, arrastra al atacante", f_so)
    if ids['reboot_optics'] and money >= 2 and d is not None:
        def f_ro():
            _quick(g, df, 'reboot_optics', 2)
            a.reboot_vs = True                                  # en la pelea contra `a`, la Unidad defensora no muere
        add(f"Reboot Optics (2 €): {d.c['name']} no puede ser derrotada en esta pelea", f_ro)
    dd = df.leg(DUMDUM)
    if dd is not None and dd.ready and d is not None and d.gear and g.avail(df, keep=(dd,)) >= 1:
        def f_dd():
            g.pay(df, 1, keep=(dd,))
            g.spend_leg(df, dd)
            d.tmp += len(d.gear)
            g.ev(df, 'react', DUMDUM)
        add(f"Dum Dum (1 €): +{len(d.gear)} de poder a {d.c['name']} (uno por Gear)", f_dd)
    q = next((x for x in df.field if x.c['id'] == ROGUE and x.ready and not x.lag and x is not d), None)
    if q is not None and money >= 2:
        def f_q():
            g.pay(df, 2)
            g.spend_unit(q)
            a.tmp -= g.power(q)
            g.ev(df, 'react', ROGUE)
        add(f"Rogue Amendiares (2 €): -{g.power(q)} de poder a {a.c['name']}", f_q)
    river = df.leg(RIVER)
    if river is not None and river.ready and d is not None:
        seen = set()
        for c in df.hand:
            if c['t'] == 'G' and c['cost'] <= 2 and c['id'] not in seen:
                seen.add(c['id'])

                def f_river(c=c):
                    df.hand.remove(c)
                    g.spend_leg(df, river)
                    g.ev(df, 'react', RIVER)
                    g.play_card(df, c, pay=False, target=d)
                add(f"River Ward: jugar gratis {c['name']} sobre {d.c['name']}", f_river)
    return out


def goro_options(g, df, at, a, tgt):
    """Goro puede dar Blocker a una Unidad barata y lista: [(etiqueta, función, Unidad)]."""
    goro = df.leg(GORO)
    if goro is None or not goro.ready or g.avail(df, keep=(goro,)) < 1 or _unblockable(df, at, a):
        return []
    bonus = 1 if fx.pairs(df) else 0
    out = []
    for u in df.field:
        if u.ready and u is not tgt and not g.is_blocker(u) and u.c['cost'] <= 4:
            def f_goro(u=u):
                g.pay(df, 1, keep=(goro,))
                g.spend_leg(df, goro)
                u.blk = True
                u.tmp += bonus
                g.ev(df, 'react', GORO)
            out.append((f"Goro (1 €): dar Blocker a {u.c['name']}" + (' y +1 de poder' if bonus else ''), f_goro, u))
    return out


def defend(ask, g, df, at, a, tgt):
    """El defensor humano responde al ataque de `a`. Devuelve la Unidad que bloquea (o None)."""
    me = df
    blocker = None
    steals = tgt is None
    for _ in range(12):
        if g.winner is not None or a not in at.field:
            return None
        blockers = _blockers(g, df, at, a, tgt)
        fighter = blocker if blocker is not None else tgt
        tricks = defense_tricks(g, df, at, a, tgt, fighter)
        goros = goro_options(g, df, at, a, tgt) if blocker is None else []
        if blocker is None and not blockers and not tricks and not goros:
            return None                                          # nada que decidir
        if blocker is not None and not tricks:
            return blocker
        pa = g.power(a, atk=True, vs=fighter)
        target = 'los Gigs' if steals else unit_label(g, tgt, me)
        prompt = f"J{at.pi + 1} ataca con {a.c['name']} (poder {pa}) a {target}"
        if blocker is not None:
            prompt += f" · bloquea {blocker.c['name']} (poder {g.power(blocker, vs=a)})"
        elif tgt is not None:
            prompt += f" · poder de la atacada {g.power(tgt, vs=a)}"
        opts, acts = [], []
        if blocker is None:
            for b in blockers:
                opts.append(dict(label=f"Bloquear con {b.c['name']} (poder {g.power(b, vs=a)})", group='bloquear', ref=unit_ref(b)))
                acts.append(('block', b))
        for label, fn, ends in tricks:
            opts.append(dict(label=label, group='reaccion'))
            acts.append(('trick', (fn, ends)))
        for label, fn, u in goros:
            opts.append(dict(label=label, group='reaccion', ref=unit_ref(u)))
            acts.append(('goro', (fn, u)))
        opts.append(dict(label='Seguir sin hacer nada más', group='fin'))
        acts.append(('done', None))
        kind, data = acts[ask(g, 'react', prompt, opts)]
        if kind == 'done':
            return blocker
        if kind == 'block':
            blocker = data
        elif kind == 'goro':
            data[0]()
            blocker = data[1]
        else:
            data[0]()
            if data[1]:
                return None
    return blocker


def pump(ask, g, me, op, u, tgt):
    """Refuerzo del atacante humano antes de que el rival responda (Dum Dum, Synapse Burnout, Cyberpsychosis)."""
    n = len(u.gear)
    for _ in range(6):
        ids = Counter(c['id'] for c in me.hand)
        k = _faceup_legends(me)
        opts, fns = [], []
        dd = me.leg(DUMDUM)
        if dd is not None and dd.ready and n and g.avail(me, keep=(dd,)) >= 1:
            def f_dd():
                g.pay(me, 1, keep=(dd,))
                g.spend_leg(me, dd)
                u.tmp += n
                g.ev(me, 'pump', DUMDUM)
            opts.append(dict(label=f"Dum Dum (1 €): +{n} de poder (uno por Gear)", group='refuerzo'))
            fns.append(f_dd)
        if tgt is not None and ids['synapse_burnout'] and g.avail(me) >= 1 and k:
            def f_syn():
                _quick(g, me, 'synapse_burnout', 1)
                u.tmp += k
            opts.append(dict(label=f"Synapse Burnout (1 €): +{k} de poder", group='refuerzo'))
            fns.append(f_syn)
        if tgt is None and ids['cyberpsychosis'] and n and g.avail(me) >= 3:
            def f_psy():
                _quick(g, me, 'cyberpsychosis', 3)
                u.tmp += 3 * n
                u.psy = True
            opts.append(dict(label=f"Cyberpsychosis (3 €): +{3 * n} de poder; la Unidad muere al final del turno si roba o pelea", group='refuerzo'))
            fns.append(f_psy)
        if not opts:
            return
        dest = 'los Gigs' if tgt is None else unit_label(g, tgt, me)
        opts.append(dict(label='Atacar sin reforzar', group='fin'))
        i = ask(g, 'pump', f"Ataque de {u.c['name']} (poder {g.power(u, atk=True, vs=tgt)}) a {dest}: ¿lo refuerzas?", opts)
        if i == len(opts) - 1:
            return
        fns[i]()
