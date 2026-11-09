#!/usr/bin/env python
"""deckforge: herramienta para analizar, optimizar y comparar mazos del Cyberpunk TCG.

Árbitro (reglas) + red de sinergias + simulador de partidas + optimizador. Solo biblioteca estándar.
Uso:  python tools/deckforge/forge.py <comando> --help      (README.md explica el flujo completo)
"""
import argparse
import json
import math
import os
import random
import re
import sys
import time
import unicodedata
from collections import Counter, defaultdict
from multiprocessing import Pool
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

import cardsdb as DB          # noqa: E402  (catálogo + reglas de construcción)
import net_model as NM        # noqa: E402  (red de sinergias)
import engine_x as X          # noqa: E402  (simulador de partidas)

BY = DB.BY
OUT = HERE / 'out'
DEFAULT_FIELD = HERE / 'data' / 'field_default.json'
DEFAULT_PROCS = 4             # conservador: el simulador no necesita más y no ahoga el equipo


# ----------------------------------------------------------------------------- mazos
def norm(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]+', '', s.lower())


NAME2ID = {}
for _c in DB.RAW:
    NAME2ID.setdefault(norm(_c['displayName']), _c['id'])


def load_deck(path):
    d = json.load(open(path, encoding='utf8'))
    d.setdefault('name', Path(path).stem)
    d.setdefault('side', {})
    return d


def save_deck(d, path):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    json.dump(d, open(path, 'w', encoding='utf8'), ensure_ascii=False, indent=1)


def ids_of(counter_like):
    return [i for i, n in counter_like.items() for _ in range(n)]


def rows_of(ids):
    return [(n, i) for i, n in Counter(ids).items()]


def deck_to_text(d):
    lines = [f"# Name: {d.get('name', 'Mazo')}", '', '# Legends']
    for l in d['legends']:
        c = BY[l]
        lines.append(f"1x {c['importId']} {c['displayName']}".replace('1x  ', '1x '))
    lines += ['', '# Main Deck']
    for i, n in sorted(d['main'].items(), key=lambda t: BY[t[0]]['displayName'].lower()):
        c = BY[i]
        lines.append(f"{n}x {c['importId']} {c['displayName']}".replace('x  ', 'x '))
    if d.get('side'):
        lines += ['', '# Sideboard']
        for i, n in sorted(d['side'].items(), key=lambda t: BY[t[0]]['displayName'].lower()):
            c = BY[i]
            lines.append(f"{n}x {c['importId']} {c['displayName']}".replace('x  ', 'x '))
    return '\n'.join(lines) + '\n'


def text_to_deck(text, name='Mazo importado'):
    d = dict(name=name, legends=[], main={}, side={})
    sec = 'main'
    problems = []
    for raw in text.replace('\r\n', '\n').split('\n'):
        line = raw.strip()
        if not line:
            continue
        if line.startswith('#') or line.startswith('//'):
            body = line.lstrip('#/').strip()
            low = body.lower()
            if low.startswith('name:'):
                d['name'] = body.split(':', 1)[1].strip() or name
            elif low.startswith('legend'):
                sec = 'legends'
            elif low.startswith('side'):
                sec = 'side'
            elif low.startswith(('main', 'deck')):
                sec = 'main'
            continue
        m = re.match(r'^(\d+)\s*x?\s+(.+)$', line, re.I)
        if not m:
            problems.append(f'no se entiende: {line}')
            continue
        n, rest = int(m.group(1)), m.group(2).strip()
        cands = [rest]
        parts = rest.split(None, 1)
        if len(parts) == 2 and re.match(r'^[β]?\d{1,4}[a-z]?$', parts[0], re.I):
            cands.insert(0, parts[1])
        cid = next((NAME2ID[norm(c)] for c in cands if norm(c) in NAME2ID), None)
        if cid is None:
            problems.append(f'carta desconocida: {rest}')
            continue
        if sec == 'legends' or BY[cid]['type'] == 'Legend':
            d['legends'].append(cid)
        else:
            d[sec][cid] = d[sec].get(cid, 0) + n
    return d, problems


