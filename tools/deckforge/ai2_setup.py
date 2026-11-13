"""Base de las decisiones del jugador (motor v2): qué configuración de dados quiere cada carta, perfil del mazo, mulligan,
orden de pagos, objetivo de Gear y valoración de la posición."""
import os
from collections import defaultdict

from fx2 import ALT, HANAKO, JACKIE, JUDY, ON_SPENT_GEAR, RIVER, uval


# Qué configuración de dados quiere cada carta (peso por copia; las Legends cuentan una vez).
GW = {
    HANAKO: {'pair': 12}, 'peace_offering': {'pair': 1}, 'sandayu_oda_hanako_s_guardian': {'pair': 2},
    'pepe_najarro_working_doubles': {'pair': 2}, 'goro_takemura_vengeful_bodyguard': {'pair': 2},
    JACKIE: {'min': 4}, ALT: {'min': 6}, 'lucyna_kushinada_fresh_beginnings': {'min': 4}, 'three_mouths_one_desire': {'min': 2},
    'trust_no_one': {'min': 1}, 'chrome_reverie': {'min': 2}, 'pyramid_song': {'d4min': 3},
    'towerfall': {'low': 4}, 'mt0d12_flathead': {'low': 2}, 'modded_muramasa': {'low': 2}, 'evelyn_parker_scheming_siren': {'low': 0.5},
    'minotaur': {'high': 2}, 'royce_don_t_call_me_simon': {'high': 1}, 'valentino_guerrera': {'high': 1}, 'gunpoint_diplomacy': {'high': 1},
    'industrial_assembly': {'g8': 1}, 'carnage_at_the_colosseum': {'g8': 3}, 'octant': {'g8': 3},
    'kerry_eurodyne_the_last_rockerboy': {'g8': 2}, 'v_roamer_of_the_badlands': {'g8': 1}, 'johnny_silverhand_rocking_renegade': {'g8': 4},
    'zetatech_faceplate': {'dist': 2}, 'afterparty_at_lizzie_s': {'dist': 0.5}, 'jackie_welles_ride_or_die_choom': {'even': 3},
    'field_operator': {'evencred': 1}, 'pacifica_netrunner': {'evencred': 1}, 'memory_relapse': {'evencred': 1},
    'bootleg_black_sapphire_show': {'mix': 2}, 'over_the_edge': {'d20': 3}, 'el_sombreron_la_venganza_lenta': {'max': 2},
}
GFEATS = ('pair', 'min', 'd4min', 'low', 'high', 'g8', 'dist', 'even', 'evencred', 'mix', 'd20', 'max')

KEEP = {
    'towerfall': 7, 'les_elemens': 6.5, 'pyramid_song': 5.5, 'bonnie_and_clyde': 6, 'wild_in_the_streets': 6.5, 'don_t_fear_the_reaper': 7.5,
    'carnage_at_the_colosseum': 6, 'take_control': 5.5, 'overwatch_panam_s_gift': 6.5, 'memory_relapse': 5, 'corporate_surveillance': 4.5,
    'chrome_reverie': 4.5, 'three_mouths_one_desire': 4.5, 'trust_no_one': 3.5, 'peace_offering': 3.5, 'floor_it': 3, 'fool_on_the_hill': 4.2,
    'nocturne_op55_n1': 4.5, 'industrial_assembly': 3, 'all_is_lost': 2.8, 'detonate': 2.5, 'afterparty_at_lizzie_s': 3, 'the_heist': 2.6,
    'safety_override': 3.5, 'reboot_optics': 3, 'synapse_burnout': 2.5, 'cyberpsychosis': 2.5, 'live_with_the_aftermath': 4,
    'bootleg_black_sapphire_show': 4, 'over_the_edge': 4, 'appetite_for_destruction': 2.5, 'gunpoint_diplomacy': 3, 'shattered_memories': 2.5,
    'unlikely_bond': 4.5, 'we_gotta_live_together': 3.5, 'gorilla_arms': 5.5, 'adrenaline_converter': 4.5, 'zetatech_faceplate': 4.5,
    'mantis_blades': 4, 'satori_sword_of_saburo': 4, 'mandibular_upgrade': 3.5, 'riot_shield': 4, 'sandevistan': 4.5, 'netwatch_netdriver': 4,
    'deadman_transmitter': 3.5, 'the_relic_experimental_biochip': 3.5, 'zetatech_berserk': 3, 'kiroshi_optics': 1.5, 'tetratronic_rippler': 2,
    'dying_night_v_s_pistol': 3.5, 'arasaka_emergency_radioport': 3,
    'yorinobu_arasaka_steel_dragon': 8, 'placide_voodoo_sentinel': 8, 'judy_alvarez_nothing_to_doubt': 7.5, 'saul_bright_stormrider': 8,
    'johnny_silverhand_never_stop_fighting': 7.5, 'maman_brigitte_spirit_of_death': 6, 'lizzy_wizzy_delicate_weapon': 6,
}
DICE_TOOLS = {'peace_offering': ('pair',), 'trust_no_one': ('min', 'low', 'd4min'), 'afterparty_at_lizzie_s': ('dist', 'pair'),
              'industrial_assembly': ('g8',), 'dying_night_v_s_pistol': ('min', 'low'), 'zetatech_faceplate': ('dist', 'pair')}
