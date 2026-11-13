"""Comandos sencillos de deckforge: auditar el catálogo, validar, importar/exportar texto y puntuar con la red."""
import re
from collections import Counter, defaultdict
from pathlib import Path

import cardsdb as DB
import net_model as NM
from deckio import BY, OUT, deck_to_text, ids_of, load_deck, rows_of, save_deck, text_to_deck


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
        print(f"\n{len(new)} cartas LEGALES SIN ANOTAR (añádelas a net_data.py y, si tienen efecto, a fx2.py):")
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
        for t in sorted(NM.NODE[i]['tags']):     # sorted: las etiquetas son un set y su orden cambiaría de una ejecución a otra
            expo[t] += n
        for t, w in NM.NODE[i]['ctr'].items():
            ans[t] += n * w
    names = dict(LOWP='unidades de poder <=5 (barridas por Towerfall)', ATKR='atacantes (se quedan gastados)', BLKD='dependen de Blocker',
                 GEARD='dependen de Gear', GSD='Adrenaline / Go Solo (anulables por MaxTac Suppression, Riot Shield)', BIG='poder >=8')
    print('\nVulnerabilidades (nº de cartas):', {names.get(k, k): v for k, v in expo.items()})
    print('Respuestas que lleva (peso):', dict(ans))
    return 0