# ----------------------------------------------------------------------------- comandos sencillos
def cmd_check(a):
    """Auditoría del catálogo: cartas nuevas sin anotar, mecánicas nuevas, datos inconsistentes."""
    from net_data import RAW_NET
    annotated = {ln.split('|')[0].strip() for ln in RAW_NET.splitlines() if ln.strip() and not ln.startswith('#')}
    legal = [c for c in DB.RAW if c['legality'] == 'legal']
    new = [c for c in legal if c['id'] not in annotated]
    gone = sorted(annotated - {c['id'] for c in DB.RAW})
    print(f"Catálogo: {len(DB.RAW)} cartas ({len(legal)} legales) en {DB.CARDS_PATH}")
    print(f"Anotadas en net_data.py: {len(annotated)}")
    if new:
        print(f"\n{len(new)} cartas LEGALES SIN ANOTAR (añádelas a net_data.py y, si tienen efecto, a fxtable.py):")
        for c in new:
            print(f"  {c['id']:45s} {c['type']:8s} {c['color'] or '-':7s} c{c['cost']} p{c['power']} ram{c['ram']}  {(c['rules'] or '').replace(chr(10), ' / ')[:110]}")
    else:
        print('\nTodas las cartas legales están anotadas.')
    if gone:
        print(f"\nAnotadas pero ya no existen en el catálogo: {gone}")
    known = {'Blocker', 'Adrenaline', 'Go Solo', 'Call', 'Quick', 'Spend', 'Play', 'Attack', 'Defeated'}
    seen = Counter()
    for c in DB.RAW:
        for w in re.findall(r'\{([^}]+)\}', c['rules'] or ''):
            seen[w] += 1
    unk = {w: n for w, n in seen.items() if w not in known}
    print(f"\nPalabras clave del juego usadas en las cartas: {dict(seen)}")
    if unk:
        print(f"  ⚠ Palabras clave que el simulador no conoce (¿mecánica nueva?): {unk}")
    rams = Counter(c['ram'] for c in DB.RAW if c['type'] == 'Legend' and c['legality'] == 'legal')
    print(f"RAM de las Legends legales: {dict(rams)}")
    sellable_units = [c['displayName'] for c in DB.RAW if c['id'] in DB.SELL_UNITS]
    print(f"Unidades con etiqueta de venta configuradas: {sellable_units}  (Gear y Programas se venden siempre)")
    return 1 if new or gone or unk else 0


def deck_report(d):
    errs, ram = DB.validate(d['legends'], rows_of(ids_of(d['main'])))
    # copias: principal + sideboard no pueden pasar de 3 por carta
    tot = Counter(ids_of(d['main'])) + Counter(ids_of(d['side']))
    for i, n in tot.items():
        if n > 3:
            errs.append(f"{BY[i]['displayName']}: {n} copias entre mazo y sideboard (máx. 3)")
    if sum(d['side'].values()) > 7:
        errs.append(f"sideboard de {sum(d['side'].values())} cartas (máx. 7)")
    for i in d['side']:
        c = BY[i]
        if c['color'] and (c['ram'] or 0) > ram.get(c['color'], 0):
            errs.append(f"sideboard: {c['displayName']} necesita RAM {c['color']} {c['ram']} y hay {ram.get(c['color'], 0)}")
    return errs, ram


def cmd_validate(a):
    d = load_deck(a.deck)
    errs, ram = deck_report(d)
    main = Counter(ids_of(d['main']))
    types = Counter(BY[i]['type'] for i in ids_of(d['main']))
    sell = sum(1 for i in ids_of(d['main']) if BY[i]['type'] != 'Unit' or i in DB.SELL_UNITS)
    curve = Counter(min(BY[i]['cost'] or 0, 8) for i in ids_of(d['main']))
    print(f"{d['name']}: {sum(main.values())} cartas + {sum(d['side'].values())} de sideboard | RAM {dict(ram)}")
    print(f"Tipos {dict(types)} | vendibles {sell} | curva {sorted(curve.items())}")
    print('Legends:', ', '.join(BY[l]['displayName'] for l in d['legends']))
    if errs:
        print('\nILEGAL:')
        for e in errs:
            print('  -', e)
        return 1
    print('\nLEGAL')
    return 0


