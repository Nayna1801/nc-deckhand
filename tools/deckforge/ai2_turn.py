"""Fase principal, parte 2: secuencia del turno (planificar y jugar), previsión (lookahead) y ataques."""
import os
import random

import fx2 as fx
from fx2 import ALT, GIG, RIVER, uval
from ai2_cards import (
    _alt_discount, _choose, _evelyn, _hanako, _items, _judy_leg, _panam, _river_own_turn, _sell, _tunable, _tuning,
    _unit_abilities, tune_gain, tune_leg,
)
from ai2_setup import CANTRIPS, LOOK_MARGIN, LOOK_SAMPLES, LOOK_TURNS, evalpos


ACT_SAMPLES = 2      # repartos de la información oculta que se prueban por jugada (valoración «action»)
ACT_MARGIN = 0.3     # lo que tiene que mejorar la jugada de la red sobre la del criterio habitual para cambiarla
TUNE_MARGIN = 0.05    # idem para «gastar un Tuner antes de jugar» (ver _net_pick)
PLAN_R = int(os.environ.get('DECKFORGE_PLAN', '0'))   # secuencias distintas que se prueban para terminar el turno (0 o 1 = solo la habitual)
PLAN_EXPLORE = 0.35  # probabilidad de variar cada decisión en las secuencias de prueba (orden de pago, qué jugar, con qué atacar)


def _runs(g, me):
    """Secuencias que prueba este jugador para terminar el turno: DECKFORGE_PLAN para todos, o 4 si su valoración es «action+plan»."""
    return max(PLAN_R, 4 if '+plan' in g.vf[me.pi] else 0)


def _do_action(g, me, kind, obj, paymode=None):
    g.paymode = paymode
    try:
        _do_action_inner(g, me, kind, obj)
    finally:
        g.paymode = None


def _do_action_inner(g, me, kind, obj):
    if kind == 'call':
        g.call(me)
    elif kind == 'ow':
        _, u, t, x = obj
        me.hand.remove(x)          # el descarte es parte del coste: sale ANTES de pagar y gastar (que pueden mover la mano)
        me.trash.append(x)
        g.pay(me, 1)
        g.spend_unit(u)
        g.ev(me, 'react', 'overwatch_panam_s_gift')
        g.defeat(t, 'overwatch_panam_s_gift', by=me)
    elif kind == 'gs':
        g.go_solo(me, obj)
    elif kind == 'tune':
        tune_leg(g, me, me.op, obj)
    elif kind == 'river':          # River Ward: gasta su habilidad y juega gratis un Gear de coste 2 o menos de la mano
        r = me.leg(RIVER)
        me.hand.remove(obj)
        g.spend_leg(me, r)
        g.ev(me, 'free', RIVER)
        g.play_card(me, obj, pay=False)
    elif kind == 'alt':
        alt = me.leg(ALT)
        g.pay(me, 1, keep=(alt,))
        g.spend_leg(me, alt)
        me.trash.remove(obj)
        g.ev(me, 'free', ALT)
        g.play_card(me, obj, pay=True, bottom_after=True)
    else:
        me.hand.remove(obj)
        g.play_card(me, obj)


def _after_attacks(g, me, op):
    """Después del primer bloque de ataques: Panam, segunda fase de jugadas y cierre del turno."""
    if g.winner is not None:
        return
    if _panam(g, me, op):
        attacks(g, me, op)
        if g.winner is not None:
            return
    me.phase = 'post'
    play_loop(g, me, op)
    if g.winner is None:
        _evelyn(g, me, op)
        _judy_leg(g, me)


def _tail(g, me, op):
    """Lo que queda de turno cuando termina el bucle de jugadas de la fase actual."""
    if me.phase == 'pre':
        _river_own_turn(g, me, op)
        _tuning(g, me, op)
        attacks(g, me, op, plan=True)
        _after_attacks(g, me, op)
    elif g.winner is None:
        _evelyn(g, me, op)
        _judy_leg(g, me)


