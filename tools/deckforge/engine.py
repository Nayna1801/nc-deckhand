import random, itertools
DICE = [4, 6, 8, 10, 12, 20]
import os
KEEP_BLOCKERS = os.environ.get('KB', '1') == '1'
DRAW_SCALE = float(os.environ.get('DS', '1'))
BLOCK_PEN = 2


def U(cost, power, name=None, **kw):
    return dict(kind='U', cost=cost, power=power, name=name or f'U{cost}/{power}', sell=False, **kw)


def G(cost, power, name=None, **kw):
    return dict(kind='G', cost=cost, power=power, name=name or f'G{cost}/{power}', sell=True, **kw)


def P(cost, name=None, **kw):
    return dict(kind='P', cost=cost, power=0, name=name or f'P{cost}', sell=True, **kw)


class Player:
    def __init__(s, deck, legends, first, rng):
        s.rng = rng
        s.deck = [dict(c) for c in deck]
        rng.shuffle(s.deck)
        s.legends = [dict(l, up=False, ready=True) for l in legends]
        s.first = first
        s.E = 0
        s.Eready = 0
        s.field = []
        s.gigs = []
        s.fixer = list(DICE)
        s.trash = []
        s.hand = [s.deck.pop() for _ in range(6)]
        sell = sum(1 for c in s.hand if c['sell'])
        cheap = sum(1 for c in s.hand if c['kind'] == 'U' and c['cost'] <= 4)
        if sell == 0 or (cheap == 0 and sell < 2):  # mulligan
            s.deck += s.hand
            rng.shuffle(s.deck)
            s.hand = [s.deck.pop() for _ in range(6)]
        if first:
            for l in s.legends[:2]:
                l['ready'] = False
        s.called = False

    def cred(s):
        return sum(v for _, v in s.gigs)

    def draw(s, n=1):
        for _ in range(n):
            if not s.deck:
                return False
            s.hand.append(s.deck.pop())
        return True

    def money(s):
        return s.Eready + sum(1 for l in s.legends if l['ready'] and not l.get('gone'))

    def pay(s, n):
        for _ in range(n):
            if s.Eready > 0:
                s.Eready -= 1
            else:
                l = next(l for l in s.legends if l['ready'] and not l.get('gone'))
                l['ready'] = False

    def ready_blockers(s):
        return [u for u in s.field if u['ready'] and (u['blocker'] or u['gearblk'])]


def new_unit(c):
    return dict(c=c, power=c['power'], gearp=0, gearblk=False, ready=True, lag=True,
                blocker=c.get('blocker', False), adr=c.get('adr', False), noatk=c.get('noatk', False),
                nogig=c.get('nogig', False), name=c['name'], cost=c['cost'])


def upow(u):
    return u['power'] + u['gearp'] + u.get('tmp', 0)


def kill(p, u):
    if u in p.field:
        p.field.remove(u)
    p.trash.append(u['c'])


def fight(pa, pb):
    if pa > pb:
        return (False, pa > 0)
    if pa < pb:
        return (pb > 0, False)
    return (pa > 0, pb > 0)