def cmd_import_text(a):
    text = open(a.text, encoding='utf8').read()
    d, problems = text_to_deck(text, name=Path(a.text).stem)
    for p in problems:
        print('⚠', p)
    out = a.out or (OUT / (Path(a.text).stem + '.json'))
    save_deck(d, out)
    print(f"Guardado {out}: {sum(d['main'].values())} cartas, {sum(d['side'].values())} sideboard, {len(d['legends'])} Legends")
    return 1 if problems else 0


def cmd_export(a):
    d = load_deck(a.deck)
    t = deck_to_text(d)
    if a.out:
        open(a.out, 'w', encoding='utf8').write(t)
        print(f'Escrito {a.out}')
    else:
        print(t)
    return 0


def cmd_score(a):
    d = load_deck(a.deck)
    deck = Counter(ids_of(d['main']))
    sc, parts = NM.score_deck(d['legends'], deck, detail=True)
    print(f"Puntuación de la red: {sc:.1f}   " + ' '.join(f'{k}={v:.1f}' for k, v in parts.items()))
    S = NM.supplies(d['legends'], deck)
    D = defaultdict(float)
    for i, n in deck.items():
        for f, w in NM.NODE[i]['want'].items():
            D[f] += w * n
    for l in d['legends']:
        for f, w in NM.NODE[l]['want'].items():
            D[f] += w * 1.2
    print('\nSuministro / necesidad por característica:')
    print('  ' + '  '.join(f"{f}:{S[f]:.0f}/{D[f]:.0f}" for f in sorted(set(S) | set(D)) if S[f] or D[f]))
    nodes = list(deck) + list(d['legends'])
    E = NM.edges(list(deck), d['legends'])
    best = {}
    for x, y, f, w in E:
        if (x, y) not in best or w > best[(x, y)][1]:
            best[(x, y)] = (f, w)
    print('\nEnlaces más fuertes (productor -> consumidor [característica]):')
    for (x, y), (f, w) in sorted(best.items(), key=lambda t: -t[1][1])[:a.top]:
        print(f"  {w:5.1f}  {NM.NODE[x]['name'][:32]:32s} -> {NM.NODE[y]['name'][:32]:32s} [{f}]")
    deg = defaultdict(float)
    for x, y, f, w in E:
        deg[x] += w
        deg[y] += w
    print('\nNodos centrales:')
    for i, w in sorted(deg.items(), key=lambda t: -t[1])[:8]:
        print(f"  {w:6.1f}  {NM.NODE[i]['name']}")
    expo, ans = Counter(), Counter()
    for i, n in deck.items():
        for t in NM.NODE[i]['tags']:
            expo[t] += n
        for t, w in NM.NODE[i]['ctr'].items():
            ans[t] += n * w
    names = dict(LOWP='unidades de poder <=5 (barridas por Towerfall)', ATKR='atacantes (se quedan gastados)', BLKD='dependen de Blocker',
                 GEARD='dependen de Gear', GSD='Adrenaline / Go Solo (anulables por MaxTac Suppression, Riot Shield)', BIG='poder >=8')
    print('\nVulnerabilidades (nº de cartas):', {names.get(k, k): v for k, v in expo.items()})
    print('Respuestas que lleva (peso):', dict(ans))
    return 0


# ----------------------------------------------------------------------------- simulación
def build_side(d):
    return DB.build(rows_of(ids_of(d['main']))), [DB.legend(l) for l in d['legends']]


def cmd_sim(a):
    A, B = load_deck(a.deck_a), load_deck(a.deck_b)
    da, la = build_side(A)
    db, lb = build_side(B)
    n = a.games
    first = second = 0
    wa = 0
    t0 = time.time()
    for i in range(n):
        if i % 2 == 0:
            g = X.GameX(da, la, db, lb, a.seed * 100003 + i)
            r = g.run()
            wa += (r == 0)
            first += (r == 0)
        else:
            g = X.GameX(db, lb, da, la, a.seed * 100003 + i)
            r = g.run()
            wa += (r == 1)
            second += (r == 1)
    h = n // 2
    print(f"{A['name']} vs {B['name']}: {wa}/{n} = {wa / n:.1%} victorias de A  (empezando: {first / max(1, h):.0%}, de segundo: {second / max(1, n - h):.0%})  [{time.time() - t0:.0f}s]")
    return 0


