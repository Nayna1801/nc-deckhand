"""Motor v1.5: el motor v1 + manipulación de Gigs (bajar/subir/fijar/intercambiar), mínimos, parejas, Street Cred y habilidades
de las Legends que más pesan (Jackie: Pour One Out, Hanako, Alt, Judy, Lucyna) y de las cartas asociadas."""
from collections import Counter
import engine as E
from engine import Game, new_unit, upow, kill, fight, U

JACKIE = 'jackie_welles_pour_one_out_for_me'
HANAKO = 'hanako_arasaka_daughter_of_the_emperor'
ALT = 'alt_cunningham_soulkiller_architect'
JUDY = 'judy_alvarez_braindance_maestro'
LUCYNA = 'lucyna_kushinada_fresh_beginnings'


def pairs(p):
    return sum(c // 2 for c in Counter(v for _, v in p.gigs).values())


def mins(p):
    return sum(1 for d, v in p.gigs if v == 1)


class GameX(Game):
    def __init__(s, *a, **k):
        super().__init__(*a, **k)
        for p in s.p:
            ids = {c.get('id') for c in p.deck + p.hand}
            lids = {l.get('id') for l in p.legends}
            p.want_low = bool(ids & {'towerfall', 'mt0d12_flathead', 'modded_muramasa'})
            p.want_pairs = (HANAKO in lids) or bool(ids & {'sandayu_oda_hanako_s_guardian', 'pepe_najarro_working_doubles'})
            p.want_min = bool(lids & {ALT, JACKIE, LUCYNA}) or bool(ids & {'three_mouths_one_desire', 'trust_no_one'})
            p.want_high = bool(ids & {'valentino_guerrera', 'minotaur', 'royce_don_t_call_me_simon'})
            p.alt_disc = 0
            p.jackie_used = False
            p.cur_op = None

    # ------------- objetivo de configuración de Gigs -------------
    def gobj(s, me, op):
        o = 0.0
        if me.want_pairs:
            o += 3.0 * pairs(me)
        if me.want_min:
            o += 1.3 * mins(me)
        if me.want_low:
            o -= 0.35 * (me.cred() - op.cred())
        if me.want_high:
            o += 0.25 * (me.cred() - op.cred())
        return o

    def best_mod(s, me, op, mods, bonus_min=0.0):
        base = s.gobj(me, op)
        best = None
        for g, nv in mods:
            old = g[1]
            g[1] = nv
            o = s.gobj(me, op) + (bonus_min if nv == 1 and old != 1 else 0.0)
            g[1] = old
            if o > base + 1e-9 and (best is None or o > best[0]):
                best = (o, g, nv)
        return best

    def dec_best(s, me, op, n, bonus_min=0.0):
        mods = []
        for g in me.gigs:
            for nv in range(max(1, g[1] - n), g[1]):
                mods.append((g, nv))
        b = s.best_mod(me, op, mods, bonus_min)
        if b:
            b[1][1] = b[2]
            return b[1]
        return None

    def adjust_one(s, me, op):
        mods = []
        for g in me.gigs:
            for nv in (g[1] - 1, g[1] + 1):
                if 1 <= nv <= g[0]:
                    mods.append((g, nv))
        b = s.best_mod(me, op, mods)
        if b:
            b[1][1] = b[2]

    def peace_offering(s, me, op):
        vals = {g[1] for g in me.gigs} | {g[1] for g in op.gigs}
        mods = [(g, v) for g in me.gigs for v in vals if v != g[1] and v <= g[0]]
        b = s.best_mod(me, op, mods)
        if b:
            b[1][1] = b[2]
        if pairs(me) > 0:
            me.draw(1)

    def hanako_swap(s, me, op):
        base = s.gobj(me, op)
        best = None
        for a in me.gigs:
            for b in op.gigs:
                me.gigs.remove(a)
                op.gigs.remove(b)
                me.gigs.append(b)
                op.gigs.append(a)
                o = s.gobj(me, op)
                me.gigs.remove(b)
                op.gigs.remove(a)
                me.gigs.append(a)
                op.gigs.append(b)
                if o > base + 1.0 and (best is None or o > best[0]):
                    best = (o, a, b)
        if best:
            _, a, b = best
            me.gigs.remove(a)
            op.gigs.remove(b)
            me.gigs.append(b)
            op.gigs.append(a)
            return True
        return False

    # ------------- turno -------------
    def take_turn(s, me, op, idx):
        if len(me.gigs) >= 7:
            s.winner = idx
            return
        # Hanako: al inicio del turno roba por cada pareja
        if any(l.get('id') == HANAKO and l['up'] and not l.get('gone') for l in me.legends):
            me.draw(pairs(me))
        me.Eready = me.E
        first_turn = me.first and s.turn == 1
        for l in me.legends:
            l['ready'] = False if l.get('gone') else True
        if first_turn:
            for l in me.legends[:2]:
                l['ready'] = False
        for u in me.field:
            if u.get('lock'):
                u['lock'] = False
            else:
                u['ready'] = True
            u['lag'] = False
        if not me.draw():
            s.winner = 1 - idx
            return
        opts = [d for d in me.fixer if d != 20] or me.fixer
        if opts:
            d = max(opts)
            me.fixer.remove(d)
            me.gigs.append([d, s.rng.randint(1, d)])
        me.called = False
        me.prog = False
        me.jackie_used = False
        me.alt_disc = 0
        for u in me.field:
            u.pop('adr_tmp', None)
        s.cur_op = op
        s.main(me, op, idx)

    def legend_up(s, me, lid):
        return [l for l in me.legends if l.get('id') == lid and l['up'] and not l.get('gone')]

    def main(s, me, op, idx):
        sell = [c for c in me.hand if c['sell']]
        if sell and me.E < 9:
            c = min(sell, key=lambda x: x.get('keep', x['cost'] + (2 if x['kind'] == 'G' else 0)))
            me.hand.remove(c)
            me.E += 1
            me.Eready += 1
        s.maybe_call(me)
        # Hanako: Spend para intercambiar un Gig
        h = s.legend_up(me, HANAKO)
        if h and h[0]['ready'] and (me.want_pairs or me.want_low):
            if s.hanako_swap(me, op):
                h[0]['ready'] = False
        s.free_gear(me)
        s.maybe_gosolo(me, op)
        s.alt_prepare(me, op)
        s.play_cards(me, op)
        s.alt_replay(me, op)
        s.judy_spend(me)
        s.free_gear(me)
        s.maybe_gosolo(me, op)
        s.attack(me, op, idx)
        for u in list(me.field):
            if u['c'].get('id') == 'modded_muramasa' and me.cred() < op.cred():
                u['ready'] = True

    def maybe_call(s, me):
        if me.called:
            return
        down = [l for l in me.legends if not l['up']]
        if not down:
            return
        gs = [l['gosolo'][0] for l in me.legends if l.get('gosolo') and not l.get('gone')]
        cd = any(l.get('call_draw') or l.get('free_gear') or l.get('engine') for l in down) or any(c['kind'] == 'U' and c.get('lb') for c in me.deck + me.hand + [x['c'] for x in me.field])
        if not gs and not cd:
            return
        need = (min(gs) + 1) if gs else 3
        if me.money() >= need:
            me.pay(1)
            me.called = True
            l = s.rng.choice(down)
            l['up'] = True
            if l.get('id') == LUCYNA:
                me.draw(2 if mins(me) >= 2 else 1)
            elif l.get('call_draw'):
                me.draw(s.cnt(l['call_draw']))

    # ------------- Alt: descuento y reutilización de Programas -------------
    def alt_prepare(s, me, op):
        a = s.legend_up(me, ALT)
        if not a or not a[0]['ready']:
            return
        m = mins(me)
        costly = [c for c in me.hand if c['kind'] == 'P' and c['cost'] >= 3]
        if m >= 2 and costly and me.money() >= 3:
            a[0]['ready'] = False
            me.alt_disc = m

    def alt_replay(s, me, op):
        a = s.legend_up(me, ALT)
        if not a or not a[0]['ready']:
            return
        best = None
        for c in me.trash:
            if c['kind'] != 'P':
                continue
            v = s.score(me, op, c)
            if c.get('id') == 'towerfall' and me.cred() >= op.cred():
                v = 0
            if v > 4 and me.money() >= 1 + c['cost'] and (best is None or v > best[0]):
                best = (v, c)
        if best:
            c = best[1]
            me.trash.remove(c)
            me.pay(1 + c['cost'])
            a[0]['ready'] = False
            s.apply_program(me, op, c)
            me.deck.insert(0, c)

    def judy_spend(s, me):
        j = s.legend_up(me, JUDY)
        if j and j[0]['ready'] and me.money() >= 2 and me.deck:
            j[0]['ready'] = False
            c = me.deck.pop()
            if c['kind'] == 'P':
                me.hand.append(c)
            else:
                me.trash.append(c)

    # ------------- jugar cartas -------------
    def ccost(s, c, op):
        cost = Game.ccost(s, c, op)
        me = s.p[1 - s.p.index(op)] if op in s.p else None
        if me is not None and c['kind'] == 'P' and me.alt_disc:
            cost = max(1, cost - me.alt_disc)
        return cost

    def score(s, me, op, c):
        cid = c.get('id')
        if c['kind'] == 'P' and cid in ('trust_no_one', 'peace_offering', 'three_mouths_one_desire', 'towerfall', 'afterparty_at_lizzie_s', 'memory_relapse', 'chrome_reverie', 'take_control', 'floor_it'):
            if cid == 'trust_no_one':
                return 2.6 if (me.want_min or me.want_low) and me.gigs else 1.0
            if cid == 'peace_offering':
                return 3.0 if me.want_pairs else 1.2
            if cid == 'three_mouths_one_desire':
                return 2.8 + 0.7 * mins(me)
            if cid == 'towerfall':
                return 7.0 if (me.cred() < op.cred() and any(upow(u) <= 5 for u in op.field)) else 0.3
            if cid == 'afterparty_at_lizzie_s':
                return 1.6
            if cid == 'memory_relapse':
                return 3.5 if any(u['ready'] for u in op.field) else 0.5
            if cid == 'chrome_reverie':
                return 1.5
            if cid == 'floor_it':
                return 1.2          # cartera de robo barata; la reacción -1 poder se usa en defensa
            if cid == 'take_control':
                return 0.0          # solo reacción
        return Game.score(s, me, op, c)

    def apply_program(s, me, op, c):
        cid = c.get('id')
        if cid == 'trust_no_one':
            s.dec_best(me, op, 3, bonus_min=1.0)
            if mins(me) > 0:
                me.draw(1)
        elif cid == 'peace_offering':
            s.peace_offering(me, op)
        elif cid == 'three_mouths_one_desire':
            me.draw(min(3, 1 + mins(me)))
        elif cid == 'towerfall':
            if me.cred() < op.cred():
                for u in list(op.field):
                    if upow(u) <= 5:
                        kill(op, u)
        elif cid == 'afterparty_at_lizzie_s':
            s.adjust_one(me, op)
            if len({v for _, v in me.gigs}) >= 2:
                me.draw(1)
        elif cid == 'memory_relapse':
            s.do_spend(me, op, dict(lock=True))
            if me.gigs and me.cred() % 2 == 0:
                me.draw(1)
        elif cid == 'chrome_reverie':
            if mins(me) > 0:
                down = [l for l in me.legends if not l['up']]
                if down:
                    s.rng.choice(down)['up'] = True
        else:
            if c.get('rem'):
                s.remove_rival(me, op, c['rem'])
            if c.get('spend'):
                s.do_spend(me, op, c['spend'])
            if c.get('spend_all'):
                for u in op.field:
                    u['ready'] = False
            if c.get('draw'):
                me.draw(s.cnt(c['draw']))

    def play_cards(s, me, op):
        for _ in range(6):
            reserve = 0
            if any(c.get('id') == 'take_control' for c in me.hand) and len(op.field) > 0 and s.turn >= 3:
                reserve = 2
            money = me.money() - reserve
            cand = list(me.hand)
            n = len(cand)
            best = (0, [])
            import itertools
            for r in range(1, min(n, 5) + 1):
                for comb in itertools.combinations(range(n), r):
                    cs = [cand[i] for i in comb]
                    cost = sum(s.ccost(c, op) for c in cs)
                    if cost > money:
                        continue
                    scs = [s.score(me, op, c) for c in cs]
                    if min(scs) <= 0.9:
                        continue
                    tot = sum(scs) + 0.15 * cost
                    if tot > best[0]:
                        best = (tot, cs)
            if not best[1]:
                return
            order = sorted(best[1], key=lambda c: {'U': 0, 'P': 1, 'G': 2}[c['kind']])
            played = False
            for c in order:
                if s.ccost(c, op) > me.money() or c not in me.hand:
                    continue
                me.hand.remove(c)
                me.pay(s.ccost(c, op))
                played = True
                # Jackie: primer Unidad/Gear azul de cada turno
                if c.get('color') == 'Blue' and c['kind'] in ('U', 'G') and not me.jackie_used and s.legend_up(me, JACKIE):
                    me.jackie_used = True
                    g = s.dec_best(me, op, 2, bonus_min=2.0)
                    if g is not None and g[1] == 1:
                        me.draw(1)
                if c['kind'] == 'U':
                    me.field.append(new_unit(c))
                    cid = c.get('id')
                    if c.get('draw'):
                        me.draw(s.cnt(c['draw']))
                    if c.get('rem'):
                        s.remove_rival(me, op, c['rem'])
                    if c.get('spend'):
                        s.do_spend(me, op, c['spend'])
                    if c.get('spend_self'):
                        me.field[-1]['ready'] = False
                    if c.get('give_adr'):
                        t = [x for x in me.field if x is not me.field[-1] and x['lag'] and x['cost'] <= 5]
                        if t:
                            max(t, key=lambda x: x['power'] + x['gearp'])['adr_tmp'] = True
                    if c.get('free_unit'):
                        fu = [x for x in me.hand if x['kind'] == 'U' and x['cost'] <= c['free_unit']]
                        if fu:
                            x = max(fu, key=lambda x: x['power'])
                            me.hand.remove(x)
                            me.field.append(new_unit(x))
                    if cid == 'field_operator' and me.gigs and me.cred() % 2 == 0:
                        me.draw(1)
                    if cid == 'pacifica_netrunner' and me.gigs and me.cred() % 2 == 0:
                        s.do_spend(me, op, dict(lock=True))
                    if cid == 'sandayu_oda_hanako_s_guardian':
                        for _k in range(pairs(me)):
                            s.do_spend(me, op, True)
                    if cid == 'maxtac_av' and me.gigs and op.gigs:
                        # intercambia su Gig más alto por el más bajo del rival si mejora (o por el objetivo de configuración)
                        a_ = max(me.gigs, key=lambda g: g[1])
                        b_ = min(op.gigs, key=lambda g: g[1])
                        if me.want_low and a_[1] > b_[1] or (not me.want_low and a_[1] < b_[1] and not me.want_pairs):
                            me.gigs.remove(a_)
                            op.gigs.remove(b_)
                            me.gigs.append(b_)
                            op.gigs.append(a_)
                elif c['kind'] == 'G':
                    if me.field:
                        u = min(me.field, key=lambda u: (u['gearp'], -u['power']))
                        u['gearp'] += c['power']
                        if c.get('blocker'):
                            u['gearblk'] = True
                        if c.get('vigil'):
                            u['vigil'] = True
                        if c.get('ow'):
                            u['ow'] = True
                        if c.get('xsteal'):
                            u['xsteal'] = True
                        if c.get('id') == 'dying_night_v_s_pistol':
                            u['dying'] = True
                    else:
                        me.trash.append(c)
                else:
                    me.prog = True
                    s.apply_program(me, op, c)
                    me.alt_disc = 0
                    me.trash.append(c)
            if not played:
                return

    def attack_gig(s, me, op, u, P_, idx):
        cid = u['c'].get('id')
        X0 = 0 if P_ <= 0 else P_ // 10 + 1
        tc = [c for c in op.hand if c.get('id') == 'take_control']
        if tc and op.money() >= 2 and X0 == 1 and op.gigs and not op.ready_blockers():
            op.hand.remove(tc[0])
            op.pay(2)
            op.trash.append(tc[0])
            u['ready'] = False
            return
        fi = [c for c in op.hand if c.get('id') == 'floor_it']
        if fi and op.money() >= 1 and P_ in (10, 20) and op.gigs:
            op.hand.remove(fi[0])
            op.pay(1)
            op.trash.append(fi[0])
            op.draw(1)
            P_ -= 1
        if u.get('dying'):
            s.dec_best(me, op, 2, bonus_min=1.0)
        if cid == 'pepe_najarro_working_doubles' and pairs(me) > 0:
            n = 0
            for l in me.legends:
                if n < 2 and not l['ready'] and not l.get('gone') and 'Merc' in (l.get('tags') or []):
                    l['ready'] = True
                    n += 1
        # MT0D12: no se puede bloquear si tienes menos Street Cred que el rival
        if cid == 'mt0d12_flathead' and me.cred() < op.cred():
            u['ready'] = False
            X = 0 if P_ <= 0 else P_ // 10 + 1
            n = min(X, len(op.gigs))
            for _ in range(n):
                g = max(op.gigs, key=lambda x: x[1])
                op.gigs.remove(g)
                me.gigs.append(g)
            if s.overtime and len(me.gigs) >= 7 and s.winner is None:
                s.winner = idx
            return
        return Game.attack_gig(s, me, op, u, P_, idx)


def play_x(deckA, legA, deckB, legB, N=100, seed=0):
    w = [0, 0, 0]
    turns = 0
    for i in range(N):
        if i % 2 == 0:
            g = GameX(deckA, legA, deckB, legB, seed * 100003 + i)
            r = g.run()
        else:
            g = GameX(deckB, legB, deckA, legA, seed * 100003 + i)
            r = g.run()
            r = {0: 1, 1: 0, -1: -1}[r]
        w[r if r >= 0 else 2] += 1
        turns += g.turn
    return w, turns / N
