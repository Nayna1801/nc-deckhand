"""Motor v2 del simulador: reglas completas del Cyberpunk TCG con las 151 cartas modeladas una a una.

Piezas:
  engine2.py  estado de la partida y primitivas de reglas (pagar, robar, derrotar, pelear, robar Gigs, turnos)
  fx2.py      efecto de cada carta y Legend (y cuánto vale jugarla en cada situación)
  ai2.py      decisiones del jugador (vender, llamar, jugar, atacar, reaccionar, manipular dados)

Cada partida registra eventos (quién roba, quién elimina, qué carta lo provoca...) para poder EXPLICAR el resultado.
"""
import os
import random
from collections import Counter

import cardsdb as DB

DICE = (4, 6, 8, 10, 12, 20)
KIND = {'Unit': 'U', 'Gear': 'G', 'Program': 'P', 'Legend': 'L'}
OVERTIME_TURN = 14          # tras 7 turnos de cada jugador (dos turnos seguidos con las áreas de fixer vacías)
GIGS_TO_WIN = 7
DEEP_DEFAULT = os.environ.get('DECKFORGE_DEEP', '0') == '1'   # previsión (lookahead) activada por defecto
VF_DEFAULT = os.environ.get('DECKFORGE_VF', 'hand')          # valoración de posición de la previsión: hand | learned (valfn.py)
ERR_DEFAULT = float(os.environ.get('DECKFORGE_ERR', '0'))     # probabilidad de fallo humano por decisión (0 = juego sin fallos)


def _mk(c):
    text = c['rules'] or ''
    t = KIND[c['type']]
    tags = frozenset(c['classifications'] or ())
    return dict(id=c['id'], t=t, cost=c['cost'] or 0, pw=c['power'] or 0, color=c['color'], ram=c['ram'] or 0,
                tags=tags, name=c['displayName'], sell=(t in 'GP') or c['id'] in DB.SELL_UNITS,
                blocker='{Blocker}' in text and t != 'P' and not text.startswith('{Quick}'),
                adr=t == 'U' and text.startswith('{Adrenaline}'),
                gosolo=t == 'L' and '{Go Solo}' in text, bd='Braindance' in tags,
                quick=t == 'P' and text.startswith('{Quick}'),
                noatk=t == 'U' and "This Unit can't attack." in text)


CARD = {c['id']: _mk(c) for c in DB.RAW}


class Unit:
    def __init__(s, c, owner, leg=None):
        s.c = c
        s.owner = owner
        s.leg = leg            # Legend que hizo Go Solo (o None)
        s.gear = []
        s.ready = True
        s.lag = True
        s.tmp = 0              # modificador de poder hasta fin de turno
        s.blk = False          # Blocker temporal
        s.adr = False          # Adrenaline temporal
        s.noatk = False        # no puede atacar hasta el siguiente turno de quien lo aplicó
        s.noready = False      # no se prepara en su próximo inicio de turno
        s.must = False         # debe atacar si puede
        s.atku = False         # puede atacar Unidades el turno en que entra
        s.atkr = False         # su próximo ataque puede ir contra Unidades preparadas
        s.nodef = False        # no puede ser derrotada en pelea este turno
        s.psy = False          # Cyberpsychosis: muere al final del turno si roba o pelea
        s.acted = False        # robó o peleó este turno
        s.stole = False
        s.won = False
        s.tc = 0               # Gigs de menos que roba este turno (Take Control)
        s.rita = False
        s.gor = False


class Leg:
    def __init__(s, c):
        s.c = c
        s.up = False
        s.ready = True
        s.gone = False         # hizo Go Solo (o fue retirada del juego)
        s.gear = []
        s.known = False


