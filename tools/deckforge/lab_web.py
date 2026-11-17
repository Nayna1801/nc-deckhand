"""Entrada única del Laboratorio cuando el motor corre DENTRO del navegador (Pyodide, en un Worker: src/lab/engine.worker.ts).

Hace lo mismo que lab_sim.py + lab_play.py para el servidor de desarrollo, pero sin procesos ni disco: una petición JSON entra,
una respuesta JSON sale.

    handle('{"cmd":"decks"}')                          -> lista de mazos de decks/ y meta/
    handle('{"cmd":"simulate","a":…,"b":…,"seed":1}')  -> partida grabada paso a paso
    handle('{"cmd":"start"|"answer"|"abort", …}')      -> siguiente mensaje de la partida en vivo (live.py)
    idle()                                             -> adelanta trabajo mientras la persona piensa; True si queda más

Las partidas no se guardan (no hay data/human/): el mensaje `end` lleva el registro y la página ofrece descargarlo.
"""
import json
import traceback

import lab_play
import lab_sim

_session = None


def _handle(req):
    global _session
    if not isinstance(req, dict):
        raise ValueError('la petición debe ser un objeto')
    cmd = req.get('cmd')
    if cmd == 'simulate':
        return lab_sim.simulate(req)
    out, _session = lab_play.handle(req, _session, save=False, plans='lazy')
    return out


def handle(text):
    try:
        out = _handle(json.loads(text))
    except (ValueError, KeyError, TypeError) as e:           # petición mal formada: mensaje corto
        out = dict(type='error', message=f'{type(e).__name__}: {e}')
    except Exception:                                         # fallo del motor: con su traza, para poder arreglarlo
        out = dict(type='error', message=traceback.format_exc(limit=8))
    return json.dumps(out, ensure_ascii=False, separators=(',', ':'))


def idle():
    return bool(_session is not None and not _session.done and _session.idle())
