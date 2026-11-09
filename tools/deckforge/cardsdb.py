import json, re
from engine import U, G, P

import os
from pathlib import Path
HERE = Path(__file__).resolve().parent
CARDS_PATH = Path(os.environ.get('DECKFORGE_CARDS', HERE.parent.parent / 'src' / 'data' / 'cards.json'))
RAW = json.load(open(CARDS_PATH, encoding='utf8'))
# Unidades con etiqueta de venta (todo Gear y Programa se puede vender; de las Unidades, solo estas).
# Sale de mirar la esquina de cada carta: si salen cartas nuevas con etiqueta, añádelas aquí.
SELL_UNITS = {'mt0d12_flathead'}
BY = {c['id']: c for c in RAW}

from fxtable import FX, LEG


def card(cid):
    c = BY[cid]
    fx = dict(FX.get(cid, {}))
    cost = fx.pop('cost', c['cost'] or 0)
    pw = fx.pop('power', c['power'] or 0)
    t = c['type']
    text = c['rules'] or ''
    if '{Blocker}' in text and t == 'Unit':
        fx.setdefault('blocker', True)
    if '{Adrenaline}' in text and t == 'Unit' and 'has {Adrenaline}' not in text:
        fx.setdefault('adr', True)
    if "can't attack" in text and t == 'Unit' and 'unless' not in text:
        fx.setdefault('noatk', True)
    if (c['power'] or 0) == 0 and t == 'Unit':
        fx.setdefault('nogig', True)
    if t == 'Unit':
        d = U(cost, pw, c['displayName'], **fx)
    elif t == 'Gear':
        if '{Blocker}' in text:
            fx.setdefault('blocker', True)
        d = G(cost, pw, c['displayName'], **fx)
    else:
        d = P(cost, c['displayName'], **fx)
    d['id'] = cid
    d['color'] = c['color']
    d['ram'] = c['ram']
    d['tags'] = c['classifications']
    if cid in SELL_UNITS:
        d['sell'] = True
    return d


def legend(cid):
    c = BY[cid]
    d = dict(LEG.get(cid, {}))
    d['name'] = c['displayName']
    d['id'] = cid
    d['color'] = c['color']
    d['tags'] = c['classifications']
    return d


def build(rows):
    """rows = [(n, id), ...] -> lista de cartas de motor"""
    out = []
    for n, cid in rows:
        for _ in range(n):
            out.append(card(cid))
    return out


def validate(legends, rows):
    ram = {}
    for l in legends:
        ram[BY[l]['color']] = ram.get(BY[l]['color'], 0) + (BY[l]['ram'] or 0)
    errs = []
    total = sum(n for n, _ in rows)
    if not (40 <= total <= 50):
        errs.append(f'tamaño {total}')
    cnt = {}
    for n, cid in rows:
        cnt[cid] = cnt.get(cid, 0) + n
        c = BY[cid]
        if c['color'] and (c['ram'] or 0) > ram.get(c['color'], 0):
            errs.append(f"{cid} ram {c['ram']} > {ram.get(c['color'], 0)}")
        if c['legality'] != 'legal' or c['type'] == 'Legend':
            errs.append(f'{cid} no válida')
    for k, v in cnt.items():
        if v > 3:
            errs.append(f'{k} x{v}')
    if len({BY[l]['name'] for l in legends}) != 3:
        errs.append('legends repetidas')
    return errs, ram
