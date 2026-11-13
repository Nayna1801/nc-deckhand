"""Comandos de la red de cartas y del razonamiento de deckforge: graph, reason, learn y trios."""
import json
import math
import random
import re
import time
from collections import Counter
from multiprocessing import Pool

import cardgraph as CG
import graph_html as GH
import net_model as NM
import reason as RS
import explain as XP
from deckio import BY, HERE, OUT, ids_of, load_deck, save_deck
from forge_basic import deck_report
from forge_search import _field_many, _print_cards, norm_keep
from forge_sim import load_field


def _all_decks():
    out = []
    for folder in (HERE / 'meta', HERE / 'decks'):
        out += load_field(folder)
    return out


def _graph_export(G, a):
    OUT.mkdir(exist_ok=True)
    data = G.to_json(_all_decks())
    json.dump(data, open(OUT / 'graph.json', 'w', encoding='utf8'), ensure_ascii=False)
    open(OUT / 'graph.html', 'w', encoding='utf8').write(GH.render(data))
    open(OUT / 'GRAPH_REPORT.md', 'w', encoding='utf8').write(G.report())
    print(f"{len(data['nodes'])} nodos y {len(data['edges'])} uniones.")
    print(f"  {OUT / 'graph.html'}   (ábrelo en el navegador)")
    print(f"  {OUT / 'GRAPH_REPORT.md'}")
    print(f"  {OUT / 'graph.json'}")
    return 0


def _graph_card(G, a):
    pool = None
    if a.legends:
        pool = set(G.legal_for(a.legends)) | set(a.legends)
    print(G.explain_card(G.find(' '.join(a.args)), pool))
    return 0


def _graph_path(G, a):
    if len(a.args) != 2:
        print('Uso: graph path "Carta A" "Carta B"')
        return 2
    x, y = G.find(a.args[0]), G.find(a.args[1])
    p = G.path(x, y)
    if p is None:
        print(f'No hay cadena de «aporta lo que necesita» entre {G.nm(x)} y {G.nm(y)}.')
        return 1
    print(' -> '.join(G.nm(n) if n in G.nodes else f'[{CG.CONCEPTS[n]}]' for n in p))
    return 0


def _graph_deck(G, a):
    d = load_deck(a.args[0])
    print(G.explain_deck(d['name'], d['legends'], ids_of(d['main']), _field_many(a.field)))
    return 0


def _graph_build(G, a):
    legs = [G.find(x) for x in a.legends or []]
    if len(legs) != 3:
        print('Uso: graph build --legends L1 L2 L3 [--core carta ...] [--out mazo.json]')
        return 2
    core = [G.find(x) for x in a.core or []]
    deck = G.build(legs, core)
    name = a.name or 'red ' + ' + '.join(BY[l]['name'].split(':')[0] for l in legs)
    d = dict(name=name, legends=legs, main=dict(Counter(deck)), side={})
    errs, _ = deck_report(d)
    out = a.out or (OUT / (re.sub(r'[^a-z0-9]+', '_', norm_keep(name)) + '.json'))
    save_deck(d, out)
    print(f"Mazo montado siguiendo la red ({'LEGAL' if not errs else errs}) -> {out}")
    _print_cards(d)
    print(f"\nAhora mídelo: forge.py explain {out}    y afínalo: forge.py optimize --legends {' '.join(legs)} --start {out}")
    return 0


def _measure_pairs(tot, min_games=80, z=3.0):
    """Parejas de cartas que rinden claramente más (combos) o menos (anti) juntas que por separado."""
    combos, anti = [], []
    for (x, y), n11 in tot.pair_n.items():
        w11 = tot.pair_w[(x, y)]
        n10, w10 = tot.dn[x] - n11, tot.dw[x] - w11
        n01, w01 = tot.dn[y] - n11, tot.dw[y] - w11
        n00, w00 = tot.n - n11 - n10 - n01, tot.w - w11 - w10 - w01
        if min(n11, n10, n01, n00) < min_games:
            continue
        v = w11 / n11 - w10 / n10 - w01 / n01 + w00 / n00
        se = math.sqrt(sum(XP._se(w / n, n) ** 2 for w, n in ((w11, n11), (w10, n10), (w01, n01), (w00, n00))))
        if v / se > z:
            combos.append((x, y, round(v, 3), round(v / se, 1)))
        elif v / se < -z:
            anti.append((x, y, round(v, 3), round(v / se, 1)))
    return combos, anti


def _measure_hurts(deck_name, accs, field):
    """Cartas rivales que hunden al mazo `deck_name` cuando las juegan (hasta 3 por rival)."""
    hurts = []
    for acc, f in zip(accs, field):
        rows = []
        for i, n1 in acc.on.items():
            n0 = acc.n - n1
            if n1 < 60 or n0 < 60:
                continue
            dv = acc.ow[i] / n1 - (acc.w - acc.ow[i]) / n0
            se = math.sqrt(XP._se(acc.ow[i] / n1, n1) ** 2 + XP._se((acc.w - acc.ow[i]) / n0, n0) ** 2)
            if dv < -2.5 * se:
                rows.append((dv, i))
        for dv, i in sorted(rows)[:3]:
            hurts.append((deck_name, f['name'], i, round(dv, 3)))
    return hurts