def load_field(path):
    p = Path(path)
    if p.is_dir():
        out = []
        for f in sorted(p.glob('*.json')):
            d = load_deck(f)
            out.append(dict(name=d['name'], legs=d['legends'], deck=ids_of(d['main'])))
        return out
    data = json.load(open(p, encoding='utf8'))
    out = []
    for x in data:
        out.append(dict(name=x['name'], legs=x.get('legs') or x['legends'], deck=x['deck'] if isinstance(x['deck'], list) else ids_of(x['deck'])))
    return out


def _gaunt_one(args):
    ids, legs, fdeck, flegs, n, seed = args
    w, _ = X.play_x(DB.build(rows_of(ids)), [DB.legend(l) for l in legs], DB.build(rows_of(fdeck)), [DB.legend(l) for l in flegs], N=n, seed=seed)
    return w[0] / max(1, w[0] + w[1])


def gauntlet(ids, legs, field, n, seed, procs):
    jobs = [(ids, legs, f['deck'], f['legs'], n, seed) for f in field]
    if procs > 1:
        with Pool(procs) as p:
            return p.map(_gaunt_one, jobs)
    return [_gaunt_one(j) for j in jobs]


def cmd_gauntlet(a):
    d = load_deck(a.deck)
    field = load_field(a.field)
    t0 = time.time()
    res = gauntlet(ids_of(d['main']), d['legends'], field, a.games, a.seed, a.procs)
    avg = sum(res) / len(res)
    se = math.sqrt(sum((x - avg) ** 2 for x in res) / max(1, len(res) - 1) / len(res))
    print(f"{d['name']} contra {len(field)} mazos ({a.games} partidas c/u): {avg:.1%}  (±{se:.1%} entre rivales)  [{time.time() - t0:.0f}s]")
    for v, f in sorted(zip(res, field), key=lambda t: t[0]):
        print(f"  {v:5.0%}  vs {f['name']}")
    return 0


def cmd_hands(a):
    d = load_deck(a.deck)
    deck, L = build_side(d)
    stats = defaultdict(list)
    orig = X.GameX.play_cards
    mine = set()

    def wrap(s, me, op):
        if id(me) not in mine:
            return orig(s, me, op)
        before = me.money()
        nu = len(me.field)
        au = any(c['kind'] == 'U' and s.ccost(c, op) <= before for c in me.hand)
        orig(s, me, op)
        t = (s.turn + 1) // 2
        if t <= 4:
            stats[('1º' if me.first else '2º', t)].append((before, before - me.money(), len(me.field) > nu, au))
    X.GameX.play_cards = wrap
    try:
        for i in range(a.n):
            g = X.GameX(deck, L, deck, L, 9000 + i)
            mine.update((id(g.p[0]), id(g.p[1])))
            g.run(maxturns=10)
    finally:
        X.GameX.play_cards = orig
    print(f"{d['name']} - desarrollo en el espejo ({a.n} partidas, ambos asientos):")
    for who in ('1º', '2º'):
        for t in (1, 2, 3, 4):
            v = stats[(who, t)]
            if not v:
                continue
            n = len(v)
            print(f"  {who} jugador, turno {t}: {sum(x[0] for x in v) / n:.1f} € | gasta {sum(x[1] for x in v) / n:.1f} € | juega Unidad {sum(1 for x in v if x[2]) / n:.0%} | sin Unidad asequible en mano {sum(1 for x in v if not x[3]) / n:.0%}")
    # probabilidad de vendibles en la mano inicial (hipergeométrica exacta)
    n40 = sum(d['main'].values())
    k = sum(1 for i in ids_of(d['main']) if BY[i]['type'] != 'Unit' or i in DB.SELL_UNITS)
    hyp = lambda N, K, n, j: math.comb(K, j) * math.comb(N - K, n - j) / math.comb(N, n)
    print(f"\nMano inicial de 6 con {k} vendibles de {n40}: P(0)={hyp(n40, k, 6, 0):.1%}  P(1)={hyp(n40, k, 6, 1):.1%}  P(>=2)={1 - hyp(n40, k, 6, 0) - hyp(n40, k, 6, 1):.1%}")
    return 0


# ----------------------------------------------------------------------------- optimización
def _allowed(legs):
    ram = defaultdict(int)
    for l in legs:
        ram[BY[l]['color']] += BY[l]['ram'] or 0
    return [i for i, c in BY.items() if c['type'] != 'Legend' and c['legality'] == 'legal' and (c['ram'] or 0) <= ram.get(c['color'], 0)]


