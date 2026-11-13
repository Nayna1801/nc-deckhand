"""Ciclo de auto-mejora: la IA aprende a jugar mejor y se busca el mejor mazo para cada situación.

Cada vuelta:
  A) JUEGO  - partidas con la IA actual -> posiciones nuevas (se acumulan) -> red candidata -> duelo directo contra la
              actual; solo se adopta si gana con claridad (así nunca empeora).
  B) MAZOS  - por cada situación (contra cada mazo del meta y contra todos a la vez) se afina el mejor mazo por búsqueda
              local y se vuelven a medir todos los mazos del «salón» con la IA vigente.

Estado en data/evolve/ (redes, salón de mazos, historial, informe.md). Registro en out/evolve.log.
Parar sin perder nada: crear el fichero out/evolve.STOP (se mira entre fases) o Ctrl+C.

    forge.py evolve --cycles 1            una vuelta
    forge.py evolve --hours 8             vueltas hasta agotar el tiempo
    forge.py evolve --quick               vuelta diminuta para comprobar que todo funciona
"""
import hashlib
import json
import shutil
import time
from collections import Counter
from multiprocessing import Pool
from pathlib import Path

HERE = Path(__file__).resolve().parent
STATE = HERE / 'data' / 'evolve'
NETS = STATE / 'nets'
HALL = STATE / 'hall.json'
HISTORY = STATE / 'history.json'
REPORT = STATE / 'informe.md'
LOG = HERE / 'out' / 'evolve.log'
POS = HERE / 'out' / 'evolve_positions.npz'
OLD_DATA = HERE / 'out' / 'valfn_data.json'
STOP = HERE / 'out' / 'evolve.STOP'

POS_CAP = 600_000          # posiciones que se conservan (las más recientes)
HALL_MAX = 14              # mazos del salón (los 4 del meta no se expulsan)
GATE_MIN = 0.52            # victorias que debe lograr la red candidata contra la actual para sustituirla
EVAL_SEED = 7


def log(msg):
    line = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
    print(line, flush=True)
    LOG.parent.mkdir(exist_ok=True)
    with open(LOG, 'a', encoding='utf8') as f:
        f.write(line + '\n')


def stopping():
    return STOP.exists()


def _jload(path, default):
    return json.loads(Path(path).read_text(encoding='utf8')) if Path(path).exists() else default


def _jsave(path, obj):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(obj, ensure_ascii=False, indent=1), encoding='utf8')


# ----------------------------------------------------------------------------- salón de mazos
def deck_key(legends, main):
    raw = json.dumps([sorted(legends), sorted(main.items())])
    return hashlib.md5(raw.encode()).hexdigest()[:10]


def seed_hall(F, DB):
    """Mazos de partida: los 4 del meta (marcados) y los de decks/ que se pueden armar."""
    hall = {}
    for folder, meta in (('meta', True), ('decks', False)):
        for f in sorted((HERE / folder).glob('*.json')):
            d = F.load_deck(f)
            if 'main' not in d or len(d.get('legends', [])) != 3 or set(d['legends']) & DB.UNAVAILABLE:
                continue
            k = deck_key(d['legends'], d['main'])
            hall.setdefault(k, dict(id=k, name=d['name'], legends=list(d['legends']), main=dict(d['main']), meta=meta, born=0))
    return hall


def entry_ids(F, e):
    return F.ids_of(e['main'])


def prune_hall(hall):
    if len(hall) <= HALL_MAX:
        return
    keep = {k for k, e in hall.items() if e.get('meta')}
    rest = sorted((e for k, e in hall.items() if k not in keep), key=lambda e: -(e.get('eval', {}).get('avg', 0)))
    best_vs = {}
    for e in hall.values():
        for j, v in enumerate(e.get('eval', {}).get('per', [])):
            if j not in best_vs or v > best_vs[j][0]:
                best_vs[j] = (v, e['id'])
    keep |= {i for _, i in best_vs.values()}
    for e in rest:
        if len(keep) >= HALL_MAX:
            break
        keep.add(e['id'])
    for k in list(hall):
        if k not in keep:
            del hall[k]


# ----------------------------------------------------------------------------- A) juego
def accumulate(rows, np):
    X = np.array([r[0] for r in rows], dtype=np.float32)
    y = np.array([r[1] for r in rows], dtype=np.float32)
    h = np.array([r[2] for r in rows], dtype=np.float32)
    if POS.exists() and np.load(POS)['X'].shape[1] != X.shape[1]:
        POS.unlink()                       # cambiaron las variables de la red: los datos viejos ya no valen
    if POS.exists():
        old = np.load(POS)
        X, y, h = np.concatenate([old['X'], X]), np.concatenate([old['y'], y]), np.concatenate([old['h'], h])
    elif OLD_DATA.exists() and len(json.load(open(OLD_DATA))[0][0]) == X.shape[1]:
        o = json.load(open(OLD_DATA))
        X = np.concatenate([np.array([r[0] for r in o], dtype=np.float32), X])
        y = np.concatenate([np.array([r[1] for r in o], dtype=np.float32), y])
        h = np.concatenate([np.array([r[2] for r in o], dtype=np.float32), h])
    X, y, h = X[-POS_CAP:], y[-POS_CAP:], h[-POS_CAP:]
    np.savez(POS, X=X, y=y, h=h)
    return X, y, h