class Player:
    def __init__(s, pi, deck_ids, leg_ids, first, rng):
        s.pi = pi
        s.first = first
        s.deck = [CARD[i] for i in deck_ids]
        rng.shuffle(s.deck)
        s.legs = [Leg(CARD[i]) for i in leg_ids]
        rng.shuffle(s.legs)
        s.hand = []
        s.trash = []
        s.field = []
        s.gigs = []
        s.fixer = list(DICE)
        s.E = 0
        s.Eready = 0
        s.op = None
        s.ids = Counter(deck_ids)
        s.legids = set(leg_ids)
        s.drawn = set()
        s.early = set()
        s.played = Counter()
        s.fang = 0             # Chrome Fang activo hasta ese turno
        s.westbrook = 0
        s.reset_turn()

    def reset_turn(s):
        s.called = False
        s.sold = False
        s.prog = False
        s.jackie = False
        s.alt_disc = 0
        s.cyber = False
        s.yori_atk = False
        s.yori_def = False
        s.rogueq = False
        s.appetite = False
        s.gs_disc = 0
        s.johnny_leg = False

    def leg(s, lid):
        """Legend boca arriba y todavía en el área de Legends."""
        for l in s.legs:
            if l.c['id'] == lid and l.up and not l.gone:
                return l
        return None

    def has(s, cid):
        return any(u.c['id'] == cid for u in s.field)

    def cred(s):
        return sum(v for _, v in s.gigs)


