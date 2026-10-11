"""Pictures the game no longer has (Pilgrimage of Compassion enemies), shipped in ui/extra; used only when the game lacks
the file."""
from __future__ import annotations

import os

from .paths import resource_dir

ROOT = "Assets/Resources_moved/"


def _dir() -> str:
    return os.path.join(resource_dir(), "ui", "extra")


def files(sub: str) -> dict[str, str]:
    """{file name without extension: catalog path} of the pictures under ui/extra/<sub>/ (any depth)."""
    base, out = os.path.join(_dir(), *sub.split("/")), {}
    for d, _dirs, fns in os.walk(base):
        for fn in fns:
            if fn.endswith((".png", ".webp")):
                rel = os.path.relpath(os.path.join(d, fn), _dir()).replace(os.sep, "/")
                out.setdefault(os.path.splitext(fn)[0], ROOT + rel)
    return out


def file_of(path: str) -> str | None:
    """The shipped file of a catalog path, if it is one of ours."""
    if not path.startswith(ROOT) or ".." in path:
        return None
    p = os.path.join(_dir(), *path[len(ROOT):].split("/"))
    return p if os.path.isfile(p) else None
