"""Decisiones del jugador para el motor v2: mulligan, venta, Calls, qué jugar, cómo atacar, cómo reaccionar
y cómo manipular los dados de Gig según lo que el mazo necesita (parejas, mínimos, Street Cred alto/bajo...).

Este módulo es la puerta de entrada y reúne los bloques: ai2_setup (constantes, perfil del mazo, pagos y valoración de la
posición), ai2_dice (dados de Gig), ai2_cards (vender, qué jugar y habilidades de las Legends), ai2_turn (secuencia del turno,
previsión y ataques) y ai2_react (reacciones del defensor)."""
from ai2_setup import (
    DICE_CARE, evalpos_hand, gear_target, keep, leg_pay_order, mulligan, pay_keep, profile,
)
from ai2_dice import gig_change, gig_swap, pick_die, pick_steal
from ai2_cards import call_avg, spare
from ai2_turn import attacker_pump, main
from ai2_react import react

__all__ = [
    'DICE_CARE', 'attacker_pump', 'call_avg', 'evalpos_hand', 'gear_target', 'gig_change', 'gig_swap', 'keep',
    'leg_pay_order', 'main', 'mulligan', 'pay_keep', 'pick_die', 'pick_steal', 'profile', 'react', 'spare',
]
