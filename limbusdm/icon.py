"""App icon: ui/icon.png is the picture itself (the page's logo and favicon); the .ico for the exe is made from it."""
from __future__ import annotations

import os

PNG = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "ui", "icon.png")


def icon_image(size: int = 256):
    from PIL import Image

    return Image.open(PNG).convert("RGBA").resize((size, size), Image.LANCZOS)


def save_ico(path: str):
    img = icon_image(256)
    img.save(path, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
