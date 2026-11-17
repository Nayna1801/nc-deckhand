"""Partida en vivo: una persona contra el piloto, para la página «Laboratorio».

SIN hilos, para que funcione igual en el Python del ordenador y dentro del navegador (Pyodide no tiene hilos). El motor es
determinista, así que la partida se puede repetir: cada vez que hace falta una decisión de la persona (human.py) se corta la
ejecución con un mensaje `ask` (opciones + consola nueva + tablero SIN lo que esa persona no puede ver); al llegar la respuesta se
vuelve a jugar con las respuestas ya dadas hasta la siguiente pregunta. Para no repetir la partida entera se guarda un punto de
control al empezar cada turno y solo se repite el turno en curso.

Al terminar se publica `end` con la partida completa para repasarla (manos incluidas) y el registro de todas las decisiones tomadas
(el material con el que se compara a la persona con el piloto); con `save` se guarda además en data/human/.

Lo que habría hecho el piloto en cada turno tuyo (`plans`) es lo más caro de calcular y no hace falta hasta el final: con
`plans='lazy'` solo se guarda una copia de la partida y el cálculo se hace en `idle()`, que quien habla con la página llama mientras
la persona piensa (en el navegador, el Worker tras enviar cada mensaje). Lo que quede sin calcular se calcula al terminar.

    s = Session(mi_mazo, mazo_rival, seed, human_first=True)
    msg = s.start()                    # primer mensaje (ask / end / error)
    msg = s.answer(msg['n'], indice)   # siguiente mensaje
"""
import copy
import json
import re
import time
import traceback
import types
from pathlib import Path

import engine2 as X
import human as H
import human_pilot as HP
import lab_sim
import replay as RP

DATA_DIR = Path(__file__).resolve().parent / 'data' / 'human'
OPTION_FIELDS = ('label', 'group', 'card', 'cost', 'die', 'value', 'tgt', 'src', 'to', 'ref', 'legs', 'eddies')
PLAN_SEED_STEP = 1009            # semilla de la copia donde el piloto juega tu turno: propia de cada turno, ajena al azar de la partida
_SELL_LINE = re.compile(r'^(\s*J(\d)) vende .* \(\+1 €\)$')


class _Ask(BaseException):
    """Hace falta una decisión de la persona: corta la partida hasta que conteste (BaseException: ningún `except Exception` del
    motor debe tragársela)."""

    def __init__(self, msg):
        super().__init__()
        self.msg = msg


class Desync(RuntimeError):
    """Al repetir la partida ha salido una pregunta distinta de la que se contestó: el motor no ha sido determinista."""


