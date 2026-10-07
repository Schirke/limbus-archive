"""KR/JP → English via Google's free translate endpoint, batched, throttled and cached on disk."""
from __future__ import annotations

import hashlib
import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

ENDPOINT = "https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl={tl}&"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
BATCH_CHARS = 1200   # raw characters per request (URL-encoded Korean is ~9x longer)
MIN_INTERVAL = 0.6   # seconds between requests

_lock = threading.Lock()
_net_lock = threading.Lock()


class RateLimited(Exception):
    pass


class Translator:
    def __init__(self, cache_path: str, target: str = "en"):
        self.cache_path = cache_path
        self.target = target
        self._last = 0.0
        self.cache: dict[str, str] = {}
        if os.path.exists(cache_path):
            try:
                with open(cache_path, encoding="utf-8") as f:
                    self.cache = json.load(f)
            except Exception:
                self.cache = {}

    def _key(self, text: str) -> str:
        return hashlib.sha1(f"{self.target}:{text}".encode()).hexdigest()

    def _request(self, texts: list[str]) -> list[str]:
        url = ENDPOINT.format(tl=self.target) + "&".join("q=" + urllib.parse.quote(t) for t in texts)
        for attempt in range(3):
            with _net_lock:
                wait = self._last + MIN_INTERVAL - time.time()
                if wait > 0:
                    time.sleep(wait)
                self._last = time.time()
            try:
                req = urllib.request.Request(url, headers={"User-Agent": UA})
                data = json.loads(urllib.request.urlopen(req, timeout=20).read())
                # one text → ["..."] or [["...", "ko"]]; several → [["...", "ko"], ...]
                out = []
                for x in data:
                    out.append(x[0] if isinstance(x, list) else x)
                return out
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    time.sleep(5 * (attempt + 1))
                    continue
                raise
        raise RateLimited("Google is rate-limiting translations right now, try again in a few minutes")

    def translate(self, texts: list[str]) -> list[str | None]:
        out: list[str | None] = [None] * len(texts)
        todo: list[int] = []
        for i, t in enumerate(texts):
            if not t or not t.strip():
                out[i] = t
            elif self._key(t) in self.cache:
                out[i] = self.cache[self._key(t)]
            else:
                todo.append(i)
        batch: list[int] = []
        size = 0
        try:
            for i in todo + [None]:
                if i is not None and (not batch or size + len(texts[i]) <= BATCH_CHARS):
                    batch.append(i)
                    size += len(texts[i])
                    continue
                if batch:
                    res = self._request([texts[j][:4000] for j in batch])
                    for j, r in zip(batch, res):
                        if r:
                            self.cache[self._key(texts[j])] = r
                        out[j] = r
                if i is not None:
                    batch, size = [i], len(texts[i])
        finally:
            if todo:
                self._save()
        return out

    def _save(self):
        with _lock:
            tmp = self.cache_path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self.cache, f, ensure_ascii=False)
            os.replace(tmp, self.cache_path)
