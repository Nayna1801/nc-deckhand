"""Red de conocimiento de las cartas (al estilo de un mapa de código): cada carta es un nodo con su lógica
(qué aporta, qué necesita, a qué responde, contra qué flojea) y se une a otras a través de CONCEPTOS del juego.

Tres fuentes, cada arista lleva su etiqueta de confianza:
  TEXTO    sale del texto de la carta con reglas fijas (lo más fiable)
  ANOTADO  anotación manual de net_data.py
  MEDIDO   sale de partidas simuladas (parejas que rinden más juntas, cartas rivales que hunden un mazo)

Sirve para RAZONAR sobre un mazo (qué pide, quién se lo da, qué le falta, qué le responde) en lugar de solo listar cartas.
"""
import json
import re
from collections import Counter, defaultdict, deque
from pathlib import Path

import cardsdb as DB

HERE = Path(__file__).resolve().parent
MEASURED = HERE / 'data' / 'measured.json'
BY = DB.BY

CONCEPTS = {
    # dados
    'MIN': 'Gig al mínimo (valor 1)', 'PAIR': 'pareja de Gigs', 'LOWCRED': 'menos Street Cred que el rival',
    'HIGHCRED': 'más Street Cred que el rival', 'G8': 'Gig de 8 o más', 'PARITY': 'paridad de los Gigs', 'D20': 'd20 alto en tu zona',
    # mesa y recursos
    'SPENT': 'Unidad rival gastada', 'GEAR': 'Gear equipado', 'PROG': 'jugar Programas', 'BD': 'Programas Braindance',
    'TRASHP': 'Programas en tu basura', 'TRASHU': 'Unidades en tu basura', 'LEGUP': 'Legends boca arriba', 'GS': 'Go Solo',
    'P10': 'llegar a poder 10 (roba 2 Gigs)', 'BLOCK': 'Blocker', 'CARDS': 'robar cartas', 'EDDIES': 'dinero extra o descuentos',
    'TEMPO': 'atacar el turno que entra', 'BLUE': 'Unidades y Gear azules',
    # tribus
    'ARASAKA': 'cartas ARASAKA', 'MERC': 'Legends MERC', 'CORPO_GANGER': 'Unidades CORPO o GANGER', 'ROCKER': 'Unidades ROCKER',
    # respuestas
    'vs_SMALL': 'elimina Unidades pequeñas (poder 5 o menos)', 'vs_BIG': 'elimina cualquier Unidad (también grandes)',
    'vs_GEAR': 'destruye Gear', 'vs_GS': 'frena Go Solo y Adrenaline', 'vs_ATK': 'frena ataques y robos de Gig',
    'vs_TRASH': 'manda al fondo del mazo (sin basura ni «Defeated»)', 'vs_BLOCK': 'aparta Blockers (gasta o inmoviliza)',
    'vs_HAND': 'hace descartar', 'vs_DICE': 'toca los dados del rival',
}
ANSWERS = [c for c in CONCEPTS if c.startswith('vs_')]

