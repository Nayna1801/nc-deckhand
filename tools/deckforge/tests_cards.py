"""Pruebas carta a carta del motor v2: cada comprobación monta una situación mínima y verifica el texto de la carta.

Uso:  python tools/deckforge/tests_cards.py      (también las lanza `forge.py selftest`)
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from engine2 import CARD  # noqa: E402
from tests2 import board, gigs, unit  # noqa: E402

A_GEAR = ['river_ward_detective_on_the_hunt', 'dum_dum_maelstrom_triggerman', 'rogue_amendiares_preem_solo']
A_BLUE = ['alt_cunningham_soulkiller_architect', 'jackie_welles_pour_one_out_for_me', 'lucyna_kushinada_fresh_beginnings']
A_GREEN = ['hanako_arasaka_daughter_of_the_emperor', 'saburo_arasaka_stubborn_patriarch', 'goro_takemura_vengeful_bodyguard']
A_RED = ['adam_smasher_ender_of_legends', 'v_streetkid', 'royce_psycho_on_the_edge']


def prog(g, me, cid):
    return g.play_card(me, CARD[cid], pay=False)


def top(p, *ids):
    """Pone cartas concretas encima del mazo (la última es la primera que se roba)."""
    for i in ids:
        p.deck.append(CARD[i])


def leg(p, lid, up=True, ready=True):
    l = next(x for x in p.legs if x.c['id'] == lid)
    l.up, l.ready = up, ready
    return l


def names(cards):
    return sorted(c['id'] for c in cards)


# ----------------------------------------------------------------------------- Programas
def t_blue_programs():
    g, me, op = board()
    gigs(me, (6, 3))
    prog(g, me, 'trust_no_one')
    assert me.gigs == [[6, 1]] and len(me.hand) == 1, 'Trust No One: baja hasta 3 y roba si hay un Gig al mínimo'
    g, me, op = board()
    gigs(me, (4, 1))
    n = len(me.deck)
    prog(g, me, 'three_mouths_one_desire')
    assert len(me.hand) == 2 and len(me.deck) == n - 2, 'Three Mouths: 1 carta + 1 por cada Gig al mínimo; el resto al fondo'
    g, me, op = board()
    gigs(me, (4, 1))
    t = unit(g, op, 'psycho_squad')
    prog(g, me, 'chrome_reverie')
    assert t.noatk and not g.can_attack(t) and sum(l.up for l in me.legs) == 1, 'Chrome Reverie: inmoviliza y Call gratis con un mínimo'
    g, me, op = board()
    lo, hi = unit(g, op, 'emergency_atlus'), unit(g, op, 'animals_wrecker')
    prog(g, me, 'les_elemens')
    assert lo not in op.field and hi in op.field and not op.trash, 'Les Élémens: manda al fondo la de menor poder'
    g, me, op = board()
    mine, spent, ready = unit(g, me, 'emergency_atlus'), unit(g, op, 'animals_wrecker', ready=False), unit(g, op, 'psycho_squad')
    prog(g, me, 'unlikely_bond')
    assert mine not in me.field and spent not in op.field and ready in op.field, 'Unlikely Bond: una propia preparada por una rival gastada'
    g, me, op = board()
    gigs(me, (4, 3))
    gigs(op, (6, 5))
    z, w = unit(g, op, 'secondhand_bombus'), unit(g, op, 'emergency_atlus')
    prog(g, me, 'pyramid_song')
    assert z not in op.field and w in op.field, 'Pyramid Song sin d4 al mínimo: un efecto (fondo a una de poder 0)'
    g, me, op = board()
    gigs(me, (6, 5))
    gigs(op, (4, 2))
    a, b = unit(g, op, 'emergency_atlus'), unit(g, op, 'secondhand_bombus')
    prog(g, me, 'towerfall')
    assert b not in op.field and a in op.field and g.power(a) == 4, 'Towerfall con MÁS Street Cred: un solo efecto'
    g, me, op = board()
    me.fixer = []
    assert g.ccost(me, CARD['nocturne_op55_n1']) == 1, 'Nocturne cuesta 1 con el área de fixer vacía'
    prog(g, me, 'nocturne_op55_n1')
    assert len(me.hand) == 2, 'Nocturne: robar 2'


def t_green_programs():
    g, me, op = board()
    cheap, big = unit(g, op, 'emergency_atlus'), unit(g, op, 'animals_wrecker')
    prog(g, me, 'corporate_surveillance')
    assert not cheap.ready and big.ready, 'Corporate Surveillance: solo coste 4 o menos'
    g, me, op = board()
    gigs(me, (4, 2))
    t = unit(g, op, 'psycho_squad')
    prog(g, me, 'memory_relapse')
    assert not t.ready and t.noready and len(me.hand) == 1, 'Memory Relapse: gasta, no se prepara y roba con Street Cred par'
    g.turn += 1
    g.take_turn(op)
    assert t in op.field and not g.can_attack(t), 'la Unidad de Memory Relapse no se prepara en su turno'
    g, me, op = board()
    ready, spent = unit(g, op, 'animals_wrecker'), unit(g, op, 'emergency_atlus', ready=False)
    prog(g, me, 'wild_in_the_streets')
    assert spent not in op.field and ready in op.field, 'Wild in the Streets: solo Unidades gastadas'
    g, me, op = board()
    a, b = unit(g, op, 'animals_wrecker'), unit(g, op, 'emergency_atlus')
    prog(g, me, 'don_t_fear_the_reaper')
    assert a not in op.field and not b.ready, "Don't Fear the Reaper: gasta todas y derrota una"
    g, me, op = board()
    gigs(me, (4, 2), (6, 5))
    prog(g, me, 'peace_offering')
    assert me.gigs[0][1] == me.gigs[1][1] and len(me.hand) == 1, 'Peace Offering: iguala dos Gigs y roba con pareja'
    g, me, op = board()
    me.trash += [CARD['corpo_security'], CARD['emergency_atlus'], CARD['animals_wrecker']]
    prog(g, me, 'we_gotta_live_together')
    assert names(u.c for u in me.field) == ['corpo_security', 'emergency_atlus'], 'We Gotta Live Together: 2 Unidades de coste <= 3'
    gigs(op, (4, 1), (6, 1))
    assert g.ccost(me, CARD['we_gotta_live_together']) == 3, 'cuesta 3 si el rival lleva 2 Gigs más'
    g, me, op = board()
    top(me, 'floor_it', 'floor_it')
    prog(g, me, 'fool_on_the_hill')
    assert len(me.hand) == 2, 'Fool on the Hill: dos cartas (las reveladas o dos nuevas)'


def t_red_programs():
    g, me, op = board()
    a, b, c = unit(g, op, 'emergency_atlus'), unit(g, op, 'corpo_security'), unit(g, op, 'psycho_squad')
    prog(g, me, 'bonnie_and_clyde')
    assert len(op.field) == 2 and c in op.field, 'Bonnie and Clyde: una de poder 4 o menos'
    g, me, op = board()
    gigs(op, (4, 1), (6, 1))
    a, b = unit(g, op, 'emergency_atlus'), unit(g, op, 'corpo_security')
    prog(g, me, 'bonnie_and_clyde')
    assert not op.field, 'Bonnie and Clyde: dos si el rival lleva 2 Gigs más'
    g, me, op = board()
    t = unit(g, op, 'psycho_squad')
    gigs(me, (20, 5))
    prog(g, me, 'over_the_edge')
    assert t in op.field, 'Over the Edge: no llega si el d20 vale menos que el poder'
    gigs(me, (20, 6))
    prog(g, me, 'over_the_edge')
    assert t not in op.field, 'Over the Edge: derrota si poder <= valor del d20'
    g, me, op = board()
    gigs(me, (8, 8), (10, 9))
    assert g.ccost(me, CARD['carnage_at_the_colosseum']) == 4 and g.ccost(me, CARD['octant']) == 5, 'descuento por Gigs de 8+'
    unit(g, me, 'psycho_squad')
    small, big = unit(g, op, 'emergency_atlus'), unit(g, op, 'animals_wrecker')
    prog(g, me, 'carnage_at_the_colosseum')
    assert small not in op.field and big in op.field, 'Carnage: solo con menos poder que una Unidad propia'
    g, me, op = board()
    gigs(me, (8, 4))
    prog(g, me, 'industrial_assembly')
    assert me.gigs == [[8, 8]] and len(me.hand) == 1, 'Industrial Assembly: sube hasta 4 y roba con un Gig de 8+'
    g, me, op = board()
    top(me, 'floor_it', 'animals_wrecker', 'floor_it')
    prog(g, me, 'all_is_lost')
    assert names(me.hand) == ['animals_wrecker'] and len(me.trash) == 3, 'All is Lost: tira 3 y recupera una Unidad'
    g, me, op = board()
    t = unit(g, op, 'psycho_squad')
    t.gear += [CARD['adrenaline_converter'], CARD['mantis_blades']]
    prog(g, me, 'detonate')
    assert names(t.gear) == ['adrenaline_converter'], 'Detonate: solo Gear de poder 2 o menos'
    g, me, op = board()
    gigs(op, (4, 2))
    a = unit(g, me, 'animals_wrecker')
    weak = unit(g, op, 'emergency_atlus', ready=False)
    prog(g, me, 'appetite_for_destruction')
    g.attack(a, weak)
    assert weak not in op.field and len(me.gigs) == 1, 'Appetite for Destruction: ganar por 3+ también roba un Gig'
    g, me, op = board()
    me.hand += [CARD['floor_it']] * 2
    op.hand += [CARD['floor_it']] * 4
    prog(g, me, 'shattered_memories')
    assert len(me.hand) == 5 and len(op.hand) == 5 and len(op.trash) == 4, 'Shattered Memories: descartar la mano y robar 5'


def t_yellow_programs():
    g, me, op = board()
    a, b = unit(g, me, 'corpo_security'), unit(g, me, 'animals_wrecker')
    c, d = unit(g, op, 'emergency_atlus'), unit(g, op, 'animals_wrecker')
    prog(g, me, 'live_with_the_aftermath')
    assert a not in me.field and b in me.field and c not in op.field and d in op.field, 'Live with the Aftermath: cada uno pierde una'
    g, me, op = board()
    gigs(me, (4, 2), (6, 3))
    n = len(me.deck)
    prog(g, me, 'bootleg_black_sapphire_show')
    assert me.E == 1 and len(me.hand) == 2 and len(me.deck) == n - 3, 'Bootleg: vende la carta superior y roba 2 con par e impar'
    g, me, op = board()
    gigs(me, (4, 2), (6, 5))
    prog(g, me, 'afterparty_at_lizzie_s')
    assert len(me.hand) == 1, 'Afterparty: roba con 2 Gigs de valores distintos'
    g, me, op = board()
    unit(g, me, 'psycho_squad')
    top(me, 'floor_it', 'mantis_blades', 'floor_it', 'floor_it')
    prog(g, me, 'the_heist')
    assert names(me.hand) == ['mantis_blades'] and len(me.trash) == 4, 'The Heist: tira 4 y recupera un Gear'


def t_quick_reactions():
    g, me, op = board()
    gigs(op, (4, 2), (6, 6), (8, 3), (10, 4))
    op.hand.append(CARD['floor_it'])
    op.E = op.Eready = 1
    a = unit(g, me, 'animals_wrecker')
    g.attack(a, None)
    assert len(me.gigs) == 1 and len(op.hand) == 1, 'Floor It: de 10 a 9 de poder roba 1 Gig en vez de 2 (y roba carta)'
    g, me, op = board()
    gigs(op, (4, 2), (6, 6), (8, 3), (10, 4))
    op.hand.append(CARD['safety_override'])
    op.E = op.Eready = 2
    a = unit(g, me, 'animals_wrecker')
    b = unit(g, op, 'secondhand_bombus')
    g.attack(a, None)
    assert a not in me.field and b not in op.field and not me.gigs, 'Safety Override: el Blocker que pierde se lleva a la atacante'
    g, me, op = board()
    gigs(op, (4, 2), (6, 6), (8, 3), (10, 4))
    op.hand.append(CARD['reboot_optics'])
    op.E = op.Eready = 2
    a = unit(g, me, 'psycho_squad')
    b = unit(g, op, 'mox_inciters')
    g.attack(a, None)
    assert b in op.field and a in me.field and not me.gigs, 'Reboot Optics: el Blocker no es derrotado'
    g, me, op = board(legs_b=A_GEAR)
    gigs(op, (4, 2), (6, 6), (8, 3), (10, 4))
    leg(op, 'river_ward_detective_on_the_hunt')
    op.hand.append(CARD['mantis_blades'])
    a = unit(g, me, 'psycho_squad')
    b = unit(g, op, 'meredith_stout_stone_cold_corpo')
    g.attack(a, None)
    assert a not in me.field and b in op.field and names(b.gear) == ['mantis_blades'], 'River Ward: Gear gratis en el ataque rival y el Blocker gana'


# ----------------------------------------------------------------------------- Unidades
def t_units_on_play():
    g, me, op = board()
    gigs(me, (4, 1))
    gigs(op, (6, 6))
    two, three = unit(g, op, 'corpo_security'), unit(g, op, 'la_llorona_ghost_of_the_past')
    prog(g, me, 'royce_don_t_call_me_simon')
    assert two not in op.field and three in op.field, 'Royce (Unidad): poder 2 o menos sin más Street Cred'
    g, me, op = board()
    gigs(me, (6, 6))
    gigs(op, (4, 1))
    three = unit(g, op, 'la_llorona_ghost_of_the_past')
    prog(g, me, 'royce_don_t_call_me_simon')
    assert three not in op.field, 'Royce (Unidad): poder 3 con más Street Cred'
    g, me, op = board()
    gigs(me, (4, 1))
    gigs(op, (6, 6))
    t = unit(g, op, 'emergency_atlus')
    prog(g, me, 'minotaur')
    assert t in op.field, 'Minotaur: nada sin más Street Cred'
    g, me, op = board()
    me.trash.append(CARD['6th_street_recruits'])
    spent = unit(g, op, 'emergency_atlus', ready=False)
    prog(g, me, 'yorinobu_arasaka_steel_dragon')
    free = next(u for u in me.field if u.c['id'] == '6th_street_recruits')
    assert spent in g.targets(free) and None not in g.targets(free), 'Yorinobu: Unidad gratis de la basura que puede atacar Unidades'
    g, me, op = board()
    prog(g, me, 'delamain_rideshare_ai')
    assert len(me.hand) == 2, 'Delamain: Rideshare AI roba 2'
    g, me, op = board()
    me.trash.append(CARD['trust_no_one'])
    gigs(me, (6, 3))
    n = len(me.deck)
    prog(g, me, 'lizzy_wizzy_delicate_weapon')
    assert me.deck[0]['id'] == 'trust_no_one' and not me.trash, 'Lizzy Wizzy: Programa gratis de la basura, luego al fondo del mazo'
    g, me, op = board()
    me.hand += [CARD['floor_it']] * 2
    eq, free = unit(g, op, 'animals_wrecker'), unit(g, op, 'psycho_squad')
    eq.gear.append(CARD['mantis_blades'])
    prog(g, me, 'maman_brigitte_spirit_of_death')
    assert free not in op.field and eq in op.field and not me.hand, 'Maman Brigitte: descarta 2 Programas y manda al fondo una SIN equipo'
    g, me, op = board()
    me.hand.append(CARD['floor_it'])
    t = unit(g, op, 'animals_wrecker')
    t.gear.append(CARD['mantis_blades'])
    prog(g, me, 'placide_voodoo_sentinel')
    assert t not in op.field and not me.hand, 'Placide: descarta 1 Programa y manda al fondo cualquier Unidad'
    g, me, op = board()
    gigs(op, (4, 2))
    other = unit(g, me, 'psycho_squad', lag=True)
    prog(g, me, 'valentino_street_racer')
    assert g.can_attack(other), 'Valentino Street Racer: da Adrenaline a otra Unidad de coste 5 o menos'
    g, me, op = board()
    gigs(me, (4, 2), (6, 2))
    a, b = unit(g, op, 'psycho_squad'), unit(g, op, 'emergency_atlus')
    s = prog(g, me, 'sandayu_oda_hanako_s_guardian')
    assert [a.ready, b.ready].count(False) == 1 and g.can_attack(s) == 'unit', 'Sandayu Oda: gasta una por pareja y puede atacar Unidades'
    g, me, op = board()
    gigs(op, (4, 2))
    a = unit(g, me, 'psycho_squad')
    prog(g, me, 'japantown_jonin')
    assert g.power(a) == 8, 'Japantown Jonin: +2 de poder este turno'
    g, me, op = board()
    t = unit(g, op, 'psycho_squad')
    m = prog(g, me, 'offduty_malfini')
    assert not m.ready and not t.ready, 'Off-duty Malfini: se gasta ella y una rival'
    g, me, op = board()
    t = unit(g, op, 'psycho_squad')
    t.gear.append(CARD['gorilla_arms'])
    prog(g, me, 'heywood_ripperdoc')
    assert not t.gear, 'Heywood Ripperdoc: derrota un Gear'
    g, me, op = board()
    mine, theirs = unit(g, me, 'psycho_squad'), unit(g, op, 'animals_wrecker')
    s = prog(g, me, 'adam_smasher_metal_over_meat')
    assert me.field == [s] and not op.field, 'Adam Smasher: Metal Over Meat derrota a todas las demás'
    g, me, op = board()
    two, three = unit(g, op, 'corpo_security'), unit(g, op, 'emergency_atlus')
    prog(g, me, 'caliber_totentanz_s_top_dog')
    assert two not in op.field and three in op.field, 'Caliber: coste 2 o menos'
    g, me, op = board()
    prog(g, me, 'tyger_s_whisper')
    assert sum(l.up for l in me.legs) == 1, "Tyger's Whisper: Call gratis"
    g, me, op = board()
    unit(g, op, 'psycho_squad')
    unit(g, op, 'psycho_squad')
    me.trash += [CARD['psycho_squad']] * 3
    assert g.ccost(me, CARD['maxtac_heavy']) == 5 and g.ccost(me, CARD['trauma_team_operatives']) == 3, 'descuentos de MaxTac Heavy y Trauma Team'
    g, me, op = board()
    gigs(me, (4, 2))
    prog(g, me, 'field_operator')
    assert len(me.hand) == 1, 'Field Operator: roba con Street Cred par'


def t_units_attack_and_static():
    g, me, op = board()
    gigs(op, (4, 2), (6, 3))
    for l in me.legs:
        l.up = True
    a = unit(g, me, 'goro_takemura_losing_his_way')
    g.attack(a, None)
    assert len(me.gigs) == 1 and a.tmp == 5, 'Goro: Losing His Way +5 con las 3 Legends boca arriba'
    g, me, op = board()
    gigs(me, (4, 2), (6, 4))
    gigs(op, (8, 1), (10, 3), (12, 5))
    a = unit(g, me, 'jackie_welles_ride_or_die_choom')
    g.attack(a, None)
    assert len(me.gigs) == 4, 'Jackie: Ride or Die +2 por cada Gig par (8+4=12 roba 2)'
    g, me, op = board()
    gigs(op, (4, 2))
    a = unit(g, me, 'swordwise_huscle')
    a.gear.append(CARD['mantis_blades'])
    g.attack(a, None)
    assert len(me.hand) == 1, 'Swordwise Huscle roba con poder 5+'
    g, me, op = board(legs_a=['v_corporate_exile', 'lucyna_kushinada_fresh_beginnings', 'hanako_arasaka_daughter_of_the_emperor'])
    gigs(me, (4, 2), (6, 2))
    gigs(op, (8, 5))
    a = unit(g, me, 'pepe_najarro_working_doubles')
    g.attack(a, None)
    assert sum(l.ready for l in me.legs) == 2, 'Pepe Najarro: con pareja prepara hasta 2 Legends MERC'
    g, me, op = board()
    gigs(op, (6, 2))
    gigs(me, (12, 3))
    unit(g, me, '6th_street_recruits', ready=False)
    a = unit(g, me, 'psycho_squad')
    me.w['g8'] = 2.0          # este mazo quiere Gigs de 8+
    me.anyw = True
    g.attack(a, None)
    assert any(d == 12 and v >= 8 for d, v in me.gigs), '6th Street Recruits: al robar un d6, subir un Gig hasta 6 (3 -> 8+)'
    g, me, op = board()
    gigs(me, (4, 2))
    gigs(op, (6, 2), (8, 3), (10, 5))
    a = unit(g, me, 'psycho_squad')
    a.gear.append(CARD['gorilla_arms'])
    g.attack(a, None)
    assert len(me.gigs) == 3 and op.gigs == [[6, 2]], 'Gorilla Arms: roba además un Gig de valor que no tienes (y no el repetido)'
    g, me, op = board()
    a = unit(g, me, 'johnny_silverhand_never_stop_fighting')
    a.gear.append(CARD['satori_sword_of_saburo'])
    d = unit(g, op, 'psycho_squad', ready=False)
    g.attack(a, d)
    assert a.ready and len(me.hand) == 1, 'Johnny se prepara tras ganar su primera pelea; Satori roba al ganar'
    g, me, op = board()
    a = unit(g, me, 'johnny_silverhand_never_stop_fighting')
    d = unit(g, op, 'yorinobu_arasaka_steel_dragon', ready=False)
    g.attack(a, d)
    assert a in me.field and d not in op.field, 'Johnny gana todas las peleas contra CORPO'
    g, me, op = board()
    a = unit(g, me, 'psycho_squad')
    d = unit(g, op, 'maelstrom_zealots', ready=False)
    g.attack(a, d)
    assert not me.field and not op.field, 'Maelstrom Zealots: al perder la pelea derrota a la rival'
    g, me, op = board()
    gigs(me, (4, 1))
    gigs(op, (6, 5), (8, 3))
    a = unit(g, me, 'mt0d12_flathead')
    b = unit(g, op, 'placide_voodoo_sentinel')
    b.gear.append(CARD['mandibular_upgrade'])
    g.attack(a, None)
    assert len(me.gigs) == 2 and b.ready, 'MT0D12 Flathead no se puede bloquear con menos Street Cred'
    g, me, op = board()
    gigs(op, (4, 2), (20, 15))
    a = unit(g, me, 'psycho_squad')
    op.fang = g.turn
    g.attack(a, None)
    assert op.gigs == [[20, 15]], 'Chrome Fang: no se roban Gigs de valor mayor que el poder'
    g, me, op = board()
    gigs(op, (4, 2))
    unit(g, op, 'maxtac_suppression_team')
    n = unit(g, me, 'riding_nomad', lag=True)
    assert not g.can_attack(n), 'MaxTac Suppression Team anula Adrenaline'
    g, me, op = board()
    v = leg(me, 'v_corporate_exile')
    me.E = me.Eready = 5
    u = g.go_solo(me, v)
    m = unit(g, op, 'meredith_stout_stone_cold_corpo', ready=False)
    assert g.power(m, vs=u) == 7, 'Meredith Stout +2 peleando contra una Legend'
    g, me, op = board(legs_a=A_GREEN)
    leg(me, 'saburo_arasaka_stubborn_patriarch')
    y = unit(g, me, 'yorinobu_arasaka_steel_dragon')
    assert g.power(y, atk=True) == 10 and g.power(y) == 9, 'Saburo: +1 a las ARASAKA al atacar'
    g, me, op = board()
    a = unit(g, me, 'psycho_squad')
    unit(g, me, 'saul_bright_stormrider')
    assert g.power(a, atk=True) == 8, 'Saul Bright: +2 a las demás al atacar'


def t_gear_and_end_of_turn():
    g, me, op = board()
    a = unit(g, me, 'psycho_squad')
    a.gear.append(CARD['deadman_transmitter'])
    g.defeat(a, 'wild_in_the_streets', by=op)
    assert a in me.field and not a.gear, 'Deadman Transmitter: se derrota el Gear en lugar de la Unidad'
    g, me, op = board()
    me.trash.append(CARD['animals_wrecker'])
    a = unit(g, me, 'psycho_squad')
    a.gear.append(CARD['the_relic_experimental_biochip'])
    g.defeat(a, 'wild_in_the_streets', by=op)
    assert names(u.c for u in me.field) == ['animals_wrecker'] and me.deck[0]['id'] == 'psycho_squad', 'The Relic: otra Unidad de la basura gratis y esta al fondo'
    g, me, op = board()
    gigs(me, (4, 2), (6, 4), (8, 6))
    a = unit(g, me, 'psycho_squad')
    a.gear += [CARD['netwatch_netdriver'], CARD['zetatech_faceplate']]
    g.spend_unit(a)
    assert len(me.hand) == 2, 'Netdriver roba al gastarse; Faceplate roba con 3 Gigs de valores distintos'
    g, me, op = board()
    gigs(op, (4, 1), (6, 2), (8, 3))
    gigs(me, (10, 9))
    a = unit(g, me, 'psycho_squad', lag=True)
    a.gear.append(CARD['adrenaline_converter'])
    assert g.can_attack(a), 'Adrenaline Converter: Adrenaline si el rival lleva 2 Gigs más'
    op.gigs.pop()
    assert not g.can_attack(a), 'Adrenaline Converter: sin esa diferencia no'
    g, me, op = board()
    a = unit(g, me, 'psycho_squad', ready=False)
    a.gear.append(CARD['sandevistan'])
    k = unit(g, me, 'modded_kusanagi', ready=False)
    g.fx.end_turn(g, me, op)
    assert a.ready and k not in me.field and names(me.hand) == ['modded_kusanagi'], 'Sandevistan prepara; Modded Kusanagi vuelve a la mano'
    g, me, op = board()
    us = [unit(g, me, 'psycho_squad', ready=False) for _ in range(4)]
    unit(g, me, 'saul_bright_stormrider', ready=False)
    g.fx.end_turn(g, me, op)
    assert sum(u.ready for u in me.field) == 3, 'Saul Bright prepara hasta 3 al final del turno'


# ----------------------------------------------------------------------------- Legends
def t_legends():
    g, me, op = board(legs_a=A_GREEN)
    leg(me, 'hanako_arasaka_daughter_of_the_emperor')
    gigs(me, (4, 2), (6, 2), (8, 5), (10, 5))
    g.fx.start_turn(g, me, op)
    assert len(me.hand) == 2, 'Hanako: roba 1 por cada pareja al empezar el turno'
    g, me, op = board(legs_a=A_BLUE)
    leg(me, 'jackie_welles_pour_one_out_for_me')
    gigs(me, (6, 3))
    prog(g, me, 'psycho_squad')
    assert me.gigs == [[6, 1]] and len(me.hand) == 1, 'Jackie (Pour One Out): la 1.ª Unidad azul baja un Gig 2 y roba si queda al mínimo'
    prog(g, me, 'psycho_squad')
    assert len(me.hand) == 1, 'Jackie (Pour One Out): solo la primera vez cada turno'
    g, me, op = board(legs_a=A_BLUE)
    gigs(me, (4, 1), (6, 1))
    me.alt_disc = 2
    assert g.ccost(me, CARD['towerfall']) == 4 and g.ccost(me, CARD['trust_no_one']) == 1, 'Alt: -1 por Gig al mínimo, mínimo 1'
    l = leg(me, 'lucyna_kushinada_fresh_beginnings', up=False)
    g.call(me, free=True, pick=l)
    assert len(me.hand) == 2, 'Lucyna: roba 2 con dos Gigs al mínimo'
    g, me, op = board(legs_a=A_RED)
    s = leg(me, 'adam_smasher_ender_of_legends')
    for l in me.legs:
        l.ready = True
    me.E = me.Eready = 7
    t = unit(g, op, 'animals_wrecker')
    u = g.go_solo(me, s)
    assert u is not None and t not in op.field and g.power(u) == 9, 'Adam Smasher (Go Solo 9): derrota una Unidad rival al entrar'
    g, me, op = board(legs_a=A_RED)
    r = leg(me, 'royce_psycho_on_the_edge')
    r.gear += [CARD['mantis_blades'], CARD['mantis_blades']]
    for l in me.legs:
        l.ready = True
    me.E = me.Eready = 4
    u = g.go_solo(me, r)
    assert g.power(u) == 14, 'Royce: 6 + Gear (2+2) + 2 por cada Gear en su turno'
    g.cur = op
    assert g.power(u) == 10, 'Royce: el +2 por Gear solo cuenta en su turno'
    g, me, op = board(legs_a=A_RED)
    v = leg(me, 'v_streetkid', up=False)
    me.trash.append(CARD['trust_no_one'])
    g.call(me, free=True, pick=v)
    assert names(me.hand) == ['trust_no_one'] and len(me.trash) == 3, 'V: Streetkid: tira 3 y recupera un Braindance'
    g, me, op = board(legs_a=A_GEAR)
    gigs(op, (4, 2), (6, 3))
    dd = leg(me, 'dum_dum_maelstrom_triggerman')
    me.E = me.Eready = 1
    a = unit(g, me, 'rockn_rockerboy')
    a.gear.append(CARD['kiroshi_optics'])
    g.attack(a, None)
    assert len(me.gigs) == 2 and not dd.ready and me.Eready == 0, 'Dum Dum: 1 € y gastarlo, +1 por Gear (8+1 = 9 -> 10 roba 2)'
    g, me, op = board(legs_a=A_GEAR)
    gigs(op, (4, 2), (6, 3))
    rg = leg(me, 'rogue_amendiares_preem_solo')
    for l in me.legs:
        l.ready = True
    me.E = me.Eready = 6
    op.hand.append(CARD['psycho_squad'])
    u = g.go_solo(me, rg)
    g.attack(u, None)
    assert len(me.gigs) == 1 and (len(me.hand) == 1 or not op.hand), 'Rogue: par roba 1, impar descarta 1 al rival'


TESTS = [t_blue_programs, t_green_programs, t_red_programs, t_yellow_programs, t_quick_reactions, t_units_on_play,
         t_units_attack_and_static, t_gear_and_end_of_turn, t_legends]


def run(verbose=False):
    for t in TESTS:
        t()
        if verbose:
            print('  ok', t.__name__)
    return len(TESTS)


if __name__ == '__main__':
    print(f'{run(verbose=True)} grupos de pruebas de cartas superados')