def game_stage(F, V, hall, cycle, procs, n_fast, n_deep, gate_games, epochs, adopt=True):
    import numpy as np
    cur = V.MODEL
    if not cur.exists():
        log('No hay red actual (data/valfn.json): ejecuta antes `forge.py valfn collect` y `valfn train`.')
        return None
    NETS.mkdir(parents=True, exist_ok=True)
    if not (NETS / 'red_inicial.json').exists():
        shutil.copy(cur, NETS / 'red_inicial.json')
    extra = [(e['name'], entry_ids(F, e), e['legends']) for e in hall.values()]
    t0 = time.time()
    rows = V.gather(n_fast, n_deep, procs, seed=100 + cycle, vf=f'action@{cur}', extra=extra)
    log(f'  A1) {len(rows)} posiciones nuevas de {n_fast}+{n_deep} partidas con la red actual [{time.time() - t0:.0f}s]')
    if stopping():
        return None
    X, y, h = accumulate(rows, np)
    cand = NETS / 'candidata.json'
    t0 = time.time()
    stats = V.train_arrays(X, y, h, cand, epochs=epochs, quiet=True)
    log(f"  A2) red candidata con {len(X)} posiciones: acierto en prueba {stats['test_acc']:.1%}, "
        f"pérdida {stats['test_loss']:.4f} [{time.time() - t0:.0f}s]")
    if stopping():
        return None
    meta = [e for e in hall.values() if e.get('meta')]
    best = max((e for e in hall.values() if not e.get('meta')), key=lambda e: e.get('eval', {}).get('avg', 0), default=None)
    decks = [(e['name'], entry_ids(F, e), e['legends']) for e in meta + ([best] if best else [])]
    t0 = time.time()
    wa, wb = V.compare(decks, gate_games, procs, seed=500 + cycle, variant=f'action@{cand}', other=f'action@{cur}', quiet=True)
    share = wa / max(1, wa + wb)
    ok = share >= GATE_MIN and adopt
    log(f'  A3) duelo candidata contra actual: {share:.1%} en {wa + wb} partidas '
        f'(mínimo {GATE_MIN:.0%}) -> {"ADOPTADA" if ok else ("descartada" if adopt else "prueba, no se adopta")} [{time.time() - t0:.0f}s]')
    hist = _jload(HISTORY, [])
    n_adopted = sum(1 for x in hist if x.get('adopted'))
    if ok:
        shutil.copy(cur, NETS / f'red_{n_adopted:03d}_anterior.json')
        shutil.copy(cand, cur)
    hist.append(dict(cycle=cycle, time=time.strftime('%Y-%m-%d %H:%M'), positions=int(len(X)), duel=round(share, 4),
                     duel_games=wa + wb, adopted=ok, test_acc=round(stats['test_acc'], 4)))
    _jsave(HISTORY, hist)
    return ok


# ----------------------------------------------------------------------------- B) mazos
def evaluate_hall(F, hall, field, cycle, games, procs, net_sig, force):
    F.set_deep(True)
    F.set_vf('action')
    todo = [e for e in hall.values() if force or e.get('eval', {}).get('net') != net_sig]
    for i, e in enumerate(todo):
        if stopping():
            break
        t0 = time.time()
        per = F.gauntlet(entry_ids(F, e), e['legends'], field, games, EVAL_SEED, procs)
        e['eval'] = dict(per=[round(v, 4) for v in per], avg=round(sum(per) / len(per), 4), net=net_sig, cycle=cycle, games=games)
        log(f"  B2) [{i + 1}/{len(todo)}] {e['name'][:48]}: {e['eval']['avg']:.1%}  [{time.time() - t0:.0f}s]")
    F.set_vf('hand')


def deck_stage(F, DB, hall, field, cycle, procs, iters, fit_games, eval_games, net_sig):
    """Afina, para cada situación, el mejor mazo conocido con búsqueda local y lo mete en el salón."""
    sits = [('todo el meta', field, lambda e: e['eval']['avg'])] + [
        (f"contra {f['name'][7:30]}", [f], (lambda j: lambda e: e['eval']['per'][j])(j)) for j, f in enumerate(field)]
    jobs = []
    for name, fld, score in sits:
        have = [e for e in hall.values() if 'eval' in e]
        if not have:
            continue
        best = max(have, key=score)
        jobs.append((name, (best['legends'], fld, entry_ids(F, best), iters, fit_games, 1000 * cycle + len(jobs))))
    log(f'  B1) búsqueda local en {len(jobs)} situaciones ({iters} iteraciones)')
    F.set_vf('hand')
    F.set_deep(False)
    with Pool(min(procs, len(jobs))) as p:
        res = p.map(F._opt_run, [j[1] for j in jobs])
    new = 0
    for (name, args), (deck, fit) in zip(jobs, res):
        legs = args[0]
        errs, _ = DB.validate(legs, F.rows_of(deck))
        main = dict(Counter(deck))
        k = deck_key(legs, main)
        if errs or k in hall:
            continue
        hall[k] = dict(id=k, name=f'afinado {name} (vuelta {cycle})', legends=list(legs), main=main, meta=False, born=cycle)
        new += 1
    log(f'  B1) {new} mazos nuevos en el salón')
    F.set_deep(True)


