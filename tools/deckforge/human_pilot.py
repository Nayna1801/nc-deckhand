"""¿Qué turno habría jugado el piloto en lugar de la persona? Sirve para comparar sus decisiones (forge.py humanlog).

`turn_plan(g, pi)` juega el turno de la mano `pi` con el piloto sobre una COPIA de la partida (la real no se toca) y devuelve las
acciones que ha hecho, en orden: (tipo, carta, objetivo). `describe(option)` pasa una opción que se le ofreció a la persona al mismo
formato, para poder comparar los dos turnos aunque se hagan en distinto orden.

    tipos: sell (vender), play (jugar), call, gosolo, attack (carta = quien ataca, objetivo = Unidad o None si va a los Gigs), end
"""
from contextlib import contextmanager

import ai2
import ai2_turn
import engine2 as X
from fx2 import ALT, RIVER
from human_react import OVERWATCH

ABILITY_KINDS = {'tune', 'river', 'alt', 'ow', 'hold'}


def _action(kind, obj):
    if kind == 'card':
        return ('play', obj['id'], None)
    if kind == 'call':
        return ('call', None, None)
    if kind == 'gs':
        return ('gosolo', obj.c['id'], None)
    if kind in ABILITY_KINDS:
        return ('ability', _ability_card(kind, obj), None)
    return (kind, None, None)


def _ability_card(kind, obj):
    """Carta que da la habilidad: Alt, River y Overwatch son fijas; un Tuner es su propia Legend."""
    fixed = {'alt': ALT, 'river': RIVER, 'ow': OVERWATCH}
    if kind in fixed:
        return fixed[kind]
    return obj.c['id'] if kind == 'tune' else kind


@contextmanager
def _traced(game, pi, out):
    """Anota las acciones de la mano `pi` EN `game` (no en sus copias de previsión, que son otras partidas) mientras dura el bloque."""
    do, attack, sell = ai2_turn._do_action, X.Game.attack, ai2_turn._sell

    def traced_do(g, me, kind, obj, paymode=None):
        if g is game and me.pi == pi:
            out.append(_action(kind, obj))
        return do(g, me, kind, obj, paymode)

    def traced_attack(self, u, tgt):
        if self is game and u.owner.pi == pi:
            out.append(('attack', u.c['id'], None if tgt is None else tgt.c['id']))
        return attack(self, u, tgt)

    def traced_sell(g, me):
        before = [c['id'] for c in me.hand]
        r = sell(g, me)
        if g is game and me.pi == pi:
            gone = list(before)
            for c in me.hand:
                gone.remove(c['id'])
            if gone:
                out.append(('sell', gone[0], None))
        return r

    ai2_turn._do_action, X.Game.attack, ai2_turn._sell = traced_do, traced_attack, traced_sell
    try:
        yield
    finally:
        ai2_turn._do_action, X.Game.attack, ai2_turn._sell = do, attack, sell


def turn_plan(g, pi):
    """Acciones que haría el piloto en el turno que empieza ahora para la mano `pi` (con su previsión y su valoración)."""
    c = g.clone()
    c.rollout, c.ai, c.chooser, c.payer, c.rec = False, ai2, None, None, None     # la copia juega sola: sin ganchos de la persona
    me = c.p[pi]
    out = []
    with _traced(c, pi, out):
        ai2.main(c, me, me.op)
    return out


def describe(option):
    """Opción ofrecida a la persona -> (tipo, carta, objetivo), o None si no es una acción de turno comparable."""
    group, label = option.get('group'), option.get('label', '')
    if group == 'vender':
        return ('sell', option.get('card'), None)
    if group == 'jugar':
        return ('play', option.get('card'), None)
    if group == 'legend':
        return ('call', None, None) if label.startswith('Call') else ('gosolo', option.get('card'), None)
    if group == 'atacar':
        return ('attack', option.get('card'), option.get('tgt'))
    if group == 'habilidad':
        return ('ability', option.get('card'), None)
    if group == 'fin':
        return ('end', None, None)
    return None


def diff(human, pilot):
    """(solo la persona, solo el piloto) como listas de acciones, sin tener en cuenta el orden. Ignora 'end' y las habilidades."""
    mine = [a for a in human if a[0] not in ('end', 'ability')]
    theirs = [a for a in pilot if a[0] not in ('end', 'ability')]
    only_h, only_p = list(mine), []
    for a in theirs:
        if a in only_h:
            only_h.remove(a)
        else:
            only_p.append(a)
    return only_h, only_p