def _plan_scores(g, me, opts, apply, finish):
    """Puntúa cada opción: la aplica en copias de la partida y termina el turno con la secuencia habitual (r = 0) y con
    PLAN_R - 1 secuencias al azar (orden de pago, qué jugar, con qué atacar). Una opción vale lo que da su mejor secuencia,
    promediada sobre repartos distintos de la información oculta del rival (mismo azar para todas las opciones)."""
    runs = max(1, _runs(g, me))
    tot = [[0.0] * runs for _ in opts]
    for _ in range(ACT_SAMPLES):
        root = g.clone()
        r_me = root.p[me.pi]
        r_op = r_me.op
        pool = r_op.hand + r_op.deck
        root.rng.shuffle(pool)
        n = len(r_op.hand)
        r_op.hand, r_op.deck = pool[:n], pool[n:]
        root.rng.shuffle(r_me.deck)
        seed = root.rng.random()
        for i, opt in enumerate(opts):
            for r in range(runs):
                c = root.clone(seed)
                m2 = c.p[me.pi]
                apply(c, m2, opt)
                if r:
                    c.explore = PLAN_EXPLORE
                    c.xrng = random.Random(seed * 1e6 + 97 * r)
                if c.winner is None:
                    finish(c, m2)
                c.finish_turn(m2, skip_main=True)
                tot[i][r] += evalpos(c, m2)
    return [max(row) for row in tot]


SEARCH_TOP = 3     # primeras acciones (las mejor puntuadas) que se amplían a pares con una segunda acción


def _candidates(g, me, op, items, budget):
    """Acciones elegibles ahora: cartas, llamadas y Go Solo que se pueden pagar, más las habilidades de Legends."""
    return [t for t in items if t[3] in ('card', 'call', 'gs') and t[1] <= budget] + _ability_options(g, me, op)


def _key(kind, obj):
    """Identificador de una acción que sirve en cualquier copia de la partida (los objetos cambian al clonar)."""
    if kind in ('card', 'river'):
        return kind, obj['id']
    if kind in ('gs', 'tune'):
        return kind, obj.c['id']
    return kind, None


def _apply_key(c, m2, key):
    """Aplica en la copia `c` la acción identificada por `key` SOLO si en esa copia es una jugada legal y pagable (el azar de
    la copia puede haber cambiado el tablero respecto a donde se eligió); si no, no hace nada."""
    _alt_discount(c, m2, m2.op)
    for t in _candidates(c, m2, m2.op, _items(c, m2, m2.op), c.avail(m2)):
        if _key(t[3], t[4]) == key:
            _do_action(c, m2, t[3], t[4], None)
            return


def _level2(g, me, o1):
    """Acciones que se pueden hacer DESPUÉS de la primera `o1`, mirándolo en una copia: [clave]."""
    probe = g.clone()
    m = probe.p[me.pi]
    kind, obj, pm = o1
    if kind in ('gs', 'tune'):
        obj = m.legs[me.legs.index(obj)]
    _do_action(probe, m, kind, obj, pm)
    if probe.winner is not None:
        return []
    _alt_discount(probe, m, m.op)
    seen, out = set(), []
    for t in _candidates(probe, m, m.op, _items(probe, m, m.op), probe.avail(m)):
        key = _key(t[3], t[4])
        if key not in seen:
            seen.add(key)
            out.append(key)
    return out


def _expand_pairs(g, me, opts, sc, rng0, rng1, apply, finish):
    """Búsqueda de combos: a las mejores primeras acciones les prueba cada segunda acción posible y termina el turno con el
    criterio habitual. Una primera acción vale lo que su mejor continuación. Se puntúa con el MISMO azar que la primera
    pasada (se restaura el generador), para que las dos puntuaciones se puedan comparar."""
    order = sorted((i for i, o in enumerate(opts) if o[0] != 'stop'), key=lambda i: -sc[i])[:SEARCH_TOP]
    pair_opts, owner = [], []
    for i in order:
        for k2 in _level2(g, me, opts[i]):
            pair_opts.append((opts[i], k2))
            owner.append(i)
    if not pair_opts:
        return sc

    def apply2(c, m2, pair):
        o1, k2 = pair
        apply(c, m2, o1)
        if c.winner is None:
            _apply_key(c, m2, k2)

    g.rng.setstate(rng0)
    sc2 = _plan_scores(g, me, pair_opts, apply2, finish)
    g.rng.setstate(rng1)
    out = list(sc)
    for s2, i in zip(sc2, owner):
        out[i] = max(out[i], s2)
    return out