# (patrón sobre el texto en inglés, tipo, concepto, peso)
RULES = [
    # --- necesita
    (r'min Gig', 'need', 'MIN', 2), (r'value-pair', 'need', 'PAIR', 2), (r'less ☆', 'need', 'LOWCRED', 2),
    (r'more ☆', 'need', 'HIGHCRED', 2), (r'8\+ value', 'need', 'G8', 2), (r'\beven\b|\bodd\b', 'need', 'PARITY', 1),
    (r'friendly d20', 'need', 'D20', 2), (r'max Gig', 'need', 'G8', 1),
    (r'[Dd]efeat a spent|spent rival Unit|attack spent rival', 'need', 'SPENT', 2),
    (r'(?<!un)equipped|a friendly Gear|Gear with cost 2 or less|CYBERWARE Gear|Reveal a Gear|a Gear from among', 'need', 'GEAR', 2),
    (r'discard \d Programs?|discard 1 Program|played a Program|next Program|If it.s a Program', 'need', 'PROG', 2),
    (r'Program (with cost 3 or less )?from your (hand or )?trash|Program from among', 'need', 'TRASHP', 2),
    (r'Units? (with cost \d or less )?from your (hand or )?trash|Unit in your trash|Unit from your trash|Unit from among', 'need', 'TRASHU', 2),
    (r'face-up Legend|all friendly Legends are face-up', 'need', 'LEGUP', 2), (r'BRAINDANCE', 'need', 'BD', 2),
    (r'ARASAKA', 'need', 'ARASAKA', 2), (r'MERC Legends', 'need', 'MERC', 2), (r'CORPO or GANGER', 'need', 'CORPO_GANGER', 2),
    (r'ROCKER Unit', 'need', 'ROCKER', 1), (r'Blue Unit or Blue Gear', 'need', 'BLUE', 2),
    (r'use \{Go Solo\}|has \{Go Solo\}', 'need', 'GS', 1), (r'power 5\+|by 3\+ power', 'need', 'P10', 1),
    # --- aporta
    (r'[Dd]ecrease a (friendly )?Gig', 'give', 'MIN', 2), (r'[Dd]ecrease a (friendly )?Gig', 'give', 'LOWCRED', 1),
    (r'[Ii]ncrease (a Gig|it) by', 'give', 'G8', 2), (r'[Ii]ncrease (a Gig|it) by', 'give', 'HIGHCRED', 1),
    (r"set a Gig|Set a player.s Gig|[Ss]wap a friendly Gig|Adjust a Gig|adjust a Gig|reroll", 'give', 'PAIR', 2),
    (r"set a Gig|Set a player.s Gig|[Ss]wap a friendly Gig|Adjust a Gig|adjust a Gig", 'give', 'PARITY', 1),
    (r"[Ss]wap a friendly Gig|Adjust a Gig|adjust a Gig", 'give', 'MIN', 1), (r"[Ss]wap a friendly Gig", 'give', 'LOWCRED', 1),
    (r'Spend (a|all) rival|must attack|and a rival Unit\.|can.t ready', 'give', 'SPENT', 2),
    (r'Trash \d|[Tt]rash the top|trash 1\b|discard 1, then|draw 1, then discard', 'give', 'TRASHP', 1),
    (r'Trash \d|trash 1\b', 'give', 'TRASHU', 1),
    (r'Call a Legend for free|Call it for free', 'give', 'LEGUP', 2),
    (r'\+\d power|gains power|\+2 power for each|\+3 power', 'give', 'P10', 2),
    (r'[Dd]raw \d|draw 1|add (it|them|1|a \w+) .*to your hand|add 1 more', 'give', 'CARDS', 2),
    (r'ready \d Eddies?|ready 1 Eddie|Sell the top|for free|for -\d|plays for -1', 'give', 'EDDIES', 2),
    (r'Give another friendly Unit .*\{Adrenaline\}|can attack .*the turn it.s played|can attack rival Units the turn', 'give', 'TEMPO', 2),
    # --- responde a
    (r'power 0|-4 power|-5 power|power 4 or less|power 2 or less|power 5 or less|cost 2 or less\.|cost 3 or less\.|lowest-power|value of a friendly d20', 'ctr', 'vs_SMALL', 2),
    (r'Defeat a rival Unit\.|Defeat a spent Unit|Defeat all other|bottom-deck a rival Unit\.|bottom-deck a spent rival|less power than a friendly Unit|bottom-deck a rival unequipped', 'ctr', 'vs_BIG', 2),
    (r'[Bb]ottom-deck (a|all) (rival|spent rival|Rival)', 'ctr', 'vs_TRASH', 2),
    (r'[Dd]efeat a (rival )?Gear', 'ctr', 'vs_GEAR', 2),
    (r'pay \+2 €\$ to use \{Go Solo\}|can.t attack the turn they.re played|rival Legends can.t steal', 'ctr', 'vs_GS', 2),
    (r'steals 1 fewer|can.t attack until|can.t steal friendly|isn.t stolen|loses power|Give a rival Unit -', 'ctr', 'vs_ATK', 2),
    (r'Rival discards', 'ctr', 'vs_HAND', 2), (r'Spend (a|all) rival|can.t ready', 'ctr', 'vs_BLOCK', 2),
    (r'[Dd]ecrease a Gig|Increase a Gig|Adjust a Gig|adjust a Gig|[Ss]wap a friendly Gig with a rival|Set a player.s Gig|set a Gig', 'ctr', 'vs_DICE', 1),
]

# anotaciones manuales (net_data.py) -> conceptos de esta red
NET_GIVE = {'MIN': 'MIN', 'PAIR': 'PAIR', 'LOW': 'LOWCRED', 'HIGH': 'HIGHCRED', 'G8': 'G8', 'EVEN': 'PARITY', 'ODD': 'PARITY', 'PROG': 'PROG',
            'BD': 'BD', 'GEAR': 'GEAR', 'BLK': 'BLOCK', 'SPENT': 'SPENT', 'CALL': 'LEGUP', 'GS': 'GS', 'ADR': 'TEMPO', 'ARA': 'ARASAKA',
            'POW': 'P10', 'TRASHP': 'TRASHP', 'TRASHU': 'TRASHU', 'EDDIE': 'EDDIES', 'DRAW': 'CARDS'}
