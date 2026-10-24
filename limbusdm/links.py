"""Addresses of the files a page shows. The server puts them in its answers; the site export follows them
(site.Exporter.crawl), so a page and the site never work out a path each on their own."""
from urllib.parse import parse_qsl, quote, unquote

SKILL_ICON = "Assets/Resources_moved/Sprite/SkillIcon/{}.png"
PREVIEW = ("Texture2D", "Sprite", "AudioClip", "VideoClip", "TextAsset", "Mesh")  # shown as they are; any other type as its properties


def _q(s) -> str:
    return quote(str(s), safe="!~*'()")  # (as encodeURIComponent)


def thumb(path: str) -> str:
    """Small preview of a game picture."""
    return f"/api/asset_thumb?path={_q(path)}" if path else ""


def img(path: str) -> str:
    """A game picture at full size."""
    return f"/api/asset_img?path={_q(path)}" if path else ""


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


def ui_icon(k: str) -> str:
    """One of the game's interface icons."""
    return f"/api/ui_icon?k={_q(k)}"


def font(name: str) -> str:
    """One of the game's interface fonts."""
    return f"/api/font?name={_q(name)}"


def enemy_thumb(app: str) -> str:
    """The page's picture of an enemy's idle pose."""
    return f"/api/enemy_thumb?app={_q(app)}" if app else ""


def buff_video(name: str) -> str:
    """The video of a buff's effect."""
    return f"/api/buff_video?name={_q(name)}"


def fx_video(cid, v: str, name: str) -> str:
    """A skill's video rendered with the game's effects (v: the render options)."""
    return f"/api/fx_video?id={_q(cid)}{'&v=' + _q(v) if v else ''}&name={_q(name)}"


def lang_table(lid: str, group: str) -> str:
    """A language's text table (core / story)."""
    return f"/api/lang?id={_q(lid)}&g={group}"


def ui_lang(code: str) -> str:
    """The interface's dictionary of a language."""
    return f"/api/ui_lang?lang={_q(code)}"


def report_thumb(h: str) -> str:
    """A report's stored preview of a texture, by its hash."""
    return f"/api/thumb?h={_q(h)}" if h else ""


def obj(bundle: str, pid, type: str = "Texture2D") -> str:
    """What the page shows of a game object: itself, or its properties when it is no picture / sound / text."""
    return f"/api/object?bundle={_q(bundle)}&pid={pid}" + ("" if type in PREVIEW else "&fmt=props")


def blob(h: str) -> str:
    """A stored file by its hash."""
    return f"/api/blob?h={_q(h)}" if h else ""


def container(path: str) -> str:
    """The objects a catalog path holds."""
    return f"/api/container?path={_q(path)}"


def tree(prefix: str) -> str:
    """A folder's listing."""
    return f"/api/tree?prefix={_q(prefix)}"


def patchnotes(rid: str) -> str:
    """A report's short "what's new"."""
    return f"/api/patchnotes?id={_q(rid)}"


def story_pic(path: str, m: int = 1920) -> str:
    """A story picture as a smaller WebP at most m px."""
    return f"/api/story_pic?path={_q(path)}&m={m}" if path else ""


def story_ep(file: str) -> str:
    """One story file as scenes."""
    return f"/api/story_ep?id={_q(file)}" if file else ""


def story_audio(sample: str) -> str:
    """A story's voice, effect or music."""
    return f"/api/story_audio?s={_q(sample)}" if sample else ""


def sounds(at: str) -> str:
    """One folder of the Sounds page: its sounds (at: its place, soundlib.find_at)."""
    return f"/api/sounds?at={_q(at)}"


def story_video(name: str) -> str:
    """A story's video."""
    return f"/api/story_video?name={_q(name)}" if name else ""


def story_model(psb: str) -> str:
    """A layered standing picture's layout."""
    return f"/api/story_model?path={_q(psb)}" if psb else ""


def story_sprite(bundle: str, pid) -> str:
    """One sprite of a layered standing picture."""
    return f"/api/story_sprite?b={_q(bundle)}&p={pid}"


def stage_node_pic(nid) -> str:
    """A Story map node's card picture."""
    return f"/api/stage_node_pic?id={nid}"


def spine(bundle: str, atlas) -> dict:
    """A Spine skeleton's two files; the atlas names its pages."""
    base = f"/spine/{_q(bundle)}/{atlas}.2/skeleton"  # .2: pages at the atlas size
    return {"atlas": base + ".atlas", "json": base + ".json"}


def spine_scene(bundle: str, atlas) -> str:
    """The illustration a skeleton is part of: its layers."""
    return f"/api/spine_scene?bundle={_q(bundle)}&atlas={atlas}"


def scene_sprite(bundle: str, pid) -> str:
    """An illustration layer's picture."""
    return f"/api/scene_sprite?bundle={_q(bundle)}&pid={pid}"


def owner_clips(cid) -> str:
    """The battle clips of an Identity / E.G.O."""
    return f"/api/owner_clips?id={cid}"


def clip(bundle: str, clip_id, go, all_layers: int = 0) -> str:
    """One battle clip as frames (all_layers: with the layers a skill switches on)."""
    return f"/api/clip?bundle={_q(bundle)}&clip={_q(clip_id)}&go={_q(go)}&all={all_layers}"


def key(url: str) -> str:
    """An address as the site's service worker names it (sw.js keyOf): path decoded, params sorted."""
    path, _, qs = url.partition("?")
    q = sorted(f"{k}={v}" for k, v in parse_qsl(qs, keep_blank_values=True) if k not in ("t", "refresh", "force"))
    return unquote(path) + ("?" + "&".join(q) if q else "")