def _net_pick(g, me, cands, base):
    """Elige la jugada (y cómo pagarla) que deja mejor posición. Devuelve (tipo, objeto, modo de pago) o 'stop'."""
    can_legs = any(l.ready and not l.gone for l in me.legs) and me.Eready > 0
    opts = []
    for t in cands:
        opts.append((t[3], t[4], None))
        if can_legs and _runs(g, me) > 1 and t[3] != 'tune':
            opts.append((t[3], t[4], 'legs'))
    opts.append(('stop', None, None))

    def apply(c, m2, opt):
        kind, obj, pm = opt
        c.skip_loop = kind == 'stop'
        if kind != 'stop':
            if kind in ('gs', 'tune'):
                obj = m2.legs[me.legs.index(obj)]
            _do_action(c, m2, kind, obj, pm)

    def finish(c, m2):
        if c.winner is None and not c.skip_loop:
            play_loop(c, m2, m2.op)
        if c.winner is None:
            _tail(c, m2, m2.op)

    rng0 = g.rng.getstate()
    sc = _plan_scores(g, me, opts, apply, finish)
    if '+search' in g.vf[me.pi] and len(opts) >= 3:
        sc = _expand_pairs(g, me, opts, sc, rng0, g.rng.getstate(), apply, finish)
    bi = max(range(len(opts)), key=lambda i: sc[i])
    ref = next((i for i, o in enumerate(opts) if o[0] == base[0] and o[1] is base[1] and o[2] is None), None)
    # gastar el Tuner antes de jugar hace lo mismo que se haría al final del turno (solo cambia el orden) y todas las
    # opciones comparten el mismo azar: basta una ventaja mínima, no el margen que protege de cambiar la jugada por ruido
    margin = TUNE_MARGIN if opts[bi][0] in ('tune', 'river') else ACT_MARGIN
    if ref is not None and sc[bi] < sc[ref] + margin * ACT_SAMPLES:
        bi = ref
    return opts[bi]


def _river_options(g, me):
    """River Ward puede jugar gratis un Gear de coste 2 o menos: se ofrece como acción elegible en cualquier punto del turno
    (hoy solo se usa al final, cuando el Gear ya se ha pagado con Eddies)."""
    r = me.leg(RIVER)
    if r is None or not r.ready or not me.field:
        return []
    seen, out = set(), []
    for c in me.hand:
        if c['t'] == 'G' and c['cost'] <= 2 and c['id'] not in seen:
            seen.add(c['id'])
            out.append((0.0, 0, 0, 'river', c))
    return out


def _ability_options(g, me, op):
    """Habilidades de Legends como acciones que la búsqueda puede preferir ANTES de jugar cartas, porque el orden cambia el
    resultado: arreglar un dado primero si habilita una carta (Wakako, Dexter, Muamar) o jugar un Gear gratis con River sobre la
    Unidad que acaba de entrar. Solo con vf «...+abil» (las dos) o «...+tune» / «...+river» (cada una)."""
    flag = g.vf[me.pi]
    out = []
    if '+tune' in flag or '+abil' in flag or '+search' in flag:
        out += [(0.0, 0, 0, 'tune', l) for l in me.legs if _tunable(g, me, l) and tune_gain(g, me, op, l) > 0]
    if '+river' in flag or '+abil' in flag or '+search' in flag:
        out += _river_options(g, me)
    return out


