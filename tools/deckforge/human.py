"""Una persona juega contra el piloto en el Laboratorio.

`Human` sustituye al módulo ai2 como `Game.ai` solo para UNA mano (`pi`): cuando el motor pide una decisión de esa mano, la contesta la
persona (a través de `ask`); todo lo demás —el otro jugador y cualquier copia de previsión (`g.rollout`), donde el piloto simula también
tu turno— sigue en ai2. Con eso el piloto rival juega igual que en una simulación y no puede "preguntarte" nada mientras piensa.

Qué decide la persona: mulligan, qué dado tirar, qué vender / jugar / Call / Go Solo / atacar, objetivos de Gear y de los efectos
(vía `Game.chooser`), cambios y robos de dados, bloqueos y jugadas rápidas, y las habilidades de Hanako, Tuners y River.
Qué sigue automático (el piloto): solo lo que no deja elegir la regla (Hanako unidad: te llevas todas las cartas que valen; el Call al azar;
Panam al final del turno).

    ask(g, kind, prompt, options, extra) -> índice de la opción elegida
"""
import itertools

import ai2
import fx2 as fx
import human_react as HR
from ai2_cards import _judy_leg, _tunable, _tune_cands
from ai2_dice import _meredith
from engine2 import CARD
from fx2 import ALT, HANAKO, JUDY, ON_SPENT_GEAR, RIVER
from fx2_base import choose_mode, pick_gear_target
from fx2_programs import PROG

MAIN_ACTIONS_MAX = 80
# Programas Quick sin efecto al jugarlos desde la mano: solo funcionan como reacción (los ofrece human_react)
REACTION_ONLY = {i for i, c in CARD.items() if c['t'] == 'P' and i not in PROG}
OVERWATCH = HR.OVERWATCH
JUDY_UNIT = 'judy_alvarez_nothing_to_doubt'
KERRY_UNIT = 'kerry_eurodyne_the_last_rockerboy'
PANAM = 'panam_palmer_nomad_cavalry'
EVELYN = 'evelyn_parker_beautiful_enigma'


def _distinct(cards):
    seen, out = set(), []
    for c in cards:
        if c['id'] not in seen:
            seen.add(c['id'])
            out.append(c)
    return out


def _hand_ref(p, c):
    return dict(z='h', side=p.pi, id=c['id'])


def _leg_ref(p, l):
    return dict(z='l', side=p.pi, i=p.legs.index(l))


def _name(cid):
    return CARD[cid]['name'] if cid in CARD else str(cid)


