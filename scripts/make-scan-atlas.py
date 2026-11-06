#!/usr/bin/env python3
"""Genera el atlas de referencias del escáner de cartas (prototipo).

Junta todas las imágenes distintas del catálogo (cartas base y artes alternativos) en una sola hoja de
miniaturas diminutas (72x100 px por carta). El navegador calcula de ahí el descriptor de cada carta, igual que
lo hace con la foto de la cámara, y compara.

    pip install Pillow
    python scripts/make-scan-atlas.py

Salida:  public/scan/atlas.webp  y  public/scan/atlas.json
"""
import hashlib
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CELL_W, CELL_H = 72, 100
COLS = 20

cards = json.loads((ROOT / "src/data/cards.json").read_text(encoding="utf8"))

refs = []  # una entrada por imagen distinta
seen = {}
for c in cards:
    owned = [("base", None, c["image"])] + [("alt", a["id"], a["image"]) for a in c["altArts"] if a.get("image")]
    for kind, alt_id, rel in owned:
        path = ROOT / "public" / rel
        digest = hashlib.md5(path.read_bytes()).hexdigest()
        if digest in seen:
            refs[seen[digest]]["also"].append({"card": c["id"], "art": None if alt_id is None else f"alt:{alt_id}"})
            continue
        seen[digest] = len(refs)
        refs.append({"card": c["id"], "art": None if alt_id is None else f"alt:{alt_id}", "image": rel, "also": []})

rows = -(-len(refs) // COLS)
atlas = Image.new("RGB", (COLS * CELL_W, rows * CELL_H))
for i, r in enumerate(refs):
    with Image.open(ROOT / "public" / r["image"]) as im:
        cell = im.convert("RGB").resize((CELL_W, CELL_H), Image.LANCZOS)
    atlas.paste(cell, ((i % COLS) * CELL_W, (i // COLS) * CELL_H))

out = ROOT / "public" / "scan"
out.mkdir(parents=True, exist_ok=True)
atlas.save(out / "atlas.webp", "WEBP", quality=88, method=6)
(out / "atlas.json").write_text(json.dumps({"cell": [CELL_W, CELL_H], "cols": COLS, "refs": refs}, ensure_ascii=False, separators=(",", ":")), encoding="utf8")
print(f"atlas: {len(refs)} referencias en {COLS}x{rows} celdas, {(out / 'atlas.webp').stat().st_size // 1024} KB")
