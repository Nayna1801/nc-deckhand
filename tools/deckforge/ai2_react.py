"""Reacciones del defensor: bloquear y ganar poder relativo con lo que tiene disponible."""
from collections import Counter

import fx2 as fx
from fx2 import RIVER, uval
from ai2_dice import steal_loss
from ai2_setup import gear_target, keep
from ai2_turn import _quick


# ----------------------------------------------------------------------------- reacciones del defensor
def _def_options(g, df, a, d):
    """Formas de ganar poder relativo para d (o quitárselo a a): [(ganancia, coste, función)]."""
    opts = []
    ids = Counter(c['id'] for c in df.hand)
    river = df.leg(RIVER)
    if river is not None and river.ready:
        gears = [c for c in df.hand if c['t'] == 'G' and c['cost'] <= 2 and c['pw'] > 0]
        if gears:
            c = max(gears, key=lambda c: c['pw'])

            def f_river(c=c):
                df.hand.remove(c)
                g.spend_leg(df, river)
                g.ev(df, 'react', RIVER)
                g.play_card(df, c, pay=False, target=d)
            opts.append((c['pw'], 0, f_river))
    if ids['synapse_burnout']:
        k = sum(1 for l in df.legs if l.up and not l.gone)
        if k:
            def f_syn(k=k):
                _quick(g, df, 'synapse_burnout', 1)
                d.tmp += k
            opts.append((k, 1, f_syn))
    if ids['floor_it']:
        def f_floor():
            _quick(g, df, 'floor_it', 1)
            a.tmp -= 1
            g.draw(df, 1, 'floor_it')
        opts.append((1, 1, f_floor))
    dd = df.leg('dum_dum_maelstrom_triggerman')
    if dd is not None and dd.ready and d.gear:
        def f_dd():
            g.pay(df, 1, keep=(dd,))
            g.spend_leg(df, dd)
            d.tmp += len(d.gear)
            g.ev(df, 'react', dd.c['id'])
        opts.append((len(d.gear), 1, f_dd))
    if ids['detonate']:
        gs = [x for x in a.gear if 0 < x['pw'] <= 2]
        if gs:
            x = max(gs, key=lambda x: x['pw'])

            def f_det(x=x):
                _quick(g, df, 'detonate', 1)
                a.gear.remove(x)
                a.owner.trash.append(x)
                g.ev(df, 'gearkill', 'detonate')
            opts.append((x['pw'], 1, f_det))
    q = next((x for x in df.field if x.c['id'] == 'rogue_amendiares_queen_of_the_afterlife' and x.ready and not x.lag and x is not d), None)
    if q is not None:
        def f_q():
            g.pay(df, 2)
            g.spend_unit(q)
            a.tmp -= g.power(q)
            g.ev(df, 'react', q.c['id'])
        opts.append((g.power(q), 2, f_q))
    return opts


def _plan(opts, need, money):
    """Elige la combinación más barata que alcanza `need`. Devuelve (coste, [funciones]) o None."""
    if need <= 0:
        return 0, []
    best = None
    n = len(opts)
    for m in range(1, 1 << n):
        gain = cst = 0
        for i in range(n):
            if m >> i & 1:
                gain += opts[i][0]
                cst += opts[i][1]
        if gain >= need and cst <= money and (best is None or cst < best[0]):
            best = (cst, [opts[i][2] for i in range(n) if m >> i & 1])
    return best


def react(g, df, at, a, tgt):
    """El defensor responde al ataque de `a`. Devuelve la Unidad que bloquea (o None)."""
    if g.slip(df):
        return None                                          # fallo humano: no reacciona ni bloquea
    b = _react(g, df, at, a, tgt)
    river = df.leg(RIVER)
    if river is not None and river.ready and df.field:
        gears = [c for c in df.hand if c['t'] == 'G' and c['cost'] <= 2]
        if gears:
            c = max(gears, key=lambda c: fx.gear_value(g, df, at, c))
            tg = gear_target(g, df, c, among=[u for u in df.field if u is not tgt or u is b] or df.field)
            df.hand.remove(c)
            g.spend_leg(df, river)
            g.ev(df, 'free', RIVER)
            g.play_card(df, c, pay=False, target=tg)
    return b


def _overwatch(g, df, a, tgt):
    """Overwatch: derrota a la atacante (ya gastada) antes de que robe o pelee. True si lo ha hecho."""
    ow = next((u for u in df.field if u.ready and u is not tgt and any(x['id'] == 'overwatch_panam_s_gift' for x in u.gear)), None)
    if ow is None:
        return False
    c = [x for x in df.hand if x['cost'] >= a.c['cost'] and keep(g, df, x) < uval(g, a) + 2.0]
    if not c:
        return False
    x = min(c, key=lambda x: keep(g, df, x))
    df.hand.remove(x)
    df.trash.append(x)
    g.pay(df, 1)
    g.spend_unit(ow)
    g.ev(df, 'react', 'overwatch_panam_s_gift')
    g.defeat(a, 'overwatch_panam_s_gift', by=df)
    return True


def _cyberpsychosis(g, df, a, tgt, ids, money, P):
    """Cyberpsychosis sube el poder de la atacante solo si cambia el número de Gigs que roba. Devuelve (P, money)."""
    if ids['cyberpsychosis'] and money >= 3 and a.gear and uval(g, a) >= 8.0 and (P + 3 * len(a.gear)) // 10 == P // 10:
        _quick(g, df, 'cyberpsychosis', 3)
        a.tmp += 3 * len(a.gear)
        a.psy = True
        return g.power(a, atk=True, vs=tgt), money - 3
    return P, money


