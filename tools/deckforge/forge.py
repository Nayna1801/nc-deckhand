#!/usr/bin/env python
"""deckforge: herramienta para analizar, optimizar y comparar mazos del Cyberpunk TCG.

Árbitro (reglas) + red de sinergias + simulador de partidas + optimizador. Solo biblioteca estándar.
Uso:  python tools/deckforge/forge.py <comando> --help      (README.md explica el flujo completo)

Este fichero es la puerta de entrada (línea de comandos) y reexporta lo que usan los demás módulos (`import forge as F`).
El trabajo está repartido en: deckio (mazos y texto), forge_basic (check, validate, export, score), forge_selftest,
forge_sim (sim, gauntlet, robust, explain, matrix...), forge_search (optimize, search, sideboard, match), forge_graph
(graph, reason, learn, trios) y forge_cli (los argumentos de cada comando).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except (AttributeError, OSError, ValueError):
    pass  # salida sin reconfigure (redirigida a un objeto que no es un fichero de texto): se queda como está

from deckio import BY, deck_to_text, ids_of, load_deck, rows_of  # noqa: E402
from forge_cli import main  # noqa: E402
from forge_search import _allowed, _kinds, _opt_run  # noqa: E402
from forge_sim import _gaunt_one, build_side, gauntlet, load_field, set_deep, set_vf  # noqa: E402

__all__ = [
    'BY', 'deck_to_text', 'ids_of', 'load_deck', 'rows_of', 'main', '_allowed', '_kinds', '_opt_run', '_gaunt_one',
    'build_side', 'gauntlet', 'load_field', 'set_deep', 'set_vf',
]

if __name__ == '__main__':
    main()
