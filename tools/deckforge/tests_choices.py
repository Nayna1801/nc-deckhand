"""Pruebas de las cartas donde decide la persona (y no el piloto): descartes por efecto, Shattered Memories, Detonate, Bonnie and Clyde,
The Heist, las llamadas de Dum Dum y Viktor, y las habilidades de las Legends Panam y Evelyn.

Cada comprobación monta la misma situación dos veces: sin persona (el piloto elige lo que siempre ha elegido y no pregunta nada) y con una
persona que elige lo CONTRARIO que el piloto, para que la prueba falle si el motor sigue decidiendo solo.

Uso:  python tools/deckforge/tests_choices.py      (también las lanza `forge.py selftest`)
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from engine2 import CARD  # noqa: E402
from tests2 import _human, board, gigs, unit  # noqa: E402

LEGS_DUMDUM = ['dum_dum_maelstrom_triggerman', 'lucyna_kushinada_fresh_beginnings', 'wakako_okada_peace_and_harmony']
LEGS_VIKTOR = ['viktor_vektor_sit_down_and_relax', 'lucyna_kushinada_fresh_beginnings', 'wakako_okada_peace_and_harmony']
LEGS_PANAM = ['panam_palmer_nomad_cavalry', 'evelyn_parker_beautiful_enigma', 'wakako_okada_peace_and_harmony']
LEGS_GORO = ['goro_takemura_vengeful_bodyguard', 'lucyna_kushinada_fresh_beginnings', 'wakako_okada_peace_and_harmony']
LEGS_DOWN = ['goro_takemura_hands_unclean', 'lucyna_kushinada_fresh_beginnings', 'wakako_okada_peace_and_harmony']


def _ids(cards):
    return [c['id'] for c in cards]


def _asked(log, kind):
    return [opts for k, opts in log if k == kind]


def t_choice_discards_by_effect():
    """Cuando un efecto te hace descartar (el tuyo o el que provoca el rival), la persona elige qué carta; el piloto, la que menos valora."""
    hand = ['floor_it', 'psycho_squad', 'trust_no_one']

    def sasha(script):                              # la Unidad de J1 se derrota: su rival (J2) descarta 1
        g, bot, human = board()
        human.hand = [CARD[i] for i in hand]
        s = unit(g, bot, 'sasha_yakovleva_won_t_let_you_down')
        log = _human(g, 1, script)[1] if script else []
        g.defeat(s, 'prueba', by=human)
        return human, log

    base, log = sasha(None)
    pilot = _ids(base.trash)
    assert len(pilot) == 1 and not log, 'sin persona descarta una carta y no pregunta'
    other = next(i for i in hand if i != pilot[0])
    human, log = sasha(CARD[other]['name'])
    assert _ids(human.trash) == [other], f'la persona descarta la que elige ({other}), no la del piloto ({pilot})'
    assert _asked(log, 'target'), 'se le pregunta qué descarta'
    g, bot, human = board()
    human.hand = [CARD['floor_it']]
    s = unit(g, bot, 'sasha_yakovleva_won_t_let_you_down')
    log = _human(g, 1, 'Floor It')[1]
    g.defeat(s, 'prueba', by=human)
    assert _ids(human.trash) == ['floor_it'] and not log, 'con una sola carta en la mano no hay nada que elegir'

    def evelyn(script):                             # Evelyn: roba 1 y, con más Street Cred que el rival, descarta 1
        g, me, op = board()
        me.hand = [CARD['floor_it'], CARD['trust_no_one']]
        gigs(me, (6, 3))
        u = unit(g, me, 'evelyn_parker_scheming_siren')
        log = _human(g, 0, script)[1] if script else []
        g.fx.on_attack(g, me, op, u, None)
        return me, log

    base, log = evelyn(None)
    assert len(base.trash) == 1 and not log
    pilot_card = base.trash[0]['id']
    pool = _ids(base.hand) + [pilot_card]
    other = next(i for i in pool if i != pilot_card)
    mine, log = evelyn(CARD[other]['name'])
    assert _ids(mine.trash) == [other], f'Evelyn: descarta la que elige la persona ({other}), no ({pilot_card})'


def t_choice_shattered_memories():
    """Shattered Memories: cada jugador PUEDE robar 5; la persona decide si roba, también cuando la juega el piloto."""
    def play(human_pi, answer):
        g, me, op = board()
        me.hand = [CARD['floor_it'], CARD['trust_no_one']]
        op.hand = [CARD['psycho_squad']]
        log = _human(g, human_pi, answer)[1] if answer else []
        g.fx.play_program(g, me, op, CARD['shattered_memories'])
        return me, op, log

    me, op, log = play(None, None)
    assert len(me.hand) == 5 and len(op.hand) == 5 and not log, 'el piloto roba 5 y no pregunta'
    me, op, log = play(0, 'Robar 5')
    assert len(me.hand) == 5 and len(op.hand) == 5 and _asked(log, 'mode')
    me, op, log = play(0, 'No hacerlo')
    assert not me.hand and len(me.trash) == 2, 'sin robar: se descarta la mano igualmente'
    assert len(op.hand) == 5, 'el rival piloto sigue robando'
    me, op, log = play(1, 'No hacerlo')
    assert len(me.hand) == 5 and not op.hand and _ids(op.trash) == ['psycho_squad'], 'si juega el piloto, la persona (rival) decide si roba'


def t_choice_detonate_and_bonnie():
    """Detonate: qué Gear rival se derrota. Bonnie and Clyde: qué Unidad (o dos, con 2 Gigs de ventaja del rival) y si se derrota la segunda."""
    def detonate(script):
        g, me, op = board()
        a, b = unit(g, op, 'secondhand_bombus'), unit(g, op, 'psycho_squad')
        a.gear = [CARD['mandibular_upgrade']]
        b.gear = [CARD['kiroshi_optics']]
        log = _human(g, 0, script)[1] if script else []
        g.fx.play_program(g, me, op, CARD['detonate'])
        return a, b, log

    a, b, log = detonate(None)
    pilot_left = (bool(a.gear), bool(b.gear))
    assert sum(pilot_left) == 1 and not log
    name = 'Kiroshi Optics' if not a.gear else 'Mandibular Upgrade'        # el Gear que el piloto NO habría derribado
    other = detonate(name)
    assert (bool(other[0].gear), bool(other[1].gear)) != pilot_left, 'la persona derriba el Gear contrario al del piloto'
    assert _asked(other[2], 'target')

    def bonnie(script, gigs_op=((4, 2),)):
        g, me, op = board()
        gigs(op, *gigs_op)
        us = [unit(g, op, 'corpo_security'), unit(g, op, 'emergency_atlus'), unit(g, op, 'secondhand_bombus')]
        log = _human(g, 0, *script)[1] if script else []
        g.fx.play_program(g, me, op, CARD['bonnie_and_clyde'])
        return us, log

    us, log = bonnie(None)
    gone = [u for u in us if u not in u.owner.field]
    assert len(gone) == 1 and not log
    cands = ['Corpo Security', 'Emergency Atlus', 'Secondhand Bombus']
    pick = next(n for n, u in zip(cands, us) if u in u.owner.field)           # una Unidad que el piloto no habría derrotado
    us, log = bonnie([pick])
    assert [u for u in us if u not in u.owner.field] == [us[cands.index(pick)]], 'se derrota la Unidad que elige la persona'
    wide = ((4, 2), (6, 3), (8, 5))                                            # el rival tiene 3 Gigs y tú 0: puedes derrotar 2
    us, log = bonnie(['Corpo Security', 'Derrotar una segunda', 'Secondhand Bombus'], wide)
    assert [u for u in us if u in u.owner.field] == [us[1]], 'derrota las dos que elige la persona'
    us, log = bonnie(['Corpo Security', 'No hacerlo'], wide)
    assert [u for u in us if u not in u.owner.field] == [us[0]], '«puedes derrotar 2»: la persona puede quedarse en una'


def t_choice_heist():
    """The Heist: si el Gear tiene el coste de uno de tus Gigs, la persona decide entre jugarlo gratis o añadirlo a la mano."""
    def heist(script):
        g, me, op = board()
        gigs(me, (6, 3))
        u = unit(g, me, 'psycho_squad')
        me.deck += [CARD['netwatch_netdriver'], CARD['floor_it'], CARD['floor_it'], CARD['floor_it']]
        log = _human(g, 0, script)[1] if script else []
        g.fx.play_program(g, me, op, CARD['the_heist'])
        return me, u, log

    me, u, log = heist(None)
    assert _ids(u.gear) == ['netwatch_netdriver'] and not log, 'el piloto lo juega gratis y no pregunta'
    me, u, log = heist('Añadir')
    assert not u.gear and 'netwatch_netdriver' in _ids(me.hand), 'la persona prefiere guardarlo en la mano'
    me, u, log = heist('Jugar')
    assert _ids(u.gear) == ['netwatch_netdriver']

    def heist_two_units(script):                    # con dos Unidades, la persona elige a cuál se equipa el Gear gratis
        g, me, op = board()
        gigs(me, (6, 3))
        a, b = unit(g, me, 'psycho_squad'), unit(g, me, 'emergency_atlus')
        me.deck += [CARD['netwatch_netdriver'], CARD['floor_it'], CARD['floor_it'], CARD['floor_it']]
        log = _human(g, 0, *script)[1] if script else []
        g.fx.play_program(g, me, op, CARD['the_heist'])
        return a, b, log

    a, b, log = heist_two_units(None)
    assert (bool(a.gear) != bool(b.gear)) and not log
    contrary = 'Emergency Atlus' if a.gear else 'Psycho Squad'
    a, b, log = heist_two_units(['Jugar', contrary])
    assert bool(b.gear if contrary == 'Emergency Atlus' else a.gear) and not (a.gear and b.gear), 'se equipa a la Unidad que elige la persona'


def t_choice_calls_dum_dum_and_viktor():
    """Dum Dum: puedes derrotar un Gear tuyo para robar 2 (si no, 1). Viktor: de las 5 cartas, la persona elige los 2 Gears."""
    def dumdum(script):
        g, me, op = board(legs_a=LEGS_DUMDUM)
        u = unit(g, me, 'psycho_squad')
        u.gear = [CARD['riot_shield']]
        log = _human(g, 0, script)[1] if script else []
        g.fx.on_call(g, me, op, next(l for l in me.legs if l.c['id'] == LEGS_DUMDUM[0]))
        return me, u, log

    me, u, log = dumdum(None)
    assert len(me.hand) == 1 and u.gear and not log, 'el piloto roba 1 y conserva el Gear'
    me, u, log = dumdum('Derrotar un Gear')
    assert len(me.hand) == 2 and not u.gear and _ids(me.trash) == ['riot_shield'], 'derrotar el Gear da 2 cartas'
    me, u, log = dumdum('Robar 1')
    assert len(me.hand) == 1 and u.gear

    def viktor(script):
        g, me, op = board(legs_a=LEGS_VIKTOR)
        me.deck += [CARD['floor_it'], CARD['riot_shield'], CARD['kiroshi_optics'], CARD['arasaka_emergency_radioport'], CARD['floor_it']]
        log = _human(g, 0, *script)[1] if script else []
        g.fx.on_call(g, me, op, next(l for l in me.legs if l.c['id'] == LEGS_VIKTOR[0]))
        return me, log

    me, log = viktor(None)
    pilot = sorted(_ids(me.hand))
    assert len(pilot) == 2 and not log
    chosen = [n for i, n in (('kiroshi_optics', 'Kiroshi Optics'), ('riot_shield', 'Riot Shield'), ('arasaka_emergency_radioport', 'Arasaka Emergency Radioport'))
              if i not in pilot or i == 'kiroshi_optics'][:2]
    me, log = viktor(chosen)
    assert sorted(_ids(me.hand)) != pilot, 'la persona se queda con los Gears que elige, no con los del piloto'
    assert len(me.hand) == 2 and _asked(log, 'target')


def t_choice_panam_and_evelyn():
    """Panam y Evelyn ya no son «habilidades fijas del piloto»: la persona elige qué Gear se mueve y a qué Unidad, y qué Unidad rival debe atacar."""
    def panam(script):
        g, me, op = board(legs_a=LEGS_PANAM)
        pn = next(l for l in me.legs if l.c['id'] == LEGS_PANAM[0])
        pn.up = pn.ready = True
        pn.gear = [CARD['riot_shield'], CARD['kiroshi_optics']]
        me.E = me.Eready = 3
        a, b = unit(g, me, 'psycho_squad', ready=False), unit(g, me, 'corpo_security', ready=False)
        h, log = _human(g, 0, *script)
        h.main(g, me, op)
        return me, pn, a, b, log

    me, pn, a, b, log = panam(['Panam', 'Kiroshi Optics', 'Corpo Security'])
    assert _ids(b.gear) == ['kiroshi_optics'] and not a.gear and b.ready, 'el Gear y la Unidad que elige la persona; la Unidad se prepara'
    assert _ids(pn.gear) == ['riot_shield'] and not pn.ready and me.Eready == 1, 'Panam se gasta y cuesta 2 €'
    assert not any('Panam' in o for opts in _asked(log, 'turn') for o in opts if 'fijas' in o), 'ya no va dentro de «habilidades fijas»'

    def evelyn(script):
        g, me, op = board(legs_a=LEGS_PANAM)
        ev = next(l for l in me.legs if l.c['id'] == LEGS_PANAM[1])
        ev.up = ev.ready = True
        me.E = me.Eready = 2
        t1, t2 = unit(g, op, 'psycho_squad'), unit(g, op, 'emergency_atlus')
        h, log = _human(g, 0, *script)
        h.main(g, me, op)
        return me, ev, t1, t2, log

    me, ev, t1, t2, log = evelyn(['Evelyn', 'Emergency Atlus'])
    assert t2.must and not t1.must, 'debe atacar la Unidad rival que elige la persona'
    assert not ev.ready and me.Eready == 1


def t_choice_gunpoint_rival_chooses():
    """Gunpoint Diplomacy con menos Street Cred: el RIVAL elige uno de los dos efectos para ti, el que menos te sirve (antes: siempre el de atacar)."""
    def gunpoint(mine, theirs):
        g, me, op = board()
        gigs(me, (4, 2))
        gigs(op, (6, 3))                                             # menos Street Cred que el rival
        u = unit(g, me, mine)
        for cid in theirs:
            unit(g, op, cid)
        _human(g, 0)
        g.fx.play_program(g, me, op, CARD['gunpoint_diplomacy'])
        return u

    u = gunpoint('psycho_squad', ['emergency_atlus'])                # poder 6: el +3 no cruza ningún tramo, pero atacar a una Unidad sí sirve
    assert u.tmp == 3 and not u.atkr, 'el rival te deja el +3 y te quita poder atacar Unidades preparadas'
    u = gunpoint('yorinobu_arasaka_steel_dragon', [])                # poder 9: el +3 roba un Gig más; atacar Unidades no sirve (no hay)
    assert u.tmp == 0 and u.atkr, 'el rival te quita el +3 y te deja atacar Unidades preparadas'
    g, me, op = board()                                              # con más Street Cred que el rival se reciben los dos efectos
    gigs(me, (6, 3))
    gigs(op, (4, 2))
    u = unit(g, me, 'psycho_squad')
    _human(g, 0)
    g.fx.play_program(g, me, op, CARD['gunpoint_diplomacy'])
    assert u.tmp == 3 and u.atkr


def t_choice_look_at_legends():
    """Kiroshi Optics y Arasaka Emergency Radioport: la persona elige qué Legend boca abajo mira (el piloto, una al azar) y si la llama gratis."""
    def down(legs):
        g, me, op = board(legs_a=legs)
        for l in me.legs:
            l.up, l.known, l.ready = False, False, True
        me.called = False
        return g, me, op

    def kiroshi(script):
        g, me, op = down(LEGS_DOWN)
        u = unit(g, me, 'psycho_squad')
        u.gear = [CARD['kiroshi_optics']]
        log = _human(g, 0, script)[1] if script else []
        g.fx.on_attack(g, me, op, u, None)
        return [i for i, l in enumerate(me.legs) if l.known], log

    known, log = kiroshi(None)
    assert len(known) == 1 and not log, 'el piloto mira una al azar y no pregunta'
    other = (known[0] + 1) % 3
    known, log = kiroshi(f'Mirar la Legend boca abajo nº {other + 1}')
    assert known == [other] and _asked(log, 'mode'), 'la persona mira la Legend que elige'

    def radioport(*script):
        g, me, op = down(LEGS_DOWN)
        u = unit(g, me, 'psycho_squad')
        u.gear = [CARD['arasaka_emergency_radioport']]
        log = _human(g, 0, *script)[1] if script else []
        g.fx.on_spent_gear(g, me, u)
        return me, log

    legs = down(LEGS_DOWN)[1].legs                                   # el orden de las Legends no es el de la lista: se busca la posición de cada una
    goro = next(i for i, l in enumerate(legs) if l.c['id'] == LEGS_DOWN[0])
    lucyna = next(i for i, l in enumerate(legs) if l.c['id'] == LEGS_DOWN[1])
    me, log = radioport('Mirar una Legend', f'Mirar la Legend boca abajo nº {goro + 1}', 'Llamar gratis')
    assert me.legs[goro].up and me.legs[goro].known and me.called, 'Goro tiene Go Solo: se llama gratis'
    me, log = radioport('Mirar una Legend', f'Mirar la Legend boca abajo nº {goro + 1}', 'No hacerlo')
    assert not me.legs[goro].up and me.legs[goro].known and not me.called, 'la mira pero decide no llamarla'
    me, log = radioport('Mirar una Legend', f'Mirar la Legend boca abajo nº {lucyna + 1}')
    assert me.legs[lucyna].known and not me.legs[lucyna].up and not me.called and len(_asked(log, 'mode')) == 2, 'Lucyna no es Arasaka ni Go Solo: no se ofrece llamarla'
    me, log = radioport('No hacerlo')
    assert not any(l.known for l in me.legs) and not me.called, '«puedes mirar»: se puede no hacerlo'


def t_choice_tetratronic_and_goro():
    """Tetratronic Rippler: la persona decide si tira la carta de arriba. Goro Takemura (Bodyguard): decide si descarta 1 para robar 1 al bloquear."""
    def rippler(script):
        g, me, op = board()
        u = unit(g, me, 'psycho_squad')
        u.gear = [CARD['tetratronic_rippler']]
        me.deck.append(CARD['psycho_squad'])
        before = len(me.deck)
        log = _human(g, 0, script)[1] if script else []
        g.fx.on_spent_gear(g, me, u)
        return me, before, log

    me, before, log = rippler(None)
    pilot_trashes = len(me.deck) < before
    assert not log
    me, before, log = rippler('No hacerlo' if pilot_trashes else 'Tirar')
    assert (len(me.deck) < before) != pilot_trashes and _asked(log, 'mode'), 'la persona hace lo contrario que el piloto'
    assert bool(me.trash and me.trash[-1]['id'] == 'psycho_squad') == (not pilot_trashes)

    def goro(*script):
        g, me, op = board(legs_a=LEGS_GORO)
        for l in me.legs:
            l.up = True
        me.hand = [CARD['floor_it'], CARD['psycho_squad']]
        blocker = unit(g, me, 'corpo_security')
        attacker = unit(g, op, 'emergency_atlus')
        log = _human(g, 0, *script)[1] if script else []
        g.fx.on_block(g, me, attacker, blocker)
        return me, log

    me, log = goro('Descartar 1', 'Floor It')
    assert _ids(me.trash) == ['floor_it'] and len(me.hand) == 2 and 'psycho_squad' in _ids(me.hand), 'descarta la que elige y roba 1'
    me, log = goro('No hacerlo')
    assert not me.trash and len(me.hand) == 2, 'puedes no descartar'


def t_choice_judy_and_kerry_units():
    """Judy Alvarez y Kerry Eurodyne (Unidades): acciones propias con su coste y su elección; ya no hay botón «Habilidades fijas»."""
    def judy(*script):
        g, me, op = board()
        j = unit(g, me, 'judy_alvarez_nothing_to_doubt')
        me.E = me.Eready = 1
        me.deck.append(CARD['psycho_squad'])
        h, log = _human(g, 0, *script)
        h.main(g, me, op)
        return me, j, log

    me, j, log = judy('Judy Alvarez', 'Jugar')
    assert [u.c['id'] for u in me.field if u is not j] == ['psycho_squad'] and me.Eready == 0 and not j.ready, 'cuesta 1 €, la gasta y juega la carta gratis'
    assert not any('fijas' in o for opts in _asked(log, 'action') for o in opts), 'ya no hay botón de habilidades fijas'
    me, j, log = judy('Judy Alvarez', 'Añadir')
    assert [c['id'] for c in me.hand] == ['psycho_squad'] and len(me.field) == 1, 'la persona prefiere llevársela a la mano'

    def kerry(value, *script):
        g, me, op = board()
        k = unit(g, me, 'kerry_eurodyne_the_last_rockerboy')
        gigs(me, (10, value))
        h, log = _human(g, 0, *script)
        h.main(g, me, op)
        return me, k, log

    me, k, log = kerry(9, 'Kerry')
    assert len(me.hand) == 2 and not k.ready, 'con un Gig de 8 o más: la gasta y roba 2'
    me, k, log = kerry(5)
    assert not me.hand and k.ready and not any('Kerry' in o for opts in _asked(log, 'action') for o in opts), 'sin un Gig de 8 o más no se ofrece'


TESTS = [t_choice_discards_by_effect, t_choice_shattered_memories, t_choice_detonate_and_bonnie, t_choice_heist, t_choice_calls_dum_dum_and_viktor,
         t_choice_panam_and_evelyn, t_choice_gunpoint_rival_chooses, t_choice_look_at_legends, t_choice_tetratronic_and_goro, t_choice_judy_and_kerry_units]


def run(verbose=False):
    for t in TESTS:
        t()
        if verbose:
            print('  ok', t.__name__)
    return len(TESTS)


if __name__ == '__main__':
    failed = 0
    for t in TESTS:
        try:
            t()
            print('  ok', t.__name__)
        except AssertionError as e:
            failed += 1
            print('  FALLA', t.__name__, '->', e)
    print(f'{len(TESTS) - failed} de {len(TESTS)} pruebas de elección superadas')
    sys.exit(1 if failed else 0)
