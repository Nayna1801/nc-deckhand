"""Partida en vivo: una persona contra el piloto, para la página «Laboratorio» (solo existe con `npm run dev`).

La partida corre en un hilo. Cada vez que el motor necesita una decisión de la persona (human.py), el hilo publica un mensaje
`ask` (opciones + consola nueva + tablero SIN la información que esa persona no puede ver) y espera la respuesta. Al terminar publica
`end` con la partida completa para repasarla (manos incluidas) y guarda en data/human/ todas las decisiones tomadas: es el material
con el que se compara a la persona con el piloto.

    s = Session(mi_mazo, mazo_rival, seed, human_first=True)
    msg = s.start()                    # primer mensaje (ask / end / error)
    msg = s.answer(msg['n'], indice)   # siguiente mensaje
"""
import json
import queue
import re
import threading
import time
import traceback
from pathlib import Path

import engine2 as X
import human as H
import human_pilot as HP
import replay as RP

DATA_DIR = Path(__file__).resolve().parent / 'data' / 'human'
OPTION_FIELDS = ('label', 'group', 'card', 'cost', 'die', 'value', 'tgt', 'src', 'to', 'ref', 'legs', 'eddies')
REPLY_TIMEOUT = 180
_SELL_LINE = re.compile(r'^(\s*J(\d)) vende .* \(\+1 €\)$')


class Aborted(BaseException):
    """La persona cerró la partida (BaseException: ningún `except Exception` del motor debe tragársela)."""


class Session:
    def __init__(self, mine, rival, seed, human_first=True, strong=True, save=True, choose_pay=True):
        self.decks = (mine, rival)
        self.pi = 0 if human_first else 1
        self.seed, self.strong, self.save, self.choose_pay = seed, strong, save, choose_pay
        self.inbox, self.outbox = queue.Queue(), queue.Queue()
        self.g = self.rec = None
        self.sent = 0                # líneas de consola ya enviadas
        self.n = 0                   # número de la última pregunta
        self.decisions = []
        self.plans = {}              # turno -> acciones que habría hecho el piloto en tu lugar (human_pilot.turn_plan)
        self.plan_turn = None
        self.started = time.time()
        self.thread = threading.Thread(target=self._run, daemon=True)

    # ------------------------------------------------------------------ API para quien habla con la página
    def start(self):
        self.thread.start()
        return self.reply()

    def answer(self, n, choice):
        self.inbox.put(('answer', n, choice))
        return self.reply()

    def abort(self):
        self.inbox.put(('abort',))

    def reply(self):
        try:
            return self.outbox.get(timeout=REPLY_TIMEOUT)
        except queue.Empty:
            return dict(type='error', message='el piloto tarda demasiado en jugar su turno')

    # ------------------------------------------------------------------ hilo de la partida
    def _run(self):
        try:
            RP._install()
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
            winner = g.run()
            self._finish(g, rec, winner)
        except Aborted:
            self._save(aborted=True)
        except Exception:
            self.outbox.put(dict(type='error', message=traceback.format_exc(limit=8)))

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
        msg = dict(type='ask', n=self.n, kind=kind, prompt=prompt, me=self.pi, turn=g.turn,
                   options=[{k: o[k] for k in OPTION_FIELDS if k in o} for o in options], extra=extra,
                   log=self._new_lines(), view=RP.snapshot(g, rec.owner, viewer=self.pi))
        if self.n == 1:
            ids = {c for d in self.decks for c in d['main'] + d['legs']}
            msg.update(cards=RP.card_table(ids), names=[d['name'] for d in self.decks], seed=self.seed)
        state = rec._state_index()
        self.outbox.put(msg)
        if kind == 'action' and self.plan_turn != g.turn:
            self.plan_turn = g.turn
            self._plan(g)                # mientras lees las opciones: la persona no espera
        cmd = self.inbox.get()
        if cmd[0] == 'abort':
            raise Aborted()
        _, n, choice = cmd
        if n != self.n or not isinstance(choice, int) or not 0 <= choice < len(options):
            raise ValueError(f'respuesta no válida: pregunta {n} (esperaba {self.n}), opción {choice!r} de {len(options)}')
        act = HP.describe(options[choice]) if kind == 'action' else None
        self.decisions.append(dict(n=self.n, turn=g.turn, kind=kind, prompt=prompt, options=[o['label'] for o in options],
                                   groups=[o.get('group') for o in options], choice=choice, act=act, state=state,
                                   t=round(time.time() - self.started, 1)))
        return choice

    def _plan(self, g):
        try:
            self.plans[g.turn] = [list(a) for a in HP.turn_plan(g, self.pi)]
        except Exception:                # comparar con el piloto es un extra: nunca debe romper la partida
            self.plans[g.turn] = None

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
        game = self._game(g, rec, winner)
        path = self._save(winner=winner, game=game)
        ids = {c for d in self.decks for c in d['main'] + d['legs']}
        self.outbox.put(dict(type='end', winner=winner, won=winner == self.pi, me=self.pi, log=self._new_lines(mask=False),
                             game=game, cards=RP.card_table(ids), saved=str(path) if path else None))

    def _save(self, winner=None, game=None, aborted=False):
        if not self.save or not self.decisions:
            return None
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        path = DATA_DIR / f"{time.strftime('%Y%m%d-%H%M%S')}_seed{self.seed}.json"
        game = game or (self._game(self.g, self.rec, None) if self.rec is not None else None)
        rows = [[x, int(pi == winner), hand] for pi, _t, x, hand in (self.g.rec or [])] if winner is not None and winner >= 0 else []
        doc = dict(version=2, seed=self.seed, human=self.pi, strong=self.strong, aborted=aborted, winner=winner,
                   decks=[dict(name=d['name'], legs=d['legs'], main=d['main']) for d in self.decks], decisions=self.decisions,
                   plans=self.plans, rows=rows, game=game)
        path.write_text(json.dumps(doc, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
        return path
