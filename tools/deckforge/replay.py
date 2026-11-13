"""Partidas grabadas paso a paso para verlas en una página (tablero + consola de acciones).

Cada paso es una línea de texto del motor (jugar, vender, atacar, bloquear, robar Gigs, Call, Go Solo...) más el estado completo
del tablero en ese momento: manos, Unidades (poder, preparada, Lag, Gear), Legends, Eddies, dados del fixer y Gigs, mazo y basura.
El fichero resultante lo lee la página visor (viewer.html); las manos de los dos jugadores se guardan siempre (es para analizar).

    python tools/deckforge/forge.py replay <mazo A> <mazo B> --games 2 --seed 3 --out out/replay.json [--append]
"""
import json
import re
from pathlib import Path

import ai2_turn
import cardsdb as DB
import engine2 as X
import fx2

BY = DB.BY
CARD_TEXT_MAX = 300
# eventos del motor que se muestran como línea en la consola: tipo -> función(partida, jugador, origen, n) -> texto
_EV_TEXT = {
    'react': lambda g, p, src, n: f"reacciona con {_nm(src)}",
    'gigadj': lambda g, p, src, n: f"cambia el valor de un dado ({_nm(src)})",
    'free': lambda g, p, src, n: f"juega gratis con {_nm(src)}",
    'save': lambda g, p, src, n: f"salva Gigs ({_nm(src)})",
}
_installed = False


def _nm(i):
    return BY[i]['displayName'] if i in BY else str(i)


def _unit(g, u):
    return [u.c['id'], g.power(u), int(u.ready), int(u.lag), [x['id'] for x in u.gear], int(u.leg is not None)]


def _legend(l, hidden=False):
    if hidden:
        return [None, int(l.up), int(l.ready), int(l.gone), []]            # boca abajo y desconocida: solo se ve que existe
    return [l.c['id'], int(l.up), int(l.ready), int(l.gone), [x['id'] for x in l.gear]]


def _player(g, p, owner, viewer=None):
    secret = viewer is not None
    hand = [None] * len(p.hand) if secret and p.pi != viewer else [c['id'] for c in p.hand]
    legs = [_legend(l, secret and not l.up and not (p.pi == viewer and l.known)) for l in p.legs]
    return dict(h=hand, f=[_unit(g, u) for u in p.field], l=legs,
                e=[p.E, p.Eready], g=[[x[0], x[1], owner(x, p.pi)] for x in p.gigs], x=list(p.fixer), d=len(p.deck), t=len(p.trash))


def snapshot(g, owner=lambda die, holder: holder, viewer=None):
    """Foto del tablero. Cada Gig es [máximo del dado, valor, dueño original]: el dueño no cambia aunque el dado se robe.
    Con `viewer` (0 o 1) se oculta lo que ese jugador no ve: la mano del rival y las Legends boca abajo que no conoce (None)."""
    return dict(n=g.turn, p=[_player(g, p, owner, viewer) for p in g.p])


def dice_lines(prev, cur):
    """Líneas de consola con lo que ha pasado con los dados entre dos fotos. prev/cur = {(dueño, máximo): (quién lo tiene, valor)}."""
    out, moved = [], []
    for (owner, mx), (holder, val) in cur.items():
        old = prev.get((owner, mx))
        if old is None:
            out.append(f"   ⚄ J{holder + 1} tira su d{mx}: sale {val}")
        elif old[0] != holder:
            moved.append((owner, mx, old[0], holder, val))
        elif old[1] != val:
            out.append(f"   ⚄ d{mx} de J{owner + 1}: {old[1]} → {val}")
    if len(moved) == 2 and moved[0][3] == moved[1][2] and moved[0][2] == moved[1][3]:
        a, b = moved
        out.append(f"   ⚄ Intercambio: el d{a[1]} de J{a[0] + 1} (valor {a[4]}) pasa a J{a[3] + 1} y el d{b[1]} de J{b[0] + 1} (valor {b[4]}) pasa a J{b[3] + 1}")
    else:
        for owner, mx, frm, to, val in moved:
            if to == owner:      # con 2 jugadores, el dado vuelve a su dueño
                out.append(f"   ⚄ J{to + 1} recupera su d{mx} (valor {val}); lo tenía J{frm + 1}")
            else:
                out.append(f"   ⚄ J{to + 1} roba el d{mx} de J{owner + 1} (valor {val})")
    return out


