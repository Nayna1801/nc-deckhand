"""Pruebas de la partida en vivo (live.py): sin hilos, repetible y con puntos de control por turno.

    python tools/deckforge/tests_live.py
"""
import sys
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import human_pilot as HP  # noqa: E402
import lab_sim  # noqa: E402
import live  # noqa: E402

GAMES = 4
MAX_ASKS = 900


def _decks(k):
    decks = sorted(lab_sim.list_decks(), key=lambda d: d['key'])
    return lab_sim._deck(decks[k % len(decks)], 'A'), lab_sim._deck(decks[(k * 5 + 3) % len(decks)], 'B')


def _pick(s, msg, st):
    """Jugador de prueba: copia el plan del piloto en sus turnos y varía la opción en el resto de preguntas."""
    opts = msg['options']
    if msg['kind'] != 'action':
        return (msg['n'] * 7) % len(opts) if msg['kind'] in ('target', 'mode', 'pay', 'react') else 0
    if st['turn'] != msg['turn']:
        st.update(turn=msg['turn'], plan=[tuple(x) for x in (s.plans.get(msg['turn']) or [])], i=0)
    while st['i'] < len(st['plan']):
        want = st['plan'][st['i']]
        st['i'] += 1
        for k, o in enumerate(opts):
            if HP.describe(o) == want:
                return k
    return len(opts) - 1


def _play(k, **kw):
    mine, rival = _decks(k)
    s = live.Session(mine, rival, k + 1, k % 2 == 0, True, save=False, **kw)
    st = {'turn': None, 'plan': [], 'i': 0}
    msg = s.start()
    lines = list(msg.get('log', []))
    for _ in range(MAX_ASKS):
        if msg['type'] != 'ask':
            break
        msg = s.answer(msg['n'], _pick(s, msg, st))
        lines += msg.get('log', [])
    return s, msg, lines


def t_checkpoints_match_full_replay():
    """Repetir solo el turno en curso (punto de control) da la misma partida que repetirla entera desde la semilla."""
    for k in range(GAMES):
        a, ma, la = _play(k, checkpoints=False)
        b, mb, lb = _play(k)
        assert ma['type'] == mb['type'] == 'end', (ma.get('message'), mb.get('message'))
        assert la == lb, f'partida {k}: la consola cambia con puntos de control'
        assert ma['game']['steps'] == mb['game']['steps'] and ma['game']['states'] == mb['game']['states']
        assert ma['winner'] == mb['winner'] and len(a.decisions) == len(b.decisions) > 15
        assert [dict(d, t=0) for d in a.decisions] == [dict(d, t=0) for d in b.decisions]


def t_plan_does_not_change_the_game():
    """Calcular qué habría hecho el piloto en tu turno no gasta azar de la partida: con y sin ese cálculo sale la misma."""
    mine, rival = _decks(1)
    runs = []
    for plans in (True, False):
        s = live.Session(mine, rival, 5, True, True, save=False, plans=plans)
        msg, lines = s.start(), []
        for _ in range(MAX_ASKS):
            if msg['type'] != 'ask':
                break
            lines += msg['log']
            msg = s.answer(msg['n'], len(msg['options']) - 1 if msg['kind'] == 'action' else 0)
        runs.append((lines + msg.get('log', []), msg['type'], bool(s.plans)))
    assert runs[0][1] == runs[1][1] == 'end' and runs[0][0] == runs[1][0]
    assert runs[0][2] and not runs[1][2]


def t_no_threads():
    """La partida no arranca ningún hilo (Pyodide no los tiene)."""
    before = threading.active_count()
    mine, rival = _decks(0)
    s = live.Session(mine, rival, 3, True, True, save=False)
    msg = s.start()
    for _ in range(6):
        assert msg['type'] == 'ask', msg.get('message')
        assert threading.active_count() == before
        msg = s.answer(msg['n'], 0)


def t_bad_answers():
    """Una respuesta que no toca (otra pregunta, opción inexistente, tipo raro) da error y no avanza la partida."""
    mine, rival = _decks(0)
    s = live.Session(mine, rival, 3, True, True, save=False)
    msg = s.start()
    for n, choice in ((msg['n'] + 1, 0), (msg['n'], len(msg['options'])), (msg['n'], -1), (msg['n'], '0'), (msg['n'], True)):
        bad = s.answer(n, choice)
        assert bad['type'] == 'error' and not s.answers, (n, choice)
    assert s.answer(msg['n'], 0)['type'] == 'ask'
    s.abort()
    assert s.answer(2, 0)['type'] == 'error'


