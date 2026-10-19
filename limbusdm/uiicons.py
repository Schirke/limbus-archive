"""The game's UI icons cut from the main build on first use, kept in data/ui_icons."""
from __future__ import annotations

import glob
import os
import threading

from . import bundles as _bundles  # noqa: F401  (sets the Unity fallback version)

PL = "MainUI_PersonalityList_"
# icon key → sprite name (a renamed sprite just 404s)
ICONS = {
    **{f"sin_{s}": f"{PL}4_{i}" for i, s in enumerate(["Wrath", "Lust", "Sloth", "Gluttony", "Gloom", "Pride", "Envy"])},
    "hp": f"{PL}4_22", "def": f"{PL}4_23",
    "res_Slash": f"{PL}4_24", "res_Pierce": f"{PL}4_32", "res_Blunt": f"{PL}4_31",
    "atk_Slash": "Icon_AttackType_slash", "atk_Pierce": "Icon_AttackType_pierce", "atk_Blunt": "Icon_AttackType_hit",
    "def_Guard": "Icon_AttackType_guard", "def_Evade": "Icon_AttackType_evade", "def_Counter": "Icon_AttackType_counter",
    **{f"st_{k}": f"Personality{k}" for k in ["Combustion", "Laceration", "Vibration", "Burst", "Sinking", "Breath", "Charge"]},
    **{f"rank_{n}": f"MainUI_Gacha_3_Rank{n}" for n in (1, 2, 3)},
    "up_1": f"{PL}4_18", "up_2": f"{PL}4_17", "up_3": f"{PL}4_16", "up_4": f"{PL}4_37", "up_5": f"{PL}4_40",
    "grade_ZAYIN": f"{PL}3_27", "grade_TETH": f"{PL}3_28", "grade_HE": f"{PL}3_38", "grade_WAW": f"{PL}3_39",
    "grade_ALEPH": f"{PL}3_29",
    # skill coins: plain, Unbreakable, purple / green
    "coin": "BattleUI_NewCoin_0", "coin_super": "BattleUI_NewCoin_3", "coin_purple": "BattleUI_NewCoin_14",
    "coin_green": "BattleUI_NewCoin_11",
    "item_thread": "icon_twine", "item_module": "icon_enkephalin_module",
}

_lock = threading.Lock()
_tried: set[str] = set()  # cache folders cut this run: a failed cut is tried again on the next start


def site_copy(folder: str, stem: str, key: str, ext: str = "") -> bytes | None:
    """The website's copy of what the game files didn't give (a mod changed them, a read failed), kept as <stem>.<ext>."""
    from .webcopy import get
    got = get(key)
    if not got:
        return None
    data, ext = got[0], ext or got[1]
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, f"{stem}.{ext}"), "wb") as f:
        f.write(data)
    return data


def _extract_all(game_data: str, cache_dir: str) -> None:
    """One pass over the main build: every ICONS icon saved as PNG."""
    import io
    import UnityPy
    os.makedirs(cache_dir, exist_ok=True)
    by_name = {v: k for k, v in ICONS.items() if not os.path.exists(os.path.join(cache_dir, f"{k}.png"))}
    files = [os.path.join(game_data, "resources.assets")] + sorted(glob.glob(os.path.join(game_data, "sharedassets*.assets")))
    left, broken = set(by_name), False
    for fp in files:
        if not left:
            break
        try:
            env = UnityPy.load(fp)
        except Exception:
            broken = True
            continue
        for o in env.objects:
            if o.type.name != "Sprite":
                continue
            try:
                n = o.peek_name()
            except Exception:
                continue
            if n not in left:
                continue
            try:
                img = o.read().image
                img.thumbnail((128, 128))
                buf = io.BytesIO()
                img.save(buf, "PNG")
                with open(os.path.join(cache_dir, f"{by_name[n]}.png"), "wb") as f:
                    f.write(buf.getvalue())
                left.discard(n)
            except Exception:
                continue
    if broken or (left and left == set(by_name)):  # nothing cut: tried again next start
        return
    with open(os.path.join(cache_dir, ".done"), "w") as f:  # every key looked for, then the ones the game no longer has
        f.write(" ".join(sorted(ICONS)) + "\n" + " ".join(sorted(by_name[n] for n in left)))