NET_NEED = dict(NET_GIVE, FUP='LEGUP', P8='P10', BLUE='BLUE')
NET_CTR = {'SWEEP': 'vs_SMALL', 'KSPENT': 'vs_BIG', 'SPENDBLK': 'vs_BLOCK', 'GEARHATE': 'vs_GEAR', 'NOGS': 'vs_GS', 'BIGK': 'vs_BIG',
           'CUT1': 'vs_ATK', 'CREDX': 'vs_DICE'}


def _add(d, concept, w, src):
    cur = d.get(concept)
    if cur is None or w > cur[0] or (src == 'TEXTO' and cur[1] != 'TEXTO'):
        d[concept] = (max(w, cur[0]) if cur else w, src if cur is None or src == 'TEXTO' else cur[1])


def _unit_traits(n, c, text, tags, pw):
    """Lo que aporta y lo que debilita a una Unidad por sus etiquetas, su poder y su texto."""
    _add(n['give'], 'TRASHU', 1, 'TEXTO')
    if c['color'] == 'Blue':
        _add(n['give'], 'BLUE', 2, 'TEXTO')
    if 'Arasaka' in tags:
        _add(n['give'], 'ARASAKA', 2, 'TEXTO')
    if tags & {'Corpo', 'Ganger'}:
        _add(n['give'], 'CORPO_GANGER', 1, 'TEXTO')
    if 'Rocker' in tags:
        _add(n['give'], 'ROCKER', 1, 'TEXTO')
    if pw >= 8:
        _add(n['give'], 'P10', 2, 'TEXTO')
    if text.startswith('{Adrenaline}'):
        _add(n['give'], 'TEMPO', 2, 'TEXTO')
    if '{Blocker}' in text:
        _add(n['give'], 'BLOCK', 2, 'TEXTO')
        _add(n['ctr'], 'vs_ATK', 1, 'TEXTO')
    # debilidades que salen de los números
    if 0 < pw <= 5:
        _add(n['weak'], 'vs_SMALL', 2, 'TEXTO')
    if pw == 0:
        _add(n['weak'], 'vs_SMALL', 1, 'TEXTO')
    _add(n['weak'], 'vs_BIG', 1 if pw < 8 else 2, 'TEXTO')
    if pw > 0 and "can't attack" not in text:
        _add(n['weak'], 'vs_ATK', 1, 'TEXTO')
    if '{Defeated}' in text:
        _add(n['weak'], 'vs_TRASH', 2, 'TEXTO')
    if text.startswith('{Adrenaline}'):
        _add(n['weak'], 'vs_GS', 2, 'TEXTO')


def _legend_traits(n, text, tags):
    if 'Merc' in tags:
        _add(n['give'], 'MERC', 2, 'TEXTO')
    if 'Arasaka' in tags:
        _add(n['give'], 'ARASAKA', 1, 'TEXTO')
    if '{Go Solo}' in text:
        _add(n['give'], 'GS', 2, 'TEXTO')
        _add(n['give'], 'TEMPO', 2, 'TEXTO')
        _add(n['give'], 'P10', 1, 'TEXTO')
        _add(n['weak'], 'vs_GS', 2, 'TEXTO')
        n['need'].pop('GS', None)


def _type_traits(n, c, text, tags, pw):
    """Lo que la carta ES (su tipo, etiquetas y números) también aporta o la debilita."""
    t = c['type']
    if t == 'Gear':
        _add(n['give'], 'GEAR', 2, 'TEXTO')
        if pw >= 2:
            _add(n['give'], 'P10', 1 if pw == 2 else 2, 'TEXTO')
    if t == 'Program':
        _add(n['give'], 'PROG', 1, 'TEXTO')
        _add(n['give'], 'TRASHP', 1, 'TEXTO')
        if 'Braindance' in tags:
            _add(n['give'], 'BD', 2, 'TEXTO')
    if t == 'Unit':
        _unit_traits(n, c, text, tags, pw)
    if t == 'Gear' and '{Blocker}' in text:
        _add(n['give'], 'BLOCK', 2, 'TEXTO')
    if t == 'Gear' and pw <= 2:
        _add(n['weak'], 'vs_GEAR', 2, 'TEXTO')
    if t == 'Legend':
        _legend_traits(n, text, tags)