class _Rec(list):
    """Lista de líneas del motor que guarda además una foto del tablero tras cada línea y cuenta lo que pasa con los dados."""

    def __init__(self, g):
        super().__init__()
        self.g = g
        self.steps = []          # [texto, índice de estado]
        self.states = []
        self._idx = {}
        self.header = None       # posición de la última línea de inicio de turno
        self._owner = {}         # id(dado) -> jugador que lo tiró por primera vez (su dueño)
        self._refs = []          # referencias a los dados vistos, para que su id no se reutilice
        self._dice = {}          # {(dueño, máximo): (quién lo tiene, valor)} en la última comprobación

    def owner(self, die, holder):
        k = id(die)
        if k not in self._owner:
            self._owner[k] = holder
            self._refs.append(die)
        return self._owner[k]

    def _state_index(self):
        st = snapshot(self.g, self.owner)
        key = json.dumps(st, separators=(',', ':'))
        i = self._idx.get(key)
        if i is None:
            i = self._idx[key] = len(self.states)
            self.states.append(st)
        return i

    def _push(self, line):
        list.append(self, line)
        self.steps.append([line.rstrip(), self._state_index()])

    def dice_check(self):
        """Escribe una línea por cada dado tirado, cambiado, robado o intercambiado desde la última comprobación."""
        cur = {}
        for p in self.g.p:
            for x in p.gigs:
                cur[(self.owner(x, p.pi), x[0])] = (p.pi, x[1])
        prev, self._dice = self._dice, cur
        for line in dice_lines(prev, cur):
            self._push(line)

    def append(self, line):
        # las líneas de acciones con dados (cambiar un dado, robar Gigs) se escriben DESPUÉS del cambio: su detalle va debajo
        after = 'valor de un dado' in line or 'Gig(s)' in line
        if not after:
            self.dice_check()
        self._push(line)
        if after:
            self.dice_check()
        if re.match(r'T\d+ J\d', line):
            self.header = len(self.steps) - 1

    def refresh_header(self):
        """El motor escribe la línea de inicio de turno antes de robar y tirar el dado: se actualiza su estado y se anota la tirada."""
        if self.header is not None:
            self.steps[self.header][1] = self._state_index()
            self.header = None
            self.dice_check()


def _install():
    """Añade al motor las líneas que no escribía: la venta de cartas y algunos eventos (reacciones, dados, jugadas gratis)."""
    global _installed
    if _installed:
        return
    orig_sell, orig_ev, orig_start, orig_prog = ai2_turn._sell, X.Game.ev, fx2.start_turn, fx2.play_program

    def sell(g, me):
        if g.log is None:
            return orig_sell(g, me)
        before = [c['id'] for c in me.hand]
        orig_sell(g, me)
        gone = list(before)
        for c in me.hand:
            gone.remove(c['id'])
        if gone:
            g.log.append(f"   J{me.pi + 1} vende {_nm(gone[0])} (+1 €)")

    def ev(self, p, kind, src, n=1):
        r = orig_ev(self, p, kind, src, n)
        if self.log is not None and kind in _EV_TEXT:
            self.log.append(f"   J{p.pi + 1} " + _EV_TEXT[kind](self, p, src, n))
        return r

    def start_turn(g, me, op):
        r = orig_start(g, me, op)
        if g.log is not None and not g.rollout:
            g.log.refresh_header()
        return r

    def play_program(g, me, op, c):
        r = orig_prog(g, me, op, c)
        if g.log is not None and not g.rollout:
            g.log.dice_check()
        return r

    ai2_turn._sell, X.Game.ev, fx2.start_turn, fx2.play_program = sell, ev, start_turn, play_program
    _installed = True


def record(deck_a, deck_b, seed, deep=True):
    """Juega una partida (A empieza) y devuelve su grabación. Cada deck = dict(name, legs, main[lista de ids])."""
    _install()
    g = X.Game(deck_a['main'], deck_a['legs'], deck_b['main'], deck_b['legs'], seed, trace=True, deep=(deep, deep))
    rec = g.log = _Rec(g)
    rec.append(f"Preparación: J1 ({deck_a['name']}) empieza; J2 ({deck_b['name']}) va de segundo")
    for p in g.p:
        if g.st[p.pi]['mulligan']:
            rec.append(f"   J{p.pi + 1} hace mulligan")
    winner = g.run()
    end = 'Empate' if winner < 0 else f"Gana J{winner + 1} ({(deck_a, deck_b)[winner]['name']})"
    rec.append(f"FIN en el turno {g.turn}: {end} · Gigs {len(g.p[0].gigs)}-{len(g.p[1].gigs)}")
    ids = set(deck_a['main']) | set(deck_b['main']) | set(deck_a['legs']) | set(deck_b['legs'])
    return dict(title=f"J1 {deck_a['name']} vs J2 {deck_b['name']}", a=deck_a['name'], b=deck_b['name'], seed=seed,
                winner=winner, turns=g.turn, steps=rec.steps, states=rec.states), ids


def card_table(ids):
    out = {}
    for i in sorted(ids):
        c = BY[i]
        out[i] = dict(n=c['displayName'], t=c['type'], c=c['color'], k=c['cost'], p=c['power'], s=int(bool(X.CARD[i]['sell'])),
                      r=(c['rules'] or '').replace('\n', ' / ')[:CARD_TEXT_MAX])
    return out


def build(pairs, games, seed, out, deep=True, append=False):
    """pairs = [(deck_a, deck_b)]; por cada pareja, `games` partidas alternando quién empieza."""
    data = json.loads(Path(out).read_text(encoding='utf-8')) if append and Path(out).exists() else dict(cards={}, games=[])
    for deck_a, deck_b in pairs:
        for k in range(games):
            first, second = (deck_a, deck_b) if k % 2 == 0 else (deck_b, deck_a)
            game, ids = record(first, second, seed + k, deep)
            data['games'].append(game)
            data['cards'].update(card_table(ids))
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    Path(out).write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    return data
