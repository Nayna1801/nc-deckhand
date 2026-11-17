"""Puente entre la página «Laboratorio» de la web (solo existe con `npm run dev`) y el simulador.

    python -I tools/deckforge/lab_sim.py decks       -> JSON con los mazos de decks/ y meta/ (para los desplegables)
    python -I tools/deckforge/lab_sim.py simulate    -> lee por stdin {a, b, seed, deep} y escribe la partida grabada

Cada mazo de la petición es {name, legends: [ids], main: [ids repetidos]}. Los errores salen por stderr (última línea) con
código de salida 2 y el servidor de desarrollo los enseña tal cual.
"""
import json
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
try:
    sys.stdin.reconfigure(encoding='utf-8')
    sys.stdout.reconfigure(encoding='utf-8')
except (AttributeError, OSError, ValueError):
    pass  # sin reconfigure: se queda la codificación del sistema

import cardsdb as DB  # noqa: E402
import replay as RP  # noqa: E402

BY = DB.BY
MAX_CARDS = 60


def _ids(v, what, only_type=None):
    if not isinstance(v, list) or not all(isinstance(x, str) for x in v):
        raise ValueError(f'{what}: debe ser una lista de ids de carta')
    unknown = sorted({x for x in v if x not in BY})
    if unknown:
        raise ValueError(f'{what}: cartas desconocidas: {", ".join(unknown[:5])}')
    if only_type == 'Legend' and any(BY[x]['type'] != 'Legend' for x in v):
        raise ValueError(f'{what}: solo puede haber Legends')
    if only_type is None and any(BY[x]['type'] == 'Legend' for x in v):
        raise ValueError(f'{what}: las Legends van aparte')
    return list(v)


def _deck(d, label):
    if not isinstance(d, dict):
        raise ValueError(f'{label}: mazo no válido')
    legs = _ids(d.get('legends'), f'{label} (Legends)', 'Legend')
    main = _ids(d.get('main'), f'{label} (cartas)')
    if len(legs) != 3:
        raise ValueError(f'{label}: hacen falta 3 Legends (hay {len(legs)})')
    if not 1 <= len(main) <= MAX_CARDS:
        raise ValueError(f'{label}: el mazo debe tener entre 1 y {MAX_CARDS} cartas (hay {len(main)})')
    name = str(d.get('name') or label)[:64]
    return dict(name=name, legs=legs, main=main, issues=legality(legs, main))


def legality(legs, main):
    """Por qué un mazo no cumple las reglas de construcción (7.3): 40-50 cartas, 3 copias como mucho, límites de RAM de sus Legends y
    Legends de nombre distinto. Lista vacía si es legal. No impide simularlo ni jugarlo (sirve para probar borradores): se avisa."""
    out = []
    if not 40 <= len(main) <= 50:
        out.append(f'tiene {len(main)} cartas (deben ser entre 40 y 50)')
    over = [f"{BY[i]['displayName']} ×{n}" for i, n in Counter(main).items() if n > 3]
    if over:
        out.append('más de 3 copias de ' + ', '.join(over[:4]))
    ram = Counter()
    for l in legs:
        ram[BY[l]['color']] += BY[l]['ram'] or 0
    no_ram = sorted({BY[i]['displayName'] for i in main if BY[i]['color'] and (BY[i]['ram'] or 0) > ram[BY[i]['color']]})
    if no_ram:
        out.append('sus Legends no dan RAM suficiente para ' + ', '.join(no_ram[:4]) + (f' y {len(no_ram) - 4} más' if len(no_ram) > 4 else ''))
    if len({BY[l]['name'] for l in legs}) != len(legs):
        out.append('lleva dos Legends con el mismo nombre')
    not_legal = sorted({BY[i]['displayName'] for i in list(main) + list(legs) if BY[i].get('legality', 'legal') != 'legal'})
    if not_legal:
        out.append('cartas no legales en torneo: ' + ', '.join(not_legal[:4]))
    return out


def warnings(*decks):
    """Avisos para la página: un texto por mazo que no es legal."""
    return [f"{d['name']} no es un mazo legal: " + '; '.join(d['issues']) + '.' for d in decks if d.get('issues')]


def simulate(req):
    a, b = _deck(req.get('a'), 'Mazo J1'), _deck(req.get('b'), 'Mazo J2')
    seed = int(req.get('seed', 1))
    game, ids = RP.record(a, b, seed, deep=bool(req.get('deep', True)))
    return dict(game=game, cards=RP.card_table(ids), warnings=warnings(a, b))


def list_decks():
    out = []
    for folder, group in (('decks', 'Mazos de deckforge'), ('meta', 'Meta')):
        for p in sorted((HERE / folder).glob('*.json')):
            d = json.loads(p.read_text(encoding='utf-8'))
            if not isinstance(d.get('main'), dict) or len(d.get('legends', [])) != 3:
                continue
            main = [i for i, n in d['main'].items() for _ in range(int(n))]
            out.append(dict(key=f'{folder}/{p.stem}', group=group, name=d.get('name', p.stem), legends=d['legends'], main=main))
    return out


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    try:
        if cmd == 'decks':
            json.dump(list_decks(), sys.stdout, ensure_ascii=False, separators=(',', ':'))
        elif cmd == 'simulate':
            json.dump(simulate(json.load(sys.stdin)), sys.stdout, ensure_ascii=False, separators=(',', ':'))
        else:
            raise ValueError('uso: lab_sim.py decks | simulate')
    except (ValueError, KeyError, TypeError, json.JSONDecodeError) as e:
        print(f'{type(e).__name__}: {e}', file=sys.stderr)
        sys.exit(2)


if __name__ == '__main__':
    main()
