"""Construcción de mazos por RAZONAMIENTO, como lo haría un jugador: de arriba abajo.

  1. Estratega      fija el plan y la condición de victoria ANTES de mirar cartas sueltas.
  2. Ensamblador    instala paquetes (cartas que cobran + cartas que habilitan) y cubre funciones; ninguna carta entra sin motivo
                    y ninguna «cobra» si antes no están sus habilitadores.
  3. Analista       mide tempo y valor y los compara con lo que el plan necesita.
  4. Analista de metajuego  enfrenta el mazo a los rivales (partidas simuladas, no mentales), localiza a su depredador,
                    explica por qué pierde con la red de cartas y prueba cartas de respuesta (tech cards).

La red (cardgraph.py) da el «qué habla con qué»; el simulador (engine2.py) hace de prueba de estrés.
"""
from collections import Counter, defaultdict

import cardgraph as CG
import cardsdb as DB
import engine2 as X
import net_model as NM

BY = DB.BY
FREE = {'PROG', 'TRASHP', 'TRASHU', 'BLUE', 'CORPO_GANGER', 'ROCKER'}     # conceptos que el mazo genera solo por llevar ese tipo de carta

# Cada plan: condición de victoria, conceptos que lo mueven (peso) y lo que debe llevar para no caerse.
PLANS = {
    'control_dados': dict(
        name='Control por dados', kind='control',
        win="Sobrevivir los primeros turnos con eliminación barata, colocar los dados ({legs}) para robar cartas de más y abaratar "
            "los Programas, y ganar la carrera de Gigs al final con las pocas Unidades que queden en mesa cuando el rival ya no tenga.",
        concepts={'PAIR': 3, 'MIN': 3, 'LOWCRED': 2, 'PROG': 1.5, 'TRASHP': 1},
        quota=dict(units=(10, 15), removal=9, defense=4, value=10, early=8), tech=('vs_ATK', 'vs_GS')),
    'tempo_gosolo': dict(
        name='Tempo con Go Solo', kind='aggro',
        win="Poner poder en mesa cada turno, atacar el turno que entra con Adrenaline y con el Go Solo de {legs}, y llegar al "
            "7.º turno con Gigs de ventaja; la eliminación solo se usa para quitar Blockers o la Unidad que frena la carrera.",
        concepts={'TEMPO': 3, 'GS': 2.5, 'P10': 1.5, 'SPENT': 1},
        quota=dict(units=(20, 24), removal=7, defense=3, value=3, early=10), tech=('vs_BLOCK', 'vs_SMALL')),
    'gear_poder10': dict(
        name='Gear hasta poder 10', kind='midrange',
        win="Bajar Unidades medianas y equiparlas ({legs}) para atacar con 10 o más de poder y robar 2 Gigs por ataque; "
            "el Gear barato sale gratis o con descuento y también gana las peleas al bloquear.",
        concepts={'GEAR': 3, 'P10': 3, 'CARDS': 1},
        quota=dict(units=(15, 19), removal=4, defense=4, value=5, early=10), tech=('vs_GEAR', 'vs_TRASH')),
    'cuerpos_basura': dict(
        name='Cuerpos grandes y basura', kind='midrange',
        win="Vender cartas los primeros turnos, llenar la basura y los Gigs altos, y desde el turno 4 bajar cuerpos de 8-10 de poder "
            "con descuento o gratis ({legs}); cada cuerpo grande roba un Gig por turno y la eliminación limpia a los Blockers.",
        concepts={'TRASHU': 2.5, 'G8': 2.5, 'P10': 2, 'HIGHCRED': 1, 'GS': 1},
        quota=dict(units=(14, 18), removal=8, defense=3, value=4, early=8), tech=('vs_TRASH', 'vs_GS')),
    'gastar_y_castigar': dict(
        name='Gastar y castigar', kind='midrange',
        win="Gastar o hacer atacar a las Unidades rivales y derrotarlas mientras están gastadas ({legs}); con la mesa rival vacía, "
            "cualquier Unidad propia roba Gigs sin oposición.",
        concepts={'SPENT': 3, 'TEMPO': 1.5, 'LEGUP': 1, 'P10': 1},
        quota=dict(units=(17, 22), removal=9, defense=4, value=4, early=9), tech=('vs_ATK', 'vs_GS')),
    'braindance': dict(
        name='Motor de Braindance', kind='control',
        win="Encadenar Braindances ({legs}) para robar y rejugar Programas, eliminar con ellos y cerrar con Unidades grandes "
            "jugadas gratis o con descuento.",
        concepts={'BD': 3, 'PROG': 2, 'TRASHP': 2, 'MIN': 2},
        quota=dict(units=(14, 19), removal=9, defense=5, value=8, early=8), tech=('vs_ATK', 'vs_GS')),
}
PREDATOR = {'aggro': 'midrange', 'midrange': 'control', 'control': 'aggro'}
KIND_ES = {'aggro': 'agresivo (tempo)', 'midrange': 'medio', 'control': 'control (valor)'}


