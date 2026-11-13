"""Puente persistente entre la página «Laboratorio» (solo con `npm run dev`) y una partida en vivo contra el piloto.

Habla JSON por líneas: lee una petición por línea de la entrada estándar y escribe EXACTAMENTE una respuesta por línea.

    {"cmd": "decks"}                                            -> {"type": "decks", "decks": [...]}
    {"cmd": "start", "mine": mazo, "rival": mazo, "seed": 7, "human_first": true, "strong": true, "choose_pay": true}
                                                                -> primer mensaje de la partida (ask / end / error)
    {"cmd": "answer", "n": 3, "choice": 0}                      -> siguiente mensaje
    {"cmd": "abort"}                                            -> {"type": "aborted"}

Cada mazo es {name, legends: [ids], main: [ids repetidos]} (el mismo formato que lab_sim.py).
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
try:
    sys.stdin.reconfigure(encoding='utf-8')
    sys.stdout.reconfigure(encoding='utf-8')
except (AttributeError, OSError, ValueError):
    pass  # sin reconfigure: se queda la codificación del sistema

import lab_sim  # noqa: E402
import live  # noqa: E402


def handle(req, session):
    """Devuelve (respuesta, sesión actual)."""
    cmd = req.get('cmd')
    if cmd == 'decks':
        return dict(type='decks', decks=lab_sim.list_decks()), session
    if cmd == 'start':
        if session is not None:
            session.abort()
        mine, rival = lab_sim._deck(req.get('mine'), 'Tu mazo'), lab_sim._deck(req.get('rival'), 'Mazo rival')
        session = live.Session(mine, rival, int(req.get('seed', 1)), bool(req.get('human_first', True)), bool(req.get('strong', True)),
                                choose_pay=bool(req.get('choose_pay', True)))
        return session.start(), session
    if cmd == 'answer':
        if session is None:
            raise ValueError('no hay ninguna partida en curso')
        return session.answer(int(req.get('n', -1)), req.get('choice')), session
    if cmd == 'abort':
        if session is not None:
            session.abort()
        return dict(type='aborted'), None
    raise ValueError(f'orden desconocida: {cmd!r}')


def main():
    session = None
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            out, session = handle(json.loads(line), session)
        except (ValueError, KeyError, TypeError, json.JSONDecodeError) as e:
            out = dict(type='error', message=f'{type(e).__name__}: {e}')
        sys.stdout.write(json.dumps(out, ensure_ascii=False, separators=(',', ':')) + '\n')
        sys.stdout.flush()


if __name__ == '__main__':
    main()