class Game:
    def __init__(s, deckA, legA, deckB, legB, seed=0, trace=False, deep=None, err=None, vf=None, ai=None):
        s.deep = (DEEP_DEFAULT, DEEP_DEFAULT) if deep is None else tuple(deep)
        s.vf = (VF_DEFAULT, VF_DEFAULT) if vf is None else tuple(vf)
        s.rec = None                               # lista donde guardar posiciones para entrenar valfn.py
        s.explore = 0.0                            # solo en simulaciones de previsión: probabilidad de probar una variante al azar
        s.xrng = random.Random(seed * 31 + 5)
        s.paymode = None                           # 'legs': pagar primero con Legends (para que algo pueda volver a prepararlas)
        s.err = (ERR_DEFAULT, ERR_DEFAULT) if err is None else tuple(err)
        s.erng = random.Random(seed * 7919 + 13)   # flujo propio: con err = 0 las partidas son idénticas a las de siempre
        s.rollout = False
        s.chooser = None                           # decide los objetivos de los efectos por una persona (human.py); None = el motor
        s.human_pi = None                          # asiento que juega una persona (human.py), o None
        s.payer = None                             # deja que una persona elija con qué Legends se paga (human.py); None = el motor
        import ai2
        import fx2
        s.fx = fx2
        s.ai = ai2 if ai is None else ai          # módulo (o intermediario) que decide por cada jugador
        s.rng = random.Random(seed)
        s.p = [Player(0, deckA, legA, True, s.rng), Player(1, deckB, legB, False, s.rng)]
        s.p[0].op, s.p[1].op = s.p[1], s.p[0]
        s.turn = 0
        s.cur = s.p[0]
        s.winner = None
        s.overtime = False
        s.st = [Counter(), Counter()]
        s.log = [] if trace else None
        s.snap = [{}, {}]
        for p in s.p:
            s.ai.profile(s, p)
            s.draw(p, 6, src=None)
            if s.ai.mulligan(s, p):
                p.deck += p.hand
                p.hand = []
                s.rng.shuffle(p.deck)
                s.draw(p, 6, src=None)
                s.st[p.pi]['mulligan'] += 1

    def slip(s, p):
        """¿Falla este jugador la decisión actual? Solo en la partida real (las simulaciones de previsión no fallan)."""
        e = s.err[p.pi]
        return e > 0 and not s.rollout and s.erng.random() < e

    # ------------------------------------------------------------------ registro
    def tr(s, p, msg):
        if s.log is not None:
            s.log.append(f"   J{p.pi + 1} {msg}")

    def ev(s, p, kind, src, n=1):
        s.st[p.pi][(kind, src)] += n

    # ------------------------------------------------------------------ cartas
    def draw(s, p, n=1, src='?'):
        k = 0
        for _ in range(int(n)):
            if not p.deck:
                break
            c = p.deck.pop()
            p.hand.append(c)
            p.drawn.add(c['id'])
            if s.turn <= 6:
                p.early.add(c['id'])
            k += 1
        if src and k:
            s.ev(p, 'draw', src, k)
        return k

    def discard(s, p, n=1, src=None):
        out = []
        for _ in range(n):
            if not p.hand:
                break
            c = None
            if s.chooser is not None and s.human_pi == p.pi and not s.rollout and len(p.hand) > 1:     # una persona elige qué descarta
                c = s.chooser(s, 'card', p.hand, f"Descarta ({CARD[src]['name']})" if src in CARD else 'Descarta', p)
            if c is None:
                c = min(p.hand, key=lambda x: s.ai.keep(s, p, x))
            p.hand.remove(c)
            p.trash.append(c)
            out.append(c)
        if src and out:
            s.ev(p.op, 'discard', src, len(out))
        return out

    def mill(s, p, n):
        out = []
        for _ in range(n):
            if not p.deck:
                break
            c = p.deck.pop()
            p.trash.append(c)
            out.append(c)
        return out

    def to_bottom(s, p, cards):
        cards = list(cards)
        s.rng.shuffle(cards)
        for c in cards:
            p.deck.insert(0, c)

    # ------------------------------------------------------------------ dinero
    def avail(s, p, keep=()):
        return p.Eready + sum(1 for l in p.legs if l.ready and not l.gone and l not in keep)

    def spend_leg(s, p, l):
        l.ready = False
        s.fx.on_spent_gear(s, p, l)

    def pay(s, p, n, keep=()):
        if n <= 0:
            return True
        if s.payer is not None and not s.rollout:
            r = s.payer(s, p, n, keep)
            if r is not None:
                return r
        if s.paymode == 'legs' or (s.explore and s.rollout and s.xrng.random() < s.explore * 0.5):
            legs = [l for l in p.legs if l.ready and not l.gone and l not in keep]
            s.xrng.shuffle(legs)
            for l in legs:                         # primero las Legends, luego los Eddies
                if n <= 0:
                    break
                s.spend_leg(p, l)
                n -= 1
            use = min(n, p.Eready)
            p.Eready -= use
            return n - use <= 0
        order = sorted([l for l in p.legs if l.ready and not l.gone and l not in keep], key=lambda l: s.ai.leg_pay_order(s, p, l))
        # las Legends con Gear de «cuando se gasta» van primero (dan valor al pagar)
        for l in [x for x in order if s.ai.leg_pay_order(s, p, x) < 0]:
            if n <= 0:
                break
            s.spend_leg(p, l)
            n -= 1
        use = min(n, p.Eready)
        p.Eready -= use
        n -= use
        for l in order:
            if n <= 0:
                break
            if l.ready:
                s.spend_leg(p, l)
                n -= 1
        return n <= 0

    def ready_eddies(s, p, n):
        p.Eready = min(p.E, p.Eready + n)

    # ------------------------------------------------------------------ unidades
    def power(s, u, atk=False, vs=None):
        p = u.c['pw'] + u.tmp
        for g in u.gear:
            p += g['pw']
        o = u.owner
        if atk:
            for x in o.field:
                if x is not u and x.c['id'] == 'saul_bright_stormrider':
                    p += 2
            if 'Arasaka' in u.c['tags'] and o.leg('saburo_arasaka_stubborn_patriarch'):
                p += 1
        cid = u.c['id']
        if cid == 'royce_psycho_on_the_edge' and s.cur is o:
            p += 2 * len(u.gear)
        if vs is not None and cid == 'meredith_stout_stone_cold_corpo' and vs.leg is not None:
            p += 2
        return p if p > 0 else 0

    def is_blocker(s, u):
        return u.c['blocker'] or u.blk or any(g['blocker'] for g in u.gear)

    def enter(s, p, c, leg=None):
        u = Unit(c, p, leg)
        p.field.append(u)
        return u

    def spend_unit(s, u):
        if not u.ready:
            return
        u.ready = False
        s.fx.on_spent_gear(s, u.owner, u)
        s.fx.on_spent_unit(s, u)

    def _leave(s, u):
        p = u.owner
        p.field.remove(u)
        if u.leg is not None:
            u.leg.gone = True

    def defeat(s, u, src, by=None):
        """Derrota (va a la basura). Devuelve True si la Unidad salió del campo."""
        p = u.owner
        if u not in p.field:
            return False
        for g in u.gear:
            if g['id'] == 'deadman_transmitter':
                u.gear.remove(g)
                p.trash.append(g)
                s.ev(p, 'save', 'deadman_transmitter')
                return False
        if s.fx.jackie_mama_save(s, p, u):
            return False
        s._leave(u)
        s.tr(p, f"pierde {u.c['name']} (derrotada por {src})")
        if by is not None and by is not p:
            s.ev(by, 'kill', src)
        relic = any(g['id'] == 'the_relic_experimental_biochip' for g in u.gear)
        if u.leg is None and not relic:
            p.trash.append(u.c)
        p.trash.extend(u.gear)
        s.fx.on_defeated(s, p, u, relic)
        if relic and u.leg is None:
            p.deck.insert(0, u.c)
        return True

    def bottom(s, u, src, by=None):
        """Va al fondo del mazo: NO es una derrota (no dispara efectos de «Defeated»)."""
        p = u.owner
        if u not in p.field:
            return False
        s._leave(u)
        s.tr(p, f"pierde {u.c['name']} (al fondo del mazo por {src})")
        s.to_bottom(p, ([u.c] if u.leg is None else []) + u.gear)
        if by is not None and by is not p:
            s.ev(by, 'bottom', src)
        return True

    def bounce(s, u):
        p = u.owner
        if u not in p.field:
            return
        s._leave(u)
        if u.leg is None:
            p.hand.append(u.c)
        p.trash.extend(u.gear)

    # ------------------------------------------------------------------ jugar cartas
    def ccost(s, p, c):
        return s.fx.cost(s, p, c)

    def play_card(s, p, c, pay=True, bottom_after=False, src=None, target=None):
        """Juega una carta que ya ha salido de su zona de origen. Devuelve la Unidad creada (o None)."""
        op = p.op
        if pay:
            s.pay(p, s.ccost(p, c), keep=s.ai.pay_keep(s, p))
            if c['t'] == 'P' and p.alt_disc:
                p.alt_disc = 0
        p.played[c['id']] += 1
        t = c['t']
        s.tr(p, f"juega {c['name']}" + ('' if pay else ' (gratis)'))
        if t in 'UG' and c['color'] == 'Blue':
            s.fx.jackie_blue(s, p)
        if t == 'U':
            u = s.enter(p, c)
            s.fx.on_play_unit(s, p, op, u)
            return u
        if t == 'G':
            tgt = target if target is not None else s.ai.gear_target(s, p, c)
            if tgt is None:
                p.trash.append(c)
                return None
            tgt.gear.append(c)
            p.cyber = p.cyber or ('Cyberware' in c['tags'])
            return None
        p.prog = True
        s.fx.play_program(s, p, op, c)
        if c['bd']:
            s.fx.judy_bd(s, p)
        if bottom_after:
            p.deck.insert(0, c)
        else:
            p.trash.append(c)
        return None

    def call(s, p, free=False, pick=None):
        if p.called:
            return False
        down = [l for l in p.legs if not l.up and not l.gone]
        if not down:
            return False
        if not free:
            if s.avail(p) < 1:
                return False
            s.pay(p, 1)
        p.called = True
        if pick not in down:
            known = [l for l in down if l.known]
            pick = None
            if known:
                avg = sum(s.fx.call_value(s, p, l) for l in down) / len(down)
                bk = max(known, key=lambda l: s.fx.call_value(s, p, l))
                unk = [l for l in down if not l.known]
                if s.fx.call_value(s, p, bk) >= avg or not unk:
                    pick = bk
                else:
                    pick = s.rng.choice(unk)
        l = pick if pick in down else s.rng.choice(down)
        l.up = True
        s.ev(p, 'call', l.c['id'])
        s.tr(p, f"Call -> {l.c['name']}")
        s.fx.on_call(s, p, p.op, l)
        return True

    def go_solo(s, p, l):
        cost = s.fx.gs_cost(s, p, l)
        if s.avail(p, keep=(l,)) < cost:
            return None
        s.pay(p, cost, keep=(l,))
        p.gs_disc = 0
        l.gone = True
        l.ready = False
        u = s.enter(p, l.c, leg=l)
        u.lag = False
        u.gear = l.gear
        l.gear = []
        s.ev(p, 'gosolo', l.c['id'])
        s.tr(p, f"GO SOLO {l.c['name']}")
        p.played[l.c['id']] += 1
        s.fx.on_play_unit(s, p, p.op, u)
        return u

    # ------------------------------------------------------------------ ataques
    def can_attack(s, u, gig=True):
        if not u.ready or u.c['noatk'] or u.noatk or u not in u.owner.field:
            return False
        me = u.owner
        op = me.op
        cid = u.c['id']
        if cid == 'jacked_in_voodoo_boy' and not me.prog:
            return False
        if not u.lag:
            return True
        if op.has('maxtac_suppression_team'):
            return False
        if u.c['adr'] or u.adr or u.leg is not None:
            return True
        if any(g['id'] == 'adrenaline_converter' for g in u.gear) and len(op.gigs) >= len(me.gigs) + 2:
            return True
        if cid == 'nadia_fighting_through_grief' and len(op.gigs) > len(me.gigs):
            return 'gig'
        if u.atku or cid == 'sandayu_oda_hanako_s_guardian' or me.johnny_leg:
            return 'unit'
        return False

    def targets(s, u):
        """Objetivos legales: None = área de Gigs; o una Unidad rival."""
        me = u.owner
        op = me.op
        mode = s.can_attack(u)
        if not mode:
            return []
        out = []
        cid = u.c['id']
        if mode != 'unit' and op.gigs and cid != 'ruthless_lowlife':
            out.append(None)
        if mode != 'gig':
            for t in op.field:
                if not t.ready or u.atkr:
                    out.append(t)
                elif cid == 'valentino_guerrera' and s.is_blocker(t) and me.cred() > op.cred():
                    out.append(t)
        return out

    def attack(s, u, tgt):
        me = u.owner
        op = me.op
        u.must = False
        s.tr(me, f"ataca con {u.c['name']} ({s.power(u, atk=True)}) -> " + ('Gigs' if tgt is None else f"{tgt.c['name']} ({s.power(tgt)})"))
        s.spend_unit(u)
        if u.atkr and tgt is not None:
            u.atkr = False
        s.fx.on_attack(s, me, op, u, tgt)
        if u not in me.field:
            return
        s.ai.attacker_pump(s, me, op, u, tgt)
        blocker = s.ai.react(s, op, me, u, tgt)
        if u not in me.field:          # eliminada por una reacción (Overwatch)
            return
        if blocker is not None:
            s.ev(op, 'block', blocker.c['id'])
            s.tr(op, f"bloquea con {blocker.c['name']} ({s.power(blocker)})")
            s.spend_unit(blocker)
            s.fx.on_block(s, op, me, blocker)
            tgt = blocker
        if tgt is not None and tgt in op.field:
            s.fight(u, tgt)
        elif tgt is None:
            P = s.power(u, atk=True)
            X = 0 if P <= 0 else P // 10 + 1
            X -= u.tc
            if X > 0:
                s.steal(me, op, u, X)
            elif u.tc and P > 0:
                s.ev(op, 'save', 'take_control')

    def fight(s, a, d):
        me, op = a.owner, d.owner
        pa = s.power(a, atk=True, vs=d)
        pd = s.power(d, vs=a)
        a.acted = d.acted = True
        a_dies = pa <= pd and pd > 0
        d_dies = pd <= pa and pa > 0
        if a.c['id'] == 'johnny_silverhand_never_stop_fighting' and 'Corpo' in d.c['tags']:
            a_dies, d_dies = False, True
        if d.c['id'] == 'johnny_silverhand_never_stop_fighting' and 'Corpo' in a.c['tags']:
            a_dies, d_dies = True, False
        a_lost, d_lost = a_dies, d_dies
        if a.nodef or getattr(d, 'reboot_vs', False):
            a_dies = False
        if d.nodef or getattr(a, 'reboot_vs', False):
            d_dies = False
        a.reboot_vs = d.reboot_vs = False
        # perder la pelea puede arrastrar al rival (Maelstrom Zealots, Safety Override)
        if a_lost and (a.c['id'] == 'maelstrom_zealots' or getattr(a, 'safety', False)):
            d_dies = True
        if d_lost and (d.c['id'] == 'maelstrom_zealots' or getattr(d, 'safety', False)):
            a_dies = True
        a.safety = d.safety = False
        margin = pa - pd
        if d_dies:
            s.defeat(d, a.c['id'], by=me)
        if a_dies:
            s.defeat(a, d.c['id'], by=op)
        if d_lost and not a_lost and a in me.field:
            s.fx.on_win_fight(s, me, op, a, margin)
        if a_lost and not d_lost and d in op.field:
            s.fx.on_win_fight(s, op, me, d, -margin)

    def stealable(s, me, op, u):
        out = list(op.gigs)
        if op.fang >= s.turn and u is not None:
            P = s.power(u, atk=True)
            out = [g for g in out if g[1] <= P]
        if op.westbrook >= s.turn and u is not None and u.leg is not None:
            P = s.power(u, atk=True)
            out = [g for g in out if g[1] >= P]
        return out

    def steal(s, me, op, u, X, src=None):
        n = 0
        for _ in range(X):
            cands = s.stealable(me, op, u)
            if not cands:
                break
            g = s.ai.pick_steal(s, me, op, cands)
            if s.fx.alt_mod_prevent(s, op, g):
                continue
            op.gigs.remove(g)
            me.gigs.append(g)
            n += 1
            if u is not None:
                s.fx.on_steal(s, me, op, u, g)
        if n:
            if u is not None:
                first = not u.stole
                u.stole = True
                u.acted = True
                s.ev(me, 'steal', src or u.c['id'], n)
                if X >= 2:
                    s.ev(me, 'steal2', src or u.c['id'])
                if first:
                    s.fx.on_first_steal(s, me, op, u)
            else:
                s.ev(me, 'steal', src, n)
            s.tr(me, f"roba {n} Gig(s) [{src or (u.c['name'] if u is not None else '')}] -> {len(me.gigs)}-{len(op.gigs)}")
            s.check_overtime()
        return n

    # ------------------------------------------------------------------ turnos
    def check_overtime(s):
        if s.overtime and s.winner is None:
            for p in (s.cur, s.cur.op):
                if len(p.gigs) >= GIGS_TO_WIN:
                    s.winner = p.pi
                    return

    def take_turn(s, me):
        op = me.op
        s.cur = me
        if len(me.gigs) >= GIGS_TO_WIN:
            s.winner = me.pi
            return
        first_turn = me.first and s.turn == 1
        if s.log is not None:
            s.log.append(f"T{s.turn} J{me.pi + 1}: {me.E}€ mano {len(me.hand) + 1} Gigs {sorted(v for _, v in me.gigs)} vs {sorted(v for _, v in op.gigs)} | mesa {[(u.c['name'][:14], s.power(u), 'R' if u.ready else 'g') for u in me.field]}")
        me.Eready = me.E
        for i, l in enumerate(me.legs):
            l.ready = not l.gone and not (first_turn and i < 2)
        for u in me.field:
            if u.noready:
                u.noready = False
            else:
                u.ready = True
        for u in op.field:
            u.noatk = False
        me.reset_turn()
        if not me.deck:
            s.winner = op.pi
            return
        s.draw(me, 1, src=None)
        if me.fixer:
            d = s.ai.pick_die(s, me)
            me.fixer.remove(d)
            v = s.rng.randint(1, d)
            v = s.fx.on_roll(s, me, d, v)
            me.gigs.append([d, v])
        s.fx.start_turn(s, me, op)
        s.finish_turn(me)

    def finish_turn(s, me, skip_main=False):
        op = me.op
        t = (s.turn + 1) // 2
        if not skip_main:
            s.ai.main(s, me, op)
        if s.winner is not None:
            return
        s.fx.end_turn(s, me, op)
        for p in s.p:
            for u in p.field:
                u.tmp = 0
                u.lag = False
                u.blk = u.adr = u.atku = u.atkr = u.nodef = False
                u.stole = u.won = u.rita = u.gor = u.acted = False
                u.tc = 0
        if s.rec is not None and not s.rollout:
            import valfn
            s.rec.append((me.pi, s.turn, valfn.feats(s, me), s.ai.evalpos_hand(s, me)))
        if t <= 6:
            s.snap[me.pi][t] = (sum(s.power(u) for u in me.field), len(me.hand), me.E, len(me.gigs), len(op.gigs))
        if s.turn >= OVERTIME_TURN:
            s.overtime = True
            s.check_overtime()

    def clone(s, seed=None):
        """Copia independiente de la partida (para simular el futuro sin tocar la real)."""
        g = Game.__new__(Game)
        g.__dict__.update(s.__dict__)
        g.rng = random.Random(s.rng.random() if seed is None else seed)
        g.st = [Counter(), Counter()]
        g.snap = [{}, {}]
        g.log = None
        g.rollout = True
        ps = []
        for p in s.p:
            q = Player.__new__(Player)
            q.__dict__.update(p.__dict__)
            q.deck, q.hand, q.trash, q.fixer = list(p.deck), list(p.hand), list(p.trash), list(p.fixer)
            q.gigs = [list(x) for x in p.gigs]
            q.drawn, q.early, q.played = set(), set(), Counter()
            lm = {}
            q.legs = []
            for l in p.legs:
                l2 = Leg.__new__(Leg)
                l2.__dict__.update(l.__dict__)
                l2.gear = list(l.gear)
                q.legs.append(l2)
                lm[id(l)] = l2
            q.field = []
            for u in p.field:
                u2 = Unit.__new__(Unit)
                u2.__dict__.update(u.__dict__)
                u2.owner = q
                u2.gear = list(u.gear)
                u2.leg = lm[id(u.leg)] if u.leg is not None else None
                q.field.append(u2)
            ps.append(q)
        ps[0].op, ps[1].op = ps[1], ps[0]
        g.p = ps
        g.cur = ps[s.cur.pi]
        return g

    def play_out(s, mode, nturns):
        """Termina el turno en curso con un plan dado y juega `nturns` turnos más."""
        me = s.cur
        me.forced_mode = mode
        s.finish_turn(me)
        i = 1 - me.pi
        for _ in range(nturns):
            if s.winner is not None:
                break
            s.turn += 1
            s.take_turn(s.p[i])
            i = 1 - i

    def run(s, maxturns=44):
        i = 0
        while s.winner is None and s.turn < maxturns:
            s.turn += 1
            s.take_turn(s.p[i])
            i = 1 - i
        if s.winner is None:
            a, b = len(s.p[0].gigs), len(s.p[1].gigs)
            s.winner = 0 if a > b else 1 if b > a else -1
        return s.winner


def play(deckA, legA, deckB, legB, N=100, seed=0, collect=None, deep=None, err=None, vf=None):
    """N partidas alternando quién empieza. Devuelve ([victorias A, victorias B, empates], turnos medios).
    collect(game, a_index, a_won) se llama tras cada partida para acumular estadísticas."""
    w = [0, 0, 0]
    turns = 0
    for i in range(N):
        if i % 2 == 0:
            g = Game(deckA, legA, deckB, legB, seed * 100003 + i, deep=deep, err=err, vf=vf)
            r = g.run()
            ai = 0
        else:
            g = Game(deckB, legB, deckA, legA, seed * 100003 + i, deep=None if deep is None else (deep[1], deep[0]),
                     err=None if err is None else (err[1], err[0]), vf=None if vf is None else (vf[1], vf[0]))
            r = g.run()
            ai = 1
        res = 2 if r < 0 else (0 if r == ai else 1)
        w[res] += 1
        turns += g.turn
        if collect is not None:
            collect(g, ai, res)
    return w, turns / max(1, N)