def play_loop(g, me, op):
    for _ in range(12):
        if g.winner is not None:
            return
        _alt_discount(g, me, op)
        budget = g.avail(me)
        items = _items(g, me, op)
        chosen = _choose(items, budget)
        if chosen and g.slip(me):
            chosen.remove(max(chosen, key=lambda t: t[0]))   # fallo humano: no ve la mejor jugada
        use_net = g.vf[me.pi].startswith('action') and not g.rollout
        if not chosen and not use_net:
            return
        if chosen:
            v, cost, pr, kind, obj = min(chosen, key=lambda t: (t[2], -t[0]))
            me.reserve = max([t[1] for t in chosen if t[3] == 'hold'], default=0)
            base = (kind, obj)
        else:
            kind, obj, base = 'stop', None, ('stop', None)
        pm = None
        if use_net and kind not in ('hold', 'ow', 'alt'):
            cands = _candidates(g, me, op, items, budget)
            if cands:
                kind, obj, pm = _net_pick(g, me, cands, base)
                g.ev(me, 'net', 'same' if (kind, obj, pm) == (base[0], base[1], None) else 'other')
                if kind in ('tune', 'river'):
                    g.ev(me, kind, 'antes de jugar')
        elif g.rollout and g.explore and chosen:
            r = g.xrng.random()
            if r < g.explore:
                kind, obj = g.xrng.choice([(t[3], t[4]) for t in chosen])     # secuencia de prueba: otro orden
            elif r < 1.4 * g.explore:
                return                                                         # ... o dejar de jugar aquí
        if kind in ('hold', 'stop'):
            return
        _do_action(g, me, kind, obj, pm)


def _plans(g, me, op):
    plans = ['default']
    if any(u.ready and not u.c['noatk'] for u in me.field):
        plans += ['safe', 'noatk', 'allin']
    if any(c['t'] == 'P' and not c['quick'] and c['id'] not in CANTRIPS for c in me.hand):
        plans.append('hold')
    return plans


def choose_plan(g, me, op):
    """Prueba cada plan de turno en copias de la partida (con la mano rival barajada, porque no se conoce)
    y se queda con el que deja mejor posición dos turnos después."""
    plans = _plans(g, me, op)
    if len(plans) == 1:
        return 'default'
    score = dict.fromkeys(plans, 0.0)
    for _ in range(LOOK_SAMPLES):
        base = g.clone()
        b_me = base.cur
        b_op = b_me.op
        pool = b_op.hand + b_op.deck
        base.rng.shuffle(pool)
        n = len(b_op.hand)
        b_op.hand, b_op.deck = pool[:n], pool[n:]
        base.rng.shuffle(b_me.deck)
        seed = base.rng.random()
        for m in plans:
            c = base.clone(seed)
            c.play_out(m, LOOK_TURNS)
            score[m] += evalpos(c, c.p[me.pi])
    best = max(plans, key=lambda m: score[m])
    if best != 'default' and score[best] < score['default'] + LOOK_MARGIN * LOOK_SAMPLES:
        return 'default'
    return best


def main(g, me, op):
    if me.forced_mode is not None:
        me.mode, me.forced_mode = me.forced_mode, None
    elif g.deep[me.pi] and not g.rollout and not g.slip(me):
        me.mode = choose_plan(g, me, op)
        if me.mode != 'default':
            g.ev(me, 'plan', me.mode)
    else:
        me.mode = 'default'
    me.phase = 'pre'
    me.reserve = 0
    _sell(g, me)
    _hanako(g, me, op)
    _unit_abilities(g, me, op)
    play_loop(g, me, op)
    if g.winner is None:
        _tail(g, me, op)


