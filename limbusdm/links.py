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


def obj(bundle: str, pid) -> str:
    """A picture of a bundle by its object id."""
    return f"/api/object?bundle={_q(bundle)}&pid={pid}" if bundle else ""


def bank(path: str, i) -> str:
    """One sound of a sound bank."""
    return f"/api/bank?path={_q(path)}&i={i}" if path else ""


def quiz_audio(sample: str) -> str:
    """One voice line or sound by its sample's name."""
    return f"/api/quiz_audio?s={_q(sample)}" if sample else ""


def gacha_ui(name: str) -> str:
    """A picture of the Extraction screens."""
    return f"/api/gacha_ui?n={_q(name)}" if name else ""


def stage_pic(name: str) -> str:
    """A battle stage's picture."""
    return f"/api/stage_pic?name={_q(name)}" if name else ""


def music_audio(n: int) -> str:
    """A soundtrack's track by its number."""
    return f"/api/music_audio?n={n}"


def enemy_thumb(app: str) -> str:
    """The page's picture of an enemy's idle pose."""
    return f"/api/enemy_thumb?app={_q(app)}" if app else ""


def buff_video(name: str) -> str:
    """The video of a buff's effect."""
    return f"/api/buff_video?name={_q(name)}"


def lang_table(lid: str, group: str) -> str:
    """A language's text table (core / story)."""
    return f"/api/lang?id={_q(lid)}&g={group}"


def ui_lang(code: str) -> str:
    """The interface's dictionary of a language."""
    return f"/api/ui_lang?lang={_q(code)}"


def spine(bundle: str, atlas) -> dict:
    """A Spine skeleton's two files; the atlas names its pages."""
    base = f"/spine/{_q(bundle)}/{atlas}.2/skeleton"  # .2: pages at the atlas size
    return {"atlas": base + ".atlas", "json": base + ".json"}


def key(url: str) -> str:
    """An address as the site's service worker names it (sw.js keyOf): path decoded, params sorted."""
    path, _, qs = url.partition("?")
    q = sorted(f"{k}={v}" for k, v in parse_qsl(qs, keep_blank_values=True) if k not in ("t", "refresh", "force"))
    return unquote(path) + ("?" + "&".join(q) if q else "")
