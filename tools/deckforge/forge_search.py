"""Comandos de optimización de deckforge: optimize, search, sideboard y match."""
import random
import re
import time
import unicodedata
from collections import Counter, defaultdict
from multiprocessing import Pool

import cardsdb as DB
import net_model as NM
import sideboard as SB
import search as SR
import engine2 as X
from deckio import BY, OUT, ids_of, load_deck, rows_of, save_deck
from forge_sim import gauntlet, load_field, set_deep


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
    tot = 0.0
    for f in field:
        w, _ = X.play(ids, legs, f['deck'], f['legs'], N=n, seed=seed)
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
    set_deep(True)
    for deck, fit in res:
        held.append(gauntlet(deck, legs, field, max(100, a.games * 3), 777, a.procs))
    set_deep(False)
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


def _field_many(paths):
    out = []
    for p in paths:
        out += load_field(p)
    return out


def _print_cards(d):
    for t in ('Unit', 'Gear', 'Program'):
        row = sorted([(BY[i]['cost'] or 0, BY[i]['displayName'], n) for i, n in d['main'].items() if BY[i]['type'] == t])
        print(f"  {t}: " + '; '.join(f"{n}x {nm} (c{c})" for c, nm, n in row))


def cmd_search(a):
    """Criba de todas las ternas de Legends + afinado de las mejores."""
    field = _field_many(a.field)
    trios = SR.all_trios()
    if a.limit:
        random.Random(1).shuffle(trios)
        trios = trios[:a.limit]
    t0 = time.time()
    print(f"1) Criba: {len(trios)} ternas x {len(field)} rivales x {a.screen_games} partidas...")
    res = SR.screen(trios, field, a.screen_games, 3, a.procs)
    short = [r[0] for r in res[:a.keep * 4]]
    print(f"   [{time.time() - t0:.0f}s] 2) Segunda criba de las {len(short)} mejores con {a.screen_games * 4} partidas por rival...")
    res2 = SR.screen(short, field, a.screen_games * 4, 4, a.procs)
    for legs, f, _ in res2[:a.keep * 2]:
        print(f"   {f:5.1%}  " + ' + '.join(BY[x]['displayName'] for x in legs))
    final = []
    print(f"   [{time.time() - t0:.0f}s] 3) Afinando las {a.keep} mejores ({a.restarts} reinicios x {a.iters} cambios)...")
    for legs, f, deck in res2[:a.keep]:
        runs = SR.optimize(legs, field, deck, a.iters, a.games, a.restarts, a.procs)
        set_deep(True)
        held = [sum(gauntlet(dk, legs, field, 150, 777, a.procs)) / len(field) for dk, _ in runs]
        set_deep(False)
        k = max(range(len(runs)), key=lambda i: held[i])
        final.append((held[k], legs, runs[k][0]))
        print(f"   {held[k]:5.1%} (antes de afinar {f:.1%})  " + ' + '.join(BY[x]['displayName'] for x in legs) + f"  [{time.time() - t0:.0f}s]")
    final.sort(key=lambda t: -t[0])
    print(f"\nResultado (validado con semillas nuevas y previsión, 150 partidas por rival):")
    for rank, (f, legs, deck) in enumerate(final, 1):
        name = f"busqueda {rank} " + ' + '.join(BY[l]['name'].split(':')[0] for l in legs)
        d = dict(name=name, legends=list(legs), main=dict(Counter(deck)), side={})
        out = OUT / (re.sub(r'[^a-z0-9]+', '_', norm_keep(name)) + '.json')
        save_deck(d, out)
        print(f"\n{rank}. {f:.1%}  " + ' + '.join(BY[x]['displayName'] for x in legs) + f"  -> {out}")
        _print_cards(d)
    return 0


def norm_keep(s):
    return unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()


def _nm(i):
    return BY[i]['displayName']


def cmd_sideboard(a):
    """Plan de sideboard contra cada rival del campo (o propuesta de sideboard con --build)."""
    d = load_deck(a.deck)
    field = _field_many(a.field)
    main, legs = ids_of(d['main']), d['legends']
    t0 = time.time()
    if a.build or not d['side']:
        if not a.build:
            print('El mazo no tiene sideboard: propongo uno (equivale a --build).')
        side, per = SB.build_side(main, legs, field, games=a.games, procs=a.procs)
        for name, base, outs, top in per:
            print(f"  vs {name}: {base:.0%} de base; quitando {', '.join(_nm(o) for o in outs)} lo que más ayuda es: "
                  + '; '.join(f"{_nm(c)} ({g:+.0%})" for c, g in top))
        print(f"\nSideboard propuesto ({sum(side.values())} cartas): " + '; '.join(f"{n}x {_nm(c)}" for c, n in side.items()))
        d['side'] = side
        if a.save:
            save_deck(d, a.deck)
            print(f'Guardado en {a.deck}')
        if not side:
            return 0
    side = ids_of(d['side'])
    print(f"\nPlan de sideboard de {d['name']} ({a.games} partidas por prueba; validación con previsión):")
    with Pool(a.procs) as pool:
        for rival in field:
            post, moves, w0, w1 = SB.plan_vs(main, legs, side, rival, games=a.games, pool=pool)
            if not moves:
                print(f"  vs {rival['name']}: no cambies nada ({w0:.0%})")
                continue
            v0 = SB.wr(main, legs, rival, a.check, 99, deep=(True, True))
            v1 = SB.wr(post, legs, rival, a.check, 99, deep=(True, True))
            ok = v1 >= v0 + 0.02
            print(f"  vs {rival['name']}: {v0:.0%} -> {v1:.0%} con previsión " + ('(CONFIRMADO)' if ok else '(NO confirmado: mejor no cambiar)'))
            for cin, n, cout, g in moves:
                print(f"       +{n} {_nm(cin)}  /  -{n} {_nm(cout)}   ({g:+.0%} al probarlo)")
    print(f"[{time.time() - t0:.0f}s]")
    return 0


def cmd_match(a):
    """Al mejor de tres con sideboard entre la 1.ª partida y las siguientes."""
    A, B = load_deck(a.deck_a), load_deck(a.deck_b)
    sides = []
    with Pool(a.procs) as pool:
        for me, other in ((A, B), (B, A)):
            main = ids_of(me['main'])
            rival = dict(name=other['name'], legs=other['legends'], deck=ids_of(other['main']))
            post, moves = main, []
            if me['side']:
                post, moves, _, _ = SB.plan_vs(main, me['legends'], ids_of(me['side']), rival, games=a.games, pool=pool)
            sides.append(dict(legs=me['legends'], main=main, post=post))
            print(f"{me['name']} tras la 1.ª partida: " + ('; '.join(f"+{n} {_nm(i)} / -{n} {_nm(o)}" for i, n, o, _ in moves) or 'sin cambios'))
    t0 = time.time()
    deep = None if a.fast else (True, True)
    w, g1 = SB.bo3(sides[0], sides[1], a.matches, a.seed, deep=deep)
    print(f"\n{A['name']} gana el {w:.1%} de los enfrentamientos al mejor de tres ({a.matches}); la 1.ª partida, el {g1:.1%}  [{time.time() - t0:.0f}s]")
    return 0