def _graph_measure(G, a):
    decks = _all_decks()
    field = _field_many(a.field)
    combos, anti, hurts = [], [], []
    t0 = time.time()
    for d in decks:
        accs = XP.run(d['deck'], d['legs'], field, a.games, 7, a.procs)
        tot = XP.Acc()
        for acc in accs:
            tot.merge(acc)
        c, an = _measure_pairs(tot)
        combos += c
        anti += an
        hurts += _measure_hurts(d['name'], accs, field)
        print(f"  {d['name'][:50]:50s} {tot.w / tot.n:.0%}  [{time.time() - t0:.0f}s]")
    CG.MEASURED.parent.mkdir(exist_ok=True)
    json.dump(dict(combos=combos, anti=anti, hurts=hurts, games=a.games), open(CG.MEASURED, 'w', encoding='utf8'), ensure_ascii=False)
    print(f"{len(combos)} parejas que rinden más juntas, {len(anti)} que rinden menos y {len(hurts)} cartas rivales que hunden a algún mazo -> {CG.MEASURED}")
    return 0


_GRAPH_ACTIONS = {'export': _graph_export, 'card': _graph_card, 'path': _graph_path, 'deck': _graph_deck,
                  'build': _graph_build, 'measure': _graph_measure}


def cmd_graph(a):
    """Red de cartas: nodos con su lógica, unidos por conceptos. Sirve para razonar sobre cartas y mazos."""
    action = _GRAPH_ACTIONS.get(a.action)
    if action is None:
        return 2
    return action(CG.Graph(), a)


def cmd_reason(a):
    """Construye un mazo razonando de arriba abajo: plan -> paquetes -> tempo/valor -> prueba contra el meta."""
    G = CG.Graph()
    legs = [G.find(x) for x in a.legends] if a.legends else None
    if legs and (len(legs) != 3 or len({BY[l]['name'] for l in legs}) != 3):
        print('Hacen falta 3 Legends de nombre distinto.')
        return 2
    if a.plan and a.plan not in RS.PLANS:
        print('Planes disponibles: ' + ', '.join(f"{k} ({v['name']})" for k, v in RS.PLANS.items()))
        return 2
    t0 = time.time()
    plan, legs, manifest = RS.strategist(G, legs, a.plan)
    core = [G.find(x) for x in a.core or []]
    import learn as LN
    measured = LN.LEARNED.exists() and not a.heuristic
    if measured:
        M = LN.Model(G)
        deck, why, pkg, pred = RS.assemble_measured(M, plan, legs)
        print(f"[Ensamblado con valores MEDIDOS en {M.info['games']} partidas de {M.info['decks']} mazos al azar; predicción {pred:+.1f} puntos sobre un mazo medio]\n")
    else:
        deck, why, pkg = RS.assemble(G, plan, legs, core)
    an = RS.analyst(G, plan, legs, deck, why)
    field = _field_many(a.field)
    res, story, side = RS.meta_analyst(G, plan, legs, deck, why, field, games=a.games)
    pol = None
    if a.polish:
        pol = RS.polish(G, legs, deck, why, field, iters=a.polish)
        res = {f['name']: RS.winrate(list(deck.elements()), legs, f, a.games) for f in field}
    print(RS.render(G, manifest, legs, deck, why, pkg, an, res, story, side))
    if pol:
        st, be, ins, outs = pol
        print(f"\n6) PULIDO CON PARTIDAS ({a.polish} cambios probados): {st:.0%} -> {be:.0%} al afinar")
        print('   entran: ' + ('; '.join(f"{n}x {G.nm(i)}" for i, n in ins.items()) or 'nada'))
        print('   salen:  ' + ('; '.join(f"{n}x {G.nm(i)}" for i, n in outs.items()) or 'nada'))
        print('   (la lista y el resultado final de arriba ya incluyen estos cambios)')
    name = a.name or f"{manifest['name']}: " + ' + '.join(BY[l]['name'].split(':')[0] for l in legs)
    d = dict(name=name, legends=legs, main=dict(deck), side=dict(side), plan=plan, win_condition=manifest['win_condition'])
    errs, _ = deck_report(d)
    out = a.out or (OUT / (re.sub(r'[^a-z0-9]+', '_', norm_keep(name)) + '.json'))
    save_deck(d, out)
    print(f"\n{'LEGAL' if not errs else 'ILEGAL: ' + str(errs)} · guardado en {out}  [{time.time() - t0:.0f}s]")
    print(f"Siguiente paso: forge.py explain {out}   (con previsión)   ·   forge.py optimize --legends {' '.join(legs)} --start {out}")
    return 0