# ----------------------------------------------------------------------------- ataques
def _exposure(g, me, op, u):
    if me.mode == 'allin':
        return 0.0
    if me.hand and any(x['id'] == 'overwatch_panam_s_gift' for x in u.gear) and any(g.power(t) > 0 for t in op.field):
        return 5.0
    if any(x['id'] == 'sandevistan' for x in u.gear) or me.has('saul_bright_stormrider'):
        return 0.0
    if not op.field:
        return 0.0
    pu = g.power(u)
    e = 0.3 * uval(g, u) if any(g.power(t, atk=True) > pu and not t.c['noatk'] for t in op.field) else 0.05 * uval(g, u)
    if g.is_blocker(u) and pu <= 4 and any(g.power(t) > 0 for t in op.field):
        e += 2.5
    if op.kill_spent:
        e += 0.15 * uval(g, u)
    return e


def _attack_score(g, me, op, u, tgt):
    P = g.power(u, atk=True, vs=tgt)
    cid = u.c['id']
    if tgt is None:
        if P <= 0:
            return 1.5 - _exposure(g, me, op, u) if cid in ('evelyn_parker_scheming_siren', 'sketchy_ripper') else -1.0
        X = P // 10 + 1
        if not u.gor and any(x['id'] == 'gorilla_arms' for x in u.gear):
            mine = {v for _, v in me.gigs}
            if any(x[1] not in mine for x in op.gigs):
                X += 1
        X = min(X, len(op.gigs))
        unblockable = cid == 'mt0d12_flathead' and me.cred() < op.cred()
        bl = [] if unblockable else [b for b in op.field if b.ready and g.is_blocker(b)]
        if bl:
            bmax = max(g.power(b, vs=u) for b in bl)
            if bmax > P:
                sc = -0.8 * uval(g, u)
            elif bmax == P:
                sc = uval(g, max(bl, key=lambda b: g.power(b, vs=u))) - uval(g, u) + 0.5
            else:
                sc = min(GIG * X, uval(g, min(bl, key=lambda b: uval(g, b))) + 1.0)
        else:
            sc = GIG * X
            if len(me.gigs) + X >= 7:
                sc += 100.0 if g.overtime else 6.0
        if len(op.gigs) >= 6:
            sc += 4.0
        return sc - _exposure(g, me, op, u)
    pt = g.power(tgt, vs=u)
    win = P > pt or (P == pt and P > 0 and u.nodef)
    tie = P == pt and P > 0 and not u.nodef
    if cid == 'johnny_silverhand_never_stop_fighting' and 'Corpo' in tgt.c['tags']:
        win, tie = True, False
    if tgt.c['id'] == 'johnny_silverhand_never_stop_fighting' and 'Corpo' in u.c['tags']:
        win, tie = False, False
    if tgt.c['id'] == 'maelstrom_zealots' and win:
        return uval(g, tgt) - uval(g, u)
    if win:
        sc = uval(g, tgt) + 1.0
        if any(x['id'] == 'satori_sword_of_saburo' for x in u.gear):
            sc += fx.DRAW
        if cid == 'johnny_silverhand_never_stop_fighting' and not u.won:
            sc += 3.0
        if me.appetite and P - pt >= 3 and op.gigs:
            sc += GIG
        return sc - 0.5 * _exposure(g, me, op, u)
    if tie:
        return uval(g, tgt) - uval(g, u)
    return -uval(g, u)


def attacks(g, me, op, plan=False):
    for _ in range(16):
        if g.winner is not None:
            return
        best = None
        forced = None
        cands = []
        valid = []
        for u in me.field:
            for tgt in g.targets(u):
                sc = _attack_score(g, me, op, u, tgt)
                cands.append((sc, u, tgt))
                if sc < 50.0 and not u.must:
                    if me.mode == 'noatk':
                        continue
                    if me.mode == 'safe' and (g.is_blocker(u) or any(g.power(t, atk=True) > g.power(u) and not t.c['noatk'] for t in op.field)):
                        continue
                valid.append((sc, u, tgt))
                if best is None or sc > best[0]:
                    best = (sc, u, tgt)
                if u.must and (forced is None or sc > forced[0]):
                    forced = (sc, u, tgt)
        if plan and _runs(g, me) > 1 and not g.rollout and forced is None and valid and g.vf[me.pi].startswith('action'):
            pick = _attack_pick(g, me, op, valid, best)
            if pick is None:
                return
            g.attack(pick[1], pick[2])
            continue
        if g.rollout and g.explore and forced is None and valid:
            r = g.xrng.random()
            if r < g.explore:
                top = sorted(valid, key=lambda x: -x[0])[:3]
                pick = g.xrng.choice(top)                    # secuencia de prueba: otro ataque
                g.attack(pick[1], pick[2])
                continue
            if r < 1.3 * g.explore:
                return                                       # ... o no seguir atacando
        if best is not None and len(cands) > 1 and g.slip(me):
            alt = sorted((x for x in cands if x[1] is not best[1] or x[2] is not best[2]), key=lambda x: -x[0])[:3]
            best = g.erng.choice(alt)                        # fallo humano: ataca con otra Unidad o a otro objetivo
            g.attack(best[1], best[2])
        elif best is not None and best[0] > 0.3:
            g.attack(best[1], best[2])
        elif forced is not None:
            g.attack(forced[1], forced[2])
        else:
            return


