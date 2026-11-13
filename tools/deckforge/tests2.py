"""Pruebas de reglas del motor v2: cada una monta una situación concreta y comprueba el resultado.

Uso:  python tools/deckforge/tests2.py      (también las lanza `forge.py selftest`)
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import engine2 as E  # noqa: E402
import human as H  # noqa: E402
import human_pilot as HP  # noqa: E402
import humanlog as HL  # noqa: E402
import replay as RP  # noqa: E402
from engine2 import CARD  # noqa: E402

FILLER = ['psycho_squad'] * 20 + ['floor_it'] * 20
LEGS_A = ['v_corporate_exile', 'lucyna_kushinada_fresh_beginnings', 'wakako_okada_peace_and_harmony']
LEGS_B = ['goro_takemura_hands_unclean', 'padre_man_of_the_cross', 'saburo_arasaka_stubborn_patriarch']


def board(seed=1, legs_a=LEGS_A, legs_b=LEGS_B):
    """Partida vacía: sin manos, con el jugador 1 en su turno."""
    g = E.Game(FILLER, legs_a, FILLER, legs_b, seed)
    me, op = g.p
    for p in g.p:
        p.deck += p.hand
        p.hand = []
        p.E = p.Eready = 0
        for l in p.legs:
            l.ready = False
    g.turn = 5
    g.cur = me
    return g, me, op


def unit(g, p, cid, ready=True, lag=False):
    u = g.enter(p, CARD[cid])
    u.ready = ready
    u.lag = lag
    return u


def gigs(p, *vals):
    p.gigs = [list(v) for v in vals]


def t_steal_breakpoint():
    g, me, op = board()
    gigs(op, (4, 2), (6, 3), (8, 5))
    a = unit(g, me, 'animals_wrecker')          # poder 10
    b = unit(g, me, 'yorinobu_arasaka_steel_dragon')  # poder 9
    g.attack(a, None)
    assert len(me.gigs) == 2, 'poder 10 roba 2 Gigs'
    g.attack(b, None)
    assert len(me.gigs) == 3 and not op.gigs, 'poder 9 roba 1 Gig'
    assert not a.ready and not b.ready, 'atacar gasta la Unidad'


def t_blocker_and_fights():
    g, me, op = board()
    gigs(op, (4, 2))
    a = unit(g, me, 'psycho_squad')             # 6
    bl = unit(g, op, 'meredith_stout_stone_cold_corpo')  # Blocker 5 -> pierde, pero la IA bloquea (último Gig)
    g.attack(a, None)
    assert len(me.gigs) == 0, 'un ataque bloqueado no roba Gigs'
    assert bl not in op.field and a in me.field, 'gana el de más poder'
    g, me, op = board()
    a = unit(g, me, 'psycho_squad')
    d = unit(g, op, 'psycho_squad', ready=False)
    g.attack(a, d)
    assert not me.field and not op.field, 'con el mismo poder mueren las dos'
    g, me, op = board()
    a = unit(g, me, 'secondhand_bombus')         # poder 0
    d = unit(g, op, 'delamain_rideshare_ai', ready=False)   # poder 0
    g.fight(a, d)
    assert a in me.field and d in op.field, 'una Unidad de poder 0 no derrota a nadie'


def t_targets_and_lag():
    g, me, op = board()
    gigs(op, (4, 2))
    a = unit(g, me, 'psycho_squad', lag=True)
    assert not g.can_attack(a), 'una Unidad recién jugada no ataca (Lag)'
    n = unit(g, me, 'riding_nomad', lag=True)
    assert g.can_attack(n), 'Adrenaline ataca el turno que entra'
    r = unit(g, me, 'valentino_street_racer', lag=True)
    assert not g.can_attack(r), 'Valentino Street Racer da Adrenaline a OTRA Unidad, no a sí misma'
    a.lag = False
    ready = unit(g, op, 'psycho_squad')
    spent = unit(g, op, 'emergency_atlus', ready=False)
    t = g.targets(a)
    assert None in t and spent in t and ready not in t, 'solo se puede atacar a Unidades gastadas o al área de Gigs'
    low = unit(g, me, 'ruthless_lowlife')
    assert None not in g.targets(low), 'Ruthless Lowlife no ataca Gigs'


def t_bottom_is_not_defeat():
    g, me, op = board()
    op.trash.append(CARD['animals_wrecker'])
    s = unit(g, op, 'screw_lovelorn_fool')
    g.bottom(s, 'les_elemens', by=me)
    assert not op.hand and op.deck[0]['id'] == 'screw_lovelorn_fool', 'fondo de mazo: no dispara «Defeated»'
    s = unit(g, op, 'screw_lovelorn_fool')
    g.defeat(s, 'wild_in_the_streets', by=me)
    assert [c['id'] for c in op.hand] == ['animals_wrecker'], 'derrotada: Screw devuelve otra Unidad de la basura'


def t_pyramid_and_towerfall():
    g, me, op = board()
    gigs(me, (4, 3))
    gigs(op, (6, 5))
    t = unit(g, op, 'emergency_atlus')          # 4
    g.play_card(me, CARD['pyramid_song'], pay=False)
    assert t in op.field and g.power(t) in (0, 4), 'sin d4 al mínimo Pyramid Song no manda al fondo una Unidad de poder 4'
    g, me, op = board()
    gigs(me, (4, 1))
    gigs(op, (6, 5))
    t = unit(g, op, 'emergency_atlus')
    g.play_card(me, CARD['pyramid_song'], pay=False)
    assert t not in op.field and not op.trash, 'con el d4 al mínimo: -4 y al fondo del mazo'
    g, me, op = board()
    gigs(me, (4, 1))
    gigs(op, (6, 5))
    small, big = unit(g, op, 'psycho_squad'), unit(g, op, 'animals_wrecker')
    small.gear.append(CARD['mantis_blades'])     # 8 de poder: sobrevive
    weak = unit(g, op, 'emergency_atlus')
    g.play_card(me, CARD['towerfall'], pay=False)
    assert weak not in op.field and small in op.field and big in op.field, 'Towerfall con menos Street Cred barre poder <= 5'
    assert g.power(big) == 5, 'el -5 dura el turno'


def t_reactions():
    g, me, op = board()
    gigs(op, (4, 2), (6, 6))
    op.hand.append(CARD['take_control'])
    op.E = op.Eready = 2
    a = unit(g, me, 'psycho_squad')
    g.attack(a, None)
    assert len(me.gigs) == 0 and not op.hand, 'Take Control anula el robo de 1 Gig'
    g, me, op = board()
    gigs(op, (4, 2), (6, 6))
    a = unit(g, me, 'psycho_squad')
    ow = unit(g, op, 'corpo_security')
    ow.c = dict(ow.c, blocker=False)
    ow.gear.append(CARD['overwatch_panam_s_gift'])
    op.hand.append(CARD['psycho_squad'])
    op.E = op.Eready = 1
    g.attack(a, None)
    assert a not in me.field and len(me.gigs) == 0, 'Overwatch derrota a la atacante gastada (coste <= carta descartada)'


def t_overwatch_cost_order():
    """El descarte de Overwatch sale de la mano antes de gastar la Unidad (Rita roba y descarta al gastarse)."""
    g, me, op = board()
    a = unit(g, me, 'ruthless_lowlife')
    victim = unit(g, op, 'emergency_atlus', ready=False)
    rita = unit(g, op, 'rita_wheeler_no_stupid_questions')
    rita.gear.append(CARD['overwatch_panam_s_gift'])
    op.hand.append(CARD['the_heist'])
    op.deck.append(CARD['psycho_squad'])
    op.E = op.Eready = 1
    g.attack(a, victim)
    assert a not in me.field and victim in op.field, 'Overwatch con Rita: la atacante cae y no hay error al descartar'


def t_go_solo_and_economy():
    g, me, op = board()
    v = next(l for l in me.legs if l.c['id'] == 'v_corporate_exile')
    v.up = True
    for l in me.legs:
        l.ready = True
    me.E = me.Eready = 2
    assert g.go_solo(me, v) is None, 'la Legend no puede pagar su propio Go Solo (2 € + 2 Legends < 5)'
    me.E = me.Eready = 3
    u = g.go_solo(me, v)
    assert u is not None and g.can_attack(u) and g.avail(me) == 0, 'Go Solo: entra preparada y puede atacar'
    g.bottom(u, 'les_elemens', by=op)
    assert v.gone and all(c['id'] != 'v_corporate_exile' for c in me.deck), 'una Legend que sale del campo se retira del juego'
    g, me, op = board()
    v = next(l for l in me.legs if l.c['id'] == 'v_corporate_exile')
    b = unit(g, op, 'psycho_squad')
    b.gear.append(CARD['riot_shield'])
    assert g.fx.gs_cost(g, me, v) == 7, 'Riot Shield encarece el Go Solo rival en 2'
    assert CARD['mt0d12_flathead']['sell'] and not CARD['psycho_squad']['sell'] and CARD['mantis_blades']['sell'], 'etiquetas de venta'


def t_full_games():
    for seed in range(40):
        g = E.Game(FILLER, LEGS_A, FILLER, LEGS_B, seed)
        r = g.run()
        assert r in (0, 1, -1)
        for p in g.p:
            on_field = sum((1 if u.leg is None else 0) + len(u.gear) for u in p.field)
            total = len(p.deck) + len(p.hand) + len(p.trash) + p.E + on_field + sum(len(l.gear) for l in p.legs)
            assert total == 40, f'se han perdido o duplicado cartas ({total})'
        assert len(g.p[0].gigs) + len(g.p[1].gigs) + len(g.p[0].fixer) + len(g.p[1].fixer) == 12, 'los 12 dados siguen en juego'
    a = E.Game(FILLER, LEGS_A, FILLER, LEGS_B, 7).run()
    b = E.Game(FILLER, LEGS_A, FILLER, LEGS_B, 7).run()
    assert a == b, 'misma semilla, mismo resultado'


def t_human_error():
    """El fallo humano: con 0 no cambia nada (ni consume azar), con 1 la partida cambia, y es reproducible."""
    base = [E.Game(FILLER, LEGS_A, FILLER, LEGS_B, s).run() for s in range(30)]
    cero = [E.Game(FILLER, LEGS_A, FILLER, LEGS_B, s, err=(0.0, 0.0)).run() for s in range(30)]
    assert base == cero, 'con fallo 0 las partidas son idénticas'
    g = E.Game(FILLER, LEGS_A, FILLER, LEGS_B, 3, err=(0.0, 1.0))
    assert not g.slip(g.p[0]), 'el jugador sin fallo nunca falla'
    assert g.slip(g.p[1]), 'con fallo 1 siempre falla'
    g.rollout = True
    assert not g.slip(g.p[1]), 'las simulaciones de previsión no fallan'
    uno = [E.Game(FILLER, LEGS_A, FILLER, LEGS_B, s, err=(0.5, 0.5)).run() for s in range(30)]
    dos = [E.Game(FILLER, LEGS_A, FILLER, LEGS_B, s, err=(0.5, 0.5)).run() for s in range(30)]
    assert uno == dos, 'misma semilla y mismo fallo, mismo resultado'
    assert uno != base, 'con fallos las partidas cambian'


def t_replay_dice():
    """La grabación de partidas sigue cada dado (su dueño no cambia al robarlo) y cuenta tiradas, cambios, robos e intercambios."""
    d = RP.dice_lines
    assert d({}, {(0, 8): (0, 5)}) == ['   ⚄ J1 tira su d8: sale 5']
    assert d({(0, 8): (0, 5)}, {(0, 8): (0, 3)}) == ['   ⚄ d8 de J1: 5 → 3']
    assert d({(1, 4): (1, 2)}, {(1, 4): (0, 2)}) == ['   ⚄ J1 roba el d4 de J2 (valor 2)']
    assert d({(1, 4): (0, 2)}, {(1, 4): (1, 2)}) == ['   ⚄ J2 recupera su d4 (valor 2); lo tenía J1']
    assert d({(1, 4): (0, 2)}, {(1, 4): (0, 2)}) == [], 'sin cambios no se escribe nada'
    swap = d({(0, 8): (0, 3), (1, 10): (1, 6)}, {(0, 8): (1, 3), (1, 10): (0, 6)})
    assert len(swap) == 1 and swap[0].startswith('   ⚄ Intercambio'), swap
    a = {'name': 'A', 'legs': LEGS_A, 'main': list(FILLER)}
    b = {'name': 'B', 'legs': LEGS_B, 'main': list(FILLER)}
    for seed in range(8):
        game, _ = RP.record(a, b, seed, deep=False)
        plain = E.Game(FILLER, LEGS_A, FILLER, LEGS_B, seed, deep=(False, False))
        assert plain.run() == game['winner'] and plain.turn == game['turns'], 'grabar no cambia la partida'
        for text, ix in game['steps']:
            assert 0 <= ix < len(game['states'])
        for st in game['states']:
            for owner in (0, 1):
                mine = [g for p in st['p'] for g in p['g'] if g[2] == owner]
                assert len(mine) + len(st['p'][owner]['x']) == 6, 'los 6 dados de cada jugador siguen en juego'
                assert len({g[0] for g in mine}) == len(mine), 'no hay dos dados iguales de un mismo dueño'
        for p in (0, 1):
            assert all(g[2] in (0, 1) for st in game['states'] for g in st['p'][p]['g'])
    assert any('⚄' in t for t, _ in game['steps']), 'la partida cuenta lo que pasa con los dados'


# ----------------------------------------------------------------------------- jugador humano (human.py)
def _script(*wanted):
    """ask de prueba: elige la primera opción cuya etiqueta empieza por cada texto de `wanted`, en orden; después, la última (terminar)."""
    queue, log = list(wanted), []

    def ask(g, kind, prompt, options, extra):
        labels = [o['label'] for o in options]
        log.append((kind, labels))
        if queue:
            w = queue.pop(0)
            for i, lab in enumerate(labels):
                if lab.startswith(w):
                    return i
            raise AssertionError(f'no hay una opción que empiece por {w!r} en {labels}')
        return len(options) - 1
    return ask, log


def _human(g, pi, *wanted):
    ask, log = _script(*wanted)
    h = H.Human(pi, ask)
    g.ai, g.chooser, g.payer, g.human_pi = h, h.choose, h.pay, pi
    return h, log


def t_human_sell_and_play():
    """Vender da 1 € una sola vez por turno; jugar solo se ofrece si se puede pagar; los Quick de reacción no se juegan desde la mano."""
    g, me, op = board()
    me.hand = [CARD['adrenaline_converter'], CARD['psycho_squad'], CARD['take_control']]
    me.E = me.Eready = 3
    h, log = _human(g, 0, 'Vender Adrenaline', 'Jugar Psycho Squad')
    h.main(g, me, op)
    first, second = log[0][1], log[1][1]
    assert any(o.startswith('Vender') for o in first) and not any(o.startswith('Jugar') for o in first), first
    assert not any('Take Control' in o and o.startswith('Jugar') for o in first + second), 'Take Control solo se juega como reacción'
    assert any(o.startswith('Jugar Psycho Squad (4 €)') for o in second), second
    assert not any(o.startswith('Vender') for o in second), 'solo se vende una vez por turno'
    assert me.E == 4 and me.Eready == 0 and me.sold
    assert [u.c['id'] for u in me.field] == ['psycho_squad'] and [c['id'] for c in me.hand] == ['take_control']


def t_human_attack_and_block():
    """La persona elige a quién ataca y cómo defiende; un ataque bloqueado no roba Gigs."""
    g, me, op = board()
    gigs(op, (4, 2))
    unit(g, me, 'psycho_squad')
    h, log = _human(g, 0, 'Atacar con Psycho Squad (poder 6) → los Gigs')
    h.main(g, me, op)
    assert len(me.gigs) == 1 and len(op.gigs) == 0, 'el ataque sin bloqueo roba el Gig'
    g, me, op = board()
    gigs(op, (4, 2))
    a = unit(g, me, 'psycho_squad')
    bl = unit(g, op, 'meredith_stout_stone_cold_corpo')
    h, log = _human(g, 1, 'Bloquear con Meredith')
    g.attack(a, None)
    assert any(o.startswith('Bloquear con Meredith') for o in log[0][1]) and log[0][1][-1].startswith('Seguir')
    assert not me.gigs and bl not in op.field and a in me.field, 'bloquear evita el robo y gana el de más poder'
    g, me, op = board()
    gigs(op, (4, 2))
    a = unit(g, me, 'psycho_squad')
    unit(g, op, 'meredith_stout_stone_cold_corpo')
    h, log = _human(g, 1, 'Seguir')
    g.attack(a, None)
    assert len(me.gigs) == 1, 'si la persona no bloquea, roba el Gig'


def t_human_dice_and_targets():
    """Cambiar un dado, elegir el objetivo de un Programa y no preguntar nunca en una valoración (dry) ni en una simulación."""
    g, me, op = board()
    gigs(me, (8, 5))
    h, log = _human(g, 0, 'Tu d8 (valor 5)', 'Pasar a 1')
    assert h.gig_change(g, me, [(me, me.gigs[0], v) for v in (1, 2, 3)], 'trust_no_one') == (me.gigs[0], 1) and me.gigs[0][1] == 1
    h, log = _human(g, 0, 'No cambiar')
    assert h.gig_change(g, me, [(me, me.gigs[0], 2)], 'trust_no_one') is None and me.gigs[0][1] == 1
    h, log = _human(g, 0)
    h.gig_change(g, me, [(me, me.gigs[0], 2)], 'trust_no_one', dry=True)
    assert not log, 'una valoración (dry) no pregunta a la persona'
    g.rollout = True
    h.gig_change(g, me, [(me, me.gigs[0], 2)], 'trust_no_one')
    assert not log and h.choose(g, 'unit', []) is None, 'en una simulación decide el piloto'
    g, me, op = board()
    weak = unit(g, op, 'corpo_security', ready=False)
    strong = unit(g, op, 'psycho_squad', ready=False)
    me.hand = [CARD['wild_in_the_streets']]
    me.E = me.Eready = 5
    h, log = _human(g, 0, 'Jugar Wild in the Streets', 'Corpo Security')
    h.main(g, me, op)
    assert weak not in op.field and strong in op.field, 'la persona elige el objetivo (el motor habría elegido la más fuerte)'


def t_human_hidden_information():
    """La foto de un jugador no enseña la mano rival ni las Legends boca abajo que no conoce."""
    g, me, op = board()
    me.hand, op.hand = [CARD['floor_it']], [CARD['floor_it'], CARD['psycho_squad']]
    me.legs[0].known = True
    snap = RP.snapshot(g, viewer=0)
    assert snap['p'][0]['h'] == ['floor_it'] and snap['p'][1]['h'] == [None, None]
    assert snap['p'][0]['l'][0][0] == me.legs[0].c['id'] and snap['p'][0]['l'][1][0] is None, 've las suyas solo si las conoce'
    assert all(l[0] is None for l in snap['p'][1]['l'])
    assert RP.snapshot(g)['p'][1]['h'] == ['floor_it', 'psycho_squad'], 'sin jugador, la foto es completa'


def t_human_random_games():
    """Una persona que elige al azar entre lo que se le ofrece completa partidas sin romper las reglas y sin que el piloto le pregunte
    dentro de sus simulaciones de previsión."""
    import random
    for seed in range(8):
        rng = random.Random(seed)

        def ask(g, kind, prompt, options, extra):
            assert not g.rollout, 'el piloto preguntó dentro de una simulación'
            assert sum(len(p.gigs) + len(p.fixer) for p in g.p) == 12, 'los 12 dados siguen en juego'
            assert all(p.Eready <= p.E for p in g.p)
            if kind == 'action':
                go = [i for i, o in enumerate(options) if o['group'] != 'fin']
                return rng.choice(go) if go and rng.random() < 0.9 else len(options) - 1
            return rng.randrange(len(options))
        h = H.Human(seed % 2, ask)
        a, b = (FILLER, LEGS_A), (FILLER, LEGS_B)
        first, second = (a, b) if seed % 2 == 0 else (b, a)
        g = E.Game(first[0], first[1], second[0], second[1], seed, deep=(True, True), err=(0, 0), ai=h)
        g.chooser = h.choose
        g.run()
        assert g.winner is not None


def t_human_covers_the_pilot():
    """Una persona que copia el plan del piloto casi siempre encuentra una opción para cada una de sus acciones: lo que el piloto sabe
    hacer en su turno (vender, jugar, Call, Go Solo, atacar, Alt, Overwatch...) también se puede hacer a mano. Si cae por debajo,
    se ha roto la lista de jugadas que se ofrecen a la persona."""
    from deckio import ids_of, load_deck
    decks = [load_deck(str(Path(__file__).resolve().parent / 'meta' / f'{n}.json')) for n in ('bbg_control', 'red_aggro', 'judy_mono_blue', 'rivers_closet')]
    same = turns = 0
    for seed in range(6):
        pi, a, b = seed % 2, decks[seed % 4], decks[(seed + 1) % 4]
        mine, plans = {}, {}
        st = {'turn': None, 'plan': [], 'i': 0}

        def ask(g, kind, prompt, options, extra):
            if kind != 'action':
                return 0
            if st['turn'] != g.turn:
                st.update(turn=g.turn, plan=list(HP.turn_plan(g, pi)), i=0)
                plans[g.turn], mine[g.turn] = [tuple(x) for x in st['plan']], []
            for k, o in enumerate(options):                    # como el piloto: primero las habilidades que roban cartas o preparan Unidades
                if o['label'].startswith(('Judy Alvarez', 'Kerry', 'Panam', 'Evelyn')):
                    return k
            while st['i'] < len(st['plan']):
                want = st['plan'][st['i']]
                st['i'] += 1
                for k, o in enumerate(options):
                    if HP.describe(o) == want:
                        mine[g.turn].append(want)
                        return k
            return len(options) - 1
        h = H.Human(pi, ask)
        first, second = (a, b) if pi == 0 else (b, a)
        g = E.Game(ids_of(first['main']), first['legends'], ids_of(second['main']), second['legends'], seed, deep=(True, True), err=(0, 0),
                   vf=('action', 'action'), ai=h)
        g.chooser = h.choose
        g.run()
        for t, plan in plans.items():
            only_h, only_p = HP.diff(mine.get(t, []), plan)
            turns += 1
            same += not only_h and not only_p
    assert turns >= 25 and same / turns >= 0.8, f'solo {same} de {turns} turnos iguales a los del piloto'


def t_human_pilot_diff():
    """Comparar turnos no depende del orden: las mismas acciones en otro orden son el mismo turno; ignora terminar y las habilidades."""
    sell, play, atk = ('sell', 'a', None), ('play', 'b', None), ('attack', 'c', None)
    assert HP.diff([play, sell], [sell, play]) == ([], [])
    assert HP.diff([sell, ('end', None, None)], [sell, ('ability', 'x', None)]) == ([], [])
    assert HP.diff([sell, play], [sell, atk]) == ([play], [atk])
    assert HP.diff([play, play], [play]) == ([play], []), 'jugar dos copias donde el piloto juega una es una diferencia'
    assert HP.describe({'group': 'atacar', 'card': 'c', 'tgt': None, 'label': 'x'}) == atk
    assert HP.describe({'group': 'legend', 'label': 'Call (1 €): girar una Legend al azar'}) == ('call', None, None)
    assert HP.describe({'group': 'objetivo', 'label': 'x'}) is None


def t_human_alt_and_overwatch():
    """Alt Cunningham (descuento y Programa de la basura) y Overwatch en el turno propio se ofrecen y tienen el efecto del piloto."""
    alt_legs = ['alt_cunningham_soulkiller_architect', 'lucyna_kushinada_fresh_beginnings', 'wakako_okada_peace_and_harmony']
    g, me, op = board(legs_a=alt_legs)
    for l in me.legs:
        l.up = l.ready = True
    alt = me.leg('alt_cunningham_soulkiller_architect')
    me.E = me.Eready = 2
    gigs(me, (4, 1))
    me.trash = [CARD['trust_no_one']]
    h, log = _human(g, 0, 'Alt Cunningham: gastarla')
    h.main(g, me, op)
    assert me.alt_disc == 1 and not alt.ready, 'el descuento de Alt: un Gig de valor 1 = 1 € menos en el próximo Programa'
    assert any(o.startswith('Alt Cunningham: jugar Trust No One') for o in log[0][1]), log[0][1]
    g, me, op = board(legs_a=alt_legs)
    for l in me.legs:
        l.up = l.ready = True
    alt = me.leg('alt_cunningham_soulkiller_architect')
    for l in me.legs:
        l.ready = l is alt                                # solo Alt preparada
    me.E = me.Eready = 2                                  # 1 € de la habilidad + 1 € del Programa
    me.trash = [CARD['trust_no_one']]
    h, log = _human(g, 0, 'Alt Cunningham: jugar Trust No One')
    h.main(g, me, op)
    assert not me.trash and me.deck[0]['id'] == 'trust_no_one', 'el Programa jugado desde la basura va al fondo del mazo'
    assert me.Eready == 0 and not alt.ready, 'cuesta 1 € más el coste del Programa (Alt se gasta)'
    g, me, op = board()
    u = unit(g, me, 'psycho_squad')
    u.gear.append(CARD['overwatch_panam_s_gift'])
    victim = unit(g, op, 'corpo_security', ready=False)
    me.hand = [CARD['psycho_squad']]
    me.E = me.Eready = 1
    h, log = _human(g, 0, 'Overwatch (1 €): derrotar a Corpo Security')
    h.main(g, me, op)
    assert victim not in op.field and not u.ready and me.Eready == 0, 'Overwatch derrota a la Unidad gastada y gasta la equipada'
    assert [c['id'] for c in me.trash] == ['psycho_squad'] and not me.hand, 'la carta descartada va a la basura'


def t_humanlog_report():
    """humanlog compara tus turnos con los del piloto sin depender del orden, cuenta los resultados y exporta solo partidas con ganador."""
    def game(winner, human_acts, plan, aborted=False):
        return dict(file='g.json', human=0, winner=winner, aborted=aborted, rows=[[[0.5], 1, 0.1], [[0.2], 0, 0.3]],
                    decks=[dict(name='Mio', legs=[], main=[]), dict(name='Piloto', legs=[], main=[])],
                    decisions=[dict(kind='action', turn=1, act=a) for a in human_acts] + [dict(kind='action', turn=1, act=['end', None, None])],
                    plans={'1': plan})
    same = game(0, [['play', 'psycho_squad', None], ['sell', 'floor_it', None]], [['sell', 'floor_it', None], ['play', 'psycho_squad', None]])
    diff = game(1, [['sell', 'floor_it', None]], [['sell', 'floor_it', None], ['play', 'psycho_squad', None]])
    assert HL.compare_turns(same)[0][3:] == ([], []), 'mismas acciones en otro orden = mismo turno'
    turn, mine, pilot, only_h, only_p = HL.compare_turns(diff)[0]
    assert only_h == [] and only_p == [('play', 'psycho_squad', None)]
    assert HL.outcome(same) == 'win' and HL.outcome(diff) == 'loss' and HL.outcome(game(None, [], [], aborted=True)) is None
    text = HL.report([same, diff, game(None, [], [], aborted=True)])
    assert '3 partidas guardadas (1 abandonadas' in text and '1 ganadas de 2' in text and 'Turnos iguales al piloto: 1 de 2 (50 %)' in text, text
    assert 'jugar Psycho Squad' in text
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        assert HL.export_rows([same, diff, game(None, [], [], aborted=True)], str(Path(d) / 'rows.json')) == 4, 'solo partidas terminadas con ganador'


def t_human_pay_choice():
    """La persona elige con qué Legends paga; no se le pregunta si solo hay una forma de pagar, si lo desactiva ni en simulaciones."""
    def setup(eddies, ready):
        g, me, op = board()
        for l in me.legs:
            l.up = True
            l.ready = l.c['id'] in ready
        me.E = me.Eready = eddies
        me.hand = [CARD['emergency_atlus']]                  # cuesta 3
        return g, me, op
    wakako, lucyna = 'wakako_okada_peace_and_harmony', 'lucyna_kushinada_fresh_beginnings'
    g, me, op = setup(2, {wakako, lucyna})
    h, log = _human(g, 0, 'Jugar Emergency Atlus', 'Pagar con 2 Eddies sueltos + Wakako')
    h.main(g, me, op)
    pay = next(entry for entry in log if entry[0] == 'pay')[1]
    assert sorted(pay) == sorted(['Pagar con 2 Eddies sueltos + Wakako Okada', 'Pagar con 2 Eddies sueltos + Lucyna Kushinada',
                                  'Pagar con 1 Eddie suelto + Lucyna Kushinada + Wakako Okada']), pay
    assert me.Eready == 0 and not me.leg(wakako).ready and me.leg(lucyna).ready, 'se gasta la Legend elegida y los Eddies que faltan'
    assert [u.c['id'] for u in me.field] == ['emergency_atlus']
    g, me, op = setup(3, set())
    h, log = _human(g, 0, 'Jugar Emergency Atlus')
    h.main(g, me, op)
    assert not any(k == 'pay' for k, _ in log) and me.Eready == 0, 'con una sola forma de pagar no se pregunta'
    g, me, op = setup(2, {wakako, lucyna})
    h, log = _human(g, 0, 'Jugar Emergency Atlus')
    h.choose_pay = False
    h.main(g, me, op)
    assert not any(k == 'pay' for k, _ in log) and me.field, 'con el pago automático tampoco'
    g, me, op = setup(2, {wakako, lucyna})
    h, log = _human(g, 0)
    g.rollout = True
    assert h.pay(g, me, 3, ()) is None and not log, 'en una simulación decide el piloto'


def t_human_plan_never_asks():
    """Calcular qué habría hecho el piloto en tu turno no te pregunta nada: la copia no hereda los ganchos de la persona."""
    g, me, op = board()
    for l in me.legs:
        l.up = l.ready = True
    me.E = me.Eready = 1
    me.hand = [CARD['emergency_atlus'], CARD['trust_no_one']]
    h, log = _human(g, 0)
    plan = HP.turn_plan(g, 0)
    assert not log, f'el cálculo del plan preguntó a la persona: {log}'
    assert any(a[0] == 'play' for a in plan), 'el piloto juega algo con tres Legends y un Eddie'
    assert not me.field and len(me.hand) == 2, 'y la partida real no se toca'


def t_human_option_sources():
    """Cada opción dice de qué carta, Unidad o Legend sale y adónde va, para que la interfaz la muestre al tocar esa carta o al arrastrarla."""
    g, me, op = board()
    for l in me.legs:
        l.up = False
    me.E = me.Eready = 4
    me.hand = [CARD['floor_it'], CARD['emergency_atlus']]
    gigs(op, (4, 2))
    unit(g, me, 'psycho_squad')
    seen = {}

    def ask(g_, kind, prompt, options, extra):
        seen.update({o['group']: o for o in options if o['group'] in ('vender', 'jugar', 'atacar', 'legend') and o['group'] not in seen})
        return len(options) - 1
    h = H.Human(0, ask)
    g.ai = h
    h.main(g, me, op)
    assert seen['vender']['src'] == dict(z='h', side=0, id='floor_it') or seen['vender']['src']['id'] in ('floor_it', 'emergency_atlus')
    assert seen['jugar']['src']['z'] == 'h' and seen['jugar']['src']['id'] == seen['jugar']['card']
    assert seen['atacar']['src'] == dict(z='f', side=0, i=0) and seen['atacar']['to'] == dict(z='g', side=1), seen['atacar']
    assert seen['legend']['src']['z'] == 'lz', 'el Call se hace sobre la zona de Legends'


def t_human_choose_one_effects():
    """En las cartas de «elige un efecto» elige la persona (Nocturne, Pyramid Song, Towerfall y el Call de las Legends); el piloto, su heurística."""
    # Nocturne: el piloto bloquearía a la Unidad rival; la persona puede robar 2
    g, me, op = board()
    victim = unit(g, op, 'psycho_squad')
    me.hand = [CARD['nocturne_op55_n1']]
    me.E = me.Eready = 3
    h, log = _human(g, 0, 'Jugar Nocturne', 'Robar 2')
    h.main(g, me, op)
    modes = next(opts for kind, opts in log if kind == 'mode')
    assert modes == ['Robar 2 cartas', 'Una Unidad rival no puede atacar hasta tu próximo turno'], modes
    assert len(me.hand) == 2 and not victim.noatk, 'elige robar 2 aunque el piloto prefiriera impedir un ataque'
    g, me, op = board()
    victim = unit(g, op, 'psycho_squad')
    me.hand = [CARD['nocturne_op55_n1']]
    me.E = me.Eready = 3
    h, log = _human(g, 0, 'Jugar Nocturne', 'Una Unidad rival no puede atacar')
    h.main(g, me, op)
    assert victim.noatk and not me.hand, 'con una sola Unidad rival no pregunta cuál'
    # Pyramid Song: -4 a la Unidad que elige, o al fondo del mazo la de poder 0
    for pick, check in (('Mandar al fondo', 'bottom'), ('Dar -4', 'debuff')):
        g, me, op = board()
        weak = unit(g, op, 'secondhand_bombus')
        strong = unit(g, op, 'psycho_squad')
        me.hand = [CARD['pyramid_song']]
        me.E = me.Eready = 9
        script = ['Jugar Pyramid Song', pick] + (['Psycho Squad'] if check == 'debuff' else [])
        h, log = _human(g, 0, *script)
        h.main(g, me, op)
        if check == 'bottom':
            assert weak not in op.field and strong in op.field and strong.tmp == 0
        else:
            assert strong.tmp == -4 and weak.tmp == 0 and weak in op.field, 'el -4 va a la Unidad que elige la persona'
    # Towerfall: -5 a todas
    g, me, op = board()
    a, b = unit(g, op, 'psycho_squad'), unit(g, op, 'corpo_security')
    me.hand = [CARD['towerfall']]
    me.E = me.Eready = 9
    h, log = _human(g, 0, 'Jugar Towerfall', 'Dar -5')
    h.main(g, me, op)
    assert a.tmp == b.tmp == -5
    # Call de las Legends: la persona elige entre el efecto y robar
    legs = ['wakako_okada_peace_and_harmony', 'padre_man_of_the_cross', 'dexter_deshawn_off_the_grid']
    g, me, op = board(legs_a=legs)
    victim = unit(g, op, 'psycho_squad')
    mine = [unit(g, me, 'psycho_squad'), unit(g, me, 'corpo_security')]
    h, log = _human(g, 0, 'Dar -2')
    g.fx.on_call(g, me, op, me.leg(legs[0]) or next(l for l in me.legs if l.c['id'] == legs[0]))
    assert victim.tmp == -2 and not me.hand, 'Wakako: -2 de poder en vez de robar'
    h, log = _human(g, 0, 'Robar 1')
    g.fx.on_call(g, me, op, next(l for l in me.legs if l.c['id'] == legs[2]))
    assert len(me.hand) == 1 and all(u.tmp == 0 for u in mine), 'Dexter: robar sin que pregunte ninguna Unidad'
    h, log = _human(g, 0, 'Gastar una Unidad rival')
    g.fx.on_call(g, me, op, next(l for l in me.legs if l.c['id'] == legs[1]))
    assert not victim.ready, 'Padre: gasta la Unidad rival'
    # sin persona decidiendo (el piloto o una simulación), nada de esto pregunta: Wakako roba como siempre
    g, me, op = board(legs_a=legs)
    unit(g, op, 'psycho_squad')
    h, log = _human(g, 0)
    g.human_pi = None
    g.fx.on_call(g, me, op, next(l for l in me.legs if l.c['id'] == legs[0]))
    assert not log and len(me.hand) == 1, 'el piloto roba 1 y no pregunta a nadie'


def t_human_chooses_targets_of_programs():
    """Los Programas que el piloto resolvía solo ahora los resuelve la persona: a qué Unidad rival se gasta, qué cartas se queda de las
    reveladas, qué Unidad propia se derrota y, cuando el piloto juega, lo que le toca decidir al rival."""
    # Corporate Surveillance y Memory Relapse: la Unidad rival que se gasta
    for card, script, check in (('corporate_surveillance', ('Jugar Corporate Surveillance', 'Corpo Security'), 'spent'),
                                ('memory_relapse', ('Jugar Memory Relapse', 'Corpo Security'), 'noready')):
        g, me, op = board()
        a, b = unit(g, op, 'corpo_security'), unit(g, op, 'emergency_atlus')
        me.hand = [CARD[card]]
        me.E = me.Eready = 9
        h, log = _human(g, 0, *script)
        h.main(g, me, op)
        assert not a.ready and b.ready, f'{card}: se gasta la Unidad que elige la persona'
        if check == 'noready':
            assert a.noready and not b.noready, 'y no se prepara en su próximo turno'
    # Three Mouths: de las 3 reveladas se queda la que elige (no la que valoraba mejor el piloto)
    g, me, op = board()
    me.hand = [CARD['three_mouths_one_desire']]
    me.E = me.Eready = 9
    me.deck = me.deck[:5] + [CARD['psycho_squad'], CARD['corpo_security'], CARD['emergency_atlus']]     # la de arriba es la última
    h, log = _human(g, 0, 'Jugar Three Mouths', 'Corpo Security')
    h.main(g, me, op)
    assert [c['id'] for c in me.hand] == ['corpo_security'], me.hand
    assert [c['id'] for c in me.deck[:2]] and {c['id'] for c in me.deck[:2]} == {'psycho_squad', 'emergency_atlus'}, 'las otras dos van al fondo'
    # Live with the Aftermath: cada jugador derrota una Unidad SUYA; la persona elige la suya también cuando juega el piloto
    g, me, op = board()
    a, b = unit(g, me, 'corpo_security'), unit(g, me, 'emergency_atlus')
    unit(g, op, 'psycho_squad')
    h, log = _human(g, 0, 'Corpo Security')
    g.fx.play_program(g, me, op, CARD['live_with_the_aftermath'])
    assert a not in me.field and b in me.field and not op.field, 'derrota la que elige la persona (el piloto habría derrotado la de menos valor)'
    g, bot, human = board()
    keep, lose = unit(g, human, 'psycho_squad'), unit(g, human, 'corpo_security')
    unit(g, bot, 'emergency_atlus')
    h, log = _human(g, 1, 'Psycho Squad')                       # juega el piloto (J1); elige la persona (J2)
    g.fx.play_program(g, bot, human, CARD['live_with_the_aftermath'])
    assert keep not in human.field and lose in human.field, 'si juega el piloto, la persona también elige la suya'
    # Fool on the Hill: el RIVAL elige si se las queda o las tira; si es la persona, decide ella
    for answer, expect_hand in (('Añadírselas', 2), ('Tirarlas', 2)):
        g, bot, human = board()
        bot.deck = [CARD['floor_it']] * 6 + [CARD['psycho_squad'], CARD['corpo_security']]
        before = len(bot.hand)
        h, log = _human(g, 1, answer)
        g.fx.play_program(g, bot, human, CARD['fool_on_the_hill'])
        assert len(bot.hand) - before == expect_hand
        names = {c['id'] for c in bot.hand[before:]}
        assert (names == {'psycho_squad', 'corpo_security'}) == (answer == 'Añadírselas'), (answer, names)
    # Gunpoint Diplomacy: la Unidad que lo recibe la elige la persona
    g, me, op = board()
    a, b = unit(g, me, 'psycho_squad'), unit(g, me, 'emergency_atlus')
    h, log = _human(g, 0, 'Emergency Atlus')
    g.fx.play_program(g, me, op, CARD['gunpoint_diplomacy'])
    assert b.tmp == 3 and b.atkr and a.tmp == 0 and not a.atkr


def t_human_chooses_unit_effects():
    """Los efectos «puedes...» y con objetivo de las Unidades los decide la persona (Maman Brigitte, Malfini); el piloto, su heurística."""
    def setup():
        g, me, op = board()
        me.hand = [CARD['maman_brigitte_spirit_of_death'], CARD['trust_no_one'], CARD['floor_it'], CARD['three_mouths_one_desire']]
        me.E = me.Eready = 9
        return g, me, op, unit(g, op, 'psycho_squad'), unit(g, op, 'corpo_security')
    # Maman: sí, a qué Unidad, y qué dos Programas se descartan
    g, me, op, strong, weak = setup()
    h, log = _human(g, 0, 'Jugar Maman', 'Descartar 2 Programas', 'Corpo Security', 'Floor It', 'Trust No One')
    h.main(g, me, op)
    assert weak not in op.field and strong in op.field, 'al fondo del mazo la Unidad que elige la persona'
    assert sorted(c['id'] for c in me.trash) == ['floor_it', 'trust_no_one'] and [c['id'] for c in me.hand] == ['three_mouths_one_desire']
    # Maman: «puedes» -> se puede no hacerlo
    g, me, op, strong, weak = setup()
    h, log = _human(g, 0, 'Jugar Maman', 'No hacerlo')
    h.main(g, me, op)
    assert strong in op.field and weak in op.field and not me.trash and len(me.hand) == 3
    # Malfini: gasta la Unidad rival que elige la persona
    g, me, op, strong, weak = setup()
    me.hand = [CARD['offduty_malfini']]
    h, log = _human(g, 0, 'Jugar Offduty Malfini', 'Corpo Security')
    h.main(g, me, op)
    assert not weak.ready and strong.ready, 'se gasta la Unidad que elige la persona'


TESTS = [t_steal_breakpoint, t_blocker_and_fights, t_targets_and_lag, t_bottom_is_not_defeat, t_pyramid_and_towerfall, t_overwatch_cost_order,
         t_reactions, t_go_solo_and_economy, t_full_games, t_human_error, t_replay_dice, t_human_sell_and_play, t_human_attack_and_block,
         t_human_dice_and_targets, t_human_hidden_information, t_human_random_games, t_human_covers_the_pilot, t_human_pilot_diff,
         t_human_alt_and_overwatch, t_humanlog_report, t_human_pay_choice, t_human_plan_never_asks, t_human_option_sources, t_human_choose_one_effects,
         t_human_chooses_targets_of_programs, t_human_chooses_unit_effects]


def run(verbose=False):
    for t in TESTS:
        t()
        if verbose:
            print('  ok', t.__name__)
    return len(TESTS)


if __name__ == '__main__':
    print(f'{run(verbose=True)} pruebas de reglas superadas')
