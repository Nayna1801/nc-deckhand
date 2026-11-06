#!/usr/bin/env python3
"""Genera miniaturas de las cartas para las galerías y listas.

Las imágenes originales miden 733x1024 (unos 3 MB decodificadas en memoria cada una). Las fichas se ven a
unos 170-250 px de ancho, así que se usan copias de 360 px de ancho (~0,7 MB decodificadas, ~25 KB en disco).
Los detalles y las previsualizaciones siguen usando la imagen completa.

    pip install Pillow
    python scripts/make-thumbs.py          # genera las que falten
    python scripts/make-thumbs.py --force  # regenera todas

public/cards/<x>.webp      ->  public/cards/t/<x>.webp
public/cards/alt/<x>.webp  ->  public/cards/t/alt/<x>.webp
(la app calcula la ruta con `thumbOf` en src/lib/images.ts)
"""
import sys
from pathlib import Path

from PIL import Image

WIDTH = 360
QUALITY = 80

root = Path(__file__).resolve().parent.parent / "public" / "cards"
force = "--force" in sys.argv

made = skipped = 0
for src in sorted(list(root.glob("*.webp")) + list((root / "alt").glob("*.webp"))):
    rel = src.relative_to(root)
    dst = root / "t" / rel
    if dst.exists() and not force:
        skipped += 1
        continue
    dst.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(src) as im:
        im = im.convert("RGB")
        height = round(im.height * WIDTH / im.width)
        im.resize((WIDTH, height), Image.LANCZOS).save(dst, "WEBP", quality=QUALITY, method=6)
    made += 1

print(f"miniaturas: {made} creadas, {skipped} ya existían")