def _fix_conditions(n, c, text):
    """Textos donde la condición es un castigo y no un requisito, y debilidades que se deducen de lo que la carta necesita."""
    if c['id'] == 'gunpoint_diplomacy':
        n['need'].pop('LOWCRED', None)
        _add(n['need'], 'HIGHCRED', 2, 'TEXTO')
    if c['id'] == 'evelyn_parker_scheming_siren':
        n['need'].pop('HIGHCRED', None)
        _add(n['need'], 'LOWCRED', 1, 'TEXTO')
    if 'TRASHU' in n['need'] or 'TRASHP' in n['need']:
        _add(n['weak'], 'vs_TRASH', 1, 'TEXTO')
    if 'GEAR' in n['need']:
        _add(n['weak'], 'vs_GEAR', 1, 'TEXTO')
    if set(n['need']) & {'MIN', 'PAIR', 'LOWCRED', 'HIGHCRED', 'G8', 'PARITY'}:
        _add(n['weak'], 'vs_DICE', 1, 'TEXTO')
    # una carta no «necesita» lo que ella misma es
    if c['type'] == 'Gear':
        if not re.search(r'Reveal a Gear|friendly Gear', text):
            n['need'].pop('GEAR', None)


def _annotated_layer(n, c):
    """Capa ANOTADO: lo anotado a mano en la red de sinergias (net_model) y que el texto no daba."""
    import net_model as NM
    nd = NM.NODE.get(c['id'])
    if not nd:
        return
    for f, w in nd['give'].items():
        if f in NET_GIVE and w > 0 and NET_GIVE[f] not in n['give']:
            _add(n['give'], NET_GIVE[f], min(3, w), 'ANOTADO')
    for f, w in nd['want'].items():
        if f in NET_NEED and w > 0 and NET_NEED[f] not in n['need']:
            _add(n['need'], NET_NEED[f], min(3, w), 'ANOTADO')
    for f, w in nd['ctr'].items():
        if f in NET_CTR and w > 0 and NET_CTR[f] not in n['ctr']:
            _add(n['ctr'], NET_CTR[f], min(3, w), 'ANOTADO')


def _make_node(c):
    text = c['rules'] or ''
    tags = set(c['classifications'] or ())
    pw, cost = c['power'] or 0, c['cost'] or 0
    n = dict(id=c['id'], name=c['displayName'], type=c['type'], color=c['color'], cost=cost, power=pw, ram=c['ram'] or 0, text=text,
             give={}, need={}, ctr={}, weak={})
    for pat, kind, concept, w in RULES:
        if re.search(pat, text):
            _add(n[kind], concept, w, 'TEXTO')
    _type_traits(n, c, text, tags, pw)
    _fix_conditions(n, c, text)
    _annotated_layer(n, c)
    return n


def build_nodes():
    """Un nodo por carta legal: give/need/ctr/weak = {concepto: (peso, fuente)}."""
    return {c['id']: _make_node(c) for c in DB.RAW if c['legality'] == 'legal'}


def load_measured():
    if MEASURED.exists():
        return json.load(open(MEASURED, encoding='utf8'))
    return dict(combos=[], anti=[], hurts=[], card=[])