# Gestión «cuidadosa» de los dados (contar con que el rival roba el dado clave, defenderlo, elegir el dado del fixer por su
# resultado medio, valorar Peace Offering/Trust No One por lo que mejoran). Medido en 2.800 partidas por variante con BBG y
# con Wakako+Alt+Hanako: consigue más mínimos (55 % -> 62 % de los turnos) pero NO más victorias (49-50 % frente a 50-51 %),
# y no vender las cartas de dados cuesta 5 puntos. Por eso queda apagada; DECKFORGE_DICE=1 la enciende para experimentar.
DICE_CARE = os.environ.get('DECKFORGE_DICE', '0') == '1'
DICE_PARTS = set(filter(None, os.environ.get('DECKFORGE_DICEPARTS', 'die,change,swap,steal').split(',')))
DICE_NET = os.environ.get('DECKFORGE_DICENET', '0') == '1'   # apagado: medido, decidir los dados con la red no mejora (47-50 %)   # decisiones de dados valoradas por la red (con vf = action)
GS_MODE = os.environ.get('DECKFORGE_GS', 'base')   # base | cost | late | alone (se pueden juntar: cost+alone)
HANAKO_THR = 0.6 if DICE_CARE else 1.0
TUNE_THR = 0.5 if DICE_CARE else 0.8
DICE_KEEP = False     # no vender las cartas de dados: descartado (−5 puntos)
TUNERS = {'dexter_deshawn_off_the_grid', 'muamar_reyes_el_capitan', 'wakako_okada_peace_and_harmony', 'padre_man_of_the_cross'}
ABILITY_LEGS = TUNERS | {HANAKO, ALT, JUDY, RIVER, 'goro_takemura_vengeful_bodyguard', 'dum_dum_maelstrom_triggerman',
                         'johnny_silverhand_rocking_renegade'}
CANTRIPS = {'trust_no_one', 'three_mouths_one_desire', 'fool_on_the_hill', 'peace_offering', 'industrial_assembly', 'all_is_lost',
            'afterparty_at_lizzie_s', 'the_heist', 'nocturne_op55_n1', 'bootleg_black_sapphire_show'}
KILL_SPENT = {'wild_in_the_streets', 'don_t_fear_the_reaper', 'overwatch_panam_s_gift', 'unlikely_bond', 'appetite_for_destruction'}


# ----------------------------------------------------------------------------- perfil del mazo
READ_DECK = os.environ.get('DECKFORGE_READ', '0') == '1'   # leer el mazo del texto de sus cartas en vez de la tabla GW (vf «...+read» lo hace por jugador)
READ_MAP = {'MIN': 'min', 'PAIR': 'pair', 'LOWCRED': 'low', 'HIGHCRED': 'high', 'G8': 'g8', 'PARITY': 'even', 'D20': 'd20'}
_READER = None


def read_deck_weights(ids, legids):
    """Objetivos de dados que PIDE el mazo, leídos del texto de sus cartas (cardgraph: «necesita Gig al mínimo», «pareja»,
    «menos Street Cred»...) en la misma escala 0-3 que la tabla GW. Sirve para cualquier carta, también las nuevas."""
    global _READER
    if _READER is None:
        import cardgraph
        _READER = cardgraph.Graph()
    main = [i for i, n in ids.items() for _ in range(n)]
    dem = _READER.deck_flows(list(legids), main)[2]
    return {f: min(3.0, dem[c] / 6.0) for c, f in READ_MAP.items()}


