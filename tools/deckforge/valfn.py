"""Valoración de posición APRENDIDA de partidas simuladas (sustituye a la puntuación escrita a mano de `ai2.evalpos`).

Idea: al terminar el turno de un jugador se guardan variables de la posición (Gigs, mesa, mano, Eddies, Legends...) y,
cuando la partida acaba, quién ganó. Una red pequeña aprende P(gana | posición). La previsión de la IA (`choose_plan`)
compara planes por esa probabilidad en vez de por la fórmula a mano.

    forge.py valfn collect   genera datos (partidas entre los mazos de decks/ y meta/)
    forge.py valfn train     ajusta la red (necesita torch) y escribe data/valfn.json
    forge.py valfn compare   IA con la valoración aprendida contra la IA de siempre (mismo mazo en los dos lados)

Usar el modelo ya ajustado no necesita torch ni numpy.
"""
import json
import math
import random
import re
from multiprocessing import Pool
from pathlib import Path

HERE = Path(__file__).resolve().parent
MODEL = HERE / 'data' / 'valfn.json'
DATA = HERE / 'out' / 'valfn_data.json'

NAMES = ('gigs_me', 'gigs_op', 'gigs_diff', 'cred_diff', 'units_me', 'units_op', 'pow_me', 'pow_op', 'pow_diff', 'uval_diff',
         'ready_op', 'ready_me', 'big_me', 'big_op', 'blk_me', 'blk_op', 'gear_me', 'gear_op', 'hand_me', 'hand_op',
         'deck_me', 'deck_op', 'E_me', 'E_op', 'legs_me', 'legs_op', 'turn', 'first', 'overtime', 'top_me', 'top_op')


# Condiciones de dados que piden las cartas, leídas de su TEXTO (así sirven también las cartas nuevas):
# pareja de valor, Gig mínimo, menos / más Street Cred que el rival, d4, Gig de 8+.
CATS = (('pair', r'value-pair|pair of'), ('min', r'min Gig|min or max|a min '), ('less', r'less\s+(?:☆|Street Cred)'),
        ('more', r'more\s+(?:☆|Street Cred)'), ('d4', r'd4'), ('high', r'8\+ value|value 8\+'))
_FL = {}
NAMES = NAMES + ('pairs_me', 'pairs_op', 'mins_me', 'mins_op', 'high_me', 'high_op', 'cred_me', 'cred_op', 'less', 'more', 'd4min')     + tuple(f'{w}_{k}' for w in ('live', 'deck', 'oplive', 'ok', 'opok') for k, _ in CATS)


def flags(cid):
    """Qué condiciones de dados menciona la carta (tupla de 0/1 en el orden de CATS)."""
    f = _FL.get(cid)
    if f is None:
        import cardsdb as DB
        t = (DB.BY[cid]['rules'] or '') if cid in DB.BY else ''
        f = _FL[cid] = tuple(1 if re.search(p, t, re.I) else 0 for _, p in CATS)
    return f


def _payoffs(ids):
    tot = [0] * len(CATS)
    for cid in ids:
        for k, v in enumerate(flags(cid)):
            tot[k] += v
    return tot