class Graph:
    def __init__(s):
        s.nodes = build_nodes()
        s.m = load_measured()
        s.givers = defaultdict(list)     # concepto -> [(carta, peso)]
        s.needers = defaultdict(list)
        s.answers = defaultdict(list)
        s.weak = defaultdict(list)
        for i, n in s.nodes.items():
            for c, (w, _) in n['give'].items():
                s.givers[c].append((i, w))
            for c, (w, _) in n['need'].items():
                s.needers[c].append((i, w))
            for c, (w, _) in n['ctr'].items():
                s.answers[c].append((i, w))
            for c, (w, _) in n['weak'].items():
                s.weak[c].append((i, w))
        s.combo = defaultdict(list)      # carta -> [(otra, mejora, z)]
        for a, b, x, z in s.m.get('combos', []) + s.m.get('anti', []):
            if a in s.nodes and b in s.nodes:
                s.combo[a].append((b, x, z))
                s.combo[b].append((a, x, z))

    # ------------------------------------------------------------------ búsqueda de nodos
    def find(s, q):
        q0 = re.sub(r'[^a-z0-9]+', '', q.lower())
        if q in s.nodes:
            return q
        exact = [i for i, n in s.nodes.items() if re.sub(r'[^a-z0-9]+', '', n['name'].lower()) == q0]
        if exact:
            return exact[0]
        part = [i for i, n in s.nodes.items() if q0 in re.sub(r'[^a-z0-9]+', '', n['name'].lower()) or q0 in i.replace('_', '')]
        if len(part) == 1:
            return part[0]
        if not part:
            raise SystemExit(f'No encuentro ninguna carta que se llame «{q}».')
        raise SystemExit(f'«{q}» es ambiguo: ' + '; '.join(s.nodes[i]['name'] for i in part[:8]))

    def nm(s, i):
        return s.nodes[i]['name']

    def legal_for(s, legs):
        ram = defaultdict(int)
        for l in legs:
            ram[BY[l]['color']] += BY[l]['ram'] or 0
        return [i for i, n in s.nodes.items() if n['type'] != 'Legend' and i not in DB.UNAVAILABLE and n['ram'] <= ram.get(n['color'], 0)]

    # ------------------------------------------------------------------ una carta
    def explain_card(s, i, pool=None):
        n = s.nodes[i]
        L = [f"{n['name']}  [{n['type']}, {n['color']}, coste {n['cost']}, poder {n['power']}, RAM {n['ram']}]", f"  «{n['text'].replace(chr(10), ' / ')}»"]

        def row(title, d):
            if d:
                L.append(f"  {title}: " + '; '.join(f"{CONCEPTS[c]} [{src}]" for c, (w, src) in sorted(d.items(), key=lambda t: -t[1][0])))
        row('APORTA', n['give'])
        row('NECESITA', n['need'])
        row('RESPONDE A', n['ctr'])
        row('FLOJEA CONTRA', n['weak'])
        ok = (lambda j: pool is None or j in pool)
        for c, (w, _) in sorted(n['need'].items(), key=lambda t: -t[1][0]):
            g = sorted([(j, x) for j, x in s.givers[c] if j != i and ok(j)], key=lambda t: -t[1])[:8]
            L.append(f"  Para tener «{CONCEPTS[c]}» sirven: " + ('; '.join(s.nm(j) for j, _ in g) or 'nada en el pool'))
        for c, (w, _) in sorted(n['give'].items(), key=lambda t: -t[1][0]):
            u = sorted([(j, x) for j, x in s.needers[c] if j != i and ok(j)], key=lambda t: -t[1])[:8]
            if u:
                L.append(f"  Su «{CONCEPTS[c]}» lo aprovechan: " + '; '.join(s.nm(j) for j, _ in u))
        for c in n['weak']:
            a = sorted(s.answers[c], key=lambda t: -t[1])[:6]
            if a:
                L.append(f"  Le responden ({CONCEPTS[c]}): " + '; '.join(s.nm(j) for j, _ in a))
        if s.combo.get(i):
            best = sorted(s.combo[i], key=lambda t: -t[1])
            pos = [f"{s.nm(j)} ({x:+.0%})" for j, x, z in best if x > 0][:5]
            neg = [f"{s.nm(j)} ({x:+.0%})" for j, x, z in best if x < 0][-3:]
            if pos:
                L.append('  En partidas rinde mejor junto a [MEDIDO]: ' + '; '.join(pos))
            if neg:
                L.append('  En partidas rinde peor junto a [MEDIDO]: ' + '; '.join(neg))
        return '\n'.join(L)

    # ------------------------------------------------------------------ caminos
    def path(s, a, b, maxlen=4):
        """Cadena más corta carta -> concepto -> carta -> ... de «a aporta lo que b necesita»."""
        q = deque([(a, [a])])
        seen = {a}
        while q:
            cur, p = q.popleft()
            if len(p) > 2 * maxlen:
                continue
            for c in s.nodes[cur]['give']:
                for j, _ in s.needers[c]:
                    if j in seen:
                        continue
                    np_ = p + [c, j]
                    if j == b:
                        return np_
                    seen.add(j)
                    q.append((j, np_))
        return None

    # ------------------------------------------------------------------ un mazo
    def deck_flows(s, legs, main):
        cnt = Counter(main)
        for l in legs:
            cnt[l] += 1
        sup, dem = defaultdict(float), defaultdict(float)
        who_g, who_n = defaultdict(list), defaultdict(list)
        for i, k in cnt.items():
            n = s.nodes.get(i)
            if n is None:
                continue
            mult = 2.0 if n['type'] == 'Legend' else k      # una Legend está siempre disponible
            for c, (w, _) in n['give'].items():
                sup[c] += w * mult
                who_g[c].append((i, k))
            for c, (w, _) in n['need'].items():
                dem[c] += w * mult
                who_n[c].append((i, k))
        return cnt, sup, dem, who_g, who_n

    def coverage(s, sup, dem, c):
        if dem[c] <= 0:
            return None
        return min(1.5, sup[c] / (1.2 * dem[c]))

    def explain_deck(s, name, legs, main, field=()):
        cnt, sup, dem, who_g, who_n = s.deck_flows(legs, main)
        fmt = lambda xs: '; '.join((f"{k}x " if s.nodes[i]['type'] != 'Legend' else '') + s.nm(i) for i, k in sorted(xs, key=lambda t: -t[1])[:7])
        L = [f"=== Razonamiento sobre {name} ===", '', '1) MOTORES: lo que el mazo pide y quién se lo da']
        rows = sorted([c for c in dem if not c.startswith('vs_')], key=lambda c: -dem[c])
        for c in rows:
            cov = s.coverage(sup, dem, c)
            tag = 'BIEN CUBIERTO' if cov >= 0.9 else ('JUSTO' if cov >= 0.5 else 'COJO')
            L.append(f"   {CONCEPTS[c]}  ->  {tag} (aporte {sup[c]:.0f} / demanda {dem[c]:.0f})")
            L.append(f"        lo piden: {fmt(who_n[c])}")
            L.append(f"        lo dan:   {fmt(who_g[c]) or 'NADIE'}")
        loose = [c for c in sup if dem[c] == 0 and not c.startswith('vs_') and c in ('MIN', 'PAIR', 'LOWCRED', 'HIGHCRED', 'G8', 'SPENT', 'TRASHP', 'TRASHU', 'LEGUP', 'BD') and sup[c] >= 4]
        if loose:
            L.append('   Piezas sueltas (el mazo lo genera pero nadie lo aprovecha): ' + '; '.join(f"{CONCEPTS[c]} ({fmt(who_g[c])})" for c in loose))
        # cartas cojas: su necesidad peor cubierta
        lame = []
        for i, k in cnt.items():
            n = s.nodes.get(i)
            req = [c for c in (n['need'] if n else ()) if n['need'][c][0] >= 2]     # peso 1 = extra opcional
            if req:
                worst = min(req, key=lambda c: s.coverage(sup, dem, c))
                cv = s.coverage(sup, dem, worst)
                if cv < 0.5:
                    lame.append((cv, i, worst))
        L.append('\n2) CARTAS QUE SE QUEDAN SIN LO QUE NECESITAN')
        if lame:
            for cv, i, c in sorted(lame):
                L.append(f"   {s.nm(i)}: necesita «{CONCEPTS[c]}» y el mazo apenas lo da")
        else:
            L.append('   Ninguna: todas las necesidades tienen al menos media cobertura.')
        # respuestas y debilidades
        total = sum(k for i, k in cnt.items() if s.nodes[i]['type'] != 'Legend')
        L.append('\n3) RESPUESTAS QUE LLEVA Y PUNTOS DÉBILES')
        ans = {c: [(i, k) for i, k in cnt.items() if c in s.nodes[i]['ctr']] for c in ANSWERS}
        wk = {c: [(i, k) for i, k in cnt.items() if c in s.nodes[i]['weak']] for c in ANSWERS}
        for c in ANSWERS:
            if ans[c]:
                L.append(f"   lleva «{CONCEPTS[c]}»: {fmt(ans[c])}")
        for c in ANSWERS:
            n_w = sum(k for i, k in wk[c] if s.nodes[i]['weak'][c][0] >= 2)
            if n_w >= 6:
                L.append(f"   expuesto a «{CONCEPTS[c]}»: {n_w} de {total} cartas ({fmt([x for x in wk[c] if s.nodes[x[0]]['weak'][c][0] >= 2])})")
        # cruces con el campo
        if field:
            L.append('\n4) CRUCES: qué trae cada rival contra tus puntos débiles y qué traes tú contra los suyos')
            for f in field:
                fc = Counter(f['deck'])
                for l in f['legs']:
                    fc[l] += 1
                theirs, mine = [], []
                for c in ANSWERS:
                    n_ans = sum(k for i, k in fc.items() if i in s.nodes and c in s.nodes[i]['ctr'] and s.nodes[i]['ctr'][c][0] >= 2)
                    n_weak = sum(k for i, k in wk[c] if s.nodes[i]['weak'][c][0] >= 2)
                    if n_ans >= 3 and n_weak >= 5:
                        theirs.append(f"{CONCEPTS[c]} ({n_ans} cartas suyas contra {n_weak} tuyas)")
                    f_weak = sum(k for i, k in fc.items() if i in s.nodes and c in s.nodes[i]['weak'] and s.nodes[i]['weak'][c][0] >= 2)
                    m_ans = sum(k for i, k in ans[c] if s.nodes[i]['ctr'][c][0] >= 2)
                    if m_ans >= 3 and f_weak >= 5:
                        mine.append(f"{CONCEPTS[c]} ({m_ans} tuyas contra {f_weak} suyas)")
                # sus motores que puedes romper tocando dados
                L.append(f"   vs {f['name']}")
                L.append('        te amenaza con: ' + ('; '.join(theirs) or 'nada que encaje con tus debilidades'))
                L.append('        le respondes con: ' + ('; '.join(mine) or 'nada que encaje con las suyas'))
                hurts = [h for h in s.m.get('hurts', []) if h[0] == name and h[1] == f['name']]
                if hurts:
                    L.append('        en partidas te hunden [MEDIDO]: ' + '; '.join(f"{s.nm(c)} ({d:+.0%})" for _, _, c, d in hurts[:3] if c in s.nodes))
        # sugerencias
        L.append('\n5) QUÉ ENCAJARÍA (cartas legales que cubren lo cojo o aprovechan lo que sobra)')
        for sc, i, why in s.suggest(legs, main)[:8]:
            L.append(f"   + {s.nm(i)}: {why}")
        L.append('   Candidatas a salir (las que menos conectan con el resto):')
        for sc, i, why in s.cuts(legs, main)[:5]:
            L.append(f"   - {cnt[i]}x {s.nm(i)}: {why}")
        return '\n'.join(L)

    def card_fit(s, i, sup, dem):
        """Cuánto encaja la carta i en un mazo con esos flujos: (puntuación, motivos)."""
        n = s.nodes[i]
        sc, why = 0.0, []
        for c, (w, _) in n['give'].items():
            if c.startswith('vs_') or dem[c] <= 0:
                continue
            gap = max(0.0, 1.0 - sup[c] / (1.2 * dem[c]))
            if gap > 0.05:
                sc += w * gap * min(3.0, dem[c] / 4.0)
                why.append(f"da «{CONCEPTS[c]}», que falta")
        for c, (w, _) in n['need'].items():
            cov = min(1.0, sup[c] / (1.2 * (dem[c] + w)))
            sc += w * (cov - 0.55) * 1.6
            if cov >= 0.8:
                why.append(f"su «{CONCEPTS[c]}» ya está cubierto")
        return sc, why

    def suggest(s, legs, main):
        cnt, sup, dem, _, _ = s.deck_flows(legs, main)
        out = []
        for i in s.legal_for(legs):
            if cnt[i] >= 3:
                continue
            sc, why = s.card_fit(i, sup, dem)
            if sc > 0.3 and why:
                out.append((sc, i, '; '.join(why[:3])))
        return sorted(out, reverse=True)

    def cuts(s, legs, main):
        cnt, sup, dem, _, _ = s.deck_flows(legs, main)
        out = []
        for i, k in cnt.items():
            n = s.nodes[i]
            if n['type'] == 'Legend':
                continue
            used = sum(w for c, (w, _) in n['give'].items() if dem[c] > 0 and not c.startswith('vs_') and c not in ('PROG', 'TRASHP', 'TRASHU', 'BLUE'))
            unmet = [c for c in n['need'] if n['need'][c][0] >= 2 and s.coverage(sup, dem, c) < 0.5]
            answers = sum(w for c, (w, _) in n['ctr'].items())
            sc = used + 0.7 * answers - 2.0 * len(unmet) + 0.25 * n['power']
            why = ('necesita ' + ', '.join(CONCEPTS[c] for c in unmet) + ' y no lo hay') if unmet else 'no alimenta ningún motor del mazo ni responde a nada'
            if sc < 2.5:
                out.append((-sc, i, why))
        return sorted(out, reverse=True)

    # ------------------------------------------------------------------ construir por razonamiento
    def build(s, legs, core=(), size=40, units=(18, 24)):
        """Monta un mazo siguiendo la red: parte de lo que piden y dan las Legends (y las cartas núcleo)
        y añade cada vez la carta que mejor cierra los motores abiertos."""
        import net_model as NM
        pool = s.legal_for(legs)
        deck = []
        for i in core:
            deck += [i] * 3
        while len(deck) < size:
            cnt, sup, dem, _, _ = s.deck_flows(legs, deck)
            nu = sum(1 for i in deck if s.nodes[i]['type'] == 'Unit')
            left = size - len(deck)
            best = None
            for i in pool:
                if cnt[i] >= 3:
                    continue
                n = s.nodes[i]
                is_u = n['type'] == 'Unit'
                if is_u and nu >= units[1]:
                    continue
                if not is_u and (units[0] - nu) >= left:
                    continue
                fit, _ = s.card_fit(i, sup, dem)
                base = NM.NODE[i]['v'] if i in NM.NODE else 2.0
                ans = sum(w for c, (w, _) in n['ctr'].items() if sum(1 for j in deck if c in s.nodes[j]['ctr']) < 5)
                curve = -0.5 * max(0, n['cost'] - 5) * sum(1 for j in deck if s.nodes[j]['cost'] >= 6) / 3.0
                sc = fit * 1.5 + 0.45 * base + 0.35 * ans + curve - 0.4 * cnt[i]
                if best is None or sc > best[0]:
                    best = (sc, i)
            if best is None:
                break
            deck.append(best[1])
        return deck

    # ------------------------------------------------------------------ informe y exportación
    def hubs(s, top=12):
        deg = Counter()
        for i, n in s.nodes.items():
            for c, (w, _) in n['give'].items():
                deg[i] += w * len(s.needers[c]) ** 0.5
            for c, (w, _) in n['need'].items():
                deg[i] += w * len(s.givers[c]) ** 0.5
        return deg.most_common(top)

    def report(s):
        L = ['# Red de cartas del Cyberpunk TCG', '',
             f"{len(s.nodes)} cartas, {len(CONCEPTS)} conceptos. Etiquetas: TEXTO (sale del texto), ANOTADO (manual), MEDIDO (partidas simuladas).", '',
             '## Cartas más conectadas (piezas centrales)', '']
        for i, d in s.hubs():
            n = s.nodes[i]
            L.append(f"- **{n['name']}** ({n['type']}, {n['color']}): aporta {', '.join(CONCEPTS[c] for c in n['give']) or '-'}; necesita {', '.join(CONCEPTS[c] for c in n['need']) or '-'}")
        L += ['', '## Motores (cada concepto, quién lo necesita y quién lo da)', '']
        for c in CONCEPTS:
            if c.startswith('vs_') or not s.needers[c]:
                continue
            g = sorted(s.givers[c], key=lambda t: -t[1])
            L.append(f"### {CONCEPTS[c]}")
            L.append(f"- Lo necesitan ({len(s.needers[c])}): " + '; '.join(s.nm(i) for i, _ in sorted(s.needers[c], key=lambda t: -t[1])[:14]))
            L.append(f"- Lo dan ({len(g)}): " + '; '.join(s.nm(i) for i, _ in g[:14]))
            L.append('')
        L += ['## Respuestas (qué cartas responden a qué y a cuántas afectan)', '']
        for c in ANSWERS:
            L.append(f"- **{CONCEPTS[c]}**: {len(s.answers[c])} cartas lo hacen ({'; '.join(s.nm(i) for i, _ in sorted(s.answers[c], key=lambda t: -t[1])[:8])}); {len(s.weak[c])} cartas son sensibles.")
        cross = []
        for c, needers in s.needers.items():
            for i, w in needers:
                for j, v in s.givers[c]:
                    if s.nodes[i]['color'] != s.nodes[j]['color'] and w >= 2 and v >= 2 and s.nodes[j]['type'] != 'Legend' and c in ('MIN', 'PAIR', 'LOWCRED', 'G8', 'SPENT', 'TRASHU', 'LEGUP'):
                        cross.append((s.nm(j), s.nm(i), CONCEPTS[c]))
        L += ['', '## Conexiones entre colores (un color da lo que otro necesita)', '']
        seen = set()
        for a, b, c in cross:
            if (a, c) in seen or len(seen) >= 25:
                continue
            seen.add((a, c))
            L.append(f"- {a} → *{c}* → {b}")
        if s.m.get('combos'):
            L += ['', '## Parejas que rinden más juntas en partidas [MEDIDO]', '']
            for a, b, x, z in sorted(s.m['combos'], key=lambda t: -t[2])[:15]:
                if a in s.nodes and b in s.nodes:
                    L.append(f"- {s.nm(a)} + {s.nm(b)}: {x:+.0%}")
        return '\n'.join(L) + '\n'

    def to_json(s, decks=()):
        nodes, edges = [], []
        for c, label in CONCEPTS.items():
            nodes.append(dict(id='C:' + c, label=label, kind='answer' if c.startswith('vs_') else 'concept'))
        for i, n in s.nodes.items():
            nodes.append(dict(id=i, label=n['name'], kind='card', type=n['type'], color=n['color'], cost=n['cost'], power=n['power'], text=n['text']))
            for rel, key in (('aporta', 'give'), ('necesita', 'need'), ('responde', 'ctr'), ('flojea', 'weak')):
                for c, (w, src) in n[key].items():
                    if rel == 'flojea' and w < 2:
                        continue
                    edges.append(dict(s=i, t='C:' + c, rel=rel, w=w, src=src))
        for a, b, x, z in s.m.get('combos', []):
            if a in s.nodes and b in s.nodes:
                edges.append(dict(s=a, t=b, rel='combo', w=round(x, 3), src='MEDIDO'))
        return dict(schema_version=1, nodes=nodes, edges=edges, decks=[dict(name=d['name'], cards=sorted(set(d['deck']) | set(d['legs']))) for d in decks])