def _kinds(ids):
    k = Counter(BY[i]['type'] for i in ids)
    return k['Unit'], k['Gear'] + k['Program']


def _fit(ids, legs, field, n, seed):
    d = DB.build(rows_of(ids))
    L = [DB.legend(l) for l in legs]
    tot = 0.0
    for f in field:
        w, _ = X.play_x(d, L, DB.build(rows_of(f['deck'])), [DB.legend(l) for l in f['legs']], N=n, seed=seed)
        tot += w[0] / max(1, w[0] + w[1])
    return tot / len(field)


def _opt_run(args):
    legs, field, start, iters, games, seed = args
    rng = random.Random(seed)
    pool = _allowed(legs)
    if start:
        deck = list(start)
    else:
        deck = ids_of(NM.init_deck(legs, rng)) if all(i in NM.NODE for i in pool) else []
        if len(deck) < 40:
            deck = (deck + rng.sample(pool, 40))[:40]
    best = _fit(deck, legs, field, games, 11)
    for _ in range(iters):
        cnt = Counter(deck)
        new = list(deck)
        removed = new.pop(rng.randrange(len(new)))
        add = None
        for _t in range(30):
            c = rng.choice(pool)
            if c != removed and cnt[c] < 3:
                add = c
                break
        if add is None:
            continue
        new.append(add)
        u, nn = _kinds(new)
        if not (17 <= u <= 28 and 11 <= nn <= 23):
            continue
        f = _fit(new, legs, field, games, 11)
        if f > best + 0.003:
            best, deck = f, new
    return deck, best


def cmd_optimize(a):
    legs = a.legends
    for l in legs:
        if l not in BY or BY[l]['type'] != 'Legend':
            print(f'Legend desconocida: {l}')
            return 2
    if len({BY[l]['name'] for l in legs}) != 3:
        print('Las 3 Legends deben tener nombres distintos.')
        return 2
    field = load_field(a.field)
    start = None
    if a.start:
        sd = load_deck(a.start)
        start = ids_of(sd['main'])
        errs, _ = DB.validate(legs, rows_of(start))
        if errs:
            print('El mazo inicial no es legal con esas Legends:', errs)
            return 2
    t0 = time.time()
    tasks = [(legs, field, start, a.iters, a.games, 100 + i) for i in range(a.restarts)]
    print(f"Optimizando con {a.restarts} reinicios x {a.iters} iteraciones contra {len(field)} mazos ({a.games} partidas por cruce)...")
    with Pool(min(a.procs, a.restarts)) as p:
        res = p.map(_opt_run, tasks)
    # validación con semillas nuevas (evita quedarse con el más sobreajustado)
    held = []
    for deck, fit in res:
        held.append(gauntlet(deck, legs, field, max(100, a.games * 3), 777, a.procs))
    scores = [sum(h) / len(h) for h in held]
    k = max(range(len(res)), key=lambda i: scores[i])
    deck = res[k][0]
    errs, ram = DB.validate(legs, rows_of(deck))
    name = a.name or 'optimizado ' + ' + '.join(BY[l]['name'].split(':')[0] for l in legs)
    d = dict(name=name, legends=list(legs), main=dict(Counter(deck)), side={})
    out = a.out or (OUT / (re.sub(r'\W+', '_', name.lower()) + '.json'))
    save_deck(d, out)
    print(f"\nReinicios (ajuste / validación con semillas nuevas): " + ' | '.join(f"{r[1]:.1%}/{s:.1%}" for r, s in zip(res, scores)))
    print(f"Mejor: reinicio {k + 1} -> {scores[k]:.1%} validado. Legal: {not errs} {errs or ''}")
    print(f"Guardado en {out}  [{time.time() - t0:.0f}s]")
    print('\nCartas:')
    for t in ('Unit', 'Gear', 'Program'):
        row = sorted([(BY[i]['cost'] or 0, BY[i]['displayName'], n) for i, n in d['main'].items() if BY[i]['type'] == t])
        print(f"  {t}: " + '; '.join(f"{n}x {nm} (c{c})" for c, nm, n in row))
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