# ----------------------------------------------------------------------------- lectura de una carta
def quality(i):
    """Valor base de la carta, penalizando el coste alto (las cartas caras llegan tarde y atascan la mano)."""
    v = NM.NODE[i]['v'] if i in NM.NODE else 2.0
    return v - 0.45 * max(0, (BY[i]['cost'] or 0) - 4)


def is_removal(n):
    return any(c in n['ctr'] and n['ctr'][c][0] >= 2 for c in ('vs_SMALL', 'vs_BIG'))


def is_defense(n):
    return 'BLOCK' in n['give'] or ('vs_ATK' in n['ctr'] and n['ctr']['vs_ATK'][0] >= 2)


def is_value(n):
    """Genera recursos: roba de verdad o elimina varias cartas con una."""
    draws = 'CARDS' in n['give'] and n['give']['CARDS'][0] >= 2 and 'If your' not in n['text']
    return draws or (is_removal(n) and ('all rival' in n['text'] or 'You may defeat 2' in n['text']))


def is_early(n):
    """Jugada de tempo temprana: Unidad barata con cuerpo o Blocker, o Gear barato."""
    if n['type'] == 'Unit':
        return n['cost'] <= 4 and (n['power'] >= 3 or 'BLOCK' in n['give'])
    return n['type'] == 'Gear' and n['cost'] <= 2


def tempo_value(G, main):
    """(jugadas de tempo temprano, cartas de valor, poder medio por Eddie de las Unidades)."""
    early = sum(1 for i in main if is_early(G.nodes[i]))
    value = sum(1 for i in main if is_value(G.nodes[i]))
    us = [G.nodes[i] for i in main if G.nodes[i]['type'] == 'Unit' and G.nodes[i]['cost']]
    eff = sum(n['power'] for n in us) / max(1, sum(n['cost'] for n in us))
    return early, value, eff


def classify(G, main):
    early, value, eff = tempo_value(G, main)
    units = sum(1 for i in main if G.nodes[i]['type'] == 'Unit')
    if units >= 20 and value <= 8:
        return 'aggro'
    if units <= 15 or value >= 14:
        return 'control'
    return 'midrange'


def copies(n):
    return 3 if n['cost'] <= 5 else (2 if n['cost'] <= 7 else 1)


# ----------------------------------------------------------------------------- 1) Estratega
def plan_affinity(G, plan, legs):
    P = PLANS[plan]['concepts']
    sc = 0.0
    for l in legs:
        n = G.nodes[l]
        for c, w in P.items():
            if c in n['need']:
                sc += 2.0 * w
            if c in n['give']:
                sc += 1.5 * w
    pool = G.legal_for(legs)
    for c, w in P.items():
        if c in FREE:
            continue
        pay = sum(1 for i in pool if c in G.nodes[i]['need'] and G.nodes[i]['need'][c][0] >= 2)
        en = sum(1 for i in pool if c in G.nodes[i]['give'] and G.nodes[i]['give'][c][0] >= 2)
        sc += 0.4 * w * min(4, pay) + 0.3 * w * min(5, en)
    return sc


