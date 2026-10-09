"""Content-addressed storage: compressed text blobs and image thumbnails, deduplicated by hash."""
from __future__ import annotations

import gzip
import hashlib
import io
import json
import os
import tempfile

THUMB_MAX = 384


def sha1(data: bytes) -> str:
    return hashlib.sha1(data).hexdigest()


class Store:
    def __init__(self, root: str):
        self.root = root
        for sub in ("blobs", "thumbs", "bundle_index", "snapshots", "reports"):
            os.makedirs(os.path.join(root, sub), exist_ok=True)

    def path(self, kind: str, key: str, ext: str) -> str:
        return os.path.join(self.root, kind, key[:2], key + ext)

    @staticmethod
    def _atomic_write(path: str, data: bytes) -> None:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path))
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        try:
            os.replace(tmp, path)
        except PermissionError:
            # another worker is writing the same content-addressed file right now
            os.remove(tmp)
            if not os.path.exists(path):
                raise

    # text / binary blobs
    def put_blob(self, data: bytes, key: str | None = None) -> str:
        key = key or sha1(data)
        p = self.path("blobs", key, ".gz")
        if not os.path.exists(p):
            self._atomic_write(p, gzip.compress(data, 6))
        return key

    def get_blob(self, key: str) -> bytes | None:
        p = self.path("blobs", key, ".gz")
        if not os.path.exists(p):
            return None
        with open(p, "rb") as f:
            return gzip.decompress(f.read())

    # thumbnails
    def has_thumb(self, key: str) -> bool:
        return os.path.exists(self.path("thumbs", key, ".webp"))

    def put_thumb(self, key: str, img, flip: bool = False) -> None:
        """`img` may be changed. `flip`: turn it upside down (done on the small copy: cheaper)."""
        p = self.path("thumbs", key, ".webp")
        if os.path.exists(p):
            return
        from PIL import Image
        # snapshots make tens of thousands of these: average whole pixel blocks first (one cheap pass), then a
        # bilinear step to the size, then the fastest WebP method — ~2x quicker than thumbnail() on the full picture
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGBA")
        k = max(img.size) // THUMB_MAX
        if k > 1:
            img = img.reduce(k)
        img.thumbnail((THUMB_MAX, THUMB_MAX), Image.Resampling.BILINEAR)
        if flip:
            img = img.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
        if img.mode == "RGBA" and img.getextrema()[3][0] == 255:  # no transparency: no alpha plane to encode
            img = img.convert("RGB")
        buf = io.BytesIO()
        img.save(buf, "WEBP", quality=75, method=0)
        self._atomic_write(p, buf.getvalue())

    def thumb_path(self, key: str) -> str | None:
        p = self.path("thumbs", key, ".webp")
        return p if os.path.exists(p) else None

    # gzipped json documents
    def write_json(self, rel: str, obj) -> str:
        p = os.path.join(self.root, rel)
        self._atomic_write(p, gzip.compress(json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8"), 6))
        return p

    def read_json(self, rel: str):
        p = os.path.join(self.root, rel)
        if not os.path.exists(p):
            return None
        with open(p, "rb") as f:
            return json.loads(gzip.decompress(f.read()))

    def exists(self, rel: str) -> bool:
        return os.path.exists(os.path.join(self.root, rel))