def _learn_summary(M, top=12):
    G = M.G
    rows = {'card': [], 'pay': [], 'ena': [], 'leg': [], 'shape': []}
    for key, b, se, u in zip(M.F.names, M.beta, M.se, M.used):
        rows[key[0]].append((b, se, u, key))
    sig = lambda r: abs(r[0]) > 2 * r[1]
    print(f"\nCartas que más suman por sí solas (puntos de % por juego de 3 copias):")
    for b, se, u, key in sorted(rows['card'], reverse=True)[:top]:
        print(f"   {b:+5.1f} (±{2 * se:.1f})  {G.nm(key[1])}")
    print('Cartas que más restan por sí solas:')
    for b, se, u, key in sorted(rows['card'])[:top]:
        print(f"   {b:+5.1f} (±{2 * se:.1f})  {G.nm(key[1])}")
    print(f"\nCartas que más SUBEN cuando el mazo les da lo que piden (lo que cobran):")
    for b, se, u, key in sorted([r for r in rows['pay'] if sig(r)], reverse=True)[:top]:
        print(f"   {b:+5.1f} (±{2 * se:.1f})  {G.nm(key[1])}  con «{CG.CONCEPTS[key[2]]}»")
    print('Uniones que la red dibuja pero las partidas NO respaldan (cobrar no compensa):')
    for b, se, u, key in sorted([r for r in rows['pay'] if sig(r) and r[0] < 0])[:8]:
        print(f"   {b:+5.1f} (±{2 * se:.1f})  {G.nm(key[1])}  con «{CG.CONCEPTS[key[2]]}»")
    print(f"\nMejores habilitadores (lo que suman cuando hay quien lo aproveche):")
    for b, se, u, key in sorted([r for r in rows['ena'] if sig(r)], reverse=True)[:top]:
        print(f"   {b:+5.1f} (±{2 * se:.1f})  {G.nm(key[1])}  dando «{CG.CONCEPTS[key[2]]}»")
    print(f"\nForma del mazo: " + ' · '.join(f"{key[1]} {b:+.1f}" for b, se, u, key in rows['shape']))


def cmd_learn(a):
    """Mide el valor de cada carta y de cada unión de la red con miles de mazos al azar."""
    import learn as LN
    if a.show:
        _learn_summary(LN.Model())
        return 0
    F = LN.Featurizer()
    meta = _field_many(a.field)
    t0 = time.time()
    print(f"{len(F.names)} variables ({len(F.cards)} cartas, {len(F.legs)} Legends, {sum(len(v) for v in F.pay.values())} «cobra con», {sum(len(v) for v in F.ena.values())} «habilita»).")
    print(f"Jugando {a.decks} mazos al azar: {a.meta_games} partidas contra cada uno de los {len(meta)} mazos del meta y {a.pair_games} contra otro mazo al azar...")
    decks, rows = LN.sample(F, a.decks, meta, g_meta=a.meta_games, g_pair=a.pair_games, seed=a.seed, procs=a.procs,
                            progress=lambda d, n: print(f"   {d}/{n} mazos  [{time.time() - t0:.0f}s]", flush=True))
    beta, se, used, mb, r2 = LN.fit(F, decks, rows, len(meta))
    games = len(decks) * (len(meta) * a.meta_games) + len(decks) // 2 * a.pair_games
    LN.save(F, beta, se, used, mb, r2, dict(decks=len(decks), games=games, seed=a.seed))
    print(f"Ajustado con {games} partidas en {time.time() - t0:.0f}s (R² {r2:.2f}) -> {LN.LEARNED}")
    _learn_summary(LN.Model())
    return 0


def _trio_work(t):
    best = None
    for seed in range(2):
        deck, s = NM.optimize(list(t), iters=350, seed=seed)
        if best is None or s > best[1]:
            best = (dict(deck), s)
    return t, best[1], best[0]


def cmd_trios(a):
    import itertools
    legs = [i for i in NM.LEGENDS]
    trios = [t for t in itertools.combinations(legs, 3) if len({BY[x]['name'] for x in t}) == 3]
    if a.limit:
        random.Random(1).shuffle(trios)
        trios = trios[:a.limit]
    print(f'{len(trios)} ternas de Legends legales (nombres únicos)...')
    t0 = time.time()
    with Pool(a.procs) as p:
        res = p.map(_trio_work, trios, chunksize=20)
    res.sort(key=lambda r: -r[1])
    OUT.mkdir(exist_ok=True)
    with open(OUT / 'trios.json', 'w', encoding='utf8') as fh:
        json.dump([dict(legs=list(t), score=sc, deck=dk) for t, sc, dk in res], fh, ensure_ascii=False)
    for t, s, d in res[:a.top]:
        print(f"{s:6.1f}  " + ' + '.join(BY[x]['displayName'] + f"({BY[x]['color'][0]})" for x in t))
    print(f"[{time.time() - t0:.0f}s]  Lista completa en {OUT / 'trios.json'}. La red solo es un filtro: valida los mejores con 'gauntlet'/'optimize'.")
    return 0