def profile(g, p):
    ids = p.ids
    w = defaultdict(float)
    for cid, n in list(ids.items()) + [(l, 1) for l in p.legids]:
        for f, x in GW.get(cid, {}).items():
            w[f] += x * n
    for f in GFEATS:
        w[f] = min(3.0, w[f] / 6.0)
    if READ_DECK or '+read' in g.vf[p.pi]:
        w.update(read_deck_weights(ids, p.legids))
    from engine2 import CARD
    cards = [CARD[i] for i, n in ids.items() for _ in range(n)]
    w['bd'] = sum(1 for c in cards if c['bd'])
    w['gearn'] = sum(1 for c in cards if c['t'] == 'G')
    p.w = w
    p.lowdice = (w['min'] + w['d4min'] + w['low'] + 0.5 * w['pair']) > (w['high'] + w['g8'] + w['d20'] + w['max'])
    p.anyw = any(w[f] for f in GFEATS)
    p.kill_spent = any(i in KILL_SPENT for i in ids)
    p.maxcost = max([c['cost'] for c in cards] + [CARD[l]['cost'] for l in p.legids])
    blue = sum(1 for c in cards if c['color'] == 'Blue' and c['t'] in 'UG')
    progs = sum(1 for c in cards if c['t'] == 'P')
    cheapg = sum(1 for c in cards if c['t'] == 'G' and c['cost'] <= 2)
    ara = sum(1 for c in cards if c['t'] == 'U' and 'Arasaka' in c['tags'])
    up_syn = 0.5 * ids.get('goro_takemura_losing_his_way', 0) + 0.2 * ids.get('zetatech_berserk', 0) + 0.2 * ids.get('synapse_burnout', 0)
    p.callv = {
        HANAKO: 5.5, JACKIE: min(5.0, 2.0 + 0.2 * blue), ALT: min(5.0, 2.0 + 0.1 * progs), JUDY: min(4.5, 1.5 + 0.15 * w['bd']),
        RIVER: min(6.0, 1.5 + 0.35 * cheapg), 'saburo_arasaka_stubborn_patriarch': min(4.0, 1.0 + 0.3 * ara),
        'yorinobu_arasaka_embracing_destruction': min(4.0, 1.0 + 0.3 * ara), 'johnny_silverhand_rocking_renegade': 2.0,
        'kerry_eurodyne_axe_attitude_audience': 2.5, 'evelyn_parker_beautiful_enigma': 1.5, 'goro_takemura_vengeful_bodyguard': 2.5,
        'panam_palmer_nomad_cavalry': 1.0, 'lucyna_kushinada_fresh_beginnings': 3.0, 'wakako_okada_peace_and_harmony': 3.2,
        'padre_man_of_the_cross': 3.6, 'dexter_deshawn_off_the_grid': 3.6, 'muamar_reyes_el_capitan': 3.2,
        'viktor_vektor_sit_down_and_relax': min(5.0, 1.5 + 0.3 * cheapg), 'dum_dum_maelstrom_triggerman': 3.4,
    }
    for k in p.callv:
        p.callv[k] += up_syn
    p.reserve = 0
    p.phase = 'pre'
    p.mode = 'default'
    p.forced_mode = None


def mulligan(g, p):
    h = p.hand
    sell = sum(1 for c in h if c['sell'])
    cheap_u = sum(1 for c in h if c['t'] == 'U' and c['cost'] <= 4)
    cheap = sum(1 for c in h if c['cost'] <= 3)
    units = sum(1 for c in h if c['t'] == 'U')
    wrong = sell == 0 or (cheap_u == 0 and cheap < 2) or units >= 5
    return (not wrong) if g.slip(p) else wrong          # fallo humano: decide al revés