def cmd_selftest(a):
    print('1) catálogo:', len(DB.RAW), 'cartas')
    d = load_deck(HERE / 'decks' / 'green_blue_judy.json')
    errs, ram = deck_report(d)
    assert not errs, errs
    print('2) mazo de ejemplo legal, RAM', dict(ram))
    sc = NM.score_deck(d['legends'], Counter(ids_of(d['main'])))
    print('3) puntuación de la red:', round(sc, 1))
    t = deck_to_text(d)
    d2, problems = text_to_deck(t)
    assert not problems and d2['main'] == d['main'] and d2['legends'] == d['legends'], problems
    print('4) exportar -> importar texto: idéntico')
    da, la = build_side(d)
    w, _ = X.play_x(da, la, da, la, N=20, seed=1)
    assert sum(w) == 20
    print('5) simulador: 20 partidas en espejo ->', w)
    print('OK')
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('check', help='audita el catálogo: cartas nuevas sin anotar y mecánicas desconocidas')
    p.set_defaults(f=cmd_check)
    p = sub.add_parser('validate', help='árbitro: comprueba que un mazo JSON es legal')
    p.add_argument('deck')
    p.set_defaults(f=cmd_validate)
    p = sub.add_parser('import-text', help='convierte el texto exportado por la web a mazo JSON')
    p.add_argument('text')
    p.add_argument('--out')
    p.set_defaults(f=cmd_import_text)
    p = sub.add_parser('export', help='convierte un mazo JSON al texto que acepta «Importar» de la web')
    p.add_argument('deck')
    p.add_argument('--out')
    p.set_defaults(f=cmd_export)
    p = sub.add_parser('score', help='puntúa con la red de sinergias y muestra enlaces, nodos centrales y counters')
    p.add_argument('deck')
    p.add_argument('--top', type=int, default=12)
    p.set_defaults(f=cmd_score)
    p = sub.add_parser('sim', help='enfrenta dos mazos (partidas completas)')
    p.add_argument('deck_a')
    p.add_argument('deck_b')
    p.add_argument('--games', type=int, default=400)
    p.add_argument('--seed', type=int, default=1)
    p.set_defaults(f=cmd_sim)
    p = sub.add_parser('gauntlet', help='enfrenta un mazo contra un campo de mazos')
    p.add_argument('deck')
    p.add_argument('--field', default=str(DEFAULT_FIELD), help='JSON de campo o carpeta de mazos JSON')
    p.add_argument('--games', type=int, default=200)
    p.add_argument('--seed', type=int, default=5)
    p.add_argument('--procs', type=int, default=DEFAULT_PROCS)
    p.set_defaults(f=cmd_gauntlet)
    p = sub.add_parser('hands', help='manos iniciales y desarrollo de los primeros turnos (¿se atasca?)')
    p.add_argument('deck')
    p.add_argument('--n', type=int, default=400)
    p.set_defaults(f=cmd_hands)
    p = sub.add_parser('optimize', help='optimiza un mazo para 3 Legends (búsqueda local + simulación)')
    p.add_argument('--legends', nargs=3, required=True, metavar='ID')
    p.add_argument('--start', help='mazo JSON de partida (opcional)')
    p.add_argument('--field', default=str(DEFAULT_FIELD))
    p.add_argument('--iters', type=int, default=150)
    p.add_argument('--games', type=int, default=30)
    p.add_argument('--restarts', type=int, default=4)
    p.add_argument('--procs', type=int, default=DEFAULT_PROCS)
    p.add_argument('--name')
    p.add_argument('--out')
    p.set_defaults(f=cmd_optimize)
    p = sub.add_parser('trios', help='ranking de ternas de Legends con la red de sinergias')
    p.add_argument('--top', type=int, default=20)
    p.add_argument('--limit', type=int, default=0, help='probar solo N ternas al azar (prueba rápida)')
    p.add_argument('--procs', type=int, default=DEFAULT_PROCS)
    p.set_defaults(f=cmd_trios)
    p = sub.add_parser('selftest', help='comprobación rápida de que todo funciona')
    p.set_defaults(f=cmd_selftest)
    a = ap.parse_args()
    OUT.mkdir(exist_ok=True)
    sys.exit(a.f(a) or 0)


if __name__ == '__main__':
    main()