def _dice(p):
    vals = [v for _, v in p.gigs]
    cnt = {}
    for v in vals:
        cnt[v] = cnt.get(v, 0) + 1
    return (sum(n // 2 for n in cnt.values()), cnt.get(1, 0), sum(1 for v in vals if v >= 8),
            1 if any(d == 4 and v == 1 for d, v in p.gigs) else 0, sum(vals))


def _live(p):
    """Condiciones que piden las cartas que p puede usar ya: mano, mesa (con su Gear) y Legends sin sacar."""
    ids = [c['id'] for c in p.hand] + [u.c['id'] for u in p.field] + [x['id'] for u in p.field for x in u.gear]         + [l.c['id'] for l in p.legs if not l.gone]
    return _payoffs(ids)


def _deck_payoffs(p):
    d = getattr(p, '_dice_deck', None)
    if d is None:
        d = p._dice_deck = _payoffs(list(p.ids.elements()) + list(p.legids))
    return d


def dice_feats(g, me):
    """Colocación de los dados y cuánto la necesita el mazo: variables en bruto y cruzadas (dado × lo que piden las cartas)."""
    op = me.op
    pm, mn, hi, d4, cm = _dice(me)
    po, mo, ho, d4o, co = _dice(op)
    less = 1 if (me.gigs and op.gigs and cm < co) else 0
    more = 1 if (me.gigs and op.gigs and cm > co) else 0
    lm, lo = _live(me), _live(op)
    dk = _deck_payoffs(me)
    ok = [min(pm, 2) * min(lm[0], 3), min(mn, 2) * min(lm[1], 3), less * min(lm[2], 3), more * min(lm[3], 3),
          d4 * min(lm[4], 3), (1 if hi else 0) * min(lm[5], 3)]
    oo = [min(po, 2) * min(lo[0], 3), min(mo, 2) * min(lo[1], 3), (1 if (op.gigs and me.gigs and co < cm) else 0) * min(lo[2], 3),
          (1 if (op.gigs and me.gigs and co > cm) else 0) * min(lo[3], 3), d4o * min(lo[4], 3), (1 if ho else 0) * min(lo[5], 3)]
    return [pm, po, mn, mo, hi, ho, cm, co, less, more, d4] + lm + dk + lo + ok + oo


def feats(g, me):
    """Variables de la posición vista por `me` al terminar su turno (las 31 de siempre + las de dados)."""
    return base_feats(g, me) + dice_feats(g, me)


def base_feats(g, me):
    op = me.op
    pw_me = [g.power(u) for u in me.field]
    pw_op = [g.power(u) for u in op.field]
    uv = sum(g.power(u) + 1.5 * len(u.gear) + (1.5 if g.is_blocker(u) else 0) + 0.4 * u.c['cost'] + 1.0 for u in me.field) \
        - sum(g.power(u) + 1.5 * len(u.gear) + (1.5 if g.is_blocker(u) else 0) + 0.4 * u.c['cost'] + 1.0 for u in op.field)
    return [
        len(me.gigs), len(op.gigs), len(me.gigs) - len(op.gigs), me.cred() - op.cred(),
        len(me.field), len(op.field), sum(pw_me), sum(pw_op), sum(pw_me) - sum(pw_op), uv,
        sum(1 for u in op.field if u.ready), sum(1 for u in me.field if u.ready),
        sum(1 for p in pw_me if p >= 10), sum(1 for p in pw_op if p >= 10),
        sum(1 for u in me.field if g.is_blocker(u)), sum(1 for u in op.field if g.is_blocker(u)),
        sum(len(u.gear) for u in me.field), sum(len(u.gear) for u in op.field),
        len(me.hand), len(op.hand), len(me.deck), len(op.deck), me.E, op.E,
        sum(1 for l in me.legs if not l.gone), sum(1 for l in op.legs if not l.gone),
        g.turn, 1.0 if me.first else 0.0, 1.0 if g.overtime else 0.0,
        max(pw_me, default=0), max(pw_op, default=0),
    ]


# ----------------------------------------------------------------------------- uso del modelo (sin dependencias)
_M = {}


def _load(path=None):
    path = str(path or MODEL)
    if path not in _M:
        _M[path] = json.load(open(path, encoding='utf8')) if Path(path).exists() else False
    return _M[path]


def prob(x, path=None):
    """P(gana) para el vector de variables `x`, o None si no hay modelo ajustado. `path`: otro modelo distinto del actual.
    Un modelo antiguo solo mira las primeras variables."""
    m = _load(path)
    if not m:
        return None
    try:
        import numpy as np
    except ImportError:
        np = None
    if np is not None:
        if '_np' not in m:
            m['_np'] = ([np.array(w, dtype=np.float64) for w, _ in m['layers']], [np.array(b, dtype=np.float64) for _, b in m['layers']],
                        np.array(m['mean']), np.array(m['std']))
        Ws, bs, mean, std = m['_np']
        h = (np.asarray(x[:len(mean)], dtype=np.float64) - mean) / std
        for i, (W, b) in enumerate(zip(Ws, bs)):
            h = W @ h + b
            if i < len(Ws) - 1:
                h = np.maximum(h, 0.0)
        t = max(-30.0, min(30.0, float(h[0])))
        return 1.0 / (1.0 + math.exp(-t))
    z = [(v - mu) / sd for v, mu, sd in zip(x, m['mean'], m['std'])]
    h = z
    layers = m['layers']
    for i, (W, b) in enumerate(layers):
        h = [sum(w * v for w, v in zip(row, h)) + bb for row, bb in zip(W, b)]
        if i < len(layers) - 1:
            h = [v if v > 0 else 0.0 for v in h]
    t = max(-30.0, min(30.0, h[0]))
    return 1.0 / (1.0 + math.exp(-t))


def has_dice(path=None):
    """¿Conoce esta red las variables de dados? (las redes antiguas solo miran las 31 primeras)"""
    m = _load(path)
    return bool(m) and len(m['mean']) > 31


SCALE = 20.0


def score(g, me, path=None):
    """Misma escala que `evalpos` a mano (positivo = mejor para `me`); None si no hay modelo."""
    p = prob(feats(g, me), path)
    return None if p is None else SCALE * (p - 0.5)


# ----------------------------------------------------------------------------- recogida de datos
def _pool_decks():
    import forge as F
    out = []
    for folder in ('meta', 'decks'):
        for f in sorted((HERE / folder).glob('*.json')):
            d = F.load_deck(f)
            if 'main' in d and len(d.get('legends', [])) == 3:
                out.append((d['name'], F.ids_of(d['main']), list(d['legends'])))
    return out


def _collect_job(args):
    seed, n, deep, vf, extra = args
    import engine2 as X
    rng = random.Random(seed)
    decks = _pool_decks() + [tuple(x) for x in extra]
    rows = []
    for k in range(n):
        a, b = rng.choice(decks), rng.choice(decks)
        e = rng.choice((0.0, 0.0, 0.1, 0.2)) if vf != 'hand' else 0.0     # con la IA nueva, también posiciones de jugadores que fallan
        g = X.Game(a[1], a[2], b[1], b[2], seed * 100003 + k, deep=(deep, deep), vf=(vf, vf), err=(e, e))
        g.rec = []
        w = g.run()
        if w < 0:
            continue
        for pi, _t, x, hand in g.rec:
            rows.append((x, 1 if pi == w else 0, hand))
    return rows


def gather(n_fast, n_deep, procs, seed=11, vf='hand', extra=()):
    """Partidas entre los mazos de meta/, decks/ y `extra` [(nombre, ids, legends)]; devuelve [(variables, ganó, fórmula a mano)]."""
    jobs = []
    per = 100 if vf != 'hand' else 200
    for i in range(0, n_fast, per):
        jobs.append((seed * 1000 + i, min(per, n_fast - i), False, vf, list(extra)))
    per = 20
    for i in range(0, n_deep, per):
        jobs.append((seed * 1000 + 500000 + i, min(per, n_deep - i), True, vf, list(extra)))
    rows = []
    with Pool(procs) as p:
        for r in p.imap_unordered(_collect_job, jobs):
            rows += r
    return rows


def collect(n_fast, n_deep, procs, seed=11, out=None, vf='hand'):
    rows = gather(n_fast, n_deep, procs, seed, vf=vf)
    out = Path(out or DATA)
    out.parent.mkdir(exist_ok=True)
    json.dump(rows, open(out, 'w'))
    print(f'{len(rows)} posiciones de {n_fast} partidas rápidas y {n_deep} con previsión -> {out}')


# ----------------------------------------------------------------------------- entrenamiento
def train(epochs=60, hidden=48, seed=0, out=None, data=None):
    import numpy as np
    rows = json.load(open(data or DATA))
    X = np.array([r[0] for r in rows], dtype=np.float32)
    y = np.array([r[1] for r in rows], dtype=np.float32)
    hand = np.array([r[2] for r in rows], dtype=np.float32)
    return train_arrays(X, y, hand, out or MODEL, epochs, hidden, seed)


def train_arrays(X, y, hand, out, epochs=60, hidden=48, seed=0, quiet=False):
    """Ajusta la red con posiciones X (n×variables), resultados y (1 = ganó quien movió) y la fórmula a mano `hand`."""
    import numpy as np
    import torch
    rng = np.random.default_rng(seed)
    idx = rng.permutation(len(X))
    cut = int(0.85 * len(X))
    tr, te = idx[:cut], idx[cut:]
    mean, std = X[tr].mean(0), X[tr].std(0) + 1e-6
    Z = (X - mean) / std
    torch.manual_seed(seed)
    net = torch.nn.Sequential(torch.nn.Linear(X.shape[1], hidden), torch.nn.ReLU(), torch.nn.Linear(hidden, hidden), torch.nn.ReLU(),
                              torch.nn.Linear(hidden, 1))
    opt = torch.optim.Adam(net.parameters(), lr=2e-3, weight_decay=1e-5)
    Zt, yt = torch.tensor(Z[tr]), torch.tensor(y[tr])
    Ze, ye = torch.tensor(Z[te]), torch.tensor(y[te])
    lossf = torch.nn.BCEWithLogitsLoss()
    best = (9.0, None)
    for ep in range(epochs):
        perm = torch.randperm(len(Zt))
        for i in range(0, len(perm), 512):
            b = perm[i:i + 512]
            opt.zero_grad()
            loss = lossf(net(Zt[b]).squeeze(1), yt[b])
            loss.backward()
            opt.step()
        with torch.no_grad():
            le = lossf(net(Ze).squeeze(1), ye).item()
        if le < best[0]:
            best = (le, [p.detach().clone() for p in net.parameters()])
    with torch.no_grad():
        for p, q in zip(net.parameters(), best[1]):
            p.copy_(q)
        pe = torch.sigmoid(net(Ze).squeeze(1)).numpy()
    acc = float(((pe > 0.5) == (y[te] > 0.5)).mean())
    h = hand[te]
    acc_hand = float(((h > 0) == (y[te] > 0.5)).mean())
    base = float(-np.mean(y[te] * np.log(np.clip(y[te].mean(), 1e-6, 1)) + (1 - y[te]) * np.log(np.clip(1 - y[te].mean(), 1e-6, 1))))
    if not quiet:
        print(f'{len(X)} posiciones ({len(te)} de prueba) · pérdida {best[0]:.4f} (sin saber nada: {base:.4f}) · '
              f'acierto de la red {acc:.1%} · acierto de la fórmula a mano {acc_hand:.1%}')
    ps = list(net.parameters())
    layers = []
    for W, b in zip(ps[0::2], ps[1::2]):
        layers.append([W.detach().numpy().tolist(), b.detach().numpy().tolist()])
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    stats = dict(test_loss=best[0], test_acc=acc, hand_acc=acc_hand, n=int(len(X)))
    json.dump(dict(names=list(NAMES), mean=mean.tolist(), std=std.tolist(), layers=layers, **stats), open(out, 'w'))
    if not quiet:
        print(f'modelo guardado en {out}')
    return stats


# ----------------------------------------------------------------------------- comparación
def _cmp_job(args):
    ids, legs, fids, flegs, n, seed, a_learned, variant, other = args
    import engine2 as X
    vf = (variant, other) if a_learned else (other, variant)
    w, _ = X.play(ids, legs, fids, flegs, N=n, seed=seed, deep=(True, True), vf=vf)
    return (w[0], w[1]) if a_learned else (w[1], w[0])      # (victorias de la aprendida, victorias de la de siempre)


def compare(decks, games, procs, seed=3, variant='learned', other='hand', quiet=False):
    """Cada mazo contra sí mismo y contra los demás: lado A con valoración aprendida, lado B con la de siempre."""
    jobs = []
    names = []
    for i, a in enumerate(decks):
        for b in decks[i:]:
            for side in (True, False):               # la aprendida juega los dos lados, para no mezclar con la fuerza del mazo
                jobs.append((a[1], a[2], b[1], b[2], games // 2, seed, side, variant, other))
                names.append(f'{a[0][:26]} vs {b[0][:26]}')
    with Pool(procs) as p:
        res = p.map(_cmp_job, jobs)
    tw = tl = 0
    agg = {}
    for nm, (w, l) in zip(names, res):
        x = agg.setdefault(nm, [0, 0])
        x[0] += w
        x[1] += l
    for nm, (w, l) in agg.items():
        tw += w
        tl += l
        if not quiet:
            print(f'  {w / max(1, w + l):5.1%}  {nm}')
    if not quiet:
        print(f'{variant} contra {other}: {tw / max(1, tw + tl):.1%} en {tw + tl} partidas decididas '
              f'(±{100 * math.sqrt(0.25 / max(1, tw + tl)):.1f} puntos)')
    return tw, tl
