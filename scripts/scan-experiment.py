"""Experimento del escáner de cartas: ¿qué descriptor reconoce mejor una carta fotografiada?

Se simulan fotos de móvil a partir de nuestras propias imágenes (perspectiva, giro, luz, tinte, reflejos, desenfoque,
ruido y JPEG) y se compara cada técnica de huella. La elegida (rejilla 12x16 en Lab normalizada + coseno) es la que
implementa src/lib/scan/descriptor.ts.

    pip install numpy opencv-python
    python scripts/scan-experiment.py
"""
import hashlib, json, sys, time
from pathlib import Path

import cv2
import numpy as np

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parent.parent
cards = json.load(open(ROOT / 'src/data/cards.json', encoding='utf8'))

# ---- referencias: imágenes distintas (por contenido) ----
refs = []  # (key, label, path)
seen = {}
for c in cards:
    items = [(f"base:{c['id']}", c['displayName'], c['image'])] + [(f"alt:{c['id']}:{a['id']}", f"{c['displayName']} [{a['id']}]", a['image']) for a in c['altArts'] if a.get('image')]
    for key, label, rel in items:
        p = ROOT / 'public' / rel
        h = hashlib.md5(p.read_bytes()).hexdigest()
        if h in seen:
            continue
        seen[h] = key
        refs.append((key, label, p))
print('referencias distintas:', len(refs))

SIZE = (360, 504)  # ancho, alto de trabajo para fabricar "fotos"
imgs = []
for _, _, p in refs:
    im = cv2.imread(str(p), cv2.IMREAD_COLOR)
    imgs.append(cv2.resize(im, SIZE, interpolation=cv2.INTER_AREA))

rng = np.random.default_rng(7)


def perturb(im, level):
    """Simula una foto de móvil. level: 'suave' o 'dura'."""
    w, h = SIZE
    k = 0.025 if level == 'suave' else 0.05
    rot = 2.0 if level == 'suave' else 4.0
    gam = (0.8, 1.25) if level == 'suave' else (0.65, 1.5)
    # perspectiva + giro + escala + traslación sobre fondo oscuro/gris
    src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    jit = rng.uniform(-k, k, (4, 2)) * np.float32([w, h])
    s = rng.uniform(0.93, 1.04)
    ang = np.deg2rad(rng.uniform(-rot, rot))
    cx, cy = w / 2 + rng.uniform(-0.02, 0.02) * w, h / 2 + rng.uniform(-0.02, 0.02) * h
    R = np.array([[np.cos(ang), -np.sin(ang)], [np.sin(ang), np.cos(ang)]])
    dst = ((src - [w / 2, h / 2]) * s) @ R.T + [cx, cy] + jit
    M = cv2.getPerspectiveTransform(src, dst.astype(np.float32))
    bg = rng.integers(10, 90)
    out = cv2.warpPerspective(im, M, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(int(bg),) * 3)
    f = out.astype(np.float32) / 255
    # gamma, contraste, ganancia de color, saturación
    f = np.clip(f, 0, 1) ** rng.uniform(*gam)
    f = (f - 0.5) * rng.uniform(0.8, 1.2) + 0.5
    f = f * rng.uniform(0.9, 1.1, 3)[None, None, :]
    hsv = cv2.cvtColor(np.clip(f, 0, 1).astype(np.float32), cv2.COLOR_BGR2HSV)
    hsv[..., 1] = np.clip(hsv[..., 1] * rng.uniform(0.75, 1.25), 0, 1)
    f = cv2.cvtColor(hsv.astype(np.float32), cv2.COLOR_HSV2BGR)
    # reflejos
    if rng.random() < (0.4 if level == 'suave' else 0.7):
        for _ in range(rng.integers(1, 3)):
            gx, gy = rng.uniform(0, w), rng.uniform(0, h)
            sig = rng.uniform(0.08, 0.25) * w
            yy, xx = np.mgrid[0:h, 0:w]
            blob = np.exp(-(((xx - gx) ** 2 + (yy - gy) ** 2) / (2 * sig ** 2)))[..., None]
            f = f + blob * rng.uniform(0.2, 0.55)
    f = np.clip(f, 0, 1)
    # tamaño de cámara, desenfoque, ruido y JPEG
    cam = cv2.resize((f * 255).astype(np.uint8), (240, 336), interpolation=cv2.INTER_AREA)
    sigma = rng.uniform(0, 1.0 if level == 'suave' else 1.8)
    if sigma > 0.2:
        cam = cv2.GaussianBlur(cam, (0, 0), sigma)
    cam = np.clip(cam.astype(np.float32) + rng.normal(0, 3 if level == 'suave' else 8, cam.shape), 0, 255).astype(np.uint8)
    ok, enc = cv2.imencode('.jpg', cam, [cv2.IMWRITE_JPEG_QUALITY, int(rng.integers(60, 90) if level == 'suave' else rng.integers(35, 80))])
    return cv2.imdecode(enc, cv2.IMREAD_COLOR)


# ---- descriptores ----
def crop_inner(im, m=0.05):
    h, w = im.shape[:2]
    return im[int(h * m):int(h * (1 - m)), int(w * m):int(w * (1 - m))]