def _done(cache_dir: str) -> bool:
    """Whether extraction ran for the current ICONS."""
    try:
        with open(os.path.join(cache_dir, ".done")) as f:
            lines = f.read().split("\n")
    except OSError:
        return False
    return len(lines) > 1 and set(ICONS) <= set(lines[0].split())


# the game's UI fonts
FONTS = ("BebasKai", "Mikodacs", "ExcelsiorSans", "Pretendard-Regular")
SEASON_TAGS = "IntColorPairs_UnitInfoSeasonTag"  # the season label's colour on the Identity screen, per season id


def _extract_extras(game_data: str, cache_dir: str) -> None:
    """UI fonts and season colours from the main build."""
    import json
    import struct
    import UnityPy
    os.makedirs(cache_dir, exist_ok=True)
    seasons: dict[str, str] = {}
    files = [os.path.join(game_data, "resources.assets")] + sorted(glob.glob(os.path.join(game_data, "sharedassets*.assets")))
    left, broken = set(FONTS), False
    for fp in files:
        if not left and seasons:
            break
        try:
            env = UnityPy.load(fp)
        except Exception:
            broken = True
            continue
        for o in env.objects:
            try:
                if o.type.name == "Font" and left:
                    d = o.read()
                    data = bytes(d.m_FontData or b"")
                    if d.m_Name in left and len(data) > 1000:
                        with open(os.path.join(cache_dir, f"{d.m_Name}.font"), "wb") as f:
                            f.write(data)
                        left.discard(d.m_Name)
                elif o.type.name == "MonoBehaviour" and not seasons and o.byte_size < 4096:
                    # no type tree: read the raw layout up to the list
                    raw = o.get_raw_data()
                    n = struct.unpack_from("<i", raw, 28)[0]
                    if n != len(SEASON_TAGS) or raw[32:32 + n] != SEASON_TAGS.encode():
                        continue
                    for at in range(32 + (n + 3) // 4 * 4, len(raw) - 24, 4):
                        count = struct.unpack_from("<i", raw, at)[0]
                        if not 0 < count <= 64 or at + 4 + count * 20 > len(raw):
                            continue
                        rows = [struct.unpack_from("<i4f", raw, at + 4 + i * 20) for i in range(count)]
                        if all(0 < r[0] < 100000 and r[4] == 1.0 and all(0 <= v <= 1 for v in r[1:4]) for r in rows):
                            for sid, r, g, b, _a in rows:
                                seasons[str(sid)] = "#%02x%02x%02x" % tuple(round(v * 255) for v in (r, g, b))
                            break
            except Exception:
                continue
    if seasons or not broken:
        with open(os.path.join(cache_dir, "seasons.json"), "w") as f:
            json.dump(seasons, f)


def _extras(game_data: str, cache_dir: str) -> None:
    def done():
        return all(os.path.exists(os.path.join(cache_dir, n)) for n in ["seasons.json"] + [f"{f}.font" for f in FONTS])
    if not done() and "x" + cache_dir not in _tried:
        with _lock:
            if not done() and "x" + cache_dir not in _tried:
                _tried.add("x" + cache_dir)
                _extract_extras(game_data, cache_dir)


def season_colors(game_data: str, cache_dir: str) -> dict[str, str]:
    import json
    if not game_data:
        return {}
    _extras(game_data, cache_dir)
    try:
        with open(os.path.join(cache_dir, "seasons.json")) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def font_file(name: str, game_data: str, cache_dir: str) -> bytes | None:
    if name not in FONTS or not game_data:
        return None
    _extras(game_data, cache_dir)
    try:
        with open(os.path.join(cache_dir, f"{name}.font"), "rb") as f:
            return f.read()
    except OSError:
        pass
    from .site import url_key
    return site_copy(cache_dir, name, url_key("/api/font", name=name), "font")


def icon_png(key: str, game_data: str, cache_dir: str) -> bytes | None:
    if key not in ICONS or not game_data:
        return None
    path = os.path.join(cache_dir, f"{key}.png")
    if not os.path.exists(path) and not _done(cache_dir) and cache_dir not in _tried:
        with _lock:
            if not _done(cache_dir) and cache_dir not in _tried:
                _tried.add(cache_dir)
                _extract_all(game_data, cache_dir)
    for p in (path, path[:-4] + ".webp"):
        if os.path.exists(p):
            with open(p, "rb") as f:
                return f.read()
    from .site import url_key
    return site_copy(cache_dir, key, url_key("/api/ui_icon", k=key))