def t_desync_is_detected():
    """Si al repetir la partida sale otra pregunta que la contestada (motor no determinista), se avisa en vez de seguir mal."""
    mine, rival = _decks(0)
    s = live.Session(mine, rival, 3, True, True, save=False, checkpoints=False)
    msg = s.start()
    for _ in range(5):
        msg = s.answer(msg['n'], 0)
    s.decisions[2]['kind'] = 'otra'
    msg = s.answer(msg['n'], 0)
    assert msg['type'] == 'error' and 'Desync' in msg['message'], msg


def t_end_message_has_the_record():
    """Al terminar, el mensaje lleva el registro de decisiones (lo que la página guarda cuando no hay disco: navegador)."""
    s, msg, _ = _play(2)
    rec = msg['record']
    assert msg['type'] == 'end' and msg['saved'] is None
    assert rec['decisions'] == s.decisions and rec['seed'] == 3 and 'game' not in rec and rec['plans']


def t_lazy_plans_match_eager():
    """Calcular los planes del piloto en ratos muertos (o al terminar) da los mismos planes y la misma partida que calcularlos al
    preguntar."""
    for k, idle in ((1, True), (2, False)):
        mine, rival = _decks(k)
        docs = []
        for plans in (True, 'lazy'):
            s = live.Session(mine, rival, k + 1, k % 2 == 0, True, save=False, plans=plans)
            msg, lines = s.start(), []
            for _ in range(MAX_ASKS):
                if msg['type'] != 'ask':
                    break
                if plans == 'lazy':
                    assert msg['turn'] not in s.plans or not idle or msg['kind'] != 'action' or s.answers
                    while idle and s.idle():
                        pass
                lines += msg['log']
                msg = s.answer(msg['n'], len(msg['options']) - 1 if msg['kind'] == 'action' else 0)
            assert msg['type'] == 'end', msg.get('message')
            assert not s.plan_todo
            docs.append((lines + msg['log'], msg['record']['plans']))
        assert docs[0][0] == docs[1][0], 'la consola cambia con los planes aplazados'
        assert docs[0][1] == docs[1][1] and len(docs[0][1]) > 3 and all(docs[0][1].values())


def t_web_entry():
    """La entrada del navegador (lab_web.py): mazos, simulación, partida en vivo y errores, todo como JSON."""
    import json
    import lab_web
    call = lambda **req: json.loads(lab_web.handle(json.dumps(req)))  # noqa: E731
    decks = call(cmd='decks')['decks']
    a, b = ({'name': d['name'], 'legends': d['legends'], 'main': d['main']} for d in decks[:2])
    sim = call(cmd='simulate', a=a, b=b, seed=2, deep=False)
    assert sim['game']['steps'] and sim['cards'] and sim['warnings'] == [], sim.get('warnings')
    short = dict(a, name='Corto', main=a['main'][:12] + [a['main'][0]] * 4)
    warn = call(cmd='simulate', a=short, b=b, seed=2, deep=False)['warnings']
    assert len(warn) == 1 and warn[0].startswith('Corto no es un mazo legal') and '16 cartas' in warn[0] and 'más de 3 copias' in warn[0], warn
    assert call(cmd='start', mine=short, rival=b, seed=2)['warnings'] == warn, 'la partida en vivo avisa igual'
    assert call(cmd='abort')['type'] == 'aborted'
    msg = call(cmd='start', mine=a, rival=b, seed=2, human_first=True, strong=True)
    assert msg['type'] == 'ask' and msg['n'] == 1
    msg = call(cmd='answer', n=1, choice=0)
    assert msg['type'] == 'ask' and isinstance(lab_web.idle(), bool)
    assert call(cmd='answer', n=99, choice=0)['type'] == 'error'
    assert call(cmd='abort')['type'] == 'aborted' and lab_web.idle() is False
    assert call(cmd='nada')['type'] == 'error' and call(cmd='start', mine={}, rival=b)['type'] == 'error'
    assert json.loads(lab_web.handle('no es json'))['type'] == 'error' and json.loads(lab_web.handle('[]'))['type'] == 'error'


TESTS = [t_lazy_plans_match_eager, t_web_entry, t_checkpoints_match_full_replay, t_plan_does_not_change_the_game, t_no_threads, t_bad_answers, t_desync_is_detected,
         t_end_message_has_the_record]


def run(verbose=False):
    for t in TESTS:
        t()
        if verbose:
            print('  ok', t.__name__)
    return len(TESTS)


if __name__ == '__main__':
    print(f'{run(verbose=True)} pruebas de la partida en vivo superadas')