def _goro_blocker(g, df, a, tgt, money, P, unblockable):
    """Goro (Vengeful Bodyguard) puede dar Blocker a una Unidad barata. Devuelve (Goro, (Unidad, bonus) o None)."""
    goro = df.leg('goro_takemura_vengeful_bodyguard')
    if goro is not None and goro.ready and money >= 1 and not unblockable:
        bonus = 1 if fx.pairs(df) else 0
        c = [u for u in df.field if u.ready and u is not tgt and not g.is_blocker(u) and u.c['cost'] <= 4 and g.power(u, vs=a) + bonus > P]
        if c:
            return goro, (max(c, key=lambda u: g.power(u)), bonus)
    return goro, None


def _best_defense(g, df, a, tgt, bl, P, money):
    """Defensa que GANA la pelea (bloqueando o reforzando a la Unidad atacada): (clave, defensora, funciones) o None."""
    best = None
    for d in bl + ([tgt] if tgt is not None else []):
        need = P - g.power(d, vs=a) + 1
        plan = _plan(_def_options(g, df, a, d), need, money) if need > 0 else (0, [])
        if plan is not None:
            key = (plan[0], uval(g, d) if d is not tgt else -1)
            if best is None or key < best[0]:
                best = (key, d, plan[1])
    return best


def _limit_steal(g, df, a, ids, money, P, bl, crit):
    """No se puede ganar la pelea y la atacante va a robar Gigs: reducir el robo o bloquear aunque se pierda o se empate."""
    # 3) reducir el robo
    if ids['take_control'] and money >= 2:
        _quick(g, df, 'take_control', 2)
        a.tc += 1
        if 'AI' in a.c['tags'] or 'Drone' in a.c['tags'] or 'Vehicle' in a.c['tags']:
            g.draw(df, 1, 'take_control')
        g.ev(df, 'save', 'take_control')
        return None
    if P >= 10:
        over = P % 10 + 1
        plan = _plan([o for o in _def_options(g, df, a, a) if o[1] > 0 and o[2].__name__ in ('f_floor', 'f_det', 'f_q')], over, money)
        if plan is not None:
            for f in plan[1]:
                f()
            g.ev(df, 'save', 'rebajar_a_menos_de_10')
            return None
    # 4) bloquear aunque se pierda o se empate
    if bl:
        b = min(bl, key=lambda b: uval(g, b))
        pb = g.power(b, vs=a)
        if pb == P and P > 0:
            if crit or uval(g, a) >= uval(g, b) - 1.0:
                return b
        else:
            if ids['safety_override'] and money >= 2 and uval(g, a) >= 5.0:
                _quick(g, df, 'safety_override', 2)
                b.safety = True
                return b
            if ids['reboot_optics'] and money >= 2:
                _quick(g, df, 'reboot_optics', 2)
                a.reboot_vs = True
                return b
            if crit or (b.c['cost'] <= 2 and pb <= 2):
                return b
    return None


def _save_unit(g, df, a, tgt, ids, money, P):
    """5) Pelea que se va a perder: salvar la Unidad atacada si merece la pena."""
    if tgt is not None and P >= g.power(tgt, vs=a) and uval(g, tgt) >= 6.0 and money >= 2:
        if ids['reboot_optics']:
            _quick(g, df, 'reboot_optics', 2)
            a.reboot_vs = True
        elif ids['safety_override'] and uval(g, a) >= 5.0:
            _quick(g, df, 'safety_override', 2)
            tgt.safety = True


def _react(g, df, at, a, tgt):
    P = g.power(a, atk=True, vs=tgt)
    money = g.avail(df)
    ids = Counter(c['id'] for c in df.hand)
    gig = tgt is None
    X = (P // 10 + 1 if P > 0 else 0) if gig else 0
    X = min(X, len(df.gigs))
    crit = gig and (X >= 2 or len(at.gigs) + X >= 7 or g.overtime or len(df.gigs) <= 3 or (X >= 1 and steal_loss(df) >= 2.0))
    # 1) Overwatch
    if money >= 1 and (X >= 1 or (tgt is not None and P >= g.power(tgt, vs=a))) and _overwatch(g, df, a, tgt):
        return None
    P, money = _cyberpsychosis(g, df, a, tgt, ids, money, P)
    unblockable = a.c['id'] == 'mt0d12_flathead' and at.cred() < df.cred()
    bl = [] if unblockable else [b for b in df.field if b.ready and b is not tgt and g.is_blocker(b)]
    goro, goro_c = _goro_blocker(g, df, a, tgt, money, P, unblockable)
    # 2) defensa que GANA la pelea
    best = _best_defense(g, df, a, tgt, bl, P, money)
    if best is not None and (gig or best[1] is tgt or best[0][0] == 0):
        _, d, fns = best
        for f in fns:
            f()
        return None if d is tgt else d
    if goro_c is not None and (X >= 1 or tgt is not None):
        u, bonus = goro_c
        g.pay(df, 1, keep=(goro,))
        g.spend_leg(df, goro)
        u.blk = True
        u.tmp += bonus
        g.ev(df, 'react', goro.c['id'])
        return u
    if gig and X >= 1:
        return _limit_steal(g, df, a, ids, money, P, bl, crit)
    _save_unit(g, df, a, tgt, ids, money, P)
    return None