def keep(g, p, c):
    v = KEEP.get(c['id'])
    if v is None:
        if c['t'] == 'U':
            v = c['pw'] * 0.5 + 2.5 + (1.0 if c['blocker'] else 0.0)
        elif c['t'] == 'G':
            v = 2.0 + c['pw'] * 0.8
        else:
            v = 3.0
    if c['cost'] > p.E + 4:
        v -= 1.5
    f = DICE_TOOLS.get(c['id']) if DICE_KEEP else None
    if f is not None:
        v += 0.8 * max(p.w[x] for x in f)
    return v


# ----------------------------------------------------------------------------- pagos y Gear
def leg_pay_order(g, p, l):
    if any(x['id'] in ON_SPENT_GEAR for x in l.gear):
        return -1
    if not l.up:
        return 0
    return 2 if l.c['id'] in ABILITY_LEGS else 1


def pay_keep(g, p):
    return ()


def gear_target(g, p, c, among=None):
    units = list(among) if among is not None else list(p.field)
    cid = c['id']
    op = p.op
    legs = [l for l in p.legs if l.up and not l.gone] if among is None else []
    for u in units:
        P = g.power(u, atk=True)
        if c['pw'] and P < 10 <= P + c['pw'] and g.can_attack(u) and op.gigs:
            return u
    if cid in ON_SPENT_GEAR:
        cand = [l for l in legs if not l.c['gosolo'] and not any(x['id'] == cid for x in l.gear)]
        if cand:
            return cand[0]
    panam = next((l for l in legs if l.c['id'] == 'panam_palmer_nomad_cavalry'), None)
    if panam is not None and not panam.gear and c['pw'] >= 2 and not c['blocker'] and units and all(u.gear for u in units if g.power(u) > 0):
        return panam
    royce = next((l for l in legs if l.c['id'] == 'royce_psycho_on_the_edge'), None)
    if royce is not None and not c['blocker'] and cid != 'overwatch_panam_s_gift':
        return royce
    if not units:
        gs = [l for l in legs if l.c['gosolo']]
        if gs and c['pw'] >= 2:
            return gs[0]
        return None
    if c['blocker']:
        cand = [u for u in units if not g.is_blocker(u)] or units
        return max(cand, key=lambda u: g.power(u))
    if cid == 'overwatch_panam_s_gift':
        cand = [u for u in units if not any(x['id'] == cid for x in u.gear)] or units
        return min(cand, key=lambda u: (not g.is_blocker(u), g.power(u)))
    if cid == 'deadman_transmitter':
        return max(units, key=lambda u: uval(g, u))
    if cid == 'the_relic_experimental_biochip':
        return max(units, key=lambda u: u.c['cost'])
    cand = [u for u in units if not u.c['noatk'] and u.c['id'] != 'modded_kusanagi'] or units
    return max(cand, key=lambda u: (g.power(u) > 0, g.power(u) + 2 * len(u.gear), u.ready))


# ----------------------------------------------------------------------------- previsión (lookahead)
# Calibrado enfrentando la IA con previsión a la IA sin ella con el mismo mazo (794 partidas): 55 % de victorias.
# Con 2 muestras y 2 turnos no se distinguía del ruido (51 %).
LOOK_TURNS = 4      # turnos que se simulan después del propio
LOOK_SAMPLES = 4    # repartos distintos de la información oculta (mano y mazo del rival)
LOOK_MARGIN = 0.3   # ventaja mínima (por muestra) para apartarse del plan por defecto


def evalpos(g, me):
    """Lo buena que es la posición para `me` (positivo = mejor): a mano, o aprendida (valfn.py) si la partida lo pide."""
    vf = g.vf[me.pi]
    if vf.startswith(('learned', 'action')) and g.winner is None:
        import valfn
        sc = valfn.score(g, me, vf.split('@', 1)[1] if '@' in vf else None)
        if sc is not None:
            return sc
    return evalpos_hand(g, me)


def evalpos_hand(g, me):
    """Fórmula escrita a mano."""
    if g.winner is not None:
        return 0.0 if g.winner < 0 else (1000.0 if g.winner == me.pi else -1000.0)
    op = me.op
    wg = 3.0 + 0.6 * max(0, g.turn - 6)
    v = wg * (len(me.gigs) - len(op.gigs))
    v += 0.8 * (sum(uval(g, u) for u in me.field) - sum(uval(g, u) for u in op.field))
    v += 1.2 * (len(me.hand) - len(op.hand))
    v += 0.5 * (me.E - op.E)
    return v
