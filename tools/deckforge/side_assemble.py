"""Monta UN sideboard de exactamente 7 cartas a partir de los planes por rival de `side_plan.py` y lo valida con la IA fuerte.

Uso:  python tools/deckforge/side_assemble.py decks/consistente_goro_wakako_v.json --vs bbg_control:0.35 red_aggro:0.10 out/ryy/ryy_smasher.json:0.15 \
          [--games 400] [--procs 2] [--save decks/consistente_goro_wakako_v_sb.json]

El sideboard es UNO para todos los rivales (7 cartas exactas, el mismo desde la partida 1): cada plan por rival solo puede usar cartas que estén en él.
Se elige por valor ponderado (peso del rival × mejora medida en el plan) por hueco de sideboard: una carta que sirve a varios rivales cuesta un solo hueco.
Los huecos que sobran se llenan con los cambios que más ayudaban aunque no llegaran a entrar en un plan. Después cada plan se mide con la IA fuerte
contra su mazo sin cambios (mismas semillas); si un plan no mejora, ese rival se juega sin cambiar.
"""
import argparse
import json
import math
import sys
import time
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except (AttributeError, OSError, ValueError):
    pass  # salida redirigida a algo sin reconfigure: se queda como está

import cardsdb as DB  # noqa: E402
import vs as VS  # noqa: E402
from side_plan import SIDE_MAX, apply_swaps  # noqa: E402

BY = DB.BY


def parse_vs(items):
    out = []
    for it in items:
        spec, _, w = it.rpartition(':') if it.rpartition(':')[0] and not it.endswith('.json') else (it, '', '1')
        out.append((spec, float(w)))
    return out


def load_plan(spec):
    """Plan con paquetes (side_plan_pkg.py) si existe; si no, el de cambios de una copia (side_plan.py)."""
    for prefix in ('plan2_', 'plan_'):
        p = HERE / 'out' / f"{prefix}{Path(spec).stem}.json"
        if p.exists():
            return json.load(open(p, encoding='utf8'))
    raise SystemExit(f'falta el plan de {spec}: lanza side_plan.py (y side_plan_pkg.py)')


def choose_side(plans):
    """plans = [(peso, nombre, [(entra, sale, copias, mejora)])]. Devuelve (sideboard Counter, {nombre: [(entra, sale, copias)]}).
    Cada movimiento (un cambio o un paquete de copias iguales) entra entero o no entra."""
    side, chosen = Counter(), {name: [] for _, name, _ in plans}
    cands = [(w, name, c, o, n, m) for w, name, sw in plans for c, o, n, m in sw if m > 0]
    while cands:
        best, best_ratio = None, 0.0
        for w, name, c, o, n, m in cands:
            have = sum(k for cc, _, k in chosen[name] if cc == c)
            extra = max(0, have + n - side[c])
            if sum(side.values()) + extra > SIDE_MAX:
                continue
            ratio = w * m / max(extra, 0.05)
            if ratio > best_ratio:
                best, best_ratio = (w, name, c, o, n, m), ratio
        if best is None:
            break
        w, name, c, o, n, m = best
        have = sum(k for cc, _, k in chosen[name] if cc == c)
        side[c] = max(side[c], have + n)
        chosen[name].append((c, o, n))
        cands.remove(best)
    return side, chosen


def fill_side(side, plans, main):
    """Llena hasta 7 con los cambios que más ayudaban y no entraron (cartas comodín)."""
    cnt = Counter(main)
    extra = sorted(((w * m / n, c) for w, _, sw in plans for c, o, n, m in sw), reverse=True)
    for _, c in extra:
        if sum(side.values()) >= SIDE_MAX:
            break
        if cnt[c] + side[c] < 3:
            side[c] += 1
    return side