def strategist(G, legs=None, plan=None):
    """Devuelve (plan, Legends, manifiesto). Si faltan Legends, elige la terna que mejor sirve al plan."""
    import search as SR
    if legs and not plan:
        plan = max(PLANS, key=lambda p: plan_affinity(G, p, legs))
    elif plan and not legs:
        legs = list(max(SR.all_trios(), key=lambda t: plan_affinity(G, plan, t)))
    elif not plan and not legs:
        raise SystemExit('Indica al menos un plan (--plan) o tres Legends (--legends).')
    P = PLANS[plan]
    names = ', '.join(BY[l]['displayName'].split(':')[0] for l in legs)
    alt = sorted(((plan_affinity(G, p, legs), p) for p in PLANS), reverse=True)
    return plan, list(legs), dict(plan=plan, name=P['name'], kind=P['kind'], win_condition=P['win'].format(legs=names),
                                  ranking=[(PLANS[p]['name'], round(a, 1)) for a, p in alt])


# ----------------------------------------------------------------------------- 2) Ensamblador
class _Builder:
    """Estado del montaje de un mazo por razonamiento: las cartas elegidas, por qué y qué paquetes se han instalado."""

    def __init__(self, G, plan, legs):
        self.G, self.legs = G, legs
        self.P = PLANS[plan]
        self.Q = self.P['quota']
        self.pool = G.legal_for(legs)
        self.deck = Counter()
        self.why = {}
        self.log = []
        self.heavy_max = {'aggro': 9, 'midrange': 11, 'control': 12}[self.P['kind']]

    def add(self, i, n, reason):
        n = min(n, 3 - self.deck[i], 40 - sum(self.deck.values()))
        if self.G.nodes[i]['cost'] >= 5:
            n = min(n, self.heavy_max - self.heavy())
        if n > 0:
            self.deck[i] += n
            self.why.setdefault(i, reason)
        return n

    def flows(self):
        return self.G.deck_flows(self.legs, list(self.deck.elements()))

    def covered(self, i, strict=0.6):
        """¿Tiene ya el mazo lo que esta carta necesita de verdad?"""
        _, sup, dem, _, _ = self.flows()
        for c, (w, _) in self.G.nodes[i]['need'].items():
            if w >= 2 and c not in FREE and min(1.5, sup[c] / (1.2 * (dem[c] + w * copies(self.G.nodes[i])))) < strict:
                return False
        return True

    def heavy(self):
        return sum(k for i, k in self.deck.items() if self.G.nodes[i]['cost'] >= 5)

    def nunits(self):
        return sum(k for i, k in self.deck.items() if self.G.nodes[i]['type'] == 'Unit')

    def plan_fit(self, i):
        n = self.G.nodes[i]
        return quality(i) + 1.2 * sum(w for c, w in self.P['concepts'].items() if c in n['give'] or c in n['need']) + (1.0 if is_defense(n) else 0.0)

    def affinity(self, i):
        n = self.G.nodes[i]
        a = sum(w for c, w in self.P['concepts'].items() if c in n['give'] or c in n['need'])
        return quality(i) + 0.8 * a - 0.35 * max(0, n['cost'] - 5)

    def early_curve(self):
        """La curva primero: jugadas de los turnos 1-3 afines al plan (sin ellas ningún plan llega a su turno clave)."""
        G, legs = self.G, self.legs
        early_now = 0
        for i in sorted([i for i in self.pool if is_early(G.nodes[i]) and G.nodes[i]['type'] == 'Unit'], key=lambda i: -self.plan_fit(i)):
            if early_now >= self.Q['early']:
                break
            if all(w < 2 or c in FREE or any(c in G.nodes[l]['give'] for l in legs) for c, (w, _) in G.nodes[i]['need'].items()):
                early_now += self.add(i, min(3, self.Q['early'] - early_now), 'tempo: jugada de los primeros turnos')

    def install_packages(self):
        """Paquetes: primero quién habilita, luego quién cobra."""
        G, legs, pool, deck, Q = self.G, self.legs, self.pool, self.deck, self.Q
        for c, w in sorted(self.P['concepts'].items(), key=lambda t: -t[1]):
            label = CG.CONCEPTS[c]
            pay = sorted([i for i in pool if c in G.nodes[i]['need'] and G.nodes[i]['need'][c][0] >= 2], key=lambda i: -quality(i))
            ena = sorted([i for i in pool if c in G.nodes[i]['give']],
                         key=lambda i: -(G.nodes[i]['give'][c][0] * 2 + quality(i) + (3 if i in pay else 0) - 0.5 * G.nodes[i]['cost']))
            leg_pay = [l for l in legs if c in G.nodes[l]['need']]
            leg_ena = [l for l in legs if c in G.nodes[l]['give']]
            if not pay and not leg_pay:
                continue
            n_pay = max(1, round(w)) if c not in FREE else max(1, round(w))
            chosen_pay = [i for i in pay if i not in deck][:n_pay + 1]
            chosen_ena = []
            if c not in FREE:
                for i in ena:
                    if len(chosen_ena) >= 4:
                        break
                    if sum(deck.values()) >= 30:
                        break
                    if G.nodes[i]['type'] == 'Unit' and self.nunits() >= Q['units'][1]:
                        continue
                    if self.add(i, copies(G.nodes[i]), f"habilita «{label}»"):
                        chosen_ena.append(i)
                    _, sup, dem, _, _ = self.flows()
                    need_w = sum(2 * copies(G.nodes[j]) for j in chosen_pay) + 4 * len(leg_pay)
                    if sup[c] >= 1.1 * need_w:
                        break
            installed = []
            for i in chosen_pay:
                if sum(deck.values()) >= 34:
                    break
                if G.nodes[i]['type'] == 'Unit' and self.nunits() >= Q['units'][1]:
                    continue
                if self.covered(i):
                    if self.add(i, copies(G.nodes[i]), f"cobra con «{label}»"):
                        installed.append(i)
            self.log.append(dict(concept=label, legends=[G.nm(l) for l in leg_pay + leg_ena], payoffs=[G.nm(i) for i in installed],
                                 enablers=[G.nm(i) for i in chosen_ena], skipped=[G.nm(i) for i in chosen_pay if i not in installed]))

    def fill(self, test, target, reason):
        """Funciones que el plan exige (eliminación, defensa, valor, tempo): sube hasta `target` copias de ese tipo."""
        G, deck, Q = self.G, self.deck, self.Q
        have = sum(k for i, k in deck.items() if test(G.nodes[i]))
        for i in sorted([i for i in self.pool if test(G.nodes[i]) and deck[i] < 3], key=lambda i: -self.affinity(i)):
            if have >= target or sum(deck.values()) >= 40:
                break
            n = G.nodes[i]
            if n['type'] == 'Unit' and self.nunits() >= Q['units'][1]:
                continue
            if not self.covered(i):
                continue
            have += self.add(i, min(copies(n), target - have), reason)

    def complete(self):
        """Completar hasta 40 con lo que mejor sirva al plan, respetando Unidades y vendibles."""
        G, deck, Q = self.G, self.deck, self.Q
        while sum(deck.values()) < 40:
            nu = self.nunits()
            need_units = nu < Q['units'][0]
            cands = [i for i in self.pool if deck[i] < 3 and self.covered(i)
                     and ((G.nodes[i]['type'] == 'Unit') == need_units or (not need_units and nu < Q['units'][1]))]
            if not need_units and nu >= Q['units'][1]:
                cands = [i for i in cands if G.nodes[i]['type'] != 'Unit']
            if not cands:
                break
            i = max(cands, key=lambda i: self.affinity(i) - 0.6 * deck[i])
            self.add(i, 1, 'relleno afín al plan' if any(c in G.nodes[i]['give'] or c in G.nodes[i]['need'] for c in self.P['concepts']) else 'cuerpo eficiente')