def norm(v):
    v = v - v.mean()
    s = v.std()
    return v / (s + 1e-6)


def d_grid(im, gw, gh, space='lab'):
    im = crop_inner(im)
    s = cv2.resize(im, (gw, gh), interpolation=cv2.INTER_AREA)
    if space == 'lab':
        s = cv2.cvtColor(s, cv2.COLOR_BGR2LAB)
    f = s.astype(np.float32)
    out = []
    for c in range(3):  # cada canal normalizado por separado: absorbe brillo/tinte globales
        out.append(norm(f[..., c]).ravel())
    return np.concatenate(out)


def d_phash(im):
    g = cv2.cvtColor(crop_inner(im), cv2.COLOR_BGR2GRAY)
    g = cv2.resize(g, (32, 44), interpolation=cv2.INTER_AREA).astype(np.float32)
    dct = cv2.dct(g)[:8, :8].ravel()
    return norm(dct[1:])


def d_hog(im, cw=4, ch=6, bins=8):
    g = cv2.cvtColor(crop_inner(im), cv2.COLOR_BGR2GRAY)
    g = cv2.resize(g, (48, 66), interpolation=cv2.INTER_AREA).astype(np.float32)
    gx = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)
    mag = np.hypot(gx, gy)
    ang = (np.arctan2(gy, gx) % np.pi) / np.pi * bins
    H, W = g.shape
    out = []
    for j in range(ch):
        for i in range(cw):
            ys, xs = slice(j * H // ch, (j + 1) * H // ch), slice(i * W // cw, (i + 1) * W // cw)
            hist = np.bincount(np.clip(ang[ys, xs].astype(int), 0, bins - 1).ravel(), weights=mag[ys, xs].ravel(), minlength=bins)
            out.append(hist / (hist.sum() + 1e-6))
    return norm(np.concatenate(out))


def d_hsv(im):
    hsv = cv2.cvtColor(crop_inner(im), cv2.COLOR_BGR2HSV)
    out = []
    H, W = hsv.shape[:2]
    for j in range(3):
        for i in range(3):
            c = hsv[j * H // 3:(j + 1) * H // 3, i * W // 3:(i + 1) * W // 3]
            hist = cv2.calcHist([c], [0, 1], None, [12, 3], [0, 180, 0, 256]).ravel()
            out.append(hist / (hist.sum() + 1e-6))
    return norm(np.concatenate(out))


METHODS = {
    'rejilla Lab 6x8': lambda im: d_grid(im, 6, 8),
    'rejilla Lab 12x16': lambda im: d_grid(im, 12, 16),
    'rejilla Lab 16x22': lambda im: d_grid(im, 16, 22),
    'rejilla RGB 12x16': lambda im: d_grid(im, 12, 16, 'bgr'),
    'pHash (DCT)': d_phash,
    'HOG (bordes)': d_hog,
    'histograma HSV 3x3': d_hsv,
    'Lab 12x16 + HOG': lambda im: np.concatenate([d_grid(im, 12, 16), d_hog(im)]),
    'Lab 12x16 + HOG + HSV': lambda im: np.concatenate([d_grid(im, 12, 16), d_hog(im), d_hsv(im)]),
}

if __name__ == '__main__':
    t0 = time.time()
    # descriptores de referencia (a tamaño de atlas pequeño para imitar lo que irá en la web)
    ATLAS = (72, 100)
    small = [cv2.resize(im, ATLAS, interpolation=cv2.INTER_AREA) for im in imgs]
    ref_desc = {m: np.stack([f(im) for im in small]) for m, f in METHODS.items()}
    print('descriptores de referencia:', round(time.time() - t0, 1), 's')

    results = {}
    for level, reps in (('suave', 3), ('dura', 3)):
        queries = []
        truth = []
        for r in range(reps):
            for idx, im in enumerate(imgs):
                queries.append(perturb(im, level))
                truth.append(idx)
        truth = np.array(truth)
        print(f'\n== fotos simuladas "{level}": {len(queries)} ==')
        # las consultas se reducen al tamaño del atlas igual que las referencias
        qs = [cv2.resize(q, ATLAS, interpolation=cv2.INTER_AREA) for q in queries]
        for m, f in METHODS.items():
            Q = np.stack([f(q) for q in qs])
            R = ref_desc[m]
            # similitud coseno (los vectores ya están centrados y escalados)
            sim = (Q / np.linalg.norm(Q, axis=1, keepdims=True)) @ (R / np.linalg.norm(R, axis=1, keepdims=True)).T
            order = np.argsort(-sim, axis=1)
            top1 = float((order[:, 0] == truth).mean())
            top3 = float(np.mean([t in o[:3] for t, o in zip(truth, order)]))
            top5 = float(np.mean([t in o[:5] for t, o in zip(truth, order)]))
            results.setdefault(m, {})[level] = (top1, top3, top5)
            print(f'  {m:26s} top1 {top1*100:5.1f}%  top3 {top3*100:5.1f}%  top5 {top5*100:5.1f}%')
    print('\ntiempo total', round(time.time() - t0, 1), 's')
