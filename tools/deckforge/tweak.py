"""Cambios de UNA carta en un mazo: ¿mejora contra el meta (sobre todo contra el cruce más flojo)?

1) Criba: todos los cambios «quitar una copia de X, meter una copia de Y» legales, con la IA rápida (sin previsión).
2) Validación: los mejores (por media y por el cruce flojo) con la IA fuerte (valoración aprendida en cada jugada) y semillas nuevas.
3) Confirmación: los dos primeros contra el mazo original con más partidas.

    python tools/deckforge/tweak.py [mazo.json] [--weak "Red Aggro"] [--procs 4]

Es un modelo: con ±4 puntos de ruido por cruce, solo cuentan mejoras claras y confirmadas.
"""
import argparse
import json
import sys
import time
from collections import Counter
from multiprocessing import Pool
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import cardsdb as DB  # noqa: E402
import forge as F  # noqa: E402

BY = DB.BY


def _screen(args):
    ids, legs, field, n, seed = args
    per = [F._gaunt_one((ids, legs, f['deck'], f['legs'], n, seed, None)) for f in field]
    return per


def neighbors(ids, legs):
    pool = [i for i in F._allowed(legs) if i not in DB.UNAVAILABLE]
    cnt = Counter(ids)
    out = []
    for rem in sorted(cnt):
        for add in pool:
            if add == rem or cnt[add] >= 3:
                continue
            new = list(ids)
            new.remove(rem)
            new.append(add)
            u, nn = F._kinds(new)
            if not (17 <= u <= 28 and 11 <= nn <= 23):
                continue
            errs, _ = DB.validate(legs, F.rows_of(new))
            if errs:
                continue
            out.append((rem, add, new))
    return out


def show(per, names):
    return '  '.join(f"{n[7:19]} {v:4.0%}" for n, v in zip(names, per))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('deck', nargs='?', default=str(HERE / 'decks' / 'mejor_goro_wakako_v.json'))
    ap.add_argument('--weak', default='Red Aggro', help='parte del nombre del cruce que se quiere mejorar')
    ap.add_argument('--procs', type=int, default=4)
    ap.add_argument('--screen-games', type=int, default=100)
    ap.add_argument('--valid-games', type=int, default=200)
    ap.add_argument('--confirm-games', type=int, default=400)
    ap.add_argument('--top', type=int, default=6)
    ap.add_argument('--out', default=str(HERE / 'out' / 'tweak_result.json'))
    a = ap.parse_args()

    d = F.load_deck(a.deck)
    legs = list(d['legends'])
    ids = F.ids_of(d['main'])
    field = F.load_field(HERE / 'meta')
    names = [f['name'] for f in field]
    w = next(i for i, n in enumerate(names) if a.weak.lower() in n.lower())
    nb = neighbors(ids, legs)
    print(f'{len(nb)} cambios de una carta posibles; cruce a mejorar: {names[w]}', flush=True)

    # 1) criba rápida
    F.set_deep(False)
    F.set_vf('hand')
    t0 = time.time()
    jobs = [(ids, legs, field, a.screen_games, 21)] + [(n[2], legs, field, a.screen_games, 21) for n in nb]
    with Pool(a.procs) as p:
        res = p.map(_screen, jobs, chunksize=4)
    base, res = res[0], res[1:]
    avg = lambda per: sum(per) / len(per)  # noqa: E731
    print(f'1) criba hecha [{time.time() - t0:.0f}s]. Original (IA rápida): {avg(base):.1%} · {show(base, names)}', flush=True)
    scored = sorted(zip(nb, res), key=lambda t: -avg(t[1]))
    by_weak = sorted(zip(nb, res), key=lambda t: -(t[1][w] + 0.5 * avg(t[1])))
    pick = []
    for lst in (scored[:a.top], by_weak[:a.top // 2 + 1]):
        for (rem, add, new), per in lst:
            if all(add != x[0][1] or rem != x[0][0] for x in pick):
                pick.append(((rem, add, new), per))
    print('   candidatos a validar:')
    for (rem, add, _), per in pick:
        print(f"     -{BY[rem]['displayName']}  +{BY[add]['displayName']}: {avg(per):.1%} · {names[w][7:19]} {per[w]:.0%}", flush=True)

    # 2) validación con la IA fuerte
    F.set_deep(True)
    F.set_vf('action')
    t0 = time.time()
    vb = F.gauntlet(ids, legs, field, a.valid_games, 31, a.procs)
    print(f'2) original (IA fuerte, {a.valid_games} partidas por cruce): {avg(vb):.1%} · {show(vb, names)} [{time.time() - t0:.0f}s]', flush=True)
    rows = []
    for (rem, add, new), _ in pick:
        t0 = time.time()
        per = F.gauntlet(new, legs, field, a.valid_games, 31, a.procs)
        rows.append(dict(rem=rem, add=add, per=per, avg=avg(per)))
        print(f"   -{BY[rem]['displayName']}  +{BY[add]['displayName']}: {avg(per):.1%} ({(avg(per) - avg(vb)) * 100:+.1f}) · "
              f"{show(per, names)} [{time.time() - t0:.0f}s]", flush=True)
    rows.sort(key=lambda r: -(r['avg'] + 0.25 * r['per'][w]))

    # 3) confirmación con semillas nuevas y más partidas
    top = rows[:2]
    t0 = time.time()
    cb = F.gauntlet(ids, legs, field, a.confirm_games, 41, a.procs)
    print(f'3) confirmación: original {avg(cb):.1%} · {show(cb, names)} [{time.time() - t0:.0f}s]', flush=True)
    for r in top:
        new = list(ids)
        new.remove(r['rem'])
        new.append(r['add'])
        per = F.gauntlet(new, legs, field, a.confirm_games, 41, a.procs)
        r['confirm'] = per
        r['deck'] = new
        print(f"   -{BY[r['rem']]['displayName']}  +{BY[r['add']]['displayName']}: {avg(per):.1%} ({(avg(per) - avg(cb)) * 100:+.1f}) · "
              f"{show(per, names)}", flush=True)
    json.dump(dict(base=base, valid_base=vb, confirm_base=cb, rows=rows, names=names), open(a.out, 'w'), indent=1)
    print(f'Guardado en {a.out}')


if __name__ == '__main__':
    main()