def assemble(G, plan, legs, core=()):
    b = _Builder(G, plan, legs)
    for i in core:
        b.add(i, 3, 'carta núcleo pedida')
    b.early_curve()
    b.install_packages()
    b.fill(is_removal, b.Q['removal'], 'eliminación: protege el plan')
    b.fill(is_defense, b.Q['defense'], 'defensa: frena los robos de Gig')
    b.fill(is_value, b.Q['value'], 'valor: repone cartas')
    b.fill(is_early, b.Q['early'], 'tempo: jugada de los primeros turnos')
    b.complete()
    return b.deck, b.why, b.log


# ----------------------------------------------------------------------------- 3) Analista
def analyst(G, plan, legs, deck, why):
    """Compara tempo y valor con lo que pide el plan y corrige cambiando el relleno."""
    P = PLANS[plan]
    Q = P['quota']
    notes = []
    pool = G.legal_for(legs)
    for _ in range(6):
        main = list(deck.elements())
        early, value, eff = tempo_value(G, main)
        want_value, want_early = Q['value'], Q['early']
        filler = sorted([i for i in deck if why.get(i, '').startswith(('relleno', 'cuerpo'))], key=quality)
        if not filler:
            break
        if value < want_value:
            test, label = is_value, 'valor'
        elif early < want_early:
            test, label = is_early, 'tempo temprano'
        else:
            break
        out = next((i for i in filler if not test(G.nodes[i])), None)
        cands = [i for i in pool if test(G.nodes[i]) and deck[i] < 3 and G.nodes[i]['type'] == G.nodes[out]['type']] if out else []
        if not out or not cands:
            notes.append(f"Falta {label} y no queda relleno del mismo tipo que cambiar.")
            break
        new = max(cands, key=quality)
        deck[out] -= 1
        if deck[out] == 0:
            del deck[out]
        deck[new] += 1
        why.setdefault(new, f"{label}: lo pidió el analista")
        notes.append(f"Falta {label}: sale 1 {G.nm(out)}, entra 1 {G.nm(new)}.")
    main = list(deck.elements())
    early, value, eff = tempo_value(G, main)
    return dict(early=early, value=value, eff=eff, want_early=Q['early'], want_value=Q['value'], kind=classify(G, main), notes=notes)


