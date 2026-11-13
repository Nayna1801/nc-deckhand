"""Constantes y utilidades comunes de los efectos de carta (motor v2): valor de robar, Legends clave, pagos y elección de objetivos.

Convenciones: g = partida, me = quien actúa, op = rival, c = carta, u = Unidad en mesa."""
import os
from collections import Counter


PEPE_READY = os.environ.get('DECKFORGE_NOPEPE', '0') != '1'   # experimento: DECKFORGE_NOPEPE=1 apaga el «preparar Legends MERC» de Pepe
DRAW = 2.0     # valor de robar una carta (en «puntos de poder»)
GIG = 6.0      # valor de robar un Gig

JACKIE = 'jackie_welles_pour_one_out_for_me'
ALT = 'alt_cunningham_soulkiller_architect'
JUDY = 'judy_alvarez_braindance_maestro'
HANAKO = 'hanako_arasaka_daughter_of_the_emperor'
RIVER = 'river_ward_detective_on_the_hunt'
ON_SPENT_GEAR = ('tetratronic_rippler', 'netwatch_netdriver', 'zetatech_faceplate', 'arasaka_emergency_radioport')


# ----------------------------------------------------------------------------- utilidades
def pairs(p):
    return sum(n // 2 for n in Counter(v for _, v in p.gigs).values())


def mins(p):
    return sum(1 for _, v in p.gigs if v == 1)


def n8(p):
    return sum(1 for _, v in p.gigs if v >= 8)


def d4min(p):
    return any(d == 4 and v == 1 for d, v in p.gigs)


def uval(g, u):
    """Cuánto «vale» una Unidad en mesa (para elegir objetivos y valorar intercambios)."""
    return g.power(u) + 1.5 * len(u.gear) + (1.5 if g.is_blocker(u) else 0) + 0.4 * u.c['cost'] + 1.0


def pick(g, units, pred=None, key=None):
    c = [u for u in units if pred is None or pred(u)]
    if not c:
        return None
    if g.chooser is not None and len(c) > 1:
        r = g.chooser(g, 'unit', c)                     # una persona elige entre los objetivos posibles
        if r is not None:
            return r
    return max(c, key=key or (lambda u: uval(g, u)))


def by_human(g, p):
    """¿Decide una persona (y no el piloto) las elecciones de este jugador ahora mismo? Nunca en simulaciones de previsión."""
    return g.human_pi == p.pi and g.chooser is not None and not g.rollout


def choose_mode(g, p, modes, why=None):
    """Efectos de «elige uno»: la persona elige entre `modes` [(clave, texto)]. Devuelve la clave elegida, o None si decide el piloto
    (con su heurística) o no hay nada que elegir (menos de dos opciones)."""
    if not by_human(g, p) or len(modes) < 2:
        return None
    r = g.chooser(g, 'mode', modes, why, p)
    return None if r is None else r[0]


def ask_may(g, p, text, why=None):
    """Efectos de «puedes...»: True/False si decide una persona; None si decide el piloto con su heurística."""
    r = choose_mode(g, p, [('yes', text), ('no', 'No hacerlo')], why)
    return None if r is None else r == 'yes'


def pick_gear_target(g, p, c):
    """A quién se equipa un Gear que entra gratis por un efecto (The Heist, Judy): la persona elige entre sus Unidades (y sus Legends boca
    arriba si el Gear actúa al gastarse). None = que lo decida el motor (el piloto, o un único objetivo)."""
    if not by_human(g, p):
        return None
    targets = list(p.field) + ([l for l in p.legs if l.up and not l.gone] if c['id'] in ON_SPENT_GEAR else [])
    return g.chooser(g, 'gear', targets, c['name'], p) if len(targets) > 1 else None


def human_look(g, p, down, why):
    """La persona mira una Legend suya boca abajo, que queda conocida: elige cuál (sin saber qué es). Devuelve la Legend mirada."""
    modes = [(l, f'Mirar la Legend boca abajo nº {p.legs.index(l) + 1}' + (f" ({l.c['name']}, ya la conoces)" if l.known else '')) for l in down]
    l = choose_mode(g, p, modes, why) or down[0]
    l.known = True
    return l


def pick_cards(g, cards, n, who=None, why=None):
    """La persona elige `n` de `cards`, una a una (la última que queda no se pregunta). Devuelve las elegidas.
    `who` es quien decide si no es quien tiene el turno (jugadas Quick); `why` dice de qué carta."""
    rest, chosen = list(cards), []
    for _ in range(min(n, len(rest))):
        x = g.chooser(g, 'card', rest, why, who) if len(rest) > 1 else rest[0]
        x = rest[0] if x is None else x
        chosen.append(x)
        rest.remove(x)
    return chosen


def pick_own(g, p, units, why=None):
    """Efectos en que cada jugador elige una Unidad SUYA (Live with the Aftermath): la persona si es ella (aunque no sea su turno);
    si no, la de menor valor, como hace el piloto."""
    if by_human(g, p) and len(units) > 1:
        r = g.chooser(g, 'unit', units, why, p)
        if r is not None:
            return r
    return min(units, key=lambda t: uval(g, t))


def can_hit(g, me):
    return [u for u in me.field if g.can_attack(u)]


def spendval(g, me, op, t):
    """Valor de gastar (girar) una Unidad rival preparada."""
    if not t.ready:
        return 0.0
    v = 0.8
    atk = can_hit(g, me)
    if atk:
        if g.is_blocker(t) and op.gigs:
            v += 3.0
        pt = g.power(t)
        if any(g.power(u, atk=True) > pt for u in atk):
            v += 0.5 * uval(g, t)
    if me.kill_spent:
        v += 2.0
    return v


def best_spend(g, me, op, pred=None):
    c = [t for t in op.field if t.ready and (pred is None or pred(t))]
    if not c:
        return None, 0.0
    t = max(c, key=lambda t: spendval(g, me, op, t))
    return t, spendval(g, me, op, t)


def do_spend(g, me, t, src, lock=False):
    g.spend_unit(t)
    if lock:
        t.noready = True
    g.ev(me, 'spend', src)


def riot_shields(p):
    return sum(1 for u in p.field for x in u.gear if x['id'] == 'riot_shield') + sum(1 for l in p.legs for x in l.gear if x['id'] == 'riot_shield')


def gs_cost(g, p, l):
    return max(1, l.c['cost'] + 2 * riot_shields(p.op) - p.gs_disc)


def cost(g, p, c):
    k = c['cost']
    cid = c['id']
    op = p.op
    if cid == 'maxtac_heavy':
        k = max(1, k - len(op.field))
    elif cid in ('octant', 'carnage_at_the_colosseum'):
        k = max(1, k - n8(p))
    elif cid == 'trauma_team_operatives':
        k = max(1, k - sum(1 for x in p.trash if x['t'] == 'U'))
    elif cid == 'zetatech_berserk':
        k = max(1, k - sum(1 for l in p.legs if l.up and not l.gone))
    elif cid == 'we_gotta_live_together' and len(op.gigs) >= len(p.gigs) + 2:
        k = 3
    elif cid == 'nocturne_op55_n1' and not p.fixer:
        k = 1
    if c['t'] == 'G' and 'Cyberware' in c['tags'] and not p.cyber and p.has('viktor_vektor_drop_your_illusions'):
        k = max(1, k - 3)
    if c['t'] == 'P' and p.alt_disc:
        k = max(1, k - p.alt_disc)
    return k


def best_from(g, p, cards, pred):
    c = [x for x in cards if pred(x)]
    if g.chooser is not None and len(c) > 1:
        r = g.chooser(g, 'card', c)                     # una persona elige entre las cartas posibles
        if r is not None:
            return r
    return max(c, key=lambda x: g.ai.keep(g, p, x)) if c else None


def free_unit_from(g, me, zones, maxcost, src, atku=False):
    """Juega gratis la mejor Unidad de coste <= maxcost de las zonas dadas (mano y/o basura)."""
    best = None
    for z in zones:
        for x in z:
            if x['t'] == 'U' and x['cost'] <= maxcost and (best is None or x['pw'] + x['cost'] * 0.3 > best[0]):
                best = (x['pw'] + x['cost'] * 0.3, x, z)
    if best is None:
        return None
    _, x, z = best
    z.remove(x)
    u = g.play_card(me, x, pay=False)
    g.ev(me, 'free', src)
    if u is not None and atku:
        u.atku = True
    return u


def kill_value(g, t):
    """Lo que vale quitar la Unidad t (0 si no hay objetivo): su valor más lo que cuesta volver a ponerla."""
    return uval(g, t) + 2.0 if t is not None else 0.0