class Game:
    def __init__(s, deckA, legA, deckB, legB, seed):
        s.rng = random.Random(seed)
        s.p = [Player(deckA, legA, True, s.rng), Player(deckB, legB, False, s.rng)]
        s.turn = 0
        s.winner = None
        s.overtime = False

    def run(s, maxturns=40):
        i = 0
        while s.winner is None and s.turn < maxturns:
            s.turn += 1
            s.take_turn(s.p[i], s.p[1 - i], i)
            if s.turn >= 14:
                s.overtime = True
            i = 1 - i
        if s.winner is None:
            a, b = len(s.p[0].gigs), len(s.p[1].gigs)
            s.winner = 0 if a > b else 1 if b > a else -1
        return s.winner

    def take_turn(s, me, op, idx):
        if len(me.gigs) >= 7:
            s.winner = idx
            return
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
            me.gigs.append((d, s.rng.randint(1, d)))
        me.called = False
        me.prog = False
        for u in me.field:
            u.pop('adr_tmp', None)
        s.main(me, op, idx)

    def main(s, me, op, idx):
        sell = [c for c in me.hand if c['sell']]
        if sell and me.E < 9:
            c = min(sell, key=lambda x: x.get('keep', x['cost'] + (2 if x['kind'] == 'G' else 0)))
            me.hand.remove(c)
            me.E += 1
            me.Eready += 1
        s.maybe_call(me)
        s.free_gear(me)
        s.maybe_gosolo(me, op)
        s.play_cards(me, op)
        s.free_gear(me)
        s.maybe_gosolo(me, op)
        s.attack(me, op, idx)

    def maybe_call(s, me):
        if me.called:
            return
        down = [l for l in me.legends if not l['up']]
        if not down:
            return
        gs = [l['gosolo'][0] for l in me.legends if l.get('gosolo') and not l.get('gone')]
        cd = any(l.get('call_draw') or l.get('free_gear') for l in down) or any(c['kind'] == 'U' and c.get('lb') for c in me.deck + me.hand + [x['c'] for x in me.field])
        if not gs and not cd:
            return
        need = (min(gs) + 1) if gs else 3
        if me.money() >= need:
            me.pay(1)
            me.called = True
            l = s.rng.choice(down)
            l['up'] = True
            if l.get('call_draw'):
                me.draw(s.cnt(l['call_draw']))

    def maybe_gosolo(s, me, op):
        for l in me.legends:
            if l['up'] and l.get('gosolo') and not l.get('gone'):
                cost, pw = l['gosolo']
                avail = me.Eready + sum(1 for x in me.legends if x['ready'] and x is not l and not x.get('gone'))
                if avail >= cost:
                    n = cost
                    while n > 0 and me.Eready > 0:
                        me.Eready -= 1
                        n -= 1
                    for x in me.legends:
                        if n == 0:
                            break
                        if x is not l and x['ready'] and not x.get('gone'):
                            x['ready'] = False
                            n -= 1
                    l['gone'] = True
                    l['ready'] = False
                    u = new_unit(U(cost, pw, l.get('name', 'LEG')))
                    u['lag'] = False
                    u['legend'] = True
                    me.field.append(u)
                    if l.get('rem'):
                        s.remove_rival(me, op, l['rem'])

    def cnt(s, x):
        x = x * DRAW_SCALE
        n = int(x)
        return n + (1 if s.rng.random() < x - n else 0)

    def free_gear(s, me):
        for l in me.legends:
            if l['up'] and l.get('free_gear') and not l.get('gone') and me.field:
                gs = [c for c in me.hand if c['kind'] == 'G' and c['cost'] <= 2]
                if gs:
                    c = max(gs, key=lambda x: x['power'])
                    me.hand.remove(c)
                    u = min(me.field, key=lambda u: (u['gearp'], -u['power']))
                    u['gearp'] += c['power']
                    if c.get('blocker'):
                        u['gearblk'] = True

    def targets(s, op, rem, me=None):
        k = rem.get('kind', 'p')
        n = rem['n']
        cond = rem.get('cond')
        if me is not None:
            if cond == 'cred_gt' and not me.cred() > op.cred():
                n = rem.get('n_else', -1)
            if cond == 'cred_lt' and not me.cred() < op.cred():
                return []
            if cond == 'd20' and not any(d == 20 for d, _ in me.gigs):
                return []
            if cond == 'd20':
                n = max(v for d, v in me.gigs if d == 20)
            if rem.get('plus') and me.cred() > op.cred():
                n += rem['plus']
            if rem.get('vs_mine'):
                n = max([upow(u) for u in me.field], default=0) - 1
        pool = [u for u in op.field if (not rem.get('spent') or not u['ready'])]
        if rem.get('lowest'):
            return [min(op.field, key=upow)] if op.field else []
        return [u for u in pool if ((upow(u) <= n) if k == 'p' else (u['cost'] <= n))]

    def remove_rival(s, me, op, rem):
        if rem.get('sweep'):
            for u in list(s.targets(op, rem, me)):
                kill(op, u)
            return
        t = s.targets(op, rem, me)
        if t:
            tgt = max(t, key=lambda u: upow(u) + (3 if u['blocker'] else 0))
            kill(op, tgt)

    def do_spend(s, me, op, sp):
        r = [u for u in op.field if u['ready'] and (sp is True or u['cost'] <= sp.get('cost_le', 99))]
        if r:
            t = max(r, key=upow)
            t['ready'] = False
            if sp is not True and sp.get('lock'):
                t['lock'] = True

    def score(s, me, op, c):
        if c['kind'] == 'U':
            v = c['power'] + (2.5 if c.get('blocker') else 0) + (2 if c.get('adr') else 0) + c.get('draw', 0) * 2 + (4 if c.get('rem') else 0) + (3 if c.get('spend') else 0)
            if c.get('noatk'):
                v -= c['power'] * 0.7
            if c.get('nogig'):
                v -= c['power'] * 0.3
            return v
        if c['kind'] == 'G':
            return (c['power'] * 1.3 + (2 if c.get('blocker') else 0)) if me.field else 0.0
        v = 0
        if c.get('rem'):
            v += 6 if s.targets(op, c['rem'], me) else 0
        if c.get('spend'):
            v += 3 if op.field else 0
        v += c.get('draw', 0) * 2.2
        return v

    def ccost(s, c, op):
        if c.get('cost_rival'):
            return max(1, c['cost'] - len(op.field))
        return c['cost']

    def play_cards(s, me, op):
        for _ in range(6):
            money = me.money()
            cand = list(me.hand)
            n = len(cand)
            best = (0, [])
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
                if c['kind'] == 'P':
                    me.prog = True
                played = True
                if c['kind'] == 'U':
                    me.field.append(new_unit(c))
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
                    else:
                        me.trash.append(c)
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
                    me.trash.append(c)
            if not played:
                return

    def overwatch(s, me, op):
        for u in list(me.field):
            if not u.get('ow') or me.money() < 1:
                continue
            spent = [x for x in op.field if not x['ready']]
            if not spent or not me.hand:
                continue
            tgt = max(spent, key=lambda x: upow(x))
            disc = [c for c in me.hand if c['cost'] >= tgt['cost']]
            if disc:
                d = min(disc, key=lambda c: (c['kind'] == 'U', c['cost']))
                me.hand.remove(d)
                me.pay(1)
                kill(op, tgt)

    def attack(s, me, op, idx):
        s.overwatch(me, op)
        atk = [u for u in me.field if u['ready'] and not u['noatk'] and (not u['lag'] or u['adr'] or u.get('adr_tmp') or u.get('legend') or (u['c'].get('adr_behind') and len(op.gigs) > len(me.gigs))) and (not u['c'].get('needs_prog') or me.prog)]
        allup = all(l['up'] for l in me.legends)
        for u in me.field:
            u['tmp'] = 0
            if u['c'].get('lb') and allup:
                u['tmp'] += 5
        if any(u['c'].get('saul') for u in me.field):
            for u in me.field:
                if not u['c'].get('saul'):
                    u['tmp'] += 2
        nb = len(op.ready_blockers())
        flood = (s.overtime or len(me.gigs) >= 6) and len([u for u in atk if upow(u) > 0 and not u['nogig']]) > nb
        for u in sorted(atk, key=upow):
            if s.winner is not None:
                return
            if u not in me.field or not u['ready']:
                continue
            if flood and upow(u) > 0 and not u['nogig'] and op.gigs:
                s.attack_gig(me, op, u, upow(u), idx)
                continue
            P_ = upow(u)
            home = (u['blocker'] or u['gearblk']) and KEEP_BLOCKERS
            op_threats = [x for x in op.field if upow(x) > 0]
            if home and len(me.gigs) < 6 and op_threats:
                continue
            blockers = op.ready_blockers()
            maxb = max([upow(b) for b in blockers], default=-1)
            spent = [x for x in op.field if not x['ready']]
            kill_t = [x for x in spent if upow(x) < P_]
            do_gig = P_ > 0 and op.gigs and not u['nogig'] and (not blockers or P_ > maxb or (len(me.gigs) >= 5 and P_ >= maxb))
            if do_gig:
                s.attack_gig(me, op, u, P_, idx)
            elif kill_t:
                tgt = max(kill_t, key=upow)
                u['ready'] = False
                kill(op, tgt)
            elif op.gigs and P_ > 0 and not u['nogig'] and len(me.gigs) >= 5:
                s.attack_gig(me, op, u, P_, idx)
        for u in list(me.field):
            u['tmp'] = 0
            if u.get('vigil'):
                u['ready'] = True
            if u['c'].get('bounce'):
                me.field.remove(u)
                me.hand.append(u['c'])
        if any(u['c'].get('saul') for u in me.field):
            sp = sorted([u for u in me.field if not u['ready']], key=upow, reverse=True)[:3]
            for u in sp:
                u['ready'] = True

    def attack_gig(s, me, op, u, P_, idx):
        u['ready'] = False
        X = 0 if P_ <= 0 else P_ // 10 + 1
        blockers = op.ready_blockers()
        if blockers:
            beat = [b for b in blockers if upow(b) > P_]
            tie = [b for b in blockers if upow(b) == P_]
            b = None
            if beat:
                b = min(beat, key=upow)
            elif tie:
                b = tie[0]
            elif X >= 2 or len(me.gigs) + X >= 7 or len(op.gigs) - X <= 1:
                b = min(blockers, key=upow)
            if b is not None:
                b['ready'] = False
                da, db = fight(P_, upow(b))
                if da:
                    kill(me, u)
                if db:
                    kill(op, b)
                return
        if u.get('xsteal') and P_ > 0:
            X += 1
        n = min(X, len(op.gigs))
        for _ in range(n):
            g = max(op.gigs, key=lambda x: x[1])
            op.gigs.remove(g)
            me.gigs.append(g)
        if s.overtime and len(me.gigs) >= 7 and s.winner is None:
            s.winner = idx


def play(deckA, legA, deckB, legB, N=500, seed=0):
    w = [0, 0, 0]
    turns = []
    for i in range(N):
        if i % 2 == 0:
            g = Game(deckA, legA, deckB, legB, seed * 100000 + i)
            res = g.run()
        else:
            g = Game(deckB, legB, deckA, legA, seed * 100000 + i)
            r = g.run()
            res = {0: 1, 1: 0, -1: -1}[r]
        w[res if res >= 0 else 2] += 1
        turns.append(g.turn)
    return w, sum(turns) / len(turns)


def first_player_rate(deck, leg, N=600, seed=0):
    f = 0
    t = []
    for i in range(N):
        g = Game(deck, leg, deck, leg, seed * 100000 + i)
        r = g.run()
        f += (r == 0)
        t.append(g.turn)
    return f / N, sum(t) / len(t)