# ----------------------------------------------------------------------------- 4) Analista de metajuego
def winrate(ids, legs, rival, games, seed=61):
    w, _ = X.play(ids, legs, rival['deck'], rival['legs'], N=games, seed=seed)
    return w[0] / max(1, w[0] + w[1])


def why_losing(G, legs, main, rival):
    """Con la red: qué trae el rival contra nuestras debilidades y qué pide que no llevamos."""
    cnt = Counter(main)
    rc = Counter(rival['deck'])
    out = []
    need_answers = []
    for c in CG.ANSWERS:
        theirs = sum(k for i, k in rc.items() if i in G.nodes and c in G.nodes[i]['ctr'] and G.nodes[i]['ctr'][c][0] >= 2)
        ours_weak = sum(k for i, k in cnt.items() if c in G.nodes[i]['weak'] and G.nodes[i]['weak'][c][0] >= 2)
        if theirs >= 3 and ours_weak >= 6:
            out.append(f"lleva {theirs} cartas de «{CG.CONCEPTS[c]}» y {ours_weak} de las tuyas son sensibles")
        their_weak = sum(k for i, k in rc.items() if i in G.nodes and c in G.nodes[i]['weak'] and G.nodes[i]['weak'][c][0] >= 2)
        their_weak += 3 * sum(1 for l in rival['legs'] if c in G.nodes[l]['weak'])
        ours = sum(k for i, k in cnt.items() if c in G.nodes[i]['ctr'] and G.nodes[i]['ctr'][c][0] >= 2)
        if their_weak >= 8 and ours < 4:
            need_answers.append((their_weak - 2 * ours, c))
            out.append(f"{their_weak} cartas suyas son sensibles a «{CG.CONCEPTS[c]}» y solo llevas {ours}")
    return out, [c for _, c in sorted(need_answers, reverse=True)]