# ----------------------------------------------------------------------------- informe
def write_report(F, hall, field, net_sig):
    hist = _jload(HISTORY, [])
    L = ['# Auto-mejora de deckforge', '',
         f"Actualizado {time.strftime('%Y-%m-%d %H:%M')} · red vigente `{net_sig}` · {len(hist)} vueltas · "
         f"{sum(1 for x in hist if x.get('adopted'))} redes adoptadas", '',
         'Es un modelo: sirve para comparar y entender, no como probabilidad real. Las cifras de mazos son con la IA vigente '
         'en los dos lados y llevan ruido de ±3 a 4 puntos por rival.', '', '## Mejor mazo por situación', '']
    ev = [e for e in hall.values() if 'eval' in e]
    if ev:
        b = max(ev, key=lambda e: e['eval']['avg'])
        L.append(f"- **Contra todo el meta**: {b['name']} — {b['eval']['avg']:.1%}")
        for j, f in enumerate(field):
            c = max(ev, key=lambda e: e['eval']['per'][j])
            gap = c['eval']['per'][j] - b['eval']['per'][j]
            note = '' if c is b else (f" (solo {gap * 100:+.0f} puntos sobre el mejor general: dentro del ruido, no hay ventaja clara)"
                                      if gap < 0.06 else f" ({gap * 100:+.0f} puntos sobre el mejor general)")
            L.append(f"- **{f['name']}**: {c['name']} — {c['eval']['per'][j]:.1%}{note}")
    L += ['', '## Salón de mazos', '', '| Mazo | Meta | ' + ' | '.join(f['name'][7:22] for f in field) + ' |', '|---|---|' + '---|' * len(field)]
    for e in sorted(ev, key=lambda e: -e['eval']['avg']):
        L.append(f"| {e['name'][:50]} | {e['eval']['avg']:.0%} | " + ' | '.join(f'{v:.0%}' for v in e['eval']['per']) + ' |')
    L += ['', '## Historial de la IA', '', '| Vuelta | Fecha | Posiciones | Duelo | Adoptada |', '|---|---|---|---|---|']
    for x in hist:
        L.append(f"| {x['cycle']} | {x['time']} | {x['positions']} | {x['duel']:.1%} ({x['duel_games']}) | {'sí' if x['adopted'] else 'no'} |")
    if ev:
        b = max(ev, key=lambda e: e['eval']['avg'])
        L += ['', '## Lista del mejor mazo (texto para importar en la web)', '', '```', F.deck_to_text(
            dict(name=b['name'], legends=b['legends'], main=b['main'])), '```']
    REPORT.write_text('\n'.join(L) + '\n', encoding='utf8')


# ----------------------------------------------------------------------------- bucle
def run(cycles=1, hours=0.0, procs=4, quick=False):
    import cardsdb as DB
    import forge as F
    import valfn as V
    if STOP.exists():
        STOP.unlink()
    t_end = time.time() + hours * 3600 if hours else None
    p = dict(n_fast=40, n_deep=10, gate_games=20, epochs=3, iters=4, fit_games=6, eval_games=10) if quick else \
        dict(n_fast=4000, n_deep=300, gate_games=140, epochs=30, iters=60, fit_games=30, eval_games=160)
    field = F.load_field(HERE / 'meta')
    hall = _jload(HALL, None) or seed_hall(F, DB)
    hall = {k: e for k, e in hall.items()}
    hist = _jload(HISTORY, [])
    cycle = (hist[-1]['cycle'] if hist else 0)
    n = 0
    while True:
        cycle += 1
        n += 1
        log(f'=== VUELTA {cycle} ===')
        ok = game_stage(F, V, hall, cycle, procs, p['n_fast'], p['n_deep'], p['gate_games'], p['epochs'], adopt=not quick)
        net_sig = f"{len(_jload(HISTORY, []))}:{sum(1 for x in _jload(HISTORY, []) if x.get('adopted'))}"
        if not stopping():
            evaluate_hall(F, hall, field, cycle, p['eval_games'], procs, net_sig, force=False)
            _jsave(HALL, hall)
        if not stopping():
            deck_stage(F, DB, hall, field, cycle, procs, p['iters'], p['fit_games'], p['eval_games'], net_sig)
            evaluate_hall(F, hall, field, cycle, p['eval_games'], procs, net_sig, force=False)
            prune_hall(hall)
            _jsave(HALL, hall)
        write_report(F, hall, field, net_sig)
        log(f'Vuelta {cycle} terminada. Informe: {REPORT}')
        if stopping():
            log('Parada pedida (out/evolve.STOP).')
            break
        if cycles and n >= cycles:
            break
        if t_end and time.time() > t_end:
            break
    return 0