def _attack_pick(g, me, op, valid, best):
    """Elige el siguiente ataque (o dejar de atacar) probando cada opción en copias de la partida. None = dejar de atacar."""
    top = sorted(valid, key=lambda x: -x[0])[:3]
    opts = [(me.field.index(u), None if t is None else op.field.index(t)) for _, u, t in top]
    base_i = None
    if best is not None and best[0] > 0.3:
        for i, (_, u, t) in enumerate(top):
            if u is best[1] and t is best[2]:
                base_i = i
    opts.append(None)                                        # dejar de atacar

    def apply(c, m2, opt):
        c.skip_atk = opt is None
        if opt is not None:
            ui, ti = opt
            c.attack(m2.field[ui], None if ti is None else m2.op.field[ti])

    def finish(c, m2):
        if c.winner is None and not c.skip_atk:
            attacks(c, m2, m2.op)
        _after_attacks(c, m2, m2.op)

    sc = _plan_scores(g, me, opts, apply, finish)
    bi = max(range(len(opts)), key=lambda i: sc[i])
    ref = base_i if base_i is not None else len(opts) - 1
    if sc[bi] < sc[ref] + ACT_MARGIN * ACT_SAMPLES:
        bi = ref
    if opts[bi] is None:
        return None
    return top[bi]


def _quick(g, p, cid, cost):
    """Juega un Programa Quick desde la mano (pagando)."""
    c = next(x for x in p.hand if x['id'] == cid)
    p.hand.remove(c)
    g.pay(p, cost)
    p.trash.append(c)
    p.played[cid] += 1
    g.ev(p, 'react', cid)


def attacker_pump(g, me, op, u, tgt):
    P = g.power(u, atk=True, vs=tgt)
    n = len(u.gear)
    need = None
    if tgt is None:
        if P > 0 and P < 10 and op.gigs:
            need = 10 - P
    else:
        pt = g.power(tgt, vs=u)
        if pt >= P:
            need = pt - P + 1
    if need is None:
        return
    dd = me.leg('dum_dum_maelstrom_triggerman')
    if dd is not None and dd.ready and n >= need and g.avail(me, keep=(dd,)) >= 1:
        g.pay(me, 1, keep=(dd,))
        g.spend_leg(me, dd)
        u.tmp += n
        g.ev(me, 'pump', dd.c['id'])
        return
    ids = {c['id'] for c in me.hand}
    if tgt is not None and 'synapse_burnout' in ids and g.avail(me) >= 1:
        k = sum(1 for l in me.legs if l.up and not l.gone)
        if k >= need:
            _quick(g, me, 'synapse_burnout', 1)
            u.tmp += k
            return
    if tgt is None and 'cyberpsychosis' in ids and n and 3 * n >= need and g.avail(me) >= 3 and g.overtime \
            and len(me.gigs) + 2 >= 7 and not any(b.ready and g.is_blocker(b) for b in op.field):
        _quick(g, me, 'cyberpsychosis', 3)
        u.tmp += 3 * n
        u.psy = True