def meta_analyst(G, plan, legs, deck, why, field, games=200, rounds=2):
    """Prueba de estrés con partidas: localiza al depredador, razona el porqué y prueba tech cards."""
    P = PLANS[plan]
    pool = G.legal_for(legs)
    main = list(deck.elements())
    res = {f['name']: winrate(main, legs, f, games) for f in field}
    story = [dict(step='inicial', results=dict(res))]
    side = Counter()
    for _ in range(rounds):
        worst = min(field, key=lambda f: res[f['name']])
        if res[worst['name']] >= 0.48:
            break
        reasons, wanted = why_losing(G, legs, main, worst)
        wanted = wanted + [c for c in P['tech'] if c not in wanted]
        tech = []
        for c in wanted:
            for i in sorted([i for i in pool if c in G.nodes[i]['ctr'] and G.nodes[i]['ctr'][c][0] >= 2 and deck[i] + side[i] < 3], key=lambda i: -quality(i))[:2]:
                if i not in tech:
                    tech.append(i)
        step = dict(step='depredador', rival=worst['name'], before=res[worst['name']], reasons=reasons, tried=[])
        base_avg = sum(res.values()) / len(res)
        for i in tech[:5]:
            outs = sorted([j for j in deck if G.nodes[j]['type'] == G.nodes[i]['type'] or True], key=lambda j: (not why.get(j, '').startswith(('relleno', 'cuerpo', 'tempo')), quality(j)))
            out = next((j for j in outs if j != i), None)
            n = min(2, deck[out], 3 - deck[i])
            if n <= 0:
                continue
            trial = Counter(deck)
            trial[out] -= n
            trial[i] += n
            trial += Counter()
            tm = list(trial.elements())
            if sum(1 for x in tm if G.nodes[x]['type'] == 'Unit') < P['quota']['units'][0] - 1:
                continue
            w_new = winrate(tm, legs, worst, games)
            gain = w_new - res[worst['name']]
            entry = dict(card=G.nm(i), out=G.nm(out), n=n, gain=gain)
            if gain >= 0.04:
                new_res = {f['name']: winrate(tm, legs, f, games) for f in field}
                new_avg = sum(new_res.values()) / len(new_res)
                if new_avg >= base_avg - 0.005:
                    deck.clear()
                    deck.update(trial)
                    why[i] = f"tech card contra {worst['name']}"
                    res, main, base_avg = new_res, tm, new_avg
                    entry['verdict'] = 'ENTRA en el mazo (mejora el cruce sin empeorar la media)'
                else:
                    side[i] += n
                    entry['verdict'] = 'al SIDEBOARD (mejora el cruce pero empeora la media)'
            else:
                entry['verdict'] = 'descartada (no mejora el cruce)'
            step['tried'].append(entry)
        step['after'] = res[worst['name']]
        story.append(step)
    while sum(side.values()) > 7:
        i = min(side, key=quality)
        side[i] -= 1
        side += Counter()
    return res, story, side


# ----------------------------------------------------------------------------- informe
def render(G, manifest, legs, deck, why, pkg_log, an, res, story, side):
    L = [f"=== {manifest['name']}: {' + '.join(BY[l]['displayName'] for l in legs)} ===", '',
         '1) ESTRATEGA — condición de victoria', f"   {manifest['win_condition']}",
         f"   Tipo de mazo: {KIND_ES[manifest['kind']]}. Su depredador natural es un mazo {KIND_ES[PREDATOR[manifest['kind']]]}.",
         '   Planes que encajan con estas Legends: ' + '; '.join(f"{n} ({a})" for n, a in manifest['ranking'][:4]), '',
         '2) ENSAMBLADOR — paquetes instalados (quien habilita entra antes que quien cobra)']
    for p in pkg_log:
        L.append(f"   «{p['concept']}»" + (f"  [Legends: {', '.join(p['legends'])}]" if p['legends'] else ''))
        L.append(f"        habilitan: {', '.join(p['enablers']) or 'lo da el propio tipo de carta o las Legends'}")
        L.append(f"        cobran:    {', '.join(p['payoffs']) or 'solo las Legends'}")
        if p['skipped']:
            L.append(f"        NO entran (sin habilitadores suficientes o sin hueco): {', '.join(p['skipped'])}")
    L += ['', '3) LISTA — cada carta con su motivo']
    for t in ('Unit', 'Gear', 'Program'):
        rows = sorted([(G.nodes[i]['cost'], G.nm(i), n, why.get(i, '')) for i, n in deck.items() if G.nodes[i]['type'] == t])
        if rows:
            L.append(f"   {t} ({sum(r[2] for r in rows)}):")
            for c, name, n, w in rows:
                L.append(f"      {n}x {name} (c{c}) — {w}")
    L += ['', '4) ANALISTA — tempo y valor',
          f"   Jugadas de tempo temprano: {an['early']} (el plan pide {an['want_early']}) · cartas de valor: {an['value']} (pide {an['want_value']}) · "
          f"poder por Eddie de las Unidades: {an['eff']:.2f}",
          f"   Por su composición se comporta como un mazo {KIND_ES[an['kind']]}."]
    for n in an['notes']:
        L.append('   ' + n)
    L += ['', '5) ANALISTA DE METAJUEGO — prueba de estrés con partidas simuladas']
    for s in story:
        if s['step'] == 'inicial':
            L.append('   Antes de tocar nada: ' + ' · '.join(f"{n.replace('Meta · ', '')} {v:.0%}" for n, v in s['results'].items()))
        else:
            L.append(f"   Depredador: {s['rival']} ({s['before']:.0%})")
            for r in s['reasons'] or ['la red no ve un motivo claro en las cartas: es cuestión de ritmo']:
                L.append(f"        porque {r}")
            for e in s['tried']:
                L.append(f"        prueba: +{e['n']} {e['card']} / -{e['n']} {e['out']}  ->  {e['gain']:+.0%} en el cruce: {e['verdict']}")
            L.append(f"        el cruce queda en {s['after']:.0%}")
    L.append('   Resultado final: ' + ' · '.join(f"{n.replace('Meta · ', '')} {v:.0%}" for n, v in res.items()) + f"  (media {sum(res.values()) / len(res):.1%})")
    if side:
        L.append('   Sideboard (tech cards que ayudan en un cruce pero no en la media): ' + '; '.join(f"{n}x {G.nm(i)}" for i, n in side.items()))
    return '\n'.join(L)


