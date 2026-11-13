"""Catálogo de cartas y reglas de construcción de mazos."""
import json
import os
from pathlib import Path

HERE = Path(__file__).resolve().parent
CARDS_PATH = Path(os.environ.get('DECKFORGE_CARDS', HERE.parent.parent / 'src' / 'data' / 'cards.json'))
RAW = json.load(open(CARDS_PATH, encoding='utf8'))
# Unidades con etiqueta de venta (todo Gear y Programa se puede vender; de las Unidades, solo estas).
# Sale de mirar la esquina de cada carta: si salen cartas nuevas con etiqueta, añádelas aquí.
SELL_UNITS = {'mt0d12_flathead'}
BY = {c['id']: c for c in RAW}
# Cartas legales que aún no se pueden conseguir (promocionales sin repartir...). Se listan por id en data/unavailable.json:
# los buscadores no las usan y `validate` avisa si un mazo las lleva.
_UNAV = HERE / 'data' / 'unavailable.json'
UNAVAILABLE = set(json.load(open(_UNAV, encoding='utf8'))) if _UNAV.exists() else set()


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
    for i in list(legends) + [cid for _, cid in rows]:
        if i in UNAVAILABLE and f"{BY[i]['displayName']} no está disponible todavía" not in errs:
            errs.append(f"{BY[i]['displayName']} no está disponible todavía")
    return errs, ram
