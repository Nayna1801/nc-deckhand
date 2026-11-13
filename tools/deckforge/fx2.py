"""Efectos de cada carta y Legend del Cyberpunk TCG para el motor v2, y cuánto vale jugarlas en cada situación.

Convenciones: g = partida, me = quien actúa, op = rival, c = carta (dict de engine2.CARD), u = Unidad en mesa.
Los textos se siguen literalmente salvo las simplificaciones listadas en README («Límites»).

Este módulo es la puerta de entrada y reúne los bloques: fx2_base (constantes y utilidades), fx2_rules (disparadores de
reglas y llamar a Legends), fx2_programs (Programas) y fx2_units (Unidades y Gear)."""
from fx2_base import (
    ALT, DRAW, GIG, HANAKO, JACKIE, JUDY, ON_SPENT_GEAR, RIVER, cost, gs_cost, mins, n8, pairs, uval,
)
from fx2_rules import (
    alt_mod_prevent, call_value, end_turn, jackie_blue, jackie_mama_save, judy_bd, on_block, on_call, on_defeated,
    on_first_steal, on_roll, on_spent_gear, on_spent_unit, on_steal, on_win_fight, start_turn,
)
from fx2_programs import play_program, pval
from fx2_units import UBON, gear_value, on_attack, on_play_unit, value

__all__ = [
    'ALT', 'DRAW', 'GIG', 'HANAKO', 'JACKIE', 'JUDY', 'ON_SPENT_GEAR', 'RIVER', 'UBON', 'alt_mod_prevent', 'call_value',
    'cost', 'end_turn', 'gear_value', 'gs_cost', 'jackie_blue', 'jackie_mama_save', 'judy_bd', 'mins', 'n8',
    'on_attack', 'on_block', 'on_call', 'on_defeated', 'on_first_steal', 'on_play_unit', 'on_roll', 'on_spent_gear',
    'on_spent_unit', 'on_steal', 'on_win_fight', 'pairs', 'play_program', 'pval', 'start_turn', 'uval', 'value',
]
