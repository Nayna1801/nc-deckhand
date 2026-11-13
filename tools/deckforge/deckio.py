"""Mazos de deckforge: rutas comunes, lectura y escritura de mazos JSON y paso de y a texto (formato «Exportar/Importar» de la web)."""
import json
import re
import unicodedata
from collections import Counter
from pathlib import Path

import cardsdb as DB


HERE = Path(__file__).resolve().parent


BY = DB.BY
OUT = HERE / 'out'
DEFAULT_FIELD = HERE / 'meta'     # los mazos de referencia del meta (añade aquí listas reales con import-text)
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
