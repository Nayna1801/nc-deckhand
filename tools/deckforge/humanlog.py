"""Lo que enseñan las partidas que juegas tú en el Laboratorio (data/human/*.json, las guarda live.py).

    python tools/deckforge/forge.py humanlog                      resumen, parejas de mazos y turnos en que difieres del piloto
    python tools/deckforge/forge.py humanlog --sim 100            añade, por pareja, lo que predice el simulador (piloto contra piloto)
    python tools/deckforge/forge.py humanlog --export-rows f.json tus posiciones en el formato de entrenamiento de valfn.py

Ojo al leerlo: una diferencia con el piloto NO es un error tuyo ni suyo; es una jugada que merece una mirada. Con pocas partidas
sirve para encontrar fallos concretos del piloto y reglas mal modeladas, no para estimar porcentajes.
"""
import json
from collections import Counter, defaultdict
from pathlib import Path

import cardsdb as DB
import human_pilot as HP

DATA_DIR = Path(__file__).resolve().parent / 'data' / 'human'
KIND_TEXT = {'sell': 'vender', 'play': 'jugar', 'call': 'Call', 'gosolo': 'Go Solo', 'attack': 'atacar'}


def load_games(folder=DATA_DIR):
    games = []
    for p in sorted(Path(folder).glob('*.json')):
        d = json.loads(p.read_text(encoding='utf-8'))
        d['file'] = p.name
        games.append(d)
    return games


def _name(cid):
    return DB.BY[cid]['displayName'].split(':')[0] if cid in DB.BY else str(cid)


def action_text(a):
    kind, card, tgt = a
    base = KIND_TEXT.get(kind, kind)
    if kind == 'attack':
        return f"{base} con {_name(card)} -> {'Gigs' if tgt is None else _name(tgt)}"
    return base if card is None else f'{base} {_name(card)}'


def human_turns(game):
    """{turno: [acciones de esa persona en el orden en que las hizo]} (sin «terminar el turno»)."""
    turns = defaultdict(list)
    for d in game['decisions']:
        if d['kind'] == 'action' and d.get('act') and d['act'][0] != 'end':
            turns[d['turn']].append(tuple(d['act']))
    return turns


def compare_turns(game):
    """[(turno, acciones de la persona, acciones del piloto, solo ella, solo el piloto)] de cada turno suyo con plan del piloto."""
    mine = human_turns(game)
    out = []
    for key, plan in sorted(game.get('plans', {}).items(), key=lambda kv: int(kv[0])):
        if plan is None:
            continue
        turn = int(key)
        pilot = [tuple(a) for a in plan]
        h = mine.get(turn, [])
        only_h, only_p = HP.diff(h, pilot)
        out.append((turn, h, [a for a in pilot if a[0] != 'ability'], only_h, only_p))
    return out


def outcome(game):
    if game.get('aborted') or game.get('winner') is None:
        return None
    return 'draw' if game['winner'] < 0 else ('win' if game['winner'] == game['human'] else 'loss')


def deck_pair(game):
    """(nombre del mazo de la persona, nombre del mazo del piloto)."""
    return game['decks'][0]['name'], game['decks'][1]['name']


def simulated_rate(game, n, seed=7):
    """% de victorias del mazo de la persona jugando el piloto los dos lados (alterna quién empieza)."""
    import engine2 as X
    mine, rival = game['decks'][0], game['decks'][1]
    w, _ = X.play(mine['main'], mine['legs'], rival['main'], rival['legs'], N=n, seed=seed, deep=(False, False), vf=('action', 'action'))
    return 100.0 * w[0] / max(1, w[0] + w[1])


def report(games, sim=0):
    L = []
    done = [g for g in games if outcome(g)]
    L.append(f'{len(games)} partidas guardadas ({len(games) - len(done)} abandonadas o sin terminar)')
    pairs = defaultdict(lambda: Counter())
    sample = {}
    for g in done:
        pairs[deck_pair(g)][outcome(g)] += 1
        sample.setdefault(deck_pair(g), g)
    L.append('')
    L.append('RESULTADOS POR PAREJA DE MAZOS (tu mazo vs el del piloto)')
    for (a, b), c in sorted(pairs.items()):
        n = sum(c.values())
        line = f"  {a[:34]} vs {b[:34]}: {c['win']} ganadas de {n}"
        if sim:
            line += f" · el simulador (piloto contra piloto) da {simulated_rate(sample[(a, b)], sim):.0f} % a tu mazo"
        L.append(line)
    same = total = 0
    only_h, only_p = Counter(), Counter()
    L.append('')
    L.append('TURNOS EN QUE HICISTE ALGO DISTINTO AL PILOTO (mismas acciones sin importar el orden = no sale)')
    for g in done:
        rows = [r for r in compare_turns(g)]
        total += len(rows)
        shown = False
        for turn, h, p, oh, op in rows:
            if not oh and not op:
                same += 1
                continue
            if not shown:
                L.append(f"  Partida {g['file']} ({outcome(g) == 'win' and 'ganaste' or 'perdiste'}):")
                shown = True
            only_h.update(oh)
            only_p.update(op)
            L.append(f"    turno {turn}: tú: {', '.join(action_text(a) for a in h) or 'nada'}")
            L.append(f"               piloto: {', '.join(action_text(a) for a in p) or 'nada'}")
    L.append('')
    L.append(f'Turnos iguales al piloto: {same} de {total}' + (f' ({100 * same / total:.0f} %)' if total else ''))
    if only_p:
        L.append('Lo que el piloto haría y tú no (más repetido): ' + '; '.join(f'{action_text(a)} ×{n}' for a, n in only_p.most_common(6)))
    if only_h:
        L.append('Lo que haces tú y el piloto no (más repetido): ' + '; '.join(f'{action_text(a)} ×{n}' for a, n in only_h.most_common(6)))
    return '\n'.join(L)


def export_rows(games, out):
    """Posiciones al terminar cada turno de tus partidas: [variables, ganó quien movió, fórmula a mano] (el formato de valfn.py)."""
    rows = [r for g in games if outcome(g) in ('win', 'loss') for r in g.get('rows', [])]
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    Path(out).write_text(json.dumps(rows, separators=(',', ':')), encoding='utf-8')
    return len(rows)


def cmd_humanlog(a):
    games = load_games(a.dir)
    if not games:
        print(f'No hay partidas guardadas en {a.dir}: juega alguna en la página Laboratorio (pestaña «Jugar contra el piloto»).')
        return 0
    print(report(games, a.sim))
    if a.export_rows:
        print(f'\n{export_rows(games, a.export_rows)} posiciones guardadas en {a.export_rows}')
    return 0