# ----------------------------------------------------------------------------- 5) pulido con partidas
def polish(G, legs, deck, why, field, iters=80, games=40, seed=5):
    """Búsqueda local corta desde el mazo razonado. Devuelve los cambios aceptados: enseñan dónde falló el razonamiento."""
    import random
    import search as SR
    rng = random.Random(seed)
    pool = SR.allowed(legs)
    cur = list(deck.elements())
    s_ = 900 + seed
    best = SR.fit(cur, legs, field, games, s_)
    start = best
    for it in range(1, iters + 1):
        if it % 25 == 0:
            s_ += 1
            best = SR.fit(cur, legs, field, games, s_)
        cnt = Counter(cur)
        new = list(cur)
        out = new.pop(rng.randrange(len(new)))
        cand = [c for c in pool if c != out and cnt[c] < 3]
        new.append(rng.choice(cand))
        units = sum(1 for i in new if BY[i]['type'] == 'Unit')
        if not 10 <= units <= 28:
            continue
        f = SR.fit(new, legs, field, games, s_)
        if f > best + 0.006:
            best, cur = f, new
    before, after = Counter(deck.elements()), Counter(cur)
    ins, outs = after - before, before - after
    for i in ins:
        why[i] = 'lo añadió el pulido con partidas'
    deck.clear()
    deck.update(after)
    return start, best, ins, outs


# ----------------------------------------------------------------------------- ensamblador con valores MEDIDOS
def assemble_measured(M, plan, legs):
    """Monta el mazo con el modelo medido (learn.py): cada carta vale su base + lo que cobra con lo que el mazo le da
    + lo que habilita a las demás. Devuelve (mazo, motivos, paquetes, predicción)."""
    G = M.G
    deck, pred = M.build(legs)
    bd = M.breakdown(legs, deck)
    why = {}
    for i in deck:
        tot, base, pay, ena = bd[i]
        parts = [f"sola {base:+.1f}"]
        for c, (p, cov) in sorted(pay.items(), key=lambda t: -abs(t[1][0])):
            if abs(p) >= 0.3:
                parts.append(f"cobra con «{CG.CONCEPTS[c]}» {p:+.1f} (cubierto al {min(1.0, cov):.0%})")
        for c, p in sorted(ena.items(), key=lambda t: -abs(t[1])):
            if abs(p) >= 0.3:
                parts.append(f"habilita «{CG.CONCEPTS[c]}» {p:+.1f}")
        why[i] = f"{tot:+.1f} pts: " + '; '.join(parts)
    pk = defaultdict(lambda: dict(payoffs=[], enablers=[], legends=[]))
    for i in list(deck) + list(legs):
        tot, base, pay, ena = bd[i]
        is_leg = G.nodes[i]['type'] == 'Legend'
        for c, (p, cov) in pay.items():
            if p >= 0.3:
                (pk[c]['legends'] if is_leg else pk[c]['payoffs']).append(G.nm(i))
        for c, p in ena.items():
            if p >= 0.3:
                (pk[c]['legends'] if is_leg else pk[c]['enablers']).append(G.nm(i))
    log = [dict(concept=CG.CONCEPTS[c], legends=v['legends'], payoffs=v['payoffs'], enablers=v['enablers'], skipped=[])
           for c, v in sorted(pk.items(), key=lambda t: -(len(t[1]['payoffs']) + len(t[1]['enablers'])))]
    return deck, why, log, pred
