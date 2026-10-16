"""Addresses of the files a page shows. The server puts them in its answers; the site export follows them
(site.Exporter.crawl), so a page and the site never work out a path each on their own."""
from urllib.parse import parse_qsl, quote, unquote

SKILL_ICON = "Assets/Resources_moved/Sprite/SkillIcon/{}.png"


def _q(s) -> str:
    return quote(str(s), safe="!~*'()")  # (as encodeURIComponent)


def thumb(path: str) -> str:
    """Small preview of a game picture."""
    return f"/api/asset_thumb?path={_q(path)}" if path else ""


def img(path: str) -> str:
    """A game picture at full size."""
    return f"/api/asset_img?path={_q(path)}" if path else ""


def enemy_thumb(app: str) -> str:
    """The page's picture of an enemy's idle pose."""
    return f"/api/enemy_thumb?app={_q(app)}" if app else ""


def spine(bundle: str, atlas) -> dict:
    """A Spine skeleton's two files; the atlas names its pages."""
    base = f"/spine/{_q(bundle)}/{atlas}.2/skeleton"  # .2: pages at the atlas size
    return {"atlas": base + ".atlas", "json": base + ".json"}


def key(url: str) -> str:
    """An address as the site's service worker names it (sw.js keyOf): path decoded, params sorted."""
    path, _, qs = url.partition("?")
    q = sorted(f"{k}={v}" for k, v in parse_qsl(qs, keep_blank_values=True) if k not in ("t", "refresh", "force"))
    return unquote(path) + ("?" + "&".join(q) if q else "")