class Human:
    def __init__(self, pi, ask, base=ai2, choose_pay=True):
        self.pi = pi
        self._ask = ask
        self._base = base
        self.choose_pay = choose_pay      # False: se paga como lo haría el piloto (sin preguntar)
        self.ctx = None                   # carta o habilidad que se está resolviendo (para el texto de las preguntas)

    def __getattr__(self, name):
        if name.startswith('_'):
            raise AttributeError(name)
        return getattr(self._base, name)

    def mine(self, g, p):
        return p.pi == self.pi and not g.rollout

    def ask(self, g, kind, prompt, options, **extra):
        i = self._ask(g, kind, prompt, options, extra)
        if not 0 <= i < len(options):
            raise ValueError(f'respuesta fuera de rango: {i} de {len(options)}')
        return i

    # ------------------------------------------------------------------ inicio de partida y de turno
    def mulligan(self, g, p):
        if not self.mine(g, p):
            return self._base.mulligan(g, p)
        opts = [dict(label='Quedarme con esta mano', group='fin'), dict(label='Mulligan: devolver la mano y robar 6 cartas nuevas', group='fin')]
        return self.ask(g, 'mulligan', 'Tu mano inicial (solo puedes hacer mulligan una vez)', opts) == 1

    def pick_die(self, g, me):
        if not self.mine(g, me):
            return self._base.pick_die(g, me)
        dice = sorted(d for d in me.fixer if d != 20) or list(me.fixer)
        if len(dice) == 1:
            return dice[0]
        opts = [dict(label=f'Tirar el d{d}', group='dado', die=d) for d in dice]
        return dice[self.ask(g, 'die', 'Elige qué dado de tu zona de fixer tiras como Gig', opts)]

    # ------------------------------------------------------------------ dados
    def pick_steal(self, g, me, op, cands):
        if not self.mine(g, me) or len(cands) == 1:
            return self._base.pick_steal(g, me, op, cands)
        opts = [dict(label=f'Robar el d{x[0]} del rival (valor {x[1]})', group='dado', die=x[0], value=x[1]) for x in cands]
        return cands[self.ask(g, 'steal', 'Elige qué Gig robas', opts)]

    def _die_label(self, me, owner, x):
        return f"{'Tu' if owner is me else 'Su'} d{x[0]} (valor {x[1]})"

    def gig_change(self, g, me, cands, src, bonus=None, thr=0.05, dry=False):
        if dry or not self.mine(g, me) or not cands:
            return self._base.gig_change(g, me, cands, src, bonus, thr, dry)
        by_die = {}
        for owner, x, nv in cands:
            by_die.setdefault(id(x), (owner, x, []))[2].append(nv)
        dice = [v for v in by_die.values() if any(nv != v[1][1] for nv in v[2])]
        if not dice:
            return None
        why = self.ctx or (_name(src) if src else 'Efecto')
        opts = [dict(label=self._die_label(me, o, x), group='dado', die=x[0], value=x[1]) for o, x, _ in dice]
        opts.append(dict(label='No cambiar ningún dado', group='fin'))
        i = self.ask(g, 'dice', f'{why}: ¿qué dado cambias?', opts)
        if i == len(dice):
            return None
        owner, x, values = dice[i]
        values = sorted({v for v in values if v != x[1]})
        vopts = [dict(label=f'Pasar a {v}', group='dado', die=x[0], value=v) for v in values]
        vopts.append(dict(label='Mejor no cambiarlo', group='fin'))
        j = self.ask(g, 'dice', f"{why}: nuevo valor para {self._die_label(me, owner, x)}", vopts)
        if j == len(values):
            return None
        nv = values[j]
        x[1] = nv
        g.ev(me, 'gigadj', src)
        if owner is not me:
            _meredith(g, owner)
        return (x, nv)

    def gig_swap(self, g, me, op, src, thr=0.3):
        if not self.mine(g, me) or not me.gigs or not op.gigs:
            return self._base.gig_swap(g, me, op, src, thr)
        why = self.ctx or _name(src)
        mine = [dict(label=self._die_label(me, me, x), group='dado', die=x[0], value=x[1]) for x in me.gigs]
        mine.append(dict(label='No intercambiar', group='fin'))
        i = self.ask(g, 'dice', f'{why}: ¿qué dado tuyo das?', mine)
        if i == len(me.gigs):
            return False
        theirs = [dict(label=self._die_label(me, op, x), group='dado', die=x[0], value=x[1]) for x in op.gigs]
        theirs.append(dict(label='Mejor no intercambiar', group='fin'))
        j = self.ask(g, 'dice', f'{why}: ¿qué dado del rival coges?', theirs)
        if j == len(op.gigs):
            return False
        me.gigs[i], op.gigs[j] = op.gigs[j], me.gigs[i]
        g.ev(me, 'gigadj', src)
        _meredith(g, op)
        return True

    # ------------------------------------------------------------------ objetivos de efectos
    def choose(self, g, kind, cands, why=None, who=None):
        """Gancho de Game.chooser: elige entre los objetivos que el motor da por posibles (None = que decida el motor).
        kind = unit | card | mode (efectos de «elige uno»: cands = [(clave, texto)]); `why` dice de qué carta; `who` es quien decide
        (por defecto, quien tiene el turno: hay efectos en que elige el rival o cada jugador sobre lo suyo)."""
        if g.rollout or (who or g.cur).pi != self.pi:
            return None
        if kind == 'mode':
            opts = [dict(label=text, group='modo') for _, text in cands]
            return cands[self.ask(g, 'mode', f'{why or self.ctx or "Efecto"}: elige un efecto', opts)]
        me = g.p[self.pi]
        if kind == 'gear':                         # a quién se equipa un Gear que entra gratis (Unidad o Legend)
            return cands[self.ask(g, 'target', f"{why or 'Gear'}: ¿a qué se equipa?", [self._target_option(g, me, t) for t in cands])]
        labels = [HR.unit_label(g, u, me) for u in cands] if kind == 'unit' else [c['name'] for c in cands]
        why = f'{why}: elige' if why else (f'{self.ctx}: elige' if self.ctx else 'Elige')
        opts = [dict(label=lab, group='objetivo', **({'ref': HR.unit_ref(c)} if kind == 'unit' else {})) for lab, c in zip(labels, cands)]
        return cands[self.ask(g, 'target', f"{why} {'una Unidad' if kind == 'unit' else 'una carta'}", opts)]

    # ------------------------------------------------------------------ pagar
    def pay(self, g, p, n, keep):
        """Gancho de Game.payer: la persona elige con qué Legends paga `n` € (el resto sale de los Eddies sueltos, que no se distinguen).
        None = que lo decida el motor: no es la persona, está desactivado, no alcanza el dinero o solo hay una forma de pagar."""
        if not self.choose_pay or not self.mine(g, p) or n <= 0:
            return None
        legs = [l for l in p.legs if l.ready and not l.gone and l not in keep]
        low, high = max(0, n - p.Eready), min(n, len(legs))
        if low > high:
            return None
        combos = [c for k in range(low, high + 1) for c in itertools.combinations(range(len(legs)), k)]
        if len(combos) == 1:
            return None
        opts = []
        for c in combos:
            loose = n - len(c)
            plural = 's' if loose != 1 else ''
            parts = ([f'{loose} Eddie{plural} suelto{plural}'] if loose else []) + [legs[j].c['name'].split(':')[0] for j in c]
            opts.append(dict(label='Pagar con ' + ' + '.join(parts), group='pago', legs=[p.legs.index(legs[j]) for j in c], eddies=loose))
        why = f' por {self.ctx}' if self.ctx else ''
        chosen = combos[self.ask(g, 'pay', f'Pagas {n} €{why}: ¿con qué?', opts, need=n)]
        for j in chosen:
            g.spend_leg(p, legs[j])
        p.Eready -= n - len(chosen)
        return True

    # ------------------------------------------------------------------ defensa y refuerzo
    def react(self, g, df, at, a, tgt):
        if not self.mine(g, df):
            return self._base.react(g, df, at, a, tgt)
        return HR.defend(self.ask, g, df, at, a, tgt)

    def attacker_pump(self, g, me, op, u, tgt):
        if not self.mine(g, me):
            return self._base.attacker_pump(g, me, op, u, tgt)
        return HR.pump(self.ask, g, me, op, u, tgt)

    # ------------------------------------------------------------------ el turno
    def main(self, g, me, op):
        if not self.mine(g, me):
            return self._base.main(g, me, op)
        me.mode, me.phase, me.reserve = 'default', 'pre', 0
        for _ in range(MAIN_ACTIONS_MAX):
            if g.winner is not None:
                return
            acts = self._actions(g, me, op)
            forced = any(u.must and g.targets(u) for u in me.field)
            if not forced:
                acts.append((dict(label='Terminar el turno', group='fin'), None))
            i = self.ask(g, 'action', self._turn_prompt(g, me, op, forced), [a[0] for a in acts])
            if acts[i][1] is None:
                return
            self.ctx = acts[i][0].get('ctx')
            try:
                acts[i][1]()
            finally:
                self.ctx = None

    def _turn_prompt(self, g, me, op, forced):
        s = f"Tu turno {(g.turn + 1) // 2} · {g.avail(me)} € disponibles · Gigs {len(me.gigs)}-{len(op.gigs)}"
        return s + ' · tienes una Unidad obligada a atacar' if forced else s

    def _actions(self, g, me, op):
        acts = []
        acts += self._sell_actions(g, me)
        acts += self._play_actions(g, me)
        acts += self._call_actions(g, me)
        acts += self._gosolo_actions(g, me)
        acts += self._attack_actions(g, me, op)
        acts += self._ability_actions(g, me, op)
        return acts

    def _sell_actions(self, g, me):
        if me.sold:
            return []
        out = []
        for c in _distinct(x for x in me.hand if x['sell']):
            def sell(c=c):
                me.hand.remove(c)
                me.E += 1
                me.Eready += 1
                me.sold = True
                g.tr(me, f"vende {c['name']} (+1 €)")
            out.append((dict(label=f"Vender {c['name']} (+1 €)", group='vender', card=c['id'], src=_hand_ref(me, c)), sell))
        return out

    def _gear_targets(self, me, c):
        out = list(me.field)
        if c['id'] in ON_SPENT_GEAR:
            out += [l for l in me.legs if l.up and not l.gone]
        return out

    def _play_actions(self, g, me):
        out = []
        budget = g.avail(me)
        for c in _distinct(me.hand):
            cost = g.ccost(me, c)
            if c['id'] in REACTION_ONLY or cost > budget:
                continue
            if c['t'] == 'G' and not self._gear_targets(me, c):
                continue
            out.append((dict(label=f"Jugar {c['name']} ({cost} €)", group='jugar', card=c['id'], cost=cost, ctx=c['name'], src=_hand_ref(me, c)),
                        lambda c=c: self._play(g, me, c)))
        return out

    def _play(self, g, me, c):
        tgt = None
        if c['t'] == 'G':
            targets = self._gear_targets(me, c)
            tgt = targets[0] if len(targets) == 1 else targets[self.ask(
                g, 'target', f"{c['name']}: ¿a qué se equipa?", [self._target_option(g, me, t) for t in targets])]
        me.hand.remove(c)
        g.play_card(me, c, target=tgt)

    def _target_option(self, g, me, t):
        """Opción «equiparlo a t» (una Unidad o una Legend tuya), con su lugar en el tablero para elegirla con un clic."""
        if hasattr(t, 'owner'):
            return dict(label=HR.unit_label(g, t, me), group='objetivo', ref=HR.unit_ref(t))
        return dict(label=f"{t.c['name']} (Legend)", group='objetivo', ref=_leg_ref(me, t))

    def _call_actions(self, g, me):
        down = [l for l in me.legs if not l.up and not l.gone]
        if me.called or not down or g.avail(me) < 1:
            return []
        out = []
        for l in [x for x in down if x.known]:
            out.append((dict(label=f"Call (1 €): girar {l.c['name']} (la conoces)", group='legend', card=l.c['id'], src=_leg_ref(me, l)), lambda l=l: g.call(me, pick=l)))
        unknown = [x for x in down if not x.known]
        if unknown:
            out.append((dict(label=f'Call (1 €): girar una Legend al azar ({len(unknown)} desconocidas)', group='legend', src=dict(z='lz', side=me.pi)),
                        lambda: g.call(me, pick=g.rng.choice(unknown))))
        return out

    def _gosolo_actions(self, g, me):
        out = []
        for l in me.legs:
            if l.up and not l.gone and l.c['gosolo']:
                cost = fx.gs_cost(g, me, l)
                if g.avail(me, keep=(l,)) >= cost:
                    out.append((dict(label=f"Go Solo con {l.c['name']} ({cost} €)", group='legend', card=l.c['id'], cost=cost, ctx=l.c['name'], src=_leg_ref(me, l)),
                                lambda l=l: g.go_solo(me, l)))
        return out

    def _attack_actions(self, g, me, op):
        out = []
        for u in me.field:
            power = g.power(u, atk=True)
            for t in g.targets(u):
                if t is None:
                    n = min(power // 10 + 1, len(op.gigs)) if power > 0 else 0
                    dest = f'los Gigs del rival (roba {n})'
                else:
                    dest = HR.unit_label(g, t, me)
                out.append((dict(label=f"Atacar con {u.c['name']} (poder {power}) → {dest}", group='atacar', card=u.c['id'],
                                  tgt=None if t is None else t.c['id'], src=HR.unit_ref(u),
                                  to=dict(z='g', side=op.pi) if t is None else HR.unit_ref(t)),
                            lambda u=u, t=t: g.attack(u, t)))
        return out

    # ------------------------------------------------------------------ habilidades
    def _ability_actions(self, g, me, op):
        out = []
        h = me.leg(HANAKO)
        if h is not None and h.ready and me.gigs and op.gigs:
            out.append((dict(label='Hanako: intercambiar uno de tus Gigs con uno del rival', group='habilidad', card=HANAKO, ctx='Hanako', src=_leg_ref(me, h)),
                        lambda: self._hanako(g, me, op, h)))
        for l in me.legs:
            if _tunable(g, me, l):
                out.append((dict(label=f"{l.c['name']}: gastarla para cambiar el valor de un Gig", group='habilidad', card=l.c['id'], ctx=l.c['name'], src=_leg_ref(me, l)),
                            lambda l=l: self._tune(g, me, op, l)))
        river = me.leg(RIVER)
        if river is not None and river.ready and me.field:
            for c in _distinct(x for x in me.hand if x['t'] == 'G' and x['cost'] <= 2):
                out.append((dict(label=f"River Ward: jugar gratis {c['name']}", group='habilidad', card=RIVER, ctx='River Ward', src=_leg_ref(me, river)),
                            lambda c=c: self._river(g, me, river, c)))
        j = me.leg(JUDY)
        if j is not None and j.ready and me.deck:
            out.append((dict(label='Judy: gastarla, mirar la carta de arriba (si es Programa va a tu mano)', group='habilidad', card=JUDY, src=_leg_ref(me, j)),
                        lambda: _judy_leg(g, me)))
        out += self._alt_actions(g, me) + self._overwatch_actions(g, me, op) + self._panam_actions(g, me) + self._evelyn_actions(g, me, op)
        return out + self._unit_ability_actions(g, me)

    def _alt_actions(self, g, me):
        """Alt Cunningham: descuento para el próximo Programa, o jugar un Programa de la basura (mismos efectos que usa el piloto)."""
        alt = me.leg(ALT)
        if alt is None or not alt.ready:
            return []
        out = []
        mins = fx.mins(me)
        if mins >= 1 and not me.alt_disc:
            def discount():
                g.spend_leg(me, alt)
                me.alt_disc = mins
                g.ev(me, 'discount', ALT, mins)
            out.append((dict(label=f'Alt Cunningham: gastarla; tu próximo Programa cuesta {mins} menos (uno por cada Gig de valor 1)',
                             group='habilidad', card=ALT, ctx='Alt Cunningham', src=_leg_ref(me, alt)), discount))
        for x in _distinct(c for c in me.trash if c['t'] == 'P' and not c['quick']):
            cost = g.ccost(me, x)
            if g.avail(me, keep=(alt,)) >= 1 + cost:
                def replay(x=x):
                    g.pay(me, 1, keep=(alt,))
                    g.spend_leg(me, alt)
                    me.trash.remove(x)
                    g.ev(me, 'free', ALT)
                    g.play_card(me, x, pay=True, bottom_after=True)
                out.append((dict(label=f"Alt Cunningham: jugar {x['name']} desde tu basura ({1 + cost} €; después va al fondo del mazo)",
                                 group='habilidad', card=ALT, ctx=x['name'], src=_leg_ref(me, alt)), replay))
        return out

    def _overwatch_actions(self, g, me, op):
        """Overwatch en tu turno: 1 €, gasta la Unidad equipada y descarta una carta para derrotar a una Unidad rival gastada de coste <= el de la descartada."""
        u = next((u for u in me.field if u.ready and not u.lag and any(x['id'] == OVERWATCH for x in u.gear)), None)
        if u is None or not me.hand or g.avail(me) < 1:
            return []
        out = []
        for t in op.field:
            if not t.ready and any(c['cost'] >= t.c['cost'] for c in me.hand):
                out.append((dict(label=f"Overwatch (1 €): derrotar a {HR.unit_label(g, t, me)} descartando una carta", group='habilidad',
                                 card=OVERWATCH, ctx='Overwatch', src=HR.unit_ref(u), to=HR.unit_ref(t)),
                                lambda t=t: self._overwatch(g, me, u, t)))
        return out

    def _overwatch(self, g, me, u, t):
        eligible = _distinct(c for c in me.hand if c['cost'] >= t.c['cost'])
        x = eligible[0] if len(eligible) == 1 else eligible[self.ask(
            g, 'target', f"Overwatch: ¿qué carta descartas? (coste {t.c['cost']} o más)", [dict(label=c['name'], group='objetivo', ref=_hand_ref(me, c)) for c in eligible])]
        me.hand.remove(x)                      # el descarte sale ANTES de pagar y gastar (pueden mover la mano)
        me.trash.append(x)
        g.pay(me, 1)
        g.spend_unit(u)
        g.ev(me, 'react', OVERWATCH)
        g.defeat(t, OVERWATCH, by=me)

    def _panam_actions(self, g, me):
        """Panam: 2 €, gástala para mover un Gear suyo a una Unidad tuya sin equipo, que se prepara (un ataque más)."""
        pn = me.leg(PANAM)
        if pn is None or not pn.ready or not pn.gear or g.avail(me, keep=(pn,)) < 2 or not any(not u.gear for u in me.field):
            return []
        return [(dict(label='Panam (2 €): mover un Gear de Panam a una Unidad sin equipo y prepararla', group='habilidad', card=PANAM, ctx='Panam',
                      src=_leg_ref(me, pn)), lambda: self._panam(g, me, pn))]

    def _panam(self, g, me, pn):
        gears = list(pn.gear)
        x = gears[0] if len(gears) == 1 else gears[self.ask(g, 'target', 'Panam: ¿qué Gear mueves?', [dict(label=c['name'], group='objetivo') for c in gears])]
        targets = [u for u in me.field if not u.gear]
        u = targets[0] if len(targets) == 1 else targets[self.ask(
            g, 'target', f"Panam: ¿a qué Unidad pasa {x['name']}?", [self._target_option(g, me, t) for t in targets])]
        g.pay(me, 2, keep=(pn,))
        g.spend_leg(me, pn)
        pn.gear.remove(x)
        u.gear.append(x)
        u.ready = True
        g.ev(me, 'ready', PANAM)

    def _evelyn_actions(self, g, me, op):
        """Evelyn: 1 €, gástala para que una Unidad rival preparada deba atacar el próximo turno."""
        ev = me.leg(EVELYN)
        if ev is None or not ev.ready or g.avail(me, keep=(ev,)) < 1 or not any(t.ready and not t.must and not t.c['noatk'] for t in op.field):
            return []
        return [(dict(label='Evelyn (1 €): una Unidad rival debe atacar el próximo turno si puede', group='habilidad', card=EVELYN, ctx='Evelyn',
                      src=_leg_ref(me, ev)), lambda: self._evelyn(g, me, op, ev))]

    def _evelyn(self, g, me, op, ev):
        cands = [t for t in op.field if t.ready and not t.must and not t.c['noatk']]
        t = cands[0] if len(cands) == 1 else cands[self.ask(
            g, 'target', 'Evelyn: ¿qué Unidad rival debe atacar?', [dict(label=HR.unit_label(g, c, me), group='objetivo', ref=HR.unit_ref(c)) for c in cands])]
        g.pay(me, 1, keep=(ev,))
        g.spend_leg(me, ev)
        t.must = True
        g.ev(me, 'lock', EVELYN)

    def _hanako(self, g, me, op, h):
        if self.gig_swap(g, me, op, HANAKO):
            g.spend_leg(me, h)

    def _tune(self, g, me, op, l):
        if self.gig_change(g, me, _tune_cands(me, op, l), l.c['id']) is not None:
            g.spend_leg(me, l)

    def _river(self, g, me, river, c):
        targets = list(me.field)
        tgt = targets[0] if len(targets) == 1 else targets[self.ask(
            g, 'target', f"{c['name']}: ¿a qué se equipa?", [self._target_option(g, me, t) for t in targets])]
        me.hand.remove(c)
        g.spend_leg(me, river)
        g.ev(me, 'free', RIVER)
        g.play_card(me, c, pay=False, target=tgt)

    def _unit_ability_actions(self, g, me):
        """Judy Alvarez (1 €, gastarla: revela la carta de arriba; la juegas gratis o te la quedas) y Kerry Eurodyne (gastarla: roba 2 con un Gig de 8 o más)."""
        out = []
        for u in me.field:
            if not u.ready or u.lag:
                continue
            cid = u.c['id']
            if cid == JUDY_UNIT and me.deck and g.avail(me) >= 1:
                out.append((dict(label='Judy Alvarez (1 €): gastarla y revelar la carta de arriba; la juegas gratis o te la quedas', group='habilidad',
                                 card=cid, ctx='Judy Alvarez', src=HR.unit_ref(u)), lambda u=u: self._judy_unit(g, me, u)))
            elif cid == KERRY_UNIT and fx.n8(me):
                out.append((dict(label='Kerry Eurodyne: gastarla para robar 2 (tienes un Gig de valor 8 o más)', group='habilidad', card=cid,
                                 ctx='Kerry Eurodyne', src=HR.unit_ref(u)), lambda u=u: self._kerry_unit(g, me, u)))
        return out

    def _judy_unit(self, g, me, u):
        g.pay(me, 1)
        g.spend_unit(u)
        x = me.deck.pop()
        me.drawn.add(x['id'])
        g.ev(me, 'free', u.c['id'])
        g.tr(me, f"Judy Alvarez revela {x['name']}")
        playable = x['id'] not in REACTION_ONLY and (x['t'] != 'G' or g.ai.gear_target(g, me, x) is not None)
        if playable and choose_mode(g, me, [('play', f"Jugar {x['name']} gratis"), ('hand', f"Añadir {x['name']} a tu mano")], 'Judy Alvarez') == 'play':
            g.play_card(me, x, pay=False, target=pick_gear_target(g, me, x) if x['t'] == 'G' else None)
        else:
            me.hand.append(x)

    def _kerry_unit(self, g, me, u):
        g.spend_unit(u)
        g.draw(me, 2, u.c['id'])