def bo3(p1, p2):
    """Gana el mejor de tres: partida 1 con el mazo principal (p1), 2 y 3 con sideboard (p2)."""
    return p1 * (1 - (1 - p2) ** 2) + (1 - p1) * p2 ** 2


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('deck')
    ap.add_argument('--vs', nargs='+', required=True, help='rival[:peso] ...; el rival es un nombre de meta/ o la ruta de un mazo (con su plan en out/plan_<nombre>.json)')
    ap.add_argument('--games', type=int, default=400, help='partidas con la IA fuerte por mazo y rival')
    ap.add_argument('--procs', type=int, default=2)
    ap.add_argument('--seed', type=int, default=6400)
    ap.add_argument('--save', help='guarda el mazo con el sideboard elegido en este JSON')
    a = ap.parse_args()
    t0 = time.time()
    log = lambda *x: print(*x, f"[{time.time() - t0:.0f}s]", flush=True)
    d = VS.load(a.deck)
    main_ids = d['deck']
    specs = parse_vs(a.vs)
    plans = []
    for spec, w in specs:
        pl = load_plan(spec)
        plans.append((w, Path(spec).stem, [(x['into'], x['out'], x.get('n', 1), x['marginal']) for x in pl['plan']]))
    side, chosen = choose_side(plans)
    side = fill_side(side, plans, main_ids)
    tables = [x['into'] for spec, _ in specs for x in load_plan(spec)['table']]            # si aún faltan huecos: lo mejor de las tablas
    cnt = Counter(main_ids)
    for c in tables:
        if sum(side.values()) >= SIDE_MAX:
            break
        if cnt[c] + side[c] < 3:
            side[c] += 1
    log('Sideboard (7): ' + ', '.join(f"{n}x {BY[c]['name']}" for c, n in sorted(side.items(), key=lambda t: BY[t[0]]['name'])))
    for _, name, _ in plans:
        print(f"  plan vs {name}: " + (' · '.join(f"+{n} {BY[c]['name']} / -{n} {BY[o]['name']}" for c, o, n in chosen[name]) or 'sin cambios'))

    log(f"Validación con la IA fuerte ({a.games} partidas por mazo y rival, mismas semillas)...")
    rows, total_w, total_p = [], 0.0, 0.0
    for (spec, w), (_, name, _) in zip(specs, plans):
        rival = VS.meta([spec])[0]
        if not chosen[name]:
            rows.append((name, w, None, None))
            continue
        post = dict(name='plan', deck=apply_swaps(main_ids, [(c, o) for c, o, n in chosen[name] for _ in range(n)]), legs=d['legs'])
        wins = VS.evaluate([d, post], [rival], a.games, a.procs, True, a.seed)
        p0, p1 = (wins[i][0][0] / max(1, wins[i][0][1]) for i in (0, 1))
        rows.append((name, w, p0, p1))
        log(f"  {name}: sin cambios {p0:.1%} · con plan {p1:.1%} ({p1 - p0:+.1%})")
    print(f"\nError típico por medida ≈ ±{50 / math.sqrt(a.games):.1f} puntos (la diferencia, ≈ ±{70 / math.sqrt(a.games):.1f}).")
    print('Probabilidad de ganar el mejor de tres (partida 1 sin cambios, 2 y 3 con el plan si mejora):')
    for name, w, p0, p1 in rows:
        if p0 is None:
            print(f"  {name:28s} sin plan")
            continue
        use = p1 if p1 > p0 else p0
        print(f"  {name:28s} sin sideboard {bo3(p0, p0):.1%} · con sideboard {bo3(p0, use):.1%}  (plan {'USAR' if p1 > p0 else 'NO usar'})")
        total_w += w
        total_p += w * (bo3(p0, use) - bo3(p0, p0))
    if total_w:
        print(f"  ganancia media ponderada del sideboard: {total_p / total_w:+.1%}")
    if a.save:
        out = json.loads(json.dumps(json.load(open(a.deck, encoding='utf8'))))
        out['side'] = {c: n for c, n in side.items()}
        json.dump(out, open(a.save, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
        log(f"-> {a.save}")
    json.dump(dict(side=dict(side), plans={name: [dict(into=c, out=o, n=n) for c, o, n in chosen[name]] for _, name, _ in plans},
                   results=[dict(rival=n, weight=w, base=p0, plan=p1) for n, w, p0, p1 in rows]),
              open(HERE / 'out' / 'sideboard_final.json', 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    return 0


if __name__ == '__main__':
    sys.exit(main())