class Session:
    def __init__(self, mine, rival, seed, human_first=True, strong=True, save=True, choose_pay=True, checkpoints=True, plans=True):
        self.decks = (mine, rival)
        self.pi = 0 if human_first else 1
        self.seed, self.strong, self.save, self.choose_pay = seed, strong, save, choose_pay
        self.checkpoints, self.with_plans = checkpoints, plans
        self.g = self.rec = None
        self.sent = 0                # líneas de consola ya enviadas
        self.n = 0                   # número de la última pregunta hecha en esta pasada
        self.answers = []            # respuestas dadas, en orden
        self.pending = None          # la pregunta que espera respuesta (lo que se anotará en `decisions`)
        self.decisions = []
        self.plans = {}              # turno -> acciones que habría hecho el piloto en tu lugar (human_pilot.turn_plan)
        self.plan_todo = {}          # turno -> copia de la partida donde calcularlo (solo con plans='lazy')
        self.ckpt = None             # (partida y consola al empezar el turno en curso, preguntas hechas hasta entonces)
        self.done = False
        self.started = time.time()

    # ------------------------------------------------------------------ API para quien habla con la página
    def start(self):
        return self._advance()

    def answer(self, n, choice):
        p = self.pending
        if self.done or p is None:
            return dict(type='error', message='no hay ninguna pregunta pendiente')
        if n != p['n'] or not isinstance(choice, int) or isinstance(choice, bool) or not 0 <= choice < len(p['options']):
            return dict(type='error',
                        message=f"respuesta no válida: pregunta {n} (esperaba {p['n']}), opción {choice!r} de {len(p['options'])}")
        self.answers.append(choice)
        self.decisions.append(dict(p, choice=choice, act=p['acts'][choice], t=round(time.time() - self.started, 1)))
        del self.decisions[-1]['acts']
        self.pending = None
        return self._advance()

    def abort(self):
        if not self.done:
            self.done = True
            self._save(aborted=True)

    def idle(self):
        """Adelanta trabajo mientras la persona piensa: calcula un plan pendiente. Devuelve True si queda más por hacer."""
        if self.plan_todo:
            turn = min(self.plan_todo)
            self._run_plan(turn, self.plan_todo.pop(turn))
        return bool(self.plan_todo)

    # ------------------------------------------------------------------ jugar hasta la siguiente pregunta
    def _advance(self):
        try:
            if self.ckpt is None:
                self._begin()
            else:
                self._restore()
            g = self.g
            fresh = False                              # el primer turno tras restaurar ya tiene su punto de control
            while g.winner is None and g.turn < X.MAX_TURNS:
                if fresh and self.checkpoints:
                    self.ckpt = (self._copy((g, self.rec)), self.n)
                fresh = True
                g.next_turn()
            return self._finish(g, self.rec, g.run())
        except _Ask as e:
            return e.msg
        except Exception:
            self.done = True
            return dict(type='error', message=traceback.format_exc(limit=8))

    def _begin(self):
        """Prepara la partida desde la semilla (las preguntas de antes del primer turno se repiten enteras: son baratas)."""
        RP._install()
        self.n = 0
        self.g = self.rec = None
        mine, rival = self.decks
        first, second = (mine, rival) if self.pi == 0 else (rival, mine)
        human = H.Human(self.pi, self._ask, choose_pay=self.choose_pay)
        vf = ('action', 'action') if self.strong else None
        g = X.Game(first['main'], first['legs'], second['main'], second['legs'], self.seed, trace=True, deep=(True, True),
                   err=(0, 0), vf=vf, ai=human)
        g.chooser, g.payer, g.human_pi = human.choose, human.pay, self.pi
        g.rec = []                  # posiciones al terminar cada turno: el mismo material con el que se entrena valfn.py
        rec = self._ensure_rec(g)
        for p in g.p:
            if g.st[p.pi]['mulligan']:
                rec.append(f'   J{p.pi + 1} hace mulligan')
        rec.steps[0][1] = rec._state_index()      # el repaso empieza con las dos manos ya repartidas
        if self.checkpoints:
            self.ckpt = (self._copy((g, rec)), self.n)

    def _restore(self):
        world, self.n = self.ckpt
        self.g, self.rec = self._copy(world)

    def _copy(self, world):
        """Copia independiente de (partida, consola). Lo que no es estado de la partida se comparte: esta sesión, los módulos y las
        cartas (el motor las compara por identidad)."""
        memo = {id(self): self}
        for c in X.CARD.values():
            memo[id(c)] = c
        for obj in (world[0], world[0].ai):
            for v in vars(obj).values():
                if isinstance(v, types.ModuleType):
                    memo[id(v)] = v
        return copy.deepcopy(world, memo)

    def _ensure_rec(self, g):
        """La consola con foto de tablero por línea se crea en la primera pregunta (el mulligan ocurre al construir la partida)."""
        if self.rec is None:
            first, second = (self.decks if self.pi == 0 else self.decks[::-1])
            rec = RP._Rec(g)
            rec.append(f"Preparación: J1 ({first['name']}) empieza; J2 ({second['name']}) va de segundo")
            g.log = self.rec = rec
            self.g = g
        return self.rec

    def _mask(self, line):
        m = _SELL_LINE.match(line)
        return f'{m.group(1)} vende una carta (+1 €)' if m and int(m.group(2)) - 1 != self.pi else line

    def _new_lines(self, mask=True):
        steps = self.rec.steps[self.sent:]
        self.sent = len(self.rec.steps)
        return [self._mask(t) if mask else t for t, _ in steps]

    def _ask(self, g, kind, prompt, options, extra):
        rec = self._ensure_rec(g)
        rec.dice_check()
        self.n += 1
        if self.n <= len(self.answers):               # ya contestada: se repite la respuesta y la partida sigue
            d = self.decisions[self.n - 1]
            if d['kind'] != kind or len(d['options']) != len(options) or d['state'] != rec._state_index():
                raise Desync(f"pregunta {self.n}: se contestó «{d['kind']}» con {len(d['options'])} opciones y al repetir la "
                             f"partida sale «{kind}» con {len(options)} (o con otro tablero)")
            return self.answers[self.n - 1]
        msg = dict(type='ask', n=self.n, kind=kind, prompt=prompt, me=self.pi, turn=g.turn,
                   options=[{k: o[k] for k in OPTION_FIELDS if k in o} for o in options], extra=extra,
                   log=self._new_lines(), view=RP.snapshot(g, rec.owner, viewer=self.pi))
        if self.n == 1:
            ids = {c for d in self.decks for c in d['main'] + d['legs']}
            msg.update(cards=RP.card_table(ids), names=[d['name'] for d in self.decks], seed=self.seed, warnings=lab_sim.warnings(*self.decks))
        self.pending = dict(n=self.n, turn=g.turn, kind=kind, prompt=prompt, options=[o['label'] for o in options],
                            groups=[o.get('group') for o in options], state=rec._state_index(),
                            acts=[HP.describe(o) if kind == 'action' else None for o in options])
        if kind == 'action' and self.with_plans and g.turn not in self.plans and g.turn not in self.plan_todo:
            self._plan(g)
        raise _Ask(msg)

    def _plan(self, g):
        try:
            copy_ = HP.plan_copy(g, seed=self.seed * PLAN_SEED_STEP + g.turn)
        except Exception:                # comparar con el piloto es un extra: nunca debe romper la partida
            self.plans[g.turn] = None
            return
        if self.with_plans == 'lazy':
            self.plan_todo[g.turn] = copy_
        else:
            self._run_plan(g.turn, copy_)

    def _run_plan(self, turn, copy_):
        try:
            self.plans[turn] = [list(a) for a in HP.plan_run(copy_, self.pi)]
        except Exception:                # ídem
            self.plans[turn] = None

    # ------------------------------------------------------------------ final
    def _game(self, g, rec, winner):
        a, b = (self.decks if self.pi == 0 else self.decks[::-1])
        return dict(title=f"J1 {a['name']} vs J2 {b['name']}", a=a['name'], b=b['name'], seed=self.seed, winner=winner,
                    turns=g.turn, steps=rec.steps, states=rec.states)

    def _finish(self, g, rec, winner):
        a, b = (self.decks if self.pi == 0 else self.decks[::-1])
        names = (a['name'], b['name'])
        end = 'Empate' if winner < 0 else f'Gana J{winner + 1} ({names[winner]})'
        rec.append(f"FIN en el turno {g.turn}: {end} · Gigs {len(g.p[0].gigs)}-{len(g.p[1].gigs)}")
        rec.dice_check()
        self.done = True
        game = self._game(g, rec, winner)
        doc = self._doc(winner=winner, game=game)
        path = self._save(doc)
        ids = {c for d in self.decks for c in d['main'] + d['legs']}
        return dict(type='end', winner=winner, won=winner == self.pi, me=self.pi, log=self._new_lines(mask=False), game=game,
                    cards=RP.card_table(ids), saved=str(path) if path else None,
                    record={k: v for k, v in doc.items() if k != 'game'} if doc else None)

    def _doc(self, winner=None, game=None, aborted=False):
        """Registro de la partida: lo que se guarda en data/human/ y lo que la página puede guardar por su cuenta."""
        if not self.decisions:
            return None
        while self.idle():               # planes que no dio tiempo a calcular mientras se jugaba
            pass
        self.plans = dict(sorted(self.plans.items()))
        game = game or (self._game(self.g, self.rec, None) if self.rec is not None else None)
        rows = [[x, int(pi == winner), hand] for pi, _t, x, hand in (self.g.rec or [])] if winner is not None and winner >= 0 else []
        return dict(version=2, seed=self.seed, human=self.pi, strong=self.strong, aborted=aborted, winner=winner,
                    decks=[dict(name=d['name'], legs=d['legs'], main=d['main']) for d in self.decks], decisions=self.decisions,
                    plans=self.plans, rows=rows, game=game)

    def _save(self, doc=None, aborted=False):
        if not self.save:
            return None
        doc = doc or self._doc(aborted=aborted)
        if doc is None:
            return None
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        path = DATA_DIR / f"{time.strftime('%Y%m%d-%H%M%S')}_seed{self.seed}.json"
        path.write_text(json.dumps(doc, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
        return path
